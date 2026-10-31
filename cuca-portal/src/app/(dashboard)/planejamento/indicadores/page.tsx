import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { PainelIndicadores } from "@/components/planejamento/painel-indicadores"

// S-PLA-08: Painel de Indicadores do Planejamento 2027. Os filtros ficam no endereço (a leitura pede Suspense).
export default function IndicadoresPage() {
    return (
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
            <PainelIndicadores />
        </Suspense>
    )
}
