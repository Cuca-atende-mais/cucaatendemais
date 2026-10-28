"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, Lock, Plus } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/lib/auth/user-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Aviso } from "@/components/planejamento/projeto-form"
import { PLA_PROJ } from "@/lib/rbac/catalogo-planejamento"
import { ANO_PLANEJAMENTO, corStatus, rotuloStatus, rotuloTipo, type StatusProjeto, type TipoProjeto } from "@/lib/planejamento/projeto"
import { carregarSetores, dataHoraFortaleza, type Setor } from "@/lib/planejamento/projeto-dados"

// S-PLA-02 (AC13): lista mínima, só para dar acesso às páginas dos projetos. A S-PLA-03 transforma
// esta página na lista completa (contadores, filtros, cards, seletor de status).

type LinhaLista = { id: string; nome: string; setor_id: string; tipo: TipoProjeto; status: StatusProjeto; updated_at: string }

export default function PlanejamentoProjetosPage() {
    const router = useRouter()
    const supabase = useMemo(() => createClient(), [])
    const { loading: carregandoUsuario, hasPermission } = useUser()
    const podeVer = hasPermission(PLA_PROJ.ver, "read")
    const podeCriar = hasPermission(PLA_PROJ.criar, "read")

    const [linhas, setLinhas] = useState<LinhaLista[] | null>(null)
    const [setores, setSetores] = useState<Setor[]>([])
    const [erro, setErro] = useState<string | null>(null)

    useEffect(() => {
        if (carregandoUsuario || !podeVer) return
        let cancelado = false
        ;(async () => {
            try {
                const [s, { data, error }] = await Promise.all([
                    carregarSetores(supabase),
                    supabase.from("planejamento_projetos").select("id, nome, setor_id, tipo, status, updated_at")
                        .eq("ano", ANO_PLANEJAMENTO).order("updated_at", { ascending: false }),
                ])
                if (error) throw new Error(error.message)
                if (cancelado) return
                setSetores(s)
                setLinhas((data ?? []) as LinhaLista[])
            } catch (e) {
                if (!cancelado) setErro(e instanceof Error ? e.message : String(e))
            }
        })()
        return () => { cancelado = true }
    }, [carregandoUsuario, podeVer, supabase])

    if (carregandoUsuario) return <Skeleton className="h-64 w-full" />
    if (!podeVer) {
        return <Aviso icone={<Lock className="h-8 w-8 text-muted-foreground" />} titulo="Você não tem acesso aos projetos do Planejamento." texto="Peça a liberação no seu perfil de acesso." />
    }

    const setorPorId = new Map(setores.map(s => [s.id, s]))

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <h1 className="flex-1 text-2xl font-semibold tracking-tight">Projetos — Planejamento {ANO_PLANEJAMENTO}</h1>
                {podeCriar && (
                    <Button onClick={() => router.push("/planejamento/novo")}><Plus className="mr-1 h-4 w-4" /> Novo Projeto</Button>
                )}
            </div>

            {erro ? (
                <Aviso icone={<AlertTriangle className="h-8 w-8 text-rose-600" />} titulo="Não foi possível carregar os projetos." texto={erro} />
            ) : linhas === null ? (
                <Skeleton className="h-64 w-full" />
            ) : linhas.length === 0 ? (
                <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">Nenhum projeto cadastrado ainda.</CardContent></Card>
            ) : (
                <Card>
                    <CardContent className="p-0">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Nome</TableHead>
                                    <TableHead>Setor</TableHead>
                                    <TableHead>Tipo</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Atualizado em</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {linhas.map(l => {
                                    const setor = setorPorId.get(l.setor_id)
                                    return (
                                        <TableRow key={l.id} className="cursor-pointer" onClick={() => router.push(`/planejamento/projeto/${l.id}`)}>
                                            <TableCell className="font-medium">{l.nome}</TableCell>
                                            <TableCell>
                                                {setor ? <Badge className="text-white" style={{ backgroundColor: setor.cor }}>{setor.nome}</Badge> : l.setor_id}
                                            </TableCell>
                                            <TableCell>{rotuloTipo(l.tipo)}</TableCell>
                                            <TableCell><Badge variant="outline" className={corStatus(l.status)}>{rotuloStatus(l.status)}</Badge></TableCell>
                                            <TableCell className="text-muted-foreground">{dataHoraFortaleza(l.updated_at)}</TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
