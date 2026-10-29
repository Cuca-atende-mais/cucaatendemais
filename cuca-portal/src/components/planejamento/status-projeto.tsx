import { CheckCircle2, Flag, Hammer, PlayCircle, Save, XCircle, type LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { corStatus, rotuloStatus, type StatusProjeto } from "@/lib/planejamento/projeto"

// S-PLA-03 (AC10): os 6 status com ícone e cor próprios, iguais em todo o módulo.
export const ICONE_STATUS: Record<StatusProjeto, LucideIcon> = {
    em_construcao: Hammer,
    projeto_salvo: Save,
    aprovado: CheckCircle2,
    em_execucao: PlayCircle,
    concluido: Flag,
    reprovado: XCircle,
}

export function StatusBadge({ status, className }: { status: StatusProjeto; className?: string }) {
    const Icone = ICONE_STATUS[status]
    return (
        <Badge variant="outline" className={cn(corStatus(status), className)}>
            <Icone aria-hidden /> {rotuloStatus(status)}
        </Badge>
    )
}
