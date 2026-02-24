"use client"

import { useState, useEffect } from "react"
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs"
import { DollarSign, TrendingUp, BarChart2, Loader2, AlertTriangle } from "lucide-react"
import { cn } from "@/lib/utils"

type UsageRow = {
    feature: string
    modelo: string
    agente_tipo: string
    tokens_total: number
    custo_estimado_usd: number
    created_at: string
}

const FEATURE_LABEL: Record<string, string> = {
    chat: "Chat / Resposta IA",
    transcription: " Transcrição (Whisper)",
    embedding: "Embedding (RAG)",
    sentiment: "Análise de Sentimento",
    ocr: "OCR / Documento",
}

export default function DevConsumoPage() {
    const supabase = createClientComponentClient()
    const [rows, setRows] = useState<UsageRow[]>([])
    const [budget, setBudget] = useState<number>(50)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        Promise.all([fetchUsage(), fetchBudget()]).then(() => setLoading(false))
    }, [])

    const fetchUsage = async () => {
        const { data } = await supabase
            .from("ai_usage_logs")
            .select("feature, modelo, agente_tipo, tokens_total, custo_estimado_usd, created_at")
            .gte("created_at", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString())
            .order("created_at", { ascending: false })
        setRows(data || [])
    }

    const fetchBudget = async () => {
        const { data } = await supabase.from("system_config").select("valor").eq("chave", "openai_budget_mensal_usd").single()
        if (data) setBudget(parseFloat(data.valor))
    }

    const totalCusto = rows.reduce((acc, r) => acc + (r.custo_estimado_usd || 0), 0)
    const totalTokens = rows.reduce((acc, r) => acc + (r.tokens_total || 0), 0)
    const pctBudget = Math.min((totalCusto / budget) * 100, 100)

    const byFeature = rows.reduce((acc, r) => {
        const k = r.feature || "chat"
        acc[k] = (acc[k] || 0) + (r.custo_estimado_usd || 0)
        return acc
    }, {} as Record<string, number>)

    const byAgente = rows.reduce((acc, r) => {
        const k = r.agente_tipo || "desconhecido"
        acc[k] = (acc[k] || 0) + (r.tokens_total || 0)
        return acc
    }, {} as Record<string, number>)

    if (loading) return <div className="flex justify-center py-40"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>

    return (
        <div className="space-y-6 p-4 md:p-6">
            <div>
                <h1 className="text-2xl font-bold flex items-center gap-2"><DollarSign className="h-6 w-6 text-primary" /> Consumo OpenAI</h1>
                <p className="text-sm text-muted-foreground mt-1">Monitoramento de tokens e custo estimado no mês atual.</p>
            </div>

            {/* Cards Totais */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="border rounded-xl p-5 bg-card">
                    <p className="text-sm text-muted-foreground mb-1">Custo Total (mês)</p>
                    <p className="text-3xl font-bold">${totalCusto.toFixed(4)}</p>
                    <p className="text-xs text-muted-foreground mt-1">Budget: ${budget.toFixed(2)}/mês</p>
                </div>
                <div className="border rounded-xl p-5 bg-card">
                    <p className="text-sm text-muted-foreground mb-1">Tokens Consumidos</p>
                    <p className="text-3xl font-bold">{totalTokens.toLocaleString("pt-BR")}</p>
                    <p className="text-xs text-muted-foreground mt-1">{rows.length} chamadas este mês</p>
                </div>
                <div className={cn("border rounded-xl p-5 bg-card", pctBudget >= 80 && "border-amber-400", pctBudget >= 100 && "border-destructive")}>
                    <p className="text-sm text-muted-foreground mb-1 flex items-center gap-2">
                        {pctBudget >= 80 && <AlertTriangle className="h-4 w-4 text-amber-500" />}
                        % do Budget Usado
                    </p>
                    <p className={cn("text-3xl font-bold", pctBudget >= 100 ? "text-destructive" : pctBudget >= 80 ? "text-amber-500" : "")}>
                        {pctBudget.toFixed(1)}%
                    </p>
                    <div className="mt-2 w-full bg-muted rounded-full h-2">
                        <div
                            className={cn("h-2 rounded-full", pctBudget >= 100 ? "bg-destructive" : pctBudget >= 80 ? "bg-amber-500" : "bg-primary")}
                            style={{ width: `${pctBudget}%` }}
                        />
                    </div>
                </div>
            </div>

            {/* Breakdown por feature */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="border rounded-xl p-5 bg-card">
                    <p className="font-semibold mb-4 flex items-center gap-2"><BarChart2 className="h-5 w-5 text-primary" /> Custo por Feature</p>
                    {Object.keys(byFeature).length === 0 && <p className="text-muted-foreground text-sm">Sem dados ainda neste mês.</p>}
                    <div className="space-y-3">
                        {Object.entries(byFeature).sort((a, b) => b[1] - a[1]).map(([feature, custo]) => (
                            <div key={feature}>
                                <div className="flex justify-between text-sm mb-1">
                                    <span>{FEATURE_LABEL[feature] || feature}</span>
                                    <span className="font-mono">${custo.toFixed(4)}</span>
                                </div>
                                <div className="w-full bg-muted rounded-full h-1.5">
                                    <div className="h-1.5 rounded-full bg-primary" style={{ width: `${totalCusto > 0 ? (custo / totalCusto) * 100 : 0}%` }} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="border rounded-xl p-5 bg-card">
                    <p className="font-semibold mb-4 flex items-center gap-2"><TrendingUp className="h-5 w-5 text-primary" /> Tokens por Agente</p>
                    {Object.keys(byAgente).length === 0 && <p className="text-muted-foreground text-sm">Sem dados ainda neste mês.</p>}
                    <div className="space-y-3">
                        {Object.entries(byAgente).sort((a, b) => b[1] - a[1]).map(([agente, tokens]) => (
                            <div key={agente}>
                                <div className="flex justify-between text-sm mb-1">
                                    <span className="capitalize">{agente}</span>
                                    <span className="font-mono">{tokens.toLocaleString("pt-BR")} tok</span>
                                </div>
                                <div className="w-full bg-muted rounded-full h-1.5">
                                    <div className="h-1.5 rounded-full bg-indigo-500" style={{ width: `${totalTokens > 0 ? (tokens / totalTokens) * 100 : 0}%` }} />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {rows.length === 0 && (
                <div className="border rounded-xl p-10 text-center text-muted-foreground bg-card">
                    <DollarSign className="h-10 w-10 mx-auto mb-3 opacity-20" />
                    <p>Nenhum registro de consumo ainda. O registro automático acontece a cada chamada ao motor-agente.</p>
                </div>
            )}
        </div>
    )
}
