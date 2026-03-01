"use client"

import { useState, useEffect, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { EventoPontual, CampanhaMensal } from "@/lib/types/database"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    Tabs, TabsContent, TabsList, TabsTrigger,
} from "@/components/ui/tabs"
import {
    Search, Plus, Calendar, Filter, MoreHorizontal, CheckCircle2, Clock, AlertCircle, FileSpreadsheet, Upload
} from "lucide-react"
import { unidadesCuca } from "@/lib/constants"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import toast from "react-hot-toast"
import { UnifiedProgramModal } from "@/components/programacao/unified-program-modal"
import { ImportPlanilhaModal } from "@/components/programacao/import-planilha-modal"
import * as XLSX from 'xlsx'
import { useRouter } from "next/navigation"

export default function ProgramacaoPage() {
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [pontuais, setPontuais] = useState<EventoPontual[]>([])
    const [mensais, setMensais] = useState<CampanhaMensal[]>([])
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState("")
    const [unidadeFilter, setUnidadeFilter] = useState<string>("all")
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [isImportModalOpen, setIsImportModalOpen] = useState(false)

    const supabase = createClient()
    const router = useRouter()

    useEffect(() => {
        fetchData()
    }, [unidadeFilter, searchTerm]) // Added searchTerm to dependencies for live filtering

    const fetchData = async () => {
        setLoading(true)
        try {
            const { data: pData, error: pError } = await supabase.from("eventos_pontuais").select("*").order("created_at", { ascending: false })
            const { data: mData, error: mError } = await supabase.from("campanhas_mensais").select("*").order("created_at", { ascending: false })

            if (pError) console.error("Erro eventos pontuais:", pError)
            if (mError) console.error("Erro campanhas mensais:", mError)

            let filteredP = pData || []
            let filteredM = mData || []

            if (unidadeFilter && unidadeFilter !== "all") {
                filteredP = filteredP.filter(p => p.unidade_cuca === unidadeFilter)
                filteredM = filteredM.filter(m => m.unidade_cuca === unidadeFilter)
            }

            if (searchTerm) {
                const search = searchTerm.toLowerCase()
                filteredP = filteredP.filter(p => p.titulo.toLowerCase().includes(search) || p.descricao?.toLowerCase().includes(search))
                filteredM = filteredM.filter(m => m.titulo.toLowerCase().includes(search) || m.descricao?.toLowerCase().includes(search))
            }

            setPontuais(filteredP)
            setMensais(filteredM)
        } finally {
            setLoading(false)
        }
    }

    const openCampanhaDetails = (campanha: CampanhaMensal) => {
        router.push(`/programacao/mensal/${campanha.id}`)
    }



    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'aprovado':
                return <Badge className="bg-green-600 text-white gap-1"><CheckCircle2 className="h-3 w-3" /> Aprovado</Badge>
            case 'aguardando_aprovacao':
                return <Badge variant="outline" className="text-amber-600 border-amber-600 bg-amber-50 gap-1"><Clock className="h-3 w-3" /> Pendente</Badge>
            case 'rascunho':
                return <Badge variant="secondary" className="gap-1"><Plus className="h-3 w-3" /> Rascunho</Badge>
            default:
                return <Badge variant="outline">{status}</Badge>
        }
    }

    const filteredPontuais = pontuais

    const filteredMensais = mensais

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-cuca-dark">Programas & Eventos</h1>
                    <p className="text-muted-foreground">Gestão unificada da programação da Rede CUCA</p>
                </div>
                <Button
                    className="bg-cuca-yellow text-cuca-dark hover:bg-yellow-500 font-bold"
                    onClick={() => setIsModalOpen(true)}
                >
                    <Plus className="mr-2 h-4 w-4" /> Novo Item
                </Button>
            </div>

            <UnifiedProgramModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onSuccess={fetchData}
            />

            <Tabs defaultValue="pontual" className="w-full">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                    <TabsList className="bg-muted/50 p-1">
                        <TabsTrigger value="pontual" className="gap-2">
                            <Clock className="h-4 w-4" /> Pontual
                        </TabsTrigger>
                        <TabsTrigger value="mensal" className="gap-2">
                            <Calendar className="h-4 w-4" /> Mensal
                        </TabsTrigger>
                    </TabsList>

                    <div className="flex items-center gap-2">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar..."
                                className="pl-10 w-64 h-9 bg-white"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <div className="flex items-center gap-3">
                            <div className="flex bg-muted p-1 rounded-lg">
                                <Button
                                    variant={unidadeFilter === "all" ? "secondary" : "ghost"}
                                    size="sm"
                                    onClick={() => setUnidadeFilter("all")}
                                    className="h-8 text-xs px-3"
                                >
                                    Todas
                                </Button>
                                {unidadesCuca.map((u) => (
                                    <Button
                                        key={u}
                                        variant={unidadeFilter === u ? "secondary" : "ghost"}
                                        size="sm"
                                        onClick={() => setUnidadeFilter(u)}
                                        className="h-8 text-xs px-3"
                                    >
                                        {u}
                                    </Button>
                                ))}
                            </div>

                            <Button
                                variant="outline"
                                className="border-cuca-blue text-cuca-blue hover:bg-cuca-blue/10 gap-2"
                                onClick={() => {
                                    if (unidadeFilter === "all") {
                                        toast.error("Por favor, selecione uma unidade específica primeiro para a importação.")
                                        return
                                    }
                                    setIsImportModalOpen(true)
                                }}
                            >
                                <Upload className="mr-1 h-4 w-4" />
                                Atualizar Programação
                            </Button>

                            <Button
                                className="bg-cuca-yellow text-cuca-dark hover:bg-yellow-500 font-bold"
                                onClick={() => setIsModalOpen(true)}
                            >
                                <Plus className="mr-2 h-4 w-4" /> Novo Item
                            </Button>
                        </div>
                    </div>
                </div>

                <TabsContent value="pontual" className="mt-6">
                    <Card className="border-none shadow-sm overflow-hidden">
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader className="bg-muted/30">
                                    <TableRow>
                                        <TableHead>Título</TableHead>
                                        <TableHead>Unidade</TableHead>
                                        <TableHead>Período</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right">Ações</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">Carregando...</TableCell></TableRow>
                                    ) : filteredPontuais.length === 0 ? (
                                        <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">Nenhum evento pontual encontrado.</TableCell></TableRow>
                                    ) : filteredPontuais.map(p => (
                                        <TableRow key={p.id}>
                                            <TableCell className="font-semibold text-cuca-dark">{p.titulo}</TableCell>
                                            <TableCell><Badge variant="outline">{p.unidade_cuca}</Badge></TableCell>
                                            <TableCell>
                                                {format(new Date(p.data_inicio), "dd/MM/yyyy", { locale: ptBR })}
                                                {p.data_fim && ` — ${format(new Date(p.data_fim), "dd/MM/yyyy", { locale: ptBR })}`}
                                            </TableCell>
                                            <TableCell>{getStatusBadge(p.status)}</TableCell>
                                            <TableCell className="text-right">
                                                <Button variant="ghost" size="sm"><MoreHorizontal className="h-4 w-4" /></Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="mensal" className="mt-6">
                    <Card className="border-none shadow-sm overflow-hidden">
                        <CardContent className="p-0">
                            <Table>
                                <TableHeader className="bg-muted/30">
                                    <TableRow>
                                        <TableHead>Título / Mês Ref.</TableHead>
                                        <TableHead>Total Atividades</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead>Importado em</TableHead>
                                        <TableHead className="text-right">Ações</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {loading ? (
                                        <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">Carregando...</TableCell></TableRow>
                                    ) : filteredMensais.length === 0 ? (
                                        <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">Nenhuma programação mensal encontrada.</TableCell></TableRow>
                                    ) : filteredMensais.map(m => (
                                        <TableRow key={m.id}>
                                            <TableCell className="font-semibold text-cuca-dark">
                                                {m.titulo} ({m.mes}/{m.ano})
                                            </TableCell>
                                            <TableCell>{m.total_atividades} atividades</TableCell>
                                            <TableCell>{getStatusBadge(m.status)}</TableCell>
                                            <TableCell>{format(new Date(m.created_at), "dd/MM/yyyy", { locale: ptBR })}</TableCell>
                                            <TableCell className="text-right">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => openCampanhaDetails(m)}
                                                    className="text-cuca-blue hover:text-blue-700 hover:bg-blue-50"
                                                >
                                                    Ver Atividades
                                                </Button>
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {isImportModalOpen && (
                <ImportPlanilhaModal
                    open={isImportModalOpen}
                    onOpenChange={setIsImportModalOpen}
                    unidadeCuca={unidadeFilter !== "all" ? unidadeFilter : ""}
                    onSuccess={fetchData}
                />
            )}
        </div>
    )
}
