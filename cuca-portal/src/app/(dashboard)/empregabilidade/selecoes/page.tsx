"use client"

// SQS-56 (T7): listagem interna de Processos Seletivos por Evento (selecao_evento).
// Separado de Vagas — decisão do Junior (opção A, AC16): seleções deixam de
// aparecer na listagem de Vagas normais.

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase/client"
import { Vaga, Empresa } from "@/lib/types/database"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Loader2, Plus, CalendarDays, Users, Globe, FileText, FileX2 } from "lucide-react"
import { SelecaoModal } from "@/components/empregabilidade/selecao-modal"
import { SelecaoDetalheModal } from "@/components/empregabilidade/selecao-detalhe-modal"
import { useUser } from "@/lib/auth/user-provider"

const SELECOES_KEY = ["empregabilidade", "selecoes"] as const

export default function SelecoesPage() {
    const supabase = createClient()
    const qc = useQueryClient()
    const { hasPermission } = useUser()

    const [isModalOpen, setIsModalOpen] = useState(false)
    const [editando, setEditando] = useState<Vaga | null>(null)
    const [detalheAberto, setDetalheAberto] = useState<Vaga | null>(null)

    const { data, isLoading } = useQuery({
        queryKey: SELECOES_KEY,
        queryFn: async () => {
            // AC16: filtro em JS, não na query — `.neq("tipo", "selecao_evento")`
            // no Postgres exclui silenciosamente linhas com tipo NULL (NULL !=
            // 'x' não é true). Aqui é o inverso (só quero selecao_evento), mas
            // o mesmo cuidado se aplica: comparar em JS evita a armadilha.
            const { data: vagasData, error } = await supabase
                .from("vagas")
                .select("*")
                .order("created_at", { ascending: false })
            if (error) throw error

            const selecoes = (vagasData || []).filter(v => v.tipo === "selecao_evento") as Vaga[]

            const { data: emp } = await supabase.from("empresas").select("*")
            const empresasMap: Record<string, Empresa> = {}
            for (const e of emp ?? []) empresasMap[e.id] = e

            const confirmadosCount: Record<string, number> = {}
            if (selecoes.length > 0) {
                const { data: cands } = await supabase
                    .from("candidaturas")
                    .select("vaga_id")
                    .in("vaga_id", selecoes.map(v => v.id))
                for (const c of cands ?? []) confirmadosCount[c.vaga_id] = (confirmadosCount[c.vaga_id] || 0) + 1
            }

            return { selecoes, empresasMap, confirmadosCount }
        },
    })

    const selecoes = data?.selecoes ?? []
    const empresasMap = data?.empresasMap ?? {}
    const confirmadosCount = data?.confirmadosCount ?? {}

    const invalidate = () => qc.invalidateQueries({ queryKey: SELECOES_KEY })

    const abrirNova = () => { setEditando(null); setIsModalOpen(true) }
    const abrirEdicao = (v: Vaga) => { setEditando(v); setIsModalOpen(true); setDetalheAberto(null) }

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "aberta": return <Badge className="bg-green-600 text-white">Aberta</Badge>
            case "pre_cadastro": return <Badge variant="outline" className="text-amber-600 border-amber-600 bg-amber-50">Rascunho</Badge>
            case "preenchida": return <Badge variant="secondary">Preenchida</Badge>
            case "cancelada": return <Badge variant="destructive">Cancelada</Badge>
            default: return <Badge variant="outline">{status}</Badge>
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <CalendarDays className="h-8 w-8 text-cuca-blue" />
                        Seleções
                    </h1>
                    <p className="text-muted-foreground">Processos seletivos por evento — presenciais e com data marcada.</p>
                </div>
                {hasPermission("empreg_selecao", "create") && (
                    <Button className="bg-cuca-blue text-white hover:bg-sky-800 font-bold" onClick={abrirNova}>
                        <Plus className="mr-2 h-4 w-4" /> Nova Seleção
                    </Button>
                )}
            </div>

            <Card className="border-none shadow-sm overflow-hidden">
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-muted/30">
                            <TableRow>
                                <TableHead>Empresa</TableHead>
                                <TableHead>Cargos</TableHead>
                                <TableHead>Data</TableHead>
                                <TableHead>Currículo</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-center">Confirmados</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">
                                    <Loader2 className="h-5 w-5 animate-spin inline-block" />
                                </TableCell></TableRow>
                            ) : selecoes.length === 0 ? (
                                <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">Nenhuma seleção cadastrada.</TableCell></TableRow>
                            ) : selecoes.map(v => {
                                const datas = v.datas_selecao || []
                                const cargos = (v.cargos_lista || []).map(c => c.titulo).filter(Boolean)
                                return (
                                    <TableRow key={v.id} className="cursor-pointer hover:bg-muted/30" onClick={() => setDetalheAberto(v)}>
                                        <TableCell>
                                            <div className="flex flex-col">
                                                <span className="font-semibold flex items-center gap-2">
                                                    {empresasMap[v.empresa_id]?.nome_fantasia || empresasMap[v.empresa_id]?.nome || "—"}
                                                    {v.unidade_destino === "global" && <Badge className="bg-cuca-blue/10 text-cuca-blue border-cuca-blue/30 text-[10px] h-4 px-1 gap-1"><Globe className="h-2.5 w-2.5" /> Rede</Badge>}
                                                </span>
                                                {v.numero_vaga && <span className="text-xs text-muted-foreground font-mono">#{v.numero_vaga}</span>}
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">{cargos.join(", ") || "—"}</TableCell>
                                        <TableCell className="text-sm text-muted-foreground">
                                            {datas[0] ? `${datas[0].data?.split("-").reverse().join("/")}${datas[0].hora ? ` ${datas[0].hora}` : ""}` : "—"}
                                            {datas.length > 1 && <span className="text-xs"> (+{datas.length - 1})</span>}
                                        </TableCell>
                                        <TableCell>
                                            {v.coleta_curriculo ? (
                                                <Badge variant="outline" className="gap-1 text-xs"><FileText className="h-3 w-3" /> Sim</Badge>
                                            ) : (
                                                <Badge variant="outline" className="gap-1 text-xs text-amber-600 border-amber-500/40 bg-amber-50/50"><FileX2 className="h-3 w-3" /> Só presença</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell>{getStatusBadge(v.status)}</TableCell>
                                        <TableCell className="text-center">
                                            <span className="inline-flex items-center gap-1 text-sm font-medium">
                                                <Users className="h-3.5 w-3.5 text-muted-foreground" /> {confirmadosCount[v.id] ?? 0}
                                            </span>
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <SelecaoModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onSuccess={invalidate}
                selecao={editando}
            />

            <SelecaoDetalheModal
                open={detalheAberto !== null}
                onOpenChange={(o) => { if (!o) setDetalheAberto(null) }}
                selecao={detalheAberto}
                empresaNome={detalheAberto ? (empresasMap[detalheAberto.empresa_id]?.nome_fantasia || empresasMap[detalheAberto.empresa_id]?.nome || "") : ""}
                onEditar={() => detalheAberto && abrirEdicao(detalheAberto)}
            />
        </div>
    )
}
