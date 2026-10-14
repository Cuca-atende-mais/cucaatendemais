"use client"

import { Suspense, useCallback, useEffect, useMemo, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import Link from "next/link"
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, Loader2, Lock, MessageSquareReply, RotateCcw, Save, Send } from "lucide-react"
import toast from "react-hot-toast"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/lib/auth/user-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EPM_FEEDBACK } from "@/lib/rbac/catalogo-empregabilidade-gestao"
import {
    STATUS_EDITAVEIS,
    ehStatusEditavel,
    origemCandidatura,
    rotuloStatusCandidatura,
    type StatusEditavel,
} from "@/lib/empregabilidade/status-candidatura"
import {
    candidatoEntraNaLista,
    contarPorVaga,
    rotuloVaga,
    textoConfirmacaoLote,
    vagaEntraNoSeletor,
} from "@/lib/empregabilidade/feedback-tela"
import { VALIDADE_LINK_HORAS, rotuloStatusEnvio, statusFeedback, type StatusFeedback } from "@/lib/empregabilidade/feedback-solicitacao"
import { diasSemResposta, podeReenviar, taxaRetorno, textoSelo } from "@/lib/empregabilidade/feedback-retorno"

// S-EMP-GES-01: tela Feedback — escolher empresa e vaga/seleção, ver os candidatos enviados (ou os
// inscritos, na seleção), mudar status um a um ou em lote e manter o contato da vaga. Tudo na página,
// sem janela por cima (D6). Leitura com o cliente do usuário (RLS); escrita só pelas rotas do servidor.

const ROTULO_STATUS_VAGA: Record<string, string> = {
    aberta: "Aberta",
    preenchida: "Preenchida",
    cancelada: "Cancelada",
    pre_cadastro: "Pré-cadastro",
}

const COR_STATUS: Record<string, string> = {
    pendente: "bg-slate-100 text-slate-700 border-slate-300",
    selecionado: "bg-blue-100 text-blue-800 border-blue-300",
    contratado: "bg-emerald-100 text-emerald-800 border-emerald-300",
    rejeitado: "bg-rose-100 text-rose-800 border-rose-300",
}

interface VagaOpcao {
    id: string
    numero_vaga: number | null
    titulo: string | null
    tipo: string | null
    status: string | null
    empresa_id: string | null
    empresaNome: string
}

interface VagaDetalhe {
    id: string
    tipo: string | null
    nome_responsavel: string | null
    telefone_responsavel: string | null
    email_responsavel: string | null
    empresas: { nome: string | null; telefone: string | null; email: string | null; contato_responsavel: string | null } | null
}

interface CandidatoLinha {
    id: string
    nome: string | null
    status: string
    created_at: string
    email_enviado_em: string | null
    observacoes: string | null
    confirmacao_presenca: string | null
}

interface ResultadoLote {
    atualizados: number
    total: number
    falhas: { candidaturaId: string; erro?: string }[]
}

interface Solicitacao {
    id: string
    created_at: string
    enviado_por: string | null
    candidatos: number
    status_envio: string
    erro_envio: string | null
    expires_at: string | null
    respondido_em: string | null
    situacao: string | null
    situacao_em: string | null
    conversa_id: string | null
}

interface PedidoEmpresa {
    status_envio: string
    expires_at: string | null
    respondido_em: string | null
    situacao: string | null
}

const COR_ENVIO: Record<string, string> = {
    pendente: "bg-slate-100 text-slate-700 border-slate-300",
    enviado: "bg-sky-100 text-sky-800 border-sky-300",
    entregue: "bg-blue-100 text-blue-800 border-blue-300",
    lido: "bg-emerald-100 text-emerald-800 border-emerald-300",
    falhou: "bg-rose-100 text-rose-800 border-rose-300",
    aviso: "bg-amber-100 text-amber-900 border-amber-300",
    apagada: "bg-slate-100 text-slate-700 border-slate-300",
}

const ROTULO_FEEDBACK: Record<StatusFeedback, string> = {
    aguardando: "Aguardando",
    expirado: "Expirado",
    respondido: "Respondido",
    nao_enviado: "Não enviado",
    em_analise: "Empresa sinalizou: em análise",
    substituida: "Substituída",
}

