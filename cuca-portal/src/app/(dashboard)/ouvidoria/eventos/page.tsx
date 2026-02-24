"use client"

import { useState, useEffect } from "react"
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs"
import {
    CalendarDays, Plus, Pencil, Trash2, CheckCircle2,
    AlertTriangle, Loader2, Megaphone
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle
} from "@/components/ui/dialog"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select"
import { toast } from "sonner"
import { format } from "date-fns"

type EventoOuvidoria = {
    id: string
    titulo: string
    descricao: string
    data_inicio: string
    data_fim: string
    unidade_cuca: string | null
    status: "ativo" | "inativo" | "concluido"
    created_at: string
}

const STATUS_CONFIG = {
    ativo: { label: "Em Andamento", color: "bg-emerald-500/10 text-emerald-600 border-emerald-200" },
    inativo: { label: "Pausado", color: "bg-amber-500/10 text-amber-600 border-amber-200" },
    concluido: { label: "Concluído", color: "bg-slate-100 text-slate-500 border-slate-200" },
}

const UNIDADES = ["Geral", "Barra", "Mondubim", "Jangurussu", "José Walter", "Pici"]

export default function EventosOuvidoriaPage() {
    const supabase = createClientComponentClient()
    const [eventos, setEventos] = useState<EventoOuvidoria[]>([])
    const [loading, setLoading] = useState(true)

    // Modal state
    const [modalOpen, setModalOpen] = useState(false)
    const [editing, setEditing] = useState<EventoOuvidoria | null>(null)
    const [titulo, setTitulo] = useState("")
    const [descricao, setDescricao] = useState("")
    const [dataInicio, setDataInicio] = useState("")
    const [dataFim, setDataFim] = useState("")
    const [unidade, setUnidade] = useState("Geral")
    const [status, setStatus] = useState<"ativo" | "inativo" | "concluido">("ativo")
    const [saving, setSaving] = useState(false)

    useEffect(() => { fetchEventos() }, [])

    const fetchEventos = async () => {
        setLoading(true)
        const { data } = await supabase.from("ouvidoria_eventos").select("*").order("created_at", { ascending: false })
        setEventos(data || [])
        setLoading(false)
    }

    const openModal = (ev?: EventoOuvidoria) => {
        setEditing(ev || null)
        setTitulo(ev?.titulo || "")
        setDescricao(ev?.descricao || "")
        setDataInicio(ev?.data_inicio ? ev.data_inicio.split("T")[0] : "")
        setDataFim(ev?.data_fim ? ev.data_fim.split("T")[0] : "")
        setUnidade(ev?.unidade_cuca || "Geral")
        setStatus(ev?.status || "inativo")
        setModalOpen(true)
    }

    const saveEvento = async () => {
        if (!titulo || !descricao || !dataInicio || !dataFim) return toast.error("Preencha os campos obrigatórios.")
        setSaving(true)
        try {
            const payload = {
                titulo,
                descricao,
                data_inicio: dataInicio,
                data_fim: dataFim,
                unidade_cuca: unidade === "Geral" ? null : unidade,
                status
            }
            if (editing) {
                await supabase.from("ouvidoria_eventos").update(payload).eq("id", editing.id)
                toast.success("Evento de escuta atualizado!")
            } else {
                await supabase.from("ouvidoria_eventos").insert(payload)
                toast.success("Evento de escuta criado com sucesso!")
            }
            await fetchEventos()
            setModalOpen(false)
        } catch (err) {
            toast.error("Erro ao salvar evento.")
        } finally {
            setSaving(false)
        }
    }

    const deleteEvento = async (id: string, nome: string) => {
        if (!confirm(`Remover permanentemente o evento "${nome}"?`)) return
        await supabase.from("ouvidoria_eventos").delete().eq("id", id)
        toast.success("Evento removido.")
        await fetchEventos()
    }

    return (
        <div className="flex flex-col gap-6 p-2 md:p-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <Megaphone className="h-6 w-6 text-primary" />
                        Eventos de Escuta
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">Crie campanhas e eventos de ouvidoria para coleta de sugestões e críticas da Sofia.</p>
                </div>
                <Button onClick={() => openModal()} className="gap-2">
                    <Plus className="h-4 w-4" /> Novo Evento
                </Button>
            </div>

            {loading ? (
                <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {eventos.map(ev => {
                        const cfg = STATUS_CONFIG[ev.status] || STATUS_CONFIG.inativo
                        const isAtivo = ev.status === "ativo"
                        return (
                            <div key={ev.id} className={cn("border rounded-xl p-5 bg-card flex flex-col h-full", isAtivo && "border-primary/50 shadow-sm")}>
                                <div className="flex justify-between items-start mb-3">
                                    <Badge className={cn("text-[10px] border", cfg.color)}>{cfg.label}</Badge>
                                    <div className="flex gap-1">
                                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openModal(ev)}>
                                            <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteEvento(ev.id, ev.titulo)}>
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>

                                <h3 className="font-semibold text-lg leading-tight mb-2 line-clamp-2">{ev.titulo}</h3>
                                <p className="text-xs text-muted-foreground line-clamp-3 flex-1 mb-4">{ev.descricao}</p>

                                <div className="space-y-2 pt-4 border-t">
                                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                        <CalendarDays className="h-3.5 w-3.5" />
                                        {format(new Date(ev.data_inicio + "T12:00:00"), "dd/MM/yyyy")} até {format(new Date(ev.data_fim + "T12:00:00"), "dd/MM/yyyy")}
                                    </div>
                                    <Badge variant="outline" className="text-[10px] font-normal">
                                        Filtro: {ev.unidade_cuca ? `CUCA ${ev.unidade_cuca}` : "Rede (Geral)"}
                                    </Badge>
                                </div>
                            </div>
                        )
                    })}
                    {eventos.length === 0 && (
                        <div className="col-span-full text-center py-16 text-muted-foreground">
                            <Megaphone className="h-12 w-12 mx-auto mb-4 opacity-20" />
                            <p>Nenhum evento de escuta cadastrado. Crie o primeiro para a Sofia coletar feedback.</p>
                        </div>
                    )}
                </div>
            )}

            <Dialog open={modalOpen} onOpenChange={setModalOpen}>
                <DialogContent className="sm:max-w-xl">
                    <DialogHeader>
                        <DialogTitle>{editing ? "Editar Evento de Escuta" : "Novo Evento de Escuta"}</DialogTitle>
                        <DialogDescription className="sr-only">Configure os detalhes do evento para o agente de ouvidoria.</DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-4">
                        <div className="grid gap-2">
                            <Label>Título do Evento *</Label>
                            <Input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="ex: Pesquisa de Satisfação - Cursos de Janeiro" />
                        </div>

                        <div className="grid gap-2">
                            <Label>Descrição (Instrução para a Sofia) *</Label>
                            <Textarea
                                value={descricao}
                                onChange={e => setDescricao(e.target.value)}
                                placeholder="Descreva sobre o que é o evento. A Sofia usará este texto para basear suas respostas."
                                rows={4}
                            />
                            <p className="text-[10px] text-muted-foreground">A Sofia limitará suas respostas e perguntas ao contexto descrito acima.</p>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label>Data Inicial *</Label>
                                <Input type="date" value={dataInicio} onChange={e => setDataInicio(e.target.value)} />
                            </div>
                            <div className="grid gap-2">
                                <Label>Data Final *</Label>
                                <Input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)} />
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4">
                            <div className="grid gap-2">
                                <Label>Foco (Unidade Cuca)</Label>
                                <Select value={unidade} onValueChange={setUnidade}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {UNIDADES.map(u => <SelectItem key={u} value={u}>{u === "Geral" ? "Rede Completa" : `CUCA ${u}`}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label>Status Inicial</Label>
                                <Select value={status} onValueChange={(v: any) => setStatus(v)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="inativo">Pausado / Rascunho</SelectItem>
                                        <SelectItem value="ativo">Ativo (Rodando)</SelectItem>
                                        <SelectItem value="concluido">Concluído</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2 border-t mt-2">
                        <Button variant="outline" onClick={() => setModalOpen(false)}>Cancelar</Button>
                        <Button onClick={saveEvento} disabled={saving || !titulo || !descricao || !dataInicio || !dataFim}>
                            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                            {editing ? "Salvar" : "Criar Evento"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
