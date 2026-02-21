"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Campanha } from "@/lib/types/database"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { Search, Plus, Megaphone, Clock, CheckCircle2, PlayCircle, AlertCircle, XCircle, PauseCircle } from "lucide-react"
import { unidadesCuca } from "@/lib/constants"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { CampanhaModal } from "@/components/campanhas/campanha-modal"

export default function CampanhasPage() {
    const [campanhas, setCampanhas] = useState<Campanha[]>([])
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState("")
    const [unidadeFilter, setUnidadeFilter] = useState<string>("all")
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [unidadesMap, setUnidadesMap] = useState<Record<string, string>>({})

    const supabase = createClient()

    useEffect(() => {
        fetchData()
    }, [unidadeFilter, searchTerm])

    const fetchData = async () => {
        setLoading(true)
        try {
            // Buscar mapa de unidades (id -> nome)
            if (Object.keys(unidadesMap).length === 0) {
                const { data: ud } = await supabase.from('unidades_cuca').select('id, nome')
                if (ud) {
                    const map: Record<string, string> = {}
                    ud.forEach(u => map[u.id] = u.nome)
                    setUnidadesMap(map)
                }
            }

            const { data, error } = await supabase.from("campanhas").select("*").order("created_at", { ascending: false })
            if (error) throw error

            let filtered = data || []

            if (unidadeFilter && unidadeFilter !== "all") {
                // Precisamos achar o id da unidade selecionada primeiro (usando o inverso do mapa)
                const udId = Object.keys(unidadesMap).find(key => unidadesMap[key] === unidadeFilter)
                if (udId) {
                    filtered = filtered.filter(c => c.unidade_cuca_id === udId)
                }
            }

            if (searchTerm) {
                const search = searchTerm.toLowerCase()
                filtered = filtered.filter(c => c.titulo.toLowerCase().includes(search) || c.template_texto.toLowerCase().includes(search))
            }

            setCampanhas(filtered)
        } catch (error) {
            console.error("Erro ao buscar campanhas:", error)
        } finally {
            setLoading(false)
        }
    }

    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'aprovada':
                return <Badge className="bg-cuca-blue text-white gap-1"><PlayCircle className="h-3 w-3" /> Fila (Aprovada)</Badge>
            case 'aguardando_aprovacao':
                return <Badge variant="outline" className="text-amber-600 border-amber-600 bg-amber-50 gap-1"><Clock className="h-3 w-3" /> Pendente</Badge>
            case 'em_andamento':
                return <Badge className="bg-cuca-yellow text-cuca-dark gap-1"><PlayCircle className="h-3 w-3" /> Disparando</Badge>
            case 'concluida':
                return <Badge className="bg-green-600 text-white gap-1"><CheckCircle2 className="h-3 w-3" /> Concluída</Badge>
            case 'rascunho':
                return <Badge variant="secondary" className="gap-1">Rascunho</Badge>
            case 'pausada':
                return <Badge variant="outline" className="gap-1 border-muted bg-muted"><PauseCircle className="h-3 w-3" /> Pausada</Badge>
            case 'cancelada':
                return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Cancelada</Badge>
            default:
                return <Badge variant="outline">{status}</Badge>
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight text-cuca-dark">Campanhas</h1>
                    <p className="text-muted-foreground">Disparo em massa de mensagens via WhatsApp</p>
                </div>
                <Button
                    className="bg-cuca-blue text-white hover:bg-sky-800 font-bold"
                    onClick={() => setIsModalOpen(true)}
                >
                    <Plus className="mr-2 h-4 w-4" /> Nova Campanha
                </Button>
            </div>

            <CampanhaModal
                open={isModalOpen}
                onOpenChange={setIsModalOpen}
                onSuccess={fetchData}
            />

            <div className="flex items-center justify-between gap-4 flex-wrap mt-6">
                <div className="flex items-center gap-2 flex-wrap">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar campanha..."
                            className="pl-10 w-64 h-9 bg-white"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="flex items-center gap-1 bg-muted p-1 rounded-lg">
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
                </div>
            </div>

            <Card className="border-none shadow-sm overflow-hidden mt-4">
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-muted/30">
                            <TableRow>
                                <TableHead>Título e Detalhes</TableHead>
                                <TableHead>Unidade</TableHead>
                                <TableHead>Público / Eixo</TableHead>
                                <TableHead>Agendamento</TableHead>
                                <TableHead>Status</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">Carregando...</TableCell></TableRow>
                            ) : campanhas.length === 0 ? (
                                <TableRow><TableCell colSpan={5} className="text-center py-10 text-muted-foreground">Nenhuma campanha encontrada.</TableCell></TableRow>
                            ) : campanhas.map(c => {
                                const eixosSelecionados = c.publico_alvo?.eixos || []
                                return (
                                    <TableRow key={c.id}>
                                        <TableCell>
                                            <div className="flex flex-col">
                                                <span className="font-semibold text-cuca-dark">{c.titulo}</span>
                                                <span className="text-xs text-muted-foreground truncate max-w-[250px]">{c.template_texto.length > 50 ? c.template_texto.substring(0, 50) + '...' : c.template_texto}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell><Badge variant="outline">{unidadesMap[c.unidade_cuca_id] || 'Desconhecida'}</Badge></TableCell>
                                        <TableCell>
                                            <div className="flex flex-wrap gap-1">
                                                {eixosSelecionados.length === 0 ? (
                                                    <Badge className="bg-muted text-muted-foreground border-none">Global (Unidade)</Badge>
                                                ) : (
                                                    eixosSelecionados.map((eixo: string) => (
                                                        <Badge key={eixo} variant="secondary">{eixo}</Badge>
                                                    ))
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {c.agendamento ? format(new Date(c.agendamento), "dd/MM/yyyy HH:mm", { locale: ptBR }) : <span className="text-muted-foreground text-xs italic">Imediato (ao aprovar)</span>}
                                        </TableCell>
                                        <TableCell>{getStatusBadge(c.status)}</TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}
