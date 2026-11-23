import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { CalendarioGeral } from "@/components/planejamento/calendario-geral"

// S-PLA-10: Calendário Geral 2027 (pedido da direção). Os filtros ficam no endereço (a leitura pede Suspense).
export default function CalendarioGeralPage() {
    return (
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
            <CalendarioGeral />
        </Suspense>
    )
}
