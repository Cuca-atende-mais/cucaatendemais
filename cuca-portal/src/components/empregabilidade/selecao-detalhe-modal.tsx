"use client"

// SQS-56 (T8): modal de detalhe de uma seleção — tabela de confirmados (AC12),
// CRUD manual para candidatos vindos de outros canais (AC13) e botão de
// feedback da empresa, reusando a rota já existente (AC14).

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { Vaga, Candidatura } from "@/lib/types/database"
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
    Loader2, PenLine, Plus, Trash2, MessageSquare, Users, CalendarDays, MapPin,
} from "lucide-react"
import toast from "react-hot-toast"

interface SelecaoDetalheModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    selecao: Vaga | null
    empresaNome: string
    onEditar: () => void
}

const STATUS_OPCOES = [
    { value: "pendente", label: "Pendente" },
    { value: "selecionado", label: "Selecionado" },
    { value: "contratado", label: "Contratado" },
    { value: "rejeitado", label: "Rejeitado" },
]

function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback
}

export function SelecaoDetalheModal({ open, onOpenChange, selecao, empresaNome, onEditar }: SelecaoDetalheModalProps) {
    const supabase = createClient()
    const [candidatos, setCandidatos] = useState<Candidatura[]>([])
    const [loading, setLoading] = useState(false)
    const [feedbackLoading, setFeedbackLoading] = useState(false)
    const [savingStatusId, setSavingStatusId] = useState<string | null>(null)

    // ── CRUD manual (AC13) ────────────────────────────────────────────────────
    const [manualOpen, setManualOpen] = useState(false)
    const [manualNome, setManualNome] = useState("")
    const [manualTelefone, setManualTelefone] = useState("")
    const [manualCargo, setManualCargo] = useState("")
    const [manualSaving, setManualSaving] = useState(false)

    const cargosDaSelecao = (selecao?.cargos_lista || []).map(c => c.titulo).filter(Boolean)

    const carregar = useCallback(async () => {
        if (!selecao) return
        setLoading(true)
        const { data, error } = await supabase
            .from("candidaturas")
            .select("*")
            .eq("vaga_id", selecao.id)
            .order("created_at", { ascending: false })
        if (error) toast.error("Erro ao carregar confirmados.")
        setCandidatos((data || []) as Candidatura[])
        setLoading(false)
    }, [selecao, supabase])

    useEffect(() => {
        if (open) carregar()
        else {
            setManualOpen(false)
            setManualNome(""); setManualTelefone(""); setManualCargo("")
        }
    }, [open, carregar])

    const handleStatusChange = async (candidaturaId: string, novoStatus: string) => {
        setSavingStatusId(candidaturaId)
        const { error } = await supabase.from("candidaturas").update({ status: novoStatus }).eq("id", candidaturaId)
        if (error) {
            toast.error("Erro ao atualizar status.")
        } else {
            setCandidatos(prev => prev.map(c => c.id === candidaturaId ? { ...c, status: novoStatus } : c))
        }
        setSavingStatusId(null)
    }

    const handleExcluir = async (candidaturaId: string, nome: string) => {
        if (!confirm(`Remover ${nome} da lista de confirmados?`)) return
        const { error } = await supabase.from("candidaturas").delete().eq("id", candidaturaId)
        if (error) { toast.error("Erro ao remover."); return }
        setCandidatos(prev => prev.filter(c => c.id !== candidaturaId))
        toast.success("Removido.")
    }

    const handleAdicionarManual = async () => {
        if (!selecao) return
        if (!manualNome.trim()) { toast.error("Informe o nome."); return }
        if (!manualTelefone.trim()) { toast.error("Informe o telefone."); return }
        setManualSaving(true)
        try {
            const telefoneDigitos = manualTelefone.replace(/\D/g, "")
            const { data, error } = await supabase.from("candidaturas").insert({
                vaga_id: selecao.id,
                nome: manualNome.trim(),
                telefone: telefoneDigitos,
                telefone_contato: telefoneDigitos,
                cargo_escolhido: manualCargo || null,
                status: "pendente",
                confirmacao_presenca: "confirmado",
                observacoes: "Incluído manualmente (outro canal)",
            }).select("*").single()
            if (error) throw error
            setCandidatos(prev => [data as Candidatura, ...prev])
            toast.success(`${manualNome} adicionado(a) à lista.`)
            setManualNome(""); setManualTelefone(""); setManualCargo(""); setManualOpen(false)
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, "Erro ao adicionar candidato."))
        } finally {
            setManualSaving(false)
        }
    }

    const handleFeedback = async () => {
        if (!selecao) return
        setFeedbackLoading(true)
        try {
            const res = await fetch(`/api/empregabilidade/vagas/${selecao.id}/solicitar-feedback`, { method: "POST" })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Erro ao solicitar feedback")
            toast.success("Solicitação de feedback enviada via WhatsApp!")
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, "Falha ao solicitar feedback."))
        } finally {
            setFeedbackLoading(false)
        }
    }

    if (!selecao) return null

    const datas = selecao.datas_selecao || []

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        {selecao.titulo}
                        <Badge className="bg-cuca-blue/10 text-cuca-blue border-cuca-blue/30 text-xs">
                            {selecao.coleta_curriculo ? "Com currículo" : "Só presença"}
                        </Badge>
                    </DialogTitle>
                    <DialogDescription>
                        <span className="flex flex-wrap items-center gap-3 mt-1">
                            <span>{empresaNome}</span>
                            {datas[0] && (
                                <span className="flex items-center gap-1">
                                    <CalendarDays className="h-3.5 w-3.5" />
                                    {datas.map((d) => `${d.data?.split("-").reverse().join("/")}${d.hora ? ` ${d.hora}` : ""}`).join(", ")}
                                </span>
                            )}
                            {selecao.local_entrevista && (
                                <span className="flex items-center gap-1"><MapPin className="h-3.5 w-3.5" /> {selecao.local_entrevista}</span>
                            )}
                        </span>
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-wrap gap-2 pt-1 pb-2 border-b">
                    <Button variant="outline" size="sm" onClick={onEditar}>
                        <PenLine className="h-3.5 w-3.5 mr-1.5" /> Editar seleção
                    </Button>
                    <Button
                        variant="outline" size="sm"
                        className="border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10"
                        onClick={handleFeedback}
                        disabled={feedbackLoading}
                    >
                        {feedbackLoading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5 mr-1.5" />}
                        Solicitar feedback da empresa
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setManualOpen(o => !o)}>
                        <Plus className="h-3.5 w-3.5 mr-1.5" /> Incluir candidato manualmente
                    </Button>
                </div>

                {manualOpen && (
                    <div className="border rounded-lg p-3 space-y-3 bg-muted/20">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                            <div className="space-y-1">
                                <Label className="text-xs">Nome completo</Label>
                                <Input value={manualNome} onChange={e => setManualNome(e.target.value)} placeholder="Nome do candidato" />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Telefone</Label>
                                <Input value={manualTelefone} onChange={e => setManualTelefone(e.target.value)} placeholder="(85) 99999-9999" />
                            </div>
                            <div className="space-y-1">
                                <Label className="text-xs">Cargo</Label>
                                <Select value={manualCargo} onValueChange={setManualCargo}>
                                    <SelectTrigger><SelectValue placeholder="Selecione (opcional)" /></SelectTrigger>
                                    <SelectContent>
                                        {cargosDaSelecao.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="sm" onClick={() => setManualOpen(false)}>Cancelar</Button>
                            <Button size="sm" onClick={handleAdicionarManual} disabled={manualSaving}>
                                {manualSaving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
                                Adicionar
                            </Button>
                        </div>
                    </div>
                )}

                <div className="pt-1">
                    <p className="text-sm font-medium mb-2 flex items-center gap-1.5">
                        <Users className="h-4 w-4" /> Confirmados ({candidatos.length})
                    </p>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Nome</TableHead>
                                <TableHead>Telefone</TableHead>
                                <TableHead>Cargo</TableHead>
                                <TableHead>Confirmação</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="w-10"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Carregando...</TableCell></TableRow>
                            ) : candidatos.length === 0 ? (
                                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Nenhum confirmado ainda.</TableCell></TableRow>
                            ) : candidatos.map(c => (
                                <TableRow key={c.id}>
                                    <TableCell className="font-medium">{c.nome}</TableCell>
                                    <TableCell className="text-sm text-muted-foreground">{c.telefone_contato || c.telefone}</TableCell>
                                    <TableCell className="text-sm">{c.cargo_escolhido || "—"}</TableCell>
                                    <TableCell>
                                        {c.confirmacao_presenca === "confirmado" ? (
                                            <Badge className="bg-green-600/10 text-green-500 border-green-600/30">Confirmado</Badge>
                                        ) : (
                                            <Badge variant="outline" className="text-muted-foreground">Pendente</Badge>
                                        )}
                                    </TableCell>
                                    <TableCell>
                                        <Select
                                            value={c.status}
                                            onValueChange={v => handleStatusChange(c.id, v)}
                                            disabled={savingStatusId === c.id}
                                        >
                                            <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                                            <SelectContent>
                                                {STATUS_OPCOES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </TableCell>
                                    <TableCell>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleExcluir(c.id, c.nome)}>
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </DialogContent>
        </Dialog>
    )
}
