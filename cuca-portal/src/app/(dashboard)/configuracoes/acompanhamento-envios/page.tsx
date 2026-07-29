"use client"

import { useCallback, useEffect, useState } from "react"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import {
    BarChart3, CheckCircle2, Loader2, PauseCircle, RefreshCw, Send, Settings2, ShieldAlert, XCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import { useUser } from "@/lib/auth/user-provider"

type Motor = "pontual" | "ouvidoria" | "divulgacao"

// S-WM-59: os 2 status de pausa por limite diário (pontual/ouvidoria usam a forma "a",
// divulgação usa a forma "o" — worker/campanhas_engine.py, S-WM-60).
const STATUS_PAUSADO_LIMITE = ["pausada_limite_diario", "pausado_limite_diario"]

type DisparoAcompanhamento = {
    disparo_id: string
    item_id: string | null
    motor: Motor
    titulo: string | null
    status: string | null
    criado_em: string
    total_elegiveis: number
    total_enviados: number
    total_entregues: number
    total_falhou: number
    total_pendentes: number
}

type NumeroMeta = {
    phone_number_id: string
    display_name: string | null
    canal_tipo: string | null
    daily_limit: number | null
    messaging_limit_tier: number | null
    messaging_limit_tier_confirmado_em: string | null
    quality_rating: string | null
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
    const podeEditar = isDeveloper || hasPermission("config_acompanhamento_envios", "update")
    const [carregando, setCarregando] = useState(true)
    const [semPermissao, setSemPermissao] = useState(false)
    const [disparos, setDisparos] = useState<DisparoAcompanhamento[]>([])
    const [motorFiltro, setMotorFiltro] = useState<Motor | "todos">("todos")
    const [reenviando, setReenviando] = useState<string | null>(null)

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

    const reenviarPendentes = useCallback(async (d: DisparoAcompanhamento) => {
        if (!d.item_id) {
            toast.error("Este disparo não tem um id de origem rastreável — não é possível reenviar.")
            return
        }
        setReenviando(d.disparo_id)
        try {
            const res = await fetch("/api/configuracoes/acompanhamento-envios/reenviar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ motor: d.motor, item_id: d.item_id }),
            })
            const body = await res.json().catch(() => ({}))
            if (!res.ok) {
                // S-WM-59 (item 2): o worker agora responde de forma síncrona — 404/409 real
                // (item não existe, não está mais pausado, ou outra chamada ganhou a corrida)
                // chega aqui como erro amigável, não um sucesso genérico escondendo o problema.
                toast.error(body.error || "Não foi possível reenviar — tente atualizar a lista.")
                return
            }
            toast.success(`Retomada iniciada para "${d.titulo || "disparo"}" — envio em andamento.`)
            fetchData()
        } catch (error: unknown) {
            toast.error(getErrorMessage(error))
        } finally {
            setReenviando(null)
        }
    }, [fetchData])

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

            <LimiteDiarioCard podeEditar={podeEditar} />

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
                            {disparos.map(d => {
                                const pausado = STATUS_PAUSADO_LIMITE.includes(d.status ?? "")
                                return (
                                    <div key={d.disparo_id} className="flex flex-col gap-2 px-6 py-4">
                                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
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
                                                {d.total_falhou === 0 && d.total_enviados > 0 && !pausado
                                                    ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
                                                    : d.total_falhou > 0
                                                        ? <XCircle className="h-4 w-4 text-red-500 shrink-0" />
                                                        : null}
                                            </div>
                                        </div>
                                        {pausado && (
                                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-orange-500/30 bg-orange-500/10 px-3 py-2">
                                                <div className="flex items-center gap-2 text-orange-500 text-xs font-medium">
                                                    <PauseCircle className="h-4 w-4 shrink-0" />
                                                    Pausado por limite diário — {d.total_pendentes} destinatário(s) ainda não receberam (no momento desta consulta).
                                                </div>
                                                {podeEditar && (
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="shrink-0"
                                                        disabled={reenviando === d.disparo_id || !d.item_id}
                                                        onClick={() => reenviarPendentes(d)}
                                                    >
                                                        {reenviando === d.disparo_id
                                                            ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                                                            : <Send className="h-3.5 w-3.5 mr-1.5" />}
                                                        Reenviar pendentes
                                                    </Button>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}

function LimiteDiarioCard({ podeEditar }: { podeEditar: boolean }) {
    const [numeros, setNumeros] = useState<NumeroMeta[]>([])
    const [carregando, setCarregando] = useState(true)
    const [edicoes, setEdicoes] = useState<Record<string, string>>({})
    const [salvando, setSalvando] = useState<string | null>(null)

    const fetchNumeros = useCallback(async () => {
        setCarregando(true)
        try {
            const res = await fetch("/api/configuracoes/acompanhamento-envios/limite-diario", { cache: "no-store" })
            const body = await res.json()
            if (!res.ok) throw new Error(body.error || "Falha ao carregar números Meta")
            setNumeros(body.numeros ?? [])
        } catch (error: unknown) {
            console.error("[limite-diario]", getErrorMessage(error))
        } finally {
            setCarregando(false)
        }
    }, [])

    useEffect(() => { fetchNumeros() }, [fetchNumeros])

    const salvar = useCallback(async (n: NumeroMeta) => {
        const valorDigitado = edicoes[n.phone_number_id]
        const novoLimite = Number(valorDigitado)
        if (!valorDigitado || !Number.isInteger(novoLimite) || novoLimite <= 0) {
            toast.error("Informe um limite diário válido (número inteiro maior que zero).")
            return
        }
        // A UI nunca deixa selecionar acima da camada confirmada — mas o backend revalida
        // de novo (nunca confiar só no frontend). Aqui é só feedback antecipado.
        if (n.messaging_limit_tier !== null && novoLimite > n.messaging_limit_tier) {
            toast.error(`O limite não pode passar da camada confirmada pela Meta (${n.messaging_limit_tier}).`)
            return
        }

        setSalvando(n.phone_number_id)
        try {
            const res = await fetch("/api/configuracoes/acompanhamento-envios/limite-diario", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phone_number_id: n.phone_number_id, daily_limit: novoLimite }),
            })
            const body = await res.json().catch(() => ({}))
            if (!res.ok) {
                toast.error(body.error || "Falha ao salvar o limite diário")
                return
            }
            toast.success(`Limite diário de "${n.display_name || n.phone_number_id}" atualizado para ${novoLimite}.`)
            setEdicoes(prev => { const cp = { ...prev }; delete cp[n.phone_number_id]; return cp })
            fetchNumeros()
        } catch (error: unknown) {
            toast.error(getErrorMessage(error))
        } finally {
            setSalvando(null)
        }
    }, [edicoes, fetchNumeros])

    if (carregando) {
        return (
            <Card className="shadow-sm">
                <CardContent className="flex items-center justify-center p-8">
                    <Loader2 className="h-6 w-6 animate-spin text-blue-500" />
                </CardContent>
            </Card>
        )
    }

    if (numeros.length === 0) return null

    return (
        <Card className="shadow-sm">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                    <Settings2 className="h-5 w-5 text-muted-foreground" />
                    Limite diário por número
                </CardTitle>
                <CardDescription>
                    Quantos destinatários cada número Meta pode receber por dia. Nunca é possível configurar acima da camada de mensageria confirmada pela Meta pra aquele número.
                </CardDescription>
            </CardHeader>
            <CardContent className="p-0">
                <div className="divide-y divide-border/50">
                    {numeros.map(n => {
                        const valorAtual = edicoes[n.phone_number_id] ?? String(n.daily_limit ?? "")
                        const tier = n.messaging_limit_tier
                        return (
                            <div key={n.phone_number_id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-3.5">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <p className="font-medium text-sm text-foreground">{n.display_name || n.phone_number_id}</p>
                                        {n.canal_tipo && <Badge variant="secondary" className="text-[10px]">{n.canal_tipo}</Badge>}
                                    </div>
                                    <p className="text-xs text-muted-foreground/60 mt-0.5">
                                        {tier !== null
                                            ? `Camada confirmada pela Meta: ${tier}${n.messaging_limit_tier_confirmado_em
                                                ? ` (em ${format(new Date(n.messaging_limit_tier_confirmado_em), "dd/MM/yyyy", { locale: ptBR })})`
                                                : ""}`
                                            : "Camada de mensageria ainda não registrada pra este número."}
                                        {n.quality_rating ? ` · Qualidade: ${n.quality_rating}` : ""}
                                    </p>
                                </div>
                                {podeEditar ? (
                                    <div className="flex items-center gap-2 shrink-0">
                                        <Input
                                            type="number"
                                            min={1}
                                            max={tier ?? undefined}
                                            value={valorAtual}
                                            onChange={e => setEdicoes(prev => ({ ...prev, [n.phone_number_id]: e.target.value }))}
                                            className="w-24 h-8 text-sm"
                                        />
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            disabled={salvando === n.phone_number_id || edicoes[n.phone_number_id] === undefined}
                                            onClick={() => salvar(n)}
                                        >
                                            {salvando === n.phone_number_id
                                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                : "Salvar"}
                                        </Button>
                                    </div>
                                ) : (
                                    <span className="text-sm font-semibold text-foreground shrink-0">{n.daily_limit ?? "—"}</span>
                                )}
                            </div>
                        )
                    })}
                </div>
            </CardContent>
        </Card>
    )
}
