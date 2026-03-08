"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Activity, Users, Briefcase, MessageSquare, Calendar, CheckCircle2 } from "lucide-react"
import { cn } from "@/lib/utils"

const mockActivities = [
    {
        id: 1,
        message: "Novo lead cadastrado",
        detail: "Maria Silva — CUCA Barra",
        time: "há 3 min",
        icon: Users,
        color: "text-indigo-500 bg-indigo-500/10",
    },
    {
        id: 2,
        message: "Vaga publicada",
        detail: "Auxiliar Administrativo — Alphaville",
        time: "há 15 min",
        icon: Briefcase,
        color: "text-emerald-500 bg-emerald-500/10",
    },
    {
        id: 3,
        message: "Manifestação recebida",
        detail: "Sugestão — CUCA Mondubim",
        time: "há 32 min",
        icon: MessageSquare,
        color: "text-rose-500 bg-rose-500/10",
    },
    {
        id: 4,
        message: "Evento atualizado",
        detail: "Roda de Conversa — CUCA Centro",
        time: "há 1h",
        icon: Calendar,
        color: "text-amber-500 bg-amber-500/10",
    },
    {
        id: 5,
        message: "Lead convertido",
        detail: "João Santos — CUCA Jangurussu",
        time: "há 2h",
        icon: CheckCircle2,
        color: "text-emerald-500 bg-emerald-500/10",
    },
]

export function ActivityFeed({ loading }: { loading?: boolean }) {
    return (
        <Card className="h-full">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <Activity className="h-4 w-4 text-indigo-500" />
                    Atividade Recente
                    <span className="ml-auto text-xs font-normal text-muted-foreground">dados ilustrativos</span>
                </CardTitle>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="space-y-3">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <Skeleton key={i} className="h-12 w-full" />
                        ))}
                    </div>
                ) : (
                    <div className="space-y-3">
                        {mockActivities.map((activity) => {
                            const Icon = activity.icon
                            return (
                                <div key={activity.id} className="flex items-start gap-3">
                                    <div className={cn("p-1.5 rounded-lg shrink-0 mt-0.5", activity.color)}>
                                        <Icon className="h-3.5 w-3.5" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-medium leading-tight">{activity.message}</p>
                                        <p className="text-xs text-muted-foreground truncate">{activity.detail}</p>
                                    </div>
                                    <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5 whitespace-nowrap">
                                        {activity.time}
                                    </span>
                                </div>
                            )
                        })}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
