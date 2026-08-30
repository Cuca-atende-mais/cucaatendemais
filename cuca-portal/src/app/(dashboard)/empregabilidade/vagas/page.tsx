"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase/client"
import { Vaga, Empresa } from "@/lib/types/database"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
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
import { Search, Plus, Briefcase, FileText, CheckCircle2, AlertCircle, Users, Globe, Trash2, Pencil } from "lucide-react"
import { VagaModal } from "@/components/empregabilidade/vaga-modal"
import toast from "react-hot-toast"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { useUser } from "@/lib/auth/user-provider"
import { VAGAS_KEY } from "@/hooks/queries/use-vagas"

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

            // Unidades
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
            let filtered = (data ?? []).filter(v => v.tipo !== "selecao_evento")

            // Filtro de unidade (aba "Minha Unidade")
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

            // Contagem de candidaturas
            const candidaturasCount: Record<string, number> = {}
            if (filtered.length > 0) {
                const { data: cands } = await supabase
                    .from("candidaturas")
                    .select("vaga_id")
                    .in("vaga_id", filtered.map(v => v.id))
                for (const c of cands ?? []) {
                    candidaturasCount[c.vaga_id] = (candidaturasCount[c.vaga_id] || 0) + 1
                }
            }

            return { vagas: filtered, empresasMap, unidadesMap, candidaturasCount }
        },
    })

    const vagas = data?.vagas ?? []
    const empresasMap = data?.empresasMap ?? {}
    const unidadesMap = data?.unidadesMap ?? {}
    const candidaturasCount = data?.candidaturasCount ?? {}

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
        } catch (err: any) {
            toast.error(err.message || "Erro ao excluir vaga.")
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

    const getStatusBadge = (status: string) => {
        switch (status) {
            case "aberta": return <Badge className="bg-green-600 text-white gap-1"><CheckCircle2 className="h-3 w-3" /> Aberta / Pública</Badge>
            case "pre_cadastro": return <Badge variant="outline" className="text-amber-600 border-amber-600 bg-amber-50 gap-1"><FileText className="h-3 w-3" /> Rascunho</Badge>
            case "preenchida": return <Badge variant="secondary" className="gap-1"><Users className="h-3 w-3" /> Preenchida</Badge>
            case "cancelada": return <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" /> Cancelada</Badge>
            default: return <Badge variant="outline">{status}</Badge>
        }
    }

    return (
        <>
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <Briefcase className="h-8 w-8 text-cuca-blue" />
                        Vagas de Emprego
                    </h1>
                    <p className="text-muted-foreground">Gerencie o portfólio de oportunidades para juventude.</p>
                </div>
                {hasPermission("empreg_vagas", "create") && (
                    <div className="flex items-center gap-2">
                        <Button className="bg-cuca-blue text-white hover:bg-sky-800 font-bold" onClick={openNewModal}>
                            <Plus className="mr-2 h-4 w-4" /> Cadastrar Vaga
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
                <div className="flex items-center gap-1 bg-muted p-1 rounded-lg w-fit">
                    <Button variant={abaFiltro === "minhas" ? "secondary" : "ghost"} size="sm" className="h-8 text-xs px-3" onClick={() => setAbaFiltro("minhas")}>
                        Minha Unidade
                    </Button>
                    <Button variant={abaFiltro === "todas" ? "secondary" : "ghost"} size="sm" className="h-8 text-xs px-3 gap-1" onClick={() => setAbaFiltro("todas")}>
                        <Globe className="h-3.5 w-3.5" /> Todas as Unidades
                    </Button>
                </div>
                {abaFiltro === "todas" && (
                    <p className="text-xs text-muted-foreground">Visualização somente-leitura das vagas de outras unidades.</p>
                )}

                <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
                    <div className="relative w-full sm:w-72">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar vaga ou empresa..."
                            className="pl-10 w-full h-9"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="flex items-center gap-1 bg-muted p-1 rounded-lg">
                        {["all", "aberta", "pre_cadastro"].map(s => (
                            <Button key={s} variant={statusFilter === s ? "secondary" : "ghost"} size="sm" onClick={() => setStatusFilter(s)} className="h-8 text-xs px-3">
                                {s === "all" ? "Todas" : s === "aberta" ? "Abertas" : "Rascunhos"}
                            </Button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Desktop/tablet: tabela (md+). table-fixed + larguras em % (padrão da página de
                Seleções): sem isso, nome de empresa/cargo longo empurra a tabela pra fora da
                tela em vez de truncar dentro da coluna. Abaixo de md, 9 colunas não cabem de
                jeito nenhum (nem truncadas) — vira a lista de cards logo abaixo. */}
            <Card className="hidden md:block border-none shadow-sm overflow-hidden mt-4">
                <CardContent className="p-0">
                    <Table className="table-fixed w-full">
                        <TableHeader className="bg-muted/30">
                            <TableRow>
                                <TableHead className="w-[6%] text-center">#</TableHead>
                                <TableHead className="w-[22%]">Cargo</TableHead>
                                <TableHead className="w-[16%]">Empresa Parceira</TableHead>
                                <TableHead className="w-[10%]">Data do Cadastro</TableHead>
                                <TableHead className="w-[14%]">Unidade Base</TableHead>
                                <TableHead className="w-[12%]">Status</TableHead>
                                <TableHead className="w-[10%] text-center">Candidaturas</TableHead>
                                <TableHead className="w-[10%] text-center">Editar Status</TableHead>
                                <TableHead className="w-10"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {isLoading ? (
                                <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">Carregando...</TableCell></TableRow>
                            ) : vagas.length === 0 ? (
                                <TableRow><TableCell colSpan={9} className="text-center py-10 text-muted-foreground">Nenhuma vaga encontrada.</TableCell></TableRow>
                            ) : vagas.map(v => (
                                <TableRow key={v.id} className="hover:bg-muted/30">
                                    <TableCell className="text-center">
                                        {v.numero_vaga
                                            ? <span className="text-xs font-mono font-semibold text-muted-foreground">#{v.numero_vaga}</span>
                                            : <span className="text-xs text-muted-foreground/40">—</span>}
                                    </TableCell>
                                    <TableCell className="max-w-0">
                                        <div className="flex flex-col min-w-0">
                                            <span className="font-semibold truncate flex items-center gap-2">
                                                <span className="truncate">{v.titulo}</span>
                                                {v.expansiva && <Badge className="bg-cuca-yellow text-[10px] h-4 px-1 flex-shrink-0">Global</Badge>}
                                            </span>
                                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                                                <Users className="h-3 w-3 flex-shrink-0" /> {v.total_vagas} vaga(s) | {v.faixa_etaria}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell className="max-w-0">
                                        <span className="font-medium text-sm truncate block">{empresasMap[v.empresa_id]?.nome || "Desconhecida"}</span>
                                    </TableCell>
                                    <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                                        {format(new Date(v.created_at), "dd/MM/yyyy", { locale: ptBR })}
                                    </TableCell>
                                    <TableCell className="max-w-0">
                                        {v.unidade_destino === "global" ? (
                                            <Badge className="bg-cuca-blue/10 text-cuca-blue border-cuca-blue/30 gap-1"><Globe className="h-3 w-3 flex-shrink-0" /> <span className="truncate">Toda a Rede</span></Badge>
                                        ) : v.unidade_destino && unidadesMap[v.unidade_destino] ? (
                                            <Badge variant="outline" className="bg-muted/50 max-w-full"><span className="truncate">{unidadesMap[v.unidade_destino]}</span></Badge>
                                        ) : (
                                            <Badge variant="outline" className="text-amber-600 border-amber-500/40 bg-amber-50/50">Não definida</Badge>
                                        )}
                                    </TableCell>
                                    <TableCell>{getStatusBadge(v.status)}</TableCell>
                                    <TableCell className="text-center">
                                        <Button
                                            size="sm"
                                            className="h-7 text-xs gap-1 px-2 bg-green-600 hover:bg-green-700 text-white border-none"
                                            onClick={() => router.push(`/empregabilidade/vagas/${v.id}`)}
                                        >
                                            <Users className="h-3 w-3" />
                                            {candidaturasCount[v.id] ?? 0}
                                        </Button>
                                    </TableCell>
                                    <TableCell className="text-center">
                                        {abaFiltro === "minhas" ? (
                                            <Button
                                                variant="outline" size="sm"
                                                className="h-7 text-xs gap-1 px-2"
                                                onClick={() => openEditModal(v)}
                                            >
                                                <Pencil className="h-3 w-3" /> Editar
                                            </Button>
                                        ) : (
                                            <span className="text-xs text-muted-foreground/40">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-center">
                                        {abaFiltro === "minhas" && hasPermission("empreg_vagas", "delete") && (
                                            <Button
                                                variant="ghost" size="sm"
                                                className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10"
                                                title="Excluir vaga e candidatos"
                                                onClick={() => setDeletingVaga(v)}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Mobile (< md): cada vaga vira um card, sem colunas disputando espaço horizontal. */}
            <div className="md:hidden space-y-3 mt-4">
                {isLoading ? (
                    <p className="text-center py-10 text-muted-foreground text-sm">Carregando...</p>
                ) : vagas.length === 0 ? (
                    <p className="text-center py-10 text-muted-foreground text-sm">Nenhuma vaga encontrada.</p>
                ) : vagas.map(v => (
                    <Card key={v.id} className="border shadow-sm">
                        <CardContent className="p-4 space-y-3">
                            <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        {v.numero_vaga && (
                                            <span className="text-xs font-mono font-semibold text-muted-foreground">#{v.numero_vaga}</span>
                                        )}
                                        <span className="font-semibold text-sm break-words">{v.titulo}</span>
                                        {v.expansiva && <Badge className="bg-cuca-yellow text-[10px] h-4 px-1 shrink-0">Global</Badge>}
                                    </div>
                                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                                        <Users className="h-3 w-3 shrink-0" /> {v.total_vagas} vaga(s) | {v.faixa_etaria}
                                    </p>
                                </div>
                                {abaFiltro === "minhas" && hasPermission("empreg_vagas", "delete") && (
                                    <Button
                                        variant="ghost" size="sm"
                                        className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10 shrink-0"
                                        title="Excluir vaga e candidatos"
                                        onClick={() => setDeletingVaga(v)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                )}
                            </div>

                            <p className="text-sm font-medium truncate">
                                {empresasMap[v.empresa_id]?.nome || "Desconhecida"}
                            </p>

                            <div className="flex items-center gap-2 flex-wrap text-xs">
                                <span className="text-muted-foreground whitespace-nowrap">
                                    {format(new Date(v.created_at), "dd/MM/yyyy", { locale: ptBR })}
                                </span>
                                {v.unidade_destino === "global" ? (
                                    <Badge className="bg-cuca-blue/10 text-cuca-blue border-cuca-blue/30 gap-1"><Globe className="h-3 w-3 shrink-0" /> Toda a Rede</Badge>
                                ) : v.unidade_destino && unidadesMap[v.unidade_destino] ? (
                                    <Badge variant="outline" className="bg-muted/50">{unidadesMap[v.unidade_destino]}</Badge>
                                ) : (
                                    <Badge variant="outline" className="text-amber-600 border-amber-500/40 bg-amber-50/50">Não definida</Badge>
                                )}
                                {getStatusBadge(v.status)}
                            </div>

                            <div className="flex items-center gap-2 pt-1">
                                <Button
                                    size="sm"
                                    className="h-8 text-xs gap-1 px-2.5 bg-green-600 hover:bg-green-700 text-white border-none flex-1"
                                    onClick={() => router.push(`/empregabilidade/vagas/${v.id}`)}
                                >
                                    <Users className="h-3.5 w-3.5" />
                                    {candidaturasCount[v.id] ?? 0} candidatura(s)
                                </Button>
                                {abaFiltro === "minhas" && (
                                    <Button
                                        variant="outline" size="sm"
                                        className="h-8 text-xs gap-1 px-2.5"
                                        onClick={() => openEditModal(v)}
                                    >
                                        <Pencil className="h-3.5 w-3.5" /> Editar
                                    </Button>
                                )}
                            </div>
                        </CardContent>
                    </Card>
                ))}
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
