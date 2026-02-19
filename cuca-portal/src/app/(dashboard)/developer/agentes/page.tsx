"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Loader2, Bot, Lock, Thermometer, Hash } from "lucide-react"

type Agente = {
    id: string
    agente_tipo: string
    nome: string
    prompt_sistema: string
    prompt_contexto: string | null
    temperatura: number
    max_tokens: number
    versao: number
    ativo: boolean
}

const CANAL_MAP: Record<string, string> = {
    maria: "Canais #7-12 (Pontual + Mensal)",
    julia: "Canais #1-6 (Empregabilidade)",
    ana: "Canal #14 (Acesso CUCA)",
    sofia: "Canal #13 (Ouvidoria)",
}

const BADGE_COLORS: Record<string, string> = {
    maria: "bg-purple-500/20 text-purple-400 border-purple-500/30",
    julia: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    ana: "bg-green-500/20 text-green-400 border-green-500/30",
    sofia: "bg-amber-500/20 text-amber-400 border-amber-500/30",
}

export default function AgentesPage() {
    const [agentes, setAgentes] = useState<Agente[]>([])
    const [loading, setLoading] = useState(true)
    const [expandido, setExpandido] = useState<Record<string, boolean>>({})
    const supabase = createClient()

    useEffect(() => {
        async function carregarAgentes() {
            const { data } = await supabase
                .from("prompts_agentes")
                .select("*")
                .order("agente_tipo")
            setAgentes(data || [])
            setLoading(false)
        }
        carregarAgentes()
    }, [])

    if (loading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <Bot className="h-5 w-5 text-primary" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Agentes de IA</h1>
                    <p className="text-sm text-muted-foreground">
                        Visualização dos prompts ativos — somente leitura
                    </p>
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <Lock className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">Prompts são código (migrations SQL)</span>
                </div>
            </div>

            {/* Info Box */}
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
                <p className="font-medium">Estrutura de 3 Camadas por Agente:</p>
                <div className="mt-2 grid grid-cols-3 gap-3 text-xs text-muted-foreground">
                    <div className="rounded border p-2">
                        <p className="font-semibold text-foreground">Camada 1 — Persona</p>
                        <p>Personalidade, missão, tom de voz do agente</p>
                    </div>
                    <div className="rounded border p-2">
                        <p className="font-semibold text-foreground">Camada 2 — Técnica</p>
                        <p>Regras de comportamento, handover, opt-out</p>
                    </div>
                    <div className="rounded border p-2">
                        <p className="font-semibold text-foreground">Camada 3 — RAG</p>
                        <p>Contexto dinâmico injetado na hora da resposta</p>
                    </div>
                </div>
            </div>

            {/* Lista de Agentes */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {agentes.map((agente) => (
                    <Card key={agente.id} className="overflow-hidden">
                        <CardHeader className="pb-3">
                            <div className="flex items-start justify-between">
                                <div>
                                    <CardTitle className="text-base">{agente.nome}</CardTitle>
                                    <CardDescription className="text-xs mt-1">
                                        {CANAL_MAP[agente.agente_tipo] || "Canal não mapeado"}
                                    </CardDescription>
                                </div>
                                <div className="flex flex-col items-end gap-1">
                                    <Badge
                                        variant="outline"
                                        className={`text-xs ${BADGE_COLORS[agente.agente_tipo] || ""}`}
                                    >
                                        {agente.agente_tipo.toUpperCase()}
                                    </Badge>
                                    <Badge variant={agente.ativo ? "default" : "secondary"} className="text-xs">
                                        v{agente.versao} {agente.ativo ? "• Ativo" : "• Inativo"}
                                    </Badge>
                                </div>
                            </div>

                            {/* Parâmetros */}
                            <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1">
                                    <Thermometer className="h-3 w-3" />
                                    temp: {agente.temperatura}
                                </span>
                                <span className="flex items-center gap-1">
                                    <Hash className="h-3 w-3" />
                                    max tokens: {agente.max_tokens}
                                </span>
                            </div>
                        </CardHeader>

                        <CardContent>
                            {/* Camada 1: Persona */}
                            <div className="mb-3">
                                <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-semibold text-primary">CAMADA 1 — PERSONA</span>
                                    <button
                                        className="text-xs text-muted-foreground hover:text-foreground"
                                        onClick={() => setExpandido(prev => ({
                                            ...prev,
                                            [`${agente.id}_persona`]: !prev[`${agente.id}_persona`]
                                        }))}
                                    >
                                        {expandido[`${agente.id}_persona`] ? "Recolher" : "Expandir"}
                                    </button>
                                </div>
                                <div className={`relative overflow-hidden rounded bg-muted/50 p-3 text-xs font-mono leading-relaxed whitespace-pre-wrap ${!expandido[`${agente.id}_persona`] ? "max-h-24" : ""}`}>
                                    {agente.prompt_sistema}
                                    {!expandido[`${agente.id}_persona`] && (
                                        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-muted/80 to-transparent" />
                                    )}
                                </div>
                            </div>

                            {/* Camada 2: Técnica */}
                            {agente.prompt_contexto && (
                                <div className="mb-3">
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="text-xs font-semibold text-amber-500">CAMADA 2 — TÉCNICA</span>
                                        <button
                                            className="text-xs text-muted-foreground hover:text-foreground"
                                            onClick={() => setExpandido(prev => ({
                                                ...prev,
                                                [`${agente.id}_tecnica`]: !prev[`${agente.id}_tecnica`]
                                            }))}
                                        >
                                            {expandido[`${agente.id}_tecnica`] ? "Recolher" : "Expandir"}
                                        </button>
                                    </div>
                                    <div className={`relative overflow-hidden rounded bg-muted/50 p-3 text-xs font-mono leading-relaxed whitespace-pre-wrap ${!expandido[`${agente.id}_tecnica`] ? "max-h-24" : ""}`}>
                                        {agente.prompt_contexto}
                                        {!expandido[`${agente.id}_tecnica`] && (
                                            <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-muted/80 to-transparent" />
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Camada 3: RAG (dinâmica) */}
                            <div>
                                <span className="text-xs font-semibold text-green-500">CAMADA 3 — RAG</span>
                                <div className="mt-1 rounded bg-muted/50 p-3 text-xs text-muted-foreground italic">
                                    Contexto dinâmico — injetado automaticamente pelo motor a cada resposta com base na pergunta do jovem.
                                    Não é editável aqui.
                                </div>
                            </div>
                        </CardContent>
                    </Card>
                ))}
            </div>
        </div>
    )
}
