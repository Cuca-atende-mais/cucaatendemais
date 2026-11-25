"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase/client"
import { Vaga, Empresa } from "@/lib/types/database"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Search, Plus, Briefcase, FileText, CheckCircle2, AlertCircle, Users, Globe, Trash2, Pencil, Building, CalendarClock, UserCheck } from "lucide-react"
import { VagaModal } from "@/components/empregabilidade/vaga-modal"
import { DataGrid, type ColunaGrade } from "@/components/ui/data-grid"
import toast from "react-hot-toast"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { useUser } from "@/lib/auth/user-provider"
import { SeloSemResposta, useDiasSemResposta } from "@/components/empregabilidade/selo-sem-resposta"
import { VAGAS_KEY } from "@/hooks/queries/use-vagas"
import { formatarDataISO } from "@/lib/empregabilidade/unidades-vaga"
import { buscarLiberadoPor, textoLiberadaEm } from "@/lib/empregabilidade/liberado-por"

function getStatusBadge(status: string) {
    switch (status) {
        case "aberta": return <Badge className="bg-green-600 text-white gap-1"><CheckCircle2 className="h-3 w-3" /> Aberta / Pública</Badge>
        case "pre_cadastro": return <Badge variant="outline" className="text-amber-600 border-amber-600 bg-amber-50 gap-1"><FileText className="h-3 w-3" /> Rascunho</Badge>
        case "preenchida": return <Badge variant="secondary" className="gap-1"><Users className="h-3 w-3" /> Preenchida</Badge>
        case "cancelada": return <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" /> Cancelada</Badge>
        default: return <Badge variant="outline">{status}</Badge>
    }
}

/** S-EMP-GES-13: vaga antiga sem Unidade de Tratamento aparece marcada, sem bloqueio (D1, D12). */
function SeloUnidadeTratamento({ id, nomes }: { id: string | null | undefined; nomes: Record<string, string> }) {
    if (!id) {
        return (
            <Badge variant="outline" className="text-amber-700 dark:text-amber-400 border-amber-500/50 bg-amber-500/10 max-w-full" title="Vaga criada antes da unidade de tratamento">
                <span className="truncate">Sem unidade</span>
            </Badge>
        )
    }
    return <span className="block truncate text-sm">{nomes[id] ?? "Unidade não encontrada"}</span>
}

