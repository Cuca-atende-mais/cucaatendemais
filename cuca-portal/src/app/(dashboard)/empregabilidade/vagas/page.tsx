"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Vaga, Empresa } from "@/lib/types/database"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Search, Plus, Briefcase, FileText, CheckCircle2, AlertCircle, Users, FileSignature, MapPin, Globe, MessageSquare, Loader2 } from "lucide-react"
import { VagaModal } from "@/components/empregabilidade/vaga-modal"
import toast from "react-hot-toast"
import { useUser } from "@/lib/auth/user-provider"

export default function VagasPage() {
    const { hasPermission, profile, isDeveloper } = useUser()
    const router = useRouter()
    const [vagas, setVagas] = useState<Vaga[]>([])
    const [empresasMap, setEmpresasMap] = useState<Record<string, Empresa>>({})
    const [candidaturasCount, setCandidaturasCount] = useState<Record<string, number>>({})
    const [feedbackLoadingId, setFeedbackLoadingId] = useState<string | null>(null)

    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState("")
    const [statusFilter, setStatusFilter] = useState<string>("all")
    const [abaFiltro, setAbaFiltro] = useState<"minhas" | "todas">("minhas")

    const [isModalOpen, setIsModalOpen] = useState(false)
    const [selectedVaga, setSelectedVaga] = useState<Vaga | null>(null)

    const supabase = createClient()

    useEffect(() => {
        fetchData()
    }, [statusFilter, searchTerm, abaFiltro])

    const fetchData = async () => {
        setLoading(true)
        try {
            // Load empresas map if missing
            if (Object.keys(empresasMap).length === 0) {
                const { data: emp } = await supabase.from('empresas').select('*')
                if (emp) {
                    const map: Record<string, Empresa> = {}
                    emp.forEach(e => map[e.id] = e)
                    setEmpresasMap(map)
                }
            }

            // Fetch Vagas
            const { data, error } = await supabase.from("vagas").select("*").order("created_at", { ascending: false })
            if (error) throw error

            let filtered = data || []

            // Filtrar por unidade na aba "Minha Unidade" (exceto developer)
            if (abaFiltro === "minhas" && profile?.unidade_cuca && profile?.unidade_cuca !== 'Geral') {
                filtered = filtered.filter(v => v.unidade_cuca === profile.unidade_cuca)
            }

            if (statusFilter && statusFilter !== "all") {
                filtered = filtered.filter(v => v.status === statusFilter)
            }

            if (searchTerm) {
                const search = searchTerm.toLowerCase()
                filtered = filtered.filter(v =>
                    v.titulo.toLowerCase().includes(search) ||
                    (empresasMap[v.empresa_id]?.nome?.toLowerCase() || "").includes(search)
                )
            }

            setVagas(filtered)

            // Buscar contagem de candidaturas por vaga
            if (filtered.length > 0) {
                const vagaIds = filtered.map(v => v.id)
                const { data: cands } = await supabase
                    .from("candidaturas")
                    .select("vaga_id")
                    .in("vaga_id", vagaIds)
                const countMap: Record<string, number> = {}
                for (const c of cands || []) {
                    countMap[c.vaga_id] = (countMap[c.vaga_id] || 0) + 1
                }
                setCandidaturasCount(countMap)
            }
        } catch (error) {
            console.error("Erro ao buscar vagas:", error)
        } finally {
            setLoading(false)
        }
    }

    const openEditModal = (vaga: Vaga) => {
        setSelectedVaga(vaga)
        setIsModalOpen(true)
    }

    const solicitarFeedback = async (vagaId: string) => {
        setFeedbackLoadingId(vagaId)
        try {
            const res = await fetch(`/api/empregabilidade/vagas/${vagaId}/solicitar-feedback`, { method: "POST" })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Erro ao solicitar feedback")
            toast.success("Solicitação de feedback enviada via WhatsApp!")
        } catch (err: any) {
            toast.error(err.message || "Falha ao solicitar feedback")
        } finally {
            setFeedbackLoadingId(null)
        }
    }

    const openNewModal = () => {
        setSelectedVaga(null)
        setIsModalOpen(true)
    }

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'aberta':
                return <Badge className="bg-green-600 text-white gap-1"><CheckCircle2 className="h-3 w-3" /> Aberta / Pública</Badge>
            case 'pre_cadastro':
                return <Badge variant="outline" className="text-amber-600 border-amber-600 bg-amber-50 gap-1"><FileText className="h-3 w-3" /> Rascunho</Badge>
            case 'preenchida':
                return <Badge variant="secondary" className="gap-1"><Users className="h-3 w-3" /> Preenchida</Badge>
            case 'cancelada':
                return <Badge variant="destructive" className="gap-1"><AlertCircle className="h-3 w-3" /> Cancelada</Badge>
            default:
                return <Badge variant="outline">{status}</Badge>
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                        <Briefcase className="h-8 w-8 text-cuca-blue" />
                        Vagas de Emprego
                    </h1>
                    <p className="text-muted-foreground">Gerencie o portfólio de oportunidades para juventude.</p>
                </div>
                {hasPermission("empreg_vagas", "create") && (
                    <Button className="bg-cuca-blue text-white hover:bg-sky-800 font-bold" onClick={openNewModal}>
                        <Plus className="mr-2 h-4 w-4" /> Cadastrar Vaga
                    </Button>
                )}
            </div>

            <VagaModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onSuccess={fetchData}
                vaga={selectedVaga}
            />

            <div className="flex items-center justify-between gap-4 flex-wrap mt-6">
                {/* S12-09: aba Todas as Unidades (read-only) */}
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

            <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar vaga ou empresa..."
                            className="pl-10 w-72 h-9"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="flex items-center gap-1 bg-muted p-1 rounded-lg">
                        <Button
                            variant={statusFilter === "all" ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => setStatusFilter("all")}
                            className="h-8 text-xs px-3"
                        >
                            Todas
                        </Button>
                        <Button
                            variant={statusFilter === "aberta" ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => setStatusFilter("aberta")}
                            className="h-8 text-xs px-3"
                        >
                            Abertas
                        </Button>
                        <Button
                            variant={statusFilter === "pre_cadastro" ? "secondary" : "ghost"}
                            size="sm"
                            onClick={() => setStatusFilter("pre_cadastro")}
                            className="h-8 text-xs px-3"
                        >
                            Rascunhos
                        </Button>
                    </div>
                </div>
            </div>

            <Card className="border-none shadow-sm overflow-hidden mt-4">
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-muted/30">
                            <TableRow>
                                <TableHead className="w-16 text-center">#</TableHead>
                                <TableHead>Oportunidade</TableHead>
                                <TableHead>Empresa Parceira</TableHead>
                                <TableHead>Unidade Base</TableHead>
                                <TableHead>Detalhes</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-center">Candidatos</TableHead>
                                <TableHead className="text-center">Feedback</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">Carregando...</TableCell></TableRow>
                            ) : vagas.length === 0 ? (
                                <TableRow><TableCell colSpan={8} className="text-center py-10 text-muted-foreground">Nenhuma vaga encontrada.</TableCell></TableRow>
                            ) : vagas.map(v => (
                                <TableRow key={v.id} className={abaFiltro === "todas" ? "hover:bg-muted/30" : "cursor-pointer hover:bg-muted/30"} onClick={() => abaFiltro === "minhas" && openEditModal(v)}>
                                    <TableCell className="text-center">
                                        {v.numero_vaga ? (
                                            <span className="text-xs font-mono font-semibold text-muted-foreground">#{v.numero_vaga}</span>
                                        ) : (
                                            <span className="text-xs text-muted-foreground/40">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <span className="font-semibold flex items-center gap-2">
                                                {v.titulo}
                                                {v.expansiva && <Badge className="bg-cuca-yellow text-[10px] h-4 px-1">Global</Badge>}
                                            </span>
                                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                                                <Users className="h-3 w-3" /> {v.total_vagas} vaga(s) | {v.faixa_etaria}
                                            </span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <span className="font-medium text-sm">{empresasMap[v.empresa_id]?.nome || 'Desconhecida'}</span>
                                            <span className="text-xs text-muted-foreground">{empresasMap[v.empresa_id]?.setor || 'Sem setor'}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>
                                        <Badge variant="outline" className="bg-muted/50">{v.unidade_cuca || 'Não definida'}</Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col space-y-1 text-xs text-muted-foreground">
                                            <span className="flex items-center gap-1"><FileSignature className="h-3 w-3" /> {v.tipo_contrato?.toUpperCase() || 'N/A'}</span>
                                            <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> Entrevista {v.local_entrevista?.replace('_', ' ')}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>{getStatusBadge(v.status)}</TableCell>
                                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-7 text-xs gap-1 px-2"
                                            onClick={() => router.push(`/empregabilidade/vagas/${v.id}`)}
                                        >
                                            <Users className="h-3 w-3" />
                                            {candidaturasCount[v.id] ?? 0}
                                        </Button>
                                    </TableCell>
                                    <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                                        <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-7 text-xs gap-1 px-2 border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10"
                                            onClick={() => solicitarFeedback(v.id)}
                                            disabled={feedbackLoadingId === v.id}
                                            title="Solicitar feedback da empresa sobre os candidatos"
                                        >
                                            {feedbackLoadingId === v.id
                                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                                : <MessageSquare className="h-3 w-3" />}
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}
