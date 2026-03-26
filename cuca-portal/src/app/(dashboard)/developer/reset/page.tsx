"use client"

import { useState } from "react"
import { Trash2, TriangleAlert, CheckCircle2, Loader2, ArrowLeft, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import Link from "next/link"

type ResetResult = {
    success: boolean
    executed_at: string
    mensagens: number
    conversas: number
    transbordo: number
    logs_webhook: number
}

export default function ResetAutomacaoPage() {
    const [loading, setLoading] = useState(false)
    const [result, setResult] = useState<ResetResult | null>(null)
    const [error, setError] = useState<string | null>(null)

    async function handleReset() {
        setLoading(true)
        setResult(null)
        setError(null)

        try {
            const res = await fetch("/api/developer/reset-automation-memory", { method: "POST" })
            const data = await res.json()

            if (!res.ok) {
                setError(data.error ?? "Erro desconhecido")
            } else {
                setResult(data)
            }
        } catch (e) {
            setError(String(e))
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex flex-col gap-6 max-w-2xl">
            {/* Header */}
            <div className="flex items-center gap-3">
                <Link href="/developer">
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                </Link>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10">
                    <RefreshCw className="h-5 w-5 text-destructive" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Reset de Automações</h1>
                    <p className="text-sm text-muted-foreground">
                        Zera mensagens e memórias de todas as automações para testes
                    </p>
                </div>
            </div>

            {/* Aviso */}
            <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                <TriangleAlert className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                <div className="text-sm">
                    <p className="font-medium text-amber-500">Ação irreversível — dados de produção serão apagados</p>
                    <p className="text-muted-foreground mt-1">
                        Esta ação remove <strong>todas as mensagens</strong>, <strong>conversas</strong>,{" "}
                        <strong>fila de transbordo</strong> e <strong>logs de webhook</strong>.
                        Dados de leads, vagas, empresas e campanhas <strong>não são afetados</strong>.
                    </p>
                </div>
            </div>

            {/* O que será apagado */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-sm">O que será apagado</CardTitle>
                    <CardDescription className="text-xs">Tabelas limpas pelo reset</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-2 text-sm">
                    {[
                        { label: "mensagens", desc: "Histórico de todas as conversas" },
                        { label: "conversas", desc: "Estado e memória de workflow" },
                        { label: "transbordo_humano", desc: "Fila de atendimento humano" },
                        { label: "logs_webhook", desc: "Logs de eventos UAZAPI" },
                    ].map((t) => (
                        <div key={t.label} className="flex flex-col gap-0.5 rounded-md border border-destructive/20 bg-destructive/5 p-2">
                            <span className="font-mono text-xs font-semibold text-destructive">{t.label}</span>
                            <span className="text-xs text-muted-foreground">{t.desc}</span>
                        </div>
                    ))}
                </CardContent>
            </Card>

            {/* Cron info */}
            <Card>
                <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">Cron automático</CardTitle>
                        <Badge variant="default" className="text-xs">Ativo</Badge>
                    </div>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-1">
                    <p>
                        O reset roda <strong>automaticamente todo dia às 00:00 (Horário de Brasília)</strong> via pg_cron.
                    </p>
                    <p className="text-xs font-mono bg-muted/40 rounded px-2 py-1">
                        Cron: <span className="text-primary">0 3 * * *</span> UTC → <span className="text-green-400">00:00 BRT</span>
                    </p>
                </CardContent>
            </Card>

            {/* Botão de reset manual */}
            <AlertDialog>
                <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="lg" disabled={loading} className="w-full">
                        {loading ? (
                            <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Zerando...</>
                        ) : (
                            <><Trash2 className="mr-2 h-4 w-4" /> Zerar Mensagens e Memórias Agora</>
                        )}
                    </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Confirmar reset de automações?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Isso irá apagar <strong>permanentemente</strong> todas as mensagens, conversas,
                            transbordo e logs de webhook. Esta ação <strong>não pode ser desfeita</strong>.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={handleReset}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            Sim, zerar tudo
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* Resultado */}
            {result && (
                <div className="flex flex-col gap-3 rounded-lg border border-green-500/30 bg-green-500/10 p-4">
                    <div className="flex items-center gap-2 text-green-400">
                        <CheckCircle2 className="h-5 w-5" />
                        <span className="font-semibold text-sm">Reset concluído com sucesso</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm">
                        {[
                            { label: "Mensagens removidas", value: result.mensagens },
                            { label: "Conversas removidas", value: result.conversas },
                            { label: "Transbordo limpo", value: result.transbordo },
                            { label: "Logs webhook limpos", value: result.logs_webhook },
                        ].map((r) => (
                            <div key={r.label} className="rounded-md bg-green-500/10 border border-green-500/20 p-2">
                                <p className="text-xs text-muted-foreground">{r.label}</p>
                                <p className="font-bold text-green-400">{r.value}</p>
                            </div>
                        ))}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Executado em: {new Date(result.executed_at).toLocaleString("pt-BR")}
                    </p>
                </div>
            )}

            {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
                    <strong>Erro:</strong> {error}
                </div>
            )}
        </div>
    )
}