export default function VagasPage() {
    const { hasPermission, profile, loading: authLoading } = useUser()
    const router = useRouter()
    const supabase = createClient()
    const qc = useQueryClient()

    const [deletingVaga, setDeletingVaga] = useState<Vaga | null>(null)
    const [deleteLoading, setDeleteLoading] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const [statusFilter, setStatusFilter] = useState<string>("all")
    const [abaFiltro, setAbaFiltro] = useState<"minhas" | "todas">("minhas")
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [selectedVaga, setSelectedVaga] = useState<Vaga | null>(null)

    // ─── Query principal — TanStack Query gerencia cache + invalidação ───────
    const { data, isLoading } = useQuery({
        queryKey: [...VAGAS_KEY, abaFiltro, statusFilter, searchTerm, profile?.id],
        enabled: !authLoading && !!profile,
        staleTime: 20_000,
        queryFn: async () => {
            // Empresas
            const { data: emp } = await supabase.from("empresas").select("*")
            const empresasMap: Record<string, Empresa> = {}
            for (const e of emp ?? []) empresasMap[e.id] = e

            // Unidades (todas, inclusive inativas, para o nome das vagas antigas)
            const { data: uds } = await supabase.from("unidades_cuca").select("id, nome")
            const unidadesMap: Record<string, string> = {}
            for (const u of uds ?? []) unidadesMap[u.id] = u.nome

            // Vagas
            const { data, error } = await supabase
                .from("vagas")
                .select("*")
                .order("created_at", { ascending: false })
            if (error) throw error

            // SQS-56 (AC16): seleções por evento saem desta listagem — têm
            // tela própria em Empregabilidade → Seleções. Filtro em JS, não
            // `.neq("tipo", "selecao_evento")` na query: NULL != 'x' não é
            // true no Postgres, então uma vaga_normal legada com tipo NULL
            // desapareceria silenciosamente da tela inteira.
            let filtered = ((data ?? []) as Vaga[]).filter(v => v.tipo !== "selecao_evento")

            // Filtro de unidade (aba "Minha Unidade") — continua pela Unidade de Currículos
            // (unidade_destino); trocar para a de Tratamento ficou fora da S-EMP-GES-13.
            if (abaFiltro === "minhas" && profile?.unidade_cuca && profile.unidade_cuca !== "Geral") {
                const profileUnitName = profile.unidade_cuca.toLowerCase()
                const profileUnitId = Object.entries(unidadesMap).find(
                    ([, nome]) => nome.toLowerCase() === profileUnitName
                )?.[0]
                filtered = filtered.filter(v => {
                    if (!v.unidade_destino) return false
                    if (v.unidade_destino === "global") return true
                    if (profileUnitId && v.unidade_destino === profileUnitId) return true
                    if (v.unidade_destino.toLowerCase() === profileUnitName) return true
                    return false
                })
            }

            if (statusFilter !== "all") filtered = filtered.filter(v => v.status === statusFilter)

            if (searchTerm) {
                const s = searchTerm.toLowerCase()
                filtered = filtered.filter(v =>
                    v.titulo.toLowerCase().includes(s) ||
                    (empresasMap[v.empresa_id]?.nome?.toLowerCase() || "").includes(s)
                )
            }

            // Contagem de candidaturas + quem liberou (S-EMP-GES-13)
            const candidaturasCount: Record<string, number> = {}
            let liberadoPor = new Map<string, string>()
            if (filtered.length > 0) {
                const [{ data: cands }, mapa] = await Promise.all([
                    supabase.from("candidaturas").select("vaga_id").in("vaga_id", filtered.map(v => v.id)),
                    buscarLiberadoPor(supabase, filtered),
                ])
                for (const c of cands ?? []) {
                    candidaturasCount[c.vaga_id] = (candidaturasCount[c.vaga_id] || 0) + 1
                }
                liberadoPor = mapa
            }

            return { vagas: filtered, empresasMap, unidadesMap, candidaturasCount, liberadoPor }
        },
    })

    const vagas = useMemo(() => data?.vagas ?? [], [data])
    const diasSemResposta = useDiasSemResposta(vagas.map(v => v.id))
    const empresasMap = useMemo(() => data?.empresasMap ?? {}, [data])
    const unidadesMap = useMemo(() => data?.unidadesMap ?? {}, [data])
    const candidaturasCount = useMemo(() => data?.candidaturasCount ?? {}, [data])
    const liberadoPor = useMemo(() => data?.liberadoPor ?? new Map<string, string>(), [data])

    // ─── Mutations ───────────────────────────────────────────────────────────
    const invalidate = () => qc.invalidateQueries({ queryKey: VAGAS_KEY })

    const handleDeleteVaga = async () => {
        if (!deletingVaga) return
        setDeleteLoading(true)
        try {
            const res = await fetch(`/api/empregabilidade/vagas/${deletingVaga.id}`, { method: "DELETE" })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Erro desconhecido")
            toast.success(`Vaga excluída. ${json.candidaturasRemovidas} candidato(s) removido(s).`)
            invalidate()
        } catch (err: unknown) {
            toast.error((err instanceof Error && err.message) || "Erro ao excluir vaga.")
        } finally {
            setDeleteLoading(false)
            setDeletingVaga(null)
        }
    }

    // SQS-56 (AC16): seleções não aparecem mais nesta lista, então este
    // handler só trata vaga_normal — sem branch de selecao_evento.
    const openEditModal = (vaga: Vaga) => {
        setSelectedVaga(vaga)
        setIsModalOpen(true)
    }
    const openNewModal = () => { setSelectedVaga(null); setIsModalOpen(true) }

    const podeEditar = abaFiltro === "minhas"
    const podeExcluir = abaFiltro === "minhas" && hasPermission("empreg_vagas", "delete")
    const nomeEmpresa = (v: Vaga) => empresasMap[v.empresa_id]?.nome || "Desconhecida"

    // S-EMP-GES-13 (AC15): colunas na ordem pedida pelo Junior. A Unidade de Currículos não aparece aqui
    // (fica no detalhe da vaga e no modal, D6).
    const colunas = useMemo<ColunaGrade<Vaga>[]>(() => {
        const lista: ColunaGrade<Vaga>[] = [
            {
                id: "id", cabecalho: "ID", tamanho: 60, minimo: 56, maximo: 140, alinhar: "centro",
                celula: v => v.numero_vaga
                    ? <span className="font-mono text-xs font-semibold text-muted-foreground">#{v.numero_vaga}</span>
                    : <span className="text-xs text-muted-foreground/50">—</span>,
            },
            {
                id: "cargo", cabecalho: "Cargo", tamanho: 150, minimo: 120, maximo: 600,
                titulo: v => v.titulo,
                celula: v => (
                    <div className="flex flex-col min-w-0">
                        <span className="font-semibold truncate flex items-center gap-2">
                            <span className="truncate">{v.titulo}</span>
                            {v.expansiva && <Badge className="bg-cuca-yellow text-xs px-1.5 flex-shrink-0">Global</Badge>}
                        </span>
                        <span className="text-xs text-muted-foreground truncate">{v.total_vagas} vaga(s) · {v.faixa_etaria}</span>
                    </div>
                ),
            },
            {
                id: "empresa", cabecalho: "Empresa", tamanho: 124, minimo: 100, maximo: 500,
                titulo: v => nomeEmpresa(v),
                celula: v => <span className="block truncate text-sm font-medium">{nomeEmpresa(v)}</span>,
            },
            {
                id: "cadastro", cabecalho: "Dt. Cadastro", tamanho: 96, minimo: 88, maximo: 200,
                celula: v => <span className="text-sm text-muted-foreground tabular-nums">{format(new Date(v.created_at), "dd/MM/yyyy", { locale: ptBR })}</span>,
            },
            {
                id: "tratamento", cabecalho: "Unid. Tratamento", tamanho: 116, minimo: 96, maximo: 360,
                titulo: v => (v.unidade_tratamento ? unidadesMap[v.unidade_tratamento] : "Vaga criada antes da unidade de tratamento"),
                celula: v => <SeloUnidadeTratamento id={v.unidade_tratamento} nomes={unidadesMap} />,
            },
            {
                id: "data_selecao", cabecalho: "Data prevista seleção", tamanho: 104, minimo: 88, maximo: 240,
                celula: v => v.data_selecao_prevista
                    ? <span className="text-sm tabular-nums">{formatarDataISO(v.data_selecao_prevista)}</span>
                    : <span className="text-sm text-muted-foreground/60">—</span>,
            },
            {
                id: "status", cabecalho: "Status", tamanho: 124, minimo: 110, maximo: 320,
                celula: v => (
                    <div className="flex flex-wrap items-center gap-1">
                        {getStatusBadge(v.status)}
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
                id: "candidaturas", cabecalho: "Candidaturas", tamanho: 96, minimo: 90, maximo: 200, alinhar: "centro", interativa: true,
                celula: v => (
                    <Button
                        size="sm"
                        className="h-8 text-xs gap-1 px-2.5 bg-green-600 hover:bg-green-700 text-white border-none"
                        onClick={() => router.push(`/empregabilidade/vagas/${v.id}`)}
                        aria-label={`Ver ${candidaturasCount[v.id] ?? 0} candidatura(s) da vaga ${v.titulo}`}
                    >
                        <Users className="h-3.5 w-3.5" aria-hidden />
                        {candidaturasCount[v.id] ?? 0}
                    </Button>
                ),
            },
            {
                id: "editar", cabecalho: "Editar Status", tamanho: 88, minimo: 88, maximo: 200, alinhar: "centro", interativa: true,
                celula: v => podeEditar ? (
                    <Button variant="outline" size="sm" className="h-8 text-xs gap-1 px-2.5" onClick={() => openEditModal(v)} aria-label={`Editar a vaga ${v.titulo}`}>
                        <Pencil className="h-3.5 w-3.5" aria-hidden /> Editar
                    </Button>
                ) : <span className="text-xs text-muted-foreground/50">—</span>,
            },
        ]
        if (podeExcluir) {
            lista.push({
                id: "excluir", cabecalho: "Excluir", tamanho: 64, minimo: 56, maximo: 160, alinhar: "centro", interativa: true,
                celula: v => (
                    <Button
                        variant="ghost" size="sm"
                        className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10"
                        title="Excluir vaga e candidatos"
                        aria-label={`Excluir a vaga ${v.titulo}`}
                        onClick={() => setDeletingVaga(v)}
                    >
                        <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                ),
            })
        }
        return lista
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [empresasMap, unidadesMap, candidaturasCount, liberadoPor, diasSemResposta, podeEditar, podeExcluir])

    return (
        <>
        <div className="space-y-6 min-w-0">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                    <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
                        <Briefcase className="h-7 w-7 md:h-8 md:w-8 text-cuca-blue shrink-0" aria-hidden />
                        Vagas de Emprego
                    </h1>
                    <p className="text-muted-foreground">Gerencie o portfólio de oportunidades para juventude.</p>
                </div>
                {hasPermission("empreg_vagas", "create") && (
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                        <Button className="bg-cuca-blue text-white hover:bg-sky-800 font-bold h-11 md:h-9 w-full sm:w-auto" onClick={openNewModal}>
                            <Plus className="mr-2 h-4 w-4" aria-hidden /> Cadastrar Vaga
                        </Button>
                    </div>
                )}
            </div>

            <VagaModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onSuccess={invalidate}
                vaga={selectedVaga}
            />

            <div className="flex items-center justify-between gap-4 flex-wrap mt-6">
                <div className="flex items-center gap-1 bg-muted p-1 rounded-lg w-full sm:w-fit">
                    <Button variant={abaFiltro === "minhas" ? "secondary" : "ghost"} size="sm" className="h-11 md:h-8 text-xs px-3 flex-1 sm:flex-none" onClick={() => setAbaFiltro("minhas")}>
                        Minha Unidade
                    </Button>
                    <Button variant={abaFiltro === "todas" ? "secondary" : "ghost"} size="sm" className="h-11 md:h-8 text-xs px-3 gap-1 flex-1 sm:flex-none" onClick={() => setAbaFiltro("todas")}>
                        <Globe className="h-3.5 w-3.5" aria-hidden /> Todas as Unidades
                    </Button>
                </div>
                {abaFiltro === "todas" && (
                    <p className="text-xs text-muted-foreground">Visualização somente-leitura das vagas de outras unidades.</p>
                )}

                <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
                    <div className="relative w-full sm:w-72">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                        <Input
                            placeholder="Buscar vaga ou empresa..."
                            aria-label="Buscar vaga ou empresa"
                            className="pl-10 w-full h-11 md:h-9 text-base md:text-sm"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="flex items-center gap-1 bg-muted p-1 rounded-lg w-full sm:w-auto">
                        {["all", "aberta", "pre_cadastro"].map(s => (
                            <Button key={s} variant={statusFilter === s ? "secondary" : "ghost"} size="sm" onClick={() => setStatusFilter(s)} className="h-11 md:h-8 text-xs px-3 flex-1 sm:flex-none">
                                {s === "all" ? "Todas" : s === "aberta" ? "Abertas" : "Rascunhos"}
                            </Button>
                        ))}
                    </div>
                </div>
            </div>

            {/* A partir de md: grade com colunas ajustáveis (S-EMP-GES-13, AC18). */}
            <div className="hidden md:block">
                <DataGrid
                    dados={vagas}
                    colunas={colunas}
                    idLinha={v => v.id}
                    chaveArmazenamento="cuca:grade:vagas:v1"
                    rotulo="Vagas de emprego"
                    carregando={isLoading}
                    vazio="Nenhuma vaga encontrada."
                />
            </div>

            {/* Abaixo de md (celular): cada vaga vira um cartão, com as mesmas informações da grade (AC20). */}
            <div className="md:hidden space-y-3">
                {isLoading ? (
                    <p className="text-center py-10 text-muted-foreground text-sm">Carregando...</p>
                ) : vagas.length === 0 ? (
                    <p className="text-center py-10 text-muted-foreground text-sm">Nenhuma vaga encontrada.</p>
                ) : vagas.map(v => {
                    const nomeLiberou = liberadoPor.get(v.id)
                    return (
                        <Card key={v.id} className="border shadow-sm">
                            <CardContent className="p-4 space-y-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0">
                                        <div className="flex items-center gap-2 flex-wrap">
                                            {v.numero_vaga && (
                                                <span className="text-xs font-mono font-semibold text-muted-foreground">#{v.numero_vaga}</span>
                                            )}
                                            <span className="font-semibold text-sm break-words">{v.titulo}</span>
                                            {v.expansiva && <Badge className="bg-cuca-yellow text-xs px-1.5 shrink-0">Global</Badge>}
                                        </div>
                                        <p className="text-sm font-medium break-words mt-1">{nomeEmpresa(v)}</p>
                                    </div>
                                    {podeExcluir && (
                                        <Button
                                            variant="ghost" size="sm"
                                            className="h-11 w-11 p-0 -mr-2 -mt-2 text-destructive hover:bg-destructive/10 shrink-0"
                                            title="Excluir vaga e candidatos"
                                            aria-label={`Excluir a vaga ${v.titulo}`}
                                            onClick={() => setDeletingVaga(v)}
                                        >
                                            <Trash2 className="h-4 w-4" aria-hidden />
                                        </Button>
                                    )}
                                </div>

                                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
                                    <div className="min-w-0">
                                        <dt className="text-muted-foreground">Dt. Cadastro</dt>
                                        <dd className="tabular-nums">{format(new Date(v.created_at), "dd/MM/yyyy", { locale: ptBR })}</dd>
                                    </div>
                                    <div className="min-w-0">
                                        <dt className="text-muted-foreground flex items-center gap-1"><CalendarClock className="h-3 w-3" aria-hidden /> Seleção prevista</dt>
                                        <dd className="tabular-nums">{v.data_selecao_prevista ? formatarDataISO(v.data_selecao_prevista) : "—"}</dd>
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
                                    {getStatusBadge(v.status)}
                                    <SeloSemResposta dias={diasSemResposta.get(v.id)} />
                                </div>

                                <div className="flex items-center gap-2 pt-1">
                                    <Button
                                        size="sm"
                                        className="h-11 text-xs gap-1 px-2.5 bg-green-600 hover:bg-green-700 text-white border-none flex-1"
                                        onClick={() => router.push(`/empregabilidade/vagas/${v.id}`)}
                                    >
                                        <Users className="h-3.5 w-3.5" aria-hidden />
                                        {candidaturasCount[v.id] ?? 0} candidatura(s)
                                    </Button>
                                    {podeEditar && (
                                        <Button
                                            variant="outline" size="sm"
                                            className="h-11 text-xs gap-1 px-2.5"
                                            onClick={() => openEditModal(v)}
                                        >
                                            <Pencil className="h-3.5 w-3.5" aria-hidden /> Editar
                                        </Button>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    )
                })}
            </div>
        </div>

        <AlertDialog open={deletingVaga !== null} onOpenChange={(isOpen) => { if (!isOpen) setDeletingVaga(null) }}>
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>Excluir vaga?</AlertDialogTitle>
                    <AlertDialogDescription>
                        Esta ação é <strong>irreversível</strong>. Serão excluídos permanentemente:
                        <ul className="mt-2 ml-4 list-disc text-sm">
                            <li>A vaga <strong>{deletingVaga?.titulo}</strong></li>
                            <li>Todos os candidatos inscritos nessa vaga</li>
                        </ul>
                    </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={deleteLoading}>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                        onClick={handleDeleteVaga}
                        disabled={deleteLoading}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                    >
                        {deleteLoading ? "Excluindo..." : "Sim, excluir"}
                    </AlertDialogAction>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
        </>
    )
}
