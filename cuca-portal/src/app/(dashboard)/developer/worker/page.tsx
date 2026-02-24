"use client"

import { useState, useEffect } from "react"
import { Server, Activity, Cpu, Database, Loader2, RefreshCcw, Wifi, AlertCircle } from "lucide-react"
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

type WorkerStats = {
    status: "online" | "offline"
    uptime: string
    cpu: number
    memory: number
    celery: {
        pending: number
        processing: number
        failed: number
    }
    latency_avg: string
}

export default function DevWorkerPage() {
    const supabase = createClientComponentClient()
    const [stats, setStats] = useState<WorkerStats | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetchStats()
        const interval = setInterval(fetchStats, 10000)
        return () => clearInterval(interval)
    }, [])

    const fetchStats = async () => {
        // Simulação de dados do health-check do worker
        // Em produção, isso bateria em um endpoint proxy que chama o FastAPI do worker
        setStats({
            status: "online",
            uptime: "12d 4h 22m",
            cpu: 12.5,
            memory: 450, // MB
            celery: {
                pending: 0,
                processing: 2,
                failed: 4,
            },
            latency_avg: "1.2s"
        })
        setLoading(false)
    }

    if (loading) return <div className="flex justify-center py-40"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2"><Server className="h-6 w-6 text-primary" /> Métricas do Worker</h1>
                    <p className="text-sm text-muted-foreground mt-1">Telemetria de performance e saúde do processamento Python.</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchStats(); }}>
                    <RefreshCcw className="h-4 w-4 mr-2" /> Atualizar
                </Button>
            </div>

            {/* Status Geral */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                        <CardTitle className="text-sm font-medium">Status do Worker</CardTitle>
                        <Wifi className={cn("h-4 w-4", stats?.status === "online" ? "text-green-500" : "text-red-500")} />
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center gap-2">
                            <div className={cn("w-3 h-3 rounded-full animate-pulse", stats?.status === "online" ? "bg-green-500" : "bg-red-500")} />
                            <span className="text-2xl font-bold capitalize">{stats?.status}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">Uptime: {stats?.uptime}</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                        <CardTitle className="text-sm font-medium">CPU / Memória</CardTitle>
                        <Cpu className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats?.cpu}% <span className="text-sm text-muted-foreground">/ {stats?.memory}MB</span></div>
                        <div className="mt-2 w-full bg-muted rounded-full h-1.5 overflow-hidden">
                            <div className="h-full bg-primary" style={{ width: `${stats?.cpu}%` }} />
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                        <CardTitle className="text-sm font-medium">Latência Média</CardTitle>
                        <Activity className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{stats?.latency_avg}</div>
                        <p className="text-xs text-muted-foreground mt-1">Baseado nos últimos 100 atendimentos</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
                        <CardTitle className="text-sm font-medium">Fila Celery</CardTitle>
                        <Database className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center gap-2">
                            <Badge variant="outline" className="text-blue-500 bg-blue-50 border-blue-200">{stats?.celery.processing} Proc.</Badge>
                            <Badge variant="outline" className="text-slate-500 bg-slate-50 border-slate-200">{stats?.celery.pending} Pend.</Badge>
                        </div>
                        {stats?.celery.failed ? (
                            <p className="text-xs text-red-500 mt-2 flex items-center gap-1">
                                <AlertCircle className="h-3 w-3" /> {stats.celery.failed} falhas recentes
                            </p>
                        ) : null}
                    </CardContent>
                </Card>
            </div>

            {/* Simulação de Histórico de Carga */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base font-semibold">Carga de Processamento (24h)</CardTitle>
                    <CardDescription>Volume de mensagens processadas por minuto</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="h-48 w-full bg-slate-50 rounded-lg border flex items-end justify-around p-4">
                        {[40, 60, 45, 80, 95, 30, 25, 40, 50, 70, 85, 30, 40, 50, 20, 15, 30, 60, 40, 50].map((h, i) => (
                            <div key={i} className="bg-primary/20 w-4 rounded-t-sm border-t border-primary/40" style={{ height: `${h}%` }} />
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}

function cn(...inputs: any[]) {
    return inputs.filter(Boolean).join(" ")
}
