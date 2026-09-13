"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import {
    Megaphone, CheckCircle2, Clock, AlertCircle, Send,
    RefreshCw, BarChart3, Loader2, RotateCcw,
    Building2, CalendarCheck, ShieldAlert, Info, ChevronLeft, ChevronRight, Smartphone, DatabaseZap,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
    Dialog, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { cn } from "@/lib/utils"
import { ROTULO_STATUS_CATEGORIA, type StatusCategoria } from "@/lib/programacao/permissoes-categoria"
import {
    ROTULO_ESTADO_RAG, mesmoMes, motivoBloqueioAprovarRag, motivoBloqueioDisparo, type EstadoRag, type MesAno, type UnidadeSituacao,
} from "@/lib/divulgacao/niveis"

/* ─── Tipos ─── */
type StatusDisparo = "pendente" | "em_andamento" | "concluido" | "pausado" | "pausado_limite_diario" | "erro"

type DisparoHistorico = {
    id: string
    titulo: string | null
    mes: number
    ano: number
    status: StatusDisparo
    total_leads: number
    total_enviados: number
    total_erros: number
    total_stop: number
    created_at: string
}

type NumeroMetaInstitucional = {
    display_name: string | null
    phone_number_id: string
}

type TemplateMeta = {
    nome: string
    corpo_texto: string
}

// S-PROG-15: resposta de /api/divulgacao/situacao
type Situacao = {
    vigente: MesAno
    foraDeSincronia: string[]
    permitidos: MesAno[]
    selecionado: MesAno
    mesPermitido: boolean
    unidades: UnidadeSituacao[]
    nivel1: boolean
    nivel2: boolean
    precisamAprovar: string[]
    indexando: string[]
    rotuloAprovar: string
    permissoes: { aprovarRag: boolean; disparar: boolean }
}

/* ─── Constantes ─── */
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
const MESES_EXTENSO = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : "Erro desconhecido"

const COR_ESTADO_RAG: Record<EstadoRag, string> = {
    nao_aprovado: "bg-muted/60 text-muted-foreground border-border",
    indexando: "bg-blue-500/15 text-blue-400 border-blue-500/30",
    falhou: "bg-red-500/15 text-red-400 border-red-500/30",
    no_ar: "bg-green-500/15 text-green-400 border-green-500/30",
}

const DISPARO_STATUS_CONFIG: Record<StatusDisparo, { label: string; color: string }> = {
    pendente: { label: "Na fila", color: "bg-blue-500/15 text-blue-400" },
    em_andamento: { label: "Enviando...", color: "bg-amber-500/15 text-amber-400" },
    concluido: { label: "Concluído", color: "bg-green-500/15 text-green-400" },
    pausado: { label: "Pausado", color: "bg-orange-500/15 text-orange-400" },
    // S-WM-60: disparo truncado pelo limite diário do número — retomada é manual, sem UI própria ainda.
    pausado_limite_diario: { label: "Pausado (limite diário)", color: "bg-orange-500/15 text-orange-400" },
    erro: { label: "Erro", color: "bg-red-500/15 text-red-400" },
}

