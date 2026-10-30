import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { CalendarioPlanejamento } from "@/components/planejamento/calendario-planejamento"

// S-PLA-07: Calendário 2027. Mês, legenda e filtros ficam no endereço (a leitura pede Suspense).
export default function CalendarioPage() {
    return (
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
            <CalendarioPlanejamento />
        </Suspense>
    )
}
