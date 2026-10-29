import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { PautaApresentacoes } from "@/components/planejamento/pauta-apresentacoes"

// S-PLA-06: pauta de apresentações. O interruptor "Mostrar encerrados" fica no endereço (Suspense).
export default function ApresentacoesPage() {
    return (
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <PautaApresentacoes />
        </Suspense>
    )
}
