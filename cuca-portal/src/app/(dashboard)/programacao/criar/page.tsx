"use client"

// S-PROG-01: rota dedicada de criação da Programação Mensal — antes era um modal (Dialog) sobre
// a lista, apontado como "tela dentro de tela" pequena demais pra grade editável. Segue o mesmo
// padrão de página já usado por /programacao/mensal/[id] (voltar com ArrowLeft, sem overlay).

import { useRouter, useSearchParams } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { PROGRAMACAO_KEY } from "@/hooks/queries/use-programacao"
import { CriarProgramacaoView } from "@/components/programacao/criar-programacao-view"

export default function CriarProgramacaoPage() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const qc = useQueryClient()

    const unidadeInicial = searchParams.get("unidade") || ""

    return (
        <CriarProgramacaoView
            unidadeInicial={unidadeInicial}
            onCancel={() => router.push("/programacao")}
            onSuccess={() => {
                qc.invalidateQueries({ queryKey: PROGRAMACAO_KEY })
                router.push("/programacao")
            }}
        />
    )
}