function Nivel({ numero, titulo, ok, detalhe }: { numero: number; titulo: string; ok: boolean; detalhe: string }) {
    return (
        <div className={cn("flex items-start gap-3 rounded-xl border p-4",
            ok ? "border-green-500/30 bg-green-500/[0.06]" : "border-amber-500/30 bg-amber-500/[0.06]")}>
            {ok ? <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" /> : <AlertCircle className="h-5 w-5 text-amber-400 shrink-0" />}
            <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">Nível {numero} — {titulo}</p>
                <p className="text-xs text-muted-foreground mt-0.5 break-words">{detalhe}</p>
            </div>
        </div>
    )
}

/* ─── Componente ─── */
export default function DivulgacaoPage() {
    const router = useRouter()
    const supabase = useMemo(() => createClient(), [])
    const [mesSelecionado, setMesSelecionado] = useState<MesAno | null>(null)

    const [carregando, setCarregando] = useState(true)
    const [semPermissao, setSemPermissao] = useState(false)
    const [situacao, setSituacao] = useState<Situacao | null>(null)
    const [historico, setHistorico] = useState<DisparoHistorico[]>([])

    // Modal de disparo
    const [modalAberto, setModalAberto] = useState(false)
    const [numeroMeta, setNumeroMeta] = useState<NumeroMetaInstitucional | null>(null)
    const [templateMeta, setTemplateMeta] = useState<TemplateMeta | null>(null)
    const [disparando, setDisparando] = useState(false)

    // S-PROG-15: "Aprovar RAG"
    const [confirmarRagAberto, setConfirmarRagAberto] = useState(false)
    const [aprovandoRag, setAprovandoRag] = useState(false)

    const carregarSituacao = useCallback(async (mes: MesAno | null) => {
        const query = mes ? `?mes=${mes.mes}&ano=${mes.ano}` : ""
        const res = await fetch(`/api/divulgacao/situacao${query}`, { cache: "no-store" })
        const data = await res.json()
        if (res.status === 401) { router.push("/login"); return null }
        if (res.status === 403) { setSemPermissao(true); return null }
        if (!res.ok) throw new Error(data.error || "Falha ao carregar a situação do mês")
        setSituacao(data as Situacao)
        return data as Situacao
    }, [router])

    const fetchData = useCallback(async () => {
        setCarregando(true)
        try {
            const sit = await carregarSituacao(mesSelecionado)
            if (!sit) return

            // A API expõe somente a configuração necessária à Divulgação;
            // o lookup administrativo permanece protegido no servidor.
            const configResponse = await fetch("/api/divulgacao/disparar", { cache: "no-store" })
            const config = await configResponse.json()
            if (!configResponse.ok) throw new Error(config.error || "Falha ao carregar configuração Meta")
            setNumeroMeta(config.numero as NumeroMetaInstitucional | null)
            setTemplateMeta(config.template as TemplateMeta | null)

            const { data: hist } = await supabase
                .from("disparos_divulgacao")
                .select("id, titulo, mes, ano, status, total_leads, total_enviados, total_erros, total_stop, created_at")
                .order("created_at", { ascending: false })
                .limit(10)
            setHistorico(hist ?? [])
        } catch (error: unknown) {
            toast.error("Erro ao carregar: " + getErrorMessage(error))
        } finally {
            setCarregando(false)
        }
    }, [carregarSituacao, mesSelecionado, supabase])

    useEffect(() => { fetchData() }, [fetchData])

    // Acompanha a indexação sem recarregar a página.
    const indexando = situacao?.indexando.length ?? 0
    useEffect(() => {
        if (!situacao || indexando === 0) return
        const id = setInterval(() => { carregarSituacao(situacao.selecionado).catch(() => undefined) }, 10000)
        return () => clearInterval(id)
    }, [carregarSituacao, indexando, situacao])

    const mesAtual = situacao?.selecionado.mes ?? new Date().getMonth() + 1
    const anoAtual = situacao?.selecionado.ano ?? new Date().getFullYear()
    const unidades = situacao?.unidades ?? []
    const indiceSelecionado = situacao ? situacao.permitidos.findIndex(p => mesmoMes(p, situacao.selecionado)) : -1

    const navegarMes = (delta: number) => {
        if (!situacao) return
        const destino = situacao.permitidos[indiceSelecionado + delta]
        if (destino) setMesSelecionado(destino)
    }

    const podeCriar = situacao?.permissoes.disparar ?? false
    const motivoBloqueio = situacao
        ? motivoBloqueioDisparo({
            temPermissao: podeCriar,
            mesPermitido: situacao.mesPermitido,
            unidades,
            temNumero: !!numeroMeta,
            temTemplate: !!templateMeta,
        })
        : "Carregando"
    const podeDisparar = motivoBloqueio === null

    const motivoBloqueioRag = situacao
        ? motivoBloqueioAprovarRag({
            temPermissao: situacao.permissoes.aprovarRag,
            mesPermitido: situacao.mesPermitido,
            unidades,
        })
        : "Carregando"
    const podeAprovarRag = motivoBloqueioRag === null

    const abrirModal = () => {
        if (!podeDisparar) {
            toast.error(motivoBloqueio ?? "Disparo indisponível")
            return
        }
        setModalAberto(true)
    }

    const handleDisparar = async () => {
        if (!podeDisparar) {
            toast.error(motivoBloqueio ?? "O disparo não está disponível.")
            return
        }
        setDisparando(true)
        try {
            const res = await fetch("/api/divulgacao/disparar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    mes: mesAtual,
                    ano: anoAtual,
                    titulo: `Aviso Programação ${MESES[mesAtual - 1]}/${anoAtual}`,
                })
            })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error || "Falha na API")
            }
            toast.success("Disparo criado e na fila! O motor iniciará o envio em instantes.")
            setModalAberto(false)
            fetchData()
        } catch (error: unknown) {
            toast.error("Erro: " + getErrorMessage(error))
        } finally {
            setDisparando(false)
        }
    }

    const aprovarRag = async (unidade?: string) => {
        setAprovandoRag(true)
        try {
            const res = await fetch("/api/divulgacao/aprovar-rag", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ mes: mesAtual, ano: anoAtual, unidade }),
            })
            const data = await res.json()
            if (!res.ok && !data.resultados) throw new Error(data.error || "Falha ao aprovar o RAG")
            const falhas = (data.resultados ?? []).filter((r: { ok: boolean }) => !r.ok)
            if (falhas.length > 0) {
                toast.error(`Falhou em: ${falhas.map((f: { unidade: string }) => f.unidade.replace("Cuca ", "")).join(", ")}`)
            } else {
                toast.success("RAG enviado para indexação. Cada unidade entra no ar quando terminar; até lá o mês anterior continua respondendo.")
            }
            setConfirmarRagAberto(false)
            await carregarSituacao(situacao?.selecionado ?? null)
        } catch (error: unknown) {
            toast.error("Erro: " + getErrorMessage(error))
        } finally {
            setAprovandoRag(false)
        }
    }

    const aprovadas = unidades.filter(u => u.nivel1).length

    if (carregando && !situacao) {
        return (
            <div className="flex-1 flex items-center justify-center p-12">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500" />
            </div>
        )
    }

    if (semPermissao) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-12 gap-4 text-center">
                <ShieldAlert className="h-16 w-16 text-muted-foreground/40" />
                <h2 className="text-xl font-bold text-foreground">Acesso Restrito</h2>
                <p className="text-muted-foreground max-w-sm">Este módulo é exclusivo do Gestor de Divulgação. Solicite permissão ao Developer.</p>
            </div>
        )
    }

    const detalheNivel1 = situacao?.nivel1
        ? "Todas as programações do mês estão autorizadas pelos coordenadores."
        : unidades.filter(u => !u.nivel1).map(u => `${u.unidade.replace("Cuca ", "")}: ${u.faltando.join(", ")}`).join(" · ")
    const detalheNivel2 = situacao?.nivel2
        ? "O RAG deste mês está no ar nas 5 unidades."
        : unidades.filter(u => u.rag !== "no_ar").map(u => `${u.unidade.replace("Cuca ", "")}: ${ROTULO_ESTADO_RAG[u.rag].toLowerCase()}`).join(" · ")

    return (
        <div className="flex-1 flex flex-col gap-6 p-4 lg:p-8">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-yellow-500/15 border border-yellow-500/30">
                        <Megaphone className="h-6 w-6 text-yellow-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Central de Divulgação</h1>
                        <p className="text-sm text-muted-foreground">
                            {MESES[mesAtual - 1]}/{anoAtual} — {aprovadas} de {unidades.length} unidades autorizadas
                            {situacao && ` · no ar: ${MESES[situacao.vigente.mes - 1]}/${situacao.vigente.ano}`}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    {/* S-PROG-15: só o mês vigente (no ar no RAG) e o seguinte */}
                    <div className="flex items-center gap-1 border border-border rounded-lg px-1 py-1 bg-muted/30">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navegarMes(-1)} disabled={indiceSelecionado <= 0}>
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-sm font-semibold text-foreground min-w-[80px] text-center">
                            {MESES[mesAtual - 1]}/{anoAtual}
                        </span>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navegarMes(1)}
                            disabled={!situacao || indiceSelecionado < 0 || indiceSelecionado >= situacao.permitidos.length - 1}>
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                    <Button variant="outline" size="sm" onClick={fetchData} disabled={carregando}>
                        <RefreshCw className={cn("h-4 w-4 mr-1.5", carregando && "animate-spin")} /> Atualizar
                    </Button>
                    {/* S-PROG-15: sempre visível; desativado mostra o motivo, igual ao disparo */}
                    <div className="flex flex-col items-end gap-0.5">
                        <Button variant="outline" className="border-blue-500/40 text-blue-500 hover:bg-blue-500/10 font-semibold gap-2 disabled:opacity-50"
                            onClick={() => setConfirmarRagAberto(true)} disabled={!podeAprovarRag || aprovandoRag}
                            title={motivoBloqueioRag ?? undefined}>
                            <DatabaseZap className="h-4 w-4" /> {situacao?.rotuloAprovar ?? "Aprovar RAG"}
                        </Button>
                        {!podeAprovarRag && (
                            <p className="text-[10px] text-muted-foreground text-right max-w-xs">
                                {motivoBloqueioRag}
                            </p>
                        )}
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                        <Button
                            className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold gap-2 disabled:opacity-50"
                            onClick={abrirModal}
                            disabled={!podeDisparar}
                            title={motivoBloqueio ?? undefined}
                        >
                            <Megaphone className="h-4 w-4" />
                            Disparar Aviso Global
                        </Button>
                        {!podeDisparar && (
                            <p className="text-[10px] text-muted-foreground text-right max-w-xs">
                                {motivoBloqueio}
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {situacao && situacao.foraDeSincronia.length > 0 && (
                <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-500 text-sm">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <span>Unidades fora do mês vigente no RAG: {situacao.foraDeSincronia.map(u => u.replace("Cuca ", "")).join(", ")}.</span>
                </div>
            )}

            {/* S-PROG-15: bloqueio duplo */}
            <div className="grid gap-3 md:grid-cols-2">
                <Nivel numero={1} titulo="Programações autorizadas" ok={!!situacao?.nivel1} detalhe={detalheNivel1} />
                <Nivel numero={2} titulo={`RAG de ${MESES[mesAtual - 1]}/${anoAtual}`} ok={!!situacao?.nivel2} detalhe={detalheNivel2} />
            </div>

            <Card className="border-blue-500/20 bg-blue-500/[0.04] shadow-sm">
                <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3">
                        <div className="rounded-lg border border-blue-500/25 bg-blue-500/10 p-2">
                            <Smartphone className="h-4 w-4 text-blue-400" />
                        </div>
                        <div>
                            <p className="text-sm font-semibold text-foreground">
                                Número Meta Institucional — {numeroMeta?.display_name ?? "indisponível"}
                            </p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                                {numeroMeta
                                    ? <>phone_number_id: <span className="font-mono text-foreground/80">{numeroMeta.phone_number_id}</span></>
                                    : "Nenhum número Institucional ativo foi encontrado."}
                            </p>
                        </div>
                    </div>
                    <Badge variant="outline" className={numeroMeta && templateMeta
                        ? "w-fit border-green-500/30 bg-green-500/10 text-green-400"
                        : "w-fit border-red-500/30 bg-red-500/10 text-red-400"}>
                        {numeroMeta && templateMeta ? "Meta pronta para envio" : "Configuração incompleta"}
                    </Badge>
                </CardContent>
            </Card>

            {/* Status por unidade */}
            <Card className="shadow-sm">
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <CalendarCheck className="h-5 w-5 text-muted-foreground" />
                        Status da Programação — {MESES[mesAtual - 1]}/{anoAtual}
                    </CardTitle>
                    <CardDescription className="text-xs">
                        Os coordenadores autorizam cada categoria na tela da programação. Com tudo autorizado, &quot;{situacao?.rotuloAprovar ?? "Aprovar RAG"}&quot; coloca o mês no ar.
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="divide-y divide-border/50">
                        {unidades.map(u => (
                            <div key={u.unidade} className="flex flex-col lg:flex-row lg:items-center justify-between gap-2 px-6 py-3.5 hover:bg-muted/30 transition-colors">
                                <div className="flex items-center gap-3 min-w-0">
                                    <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                                    <span className="font-medium text-foreground text-sm">{u.unidade}</span>
                                    {!u.campanhaId && <span className="text-xs text-muted-foreground">sem programação</span>}
                                </div>
                                <div className="flex items-center gap-2 flex-wrap">
                                    {u.categorias.map(c => (
                                        <Badge key={c.categoria} variant="outline" className={cn("text-[10.5px]",
                                            c.status === "autorizada" ? "border-green-500/30 text-green-400"
                                                : c.status === "aguardando_autorizacao" ? "border-amber-500/30 text-amber-400" : "text-muted-foreground")}>
                                            {c.categoria}: {ROTULO_STATUS_CATEGORIA[c.status as StatusCategoria] ?? c.status}
                                        </Badge>
                                    ))}
                                    <Badge className={`flex items-center gap-1.5 text-xs font-medium border ${COR_ESTADO_RAG[u.rag]}`}>
                                        {u.rag === "indexando" ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            : u.rag === "no_ar" ? <CheckCircle2 className="h-3.5 w-3.5" />
                                                : u.rag === "falhou" ? <AlertCircle className="h-3.5 w-3.5" /> : <Clock className="h-3.5 w-3.5" />}
                                        RAG: {ROTULO_ESTADO_RAG[u.rag]}
                                    </Badge>
                                    {u.rag === "falhou" && situacao?.permissoes.aprovarRag && situacao.mesPermitido && situacao.nivel1 && (
                                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={aprovandoRag}
                                            onClick={() => aprovarRag(u.unidade)}>
                                            <RotateCcw className="h-3 w-3" /> Tentar de novo
                                        </Button>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Histórico */}
            <Card className="shadow-sm">
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <BarChart3 className="h-5 w-5 text-muted-foreground" />
                        Histórico de Disparos Globais
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {historico.length === 0 ? (
                        <div className="py-12 text-center text-muted-foreground text-sm">
                            Nenhum disparo realizado ainda.
                        </div>
                    ) : (
                        <div className="divide-y divide-border/50">
                            {historico.map(d => {
                                const cfg = DISPARO_STATUS_CONFIG[d.status]
                                return (
                                    <div key={d.id} className="flex flex-col sm:flex-row sm:items-center justify-between px-6 py-3.5 gap-2">
                                        <div>
                                            <p className="font-medium text-sm text-foreground">{d.titulo || `Aviso ${MESES[d.mes - 1]}/${d.ano}`}</p>
                                            <p className="text-xs text-muted-foreground/60 mt-0.5">
                                                {format(new Date(d.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-3 flex-wrap">
                                            <span className="text-xs text-muted-foreground">{d.total_enviados}/{d.total_leads} enviados</span>
                                            {d.total_stop > 0 && (
                                                <span className="text-xs text-orange-600">{d.total_stop} STOP</span>
                                            )}
                                            {d.total_erros > 0 && (
                                                <span className="text-xs text-red-600">{d.total_erros} erros</span>
                                            )}
                                            <Badge className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</Badge>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* S-PROG-15: confirmação do "Aprovar RAG" */}
            <Dialog open={confirmarRagAberto} onOpenChange={setConfirmarRagAberto}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <DatabaseZap className="h-5 w-5 text-blue-500" />
                            {situacao?.rotuloAprovar} — {MESES_EXTENSO[mesAtual - 1]} de {anoAtual}
                        </DialogTitle>
                        <DialogDescription>
                            O assistente do WhatsApp passará a responder com a programação de <strong>{MESES_EXTENSO[mesAtual - 1]} de {anoAtual}</strong> em
                            {" "}{situacao?.precisamAprovar.map(u => u.replace("Cuca ", "")).join(", ")}. Cada unidade entra no ar quando terminar a
                            indexação; até lá, o conteúdo atual continua respondendo.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmarRagAberto(false)} disabled={aprovandoRag}>Cancelar</Button>
                        <Button className="bg-blue-600 hover:bg-blue-700 text-white font-bold" onClick={() => aprovarRag()} disabled={aprovandoRag}>
                            {aprovandoRag ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <DatabaseZap className="h-4 w-4 mr-2" />}
                            Confirmar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Modal de Disparo */}
            <Dialog open={modalAberto} onOpenChange={setModalAberto}>
                <DialogContent className="sm:max-w-[580px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Megaphone className="h-5 w-5 text-yellow-500" />
                            Disparar Aviso Global — {MESES[mesAtual - 1]}/{anoAtual}
                        </DialogTitle>
                        <DialogDescription>
                            Esta mensagem será enviada para <strong>todos os leads opt-in</strong> da base completa da Rede CUCA.
                            Confira o remetente e o template Meta aprovado antes de confirmar.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm">
                            <Info className="h-4 w-4 shrink-0" />
                            <span>
                                Número Meta Institucional — <strong>{numeroMeta?.display_name ?? "indisponível"}</strong>
                                {numeroMeta && <> · phone_number_id <span className="font-mono">{numeroMeta.phone_number_id}</span></>}
                            </span>
                        </div>

                        <div className="space-y-1.5">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                                <Label>Preview do template Meta aprovado</Label>
                                <Badge variant="secondary" className="font-mono text-[10px]">
                                    {templateMeta?.nome ?? "template indisponível"}
                                </Badge>
                            </div>
                            <div
                                role="textbox"
                                aria-readonly="true"
                                className="min-h-32 whitespace-pre-wrap rounded-lg border border-border bg-muted/35 p-4 text-sm leading-relaxed text-foreground"
                            >
                                {templateMeta?.corpo_texto ?? "O template Meta Institucional aprovado não está disponível."}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Parâmetros preenchidos pelo motor: <strong>{"{{1}}"} nome</strong> e <strong>{"{{2}}"} mês</strong>.
                                O conteúdo acima é somente leitura e corresponde ao envio real.
                            </p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setModalAberto(false)} disabled={disparando}>
                            Cancelar
                        </Button>
                        <Button
                            className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold"
                            onClick={handleDisparar}
                            disabled={disparando || !podeDisparar}
                        >
                            {disparando ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                            Confirmar Disparo
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
