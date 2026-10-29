"use client"

import { Suspense } from "react"
import { Skeleton } from "@/components/ui/skeleton"
import { ListaProjetos } from "@/components/planejamento/lista-projetos"

// S-PLA-03: lista completa de projetos (contadores, filtros na URL, cards e tabela). O Suspense é
// exigido pelo Next porque a lista lê os filtros da URL (useSearchParams).
export default function PlanejamentoProjetosPage() {
    return (
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <ListaProjetos />
        </Suspense>
    )
}
