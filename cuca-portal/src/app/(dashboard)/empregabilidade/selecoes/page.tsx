"use client"

// SQS-56 (T7): listagem interna de Processos Seletivos por Evento (selecao_evento).
// Separado de Vagas — decisão do Junior (opção A, AC16): seleções deixam de
// aparecer na listagem de Vagas normais.
// S-EMP-GES-13 (AC16, AC18, AC20): colunas novas, grade com colunas ajustáveis e cartões no celular.

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase/client"
import { Vaga, Empresa } from "@/lib/types/database"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
    Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip"
import {
    Loader2, Plus, CalendarDays, Users, Search, Building2, ArrowRight, Building, UserCheck,
} from "lucide-react"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { SelecaoModal } from "@/components/empregabilidade/selecao-modal"
import { DataGrid, type ColunaGrade } from "@/components/ui/data-grid"
import { useUser } from "@/lib/auth/user-provider"
import { SeloSemResposta, useDiasSemResposta } from "@/components/empregabilidade/selo-sem-resposta"
import { hojeBrasilISO } from "@/lib/empregabilidade/data-selecao-prevista"
import { escolherDataSelecao, formatarDataHoraSelecao } from "@/lib/empregabilidade/unidades-vaga"
import { buscarLiberadoPor, textoLiberadaEm } from "@/lib/empregabilidade/liberado-por"

