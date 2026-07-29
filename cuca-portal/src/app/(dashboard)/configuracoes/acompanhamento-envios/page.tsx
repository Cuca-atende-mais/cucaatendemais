"use client"

import { useCallback, useEffect, useState } from "react"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import {
    BarChart3, CheckCircle2, Loader2, RefreshCw, Send, ShieldAlert, XCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { useUser } from "@/lib/auth/user-provider"

type Motor = "pontual" | "ouvidoria" | "divulgacao"

type DisparoAcompanhamento = {
    disparo_id: string
    motor: Motor
    titulo: string | null
    status: string | null
    criado_em: string
    total_elegiveis: number
    total_enviados: number
    total_entregues: number
    total_falhou: number
}

const MOTOR_LABEL: Record<Motor, string> = {
    pontual: "Pontual",
    ouvidoria: "Ouvidoria",
    divulgacao: "Divulgação mensal",
}

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : "Erro desconhecido"

// Meta Insights-style: funil elegíveis → enviados → entregues → falhou, em ordem decrescente.
function FunilStat({ label, value, tone }: { label: string; value: number; tone: "neutral" | "success" | "danger" }) {
    const cor = tone === "success"
        ? "text-green-500"
        : tone === "danger"
            ? "text-red-500"
            : "text-foreground"
    return (
        <div className="flex flex-col items-center gap-0.5 px-2">
            <span className={`text-xl font-bold ${cor}`}>{value}</span>
            <span className="text-[11px] text-muted-foreground">{label}</span>
        </div>
    )
}

export default function AcompanhamentoEnviosPage() {
    const { hasPermission, isDeveloper } = useUser()
    const [carregando, setCarregando] = useState(true)
    const [semPermissao, setSemPermissao] = useState(false)
    const [disparos, setDisparos] = useState<DisparoAcompanhamento[]>([])
    const [motorFiltro, setMotorFiltro] = useState<Motor | "todos">("todos")

    const fetchData = useCallback(async () => {
        setCarregando(true)
        try {
            if (!isDeveloper && !hasPermission("config_acompanhamento_envios", "read")) {
                setSemPermissao(true)
                return
            }

            const params = new URLSearchParams()
            if (motorFiltro !== "todos") params.set("motor", motorFiltro)

            const res = await fetch(`/api/configuracoes/acompanhamento-envios?${params.toString()}`, { cache: "no-store" })
            const body = await res.json()
            if (!res.ok) throw new Error(body.error || "Falha ao carregar acompanhamento de envios")
            setDisparos(body.disparos ?? [])
        } catch (error: unknown) {
            console.error("[acompanhamento-envios]", getErrorMessage(error))
        } finally {
            setCarregando(false)
        }
    }, [hasPermission, isDeveloper, motorFiltro])

    useEffect(() => { fetchData() }, [fetchData])

    if (semPermissao) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-12 gap-4 text-center">
                <ShieldAlert className="h-16 w-16 text-muted-foreground/40" />
                <h2 className="text-xl font-bold text-foreground">Acesso Restrito</h2>
                <p className="text-muted-foreground max-w-sm">
                    Você não tem permissão para acessar o Acompanhamento de Envios. Solicite permissão ao Developer.
                </p>
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col gap-6 p-4 lg:p-8">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-blue-500/15 border border-blue-500/30">
                        <BarChart3 className="h-6 w-6 text-blue-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-foreground">Acompanhamento de Envios</h1>
                        <p className="text-sm text-muted-foreground">
                            Visão de entrega por disparo — pontual, ouvidoria e divulgação mensal.
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <Select value={motorFiltro} onValueChange={(v: Motor | "todos") => setMotorFiltro(v)}>
                        <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="todos">Todos os motores</SelectItem>
                            <SelectItem value="pontual">Pontual</SelectItem>
                            <SelectItem value="ouvidoria">Ouvidoria</SelectItem>
                            <SelectItem value="divulgacao">Divulgação mensal</SelectItem>
                        </SelectContent>
                    </Select>
                    <Button variant="outline" size="sm" onClick={fetchData} disabled={carregando}>
                        <RefreshCw className={`h-4 w-4 mr-1.5 ${carregando ? "animate-spin" : ""}`} /> Atualizar
                    </Button>
                </div>
            </div>

            <Card className="shadow-sm">
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Send className="h-5 w-5 text-muted-foreground" />
                        Disparos recentes
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {carregando ? (
                        <div className="flex items-center justify-center p-12">
                            <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
                        </div>
                    ) : disparos.length === 0 ? (
                        <div className="py-12 text-center text-muted-foreground text-sm">
                            Nenhum disparo encontrado para este filtro.
                        </div>
                    ) : (
                        <div className="divide-y divide-border/50">
                            {disparos.map(d => (
                                <div key={d.disparo_id} className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 px-6 py-4">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            <p className="font-medium text-sm text-foreground truncate">{d.titulo || "(sem título)"}</p>
                                            <Badge variant="secondary" className="text-[10px] shrink-0">{MOTOR_LABEL[d.motor]}</Badge>
                                            {d.status && <Badge variant="outline" className="text-[10px] shrink-0">{d.status}</Badge>}
                                        </div>
                                        <p className="text-xs text-muted-foreground/60 mt-0.5">
                                            {format(new Date(d.criado_em), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-3 shrink-0">
                                        <FunilStat label="Elegíveis" value={d.total_elegiveis} tone="neutral" />
                                        <FunilStat label="Enviados" value={d.total_enviados} tone="neutral" />
                                        <FunilStat label="Entregues" value={d.total_entregues} tone="success" />
                                        <FunilStat label="Falhou" value={d.total_falhou} tone="danger" />
                                        {d.total_falhou === 0 && d.total_enviados > 0
                                            ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                                            : d.total_falhou > 0
                                                ? <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                                                : null}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
