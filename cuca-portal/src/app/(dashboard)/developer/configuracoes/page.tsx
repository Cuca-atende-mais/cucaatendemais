"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { ArrowLeft, Save, Settings2, ShieldAlert, Timer } from "lucide-react"
import Link from "next/link"
import toast from "react-hot-toast"

export default function ConfigSystemPage() {
    const [loading, setLoading] = useState(false)
    const [fetching, setFetching] = useState(true)

    // Configs Anti-Ban
    const [delayMin, setDelayMin] = useState("2000")
    const [delayMax, setDelayMax] = useState("5000")
    const [dailyLimit, setDailyLimit] = useState("500")
    const [errorThreshold, setErrorThreshold] = useState("10") // Porcentagem de erros para parar

    const supabase = createClient()

    useEffect(() => {
        carregarConfiguracoes()
    }, [])

    const carregarConfiguracoes = async () => {
        setFetching(true)
        try {
            const keysToFetch = ['anti_ban_delay_min', 'anti_ban_delay_max', 'anti_ban_daily_limit', 'anti_ban_error_threshold']

            const { data } = await supabase.from('configuracoes').select('chave, valor').in('chave', keysToFetch)

            if (data && data.length > 0) {
                const map: Record<string, string> = {}
                data.forEach(item => map[item.chave] = item.valor?.toString() || "")

                if (map['anti_ban_delay_min']) setDelayMin(map['anti_ban_delay_min'])
                if (map['anti_ban_delay_max']) setDelayMax(map['anti_ban_delay_max'])
                if (map['anti_ban_daily_limit']) setDailyLimit(map['anti_ban_daily_limit'])
                if (map['anti_ban_error_threshold']) setErrorThreshold(map['anti_ban_error_threshold'])
            }
        } catch (error) {
            console.error("Erro ao carregar configurações:", error)
        } finally {
            setFetching(false)
        }
    }

    const salvarConfiguracoes = async () => {
        setLoading(true)
        try {
            const configs = [
                { chave: 'anti_ban_delay_min', valor: parseInt(delayMin), descricao: 'Delay mínimo entre mensagens (ms)' },
                { chave: 'anti_ban_delay_max', valor: parseInt(delayMax), descricao: 'Delay máximo entre mensagens (ms)' },
                { chave: 'anti_ban_daily_limit', valor: parseInt(dailyLimit), descricao: 'Limite diário de mensagens por instância (Warm-up)' },
                { chave: 'anti_ban_error_threshold', valor: parseInt(errorThreshold), descricao: 'Taxa de erro (%) para pausar disparos' }
            ]

            // Upsert configs
            for (const cfg of configs) {
                await supabase.from('configuracoes').upsert({
                    chave: cfg.chave,
                    valor: cfg.valor,
                    descricao: cfg.descricao,
                    updated_at: new Date().toISOString()
                }, { onConflict: 'chave' })
            }

            toast.success("Configurações Anti-Ban atualizadas com sucesso!")
        } catch (error: any) {
            console.error("Erro ao salvar:", error)
            toast.error(error.message || "Erro ao salvar configurações")
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="flex flex-col gap-6 max-w-4xl mx-auto w-full">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Link href="/developer">
                    <Button variant="outline" size="icon" className="h-10 w-10">
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                </Link>
                <div>
                    <div className="flex items-center gap-2">
                        <Settings2 className="h-6 w-6 text-cuca-blue" />
                        <h1 className="text-3xl font-bold tracking-tight text-cuca-dark">Configurações do Sistema</h1>
                    </div>
                    <p className="text-muted-foreground">Parâmetros globais, Motor Anti-Ban e Delays do Worker</p>
                </div>
            </div>

            {fetching ? (
                <div className="p-10 text-center text-muted-foreground">Carregando parâmetros...</div>
            ) : (
                <div className="grid gap-6">
                    <Card>
                        <CardHeader className="bg-muted/30 border-b">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <ShieldAlert className="h-5 w-5 text-amber-500" />
                                Motor Anti-Ban UAZAPI (Worker)
                            </CardTitle>
                            <CardDescription>
                                Estes parâmetros controlam o ritmo de disparo em massa para evitar bloqueios do WhatsApp. O Worker usará atrasos aleatórios entre o mínimo e máximo.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="p-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-4">
                                    <h3 className="font-semibold text-sm flex items-center gap-2">
                                        <Timer className="h-4 w-4" /> Randomização de Delay (ms)
                                    </h3>

                                    <div className="grid gap-2">
                                        <Label>Delay Mínimo (ms)</Label>
                                        <div className="flex items-center gap-2">
                                            <Input
                                                type="number"
                                                value={delayMin}
                                                onChange={(e) => setDelayMin(e.target.value)}
                                            />
                                            <span className="text-xs text-muted-foreground w-20">Recomendado: 2000</span>
                                        </div>
                                    </div>

                                    <div className="grid gap-2">
                                        <Label>Delay Máximo (ms)</Label>
                                        <div className="flex items-center gap-2">
                                            <Input
                                                type="number"
                                                value={delayMax}
                                                onChange={(e) => setDelayMax(e.target.value)}
                                            />
                                            <span className="text-xs text-muted-foreground w-20">Recomendado: 5000</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    <h3 className="font-semibold text-sm flex items-center gap-2">
                                        <ShieldAlert className="h-4 w-4" /> Limites de Disparo
                                    </h3>

                                    <div className="grid gap-2">
                                        <Label>Limite Diário por Instância (Warm-up)</Label>
                                        <div className="flex items-center gap-2">
                                            <Input
                                                type="number"
                                                value={dailyLimit}
                                                onChange={(e) => setDailyLimit(e.target.value)}
                                            />
                                            <span className="text-xs text-muted-foreground w-20">Msgs/dia</span>
                                        </div>
                                    </div>

                                    <div className="grid gap-2">
                                        <Label>Limite Tolerância de Erro (%)</Label>
                                        <div className="flex items-center gap-2">
                                            <Input
                                                type="number"
                                                value={errorThreshold}
                                                onChange={(e) => setErrorThreshold(e.target.value)}
                                            />
                                            <span className="text-xs text-muted-foreground w-20">% falhas</span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="mt-8 flex justify-end">
                                <Button
                                    onClick={salvarConfiguracoes}
                                    disabled={loading}
                                    className="bg-cuca-blue hover:bg-sky-800 text-white"
                                >
                                    {loading ? "Salvando..." : (
                                        <>
                                            <Save className="mr-2 h-4 w-4" /> Salvar Configurações
                                        </>
                                    )}
                                </Button>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}
        </div>
    )
}
