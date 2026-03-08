"use client"

import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

type Priority = "high" | "medium" | "low"

interface ActivityRow {
    id: string
    priority: Priority
    description: string
    type: string
    date: string
    time: string
}

const PRIORITY_CONFIG: Record<Priority, { label: string; className: string }> = {
    high:   { label: "Alta",  className: "bg-rose-500/15 text-rose-400 border-rose-500/25 hover:bg-rose-500/20" },
    medium: { label: "Média", className: "bg-amber-500/15 text-amber-400 border-amber-500/25 hover:bg-amber-500/20" },
    low:    { label: "Baixa", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/25 hover:bg-emerald-500/20" },
}

const mockActivities: ActivityRow[] = [
    { id: "#00841", priority: "high",   description: "Manifestação sem resposta há 3 dias",       type: "Ouvidoria",   date: "08/03/2026", time: "14:35" },
    { id: "#00840", priority: "high",   description: "Lead aguardando atendimento há mais de 2h",  type: "Lead",        date: "08/03/2026", time: "13:12" },
    { id: "#00839", priority: "medium", description: "Nova candidatura recebida para triagem",      type: "Emprego",     date: "08/03/2026", time: "12:48" },
    { id: "#00838", priority: "medium", description: "Vaga próxima de vencer (2 dias restantes)",  type: "Emprego",     date: "08/03/2026", time: "11:30" },
    { id: "#00837", priority: "medium", description: "Evento de escuta com 85% de capacidade",     type: "Ouvidoria",   date: "08/03/2026", time: "10:05" },
    { id: "#00836", priority: "low",    description: "Programação mensal de Mar/2026 importada",   type: "Programação", date: "07/03/2026", time: "18:22" },
    { id: "#00835", priority: "low",    description: "Novo lead cadastrado via formulário público", type: "Lead",        date: "07/03/2026", time: "17:45" },
    { id: "#00834", priority: "low",    description: "Backup automático de dados concluído",        type: "Sistema",     date: "07/03/2026", time: "23:00" },
]

interface ActivityTableProps {
    loading?: boolean
}

export function ActivityTable({ loading }: ActivityTableProps) {
    if (loading) {
        return (
            <div className="space-y-2">
                {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-11 w-full" />
                ))}
            </div>
        )
    }

    return (
        <div className="rounded-xl border border-border overflow-hidden">
            {/* Table header */}
            <div className="grid grid-cols-[100px_1fr_80px_100px_90px_60px] gap-x-4 px-4 py-2.5 bg-muted/50 border-b border-border">
                {["Prioridade", "Descrição", "ID", "Tipo", "Data", "Hora"].map(h => (
                    <span key={h} className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                        {h}
                    </span>
                ))}
            </div>

            {/* Rows */}
            {mockActivities.map((row, i) => {
                const prio = PRIORITY_CONFIG[row.priority]
                return (
                    <div
                        key={row.id}
                        className={cn(
                            "grid grid-cols-[100px_1fr_80px_100px_90px_60px] gap-x-4 px-4 py-3 items-center text-sm transition-colors",
                            "hover:bg-accent/40 cursor-default",
                            i !== mockActivities.length - 1 && "border-b border-border/50"
                        )}
                    >
                        <div>
                            <Badge
                                variant="outline"
                                className={cn("text-[10px] font-semibold px-2 py-0.5 border", prio.className)}
                            >
                                {prio.label}
                            </Badge>
                        </div>
                        <span className="text-foreground/90 truncate">{row.description}</span>
                        <span className="text-muted-foreground font-mono text-xs">{row.id}</span>
                        <span className="text-muted-foreground text-xs">{row.type}</span>
                        <span className="text-muted-foreground text-xs">{row.date}</span>
                        <span className="text-muted-foreground text-xs">{row.time}</span>
                    </div>
                )
            })}
        </div>
    )
}
