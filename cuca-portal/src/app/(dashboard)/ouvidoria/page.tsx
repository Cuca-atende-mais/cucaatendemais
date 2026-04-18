"use client"

import { useState, useEffect, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import {
    MessageSquareWarning, Lightbulb, Activity, UserX, User, Building2,
    Calendar, CheckCircle2, AlertCircle, HelpCircle, Loader2, Sparkles, Phone, MessagesSquare,
    TrendingUp, Tag, BarChart2, Brain, Thermometer, ShieldAlert, Star, Zap, ChevronRight,
} from "lucide-react"
import { CanalWhatsappTab } from "@/components/instancias/canal-whatsapp-tab"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle
} from "@/components/ui/dialog"
import { format } from "date-fns"
import { cn } from "@/lib/utils"
import toast from "react-hot-toast"
import { useUser } from "@/lib/auth/user-provider"
import ChatSidebar from "@/components/chat/chat-sidebar"
import ChatWindow from "@/components/chat/chat-window"
import {
    PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
    BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts"

// Constante estável — evita recriar canal Realtime a cada render do componente pai
// TODO: quando instância "ouvidoriaredecuca" (canal_tipo: "Ouvidoria") existir no banco,
//       substituir por filterCanalTipo="Ouvidoria" no ChatSidebar abaixo.
const SOFIA_AGENTE_TIPOS = ["sofia_global", "sofia_unidade", "Sofia", "Ouvidoria", "ouvidoria"] as const

type OuvidoriaRegistro = {
    id: string
    evento_id: string
    tipo: "critica" | "sugestao"
    anonimo: boolean
    nome_solicitante: string | null
    telefone_solicitante: string | null
    unidade_cuca: string | null
    texto_manifestacao: string
    protocolo: string | null
    sentimento: "positivo" | "negativo" | "neutro" | null
    temas_identificados: string[] | null
    resumo_ia: string | null
    created_at: string
    ouvidoria_eventos?: { titulo: string }
}

const SENTIMENTO_CONFIG = {
    positivo: { label: "Positivo", color: "bg-emerald-500/10 text-emerald-600 border-emerald-200", icon: CheckCircle2, hex: "#10b981" },
    negativo: { label: "Negativo", color: "bg-red-500/10 text-red-600 border-red-200", icon: AlertCircle, hex: "#ef4444" },
    neutro: { label: "Neutro", color: "bg-slate-100 text-slate-500 border-slate-200", icon: HelpCircle, hex: "#94a3b8" },
}

const TOOLTIP_STYLE = {
    backgroundColor: "hsl(var(--card))",
    border: "1px solid hsl(var(--border))",
    borderRadius: "8px",
    fontSize: "12px",
    color: "hsl(var(--foreground))",
}

type InsightsData = {
    temperatura: { score: number; nivel: string; frase: string }
    resumo_executivo: string
    mais_reclamado: { tema: string; frequencia: number; trecho: string; unidades: string[] }[]
    mais_elogiado: { tema: string; frequencia: number; trecho: string }[]
    melhores_ideias: { ideia: string; impacto: string; trecho: string; unidade: string }[]
    alertas: { tipo: string; descricao: string; unidade: string }[]
}

const TEMPERATURA_CONFIG: Record<string, { label: string; cor: string; bg: string; border: string }> = {
    critico:   { label: "Crítico",   cor: "text-red-500",     bg: "bg-red-500/10",     border: "border-red-500/30" },
    alerta:    { label: "Alerta",    cor: "text-amber-500",   bg: "bg-amber-500/10",   border: "border-amber-500/30" },
    moderado:  { label: "Moderado",  cor: "text-yellow-500",  bg: "bg-yellow-500/10",  border: "border-yellow-500/30" },
    bom:       { label: "Bom",       cor: "text-emerald-500", bg: "bg-emerald-500/10", border: "border-emerald-500/30" },
    excelente: { label: "Excelente", cor: "text-indigo-500",  bg: "bg-indigo-500/10",  border: "border-indigo-500/30" },
}

const IMPACTO_CONFIG: Record<string, { label: string; cor: string }> = {
    alto:  { label: "Alto impacto",  cor: "text-indigo-400 bg-indigo-500/15 border-indigo-500/30" },
    medio: { label: "Médio impacto", cor: "text-amber-400 bg-amber-500/15 border-amber-500/30" },
    baixo: { label: "Baixo impacto", cor: "text-slate-400 bg-slate-500/15 border-slate-500/30" },
}

const ALERTA_ICON: Record<string, typeof ShieldAlert> = {
    infraestrutura: ShieldAlert,
    atendimento: AlertCircle,
    segurança: ShieldAlert,
    urgente: Zap,
    outro: AlertCircle,
}

export default function OuvidoriaPage() {
    const supabase = createClient()
    const [registros, setRegistros] = useState<OuvidoriaRegistro[]>([])
    const [loading, setLoading] = useState(true)
    const [analysingBatch, setAnalysingBatch] = useState(false)
    const [detalhamento, setDetalhamento] = useState<OuvidoriaRegistro | null>(null)
    const [analysing, setAnalysing] = useState(false)
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
    const [insights, setInsights] = useState<InsightsData | null>(null)
    const [loadingInsights, setLoadingInsights] = useState(false)
    const [insightsMeta, setInsightsMeta] = useState<{ gerado_em: string } | null>(null)
    const { hasPermission, profile, isDeveloper } = useUser()
    const isSuperAdmin = isDeveloper || !profile?.unidade_cuca || profile?.unidade_cuca === 'Geral'

    useEffect(() => { fetchRegistros() }, [])

    const handleGerarInsights = async () => {
        setLoadingInsights(true)
        try {
            const res = await fetch('/api/ouvidoria/insights', { method: 'POST' })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error || 'Erro ao gerar insights')
            }
            const data = await res.json()
            setInsights(data.insights)
            setInsightsMeta(data.meta)
            toast.success('Análise de IA gerada!')
        } catch (e: unknown) {
            toast.error(e instanceof Error ? e.message : 'Falha ao gerar insights')
        } finally {
            setLoadingInsights(false)
        }
    }

    const fetchRegistros = async () => {
        setLoading(true)
        const { data } = await supabase
            .from("ouvidoria_registros")
            .select("*, ouvidoria_eventos(titulo)")
            .order("created_at", { ascending: false })
        setRegistros(data || [])
        setLoading(false)
    }

    const handleAnalyseSentiment = async (registro: OuvidoriaRegistro) => {
        setAnalysing(true)
        try {
            const res = await fetch("/api/sentiment", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ registro_id: registro.id, texto: registro.texto_manifestacao })
            })
            if (!res.ok) throw new Error("Erro na análise")
            const result = await res.json()
            toast.success("Análise concluída!")
            setDetalhamento({ ...registro, sentimento: result.sentimento, resumo_ia: result.resumo_ia, temas_identificados: result.temas })
            fetchRegistros()
        } catch {
            toast.error("Falha ao analisar sentimento")
        } finally {
            setAnalysing(false)
        }
    }

    // Análise em lote — processa todos sem análise ainda
    const handleAnalisarTodos = async () => {
        const pendentes = registros.filter(r => !r.resumo_ia)
        if (pendentes.length === 0) { toast("Todos já foram analisados!"); return }
        setAnalysingBatch(true)
        let ok = 0
        for (const r of pendentes) {
            try {
                await fetch("/api/sentiment", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ registro_id: r.id, texto: r.texto_manifestacao })
                })
                ok++
            } catch { /* continua */ }
        }
        toast.success(`${ok} de ${pendentes.length} manifestações analisadas!`)
        fetchRegistros()
        setAnalysingBatch(false)
    }

    // ── Dados calculados para o dashboard ──────────────────────────────────
    const criticas = registros.filter(r => r.tipo === "critica")
    const sugestoes = registros.filter(r => r.tipo === "sugestao")
    const analisados = registros.filter(r => r.resumo_ia)
    const pendentesAnalise = registros.filter(r => !r.resumo_ia).length

    const dadosSentimento = useMemo(() => {
        const counts = { positivo: 0, negativo: 0, neutro: 0 }
        analisados.forEach(r => { if (r.sentimento) counts[r.sentimento]++ })
        return [
            { name: "Positivo", value: counts.positivo, color: SENTIMENTO_CONFIG.positivo.hex },
            { name: "Negativo", value: counts.negativo, color: SENTIMENTO_CONFIG.negativo.hex },
            { name: "Neutro", value: counts.neutro, color: SENTIMENTO_CONFIG.neutro.hex },
        ].filter(d => d.value > 0)
    }, [analisados])

    const dadosTemas = useMemo(() => {
        const freq: Record<string, number> = {}
        registros.forEach(r => r.temas_identificados?.forEach(t => { freq[t] = (freq[t] || 0) + 1 }))
        return Object.entries(freq)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8)
            .map(([tema, total]) => ({ tema, total }))
    }, [registros])

    const dadosPorUnidade = useMemo(() => {
        const counts: Record<string, { criticas: number; sugestoes: number }> = {}
        registros.forEach(r => {
            const u = r.unidade_cuca || "Não informada"
            const chave = u.replace("Cuca ", "")
            if (!counts[chave]) counts[chave] = { criticas: 0, sugestoes: 0 }
            if (r.tipo === "critica") counts[chave].criticas++
            else counts[chave].sugestoes++
        })
        return Object.entries(counts).map(([name, v]) => ({ name, ...v }))
    }, [registros])

    // ── Componente de card de manifestação ─────────────────────────────────
    const ResumoCard = ({ r }: { r: OuvidoriaRegistro }) => {
        const sent = r.sentimento ? SENTIMENTO_CONFIG[r.sentimento] : null
        const SentIcon = sent?.icon
        return (
            <div
                className="border rounded-xl p-4 bg-card hover:shadow-md transition-all cursor-pointer relative overflow-hidden"
                onClick={() => setDetalhamento(r)}
            >
                {r.sentimento && (
                    <div className={cn(
                        "absolute left-0 top-0 bottom-0 w-1",
                        r.sentimento === 'positivo' ? "bg-emerald-500" : r.sentimento === 'negativo' ? "bg-destructive" : "bg-slate-300"
                    )} />
                )}
                <div className="flex justify-between items-start mb-2 pl-2">
                    <div className="flex items-center gap-2">
                        {r.anonimo ? (
                            <Badge variant="outline" className="text-[10px] bg-slate-50 text-slate-500">
                                <UserX className="h-3 w-3 mr-1" /> Anônimo
                            </Badge>
                        ) : (
                            <Badge variant="outline" className="text-[10px] bg-blue-50 text-blue-600 border-blue-200">
                                <User className="h-3 w-3 mr-1" /> Identificado
                            </Badge>
                        )}
                        {r.protocolo && <span className="text-xs font-mono font-bold text-primary">{r.protocolo}</span>}
                    </div>
                    {sent && (
                        <Badge className={cn("text-[10px] border shadow-none", sent.color)}>
                            {SentIcon && <SentIcon className="h-3 w-3 mr-1" />}
                            {sent.label}
                        </Badge>
                    )}
                </div>
                <div className="pl-2 pt-1 pb-2">
                    <p className="text-sm font-medium line-clamp-2 leading-snug">{r.resumo_ia || r.texto_manifestacao}</p>
                </div>
                <div className="pl-2 pt-3 border-t mt-1 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
                    {r.ouvidoria_eventos && (
                        <div className="flex items-center gap-1.5 w-full mb-1">
                            <Activity className="h-3.5 w-3.5" />
                            <span className="truncate">{r.ouvidoria_eventos.titulo}</span>
                        </div>
                    )}
                    {r.unidade_cuca && (
                        <div className="flex items-center gap-1.5">
                            <Building2 className="h-3.5 w-3.5" /> CUCA {r.unidade_cuca}
                        </div>
                    )}
                    <div className="flex items-center gap-1.5">
                        <Calendar className="h-3.5 w-3.5" />
                        {format(new Date(r.created_at), "dd/MM 'às' HH:mm")}
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-6 p-2 md:p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <MessageSquareWarning className="h-6 w-6 text-primary" />
                        Ouvidoria (Manifestações)
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">Acompanhe as críticas e sugestões coletadas pela agente Sofia.</p>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            ) : (
                <Tabs defaultValue="overview">
                    <TabsList className="mb-4">
                        <TabsTrigger value="overview" className="gap-2">
                            <Activity className="h-4 w-4" /> Visão Geral
                        </TabsTrigger>
                        <TabsTrigger value="criticas" className="gap-2">
                            <MessageSquareWarning className="h-4 w-4" /> Críticas ({criticas.length})
                        </TabsTrigger>
                        <TabsTrigger value="sugestoes" className="gap-2">
                            <Lightbulb className="h-4 w-4" /> Sugestões ({sugestoes.length})
                        </TabsTrigger>
                        <TabsTrigger value="conversas" className="gap-2">
                            <MessagesSquare className="h-4 w-4" /> Conversas Sofia
                        </TabsTrigger>
                        {isSuperAdmin && (
                            <TabsTrigger value="canal-whatsapp" className="gap-2">
                                <Phone className="h-4 w-4" /> Canal WhatsApp
                            </TabsTrigger>
                        )}
                    </TabsList>

                    {/* ── VISÃO GERAL ── */}
                    <TabsContent value="overview" className="space-y-6">

                        {/* KPIs */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="border rounded-xl p-5 bg-card">
                                <p className="text-xs font-medium text-muted-foreground mb-1">Total</p>
                                <p className="text-3xl font-bold">{registros.length}</p>
                            </div>
                            <div className="border rounded-xl p-5 bg-card">
                                <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1.5">
                                    <MessageSquareWarning className="h-3.5 w-3.5 text-amber-500" /> Críticas
                                </p>
                                <p className="text-3xl font-bold">{criticas.length}</p>
                            </div>
                            <div className="border rounded-xl p-5 bg-card">
                                <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1.5">
                                    <Lightbulb className="h-3.5 w-3.5 text-emerald-500" /> Sugestões
                                </p>
                                <p className="text-3xl font-bold">{sugestoes.length}</p>
                            </div>
                            <div className="border rounded-xl p-5 bg-card">
                                <p className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1.5">
                                    <Sparkles className="h-3.5 w-3.5 text-indigo-500" /> Analisados IA
                                </p>
                                <p className="text-3xl font-bold">{analisados.length}</p>
                                {pendentesAnalise > 0 && (
                                    <p className="text-[10px] text-muted-foreground mt-1">{pendentesAnalise} pendentes</p>
                                )}
                            </div>
                        </div>

                        {/* Botão análise em lote */}
                        {pendentesAnalise > 0 && hasPermission("ouvidoria_painel", "update") && (
                            <div className="border rounded-xl p-4 bg-indigo-500/5 border-indigo-500/20 flex items-center justify-between gap-4">
                                <div>
                                    <p className="text-sm font-medium">{pendentesAnalise} manifestaç{pendentesAnalise === 1 ? "ão" : "ões"} aguardando análise de IA</p>
                                    <p className="text-xs text-muted-foreground">Classifique sentimento e extraia temas de todas de uma vez</p>
                                </div>
                                <Button
                                    onClick={handleAnalisarTodos}
                                    disabled={analysingBatch}
                                    size="sm"
                                    className="bg-indigo-600 hover:bg-indigo-700 shrink-0"
                                >
                                    {analysingBatch ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analisando...</> : <><Sparkles className="h-4 w-4 mr-2" /> Analisar todas</>}
                                </Button>
                            </div>
                        )}

                        {analisados.length === 0 ? (
                            <div className="border rounded-xl p-10 bg-card flex flex-col items-center justify-center text-muted-foreground">
                                <TrendingUp className="h-10 w-10 mb-3 opacity-20" />
                                <p className="font-medium text-foreground/70">Nenhuma manifestação analisada ainda</p>
                                <p className="text-sm mt-1 text-center max-w-xs">Clique em "Analisar todas" acima para ver os insights aqui.</p>
                            </div>
                        ) : (
                            <>
                                {/* ── PAINEL DE INTELIGÊNCIA IA ── */}
                                <div className="border rounded-xl p-5 bg-card space-y-5">
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="flex items-center gap-2">
                                            <Brain className="h-5 w-5 text-indigo-500" />
                                            <p className="text-sm font-semibold">Inteligência de Gestão — Análise IA</p>
                                            {insightsMeta && (
                                                <span className="text-[10px] text-muted-foreground">
                                                    atualizado {new Date(insightsMeta.gerado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            )}
                                        </div>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={handleGerarInsights}
                                            disabled={loadingInsights}
                                            className="shrink-0 border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10"
                                        >
                                            {loadingInsights
                                                ? <><Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> Analisando...</>
                                                : <><Sparkles className="h-3.5 w-3.5 mr-1.5" /> {insights ? 'Atualizar Análise' : 'Gerar Análise IA'}</>
                                            }
                                        </Button>
                                    </div>

                                    {!insights && !loadingInsights && (
                                        <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                                            <Brain className="h-10 w-10 opacity-20" />
                                            <p className="text-sm">Clique em "Gerar Análise IA" para ver o panorama completo</p>
                                            <p className="text-xs opacity-60">A IA vai sintetizar temperatura, alertas, melhores ideias e resumo executivo</p>
                                        </div>
                                    )}

                                    {loadingInsights && (
                                        <div className="flex flex-col items-center justify-center py-8 gap-3">
                                            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
                                            <p className="text-sm text-muted-foreground">Processando {analisados.length} manifestações...</p>
                                        </div>
                                    )}

                                    {insights && !loadingInsights && (
                                        <div className="space-y-5">
                                            {/* Temperatura + Resumo Executivo */}
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                                {/* Temperatura */}
                                                {(() => {
                                                    const cfg = TEMPERATURA_CONFIG[insights.temperatura.nivel] || TEMPERATURA_CONFIG.moderado
                                                    const pct = insights.temperatura.score
                                                    const corBarra = insights.temperatura.nivel === 'critico' ? '#ef4444'
                                                        : insights.temperatura.nivel === 'alerta' ? '#f59e0b'
                                                        : insights.temperatura.nivel === 'moderado' ? '#eab308'
                                                        : insights.temperatura.nivel === 'bom' ? '#10b981' : '#6366f1'
                                                    return (
                                                        <div className={`rounded-xl border p-5 flex flex-col gap-3 ${cfg.bg} ${cfg.border}`}>
                                                            <div className="flex items-center gap-2">
                                                                <Thermometer className={`h-4 w-4 ${cfg.cor}`} />
                                                                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Temperatura</span>
                                                            </div>
                                                            <div className="flex items-end gap-2">
                                                                <span className={`text-4xl font-bold ${cfg.cor}`}>{pct}</span>
                                                                <span className="text-muted-foreground text-sm mb-1">/100</span>
                                                            </div>
                                                            <div className="w-full bg-muted rounded-full h-2 overflow-hidden">
                                                                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: corBarra }} />
                                                            </div>
                                                            <div>
                                                                <span className={`text-xs font-bold uppercase ${cfg.cor}`}>{cfg.label}</span>
                                                                <p className="text-xs text-muted-foreground mt-0.5">{insights.temperatura.frase}</p>
                                                            </div>
                                                        </div>
                                                    )
                                                })()}

                                                {/* Resumo Executivo */}
                                                <div className="md:col-span-2 rounded-xl border p-5 bg-background/50 space-y-2">
                                                    <div className="flex items-center gap-2">
                                                        <Brain className="h-4 w-4 text-indigo-400" />
                                                        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Resumo Executivo</span>
                                                    </div>
                                                    <p className="text-sm leading-relaxed text-foreground/80">{insights.resumo_executivo}</p>
                                                </div>
                                            </div>

                                            {/* Alertas */}
                                            {insights.alertas.length > 0 && (
                                                <div className="space-y-2">
                                                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                                        <ShieldAlert className="h-3.5 w-3.5 text-red-400" /> Alertas de Atenção
                                                    </p>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                                        {insights.alertas.map((alerta, i) => {
                                                            const Icon = ALERTA_ICON[alerta.tipo] || AlertCircle
                                                            return (
                                                                <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-red-500/20 bg-red-500/5">
                                                                    <Icon className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                                                                    <div>
                                                                        <p className="text-sm font-medium text-red-300">{alerta.descricao}</p>
                                                                        {alerta.unidade && <p className="text-[10px] text-muted-foreground mt-0.5">{alerta.unidade}</p>}
                                                                    </div>
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Mais reclamado + Mais elogiado */}
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                <div className="space-y-2">
                                                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                                        <AlertCircle className="h-3.5 w-3.5 text-amber-400" /> O Que Mais Se Reclama
                                                    </p>
                                                    {insights.mais_reclamado.map((item, i) => (
                                                        <div key={i} className="p-3 rounded-lg border border-amber-500/20 bg-amber-500/5 space-y-1">
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-sm font-semibold capitalize">{item.tema}</span>
                                                                <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-bold">{item.frequencia}x</span>
                                                            </div>
                                                            <p className="text-xs text-muted-foreground line-clamp-2 italic">&ldquo;{item.trecho}&rdquo;</p>
                                                            {item.unidades?.length > 0 && (
                                                                <div className="flex gap-1 flex-wrap">
                                                                    {item.unidades.map(u => (
                                                                        <span key={u} className="text-[9px] bg-muted/60 text-muted-foreground px-1.5 py-0.5 rounded">{u}</span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>

                                                <div className="space-y-2">
                                                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                                        <Star className="h-3.5 w-3.5 text-emerald-400" /> O Que Mais Se Elogia
                                                    </p>
                                                    {insights.mais_elogiado.map((item, i) => (
                                                        <div key={i} className="p-3 rounded-lg border border-emerald-500/20 bg-emerald-500/5 space-y-1">
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-sm font-semibold capitalize">{item.tema}</span>
                                                                <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded font-bold">{item.frequencia}x</span>
                                                            </div>
                                                            <p className="text-xs text-muted-foreground line-clamp-2 italic">&ldquo;{item.trecho}&rdquo;</p>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* Melhores Ideias */}
                                            {insights.melhores_ideias.length > 0 && (
                                                <div className="space-y-2">
                                                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                                                        <Lightbulb className="h-3.5 w-3.5 text-indigo-400" /> Melhores Ideias para Implementar
                                                    </p>
                                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                                                        {insights.melhores_ideias.map((ideia, i) => {
                                                            const imp = IMPACTO_CONFIG[ideia.impacto] || IMPACTO_CONFIG.medio
                                                            return (
                                                                <div key={i} className="p-4 rounded-xl border border-indigo-500/20 bg-indigo-500/5 space-y-2 relative overflow-hidden">
                                                                    <div className="absolute top-2 right-2 opacity-10">
                                                                        <Lightbulb className="h-8 w-8 text-indigo-400" />
                                                                    </div>
                                                                    <div className="flex items-center gap-2">
                                                                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold ${imp.cor}`}>{imp.label}</span>
                                                                    </div>
                                                                    <p className="text-sm font-semibold text-foreground/90 leading-snug">{ideia.ideia}</p>
                                                                    <p className="text-xs text-muted-foreground line-clamp-2 italic">&ldquo;{ideia.trecho}&rdquo;</p>
                                                                    {ideia.unidade && (
                                                                        <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                                                            <Building2 className="h-3 w-3" /> {ideia.unidade}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Gráficos linha 1: Sentimento + Por unidade */}
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

                                    {/* Donut Sentimento */}
                                    <div className="border rounded-xl p-5 bg-card">
                                        <p className="text-sm font-semibold mb-4 flex items-center gap-2">
                                            <Activity className="h-4 w-4 text-indigo-500" /> Distribuição de Sentimento
                                            <span className="ml-auto text-xs font-normal text-muted-foreground">{analisados.length} analisados</span>
                                        </p>
                                        {dadosSentimento.length > 0 ? (
                                            <div className="relative">
                                                <ResponsiveContainer width="100%" height={200}>
                                                    <PieChart>
                                                        <Pie
                                                            data={dadosSentimento}
                                                            cx="50%"
                                                            cy="45%"
                                                            innerRadius={55}
                                                            outerRadius={78}
                                                            paddingAngle={3}
                                                            dataKey="value"
                                                            strokeWidth={0}
                                                        >
                                                            {dadosSentimento.map((entry, i) => (
                                                                <Cell key={i} fill={entry.color} />
                                                            ))}
                                                        </Pie>
                                                        <Tooltip contentStyle={TOOLTIP_STYLE} />
                                                        <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: "11px" }} />
                                                    </PieChart>
                                                </ResponsiveContainer>
                                                <div className="absolute top-0 left-0 right-0 flex items-center justify-center pointer-events-none" style={{ height: "77%" }}>
                                                    <div className="text-center">
                                                        <div className="text-2xl font-bold">{analisados.length}</div>
                                                        <div className="text-[10px] text-muted-foreground">analisados</div>
                                                    </div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">Sem dados de sentimento</div>
                                        )}
                                    </div>

                                    {/* Barras por unidade */}
                                    {dadosPorUnidade.length > 0 && (
                                        <div className="border rounded-xl p-5 bg-card">
                                            <p className="text-sm font-semibold mb-4 flex items-center gap-2">
                                                <BarChart2 className="h-4 w-4 text-indigo-500" /> Por Unidade
                                            </p>
                                            <ResponsiveContainer width="100%" height={200}>
                                                <BarChart data={dadosPorUnidade} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                                                    <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06} />
                                                    <XAxis dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                                                    <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                                                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                                                    <Legend iconType="circle" iconSize={7} wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
                                                    <Bar dataKey="criticas" name="Críticas" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                                                    <Bar dataKey="sugestoes" name="Sugestões" fill="#10b981" radius={[4, 4, 0, 0]} />
                                                </BarChart>
                                            </ResponsiveContainer>
                                        </div>
                                    )}
                                </div>

                                {/* Temas mais frequentes */}
                                {dadosTemas.length > 0 && (
                                    <div className="border rounded-xl p-5 bg-card">
                                        <p className="text-sm font-semibold mb-4 flex items-center gap-2">
                                            <Tag className="h-4 w-4 text-indigo-500" /> Temas Mais Frequentes
                                        </p>
                                        <div className="space-y-2">
                                            {dadosTemas.map(({ tema, total }) => {
                                                const pct = Math.round((total / analisados.length) * 100)
                                                return (
                                                    <div key={tema} className="flex items-center gap-3">
                                                        <span className="text-sm w-40 truncate text-muted-foreground capitalize">{tema}</span>
                                                        <div className="flex-1 bg-muted rounded-full h-2 overflow-hidden">
                                                            <div
                                                                className="h-full bg-indigo-500 rounded-full transition-all"
                                                                style={{ width: `${pct}%` }}
                                                            />
                                                        </div>
                                                        <span className="text-xs font-semibold w-6 text-right">{total}</span>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                    </TabsContent>

                    {/* ── CRÍTICAS ── */}
                    <TabsContent value="criticas">
                        {criticas.length === 0 ? (
                            <div className="text-center py-16 text-muted-foreground border rounded-xl bg-card">
                                <MessageSquareWarning className="h-10 w-10 mx-auto mb-3 opacity-20" />
                                <p>Nenhuma crítica registrada ainda.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {criticas.map(r => <ResumoCard key={r.id} r={r} />)}
                            </div>
                        )}
                    </TabsContent>

                    {/* ── SUGESTÕES ── */}
                    <TabsContent value="sugestoes">
                        {sugestoes.length === 0 ? (
                            <div className="text-center py-16 text-muted-foreground border rounded-xl bg-card">
                                <Lightbulb className="h-10 w-10 mx-auto mb-3 opacity-20" />
                                <p>Nenhuma sugestão registrada ainda.</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {sugestoes.map(r => <ResumoCard key={r.id} r={r} />)}
                            </div>
                        )}
                    </TabsContent>

                    {/* ── CONVERSAS SOFIA ── */}
                    {/* NOTA: Quando a instância "ouvidoriaredecuca" for criada no banco,
                        substituir filterAgenteTipo por: filterCanalTipo="Ouvidoria"
                        Constante estável declarada fora do componente para não recriar canal Realtime */}
                    <TabsContent value="conversas" className="mt-0">
                        <div className="flex h-[calc(100vh-14rem)] overflow-hidden border rounded-xl bg-background">
                            <div className="w-80 flex-shrink-0 h-full border-r">
                                <ChatSidebar
                                    activeConversationId={activeConversationId}
                                    onSelectConversation={setActiveConversationId}
                                    filterAgenteTipo={SOFIA_AGENTE_TIPOS}
                                    title="Ouvidoria — Sofia"
                                />
                            </div>
                            <div className="flex-1 h-full relative">
                                <ChatWindow conversationId={activeConversationId} />
                            </div>
                        </div>
                    </TabsContent>

                    {/* ── CANAL WHATSAPP ── */}
                    {isSuperAdmin && (
                        <TabsContent value="canal-whatsapp">
                            <CanalWhatsappTab modulo="Ouvidoria" />
                        </TabsContent>
                    )}
                </Tabs>
            )}

            {/* Modal de Detalhamento */}
            <Dialog open={!!detalhamento} onOpenChange={() => setDetalhamento(null)}>
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            {detalhamento?.tipo === "critica" ? <MessageSquareWarning className="h-5 w-5 text-amber-500" /> : <Lightbulb className="h-5 w-5 text-emerald-500" />}
                            {detalhamento?.tipo === "critica" ? "Detalhe da Crítica" : "Detalhe da Sugestão"}
                        </DialogTitle>
                        <DialogDescription className="sr-only">Visualização completa da manifestação enviada para a Ouvidoria.</DialogDescription>
                    </DialogHeader>

                    {detalhamento && (
                        <div className="space-y-4 pt-2">
                            <div className="flex flex-wrap gap-2 mb-2">
                                {detalhamento.protocolo && (
                                    <Badge className="bg-primary/10 text-primary border-primary/20 hover:bg-primary/20">
                                        Protocolo: {detalhamento.protocolo}
                                    </Badge>
                                )}
                                {detalhamento.anonimo ? (
                                    <Badge variant="outline" className="bg-slate-100 text-slate-600"><UserX className="h-3 w-3 mr-1" /> Anônimo</Badge>
                                ) : (
                                    <Badge variant="outline" className="bg-blue-50 text-blue-700"><User className="h-3 w-3 mr-1" /> Identificado</Badge>
                                )}
                                {detalhamento.unidade_cuca && (
                                    <Badge variant="outline"><Building2 className="h-3 w-3 mr-1" /> CUCA {detalhamento.unidade_cuca}</Badge>
                                )}
                                <Badge variant="outline"><Calendar className="h-3 w-3 mr-1" /> {format(new Date(detalhamento.created_at), "dd/MM/yyyy HH:mm")}</Badge>
                            </div>

                            {/* S13-04: dados visíveis apenas para Super Admin */}
                            {!detalhamento.anonimo && isSuperAdmin && (
                                <div className="p-3 bg-muted/40 rounded-lg border border-border/50 text-sm">
                                    <p><span className="text-muted-foreground mr-2">Nome:</span> {detalhamento.nome_solicitante || "Não informado"}</p>
                                    <p><span className="text-muted-foreground mr-2">Telefone:</span> {detalhamento.telefone_solicitante || "Não informado"}</p>
                                </div>
                            )}
                            {!detalhamento.anonimo && !isSuperAdmin && (
                                <div className="p-3 bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-700 flex items-center gap-2">
                                    <User className="h-4 w-4 shrink-0" />
                                    <span>Manifestação identificada. Dados do solicitante restritos a Super Administradores.</span>
                                </div>
                            )}

                            {detalhamento.ouvidoria_eventos && (
                                <div className="p-3 bg-primary/5 rounded-lg border border-primary/10 text-sm">
                                    <p className="font-medium text-primary flex items-center gap-2">
                                        <Activity className="h-4 w-4" /> Origem: {detalhamento.ouvidoria_eventos.titulo}
                                    </p>
                                </div>
                            )}

                            <div className="mt-4">
                                <Label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Mensagem Original</Label>
                                <div className="p-4 bg-muted/30 rounded-xl whitespace-pre-wrap text-sm border font-medium">
                                    "{detalhamento.texto_manifestacao}"
                                </div>
                            </div>

                            {detalhamento.resumo_ia && (
                                <div className="mt-4 p-4 bg-indigo-50 border border-indigo-100 rounded-xl relative overflow-hidden">
                                    <div className="absolute top-0 right-0 p-3 opacity-10">
                                        <Sparkles className="h-16 w-16 text-indigo-500" />
                                    </div>
                                    <Label className="text-xs text-indigo-700/70 uppercase tracking-wider mb-2 flex items-center gap-1.5 relative z-10">
                                        <Sparkles className="h-3.5 w-3.5" /> Análise de IA
                                    </Label>
                                    <div className="relative z-10 space-y-3">
                                        <div>
                                            <p className="text-xs font-semibold text-indigo-900 mb-1">Resumo Sintético</p>
                                            <p className="text-sm text-indigo-800">{detalhamento.resumo_ia}</p>
                                        </div>
                                        {detalhamento.temas_identificados && detalhamento.temas_identificados.length > 0 && (
                                            <div>
                                                <p className="text-xs font-semibold text-indigo-900 mb-1.5">Temas Identificados</p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {detalhamento.temas_identificados.map(t => (
                                                        <Badge key={t} variant="secondary" className="bg-white/60 text-indigo-900 border-indigo-200 text-[10px]">{t}</Badge>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {!detalhamento.resumo_ia && hasPermission("ouvidoria_painel", "update") && (
                                <div className="mt-4 flex justify-center">
                                    <Button
                                        onClick={() => handleAnalyseSentiment(detalhamento)}
                                        disabled={analysing}
                                        className="w-full bg-indigo-600 hover:bg-indigo-700"
                                    >
                                        {analysing ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analisando...</> : <><Sparkles className="h-4 w-4 mr-2" /> Analisar com IA Sofia</>}
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}
