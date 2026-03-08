"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { CalendarDays, MapPin } from "lucide-react"
import { cn } from "@/lib/utils"

const mockEvents = [
    {
        id: 1,
        title: "Roda de Conversa — Juventude",
        date: "Hoje, 14h",
        local: "CUCA Barra",
        color: "border-l-amber-400",
        dot: "bg-amber-400",
    },
    {
        id: 2,
        title: "Oficina de Currículo",
        date: "Amanhã, 09h",
        local: "CUCA Mondubim",
        color: "border-l-emerald-400",
        dot: "bg-emerald-400",
    },
    {
        id: 3,
        title: "Escuta de Ouvidoria",
        date: "Qui, 15h",
        local: "CUCA Jangurussu",
        color: "border-l-rose-400",
        dot: "bg-rose-400",
    },
    {
        id: 4,
        title: "Programação Cultural",
        date: "Sex, 18h",
        local: "CUCA Centro",
        color: "border-l-indigo-400",
        dot: "bg-indigo-400",
    },
]

export function WeekTimeline({ loading }: { loading?: boolean }) {
    return (
        <Card className="h-full">
            <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-indigo-500" />
                    Esta Semana
                    <span className="ml-auto text-xs font-normal text-muted-foreground">dados ilustrativos</span>
                </CardTitle>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="space-y-3">
                        {Array.from({ length: 4 }).map((_, i) => (
                            <Skeleton key={i} className="h-14 w-full" />
                        ))}
                    </div>
                ) : (
                    <div className="space-y-2">
                        {mockEvents.map((event) => (
                            <div
                                key={event.id}
                                className={cn(
                                    "border-l-2 pl-3 py-2 rounded-r-lg transition-colors",
                                    "bg-muted/30 hover:bg-muted/60",
                                    event.color
                                )}
                            >
                                <p className="text-xs font-medium leading-tight">{event.title}</p>
                                <div className="flex items-center gap-2 mt-0.5">
                                    <span className="text-[10px] text-muted-foreground">{event.date}</span>
                                    <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                                        <MapPin className="h-2.5 w-2.5" />
                                        {event.local}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </CardContent>
        </Card>
    )
}
