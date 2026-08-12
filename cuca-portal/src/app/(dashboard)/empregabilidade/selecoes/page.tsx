"use client"

// SQS-56 (T7): listagem interna de Processos Seletivos por Evento (selecao_evento).
// Separado de Vagas — decisão do Junior (opção A, AC16): seleções deixam de
// aparecer na listagem de Vagas normais.

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase/client"
import { Vaga, Empresa } from "@/lib/types/database"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
    Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip"
import {
    Loader2, Plus, CalendarDays, Users, Globe, FileText, FileX2, Search, ChevronRight, Building2,
} from "lucide-react"
import { SelecaoModal } from "@/components/empregabilidade/selecao-modal"
import { useUser } from "@/lib/auth/user-provider"

export const SELECOES_KEY = ["empregabilidade", "selecoes"] as const

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
    aberta: { label: "Aberta", className: "bg-green-500/15 text-green-400 border-green-500/30" },
    pre_cadastro: { label: "Rascunho", className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    preenchida: { label: "Preenchida", className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    cancelada: { label: "Cancelada", className: "bg-red-500/15 text-red-400 border-red-500/30" },
}

function StatusBadge({ status }: { status: string }) {
    const cfg = STATUS_LABEL[status]
    return (
        <Badge variant="outline" className={cfg?.className || "text-muted-foreground"}>
            {cfg?.label || status}
        </Badge>
    )
}

/** Formata "2026-09-12" → "12/09/2026". Retorna "" se vazio/mal formado. */
function formatarData(iso: string | undefined): string {
    if (!iso) return ""
    const p = iso.split("-")
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso
}

export default function SelecoesPage() {
    const supabase = createClient()
    const router = useRouter()
    const qc = useQueryClient()
    const { hasPermission } = useUser()

    const [isModalOpen, setIsModalOpen] = useState(false)
    const [busca, setBusca] = useState("")
    const [filtroStatus, setFiltroStatus] = useState<string>("todas")

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

    const todas = data?.selecoes ?? []
    const empresasMap = data?.empresasMap ?? {}
    const confirmadosCount = data?.confirmadosCount ?? {}

    const nomeEmpresa = (v: Vaga) =>
        empresasMap[v.empresa_id]?.nome_fantasia || empresasMap[v.empresa_id]?.nome || "—"

    const selecoes = todas.filter(v => {
        if (filtroStatus !== "todas" && v.status !== filtroStatus) return false
        if (!busca) return true
        const s = busca.toLowerCase()
        const cargos = (v.cargos_lista || []).map(c => c.titulo).join(" ").toLowerCase()
        return nomeEmpresa(v).toLowerCase().includes(s) || cargos.includes(s)
    })

    const invalidate = () => qc.invalidateQueries({ queryKey: SELECOES_KEY })

    const contagem = {
        todas: todas.length,
        aberta: todas.filter(v => v.status === "aberta").length,
        pre_cadastro: todas.filter(v => v.status === "pre_cadastro").length,
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <CalendarDays className="h-8 w-8 text-cuca-blue" />
                        Seleções
                    </h1>
                    <p className="text-muted-foreground">Processos seletivos por evento — presenciais e com data marcada.</p>
                </div>
                {hasPermission("empreg_selecao", "create") && (
                    <Button className="bg-cuca-blue text-white hover:bg-sky-800 font-bold" onClick={() => setIsModalOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" /> Nova Seleção
                    </Button>
                )}
            </div>

            {/* Filtros */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-1 bg-muted p-1 rounded-lg">
                    {([
                        ["todas", `Todas (${contagem.todas})`],
                        ["aberta", `Abertas (${contagem.aberta})`],
                        ["pre_cadastro", `Rascunhos (${contagem.pre_cadastro})`],
                    ] as const).map(([valor, rotulo]) => (
                        <Button
                            key={valor}
                            variant={filtroStatus === valor ? "secondary" : "ghost"}
                            size="sm"
                            className="h-8 text-xs px-3"
                            onClick={() => setFiltroStatus(valor)}
                        >
                            {rotulo}
                        </Button>
                    ))}
                </div>
                <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar por empresa ou cargo..."
                        className="pl-10 w-72 h-9"
                        value={busca}
                        onChange={e => setBusca(e.target.value)}
                    />
                </div>
            </div>

            <Card className="border-none shadow-sm overflow-hidden">
                <CardContent className="p-0">
                    {/* `table-fixed` + larguras explícitas: sem isso a coluna de
                        cargos (que pode ter 10+ títulos) empurra a tabela para
                        fora da tela e esconde as colunas seguintes. */}
                    <Table className="table-fixed w-full">
                        <TableHeader className="bg-muted/30">
                            <TableRow>
                                <TableHead className="w-[26%]">Empresa</TableHead>
                                <TableHead className="w-[30%]">Cargos</TableHead>
                                <TableHead className="w-[14%]">Data</TableHead>
                                <TableHead className="w-[14%]">Currículo</TableHead>
                                <TableHead className="w-[10%]">Status</TableHead>
                                <TableHead className="w-[6%] text-center">Conf.</TableHead>
                                <TableHead className="w-14"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                                    <Loader2 className="h-5 w-5 animate-spin inline-block" />
                                </TableCell></TableRow>
                            ) : selecoes.length === 0 ? (
                                <TableRow><TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                                    {todas.length === 0
                                        ? "Nenhuma seleção cadastrada."
                                        : "Nenhuma seleção encontrada com os filtros aplicados."}
                                </TableCell></TableRow>
                            ) : selecoes.map(v => {
                                const datas = v.datas_selecao || []
                                const cargos = (v.cargos_lista || []).map(c => c.titulo).filter(Boolean)
                                // Mostra só os 2 primeiros + contador; a lista
                                // completa fica no tooltip e na página de detalhe.
                                const cargosVisiveis = cargos.slice(0, 2).join(", ")
                                const restantes = cargos.length - 2
                                return (
                                    <TableRow
                                        key={v.id}
                                        className="cursor-pointer hover:bg-muted/30"
                                        onClick={() => router.push(`/empregabilidade/selecoes/${v.id}`)}
                                    >
                                        <TableCell className="max-w-0">
                                            <div className="flex flex-col min-w-0">
                                                <span className="font-semibold truncate flex items-center gap-1.5">
                                                    <Building2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                                                    <span className="truncate">{nomeEmpresa(v)}</span>
                                                </span>
                                                <span className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                                                    {v.numero_vaga && <span className="font-mono">#{v.numero_vaga}</span>}
                                                    {v.unidade_destino === "global" && (
                                                        <span className="inline-flex items-center gap-1 text-cuca-blue">
                                                            <Globe className="h-3 w-3" /> Rede
                                                        </span>
                                                    )}
                                                </span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="max-w-0">
                                            {cargos.length === 0 ? (
                                                <span className="text-muted-foreground text-sm">—</span>
                                            ) : (
                                                <TooltipProvider>
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <div className="flex items-center gap-1.5 min-w-0">
                                                                <span className="text-sm text-muted-foreground truncate">{cargosVisiveis}</span>
                                                                {restantes > 0 && (
                                                                    <Badge variant="secondary" className="text-[10px] h-5 px-1.5 flex-shrink-0">
                                                                        +{restantes}
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                        </TooltipTrigger>
                                                        <TooltipContent className="max-w-sm">
                                                            <p className="text-xs">{cargos.join(" · ")}</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                                            {datas[0] ? (
                                                <span>
                                                    {formatarData(datas[0].data)}
                                                    {datas[0].hora ? ` · ${datas[0].hora}` : ""}
                                                    {datas.length > 1 && <span className="text-xs opacity-70"> +{datas.length - 1}</span>}
                                                </span>
                                            ) : "—"}
                                        </TableCell>
                                        <TableCell>
                                            {v.coleta_curriculo ? (
                                                <Badge variant="outline" className="gap-1 text-xs whitespace-nowrap">
                                                    <FileText className="h-3 w-3" /> Com currículo
                                                </Badge>
                                            ) : (
                                                <Badge variant="outline" className="gap-1 text-xs whitespace-nowrap text-amber-600 border-amber-500/40 bg-amber-500/10">
                                                    <FileX2 className="h-3 w-3" /> Só presença
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell><StatusBadge status={v.status} /></TableCell>
                                        <TableCell className="text-center">
                                            <span className="inline-flex items-center gap-1 text-sm font-medium">
                                                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                                                {confirmadosCount[v.id] ?? 0}
                                            </span>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <ChevronRight className="h-4 w-4 text-muted-foreground inline-block" />
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
                selecao={null}
            />
        </div>
    )
}
