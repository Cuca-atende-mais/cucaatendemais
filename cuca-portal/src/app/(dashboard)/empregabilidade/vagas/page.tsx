"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Vaga, Empresa } from "@/lib/types/database"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Search, Plus, Briefcase, FileText, CheckCircle2, AlertCircle, Users, FileSignature, MapPin } from "lucide-react"
import { VagaModal } from "@/components/empregabilidade/vaga-modal"
import { useUser } from "@/lib/auth/user-provider"

export default function VagasPage() {
    const { hasPermission } = useUser()
    const [vagas, setVagas] = useState<Vaga[]>([])
    const [empresasMap, setEmpresasMap] = useState<Record<string, Empresa>>({})
    const [unidadesMap, setUnidadesMap] = useState<Record<string, string>>({})

    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState("")
    const [statusFilter, setStatusFilter] = useState<string>("all")

    const [isModalOpen, setIsModalOpen] = useState(false)
    const [selectedVaga, setSelectedVaga] = useState<Vaga | null>(null)

    const supabase = createClient()

    useEffect(() => {
        fetchData()
    }, [statusFilter, searchTerm])

    const fetchData = async () => {
        setLoading(true)
        try {
            // Load maps if missing
            if (Object.keys(empresasMap).length === 0) {
                const { data: emp } = await supabase.from('empresas').select('*')
                if (emp) {
                    const map: Record<string, Empresa> = {}
                    emp.forEach(e => map[e.id] = e)
                    setEmpresasMap(map)
                }
            }

            if (Object.keys(unidadesMap).length === 0) {
                const { data: ud } = await supabase.from('unidades_cuca').select('id, nome')
                if (ud) {
                    const map: Record<string, string> = {}
                    ud.forEach(u => map[u.id] = u.nome)
                    setUnidadesMap(map)
                }
            }

            // Fetch Vagas
            const { data, error } = await supabase.from("vagas").select("*").order("created_at", { ascending: false })
            if (error) throw error

            let filtered = data || []

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
                    <h1 className="text-3xl font-bold tracking-tight text-cuca-dark flex items-center gap-2">
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
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar vaga ou empresa..."
                            className="pl-10 w-72 h-9 bg-white"
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
                                <TableHead>Oportunidade</TableHead>
                                <TableHead>Empresa Parceira</TableHead>
                                <TableHead>Unidade Base</TableHead>
                                <TableHead>Detalhes</TableHead>
                                <TableHead>Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">Carregando...</TableCell></TableRow>
                            ) : vagas.length === 0 ? (
                                <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">Nenhuma vaga encontrada.</TableCell></TableRow>
                            ) : vagas.map(v => (
                                <TableRow key={v.id} className="cursor-pointer hover:bg-muted/30" onClick={() => openEditModal(v)}>
                                    <TableCell>
                                        <div className="flex flex-col">
                                            <span className="font-semibold text-cuca-dark flex items-center gap-2">
                                                {v.titulo}
                                                {v.expansiva && <Badge className="bg-cuca-yellow text-cuca-dark text-[10px] h-4 px-1">Global</Badge>}
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
                                        <Badge variant="outline" className="bg-muted/50">{unidadesMap[v.unidade_cuca || ""] || 'Desconhecida'}</Badge>
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-col space-y-1 text-xs text-muted-foreground">
                                            <span className="flex items-center gap-1"><FileSignature className="h-3 w-3" /> {v.tipo_contrato?.toUpperCase() || 'N/A'}</span>
                                            <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> Entrevista {v.local_entrevista?.replace('_', ' ')}</span>
                                        </div>
                                    </TableCell>
                                    <TableCell>{getStatusBadge(v.status)}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}
