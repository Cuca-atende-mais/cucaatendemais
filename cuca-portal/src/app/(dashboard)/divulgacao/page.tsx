"use client"

import { useEffect, useState, useCallback, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import {
    Megaphone, CheckCircle2, Clock, AlertCircle, Send,
    RefreshCw, BarChart3, Loader2,
    Building2, CalendarCheck, ShieldAlert, Info, ChevronLeft, ChevronRight, Smartphone,
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
import { unidadesCuca } from "@/lib/constants"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { useUser } from "@/lib/auth/user-provider"

/* ─── Tipos ─── */
type StatusCampanha = "sem_planilha" | "pendente" | "aprovado" | "em_andamento"
type StatusDisparo = "pendente" | "em_andamento" | "concluido" | "pausado" | "erro"
type UnidadeStatus = {
    unidade: string
    status: StatusCampanha
    total_atividades: number
    campanha_id: string | null
    updated_at: string | null
}

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

/* ─── Constantes ─── */
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : "Erro desconhecido"

const STATUS_CONFIG: Record<StatusCampanha, { label: string; color: string; icon: React.ReactNode }> = {
    sem_planilha: {
        label: "Sem planilha",
        color: "bg-muted/60 text-muted-foreground border-border",
        icon: <AlertCircle className="h-3.5 w-3.5" />,
    },
    pendente: {
        label: "Aguardando aprovação",
        color: "bg-amber-500/15 text-amber-400 border-amber-500/30",
        icon: <Clock className="h-3.5 w-3.5" />,
    },
    aprovado: {
        label: "Aprovada ✓",
        color: "bg-green-500/15 text-green-400 border-green-500/30",
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    },
    em_andamento: {
        label: "Em andamento",
        color: "bg-blue-500/15 text-blue-400 border-blue-500/30",
        icon: <Clock className="h-3.5 w-3.5" />,
    },
}

const DISPARO_STATUS_CONFIG: Record<StatusDisparo, { label: string; color: string }> = {
    pendente: { label: "Na fila", color: "bg-blue-500/15 text-blue-400" },
    em_andamento: { label: "Enviando...", color: "bg-amber-500/15 text-amber-400" },
    concluido: { label: "Concluído", color: "bg-green-500/15 text-green-400" },
    pausado: { label: "Pausado", color: "bg-orange-500/15 text-orange-400" },
    erro: { label: "Erro", color: "bg-red-500/15 text-red-400" },
}

/* ─── Componente ─── */
export default function DivulgacaoPage() {
    const router = useRouter()
    const supabase = useMemo(() => createClient(), [])
    const { hasPermission } = useUser()
    const hoje = new Date()
    const [mesAtual, setMesAtual] = useState(hoje.getMonth() + 1)
    const [anoAtual, setAnoAtual] = useState(hoje.getFullYear())

    const navegarMes = (delta: number) => {
        setMesAtual(prev => {
            const novoMes = prev + delta
            if (novoMes < 1) { setAnoAtual(a => a - 1); return 12 }
            if (novoMes > 12) { setAnoAtual(a => a + 1); return 1 }
            return novoMes
        })
    }

    const [carregando, setCarregando] = useState(true)
    const [semPermissao, setSemPermissao] = useState(false)
    const [unidades, setUnidades] = useState<UnidadeStatus[]>([])
    const [historico, setHistorico] = useState<DisparoHistorico[]>([])
    const [podeCriar, setPodeCriar] = useState(false)

    // Modal de disparo
    const [modalAberto, setModalAberto] = useState(false)
    const [numeroMeta, setNumeroMeta] = useState<NumeroMetaInstitucional | null>(null)
    const [templateMeta, setTemplateMeta] = useState<TemplateMeta | null>(null)
    const [disparando, setDisparando] = useState(false)

    const fetchData = useCallback(async () => {
        setCarregando(true)
        try {
            // 1. Verificar acesso ao módulo divulgacao via RBAC
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push("/login"); return }

            if (!hasPermission("divulgacao", "read")) { setSemPermissao(true); return }
            setPodeCriar(hasPermission("divulgacao", "create"))

            // 2. Buscar status das campanhas do mês atual por unidade
            const { data: campanhas } = await supabase
                .from("campanhas_mensais")
                .select("id, unidade_cuca, status, total_atividades, updated_at")
                .eq("mes", mesAtual)
                .eq("ano", anoAtual)

            const statusPorUnidade: UnidadeStatus[] = unidadesCuca.map(u => {
                const camp = campanhas?.find(c => c.unidade_cuca === u)
                return {
                    unidade: u,
                    status: (camp?.status as StatusCampanha) ?? "sem_planilha",
                    total_atividades: camp?.total_atividades ?? 0,
                    campanha_id: camp?.id ?? null,
                    updated_at: camp?.updated_at ?? null,
                }
            })
            setUnidades(statusPorUnidade)

            // 3. A API expõe somente a configuração necessária à Divulgação;
            // o lookup administrativo permanece protegido no servidor.
            const configResponse = await fetch("/api/divulgacao/disparar", { cache: "no-store" })
            const config = await configResponse.json()
            if (!configResponse.ok) throw new Error(config.error || "Falha ao carregar configuração Meta")
            setNumeroMeta(config.numero as NumeroMetaInstitucional | null)
            setTemplateMeta(config.template as TemplateMeta | null)

            // 4. Histórico de disparos
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
    }, [anoAtual, hasPermission, mesAtual, router, supabase])

    useEffect(() => { fetchData() }, [fetchData])

    const abrirModal = () => {
        if (!podeCriar) {
            toast.error("Você não possui permissão para criar disparos de divulgação.")
            return
        }
        if (!numeroMeta || !templateMeta) {
            toast.error("Número ou template Meta Institucional indisponível.")
            return
        }
        setModalAberto(true)
    }

    const handleDisparar = async () => {
        if (!podeCriar || !numeroMeta || !templateMeta) {
            toast.error("O disparo não está disponível para este usuário ou configuração.")
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

    const aprovadas = unidades.filter(u => u.status === "aprovado").length
    // SQS-44 AC-10: disparo somente quando TODAS as unidades estiverem aprovadas
    const podeDisparar = podeCriar
        && aprovadas === unidadesCuca.length
        && !!numeroMeta
        && !!templateMeta
    const motivoBloqueio = !podeCriar
        ? "Sem permissão divulgacao:create"
        : aprovadas < unidadesCuca.length
            ? `Aguardando aprovação: ${unidades.filter(u => u.status !== "aprovado").map(u => u.unidade.replace("Cuca ", "")).join(", ")}`
            : !numeroMeta
                ? "Número Meta Institucional indisponível"
                : !templateMeta
                    ? "Template Meta Institucional aprovado indisponível"
                    : "Todas as unidades aprovadas — pronto para disparar"

    if (carregando) {
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
                            {MESES[mesAtual - 1]}/{anoAtual} — {aprovadas} de {unidadesCuca.length} unidades aprovadas
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    {/* Seletor de mês */}
                    <div className="flex items-center gap-1 border border-border rounded-lg px-1 py-1 bg-muted/30">
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navegarMes(-1)}>
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <span className="text-sm font-semibold text-foreground min-w-[80px] text-center">
                            {MESES[mesAtual - 1]}/{anoAtual}
                        </span>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navegarMes(1)}>
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                    <Button variant="outline" size="sm" onClick={fetchData}>
                        <RefreshCw className="h-4 w-4 mr-1.5" /> Atualizar
                    </Button>
                    <div className="flex flex-col items-end gap-0.5">
                        <Button
                            className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold gap-2 disabled:opacity-50"
                            onClick={abrirModal}
                            disabled={!podeDisparar}
                            title={motivoBloqueio}
                        >
                            <Megaphone className="h-4 w-4" />
                            Disparar Aviso Global
                        </Button>
                        {!podeDisparar && (
                            <p className="text-[10px] text-muted-foreground text-right">
                                {motivoBloqueio}
                            </p>
                        )}
                    </div>
                </div>
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
                        Cada Gerente deve subir a planilha e clicar em &quot;Aprovar Programação&quot; antes do disparo global.
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="divide-y divide-border/50">
                        {unidades.map(u => {
                            const cfg = STATUS_CONFIG[u.status]
                            return (
                                <div key={u.unidade} className="flex items-center justify-between px-6 py-3.5 hover:bg-muted/30 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                                        <span className="font-medium text-foreground text-sm">{u.unidade}</span>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        {u.total_atividades > 0 && (
                                            <span className="text-xs text-muted-foreground hidden sm:block">
                                                {u.total_atividades} atividades
                                            </span>
                                        )}
                                        {u.updated_at && (
                                            <span className="text-xs text-muted-foreground/60 hidden md:block">
                                                {format(new Date(u.updated_at), "dd/MM HH:mm", { locale: ptBR })}
                                            </span>
                                        )}
                                        <Badge className={`flex items-center gap-1.5 text-xs font-medium border ${cfg.color}`}>
                                            {cfg.icon}
                                            {cfg.label}
                                        </Badge>
                                    </div>
                                </div>
                            )
                        })}
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
