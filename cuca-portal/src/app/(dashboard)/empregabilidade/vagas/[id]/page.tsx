"use client"

import { useState, useEffect, useMemo } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Vaga, Candidatura, EmpregabilidadeFollowup } from "@/lib/types/database"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
    ArrowLeft, FileText, Loader2, Plus, MessageSquare, Send,
    Building2, User, Info, Briefcase, GraduationCap, Clock,
    Phone, Calendar, Sparkles, Users, Database, RefreshCw,
    ChevronRight, AlertCircle, MapPin, Mail, LayoutGrid, Columns
} from "lucide-react"
import toast from "react-hot-toast"
import { differenceInYears, format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { mascaraTelefone, limparTelefone } from "@/lib/utils"
import { NIVEIS_ESCOLARIDADE } from "@/constants/empregabilidade"
import { useUser } from "@/lib/auth/user-provider"

function formatarExperiencia(meses: number | null | undefined): string {
    if (!meses || meses === 0) return "Sem experiência informada"
    if (meses < 12) return `${meses} ${meses === 1 ? "mês" : "meses"}`
    const anos = Math.floor(meses / 12)
    const resto = meses % 12
    if (resto === 0) return `${anos} ${anos === 1 ? "ano" : "anos"}`
    return `${anos} ${anos === 1 ? "ano" : "anos"} e ${resto} ${resto === 1 ? "mês" : "meses"}`
}

function ScoreCircle({ score }: { score: number | null | undefined }) {
    const s = score ?? 0
    const color = s >= 70 ? "text-green-400 border-green-500/40 bg-green-500/10"
        : s >= 50 ? "text-amber-400 border-amber-500/40 bg-amber-500/10"
            : "text-red-400 border-red-500/40 bg-red-500/10"
    return (
        <div className={`w-12 h-12 rounded-full border-2 flex flex-col items-center justify-center flex-shrink-0 ${color}`}>
            <span className="text-sm font-bold leading-none">{s}</span>
            <span className="text-[9px] leading-none mt-0.5 opacity-70">match</span>
        </div>
    )
}

function StatusBadge({ status }: { status: string }) {
    const map: Record<string, string> = {
        pendente: "bg-amber-500/15 text-amber-400 border-amber-500/30",
        selecionado: "bg-blue-500/15 text-blue-400 border-blue-500/30",
        contratado: "bg-green-500/15 text-green-400 border-green-500/30",
        rejeitado: "bg-red-500/15 text-red-400 border-red-500/30",
        aprovado_empresa: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
        convite_enviado: "bg-purple-500/15 text-purple-400 border-purple-500/30",
        entrevista_confirmada: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
        entrevista_recusada: "bg-rose-500/15 text-rose-400 border-rose-500/30",
        duvida: "bg-orange-500/15 text-orange-400 border-orange-500/30",
    }
    const labels: Record<string, string> = {
        pendente: "Pendente",
        selecionado: "Selecionado",
        contratado: "Contratado",
        rejeitado: "Rejeitado",
        aprovado_empresa: "Aprovado p/ Empresa",
        convite_enviado: "Convite Enviado",
        entrevista_confirmada: "Confirmada",
        entrevista_recusada: "Recusada",
        duvida: "Dúvida",
    }
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${map[status] || "bg-muted text-muted-foreground border-border"}`}>
            {labels[status] || status}
        </span>
    )
}

type TalentBankCandidate = {
    id: string
    nome: string
    telefone: string | null
    data_nascimento: string | null
    arquivo_cv_url: string | null
    skills_jsonb: any
    match_score?: number
    primeiro_emprego?: boolean
}

export default function VagaDetalhesPage() {
    const params = useParams()
    const router = useRouter()
    const searchParams = useSearchParams()
    const id = params.id as string
    const supabase = createClient()

    const { profile } = useUser()
    const [vaga, setVaga] = useState<Vaga | null>(null)
    const [candidatos, setCandidatos] = useState<Candidatura[]>([])
    const [loading, setLoading] = useState(true)
    const [filtroStatus, setFiltroStatus] = useState("todos")
    const [viewMode, setViewMode] = useState<"grid" | "kanban">("grid")

    // Banco de Talentos — resultados persistidos em localStorage para sobreviver à navegação
    const storageKey = `talent_triagem_${id}`
    const [talentResults, setTalentResultsRaw] = useState<TalentBankCandidate[]>(() => {
        if (typeof window === "undefined") return []
        try {
            const saved = localStorage.getItem(`talent_triagem_${id}`)
            return saved ? JSON.parse(saved) : []
        } catch { return [] }
    })
    const [loadingTalent, setLoadingTalent] = useState(false)
    const [talentTriado, setTalentTriado] = useState(() => {
        if (typeof window === "undefined") return false
        try { return !!localStorage.getItem(`talent_triagem_${id}`) } catch { return false }
    })
    const [dialogTalent, setDialogTalent] = useState(false)
    const [quantidadeAnalise, setQuantidadeAnalise] = useState("5")
    // S37B-04: filtros demográficos para triagem de banco de talentos
    const [filtroTriagemEscolaridade, setFiltroTriagemEscolaridade] = useState("")
    const [filtroTriagemGenero, setFiltroTriagemGenero] = useState("")
    const [filtroTriagemPCD, setFiltroTriagemPCD] = useState<"" | "true" | "false">("")
    const [filtroTriagemPrimeiroEmprego, setFiltroTriagemPrimeiroEmprego] = useState<"" | "true" | "false">("")

    const setTalentResults = (updater: TalentBankCandidate[] | ((prev: TalentBankCandidate[]) => TalentBankCandidate[])) => {
        setTalentResultsRaw(prev => {
            const next = typeof updater === "function" ? updater(prev) : updater
            try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch {}
            return next
        })
    }

    // TB: lista filtrada — sem inscritos e sem duplicatas por telefone
    const talentVisiveis = useMemo(() => {
        const norm = (tel: string) => tel.replace(/\D/g, "")
        const fonesCandidatos = new Set(
            candidatos.filter(c => c.status !== "rejeitado").map(c => norm(c.telefone || "")).filter(Boolean)
        )
        const seenFones = new Set<string>()
        return talentResults.filter(tb => {
            const foneNorm = norm(tb.telefone || "")
            if (foneNorm && fonesCandidatos.has(foneNorm)) return false
            if (foneNorm) {
                if (seenFones.has(foneNorm)) return false
                seenFones.add(foneNorm)
            }
            return true
        })
    }, [talentResults, candidatos])

    // Follow-up Sheet
    const [followupSheet, setFollowupSheet] = useState<Candidatura | null>(null)
    const [followups, setFollowups] = useState<EmpregabilidadeFollowup[]>([])
    const [loadingFollowup, setLoadingFollowup] = useState(false)
    const [novoFollowup, setNovoFollowup] = useState({ tipo: "interno" as const, mensagem: "" })
    const [enviandoFollowup, setEnviandoFollowup] = useState(false)

    // Inscrição manual
    const [modalInscricao, setModalInscricao] = useState(false)
    const [inscricaoForm, setInscricaoForm] = useState({ nome: "", telefone: "", data_nascimento: "" })
    const [criandoInscricao, setCriandoInscricao] = useState(false)

    // Convocação SQS-40
    const [summonModalOpen, setSummonModalOpen] = useState(false)
    const [summonIsLote, setSummonIsLote] = useState(false)
    const [selectedCand, setSelectedCand] = useState<Candidatura | null>(null)
    const [summonForm, setSummonForm] = useState({
        data: "",
        hora: "",
        local: "",
        tipo: "presencial"
    })
    const [summoning, setSummoning] = useState(false)
    const [solicitandoFeedback, setSolicitandoFeedback] = useState(false)

    const refreshParam = searchParams.get("t")
    useEffect(() => { if (id) fetchData() }, [id, refreshParam])

    const fetchData = async () => {
        setLoading(true)
        try {
            const [{ data: vData, error: vErr }, { data: cData, error: cErr }] = await Promise.all([
                supabase.from("vagas").select("*, empresas(nome, nome_fantasia)").eq("id", id).single(),
                supabase.from("candidaturas").select("*").eq("vaga_id", id).order("created_at", { ascending: false }),
            ])
            if (vErr) throw vErr
            if (cErr) throw cErr
            setVaga(vData)
            setCandidatos(cData || [])
        } catch (error) {
            toast.error("Erro ao carregar vaga")
        } finally {
            setLoading(false)
        }
    }

    const calcularIdade = (dataStr: string | null) => {
        if (!dataStr) return null
        return differenceInYears(new Date(), new Date(dataStr))
    }

    // Slots disponíveis = currículos que a empresa quer receber - candidatos já inscritos (não rejeitados)
    const inscritos = candidatos.filter(c => c.status !== "rejeitado").length
    const limiteCurriculos = vaga?.limite_curriculos ?? 0
    const slotsDisponiveis = Math.max(0, limiteCurriculos - inscritos)

    const abrirDialogTalent = () => {
        const sugestao = Math.min(5, slotsDisponiveis || 5)
        setQuantidadeAnalise(String(sugestao))
        setDialogTalent(true)
    }

    const analisarBancoTalentos = async (qtd: number) => {
        setDialogTalent(false)
        setLoadingTalent(true)
        try {
            // Envia IDs já exibidos para o servidor excluir da próxima varredura
            const excluirIds = talentResults.map((c: TalentBankCandidate) => c.id)
            const filtrosDemograficos = {
                escolaridade: filtroTriagemEscolaridade || undefined,
                genero: filtroTriagemGenero || undefined,
                pcd: filtroTriagemPCD !== "" ? filtroTriagemPCD === "true" : undefined,
                primeiro_emprego: filtroTriagemPrimeiroEmprego !== "" ? filtroTriagemPrimeiroEmprego === "true" : undefined,
            }
            const res = await fetch(`/api/empregabilidade/vagas/${id}/triar-banco-talentos`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ quantidade: qtd, excluir_ids: excluirIds, filtros: filtrosDemograficos }),
            })
            const text = await res.text()
            let data: any
            try { data = JSON.parse(text) } catch {
                throw new Error("Resposta inválida do servidor. Pode ser timeout — tente com menos currículos.")
            }
            if (!res.ok) throw new Error(data.error || "Erro ao triar banco de talentos")
            const novos = data.candidatos || []
            // Acumula com resultados anteriores (para "Analisar mais")
            // Deduplicar por ID e por telefone (candidato pode ter dois registros no TB)
            setTalentResults(prev => {
                const existingIds = new Set(prev.map((c: TalentBankCandidate) => c.id))
                const existingFones = new Set(prev.map((c: TalentBankCandidate) => c.telefone).filter(Boolean))
                const unique = novos.filter((c: TalentBankCandidate) =>
                    !existingIds.has(c.id) && (!c.telefone || !existingFones.has(c.telefone))
                )
                return [...prev, ...unique]
            })
            setTalentTriado(true)
            if (novos.length === 0) {
                toast("Nenhum candidato compatível encontrado neste lote.", { icon: "ℹ️" })
            } else {
                toast.success(`${novos.length} candidato(s) analisados e adicionados!`)
            }
        } catch (err: any) {
            toast.error(err.message || "Falha ao analisar banco de talentos")
        } finally {
            setLoadingTalent(false)
        }
    }

    const abrirFollowup = async (candidatura: Candidatura) => {
        setFollowupSheet(candidatura)
        setLoadingFollowup(true)
        const { data, error } = await supabase
            .from("empregabilidade_followup")
            .select("*")
            .eq("candidatura_id", candidatura.id)
            .order("created_at", { ascending: true })
        if (!error) setFollowups(data || [])
        setLoadingFollowup(false)
    }

    const adicionarFollowup = async () => {
        if (!followupSheet || !novoFollowup.mensagem.trim()) return
        setEnviandoFollowup(true)
        try {
            const { error } = await supabase.from("empregabilidade_followup").insert({
                candidatura_id: followupSheet.id,
                tipo: novoFollowup.tipo,
                mensagem: novoFollowup.mensagem.trim(),
                status: "enviado",
            })
            if (error) throw error
            setNovoFollowup({ tipo: "interno", mensagem: "" })
            const { data } = await supabase
                .from("empregabilidade_followup")
                .select("*")
                .eq("candidatura_id", followupSheet.id)
                .order("created_at", { ascending: true })
            setFollowups(data || [])
            toast.success("Registro adicionado")
        } catch (err: any) {
            toast.error("Erro: " + err.message)
        } finally {
            setEnviandoFollowup(false)
        }
    }

    const criarInscricaoManual = async () => {
        if (!inscricaoForm.nome.trim() || !inscricaoForm.telefone.trim()) {
            toast.error("Nome e telefone são obrigatórios")
            return
        }
        setCriandoInscricao(true)
        try {
            const { error } = await supabase.from("candidaturas").insert({
                vaga_id: id,
                nome: inscricaoForm.nome.trim(),
                telefone: inscricaoForm.telefone.trim(),
                data_nascimento: inscricaoForm.data_nascimento || null,
                status: "pendente",
                requisitos_atendidos: "Inscrito manualmente por colaborador CUCA",
            })
            if (error) throw error
            toast.success("Candidato inscrito com sucesso")
            setModalInscricao(false)
            setInscricaoForm({ nome: "", telefone: "", data_nascimento: "" })
            fetchData()
        } catch (err: any) {
            toast.error("Erro: " + err.message)
        } finally {
            setCriandoInscricao(false)
        }
    }

    const abrirSummon = (cand: Candidatura) => {
        setSummonIsLote(false)
        setSelectedCand(cand)
        setSummonForm({
            data: cand.data_entrevista || "",
            hora: cand.hora_entrevista || "",
            local: cand.local_entrevista || (vaga as any)?.endereco_entrevista || "",
            tipo: (vaga as any)?.tipo_local_entrevista || "presencial"
        })
        setSummonModalOpen(true)
    }

    const abrirSummonLote = () => {
        setSummonIsLote(true)
        setSelectedCand(null)
        setSummonForm({
            data: "",
            hora: "",
            local: (vaga as any)?.endereco_entrevista || "",
            tipo: (vaga as any)?.tipo_local_entrevista || "presencial"
        })
        setSummonModalOpen(true)
    }

    const handleSummon = async () => {
        if (!summonForm.data || !summonForm.hora || !summonForm.local) {
            toast.error("Preencha todos os campos da convocação")
            return
        }

        setSummoning(true)
        try {
            if (summonIsLote) {
                const aprovados = candidatos.filter(c => c.status === "aprovado_empresa" || c.status === "selecionado")
                let ok = 0
                for (const cand of aprovados) {
                    const res = await fetch("/api/empregabilidade/vagas/convocar", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            candidatura_id: cand.id,
                            data_entrevista: summonForm.data,
                            hora_entrevista: summonForm.hora,
                            local_entrevista: summonForm.local,
                            tipo_local: summonForm.tipo
                        })
                    })
                    if (res.ok) ok++
                }
                toast.success(`${ok} convite(s) enviado(s) em lote!`)
            } else {
                if (!selectedCand) return
                const res = await fetch("/api/empregabilidade/vagas/convocar", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        candidatura_id: selectedCand.id,
                        data_entrevista: summonForm.data,
                        hora_entrevista: summonForm.hora,
                        local_entrevista: summonForm.local,
                        tipo_local: summonForm.tipo
                    })
                })
                const data = await res.json()
                if (!res.ok) throw new Error(data.error || "Erro ao convocar candidato")
                toast.success(`Convite enviado para ${selectedCand.nome}!`)
            }
            setSummonModalOpen(false)
            fetchData()
        } catch (err: any) {
            toast.error(err.message)
        } finally {
            setSummoning(false)
        }
    }

    const solicitarFeedbackEmpresa = async () => {
        if (!id) return
        setSolicitandoFeedback(true)
        try {
            const res = await fetch(`/api/empregabilidade/vagas/${id}/solicitar-feedback`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ cuca_unit_id: profile?.unidade_cuca || null }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Erro ao solicitar feedback")
            
            toast.success("Solicitação de feedback enviada para a empresa via WhatsApp!")
        } catch (err: any) {
            toast.error(err.message)
        } finally {
            setSolicitandoFeedback(false)
        }
    }

    const tipoFollowupLabel = (tipo: string) => {
        if (tipo === "empresa") return { label: "Empresa", color: "bg-blue-500/15 text-blue-400", icon: Building2 }
        if (tipo === "candidato") return { label: "Candidato", color: "bg-green-500/15 text-green-400", icon: User }
        return { label: "Interno", color: "bg-muted text-muted-foreground", icon: Info }
    }

    const candidatosFiltrados = filtroStatus === "todos"
        ? candidatos.filter(c => c.status !== "rejeitado")
        : candidatos.filter(c => c.status === filtroStatus)

    const contadores = {
        todos: candidatos.length,
        pendente: candidatos.filter(c => c.status === "pendente").length,
        selecionado: candidatos.filter(c => c.status === "selecionado").length,
        contratado: candidatos.filter(c => c.status === "contratado").length,
        rejeitado: candidatos.filter(c => c.status === "rejeitado").length,
        aprovado_empresa: candidatos.filter(c => c.status === "aprovado_empresa").length,
        convite_enviado: candidatos.filter(c => c.status === "convite_enviado").length,
        entrevista_confirmada: candidatos.filter(c => c.status === "entrevista_confirmada").length,
    }

    const empresaNome = (vaga as any)?.empresas?.nome_fantasia || (vaga as any)?.empresas?.nome || null

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="space-y-6 pb-10">

            {/* ── Navegação ── */}
            <div className="flex items-center gap-3">
                <Button variant="outline" size="icon" onClick={() => router.push("/empregabilidade/vagas")}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <p className="text-xs text-muted-foreground">Empregabilidade / Vagas</p>
                    <h1 className="text-xl font-bold leading-tight">{vaga?.titulo}</h1>
                </div>
            </div>

            {/* ── Cabeçalho da Vaga ── */}
            <Card className="border-none shadow-sm">
                <CardContent className="p-5 space-y-4">
                    {/* Linha 1: título, status, número */}
                    <div className="flex flex-wrap items-start gap-3 justify-between">
                        <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                                <StatusBadge status={vaga?.status || ""} />
                                {vaga?.numero_vaga && (
                                    <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded">
                                        Vaga #{vaga.numero_vaga}
                                    </span>
                                )}
                                {vaga?.expansiva && (
                                    <Badge variant="outline" className="text-xs">Global</Badge>
                                )}
                                <Button 
                                    size="sm" 
                                    variant="outline" 
                                    className="ml-2 border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10 h-7 text-[10px]"
                                    onClick={solicitarFeedbackEmpresa}
                                    disabled={solicitandoFeedback}
                                >
                                    {solicitandoFeedback ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <MessageSquare className="h-3 w-3 mr-1" />}
                                    Solicitar Feedback da Empresa
                                </Button>
                            </div>
                            {empresaNome && (
                                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                    <Building2 className="h-3.5 w-3.5" />
                                    <span>{empresaNome}</span>
                                </div>
                            )}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Users className="h-4 w-4" />
                            <span>{candidatos.filter(c => c.status === "contratado").length} / {vaga?.total_vagas} posições preenchidas</span>
                        </div>
                    </div>

                    {/* Linha 2: detalhes em grid */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                        {vaga?.tipo_contrato && (
                            <div className="flex items-center gap-2 text-sm">
                                <Briefcase className="h-3.5 w-3.5 text-cuca-blue flex-shrink-0" />
                                <span>{vaga.tipo_contrato}</span>
                            </div>
                        )}
                        {vaga?.salario && (
                            <div className="flex items-center gap-2 text-sm">
                                <span className="text-cuca-blue font-medium flex-shrink-0">R$</span>
                                <span>{vaga.salario}</span>
                            </div>
                        )}
                        {vaga?.escolaridade_minima && (
                            <div className="flex items-center gap-2 text-sm">
                                <GraduationCap className="h-3.5 w-3.5 text-cuca-blue flex-shrink-0" />
                                <span>{vaga.escolaridade_minima}</span>
                            </div>
                        )}
                        {vaga?.carga_horaria && (
                            <div className="flex items-center gap-2 text-sm">
                                <Clock className="h-3.5 w-3.5 text-cuca-blue flex-shrink-0" />
                                <span>{vaga.carga_horaria}</span>
                            </div>
                        )}
                        {vaga?.local && (
                            <div className="flex items-center gap-2 text-sm">
                                <MapPin className="h-3.5 w-3.5 text-cuca-blue flex-shrink-0" />
                                <span>{vaga.local}</span>
                            </div>
                        )}
                        {vaga?.unidade_cuca && (
                            <div className="flex items-center gap-2 text-sm">
                                <Info className="h-3.5 w-3.5 text-cuca-blue flex-shrink-0" />
                                <span>CUCA {vaga.unidade_cuca}</span>
                            </div>
                        )}
                        {vaga?.email_contato_empresa && (
                            <div className="flex items-center gap-2 text-sm col-span-2">
                                <Mail className="h-3.5 w-3.5 text-cuca-blue flex-shrink-0" />
                                <span className="truncate">{vaga.email_contato_empresa}</span>
                            </div>
                        )}
                        {vaga?.limite_curriculos && (
                            <div className="flex items-center gap-2 text-sm">
                                <FileText className="h-3.5 w-3.5 text-cuca-blue flex-shrink-0" />
                                <span className={candidatos.length >= vaga.limite_curriculos ? "text-red-400 font-medium" : ""}>
                                    {candidatos.length} / {vaga.limite_curriculos} currículos
                                </span>
                            </div>
                        )}
                        {vaga?.tipo_selecao && (
                            <div className="flex items-center gap-2 text-sm">
                                <Users className="h-3.5 w-3.5 text-cuca-blue flex-shrink-0" />
                                <span>
                                    {vaga.tipo_selecao === "coleta_curriculo" && "Coleta de Currículo"}
                                    {vaga.tipo_selecao === "entrevista_unidade" && "Entrevista na Unidade"}
                                    {vaga.tipo_selecao === "triagem_cuca" && "Triagem CUCA"}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Benefícios */}
                    {vaga?.beneficios && (
                        <div className="flex flex-wrap gap-1.5 pt-1 border-t">
                            {vaga.beneficios.split(", ").map((b: string) => (
                                <Badge key={b} variant="secondary" className="text-xs">{b}</Badge>
                            ))}
                        </div>
                    )}

                    {/* Descrição completa */}
                    {vaga?.descricao && (
                        <div className="pt-1 border-t space-y-3">
                            <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{vaga.descricao}</p>
                            {vaga?.requisitos && (
                                <div>
                                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Requisitos</p>
                                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{vaga.requisitos}</p>
                                </div>
                            )}
                            {(vaga as any)?.faixa_etaria && (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <span className="font-medium">Faixa etária:</span>
                                    <span>{(vaga as any).faixa_etaria}</span>
                                </div>
                            )}
                            {(vaga as any)?.local_entrevista && (
                                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                    <span className="font-medium">Local da entrevista:</span>
                                    <span>
                                        {(vaga as any).local_entrevista === "na_empresa" && "Na empresa contratante"}
                                        {(vaga as any).local_entrevista === "no_cuca" && "No CUCA"}
                                        {(vaga as any).local_entrevista === "online" && "Online"}
                                    </span>
                                </div>
                            )}
                            {(vaga as any)?.setor && (vaga as any).setor.length > 0 && (
                                <div>
                                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">Área da vaga</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {((vaga as any).setor as string[]).map((s: string) => (
                                            <Badge key={s} className="text-xs bg-cuca-blue/15 text-cuca-blue border-cuca-blue/30">{s}</Badge>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* ── Seção: Candidatos Inscritos ── */}
            <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-cuca-blue" />
                        <h2 className="text-lg font-semibold">Candidatos Inscritos</h2>
                        <Badge variant="outline">{candidatos.length}</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                        {(contadores.aprovado_empresa + contadores.selecionado) > 0 && (
                            <Button
                                size="sm"
                                className="bg-indigo-600 hover:bg-indigo-700 text-white gap-1.5"
                                onClick={abrirSummonLote}
                            >
                                <Send className="h-3.5 w-3.5" />
                                Convocar em Lote ({contadores.aprovado_empresa + contadores.selecionado})
                            </Button>
                        )}
                        <Button size="sm" variant="outline" onClick={() => setModalInscricao(true)}>
                            <Plus className="mr-1.5 h-4 w-4" />
                            Inscrever Manualmente
                        </Button>
                        <div className="flex items-center gap-1 bg-muted p-1 rounded-lg">
                            <Button
                                variant={viewMode === "grid" ? "secondary" : "ghost"}
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => setViewMode("grid")}
                                title="Grade"
                            >
                                <LayoutGrid className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                                variant={viewMode === "kanban" ? "secondary" : "ghost"}
                                size="sm"
                                className="h-7 w-7 p-0"
                                onClick={() => setViewMode("kanban")}
                                title="Kanban"
                            >
                                <Columns className="h-3.5 w-3.5" />
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Filtros por status — só no modo grid */}
                {viewMode === "grid" && (
                <div className="flex flex-wrap gap-2">
                    {(["todos", "pendente", "aprovado_empresa", "convite_enviado", "entrevista_confirmada", "selecionado", "contratado", "rejeitado"] as const).map(s => (
                        <button
                            key={s}
                            onClick={() => setFiltroStatus(s)}
                            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${filtroStatus === s
                                ? "bg-cuca-blue text-white border-cuca-blue"
                                : "border-border text-muted-foreground hover:border-cuca-blue/50"}`}
                        >
                            {s === "todos" ? "Todos" : s.split("_").join(" ").charAt(0).toUpperCase() + s.split("_").join(" ").slice(1)} ({ (contadores as any)[s] || 0 })
                        </button>
                    ))}
                </div>
                )}

                {/* Kanban view */}
                {viewMode === "kanban" ? (
                    <div className="flex gap-3 overflow-x-auto pb-2">
                        {(["pendente", "aprovado_empresa", "convite_enviado", "entrevista_confirmada", "entrevista_recusada", "duvida", "selecionado", "contratado", "rejeitado"] as const).map(colStatus => {
                            const colCandidatos = candidatos.filter(c => c.status === colStatus)
                            const colColors: Record<string, string> = {
                                pendente: "border-amber-500/30 bg-amber-500/5",
                                aprovado_empresa: "border-indigo-500/30 bg-indigo-500/5",
                                convite_enviado: "border-purple-500/30 bg-purple-500/5",
                                entrevista_confirmada: "border-emerald-500/30 bg-emerald-500/5",
                                entrevista_recusada: "border-rose-500/30 bg-rose-500/5",
                                duvida: "border-orange-500/30 bg-orange-500/5",
                                selecionado: "border-blue-500/30 bg-blue-500/5",
                                contratado: "border-green-500/30 bg-green-500/5",
                                rejeitado: "border-red-500/30 bg-red-500/5",
                            }
                            const colHeader: Record<string, string> = {
                                pendente: "text-amber-400",
                                aprovado_empresa: "text-indigo-400",
                                convite_enviado: "text-purple-400",
                                entrevista_confirmada: "text-emerald-400",
                                entrevista_recusada: "text-rose-400",
                                duvida: "text-orange-400",
                                selecionado: "text-blue-400",
                                contratado: "text-green-400",
                                rejeitado: "text-red-400",
                            }
                            const colLabel: Record<string, string> = {
                                pendente: "Pendente",
                                aprovado_empresa: "Aprovado p/ Empresa",
                                convite_enviado: "Convite Enviado",
                                entrevista_confirmada: "Confirmada",
                                entrevista_recusada: "Recusada",
                                duvida: "Dúvida",
                                selecionado: "Selecionado",
                                contratado: "Contratado",
                                rejeitado: "Rejeitado",
                            }
                            return (
                                <div key={colStatus} className={`rounded-xl border p-3 space-y-2 min-h-[200px] min-w-[180px] flex-shrink-0 ${colColors[colStatus]}`}>
                                    <div className={`flex items-center justify-between mb-1 ${colHeader[colStatus]}`}>
                                        <span className="text-xs font-semibold uppercase tracking-wide">
                                            {colLabel[colStatus]}
                                        </span>
                                        <span className="text-xs font-bold">{colCandidatos.length}</span>
                                    </div>
                                    {colCandidatos.length === 0 ? (
                                        <p className="text-xs text-muted-foreground text-center py-4">Nenhum</p>
                                    ) : colCandidatos.map(c => {
                                        const ocr = c.dados_ocr_json || {}
                                        const score = ocr?.match_score ?? (c as any).match_score ?? null
                                        const idade = calcularIdade(c.data_nascimento)
                                        return (
                                            <div
                                                key={c.id}
                                                className="bg-popover rounded-lg border border-border p-2.5 cursor-pointer hover:border-cuca-blue/50 transition-colors space-y-1"
                                                onClick={() => router.push(`/empregabilidade/vagas/${id}/candidatos/${c.id}`)}
                                            >
                                                <div className="flex items-center justify-between gap-1">
                                                    <span className="text-xs font-medium truncate">{c.nome}</span>
                                                    {score !== null && (
                                                        <span className={`text-[10px] font-bold rounded-full w-6 h-6 flex items-center justify-center flex-shrink-0 ${score >= 70 ? "bg-green-500/20 text-green-400" : score >= 50 ? "bg-amber-500/20 text-amber-400" : "bg-red-500/20 text-red-400"}`}>
                                                            {score}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="flex items-center justify-between gap-1">
                                                    <span className="text-[10px] text-muted-foreground">{idade ? `${idade} anos` : "—"}</span>
                                                    <div className="flex items-center gap-1">
                                                        {(c.status === 'aprovado_empresa' || c.status === 'selecionado') && (
                                                            <button
                                                                onClick={e => { e.stopPropagation(); abrirSummon(c) }}
                                                                className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-indigo-500 text-[9px] text-white hover:bg-indigo-600 transition-colors"
                                                                title="Convocar"
                                                            >
                                                                <Send className="h-2 w-2" />
                                                                Convocar
                                                            </button>
                                                        )}
                                                        <span className="text-[10px] text-muted-foreground">{format(new Date(c.created_at || Date.now()), "dd/MM/yy", { locale: ptBR })}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        )
                                    })}
                                </div>
                            )
                        })}
                    </div>
                ) : (
                /* Grid de cards */
                candidatosFiltrados.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground border border-dashed rounded-xl">
                        <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
                        <p className="text-sm">
                            {filtroStatus === "todos"
                                ? "Nenhum currículo recebido até o momento."
                                : `Nenhum candidato com status "${filtroStatus}".`}
                        </p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {candidatosFiltrados.map(c => {
                            const ocr = c.dados_ocr_json || {}
                            const idade = calcularIdade(c.data_nascimento)
                            const score = ocr?.match_score ?? (c as any).match_score ?? null
                            return (
                                <CandidatoCard
                                    key={c.id}
                                    candidato={c}
                                    ocr={ocr}
                                    idade={idade}
                                    score={score}
                                    onAbrirFollowup={() => abrirFollowup(c)}
                                    onConvocar={() => abrirSummon(c)}
                                    onClick={() => router.push(`/empregabilidade/vagas/${id}/candidatos/${c.id}`)}
                                />
                            )
                        })}
                    </div>
                )
                )}
            </div>

            {/* ── Seção: Banco de Talentos ── */}
            <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Database className="h-5 w-5 text-purple-400" />
                        <h2 className="text-lg font-semibold">Banco de Talentos</h2>
                        {talentTriado && (
                            <Badge variant="outline" className="border-purple-500/30 text-purple-400">{talentVisiveis.length} encontrado(s)</Badge>
                        )}
                    </div>
                    {talentTriado && (
                        <Button
                            size="sm"
                            variant="ghost"
                            className="text-muted-foreground hover:text-red-400"
                            title="Limpar resultados e recomeçar"
                            onClick={() => {
                                try { localStorage.removeItem(storageKey) } catch {}
                                setTalentResultsRaw([])
                                setTalentTriado(false)
                            }}
                        >
                            <RefreshCw className="h-4 w-4" />
                        </Button>
                    )}
                    <Button
                        size="sm"
                        variant="outline"
                        className="border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                        onClick={abrirDialogTalent}
                        disabled={loadingTalent}
                    >
                        {loadingTalent ? (
                            <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Analisando...</>
                        ) : (
                            <><Sparkles className="mr-1.5 h-4 w-4" />{talentTriado ? "Analisar mais" : "Analisar Banco de Talentos"}</>
                        )}
                    </Button>
                </div>

                {/* S37B-04: Filtros demográficos para triagem */}
                <div className="flex flex-wrap gap-2 items-center py-2">
                    <Select value={filtroTriagemEscolaridade || "todos"} onValueChange={(v) => setFiltroTriagemEscolaridade(v === "todos" ? "" : v)}>
                        <SelectTrigger className="h-8 w-auto min-w-[160px] text-xs border-purple-500/20">
                            <GraduationCap className="h-3.5 w-3.5 mr-1.5 text-purple-400" />
                            <SelectValue placeholder="Escolaridade mínima" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="todos">Qualquer escolaridade</SelectItem>
                            {NIVEIS_ESCOLARIDADE.map(n => (
                                <SelectItem key={n} value={n}>{n}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    <Select value={filtroTriagemGenero || "todos"} onValueChange={(v) => setFiltroTriagemGenero(v === "todos" ? "" : v)}>
                        <SelectTrigger className="h-8 w-auto min-w-[120px] text-xs border-purple-500/20">
                            <SelectValue placeholder="Gênero" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="todos">Qualquer gênero</SelectItem>
                            <SelectItem value="Masculino">Masculino</SelectItem>
                            <SelectItem value="Feminino">Feminino</SelectItem>
                            <SelectItem value="Não-binário">Não-binário</SelectItem>
                        </SelectContent>
                    </Select>

                    <Select value={filtroTriagemPCD || "todos"} onValueChange={(v) => setFiltroTriagemPCD(v === "todos" ? "" : v as "true" | "false")}>
                        <SelectTrigger className="h-8 w-auto min-w-[100px] text-xs border-purple-500/20">
                            <SelectValue placeholder="PCD" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="todos">PCD: todos</SelectItem>
                            <SelectItem value="true">Somente PCD</SelectItem>
                            <SelectItem value="false">Não PCD</SelectItem>
                        </SelectContent>
                    </Select>

                    <Select value={filtroTriagemPrimeiroEmprego || "todos"} onValueChange={(v) => setFiltroTriagemPrimeiroEmprego(v === "todos" ? "" : v as "true" | "false")}>
                        <SelectTrigger className="h-8 w-auto min-w-[150px] text-xs border-purple-500/20">
                            <SelectValue placeholder="Primeiro Emprego" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="todos">1º Emprego: todos</SelectItem>
                            <SelectItem value="true">Primeiro Emprego</SelectItem>
                            <SelectItem value="false">Com experiência</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {!talentTriado && !loadingTalent && (
                    <div className="text-center py-10 border border-dashed border-purple-500/20 rounded-xl">
                        <Database className="h-10 w-10 mx-auto mb-3 text-purple-500/30" />
                        <p className="text-sm text-muted-foreground">
                            Clique em <strong>Analisar Banco de Talentos</strong> para a IA buscar currículos compatíveis com esta vaga.
                        </p>
                    </div>
                )}

                {talentTriado && talentVisiveis.length === 0 && talentResults.length > 0 && (
                    <p className="text-sm text-muted-foreground text-center py-6">
                        Todos os candidatos encontrados já foram inscritos nesta vaga.
                    </p>
                )}
                {talentTriado && talentVisiveis.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {talentVisiveis.map(tb => (
                            <TalentBankCard
                                key={tb.id}
                                candidato={tb}
                                onClick={() => router.push(`/empregabilidade/vagas/${id}/banco-talentos/${tb.id}`)}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* ── Dialog: Quantos currículos analisar ── */}
            <Dialog open={dialogTalent} onOpenChange={setDialogTalent}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Sparkles className="h-5 w-5 text-purple-400" />
                            Analisar Banco de Talentos
                        </DialogTitle>
                        <DialogDescription asChild>
                            <div className="space-y-1 mt-1">
                                {limiteCurriculos > 0 && (
                                    <p className="text-sm">
                                        Limite da empresa: <strong>{limiteCurriculos}</strong> currículos — {inscritos} já inscrito(s) — <strong className="text-purple-400">{slotsDisponiveis} disponível(is)</strong>
                                    </p>
                                )}
                                <p className="text-xs text-muted-foreground">
                                    A IA vai processar o OCR dos currículos selecionados e ranquear os mais compatíveis com esta vaga. Cada análise consome créditos da OpenAI.
                                </p>
                            </div>
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3 py-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="qtd-analise">Quantos currículos analisar?</Label>
                            <Input
                                id="qtd-analise"
                                type="number"
                                min={1}
                                max={slotsDisponiveis > 0 ? slotsDisponiveis : 50}
                                value={quantidadeAnalise}
                                onChange={e => setQuantidadeAnalise(e.target.value)}
                                className="text-center text-lg font-bold"
                            />
                            {slotsDisponiveis > 0 && (
                                <p className="text-xs text-muted-foreground text-center">
                                    Máximo recomendado: {slotsDisponiveis} ({limiteCurriculos} pedidos − {inscritos} inscrito(s))
                                </p>
                            )}
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDialogTalent(false)}>Cancelar</Button>
                        <Button
                            className="bg-purple-600 hover:bg-purple-700 text-white font-bold"
                            onClick={() => analisarBancoTalentos(Math.max(1, parseInt(quantidadeAnalise) || 5))}
                            disabled={!quantidadeAnalise || parseInt(quantidadeAnalise) < 1}
                        >
                            <Sparkles className="mr-1.5 h-4 w-4" />
                            Analisar {quantidadeAnalise || "?"} currículo(s)
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Sheet Follow-up ── */}
            <Sheet open={!!followupSheet} onOpenChange={open => !open && setFollowupSheet(null)}>
                <SheetContent className="w-full sm:max-w-md overflow-y-auto">
                    <SheetHeader className="mb-4">
                        <SheetTitle className="flex items-center gap-2">
                            <MessageSquare className="h-5 w-5 text-cuca-blue" />
                            Follow-up
                        </SheetTitle>
                        <SheetDescription>{followupSheet?.nome} — {vaga?.titulo}</SheetDescription>
                    </SheetHeader>
                    {loadingFollowup ? (
                        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                    ) : (
                        <div className="space-y-4">
                            <div className="space-y-3">
                                {followups.length === 0 ? (
                                    <p className="text-sm text-muted-foreground text-center py-6">Nenhum registro. Adicione o primeiro abaixo.</p>
                                ) : followups.map(fu => {
                                    const meta = tipoFollowupLabel(fu.tipo)
                                    const Icon = meta.icon
                                    return (
                                        <div key={fu.id} className="flex gap-3">
                                            <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${meta.color}`}>
                                                <Icon className="h-3.5 w-3.5" />
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-0.5">
                                                    <span className={`text-xs font-semibold rounded px-1.5 py-0.5 ${meta.color}`}>{meta.label}</span>
                                                    <span className="text-xs text-muted-foreground">
                                                        {format(new Date(fu.created_at), "dd/MM HH:mm", { locale: ptBR })}
                                                    </span>
                                                </div>
                                                <p className="text-sm leading-relaxed">{fu.mensagem}</p>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                            <div className="border-t pt-4 space-y-3">
                                <p className="text-xs font-semibold text-muted-foreground uppercase">Adicionar registro</p>
                                <div>
                                    <Label className="text-xs">Tipo</Label>
                                    <Select value={novoFollowup.tipo} onValueChange={v => setNovoFollowup(n => ({ ...n, tipo: v as any }))}>
                                        <SelectTrigger className="mt-1 h-8 text-sm"><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="interno">Interno (CUCA)</SelectItem>
                                            <SelectItem value="empresa">Empresa</SelectItem>
                                            <SelectItem value="candidato">Candidato</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label className="text-xs">Mensagem / Observação</Label>
                                    <Textarea className="mt-1 text-sm" rows={3}
                                        placeholder="Ex: Empresa confirmou entrevista para quinta-feira às 14h..."
                                        value={novoFollowup.mensagem}
                                        onChange={e => setNovoFollowup(n => ({ ...n, mensagem: e.target.value }))} />
                                </div>
                                <Button className="w-full" size="sm" onClick={adicionarFollowup} disabled={enviandoFollowup}>
                                    <Send className="mr-1.5 h-3.5 w-3.5" />
                                    {enviandoFollowup ? "Salvando..." : "Adicionar"}
                                </Button>
                            </div>
                        </div>
                    )}
                </SheetContent>
            </Sheet>

            {/* ── Modal Inscrição Manual ── */}
            <Dialog open={modalInscricao} onOpenChange={setModalInscricao}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Inscrever Candidato Manualmente</DialogTitle>
                        <DialogDescription>
                            Registre um candidato que compareceu presencialmente ao CUCA para a vaga <strong>{vaga?.titulo}</strong>.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4">
                        <div>
                            <Label>Nome completo *</Label>
                            <Input className="mt-1" placeholder="Nome do candidato"
                                value={inscricaoForm.nome} onChange={e => setInscricaoForm(f => ({ ...f, nome: e.target.value }))} />
                        </div>
                        <div>
                            <Label>Telefone (WhatsApp) *</Label>
                            <Input className="mt-1" placeholder="+55 (85) 99999-9999"
                                value={mascaraTelefone(inscricaoForm.telefone)}
                                onChange={e => setInscricaoForm(f => ({ ...f, telefone: limparTelefone(e.target.value) }))} />
                        </div>
                        <div>
                            <Label>Data de Nascimento</Label>
                            <Input type="date" className="mt-1"
                                value={inscricaoForm.data_nascimento}
                                onChange={e => setInscricaoForm(f => ({ ...f, data_nascimento: e.target.value }))} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setModalInscricao(false)}>Cancelar</Button>
                        <Button onClick={criarInscricaoManual} disabled={criandoInscricao}>
                            {criandoInscricao ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                            Inscrever
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Modal Convocação (Summon) SQS-40 ── */}
            <Dialog open={summonModalOpen} onOpenChange={setSummonModalOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Send className="h-5 w-5 text-indigo-400" />
                            {summonIsLote ? `Convocar em Lote (${contadores.aprovado_empresa + contadores.selecionado})` : "Convocar Candidato"}
                        </DialogTitle>
                        <DialogDescription>
                            {summonIsLote
                                ? `Defina data, hora e local únicos para convocar todos os ${contadores.aprovado_empresa + contadores.selecionado} candidato(s) selecionados/aprovados. Cada um receberá o convite via WhatsApp.`
                                : <>Agende a entrevista para <strong>{selectedCand?.nome}</strong>. O candidato receberá o convite via WhatsApp.</>
                            }
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-1.5">
                                <Label>Data da Entrevista</Label>
                                <Input type="date" value={summonForm.data} onChange={e => setSummonForm(f => ({ ...f, data: e.target.value }))} />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Horário</Label>
                                <Input type="time" value={summonForm.hora} onChange={e => setSummonForm(f => ({ ...f, hora: e.target.value }))} />
                            </div>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Tipo de Local</Label>
                            <Select value={summonForm.tipo} onValueChange={v => setSummonForm(f => ({ ...f, tipo: v }))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="presencial">Presencial (Empresa)</SelectItem>
                                    <SelectItem value="cuca">No CUCA</SelectItem>
                                    <SelectItem value="online">Online / Remoto</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-1.5">
                            <Label>Endereço / Link da Entrevista</Label>
                            <Textarea 
                                placeholder="Endereço completo ou link da reunião"
                                value={summonForm.local} 
                                onChange={e => setSummonForm(f => ({ ...f, local: e.target.value }))} 
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setSummonModalOpen(false)}>Cancelar</Button>
                        <Button className="bg-indigo-600 hover:bg-indigo-700 text-white" onClick={handleSummon} disabled={summoning}>
                            {summoning ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                            Enviar Convite
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

// ── Componente: Card de candidato inscrito ──
function CandidatoCard({
    candidato, ocr, idade, score, onAbrirFollowup, onConvocar, onClick
}: {
    candidato: Candidatura
    ocr: any
    idade: number | null
    score: number | null
    onAbrirFollowup: () => void
    onConvocar: () => void
    onClick: () => void
}) {
    const ehBancoTalentos = candidato.observacoes?.toLowerCase().includes("banco_talentos")
    // semOcr: tem CV em arquivo aguardando análise, OU é banco de talentos (análise textual disparada)
    const semOcr = !candidato.dados_ocr_json && (!!candidato.arquivo_cv_url || ehBancoTalentos)
    // semCv: candidatura sem arquivo e sem currículo estruturado (ex: cadastro manual/WhatsApp sem CV)
    const semCv = !candidato.dados_ocr_json && !candidato.arquivo_cv_url && !ehBancoTalentos

    return (
        <div
            onClick={onClick}
            className={`group relative bg-card border rounded-xl p-4 cursor-pointer hover:shadow-md transition-all ${ehBancoTalentos ? "border-purple-500/20 hover:border-purple-500/50" : "border-border hover:border-cuca-blue/50"}`}
        >
            {/* Linha topo: score + nome + status */}
            <div className="flex items-start gap-3 mb-3">
                <ScoreCircle score={score} />
                <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm leading-tight truncate">{candidato.nome}</p>
                    {idade !== null && (
                        <p className="text-xs text-muted-foreground">{idade} anos</p>
                    )}
                    <div className="mt-1 flex flex-wrap gap-1">
                        <StatusBadge status={candidato.status} />
                        {ehBancoTalentos && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border bg-purple-500/10 text-purple-400 border-purple-500/30">
                                <Database className="h-3 w-3" /> Banco de Talentos
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* Dados OCR */}
            {semOcr ? (
                <div className="flex items-center gap-1.5 text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg px-2.5 py-1.5 mb-3">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    Análise em andamento...
                </div>
            ) : semCv ? (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg px-2.5 py-1.5 mb-3">
                    <FileText className="h-3 w-3 flex-shrink-0" />
                    Sem currículo em arquivo
                </div>
            ) : (
                <div className="space-y-1.5 mb-3">
                    {ocr?.escolaridade && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            <GraduationCap className="h-3 w-3 flex-shrink-0" />
                            <span className="truncate">{ocr.escolaridade}</span>
                        </div>
                    )}
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3 flex-shrink-0" />
                        <span>{formatarExperiencia(ocr?.experiencia_meses)}</span>
                    </div>
                </div>
            )}

            {/* Resposta para entrevista */}
            {(candidato.status === 'entrevista_confirmada' || candidato.status === 'entrevista_recusada') && (
                <div className={`flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1.5 mb-3 border ${candidato.status === 'entrevista_confirmada' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border-rose-500/20'}`}>
                    {candidato.status === 'entrevista_confirmada' ? '✅' : '❌'}
                    <span className="font-medium">Resposta para entrevista:</span>
                    <span>{candidato.status === 'entrevista_confirmada' ? 'Confirmada' : 'Recusada'}</span>
                </div>
            )}

            {/* Rodapé: telefone + data + ações */}
            <div className="flex items-center justify-between pt-2.5 border-t border-border">
                <div className="space-y-0.5">
                    {candidato.telefone && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Phone className="h-3 w-3" />
                            <span>{candidato.telefone}</span>
                        </div>
                    )}
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        <span>{format(new Date(candidato.created_at), "dd/MM/yy", { locale: ptBR })}</span>
                    </div>
                </div>
                <div className="flex items-center gap-1">
                    {(candidato.status === 'aprovado_empresa' || candidato.status === 'selecionado') && (
                        <Button
                            size="sm"
                            variant="default"
                            onClick={e => { e.stopPropagation(); onConvocar() }}
                            className="bg-indigo-600 hover:bg-indigo-700 text-white h-8 text-xs gap-1.5"
                        >
                            <Send className="h-3.5 w-3.5" />
                            Convocar
                        </Button>
                    )}
                    <button
                        onClick={e => { e.stopPropagation(); onAbrirFollowup() }}
                        className="p-1.5 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-cuca-blue"
                        title="Follow-up"
                    >
                        <MessageSquare className="h-3.5 w-3.5" />
                    </button>
                    <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-cuca-blue transition-colors" />
                </div>
            </div>
        </div>
    )
}

// ── Componente: Card de candidato do banco de talentos ──
function TalentBankCard({ candidato, onClick }: { candidato: TalentBankCandidate; onClick: () => void }) {
    const skills = candidato.skills_jsonb || {}
    const idade = candidato.data_nascimento ? differenceInYears(new Date(), new Date(candidato.data_nascimento)) : null

    return (
        <div
            onClick={onClick}
            className="group relative bg-card border border-purple-500/20 rounded-xl p-4 cursor-pointer hover:border-purple-500/50 hover:shadow-md transition-all"
        >
            <div className="flex items-start gap-3 mb-3">
                <ScoreCircle score={candidato.match_score ?? null} />
                <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm leading-tight truncate">{candidato.nome}</p>
                    {idade !== null && <p className="text-xs text-muted-foreground">{idade} anos</p>}
                    <div className="flex flex-wrap gap-1 mt-1">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border bg-purple-500/10 text-purple-400 border-purple-500/30">
                            <Database className="h-3 w-3" /> Banco de Talentos
                        </span>
                        {candidato.primeiro_emprego && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border bg-amber-500/10 text-amber-400 border-amber-500/30">
                                1º Emprego
                            </span>
                        )}
                        {(candidato as any).tb_status === "selecionado" && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border bg-green-500/10 text-green-400 border-green-500/30">
                                ✓ Aprovado
                            </span>
                        )}
                    </div>
                </div>
            </div>

            <div className="space-y-1.5 mb-3">
                {skills?.escolaridade && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <GraduationCap className="h-3 w-3 flex-shrink-0" />
                        <span className="truncate">{skills.escolaridade}</span>
                    </div>
                )}
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3 flex-shrink-0" />
                    <span>{formatarExperiencia(skills?.experiencia_meses)}</span>
                </div>
            </div>

            <div className="flex items-center justify-between pt-2.5 border-t border-purple-500/20">
                {candidato.telefone && (
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Phone className="h-3 w-3" />
                        <span>{candidato.telefone}</span>
                    </div>
                )}
                <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-purple-400 transition-colors ml-auto" />
            </div>
        </div>
    )
}
