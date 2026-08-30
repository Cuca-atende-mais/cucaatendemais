"use client"

import { useState, useEffect } from "react"
import { MessageSquare, TriangleAlert, Loader2, ArrowLeft, Link2, CheckCircle2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import Link from "next/link"

export default function FluxoSemLinkPage() {
    const [ativo, setAtivo] = useState(false)
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        void carregar()
    }, [])

    async function carregar() {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch("/api/developer/fluxo-sem-link")
            const data = await res.json()
            if (!res.ok) {
                setError(data.error ?? "Erro ao carregar estado")
            } else {
                setAtivo(Boolean(data.ativo))
            }
        } catch (e) {
            setError(String(e))
        } finally {
            setLoading(false)
        }
    }

    async function alternar(novoValor: boolean) {
        const mensagem = novoValor
            ? "LIGAR o fluxo sem link? A partir de agora, os candidatos concluem a candidatura DENTRO do WhatsApp, sem receber link. Isso muda o comportamento em produção imediatamente."
            : "DESLIGAR o fluxo sem link? Os candidatos voltam a receber o link do formulário, exatamente como antes (rollback)."
        if (!window.confirm(mensagem)) return

        setSaving(true)
        setError(null)
        try {
            const res = await fetch("/api/developer/fluxo-sem-link", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ativo: novoValor }),
            })
            const data = await res.json()
            if (!res.ok) {
                setError(data.error ?? "Erro ao salvar")
            } else {
                setAtivo(Boolean(data.ativo))
            }
        } catch (e) {
            setError(String(e))
        } finally {
            setSaving(false)
        }
    }

    return (
        <div className="flex flex-col gap-6 max-w-2xl">
            <div>
                <Link href="/developer" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
                    <ArrowLeft className="h-4 w-4" />
                    Developer Console
                </Link>
            </div>

            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <MessageSquare className="h-5 w-5 text-primary" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Fluxo sem link</h1>
                    <p className="text-sm text-muted-foreground">
                        Candidatura 100% dentro do WhatsApp — interruptor com rollback imediato
                    </p>
                </div>
            </div>

            <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                <TriangleAlert className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                <div className="text-sm">
                    <p className="font-medium text-amber-500">Muda o comportamento em produção na hora</p>
                    <p className="text-muted-foreground mt-1">
                        <strong>Desligado (padrão):</strong> o candidato recebe o link do formulário, como sempre.<br />
                        <strong>Ligado:</strong> o candidato responde as perguntas e envia o currículo dentro da própria
                        conversa do WhatsApp, sem link. Desligar aqui volta tudo ao link na hora (rollback).
                    </p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between gap-4">
                        <div>
                            <CardTitle className="flex items-center gap-2 text-base">
                                {ativo ? <MessageSquare className="h-4 w-4 text-primary" /> : <Link2 className="h-4 w-4 text-muted-foreground" />}
                                {ativo ? "Fluxo sem link LIGADO" : "Fluxo sem link DESLIGADO"}
                            </CardTitle>
                            <CardDescription className="mt-1">
                                {ativo
                                    ? "Candidatos estão concluindo a candidatura dentro do WhatsApp."
                                    : "Candidatos estão recebendo o link do formulário (comportamento padrão)."}
                            </CardDescription>
                        </div>
                        {loading ? (
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        ) : (
                            <div className="flex items-center gap-2">
                                {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                                <Switch
                                    checked={ativo}
                                    disabled={saving || loading}
                                    onCheckedChange={(v) => void alternar(v)}
                                    aria-label="Ligar ou desligar o fluxo sem link"
                                />
                            </div>
                        )}
                    </div>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center gap-2">
                        <Badge variant={ativo ? "default" : "secondary"}>
                            {ativo ? "Ativo" : "Inativo"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">S-EMP-FSL-01</span>
                    </div>
                    {error && (
                        <p className="mt-3 text-sm text-destructive">{error}</p>
                    )}
                    {!error && !loading && (
                        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                            Estado persistido — vale sem novo deploy; o worker lê a cada conversa.
                        </p>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
