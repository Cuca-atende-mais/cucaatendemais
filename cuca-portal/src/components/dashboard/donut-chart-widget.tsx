"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from "recharts"
import { PieChart as PieIcon } from "lucide-react"

interface DonutChartWidgetProps {
    data: { name: string; value: number; color: string }[]
    total: number
    loading?: boolean
}

export function DonutChartWidget({ data, total, loading }: DonutChartWidgetProps) {
    const hasData = data.some(d => d.value > 0)

    return (
        <Card className="h-full">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <PieIcon className="h-4 w-4 text-indigo-500" />
                    Leads por Status
                </CardTitle>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <Skeleton className="h-52 w-full" />
                ) : (
                    <div className="relative">
                        <ResponsiveContainer width="100%" height={220}>
                            <PieChart>
                                <Pie
                                    data={hasData ? data : [{ name: "Sem dados", value: 1, color: "#334155" }]}
                                    cx="50%"
                                    cy="45%"
                                    innerRadius={58}
                                    outerRadius={82}
                                    paddingAngle={3}
                                    dataKey="value"
                                    strokeWidth={0}
                                >
                                    {(hasData ? data : [{ color: "#334155" }]).map((entry, index) => (
                                        <Cell key={index} fill={entry.color} />
                                    ))}
                                </Pie>
                                {hasData && (
                                    <Tooltip
                                        contentStyle={{
                                            backgroundColor: "hsl(var(--card))",
                                            border: "1px solid hsl(var(--border))",
                                            borderRadius: "8px",
                                            fontSize: "12px",
                                            color: "hsl(var(--foreground))",
                                        }}
                                    />
                                )}
                                {hasData && (
                                    <Legend
                                        iconType="circle"
                                        iconSize={7}
                                        wrapperStyle={{ fontSize: "11px" }}
                                    />
                                )}
                            </PieChart>
                        </ResponsiveContainer>

                        {/* Center label */}
                        <div className="absolute top-0 left-0 right-0 flex items-center justify-center pointer-events-none" style={{ height: "77%" }}>
                            <div className="text-center">
                                <div className="text-2xl font-bold tabular-nums">{total.toLocaleString("pt-BR")}</div>
                                <div className="text-[10px] text-muted-foreground">total</div>
                            </div>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