function rotuloFeedback(s: Solicitacao): string {
    const st = statusFeedback(s)
    if (st === "respondido" && s.respondido_em) return `Respondido em ${format(new Date(s.respondido_em), "dd/MM", { locale: ptBR })}`
    return ROTULO_FEEDBACK[st]
}

const PAGINA = 1000
const INTERVALO_ACOMPANHAMENTO_MS = 15_000

function dataHora(valor: string): string {
    try {
        return format(new Date(valor), "dd/MM/yyyy HH:mm", { locale: ptBR })
    } catch {
        return "—"
    }
}

function dataCurta(valor: string | null): string {
    if (!valor) return "—"
    try {
        return format(new Date(valor), "dd/MM/yyyy", { locale: ptBR })
    } catch {
        return "—"
    }
}

function rotuloPresenca(valor: string | null): string {
    if (valor === "confirmado") return "Confirmada"
    if (valor === "recusado") return "Recusada"
    return "—"
}

function FeedbackConteudo() {
    const supabase = useMemo(() => createClient(), [])
    const router = useRouter()
    const searchParams = useSearchParams()
    const { loading: carregandoUsuario, hasPermission } = useUser()

    const podeVer = hasPermission(EPM_FEEDBACK.ver, "read")
    const podeIndividual = hasPermission(EPM_FEEDBACK.statusIndividual, "read")
    const podeLote = hasPermission(EPM_FEEDBACK.statusLote, "read")
    const podeEditarContato = hasPermission(EPM_FEEDBACK.contatoEditar, "read")
    const podeSolicitar = hasPermission(EPM_FEEDBACK.solicitar, "read")
    const podeReenviarPedido = hasPermission(EPM_FEEDBACK.reenviar, "read")

    const [vagas, setVagas] = useState<VagaOpcao[]>([])
    const [carregandoVagas, setCarregandoVagas] = useState(true)
    const [empresaId, setEmpresaId] = useState<string>("")
    const [vagaId, setVagaId] = useState<string>(searchParams.get("vaga") ?? "")

    const [vaga, setVaga] = useState<VagaDetalhe | null>(null)
    const [candidatos, setCandidatos] = useState<CandidatoLinha[]>([])
    const [carregandoLista, setCarregandoLista] = useState(false)

    const [contato, setContato] = useState({ nome: "", telefone: "", email: "" })
    const [salvandoContato, setSalvandoContato] = useState(false)

    const [marcados, setMarcados] = useState<Set<string>>(new Set())
    const [statusLote, setStatusLote] = useState<StatusEditavel | "">("")
    const [confirmandoLote, setConfirmandoLote] = useState(false)
    const [aplicando, setAplicando] = useState(false)
    const [resultado, setResultado] = useState<ResultadoLote | null>(null)
    const [linhaSalvando, setLinhaSalvando] = useState<string | null>(null)

    const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([])
    const [confirmandoPedido, setConfirmandoPedido] = useState(false)
    const [enviandoPedido, setEnviandoPedido] = useState(false)
    const [erroPedido, setErroPedido] = useState<string | null>(null)
    const [reenviando, setReenviando] = useState<string | null>(null)
    const [pedidosEmpresa, setPedidosEmpresa] = useState<PedidoEmpresa[] | null>(null)

    // Seletor: vagas com currículo enviado e seleções com inscritos, de qualquer status (AC2 / D1).
    useEffect(() => {
        if (carregandoUsuario || !podeVer) return
        let cancelado = false
        const carregar = async () => {
            setCarregandoVagas(true)
            try {
                const linhas: { vaga_id: string | null; email_enviado_em: string | null }[] = []
                for (let inicio = 0; ; inicio += PAGINA) {
                    const { data, error } = await supabase
                        .from("candidaturas")
                        .select("vaga_id, email_enviado_em")
                        .order("id")
                        .range(inicio, inicio + PAGINA - 1)
                    if (error) throw error
                    linhas.push(...(data ?? []))
                    if (!data || data.length < PAGINA) break
                }
                const contagens = contarPorVaga(linhas)
                const ids = Array.from(contagens.keys())
                const opcoes: VagaOpcao[] = []
                for (let i = 0; i < ids.length; i += 200) {
                    const { data, error } = await supabase
                        .from("vagas")
                        .select("id, numero_vaga, titulo, tipo, status, empresa_id, empresas(nome, nome_fantasia)")
                        .in("id", ids.slice(i, i + 200))
                    if (error) throw error
                    for (const v of data ?? []) {
                        if (!vagaEntraNoSeletor(v.tipo, contagens.get(v.id))) continue
                        const emp = (Array.isArray(v.empresas) ? v.empresas[0] : v.empresas) as { nome: string | null; nome_fantasia: string | null } | null
                        opcoes.push({
                            id: v.id,
                            numero_vaga: v.numero_vaga,
                            titulo: v.titulo,
                            tipo: v.tipo,
                            status: v.status,
                            empresa_id: v.empresa_id,
                            empresaNome: emp?.nome_fantasia || emp?.nome || "Empresa sem nome",
                        })
                    }
                }
                if (cancelado) return
                opcoes.sort((a, b) => (b.numero_vaga ?? 0) - (a.numero_vaga ?? 0))
                setVagas(opcoes)
            } catch (err) {
                console.error("[feedback] Erro ao carregar vagas:", err)
                if (!cancelado) toast.error("Erro ao carregar as vagas.")
            } finally {
                if (!cancelado) setCarregandoVagas(false)
            }
        }
        carregar()
        return () => { cancelado = true }
    }, [carregandoUsuario, podeVer, supabase])

    const empresas = useMemo(() => {
        const mapa = new Map<string, string>()
        for (const v of vagas) if (v.empresa_id) mapa.set(v.empresa_id, v.empresaNome)
        return Array.from(mapa.entries()).sort((a, b) => a[1].localeCompare(b[1], "pt-BR"))
    }, [vagas])

    const vagasDaEmpresa = useMemo(() => vagas.filter(v => v.empresa_id === empresaId), [vagas, empresaId])

    // Taxa de retorno da empresa (GES-03, AC10). Leitura pela RLS de epm_feedback_ver.
    useEffect(() => {
        if (!empresaId || !podeVer) {
            setPedidosEmpresa(null)
            return
        }
        let cancelado = false
        supabase
            .from("feedback_solicitacoes")
            .select("status_envio, expires_at, respondido_em, situacao")
            .eq("empresa_id", empresaId)
            .then(({ data, error }) => {
                if (cancelado) return
                if (error) console.error("[feedback] Erro ao carregar a taxa de retorno:", error)
                else setPedidosEmpresa((data ?? []) as PedidoEmpresa[])
            })
        return () => { cancelado = true }
    }, [empresaId, podeVer, supabase, solicitacoes.length])

    // ?vaga=<id> abre já selecionado (AC2).
    useEffect(() => {
        if (!vagaId || empresaId) return
        const v = vagas.find(x => x.id === vagaId)
        if (v?.empresa_id) setEmpresaId(v.empresa_id)
    }, [vagas, vagaId, empresaId])

    const carregarVaga = useCallback(async (id: string) => {
        setCarregandoLista(true)
        setMarcados(new Set())
        setResultado(null)
        setConfirmandoLote(false)
        setConfirmandoPedido(false)
        setErroPedido(null)
        try {
            const [{ data: v, error: vErr }, { data: cands, error: cErr }] = await Promise.all([
                supabase
                    .from("vagas")
                    .select("id, tipo, nome_responsavel, telefone_responsavel, email_responsavel, empresas(nome, telefone, email, contato_responsavel)")
                    .eq("id", id)
                    .maybeSingle(),
                supabase
                    .from("candidaturas")
                    .select("id, nome, status, created_at, email_enviado_em, observacoes, confirmacao_presenca")
                    .eq("vaga_id", id)
                    .order("nome"),
            ])
            if (vErr) throw vErr
            if (cErr) throw cErr
            if (!v) {
                setVaga(null)
                setCandidatos([])
                return
            }
            const detalhe = { ...v, empresas: Array.isArray(v.empresas) ? v.empresas[0] ?? null : v.empresas } as VagaDetalhe
            setVaga(detalhe)
            setContato({
                nome: detalhe.nome_responsavel || detalhe.empresas?.contato_responsavel || "",
                telefone: detalhe.telefone_responsavel || detalhe.empresas?.telefone || "",
                email: detalhe.email_responsavel || detalhe.empresas?.email || "",
            })
            setCandidatos(((cands ?? []) as CandidatoLinha[]).filter(c => candidatoEntraNaLista(detalhe.tipo, c)))
        } catch (err) {
            console.error("[feedback] Erro ao carregar candidatos:", err)
            toast.error("Erro ao carregar os candidatos.")
        } finally {
            setCarregandoLista(false)
        }
    }, [supabase])

    useEffect(() => {
        if (vagaId && podeVer) carregarVaga(vagaId)
    }, [vagaId, podeVer, carregarVaga])

    // Acompanhamento dos pedidos (AC4): atualiza sozinho enquanto a vaga está aberta na tela.
    const carregarSolicitacoes = useCallback(async (id: string) => {
        try {
            const res = await fetch(`/api/empregabilidade/feedback/solicitacoes?vaga=${id}`)
            if (!res.ok) return
            const data = await res.json()
            setSolicitacoes((data.solicitacoes ?? []) as Solicitacao[])
        } catch (err) {
            console.error("[feedback] Erro ao carregar o acompanhamento:", err)
        }
    }, [])

    useEffect(() => {
        setSolicitacoes([])
        if (!vagaId || !podeVer) return
        carregarSolicitacoes(vagaId)
        const t = setInterval(() => carregarSolicitacoes(vagaId), INTERVALO_ACOMPANHAMENTO_MS)
        return () => clearInterval(t)
    }, [vagaId, podeVer, carregarSolicitacoes])

    const escolherEmpresa = (id: string) => {
        setEmpresaId(id)
        setVagaId("")
        setVaga(null)
        setCandidatos([])
        router.replace("/empregabilidade/feedback")
    }

    const escolherVaga = (id: string) => {
        setVagaId(id)
        router.replace(`/empregabilidade/feedback?vaga=${id}`)
    }

    const ehSelecao = vaga?.tipo === "selecao_evento"
    const marcaveis = candidatos.filter(c => ehStatusEditavel(c.status))
    const todosMarcados = marcaveis.length > 0 && marcaveis.every(c => marcados.has(c.id))

    const alternarTodos = () => {
        setMarcados(todosMarcados ? new Set() : new Set(marcaveis.map(c => c.id)))
        setConfirmandoLote(false)
        setConfirmandoPedido(false)
    }

    const alternar = (id: string) => {
        setMarcados(prev => {
            const novo = new Set(prev)
            if (novo.has(id)) novo.delete(id)
            else novo.add(id)
            return novo
        })
        setConfirmandoLote(false)
        setConfirmandoPedido(false)
    }

    const enviarStatus = async (ids: string[], status: StatusEditavel, modo: "individual" | "lote"): Promise<ResultadoLote | null> => {
        const res = await fetch("/api/empregabilidade/feedback/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ vaga_id: vagaId, candidatura_ids: ids, status, modo }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
            toast.error(data.error || "Erro ao mudar o status.")
            return null
        }
        return data as ResultadoLote
    }

    const mudarIndividual = async (id: string, status: StatusEditavel) => {
        setLinhaSalvando(id)
        try {
            const r = await enviarStatus([id], status, "individual")
            if (!r) return
            if (r.atualizados === 1) {
                toast.success(`Status alterado para ${rotuloStatusCandidatura(status)}.`)
            } else {
                toast.error(r.falhas[0]?.erro || "Não foi possível mudar o status.")
            }
            await carregarVaga(vagaId)
        } finally {
            setLinhaSalvando(null)
        }
    }

    const reenviar = async (solicitacaoId: string) => {
        setReenviando(solicitacaoId)
        setErroPedido(null)
        try {
            const res = await fetch(`/api/empregabilidade/feedback/solicitacoes/${solicitacaoId}/reenviar`, { method: "POST" })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                setErroPedido(data.error || "Não foi possível reenviar o pedido.")
                return
            }
            toast.success("Pedido reenviado à empresa.")
            if (data.aviso) toast.error(data.aviso)
        } catch {
            setErroPedido("Não foi possível reenviar o pedido.")
        } finally {
            setReenviando(null)
            carregarSolicitacoes(vagaId)
        }
    }

    const aplicarLote = async () => {
        if (!statusLote || marcados.size === 0) return
        setAplicando(true)
        try {
            const r = await enviarStatus(Array.from(marcados), statusLote, "lote")
            setConfirmandoLote(false)
            if (!r) return
            await carregarVaga(vagaId)
            // carregarVaga limpa o resultado; mostra o deste lote depois de recarregar.
            setResultado(r)
        } finally {
            setAplicando(false)
        }
    }

    // AC2/AC3: envia o pedido só com os marcados. Sucesso só quando a Meta aceitou; falha mostra o motivo.
    const solicitarFeedback = async () => {
        setEnviandoPedido(true)
        setErroPedido(null)
        try {
            const res = await fetch("/api/empregabilidade/feedback/solicitacoes", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ vaga_id: vagaId, candidatura_ids: Array.from(marcados) }),
            })
            const data = await res.json().catch(() => ({}))
            setConfirmandoPedido(false)
            if (!res.ok) {
                setErroPedido(data.error || "Não foi possível enviar o pedido.")
                return
            }
            toast.success("Pedido de feedback enviado à empresa.")
            if (data.aviso) toast.error(data.aviso)
            setMarcados(new Set())
        } catch {
            setErroPedido("Não foi possível enviar o pedido.")
        } finally {
            setEnviandoPedido(false)
            carregarSolicitacoes(vagaId)
        }
    }

    const salvarContato = async () => {
        setSalvandoContato(true)
        try {
            const res = await fetch("/api/empregabilidade/feedback/contato", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ vaga_id: vagaId, ...contato }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(data.error || "Erro ao salvar o contato.")
            toast.success("Contato da vaga salvo.")
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Erro ao salvar o contato.")
        } finally {
            setSalvandoContato(false)
        }
    }

    const telefonePedido = vaga?.telefone_responsavel || vaga?.empresas?.telefone || ""
    const diasSemRetorno = !ehSelecao ? diasSemResposta(solicitacoes[0]) : null
    const taxa = pedidosEmpresa ? taxaRetorno(pedidosEmpresa) : null

    const nomePorId = useMemo(() => new Map(candidatos.map(c => [c.id, c.nome || "Sem nome"])), [candidatos])

    if (carregandoUsuario) {
        return <Skeleton className="h-64 w-full" />
    }

    if (!podeVer) {
        return (
            <Card>
                <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
                    <Lock className="h-8 w-8 text-muted-foreground" />
                    <p className="font-medium">Você não tem acesso à tela Feedback.</p>
                    <p className="text-sm text-muted-foreground">Peça a liberação no seu perfil de acesso.</p>
                </CardContent>
            </Card>
        )
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                    <MessageSquareReply className="h-7 w-7 text-cuca-blue" />
                    Feedback das empresas
                </h1>
                <p className="text-muted-foreground mt-1">
                    Escolha a empresa e a vaga ou seleção para ver os candidatos enviados e registrar o resultado.
                </p>
            </div>

            <Card>
                <CardContent className="grid gap-4 pt-6 md:grid-cols-2">
                    <div className="grid gap-2 min-w-0">
                        <Label>Empresa</Label>
                        <Select value={empresaId} onValueChange={escolherEmpresa} disabled={carregandoVagas}>
                            <SelectTrigger>
                                <SelectValue placeholder={carregandoVagas ? "Carregando..." : "Selecione a empresa"} />
                            </SelectTrigger>
                            <SelectContent>
                                {empresas.map(([id, nome]) => (
                                    <SelectItem key={id} value={id}>{nome}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-2 min-w-0">
                        <Label>Vaga ou seleção</Label>
                        <Select value={vagaId} onValueChange={escolherVaga} disabled={!empresaId}>
                            <SelectTrigger>
                                <SelectValue placeholder="Selecione a vaga ou seleção" />
                            </SelectTrigger>
                            <SelectContent>
                                {vagasDaEmpresa.map(v => (
                                    <SelectItem key={v.id} value={v.id}>
                                        {rotuloVaga(v)} · {ROTULO_STATUS_VAGA[v.status ?? ""] ?? v.status}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    {empresaId && taxa && (
                        <p className="text-sm text-muted-foreground md:col-span-2">
                            {taxa.enviadas === 0
                                ? "Nenhum pedido de feedback enviado a esta empresa ainda."
                                : `Respondeu ${taxa.respondidas} de ${taxa.enviadas} ${taxa.enviadas === 1 ? "solicitação" : "solicitações"} (${taxa.percentual}%).`}
                        </p>
                    )}
                    {!carregandoVagas && empresas.length === 0 && (
                        <p className="text-sm text-muted-foreground md:col-span-2">
                            Nenhuma vaga com currículo enviado nem seleção com inscritos ao seu alcance.
                        </p>
                    )}
                </CardContent>
            </Card>

            {vagaId && vaga && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Contato da vaga</CardTitle>
                        <CardDescription>
                            Preenchido com o contato da vaga e, na falta, com o da empresa. Salvar grava na vaga.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-4 md:grid-cols-3">
                        <div className="grid gap-2 min-w-0">
                            <Label htmlFor="contato-nome">Nome</Label>
                            <Input id="contato-nome" value={contato.nome} disabled={!podeEditarContato}
                                onChange={e => setContato(c => ({ ...c, nome: e.target.value }))} />
                        </div>
                        <div className="grid gap-2 min-w-0">
                            <Label htmlFor="contato-telefone">Telefone</Label>
                            <Input id="contato-telefone" value={contato.telefone} disabled={!podeEditarContato} placeholder="(85) 99999-9999"
                                onChange={e => setContato(c => ({ ...c, telefone: e.target.value }))} />
                        </div>
                        <div className="grid gap-2 min-w-0">
                            <Label htmlFor="contato-email">E-mail</Label>
                            <Input id="contato-email" type="email" value={contato.email} disabled={!podeEditarContato}
                                onChange={e => setContato(c => ({ ...c, email: e.target.value }))} />
                        </div>
                        {podeEditarContato && (
                            <div className="md:col-span-3 flex justify-end">
                                <Button onClick={salvarContato} disabled={salvandoContato} className="gap-2">
                                    {salvandoContato ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                                    Salvar contato
                                </Button>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {vagaId && (
                <Card>
                    <CardHeader className="gap-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                                <CardTitle className="text-lg">{ehSelecao ? "Inscritos na seleção" : "Candidatos enviados à empresa"}</CardTitle>
                                <CardDescription className="flex flex-wrap items-center gap-2">
                                    {marcados.size} de {marcaveis.length} marcados
                                    {diasSemRetorno !== null && (
                                        <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-amber-900">
                                            <Clock className="h-3 w-3" /> {textoSelo(diasSemRetorno)}
                                        </Badge>
                                    )}
                                </CardDescription>
                            </div>
                            {ehSelecao ? (
                                <Button
                                    variant="outline"
                                    className="gap-2"
                                    disabled={marcados.size === 0}
                                    title="Disponível em breve"
                                    onClick={() => toast("O pedido de feedback da seleção chega na próxima etapa.")}
                                >
                                    <Send className="h-4 w-4" />
                                    Solicitar feedback dos marcados
                                </Button>
                            ) : podeSolicitar && (
                                <Button
                                    variant="outline"
                                    className="gap-2"
                                    disabled={marcados.size === 0 || enviandoPedido}
                                    onClick={() => { setConfirmandoPedido(true); setErroPedido(null) }}
                                >
                                    <Send className="h-4 w-4" />
                                    Solicitar feedback dos marcados
                                </Button>
                            )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                            <Button variant="outline" size="sm" onClick={alternarTodos} disabled={marcaveis.length === 0}>
                                {todosMarcados ? "Desmarcar todos" : "Marcar todos"}
                            </Button>
                            {podeLote && (<>
                                <span className="text-sm text-muted-foreground">Mudar status dos marcados para</span>
                                <Select value={statusLote} onValueChange={v => { setStatusLote(v as StatusEditavel); setConfirmandoLote(false) }}>
                                    <SelectTrigger className="w-44"><SelectValue placeholder="Escolha o status" /></SelectTrigger>
                                    <SelectContent>
                                        {STATUS_EDITAVEIS.map(s => <SelectItem key={s} value={s}>{rotuloStatusCandidatura(s)}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                                <Button size="sm" disabled={!statusLote || marcados.size === 0 || aplicando} onClick={() => setConfirmandoLote(true)}>
                                    Aplicar
                                </Button>
                            </>)}
                        </div>

                        {confirmandoPedido && marcados.size > 0 && (
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-sky-300 bg-sky-50 p-3 text-sky-900">
                                <span className="flex items-center gap-2 font-medium">
                                    <Send className="h-4 w-4" />
                                    {telefonePedido
                                        ? `Enviar à empresa, pelo WhatsApp ${telefonePedido}, o link para avaliar ${marcados.size} ${marcados.size === 1 ? "candidato" : "candidatos"}? O link vale ${VALIDADE_LINK_HORAS}h.`
                                        : "A vaga não tem telefone de contato salvo. Salve o contato antes de enviar."}
                                </span>
                                <div className="flex gap-2">
                                    <Button variant="outline" size="sm" onClick={() => setConfirmandoPedido(false)} disabled={enviandoPedido}>Cancelar</Button>
                                    <Button size="sm" onClick={solicitarFeedback} disabled={enviandoPedido || !telefonePedido} className="gap-2">
                                        {enviandoPedido && <Loader2 className="h-4 w-4 animate-spin" />}
                                        Enviar
                                    </Button>
                                </div>
                            </div>
                        )}

                        {erroPedido && (
                            <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
                                <p className="flex items-center gap-2 font-medium">
                                    <AlertTriangle className="h-4 w-4" />
                                    Pedido não enviado: {erroPedido}
                                </p>
                            </div>
                        )}

                        {confirmandoLote && statusLote && (
                            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-amber-900">
                                <span className="flex items-center gap-2 font-medium">
                                    <AlertTriangle className="h-4 w-4" />
                                    {textoConfirmacaoLote(marcados.size, statusLote)}
                                    {statusLote === "rejeitado" && " Quem não estiver em outro processo volta ao Banco de Talentos."}
                                </span>
                                <div className="flex gap-2">
                                    <Button variant="outline" size="sm" onClick={() => setConfirmandoLote(false)} disabled={aplicando}>Cancelar</Button>
                                    <Button size="sm" onClick={aplicarLote} disabled={aplicando} className="gap-2">
                                        {aplicando && <Loader2 className="h-4 w-4 animate-spin" />}
                                        Confirmar
                                    </Button>
                                </div>
                            </div>
                        )}

                        {resultado && (
                            <div className={`rounded-md border p-3 text-sm ${resultado.falhas.length ? "border-rose-300 bg-rose-50 text-rose-900" : "border-emerald-300 bg-emerald-50 text-emerald-900"}`}>
                                <p className="flex items-center gap-2 font-medium">
                                    {resultado.falhas.length ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                                    {resultado.atualizados} de {resultado.total} atualizados.
                                    {resultado.falhas.length > 0 && ` ${resultado.falhas.length} não foram alterados:`}
                                </p>
                                {resultado.falhas.length > 0 && (
                                    <ul className="mt-2 list-disc pl-6">
                                        {resultado.falhas.map(f => (
                                            <li key={f.candidaturaId}>{nomePorId.get(f.candidaturaId) ?? f.candidaturaId}: {f.erro}</li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                        )}
                    </CardHeader>
                    <CardContent>
                        {carregandoLista ? (
                            <Skeleton className="h-40 w-full" />
                        ) : candidatos.length === 0 ? (
                            <p className="py-8 text-center text-sm text-muted-foreground">Nenhum candidato para mostrar.</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-10" />
                                            <TableHead>Nome</TableHead>
                                            <TableHead>Candidatura</TableHead>
                                            <TableHead>{ehSelecao ? "Presença" : "Enviado em"}</TableHead>
                                            <TableHead>Origem</TableHead>
                                            <TableHead className="w-48">Status</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {candidatos.map(c => {
                                            const editavel = ehStatusEditavel(c.status)
                                            return (
                                                <TableRow key={c.id}>
                                                    <TableCell>
                                                        <Checkbox
                                                            checked={marcados.has(c.id)}
                                                            disabled={!editavel}
                                                            onCheckedChange={() => alternar(c.id)}
                                                            aria-label={`Marcar ${c.nome ?? "candidato"}`}
                                                        />
                                                    </TableCell>
                                                    <TableCell className="font-medium max-w-[16rem] truncate">{c.nome || "Sem nome"}</TableCell>
                                                    <TableCell>{dataCurta(c.created_at)}</TableCell>
                                                    <TableCell>{ehSelecao ? rotuloPresenca(c.confirmacao_presenca) : dataCurta(c.email_enviado_em)}</TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline">
                                                            {origemCandidatura(c.observacoes) === "banco_talentos" ? "Banco de Talentos" : "Candidatura direta"}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell>
                                                        {editavel && podeIndividual ? (
                                                            <Select
                                                                value={c.status}
                                                                disabled={linhaSalvando === c.id}
                                                                onValueChange={v => { if (v !== c.status) mudarIndividual(c.id, v as StatusEditavel) }}
                                                            >
                                                                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                                                                <SelectContent>
                                                                    {STATUS_EDITAVEIS.map(s => <SelectItem key={s} value={s}>{rotuloStatusCandidatura(s)}</SelectItem>)}
                                                                </SelectContent>
                                                            </Select>
                                                        ) : (
                                                            <Badge variant="outline" className={COR_STATUS[c.status] ?? ""}>
                                                                {rotuloStatusCandidatura(c.status)}
                                                            </Badge>
                                                        )}
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {vagaId && !ehSelecao && solicitacoes.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Acompanhamento dos pedidos</CardTitle>
                        <CardDescription>
                            {solicitacoes.length} {solicitacoes.length === 1 ? "pedido" : "pedidos"} ·{" "}
                            {solicitacoes.filter(s => s.status_envio === "lido").length} lidos ·{" "}
                            {solicitacoes.filter(s => s.status_envio === "falhou").length} com falha. Atualiza sozinho.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Enviado em</TableHead>
                                        <TableHead>Por</TableHead>
                                        <TableHead>Candidatos</TableHead>
                                        <TableHead>Mensagem</TableHead>
                                        <TableHead>Feedback</TableHead>
                                        <TableHead />
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {solicitacoes.map(s => (
                                        <TableRow key={s.id}>
                                            <TableCell className="whitespace-nowrap">{dataHora(s.created_at)}</TableCell>
                                            <TableCell className="max-w-[12rem] truncate">{s.enviado_por || "—"}</TableCell>
                                            <TableCell>{s.candidatos}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className={COR_ENVIO[s.status_envio] ?? ""}>
                                                    {rotuloStatusEnvio(s.status_envio, s.erro_envio)}
                                                </Badge>
                                            </TableCell>
                                            <TableCell>{rotuloFeedback(s)}</TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex items-center justify-end gap-3">
                                                {podeReenviarPedido && podeReenviar(s) && (
                                                    <Button variant="outline" size="sm" className="h-7 gap-1" disabled={reenviando !== null}
                                                        onClick={() => reenviar(s.id)}>
                                                        {reenviando === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                                                        Reenviar
                                                    </Button>
                                                )}
                                                {s.conversa_id && (
                                                    <Link href={`/empregabilidade/mensagens?conversa=${s.conversa_id}`}
                                                        className="inline-flex items-center gap-1 text-sm text-cuca-blue hover:underline whitespace-nowrap">
                                                        Abrir no Atendimento <ExternalLink className="h-3.5 w-3.5" />
                                                    </Link>
                                                )}
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}

// useSearchParams exige boundary de Suspense no build estático.
export default function FeedbackPage() {
    return (
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <FeedbackConteudo />
        </Suspense>
    )
}
