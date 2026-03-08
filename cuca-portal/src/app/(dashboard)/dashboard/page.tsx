"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import {
    Users, Briefcase, MessageSquare, Calendar,
    Building2, RefreshCw, TrendingUp, TrendingDown,
    ChevronRight,
} from "lucide-react"
import Link from "next/link"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { unidadesCuca } from "@/lib/constants"
import { AreaChartWidget } from "@/components/dashboard/area-chart-widget"
import { DonutChartWidget } from "@/components/dashboard/donut-chart-widget"
import { BarChartWidget } from "@/components/dashboard/bar-chart-widget"
import { ActivityTable } from "@/components/dashboard/activity-table"
import { cn } from "@/lib/utils"

/* ── tipos ─────────────────────────────────────────────── */
type Period = "week" | "month" | "year"

/* ── helpers ────────────────────────────────────────────── */
function generateAreaData(period: Period) {
    const days = period === "week" ? 7 : period === "month" ? 30 : 12
    const labels = period === "year"
        ? ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"]
        : null
    const now = new Date()

    return Array.from({ length: days }, (_, i) => {
        if (labels) return { date: labels[i], atendimentos: Math.floor(Math.random() * 120 + 30), leads: Math.floor(Math.random() * 60 + 10) }
        const d = new Date(now)
        d.setDate(d.getDate() - (days - 1 - i))
        return {
            date: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
            atendimentos: Math.floor(Math.random() * 35 + 5),
            leads: Math.floor(Math.random() * 18 + 2),
        }
    })
}

/* ── subcomponente StatCard ─────────────────────────────── */
interface StatCardProps {
    title: string
    subtitle: string
    value: number
    icon: React.ElementType
    color: "blue" | "emerald" | "amber" | "rose"
    trend: { value: number; positive: boolean }
    href: string
    loading?: boolean
}

const COLOR_MAP = {
    blue:    { icon: "bg-blue-500/20 text-blue-400",    trend: "text-blue-400" },
    emerald: { icon: "bg-emerald-500/20 text-emerald-400", trend: "text-emerald-400" },
    amber:   { icon: "bg-amber-500/20 text-amber-400",   trend: "text-amber-400" },
    rose:    { icon: "bg-rose-500/20 text-rose-400",     trend: "text-rose-400" },
}

function StatCard({ title, subtitle, value, icon: Icon, color, trend, href, loading }: StatCardProps) {
    const c = COLOR_MAP[color]

    if (loading) {
        return (
            <div className="bg-card rounded-2xl border border-border p-6">
                <div className="flex items-center gap-4">
                    <Skeleton className="h-12 w-12 rounded-xl" />
                    <div className="space-y-2 flex-1">
                        <Skeleton className="h-8 w-28" />
                        <Skeleton className="h-3 w-40" />
                    </div>
                </div>
            </div>
        )
    }

    return (
        <Link href={href} className="block group">
            <div className={cn(
                "bg-card rounded-2xl border border-border p-6 transition-all duration-200",
                "hover:border-primary/40 hover:shadow-lg hover:shadow-black/20 hover:-translate-y-0.5"
            )}>
                <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                        <div className={cn("p-3 rounded-xl shrink-0", c.icon)}>
                            <Icon className="h-6 w-6" />
                        </div>
                        <div>
                            <div className="text-3xl font-extrabold tabular-nums tracking-tight">
                                {value.toLocaleString("pt-BR")}
                            </div>
                            <div className="text-sm text-muted-foreground mt-0.5">{title}</div>
                        </div>
                    </div>

                    <div className="flex flex-col items-end gap-1">
                        <div className={cn(
                            "flex items-center gap-1 text-xs font-semibold",
                            trend.positive ? "text-emerald-400" : "text-rose-400"
                        )}>
                            {trend.positive
                                ? <TrendingUp className="h-3 w-3" />
                                : <TrendingDown className="h-3 w-3" />
                            }
                            {trend.positive ? "+" : "-"}{trend.value}%
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors" />
                    </div>
                </div>

                <p className="text-xs text-muted-foreground mt-4 pl-[52px]">{subtitle}</p>
            </div>
        </Link>
    )
}

/* ── selector de período ─────────────────────────────────── */
function PeriodSelector({ value, onChange }: { value: Period; onChange: (v: Period) => void }) {
    const options: { key: Period; label: string }[] = [
        { key: "week",  label: "Semana" },
        { key: "month", label: "Mês" },
        { key: "year",  label: "Ano" },
    ]
    return (
        <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            {options.map(({ key, label }) => (
                <button
                    key={key}
                    onClick={() => onChange(key)}
                    className={cn(
                        "px-3 py-1.5 font-medium transition-colors",
                        value === key
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    )}
                >
                    {label}
                </button>
            ))}
        </div>
    )
}