export const SELECOES_KEY = ["empregabilidade", "selecoes"] as const

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
    aberta: { label: "Aberta", className: "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/30" },
    pre_cadastro: { label: "Rascunho", className: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" },
    preenchida: { label: "Preenchida", className: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30" },
    cancelada: { label: "Cancelada", className: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30" },
}

function StatusBadge({ status }: { status: string }) {
    const cfg = STATUS_LABEL[status]
    return (
        <Badge variant="outline" className={cfg?.className || "text-muted-foreground"}>
            {cfg?.label || status}
        </Badge>
    )
}

/** S-EMP-GES-13: seleção antiga sem Unidade de Tratamento aparece marcada, sem bloqueio (D1, D12). */
function SeloUnidadeTratamento({ id, nomes }: { id: string | null | undefined; nomes: Record<string, string> }) {
    if (!id) {
        return (
            <Badge variant="outline" className="text-amber-700 dark:text-amber-400 border-amber-500/50 bg-amber-500/10 max-w-full" title="Seleção criada antes da unidade de tratamento">
                <span className="truncate">Sem unidade</span>
            </Badge>
        )
    }
    return <span className="block truncate text-sm">{nomes[id] ?? "Unidade não encontrada"}</span>
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

            const [{ data: emp }, { data: uds }] = await Promise.all([
                supabase.from("empresas").select("*"),
                supabase.from("unidades_cuca").select("id, nome"),
            ])
            const empresasMap: Record<string, Empresa> = {}
            for (const e of emp ?? []) empresasMap[e.id] = e
            const unidadesMap: Record<string, string> = {}
            for (const u of uds ?? []) unidadesMap[u.id] = u.nome

            const confirmadosCount: Record<string, number> = {}
            let liberadoPor = new Map<string, string>()
            if (selecoes.length > 0) {
                const [{ data: cands }, mapa] = await Promise.all([
                    supabase.from("candidaturas").select("vaga_id").in("vaga_id", selecoes.map(v => v.id)),
                    buscarLiberadoPor(supabase, selecoes),
                ])
                for (const c of cands ?? []) confirmadosCount[c.vaga_id] = (confirmadosCount[c.vaga_id] || 0) + 1
                liberadoPor = mapa
            }

            return { selecoes, empresasMap, unidadesMap, confirmadosCount, liberadoPor }
        },
    })

    const todas = useMemo(() => data?.selecoes ?? [], [data])
    const empresasMap = useMemo(() => data?.empresasMap ?? {}, [data])
    const unidadesMap = useMemo(() => data?.unidadesMap ?? {}, [data])
    const confirmadosCount = useMemo(() => data?.confirmadosCount ?? {}, [data])
    const liberadoPor = useMemo(() => data?.liberadoPor ?? new Map<string, string>(), [data])
    const hoje = hojeBrasilISO()

    const nomeEmpresa = (v: Vaga) =>
        empresasMap[v.empresa_id]?.nome_fantasia || empresasMap[v.empresa_id]?.nome || "—"

    const selecoes = todas.filter(v => {
        if (filtroStatus !== "todas" && v.status !== filtroStatus) return false
        if (!busca) return true
        const s = busca.toLowerCase()
        const cargos = (v.cargos_lista || []).map(c => c.titulo).join(" ").toLowerCase()
        return nomeEmpresa(v).toLowerCase().includes(s) || cargos.includes(s)
    })

    const diasSemResposta = useDiasSemResposta(selecoes.map(v => v.id))

    const invalidate = () => qc.invalidateQueries({ queryKey: SELECOES_KEY })
    const abrir = (v: Vaga) => router.push(`/empregabilidade/selecoes/${v.id}`)

    const contagem = {
        todas: todas.length,
        aberta: todas.filter(v => v.status === "aberta").length,
        pre_cadastro: todas.filter(v => v.status === "pre_cadastro").length,
    }

    const cargosDe = (v: Vaga) => (v.cargos_lista || []).map(c => c.titulo).filter(Boolean)

    // S-EMP-GES-13 (AC16): colunas na ordem pedida pelo Junior. A Unidade de Currículos não aparece aqui
    // (fica no detalhe da seleção e no modal, D6).
    const colunas = useMemo<ColunaGrade<Vaga>[]>(() => [
        {
            id: "id", cabecalho: "ID", tamanho: 60, minimo: 56, maximo: 140, alinhar: "centro",
            celula: v => v.numero_vaga
                ? <span className="font-mono text-xs font-semibold text-muted-foreground">#{v.numero_vaga}</span>
                : <span className="text-xs text-muted-foreground/50">—</span>,
        },
        {
            id: "cargo", cabecalho: "Cargo", tamanho: 150, minimo: 120, maximo: 600, interativa: false,
            titulo: v => cargosDe(v).join(" · ") || undefined,
            celula: v => {
                const cargos = cargosDe(v)
                if (cargos.length === 0) return <span className="text-sm text-muted-foreground">—</span>
                // Mostra os 2 primeiros + contador; a lista completa fica no tooltip e no detalhe.
                const restantes = cargos.length - 2
                return (
                    <TooltipProvider>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="text-sm truncate">{cargos.slice(0, 2).join(", ")}</span>
                                    {restantes > 0 && <Badge variant="secondary" className="text-xs px-1.5 flex-shrink-0">+{restantes}</Badge>}
                                </div>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-sm">
                                <p className="text-xs">{cargos.join(" · ")}</p>
                            </TooltipContent>
                        </Tooltip>
                    </TooltipProvider>
                )
            },
        },
        {
            id: "empresa", cabecalho: "Empresa", tamanho: 130, minimo: 100, maximo: 500,
            titulo: v => nomeEmpresa(v),
            celula: v => (
                <span className="flex items-center gap-1.5 min-w-0 text-sm font-semibold">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" aria-hidden />
                    <span className="truncate">{nomeEmpresa(v)}</span>
                </span>
            ),
        },
        {
            id: "cadastro", cabecalho: "Dt. Cadastro", tamanho: 96, minimo: 88, maximo: 200,
            celula: v => <span className="text-sm text-muted-foreground tabular-nums">{format(new Date(v.created_at), "dd/MM/yyyy", { locale: ptBR })}</span>,
        },
        {
            id: "tratamento", cabecalho: "Unid. Tratamento", tamanho: 116, minimo: 96, maximo: 360,
            titulo: v => (v.unidade_tratamento ? unidadesMap[v.unidade_tratamento] : "Seleção criada antes da unidade de tratamento"),
            celula: v => <SeloUnidadeTratamento id={v.unidade_tratamento} nomes={unidadesMap} />,
        },
        {
            id: "data_hora", cabecalho: "Data/hora seleção", tamanho: 124, minimo: 110, maximo: 300,
            titulo: v => (v.datas_selecao || []).map(formatarDataHoraSelecao).join(" · ") || undefined,
            celula: v => {
                const escolha = escolherDataSelecao(v.datas_selecao, hoje)
                if (!escolha) return <span className="text-sm text-muted-foreground/60">—</span>
                return (
                    <span className="text-sm tabular-nums whitespace-nowrap">
                        {formatarDataHoraSelecao(escolha.principal)}
                        {escolha.restantes > 0 && <span className="text-xs text-muted-foreground"> +{escolha.restantes}</span>}
                    </span>
                )
            },
        },
        {
            id: "status", cabecalho: "Status", tamanho: 110, minimo: 96, maximo: 300,
            celula: v => (
                <div className="flex flex-wrap items-center gap-1">
                    <StatusBadge status={v.status} />
                    <SeloSemResposta dias={diasSemResposta.get(v.id)} />
                </div>
            ),
        },
        {
            id: "liberado_por", cabecalho: "Liberado por", tamanho: 116, minimo: 90, maximo: 400,
            titulo: v => textoLiberadaEm(v.liberada_em),
            celula: v => {
                const nome = liberadoPor.get(v.id)
                return nome
                    ? <span className="block truncate text-sm">{nome}</span>
                    : <span className="text-sm text-muted-foreground/60">—</span>
            },
        },
        {
            id: "candidatura", cabecalho: "Candidatura", tamanho: 100, minimo: 90, maximo: 200, alinhar: "centro", interativa: true,
            celula: v => (
                <Button
                    size="sm"
                    className="h-8 text-xs gap-1 px-2.5 bg-green-600 hover:bg-green-700 text-white border-none"
                    onClick={() => abrir(v)}
                    aria-label={`Ver ${confirmadosCount[v.id] ?? 0} candidatura(s) da seleção #${v.numero_vaga ?? ""}`}
                >
                    <Users className="h-3.5 w-3.5" aria-hidden />
                    {confirmadosCount[v.id] ?? 0}
                </Button>
            ),
        },
        {
            id: "ver", cabecalho: "Ver vaga", tamanho: 100, minimo: 90, maximo: 200, alinhar: "centro", interativa: true,
            celula: v => (
                <Button variant="outline" size="sm" className="h-8 text-xs gap-1 px-2.5" onClick={() => abrir(v)} aria-label={`Ver a seleção #${v.numero_vaga ?? ""}`}>
                    Ver vaga <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Button>
            ),
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [empresasMap, unidadesMap, confirmadosCount, liberadoPor, diasSemResposta, hoje])

    return (
        <div className="space-y-6 min-w-0">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="min-w-0">
                    <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
                        <CalendarDays className="h-7 w-7 md:h-8 md:w-8 text-cuca-blue shrink-0" aria-hidden />
                        Seleções
                    </h1>
                    <p className="text-muted-foreground">Processos seletivos por evento — presenciais e com data marcada.</p>
                </div>
                {hasPermission("empreg_selecao", "create") && (
                    <Button className="bg-cuca-blue text-white hover:bg-sky-800 font-bold h-11 md:h-9 w-full sm:w-auto" onClick={() => setIsModalOpen(true)}>
                        <Plus className="mr-2 h-4 w-4" aria-hidden /> Nova Seleção
                    </Button>
                )}
            </div>

            {/* Filtros */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-1 bg-muted p-1 rounded-lg w-full sm:w-auto">
                    {([
                        ["todas", `Todas (${contagem.todas})`],
                        ["aberta", `Abertas (${contagem.aberta})`],
                        ["pre_cadastro", `Rascunhos (${contagem.pre_cadastro})`],
                    ] as const).map(([valor, rotulo]) => (
                        <Button
                            key={valor}
                            variant={filtroStatus === valor ? "secondary" : "ghost"}
                            size="sm"
                            className="h-11 md:h-8 text-xs px-3 flex-1 sm:flex-none"
                            onClick={() => setFiltroStatus(valor)}
                        >
                            {rotulo}
                        </Button>
                    ))}
                </div>
                <div className="relative w-full sm:w-auto">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                    <Input
                        placeholder="Buscar por empresa ou cargo..."
                        aria-label="Buscar por empresa ou cargo"
                        className="pl-10 w-full sm:w-72 h-11 md:h-9 text-base md:text-sm"
                        value={busca}
                        onChange={e => setBusca(e.target.value)}
                    />
                </div>
            </div>

            {/* Abaixo de md (celular): cada seleção vira um cartão, com as mesmas informações da grade (AC20). */}
            <div className="space-y-3 md:hidden">
                {isLoading ? (
                    <p className="text-center py-12 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline-block" aria-label="Carregando" /></p>
                ) : selecoes.length === 0 ? (
                    <p className="text-center py-12 text-muted-foreground">
                        {todas.length === 0 ? "Nenhuma seleção cadastrada." : "Nenhuma seleção encontrada com os filtros aplicados."}
                    </p>
                ) : selecoes.map(v => {
                    const cargos = cargosDe(v)
                    const escolha = escolherDataSelecao(v.datas_selecao, hoje)
                    const nomeLiberou = liberadoPor.get(v.id)
                    return (
                        <Card key={v.id} className="border shadow-sm">
                            <CardContent className="p-4 space-y-3">
                                <div className="min-w-0">
                                    <div className="flex items-start gap-1.5">
                                        <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" aria-hidden />
                                        <span className="font-semibold break-words">{nomeEmpresa(v)}</span>
                                        {v.numero_vaga && <span className="ml-auto font-mono text-xs text-muted-foreground shrink-0">#{v.numero_vaga}</span>}
                                    </div>
                                    {cargos.length > 0 && <p className="text-sm text-muted-foreground break-words mt-1">{cargos.join(" · ")}</p>}
                                </div>

                                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                                    <div className="min-w-0">
                                        <dt className="text-muted-foreground">Dt. Cadastro</dt>
                                        <dd className="tabular-nums">{format(new Date(v.created_at), "dd/MM/yyyy", { locale: ptBR })}</dd>
                                    </div>
                                    <div className="min-w-0">
                                        <dt className="text-muted-foreground flex items-center gap-1"><CalendarDays className="h-3 w-3" aria-hidden /> Seleção</dt>
                                        <dd className="tabular-nums">
                                            {escolha ? formatarDataHoraSelecao(escolha.principal) : "—"}
                                            {escolha && escolha.restantes > 0 && <span className="text-muted-foreground"> +{escolha.restantes}</span>}
                                        </dd>
                                    </div>
                                    <div className="min-w-0">
                                        <dt className="text-muted-foreground flex items-center gap-1"><Building className="h-3 w-3" aria-hidden /> Unid. Tratamento</dt>
                                        <dd className="min-w-0"><SeloUnidadeTratamento id={v.unidade_tratamento} nomes={unidadesMap} /></dd>
                                    </div>
                                    <div className="min-w-0">
                                        <dt className="text-muted-foreground flex items-center gap-1"><UserCheck className="h-3 w-3" aria-hidden /> Liberado por</dt>
                                        <dd className="break-words" title={textoLiberadaEm(v.liberada_em)}>{nomeLiberou ?? "—"}</dd>
                                    </div>
                                </dl>

                                <div className="flex flex-wrap items-center gap-2">
                                    <StatusBadge status={v.status} />
                                    <SeloSemResposta dias={diasSemResposta.get(v.id)} />
                                </div>

                                <div className="flex gap-2 pt-1">
                                    <Button
                                        size="sm"
                                        className="h-11 text-xs gap-1 px-2.5 bg-green-600 hover:bg-green-700 text-white border-none flex-1"
                                        onClick={() => abrir(v)}
                                    >
                                        <Users className="h-3.5 w-3.5" aria-hidden /> {confirmadosCount[v.id] ?? 0} candidatura(s)
                                    </Button>
                                    <Button variant="outline" size="sm" className="h-11 text-xs gap-1 px-2.5" onClick={() => abrir(v)}>
                                        Ver vaga <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    )
                })}
            </div>

            {/* A partir de md: grade com colunas ajustáveis (S-EMP-GES-13, AC18). */}
            <div className="hidden md:block">
                <DataGrid
                    dados={selecoes}
                    colunas={colunas}
                    idLinha={v => v.id}
                    chaveArmazenamento="cuca:grade:selecoes:v1"
                    rotulo="Seleções"
                    carregando={isLoading}
                    vazio={todas.length === 0 ? "Nenhuma seleção cadastrada." : "Nenhuma seleção encontrada com os filtros aplicados."}
                    onClickLinha={abrir}
                    rotuloLinha={v => `Abrir a seleção #${v.numero_vaga ?? ""} de ${nomeEmpresa(v)}`}
                />
            </div>

            <SelecaoModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onSuccess={invalidate}
                selecao={null}
            />
        </div>
    )
}
