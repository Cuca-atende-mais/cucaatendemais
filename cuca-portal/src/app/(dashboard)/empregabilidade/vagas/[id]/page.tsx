"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
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
    }
    const labels: Record<string, string> = {
        pendente: "Pendente",
        selecionado: "Selecionado",
        contratado: "Contratado",
        rejeitado: "Rejeitado",
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
}

export default function VagaDetalhesPage() {
    const params = useParams()
    const router = useRouter()
    const id = params.id as string
    const supabase = createClient()

    const [vaga, setVaga] = useState<Vaga | null>(null)
    const [candidatos, setCandidatos] = useState<Candidatura[]>([])
    const [loading, setLoading] = useState(true)
    const [filtroStatus, setFiltroStatus] = useState("todos")
    const [viewMode, setViewMode] = useState<"grid" | "kanban">("grid")

    // Banco de Talentos
    const [talentResults, setTalentResults] = useState<TalentBankCandidate[]>([])
    const [loadingTalent, setLoadingTalent] = useState(false)
    const [talentTriado, setTalentTriado] = useState(false)

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

    useEffect(() => { if (id) fetchData() }, [id])

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

    const analisarBancoTalentos = async () => {
        setLoadingTalent(true)
        try {
            const res = await fetch(`/api/empregabilidade/vagas/${id}/triar-banco-talentos`, {
                method: "POST",
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Erro ao triar banco de talentos")
            setTalentResults(data.candidatos || [])
            setTalentTriado(true)
            if ((data.candidatos || []).length === 0) {
                toast("Nenhum candidato compatível encontrado no banco de talentos.", { icon: "ℹ️" })
            } else {
                toast.success(`${data.candidatos.length} candidato(s) encontrado(s) no banco de talentos!`)
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

    const tipoFollowupLabel = (tipo: string) => {
        if (tipo === "empresa") return { label: "Empresa", color: "bg-blue-500/15 text-blue-400", icon: Building2 }
        if (tipo === "candidato") return { label: "Candidato", color: "bg-green-500/15 text-green-400", icon: User }
        return { label: "Interno", color: "bg-muted text-muted-foreground", icon: Info }
    }

    const candidatosFiltrados = filtroStatus === "todos"
        ? candidatos
        : candidatos.filter(c => c.status === filtroStatus)

    const contadores = {
        todos: candidatos.length,
        pendente: candidatos.filter(c => c.status === "pendente").length,
        selecionado: candidatos.filter(c => c.status === "selecionado").length,
        contratado: candidatos.filter(c => c.status === "contratado").length,
        rejeitado: candidatos.filter(c => c.status === "rejeitado").length,
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
                    {(["todos", "pendente", "selecionado", "contratado", "rejeitado"] as const).map(s => (
                        <button
                            key={s}
                            onClick={() => setFiltroStatus(s)}
                            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${filtroStatus === s
                                ? "bg-cuca-blue text-white border-cuca-blue"
                                : "border-border text-muted-foreground hover:border-cuca-blue/50"}`}
                        >
                            {s === "todos" ? "Todos" : s.charAt(0).toUpperCase() + s.slice(1)} ({contadores[s]})
                        </button>
                    ))}
                </div>
                )}

                {/* Kanban view */}
                {viewMode === "kanban" ? (
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 overflow-x-auto">
                        {(["pendente", "selecionado", "contratado", "rejeitado"] as const).map(colStatus => {
                            const colCandidatos = candidatos.filter(c => c.status === colStatus)
                            const colColors: Record<string, string> = {
                                pendente: "border-amber-500/30 bg-amber-500/5",
                                selecionado: "border-blue-500/30 bg-blue-500/5",
                                contratado: "border-green-500/30 bg-green-500/5",
                                rejeitado: "border-red-500/30 bg-red-500/5",
                            }
                            const colHeader: Record<string, string> = {
                                pendente: "text-amber-400",
                                selecionado: "text-blue-400",
                                contratado: "text-green-400",
                                rejeitado: "text-red-400",
                            }
                            return (
                                <div key={colStatus} className={`rounded-xl border p-3 space-y-2 min-h-[200px] ${colColors[colStatus]}`}>
                                    <div className={`flex items-center justify-between mb-1 ${colHeader[colStatus]}`}>
                                        <span className="text-xs font-semibold uppercase tracking-wide">
                                            {colStatus.charAt(0).toUpperCase() + colStatus.slice(1)}
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
                                                <p className="text-[10px] text-muted-foreground">{idade ? `${idade} anos` : "—"}</p>
                                                <p className="text-[10px] text-muted-foreground">{format(new Date(c.created_at || Date.now()), "dd/MM/yy", { locale: ptBR })}</p>
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
                            <Badge variant="outline" className="border-purple-500/30 text-purple-400">{talentResults.length} encontrado(s)</Badge>
                        )}
                    </div>
                    <Button
                        size="sm"
                        variant="outline"
                        className="border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                        onClick={analisarBancoTalentos}
                        disabled={loadingTalent}
                    >
                        {loadingTalent ? (
                            <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Analisando...</>
                        ) : (
                            <><Sparkles className="mr-1.5 h-4 w-4" />{talentTriado ? "Reanalisar" : "Analisar Banco de Talentos"}</>
                        )}
                    </Button>
                </div>

                {!talentTriado && !loadingTalent && (
                    <div className="text-center py-10 border border-dashed border-purple-500/20 rounded-xl">
                        <Database className="h-10 w-10 mx-auto mb-3 text-purple-500/30" />
                        <p className="text-sm text-muted-foreground">
                            Clique em <strong>Analisar Banco de Talentos</strong> para a IA buscar currículos compatíveis com esta vaga.
                        </p>
                    </div>
                )}

                {talentTriado && talentResults.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {talentResults.map(tb => (
                            <TalentBankCard
                                key={tb.id}
                                candidato={tb}
                                onClick={() => router.push(`/empregabilidade/vagas/${id}/banco-talentos/${tb.id}`)}
                            />
                        ))}
                    </div>
                )}
            </div>

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
        </div>
    )
}

// ── Componente: Card de candidato inscrito ──
function CandidatoCard({
    candidato, ocr, idade, score, onAbrirFollowup, onClick
}: {
    candidato: Candidatura
    ocr: any
    idade: number | null
    score: number | null
    onAbrirFollowup: () => void
    onClick: () => void
}) {
    const semOcr = !candidato.dados_ocr_json
    const ehBancoTalentos = candidato.observacoes?.toLowerCase().includes("banco_talentos")

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
                    <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full text-xs border bg-purple-500/10 text-purple-400 border-purple-500/30">
                        <Database className="h-3 w-3" /> Banco de Talentos
                    </span>
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
