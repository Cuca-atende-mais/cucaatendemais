"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import {
    MessageSquareWarning, Lightbulb, PieChart, Activity, UserX, User, Building2,
    Calendar, CheckCircle2, AlertCircle, HelpCircle, Loader2, Sparkles, Phone,
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
import { ptBR } from "date-fns/locale"
import { cn } from "@/lib/utils"
import toast from "react-hot-toast"
import { useUser } from "@/lib/auth/user-provider"

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
    positivo: { label: "Positivo", color: "bg-emerald-500/10 text-emerald-600 border-emerald-200", icon: CheckCircle2 },
    negativo: { label: "Negativo", color: "bg-red-500/10 text-red-600 border-red-200", icon: AlertCircle },
    neutro: { label: "Neutro", color: "bg-slate-100 text-slate-500 border-slate-200", icon: HelpCircle },
}

export default function OuvidoriaPage() {
    const supabase = createClient()
    const [registros, setRegistros] = useState<OuvidoriaRegistro[]>([])
    const [loading, setLoading] = useState(true)
    const [detalhamento, setDetalhamento] = useState<OuvidoriaRegistro | null>(null)
    const [analysing, setAnalysing] = useState(false)
    const { hasPermission } = useUser()

    useEffect(() => { fetchRegistros() }, [])

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
                body: JSON.stringify({
                    registro_id: registro.id,
                    texto: registro.texto_manifestacao
                })
            })
            if (!res.ok) throw new Error("Erro na análise")
            const result = await res.json()
            toast.success("Análise concluída!")

            // Atualizar estado local
            setDetalhamento({
                ...registro,
                sentimento: result.sentimento,
                resumo_ia: result.resumo_ia,
                temas_identificados: result.temas
            })
            fetchRegistros()
        } catch (error) {
            toast.error("Falha ao analisar sentimento")
        } finally {
            setAnalysing(false)
        }
    }

    const criticas = registros.filter(r => r.tipo === "critica")
    const sugestoes = registros.filter(r => r.tipo === "sugestao")

    const ResumoCard = ({ r }: { r: OuvidoriaRegistro }) => {
        const sent = r.sentimento ? SENTIMENTO_CONFIG[r.sentimento] : null
        const SentIcon = sent?.icon

        return (
            <div
                className="border rounded-xl p-4 bg-card hover:shadow-md transition-all cursor-pointer relative overflow-hidden"
                onClick={() => setDetalhamento(r)}
            >
                {/* Faixa lateral de sentimento */}
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
                        {hasPermission("super_admin") && (
                            <TabsTrigger value="canal-whatsapp" className="gap-2">
                                <Phone className="h-4 w-4" /> Canal WhatsApp
                            </TabsTrigger>
                        )}
                    </TabsList>

                    <TabsContent value="overview">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                            <div className="border rounded-xl p-5 bg-card">
                                <p className="text-sm font-medium text-muted-foreground mb-1">Total de Manifestações</p>
                                <p className="text-3xl font-bold">{registros.length}</p>
                            </div>
                            <div className="border rounded-xl p-5 bg-card">
                                <p className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
                                    <MessageSquareWarning className="h-4 w-4 text-amber-500" /> Críticas (Maioria Anônima)
                                </p>
                                <p className="text-3xl font-bold">{criticas.length}</p>
                            </div>
                            <div className="border rounded-xl p-5 bg-card">
                                <p className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-2">
                                    <Lightbulb className="h-4 w-4 text-emerald-500" /> Sugestões (Identificadas)
                                </p>
                                <p className="text-3xl font-bold">{sugestoes.length}</p>
                            </div>
                        </div>

                        <div className="border rounded-xl p-5 bg-card flex flex-col items-center justify-center py-16 text-muted-foreground">
                            <PieChart className="h-12 w-12 mb-4 opacity-20" />
                            <p className="font-medium text-lg text-foreground/70">Análise de IA & Dashboards em breve</p>
                            <p className="text-sm max-w-sm text-center mt-2">Os resumos executivos, nuvem de palavras e classificação de sentimento em lote (S13-11/12) estarão disponíveis aqui ao rodar a análise de lote via Edge Function.</p>
                        </div>
                    </TabsContent>

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

                    {/* Aba exclusiva Super Admin: Canal WhatsApp da Ouvidoria */}
                    {hasPermission("super_admin") && (
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
                            {/* Meta Informações */}
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

                            {/* Informações do Solicitante (se houver) */}
                            {!detalhamento.anonimo && (
                                <div className="p-3 bg-muted/40 rounded-lg border border-border/50 text-sm">
                                    <p><span className="text-muted-foreground mr-2">Nome:</span> {detalhamento.nome_solicitante || "Não informado"}</p>
                                    <p><span className="text-muted-foreground mr-2">Telefone:</span> {detalhamento.telefone_solicitante || "Não informado"}</p>
                                </div>
                            )}

                            {detalhamento.ouvidoria_eventos && (
                                <div className="p-3 bg-primary/5 rounded-lg border border-primary/10 text-sm">
                                    <p className="font-medium text-primary flex items-center gap-2">
                                        <Activity className="h-4 w-4" /> Origem: {detalhamento.ouvidoria_eventos.titulo}
                                    </p>
                                </div>
                            )}

                            {/* Texto Original */}
                            <div className="mt-4">
                                <Label className="text-xs text-muted-foreground uppercase tracking-wider mb-2 block">Mensagem Original</Label>
                                <div className="p-4 bg-muted/30 rounded-xl whitespace-pre-wrap text-sm border font-medium">
                                    "{detalhamento.texto_manifestacao}"
                                </div>
                            </div>

                            {/* Análise de IA (se houver) */}
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

                            {/* Ações */}
                            {!detalhamento.resumo_ia && hasPermission("ouvidoria", "update") && (
                                <div className="mt-4 flex justify-center">
                                    <Button
                                        onClick={() => handleAnalyseSentiment(detalhamento)}
                                        disabled={analysing}
                                        className="w-full bg-indigo-600 hover:bg-indigo-700"
                                    >
                                        {analysing ? (
                                            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analisando...</>
                                        ) : (
                                            <><Sparkles className="h-4 w-4 mr-2" /> Analisar com IA Sofia</>
                                        )}
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
