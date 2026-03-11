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
    Search, Plus, Calendar, CheckCircle2, Clock, Upload, Trash2, Send, Users, Eye, Pencil, MapPin, X
} from "lucide-react"
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
    Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { unidadesCuca } from "@/lib/constants"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import toast from "react-hot-toast"
import { UnifiedProgramModal } from "@/components/programacao/unified-program-modal"
import { ImportPlanilhaModal } from "@/components/programacao/import-planilha-modal"
import * as XLSX from 'xlsx'
import { useRouter } from "next/navigation"
import { useUser } from "@/lib/auth/user-provider"

export default function ProgramacaoPage() {
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [pontuais, setPontuais] = useState<EventoPontual[]>([])
    const [mensais, setMensais] = useState<CampanhaMensal[]>([])
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState("")
    const [unidadeFilter, setUnidadeFilter] = useState<string>("all")
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [isImportModalOpen, setIsImportModalOpen] = useState(false)

    // S17-01: Prévia de disparo pontual
    const [previewEvento, setPreviewEvento] = useState<EventoPontual | null>(null)
    const [previewLeadCount, setPreviewLeadCount] = useState<number | null>(null)
    const [previewTemplate, setPreviewTemplate] = useState("")
    const [disparando, setDisparando] = useState(false)

    // S25: Visualizar + Editar evento pontual
    const [visualizarEvento, setVisualizarEvento] = useState<EventoPontual | null>(null)
    const [editEvento, setEditEvento] = useState<EventoPontual | null>(null)

    const supabase = createClient()
    const router = useRouter()

    const { profile, isDeveloper, hasPermission } = useUser()

    const canSeeAllUnits = isDeveloper || profile?.funcao?.nome === 'Super Admin Cuca'

    const DEVELOPER_EMAILS = ['valmir@cucateste.com', 'dev.cucaatendemais@gmail.com']
    const canDelete = profile?.email && DEVELOPER_EMAILS.includes(profile.email)

    const handleDelete = async (id: string, tipo: 'mensal' | 'pontual') => {
        if (!confirm("Tem certeza que deseja excluir esta programação permanentemente? Isso apagará todas as atividades vinculadas e NÃO PODE SER DESFEITO.")) return

        try {
            const res = await fetch(`/api/programacao/excluir?id=${id}&tipo=${tipo}`, { method: 'DELETE' })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Erro ao excluir")

            toast.success(data.message)
            fetchData()
        } catch (error: any) {
            console.error(error)
            toast.error(error.message)
        }
    }

    // Iniciar filtro com a unidade do perfil caso não seja super/master
    useEffect(() => {
        if (profile && !canSeeAllUnits) {
            setUnidadeFilter(profile.unidade_cuca || "all")
        }
    }, [profile, canSeeAllUnits])

    // S27-07: cleanup para cancelar fetchData em andamento ao sair da página
    useEffect(() => {
        let cancelled = false
        const run = async () => {
            await fetchData(cancelled)
        }
        if (profile) run()
        return () => { cancelled = true }
    }, [unidadeFilter, searchTerm, profile])

    const fetchData = async (cancelled = false) => {
        setLoading(true)
        try {
            // S14-02: Filtros aplicados diretamente na query (server-side)
            let pQuery = supabase.from("eventos_pontuais").select("*").order("created_at", { ascending: false })
            let mQuery = supabase.from("campanhas_mensais").select("*").order("created_at", { ascending: false })

            if (unidadeFilter && unidadeFilter !== "all") {
                // S27-01: incluir também eventos expansivos (toda a rede) na visão do gerente
                pQuery = pQuery.or(`unidade_cuca.eq.${unidadeFilter},expansiva.eq.true`)
                mQuery = mQuery.eq("unidade_cuca", unidadeFilter)
            }

            if (searchTerm) {
                pQuery = pQuery.ilike("titulo", `%${searchTerm}%`)
                mQuery = mQuery.ilike("titulo", `%${searchTerm}%`)
            }

            const [{ data: pData, error: pError }, { data: mData, error: mError }] = await Promise.all([pQuery, mQuery])

            if (cancelled) return
            if (pError) console.error("Erro eventos pontuais:", pError)
            if (mError) console.error("Erro campanhas mensais:", mError)

            setPontuais(pData || [])
            setMensais(mData || [])
        } finally {
            if (!cancelled) setLoading(false)
        }
    }

    const openCampanhaDetails = (campanha: CampanhaMensal) => {
        router.push(`/programacao/mensal/${campanha.id}`)
    }



    const getStatusBadge = (status: string) => {
        switch (status) {
            case 'aprovado':
                return <Badge className="bg-green-600 text-white gap-1"><CheckCircle2 className="h-3 w-3" /> Aprovado</Badge>
            case 'autorizado':
                return <Badge className="bg-blue-600 text-white gap-1"><CheckCircle2 className="h-3 w-3" /> Autorizado</Badge>
            case 'aguardando_aprovacao':
                return <Badge variant="outline" className="text-amber-600 border-amber-600 bg-amber-50 gap-1"><Clock className="h-3 w-3" /> Pendente</Badge>
            case 'rascunho':
                return <Badge variant="secondary" className="gap-1"><Plus className="h-3 w-3" /> Rascunho</Badge>
            default:
                return <Badge variant="outline">{status}</Badge>
        }
    }

    const handleAutorizar = async (id: string) => {
        if (!confirm("Autorizar este evento para disparo? Após autorizar, o responsável poderá confirmar o envio.")) return
        try {
            const { error } = await supabase
                .from("eventos_pontuais")
                .update({ status: "autorizado" })
                .eq("id", id)
            if (error) throw error
            toast.success("Evento autorizado! Agora pode ser disparado.")
            fetchData()
        } catch (err: any) {
            toast.error(err.message || "Erro ao autorizar o evento.")
        }
    }

    // S17-01: abrir modal de prévia para evento pontual
    const abrirPreviewDisparo = async (evento: EventoPontual) => {
        setPreviewEvento(evento)
        setPreviewLeadCount(null)

        // S25-01: Fix timezone (split evita UTC→local) + data_fim + hora
        const fmtDate = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}` }
        const dataInicioFmt = fmtDate(evento.data_inicio)
        const dataFimFmt = evento.data_fim ? fmtDate(evento.data_fim) : null
        const dataStr = dataFimFmt && dataFimFmt !== dataInicioFmt
            ? `${dataInicioFmt} até ${dataFimFmt}`
            : dataInicioFmt
        const horaStr = evento.hora_inicio
            ? `${evento.hora_inicio}${evento.hora_fim ? ` às ${evento.hora_fim}` : ""}`
            : null
        const tpl = [
            `Olá {{nome}}! 👋`,
            ``,
            `O CUCA convida você para o evento:`,
            ``,
            `*${evento.titulo}*`,
            `📅 Data: ${dataStr}`,
            horaStr ? `🕐 Horário: ${horaStr}` : null,
            evento.local ? `📍 Local: ${evento.local}` : null,
            ``,
            evento.descricao || "",
            ``,
            `Não perca! Qualquer dúvida, estamos aqui. 😊`,
        ].filter(l => l !== null).join("\n")
        setPreviewTemplate(tpl)

        // Contar leads que receberão
        try {
            let q = supabase.from("leads").select("id", { count: "exact", head: true }).eq("opt_in", true)
            if (!evento.expansiva) q = q.eq("unidade_cuca", evento.unidade_cuca)
            const { count } = await q
            setPreviewLeadCount(count ?? 0)
        } catch { setPreviewLeadCount(null) }
    }

    const handleDisparoPontual = async () => {
        if (!previewEvento) return
        setDisparando(true)
        try {
            const { error } = await supabase
                .from("eventos_pontuais")
                .update({ status: "aprovado" })
                .eq("id", previewEvento.id)
            if (error) throw error
            toast.success("Evento aprovado! O worker irá disparar as mensagens em breve.")
            setPreviewEvento(null)
            fetchData()
        } catch (err: any) {
            toast.error(err.message || "Erro ao aprovar o evento.")
        } finally {
            setDisparando(false)
        }
    }

    const filteredPontuais = pontuais

    const filteredMensais = mensais

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3 flex-wrap">
                        Programas & Eventos
                        {unidadeFilter !== "all" && (
                            <Badge className="bg-cuca-blue text-white text-sm font-medium px-3 py-1">
                                Unidade: {unidadeFilter}
                            </Badge>
                        )}
                        {unidadeFilter === "all" && (
                            <Badge variant="outline" className="text-muted-foreground text-sm font-medium px-3 py-1 border-muted-foreground/30">
                                Vista Global (Todas Unidades)
                            </Badge>
                        )}
                    </h1>
                    <p className="text-muted-foreground mt-1">Gestão unificada da programação da Rede CUCA</p>
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
                onOpenChange={(open) => { setIsModalOpen(open); if (!open) setEditEvento(null) }}
                onSuccess={fetchData}
                editEvento={editEvento}
            />

            <Tabs defaultValue="mensal" className="w-full">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                    <TabsList className="bg-muted/50 p-1">
                        <TabsTrigger value="mensal" className="gap-2">
                            <Calendar className="h-4 w-4" /> Mensal
                        </TabsTrigger>
                        <TabsTrigger value="pontual" className="gap-2">
                            <Clock className="h-4 w-4" /> Pontual
                        </TabsTrigger>
                    </TabsList>

                    <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
                        <div className="relative shrink-0">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar..."
                                className="pl-10 w-48 h-9"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>

                        {/* Filtros de unidade com scroll horizontal em telas pequenas */}
                        <div className="overflow-x-auto flex-1 min-w-0">
                            <div className="flex bg-muted p-1 rounded-lg flex-nowrap min-w-max gap-0.5">
                                {canSeeAllUnits && (
                                    <Button
                                        variant={unidadeFilter === "all" ? "default" : "ghost"}
                                        size="sm"
                                        onClick={() => setUnidadeFilter("all")}
                                        className={`h-8 text-xs px-3 whitespace-nowrap ${unidadeFilter === "all" ? "bg-primary text-primary-foreground font-bold" : ""}`}
                                    >
                                        Todas as Unidades
                                    </Button>
                                )}
                                {unidadesCuca.map((u) => {
                                    if (!canSeeAllUnits && u !== profile?.unidade_cuca) return null
                                    return (
                                        <Button
                                            key={u}
                                            variant={unidadeFilter === u ? "default" : "ghost"}
                                            size="sm"
                                            onClick={() => canSeeAllUnits && setUnidadeFilter(u)}
                                            className={`h-8 text-xs px-3 whitespace-nowrap ${unidadeFilter === u ? "bg-primary text-primary-foreground font-bold" : ""}`}
                                        >
                                            {u.replace("Cuca ", "")}
                                        </Button>
                                    )
                                })}
                            </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                            {hasPermission("programacao_mensal", "create") && (
                                <Button
                                    variant="outline"
                                    className="gap-2 text-xs"
                                    onClick={() => {
                                        if (unidadeFilter === "all") {
                                            toast.error("Por favor, selecione uma unidade específica primeiro para a importação.")
                                            return
                                        }
                                        setIsImportModalOpen(true)
                                    }}
                                >
                                    <Upload className="h-4 w-4" />
                                    <span className="hidden sm:inline">Atualizar Programação</span>
                                </Button>
                            )}

                            {(hasPermission("programacao_mensal", "create") || hasPermission("programacao_pontual", "create")) && (
                                <Button
                                    className="bg-cuca-yellow text-cuca-dark hover:bg-yellow-500 font-bold"
                                    onClick={() => setIsModalOpen(true)}
                                >
                                    <Plus className="h-4 w-4" />
                                    <span className="hidden sm:inline ml-1">Novo Item</span>
                                </Button>
                            )}
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
                                            <TableCell className="font-semibold">
                                                <div className="flex items-center gap-2">
                                                    {p.titulo}
                                                    {p.expansiva && (
                                                        <Badge className="bg-cuca-yellow text-cuca-dark text-[10px] h-4 px-1.5">Global</Badge>
                                                    )}
                                                </div>
                                            </TableCell>
                                            {/* S27-02: badge visual mostra escopo do evento */}
                                            <TableCell>
                                                {p.expansiva
                                                    ? <Badge className="bg-cuca-blue/15 text-cuca-blue border-cuca-blue/30">Rede Toda</Badge>
                                                    : <Badge variant="outline">{p.unidade_cuca}</Badge>
                                                }
                                            </TableCell>
                                            <TableCell>
                                                {(() => { const [y,m,d] = p.data_inicio.split("-"); return `${d}/${m}/${y}` })()}
                                                {p.data_fim && (() => { const [y,m,d] = p.data_fim!.split("-"); return ` — ${d}/${m}/${y}` })()}
                                            </TableCell>
                                            <TableCell>{getStatusBadge(p.status)}</TableCell>
                                            <TableCell className="text-right flex items-center justify-end gap-2">
                                                {/* S25-02: Botão Visualizar — sempre visível */}
                                                <Button
                                                    variant="ghost" size="sm"
                                                    onClick={() => setVisualizarEvento(p)}
                                                    className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                                                    title="Visualizar detalhes"
                                                >
                                                    <Eye className="h-4 w-4" />
                                                </Button>
                                                {/* S25-03: Botão Editar */}
                                                {(p.status === 'aguardando_aprovacao' || p.status === 'autorizado') && hasPermission("programacao_pontual", "update") && (
                                                    <Button
                                                        variant="ghost" size="sm"
                                                        onClick={() => { setEditEvento(p); setIsModalOpen(true) }}
                                                        className="h-8 w-8 p-0 text-blue-500 hover:bg-blue-500/10"
                                                        title="Editar evento"
                                                    >
                                                        <Pencil className="h-3.5 w-3.5" />
                                                    </Button>
                                                )}
                                                {p.status === 'aguardando_aprovacao' && hasPermission("programacao_pontual", "update") && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => handleAutorizar(p.id)}
                                                        className="text-amber-600 border-amber-600 hover:bg-amber-50 gap-1 text-xs"
                                                    >
                                                        <CheckCircle2 className="h-3.5 w-3.5" /> Autorizar
                                                    </Button>
                                                )}
                                                {p.status === 'autorizado' && hasPermission("programacao_pontual", "update") && (
                                                    <Button
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={() => abrirPreviewDisparo(p)}
                                                        className="text-blue-600 border-blue-600 hover:bg-blue-50 gap-1 text-xs"
                                                    >
                                                        <Send className="h-3.5 w-3.5" /> Disparar Evento
                                                    </Button>
                                                )}
                                                {canDelete && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleDelete(p.id, 'pontual')}
                                                        className="text-red-500 hover:text-red-700 hover:bg-red-500/10 h-8 w-8 p-0"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                )}
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
                                            <TableCell className="font-semibold">
                                                {m.titulo} ({m.mes}/{m.ano})
                                            </TableCell>
                                            <TableCell>{m.total_atividades} atividades</TableCell>
                                            <TableCell>{getStatusBadge(m.status)}</TableCell>
                                            <TableCell>{format(new Date(m.created_at), "dd/MM/yyyy", { locale: ptBR })}</TableCell>
                                            <TableCell className="text-right flex items-center justify-end gap-2">
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => openCampanhaDetails(m)}
                                                    className="text-primary hover:text-primary/80 hover:bg-primary/10"
                                                >
                                                    Ver Atividades
                                                </Button>
                                                {canDelete && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => handleDelete(m.id, 'mensal')}
                                                        className="text-red-500 hover:text-red-700 hover:bg-red-500/10 h-8 w-8 p-0"
                                                    >
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                )}
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

            {/* S25-02: Sheet Visualizar Evento Pontual */}
            <Sheet open={!!visualizarEvento} onOpenChange={open => !open && setVisualizarEvento(null)}>
                <SheetContent className="w-full sm:max-w-md overflow-y-auto">
                    <SheetHeader className="pb-4">
                        <SheetTitle className="flex items-center gap-2">
                            <Eye className="h-5 w-5 text-primary" />
                            {visualizarEvento?.titulo}
                        </SheetTitle>
                        <div className="flex items-center gap-2 flex-wrap">
                            {visualizarEvento && getStatusBadge(visualizarEvento.status)}
                            {visualizarEvento?.unidade_cuca && (
                                <Badge variant="outline">{visualizarEvento.unidade_cuca}</Badge>
                            )}
                        </div>
                    </SheetHeader>

                    {visualizarEvento && (
                        <div className="space-y-4 mt-2">
                            {/* Flyer */}
                            {visualizarEvento.flyer_url && (
                                <img
                                    src={visualizarEvento.flyer_url}
                                    alt="Flyer do evento"
                                    className="w-full rounded-lg object-cover max-h-64"
                                />
                            )}

                            {/* Período + Horário */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <p className="text-xs text-muted-foreground font-medium">Período</p>
                                    <p className="text-sm font-semibold">
                                        {(() => { const [y,m,d] = visualizarEvento.data_inicio.split("-"); return `${d}/${m}/${y}` })()}
                                        {visualizarEvento.data_fim && (() => { const [y,m,d] = visualizarEvento.data_fim!.split("-"); return ` até ${d}/${m}/${y}` })()}
                                    </p>
                                </div>
                                {visualizarEvento.hora_inicio && (
                                    <div className="space-y-1">
                                        <p className="text-xs text-muted-foreground font-medium">Horário</p>
                                        <p className="text-sm font-semibold">
                                            {visualizarEvento.hora_inicio}
                                            {visualizarEvento.hora_fim && ` às ${visualizarEvento.hora_fim}`}
                                        </p>
                                    </div>
                                )}
                            </div>

                            {/* Local */}
                            {visualizarEvento.local && (
                                <div className="space-y-1">
                                    <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                                        <MapPin className="h-3 w-3" /> Local
                                    </p>
                                    <p className="text-sm">{visualizarEvento.local}</p>
                                </div>
                            )}

                            {/* Descrição */}
                            {visualizarEvento.descricao && (
                                <div className="space-y-1">
                                    <p className="text-xs text-muted-foreground font-medium">Descrição</p>
                                    <p className="text-sm whitespace-pre-line leading-relaxed">{visualizarEvento.descricao}</p>
                                </div>
                            )}

                            {/* Ações */}
                            {(visualizarEvento.status === 'aguardando_aprovacao' || visualizarEvento.status === 'autorizado') && hasPermission("programacao_pontual", "update") && (
                                <Button
                                    variant="outline"
                                    className="w-full gap-2"
                                    onClick={() => {
                                        setEditEvento(visualizarEvento)
                                        setIsModalOpen(true)
                                        setVisualizarEvento(null)
                                    }}
                                >
                                    <Pencil className="h-4 w-4" /> Editar Evento
                                </Button>
                            )}
                        </div>
                    )}
                </SheetContent>
            </Sheet>

            {/* S17-01: Modal Prévia de Disparo Pontual */}
            <Dialog open={!!previewEvento} onOpenChange={open => !open && setPreviewEvento(null)}>
                <DialogContent className="max-w-lg">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Send className="h-5 w-5 text-cuca-blue" />
                            Confirmar Disparo — {previewEvento?.titulo}
                        </DialogTitle>
                        <DialogDescription>
                            Revise a mensagem e o alcance antes de confirmar o disparo.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        {/* Alcance */}
                        <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/10 border border-primary/20">
                            <Users className="h-5 w-5 text-primary shrink-0" />
                            <div>
                                <p className="text-sm font-semibold">
                                    {previewLeadCount === null ? "Calculando alcance..." : `${previewLeadCount} leads receberão`}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                    {previewEvento?.expansiva ? "Evento Global — todos os leads opt-in da Rede" : `Unidade: ${previewEvento?.unidade_cuca}`}
                                </p>
                            </div>
                        </div>

                        {/* Prévia da mensagem */}
                        <div className="space-y-1.5">
                            <Label className="flex items-center gap-1.5 text-xs">
                                <Eye className="h-3.5 w-3.5" /> Prévia da mensagem (editável)
                            </Label>
                            <Textarea
                                rows={8}
                                className="text-sm font-mono bg-muted"
                                value={previewTemplate}
                                onChange={e => setPreviewTemplate(e.target.value)}
                            />
                            <p className="text-xs text-muted-foreground">
                                Use <code className="bg-muted px-1 rounded">{"{{nome}}"}</code> para personalizar com o nome do lead.
                            </p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setPreviewEvento(null)}>Cancelar</Button>
                        <Button
                            className="bg-cuca-blue text-white hover:bg-blue-700 gap-2"
                            onClick={handleDisparoPontual}
                            disabled={disparando || !previewTemplate.trim()}
                        >
                            {disparando ? <Clock className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            {disparando ? "Aprovando..." : "Confirmar Disparo"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