/* ── componente principal ─────────────────────────────────── */
export default function DashboardPage() {
    const supabase = createClient()
    const [loading, setLoading]         = useState(true)
    const [selectedUnit, setSelectedUnit] = useState("all")
    const [period, setPeriod]           = useState<Period>("month")
    const [lastRefresh, setLastRefresh] = useState(new Date())
    const [stats, setStats] = useState({ leads: 0, eventos: 0, vagas: 0, ouvidoria: 0 })

    const areaData = useMemo(() => generateAreaData(period), [period])

    const fetchStats = useCallback(async () => {
        setLoading(true)
        let lQ = supabase.from("leads").select("id", { count: "exact", head: true })
        let eQ = supabase.from("ouvidoria_eventos").select("id", { count: "exact", head: true }).eq("status", "ativo")
        let vQ = supabase.from("vagas").select("id", { count: "exact", head: true }).eq("status", "aberta")
        let oQ = supabase.from("ouvidoria_registros").select("id", { count: "exact", head: true })
        if (selectedUnit !== "all") {
            lQ = lQ.eq("unidade_cuca", selectedUnit)
            eQ = eQ.eq("unidade_cuca", selectedUnit)
            vQ = vQ.eq("unidade_cuca", selectedUnit)
            oQ = oQ.eq("unidade_cuca", selectedUnit)
        }
        const [l, e, v, o] = await Promise.all([lQ, eQ, vQ, oQ])
        setStats({ leads: l.count ?? 0, eventos: e.count ?? 0, vagas: v.count ?? 0, ouvidoria: o.count ?? 0 })
        setLastRefresh(new Date())
        setLoading(false)
    }, [selectedUnit])

    useEffect(() => { fetchStats() }, [fetchStats])

    const leadsDonut = useMemo(() => [
        { name: "Novo",           value: Math.max(1, Math.floor(stats.leads * 0.35)), color: "#3b82f6" },
        { name: "Em Atendimento", value: Math.max(1, Math.floor(stats.leads * 0.30)), color: "#06b6d4" },
        { name: "Convertido",     value: Math.max(1, Math.floor(stats.leads * 0.25)), color: "#22c55e" },
        { name: "Perdido",        value: Math.max(1, Math.floor(stats.leads * 0.10)), color: "#f43f5e" },
    ], [stats.leads])

    const barData = useMemo(() =>
        unidadesCuca.slice(0, 5).map(u => ({
            name: u.replace("CUCA ", "").slice(0, 8),
            leads: Math.floor(Math.random() * 80 + 20),
            atendimentos: Math.floor(Math.random() * 50 + 10),
        }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
    , [])

    const now = new Date()
    const dateLabel = now.toLocaleDateString("pt-BR", {
        weekday: "long", day: "numeric", month: "long", year: "numeric"
    })

    return (
        <div className="space-y-8 max-w-[1400px]">

            {/* ── Cabeçalho da página ─────────────────────────── */}
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-extrabold tracking-tight">Dashboard</h1>
                    <p className="text-sm text-muted-foreground capitalize mt-0.5">{dateLabel}</p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                    <Button variant="ghost" size="sm" onClick={fetchStats} className="gap-1.5 h-8 text-muted-foreground">
                        <RefreshCw className="h-3.5 w-3.5" />
                        <span className="text-xs">
                            {lastRefresh.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                    </Button>
                    <div className="flex items-center gap-2 bg-card border border-border rounded-lg px-3 py-1.5">
                        <Building2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <Select value={selectedUnit} onValueChange={setSelectedUnit}>
                            <SelectTrigger className="w-[150px] border-0 h-auto p-0 shadow-none focus:ring-0 text-sm">
                                <SelectValue placeholder="Todas as Unidades" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todas as Unidades</SelectItem>
                                {unidadesCuca.map(u => (
                                    <SelectItem key={u} value={u}>{u}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </div>

            {/* ── SEÇÃO A: Estatísticas Gerais ─────────────────── */}
            <section>
                <h2 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground mb-4">
                    Estatísticas Gerais
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                    <StatCard
                        title="Total de Leads"
                        subtitle="Contatos ativos na base da Rede CUCA"
                        value={stats.leads}
                        icon={Users}
                        color="blue"
                        trend={{ value: 12, positive: true }}
                        href="/leads"
                        loading={loading}
                    />
                    <StatCard
                        title="Eventos de Escuta"
                        subtitle="Ouvidorias e escutas comunitárias ativas"
                        value={stats.eventos}
                        icon={Calendar}
                        color="amber"
                        trend={{ value: 5, positive: true }}
                        href="/ouvidoria/eventos"
                        loading={loading}
                    />
                    <StatCard
                        title="Vagas Abertas"
                        subtitle="Vagas publicadas no portal de empregos"
                        value={stats.vagas}
                        icon={Briefcase}
                        color="emerald"
                        trend={{ value: 3, positive: false }}
                        href="/empregabilidade/vagas"
                        loading={loading}
                    />
                    <StatCard
                        title="Manifestações"
                        subtitle="Registros de ouvidoria recebidos"
                        value={stats.ouvidoria}
                        icon={MessageSquare}
                        color="rose"
                        trend={{ value: 8, positive: false }}
                        href="/ouvidoria"
                        loading={loading}
                    />
                </div>
            </section>

            {/* ── SEÇÃO B: Estatísticas por Período ─────────────── */}
            <section>
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                    <h2 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                        Estatísticas por Período
                    </h2>
                    <PeriodSelector value={period} onChange={setPeriod} />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="lg:col-span-1">
                        <AreaChartWidget data={areaData} loading={loading} />
                    </div>
                    <div className="lg:col-span-1">
                        <BarChartWidget data={barData} loading={loading} />
                    </div>
                    <div className="lg:col-span-1">
                        <DonutChartWidget data={leadsDonut} total={stats.leads} loading={loading} />
                    </div>
                </div>
            </section>

            {/* ── SEÇÃO C: Últimas Notificações ─────────────────── */}
            <section>
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                        Últimas Notificações
                    </h2>
                    <span className="text-xs text-muted-foreground">dados ilustrativos</span>
                </div>

                <ActivityTable loading={loading} />

                <div className="flex justify-center mt-5">
                    <Button variant="outline" size="sm" className="rounded-full px-6 gap-2">
                        Ver todas as atividades
                        <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                </div>
            </section>
        </div>
    )
}
