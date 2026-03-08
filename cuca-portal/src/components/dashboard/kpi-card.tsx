"use client"

import { ElementType } from "react"
import Link from "next/link"
import { TrendingUp, TrendingDown, AlertCircle, CheckCircle2 } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { LineChart, Line, ResponsiveContainer } from "recharts"

const colorMap = {
    indigo: {
        icon: "text-indigo-500",
        iconBg: "bg-indigo-500/10",
        sparkline: "#6366f1",
        badge: "bg-indigo-500/10 text-indigo-500",
        glow: "group-hover:shadow-indigo-500/10",
    },
    amber: {
        icon: "text-amber-500",
        iconBg: "bg-amber-500/10",
        sparkline: "#f59e0b",
        badge: "bg-amber-500/10 text-amber-500",
        glow: "group-hover:shadow-amber-500/10",
    },
    emerald: {
        icon: "text-emerald-500",
        iconBg: "bg-emerald-500/10",
        sparkline: "#10b981",
        badge: "bg-emerald-500/10 text-emerald-500",
        glow: "group-hover:shadow-emerald-500/10",
    },
    rose: {
        icon: "text-rose-500",
        iconBg: "bg-rose-500/10",
        sparkline: "#f43f5e",
        badge: "bg-rose-500/10 text-rose-500",
        glow: "group-hover:shadow-rose-500/10",
    },
    cyan: {
        icon: "text-cyan-500",
        iconBg: "bg-cyan-500/10",
        sparkline: "#06b6d4",
        badge: "bg-cyan-500/10 text-cyan-500",
        glow: "group-hover:shadow-cyan-500/10",
    },
}

interface KpiCardProps {
    title: string
    value: number
    description: string
    icon: ElementType
    color: keyof typeof colorMap
    trend?: { value: number; positive: boolean }
    sparkline?: { v: number }[]
    loading?: boolean
    href?: string
    sla?: { within: number; outside: number }
}

export function KpiCard({ title, value, description, icon: Icon, color, trend, sparkline, loading, href, sla }: KpiCardProps) {
    const c = colorMap[color]

    const content = (
        <div className={cn(
            "group relative rounded-xl border bg-card p-5 transition-all duration-300",
            "hover:shadow-xl hover:-translate-y-0.5",
            href && "cursor-pointer",
            c.glow
        )}>
            {/* Subtle gradient overlay on hover */}
            <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300 bg-gradient-to-br from-white/2 to-transparent pointer-events-none" />

            <div className="relative">
                <div className="flex items-start justify-between mb-4">
                    <div className={cn("p-2.5 rounded-lg", c.iconBg)}>
                        <Icon className={cn("h-5 w-5", c.icon)} />
                    </div>

                    {loading ? (
                        <Skeleton className="h-5 w-14" />
                    ) : trend && (
                        <span className={cn("flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full", c.badge)}>
                            {trend.positive
                                ? <TrendingUp className="h-3 w-3" />
                                : <TrendingDown className="h-3 w-3" />
                            }
                            {trend.value}%
                        </span>
                    )}
                </div>

                {loading ? (
                    <div className="space-y-2">
                        <Skeleton className="h-8 w-24" />
                        <Skeleton className="h-3 w-36" />
                        <Skeleton className="h-10 w-full mt-3" />
                    </div>
                ) : (
                    <>
                        <div className="text-3xl font-bold tracking-tight tabular-nums mb-0.5">
                            {value.toLocaleString("pt-BR")}
                        </div>
                        <p className="text-xs text-muted-foreground mb-3">{description}</p>

                        {sla && (
                            <div className="flex items-center gap-3 mb-3 text-xs">
                                <span className="flex items-center gap-1 text-emerald-500">
                                    <CheckCircle2 className="h-3 w-3" />
                                    {sla.within} no prazo
                                </span>
                                <span className="flex items-center gap-1 text-rose-500">
                                    <AlertCircle className="h-3 w-3" />
                                    {sla.outside} vencidos
                                </span>
                            </div>
                        )}

                        {sparkline && sparkline.length > 0 && (
                            <div className="h-10 -mx-1">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={sparkline}>
                                        <Line
                                            type="monotone"
                                            dataKey="v"
                                            stroke={c.sparkline}
                                            strokeWidth={2}
                                            dot={false}
                                            strokeOpacity={0.9}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    )

    if (href) {
        return <Link href={href} className="block">{content}</Link>
    }
    return content
}
