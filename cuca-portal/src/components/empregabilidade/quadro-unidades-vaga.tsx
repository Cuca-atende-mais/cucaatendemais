"use client"

// S-EMP-GES-13 (AC14): bloco do detalhe da vaga/seleção com a Unidade de Tratamento, a Unidade de
// Currículos e quem liberou (com data e hora). Usado em vagas/[id] e selecoes/[id]. `LiberadoPorVaga`
// é só a parte de "Liberado por", para o modal da vaga, onde as duas unidades já aparecem como campos.

import { useQuery } from "@tanstack/react-query"
import { Building, UserCheck, Users } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import type { Vaga } from "@/lib/types/database"
import { rotuloUnidadeCurriculos } from "@/lib/empregabilidade/unidades-vaga"
import { buscarLiberadoPor, textoLiberadaEm } from "@/lib/empregabilidade/liberado-por"
import { cn } from "@/lib/utils"

type VagaQuadro = Pick<Vaga, "id" | "unidade_destino" | "unidade_tratamento" | "liberada_por" | "liberada_por_usuario" | "liberada_em">

export function QuadroUnidadesVaga({ vaga, className }: { vaga: VagaQuadro; className?: string }) {
    const { data } = useQuery({
        queryKey: ["empregabilidade", "quadro-unidades", vaga.id, vaga.liberada_por_usuario ?? vaga.liberada_por ?? ""],
        staleTime: 60_000,
        queryFn: async () => {
            const supabase = createClient()
            const [{ data: uds }, liberado] = await Promise.all([
                supabase.from("unidades_cuca").select("id, nome"),
                buscarLiberadoPor(supabase, [vaga]),
            ])
            const nomes: Record<string, string> = {}
            for (const u of uds ?? []) nomes[u.id] = u.nome
            return { nomes, liberadoPor: liberado.get(vaga.id) ?? null }
        },
    })

    const nomes = data?.nomes ?? {}
    const tratamento = vaga.unidade_tratamento
        ? nomes[vaga.unidade_tratamento] ?? (data ? "Unidade não encontrada" : "…")
        : null
    const liberadaEm = textoLiberadaEm(vaga.liberada_em)

    return (
        <dl className={cn("grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-lg border bg-muted/30 p-3", className)}>
            <div className="min-w-0">
                <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Building className="h-3.5 w-3.5 text-cuca-blue shrink-0" aria-hidden /> Unidade de Tratamento
                </dt>
                <dd className="mt-0.5 text-sm break-words">
                    {tratamento ?? (
                        <span className="text-amber-700 dark:text-amber-400">Sem unidade de tratamento (vaga criada antes do campo)</span>
                    )}
                </dd>
            </div>
            <div className="min-w-0">
                <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Users className="h-3.5 w-3.5 text-cuca-blue shrink-0" aria-hidden /> Unidade de Currículos
                </dt>
                <dd className="mt-0.5 text-sm break-words">
                    {data ? rotuloUnidadeCurriculos(vaga.unidade_destino, nomes) : "…"}
                </dd>
            </div>
            <div className="min-w-0">
                <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <UserCheck className="h-3.5 w-3.5 text-cuca-blue shrink-0" aria-hidden /> Liberado por
                </dt>
                <dd className="mt-0.5 text-sm break-words">
                    {data?.liberadoPor ?? "—"}
                    {liberadaEm && <span className="block text-xs text-muted-foreground">{liberadaEm}</span>}
                </dd>
            </div>
        </dl>
    )
}

type VagaLiberacao = Pick<Vaga, "id" | "liberada_por" | "liberada_por_usuario" | "liberada_em">

export function LiberadoPorVaga({ vaga, className }: { vaga: VagaLiberacao; className?: string }) {
    const temAutor = Boolean(vaga.liberada_por || vaga.liberada_por_usuario)
    const { data, isPending } = useQuery({
        queryKey: ["empregabilidade", "liberado-por", vaga.id, vaga.liberada_por_usuario ?? vaga.liberada_por ?? ""],
        staleTime: 60_000,
        enabled: temAutor,
        queryFn: async () => (await buscarLiberadoPor(createClient(), [vaga])).get(vaga.id) ?? null,
    })
    const liberadaEm = textoLiberadaEm(vaga.liberada_em)

    return (
        <dl className={cn("rounded-lg border bg-muted/30 p-3", className)}>
            <dt className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <UserCheck className="h-3.5 w-3.5 text-cuca-blue shrink-0" aria-hidden /> Liberado por
            </dt>
            <dd className="mt-0.5 text-sm break-words">
                {temAutor && isPending ? "…" : data ?? "—"}
                {liberadaEm && <span className="block text-xs text-muted-foreground">{liberadaEm}</span>}
            </dd>
        </dl>
    )
}
