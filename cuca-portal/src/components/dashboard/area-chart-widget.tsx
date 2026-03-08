"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip, Legend, ResponsiveContainer
} from "recharts"
import { TrendingUp } from "lucide-react"

interface AreaChartWidgetProps {
    data: { date: string; atendimentos: number; leads: number }[]
    loading?: boolean
}

export function AreaChartWidget({ data, loading }: AreaChartWidgetProps) {
    return (
        <Card className="h-full">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-indigo-500" />
                    Atendimentos & Leads — Últimos 30 dias
                    <span className="ml-auto text-xs font-normal text-muted-foreground">dados ilustrativos</span>
                </CardTitle>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <Skeleton className="h-52 w-full" />
                ) : (
                    <ResponsiveContainer width="100%" height={220}>
                        <AreaChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id="gradAtend" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25} />
                                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                                </linearGradient>
                                <linearGradient id="gradLeads" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.25} />
                                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06} />
                            <XAxis
                                dataKey="date"
                                tick={{ fontSize: 10 }}
                                tickLine={false}
                                axisLine={false}
                                interval={6}
                            />
                            <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                            <Tooltip
                                contentStyle={{
                                    backgroundColor: "hsl(var(--card))",
                                    border: "1px solid hsl(var(--border))",
                                    borderRadius: "8px",
                                    fontSize: "12px",
                                    color: "hsl(var(--foreground))",
                                }}
                            />
                            <Legend
                                iconType="circle"
                                iconSize={7}
                                wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                            />
                            <Area
                                type="monotone"
                                dataKey="atendimentos"
                                name="Atendimentos"
                                stroke="#6366f1"
                                strokeWidth={2}
                                fill="url(#gradAtend)"
                            />
                            <Area
                                type="monotone"
                                dataKey="leads"
                                name="Leads"
                                stroke="#06b6d4"
                                strokeWidth={2}
                                fill="url(#gradLeads)"
                            />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </CardContent>
        </Card>
    )
}
