import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { ApresentacaoProjeto } from "@/components/planejamento/apresentacao-projeto"

// S-PLA-05: slides do projeto. O modo apresentar é `?apresentar=1` (a leitura do endereço pede Suspense).
export default function ApresentacaoPage() {
    return (
        <Suspense fallback={<Skeleton className="aspect-video w-full" />}>
            <ApresentacaoProjeto />
        </Suspense>
    )
}
