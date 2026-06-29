"use client"

import { useState, useEffect, useCallback } from "react"
import {
    FileText, Plus, Save, X, ArrowLeft, Loader2, Trash2, AlertTriangle,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    Dialog, DialogContent, DialogDescription, DialogHeader,
    DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { toast } from "sonner"
import Link from "next/link"

// ─── Tipos & constantes ────────────────────────────────────────────────────────

type TemplateStatus = "pendente" | "aprovado" | "rejeitado" | "pausado"

type MetaTemplate = {
    id: string
    nome: string
    categoria: string | null
    status: TemplateStatus
    variaveis: string[]
    automacoes: string[]
    waba_ids: string[]
    phone_number_ids: string[]
    observacoes: string | null
    ativo: boolean
    created_at: string
    updated_at: string
}

const STATUS_OPTIONS: TemplateStatus[] = ["pendente", "aprovado", "rejeitado", "pausado"]

const STATUS_BADGE: Record<TemplateStatus, string> = {
    pendente:  "bg-yellow-500/10 text-yellow-700 border-yellow-300",
    aprovado:  "bg-green-500/10  text-green-700  border-green-300",
    rejeitado: "bg-red-500/10    text-red-700    border-red-300",
    pausado:   "bg-gray-500/10   text-gray-600   border-gray-300",
}

// ─── Componente principal ──────────────────────────────────────────────────────

export default function MetaTemplatesPage() {
    const [templates, setTemplates] = useState<MetaTemplate[]>([])
    const [loading, setLoading] = useState(true)

    // Filtros
    const [filterStatus, setFilterStatus] = useState<string>("__all__")
    const [filterAutomacao, setFilterAutomacao] = useState<string>("__all__")
    const [showInativos, setShowInativos] = useState(false)

    // Edição inline
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editState, setEditState] = useState<Partial<MetaTemplate> | null>(null)
    const [saving, setSaving] = useState(false)

    // Modais
    const [showCreate, setShowCreate] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState<MetaTemplate | null>(null)

    const fetchTemplates = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch("/api/admin/meta-templates")
            if (!res.ok) throw new Error(await res.text())
            setTemplates(await res.json())
        } catch (err: any) {
            toast.error("Erro ao carregar templates: " + err.message)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { fetchTemplates() }, [fetchTemplates])

    // Todas as automações únicas (para filtro)
    const todasAutomacoes = Array.from(
        new Set(templates.flatMap(t => t.automacoes))
    ).sort()

    // Templates filtrados
    const filtered = templates.filter(t => {
        if (!showInativos && !t.ativo) return false
        if (filterStatus !== "__all__" && t.status !== filterStatus) return false
        if (filterAutomacao !== "__all__" && !t.automacoes.includes(filterAutomacao)) return false
        return true
    })

    // ── Edição inline ──

    function startEdit(row: MetaTemplate) {
        setEditingId(row.id)
        setEditState({
            nome: row.nome,
            categoria: row.categoria ?? "",
            status: row.status,
            variaveis: row.variaveis,
            automacoes: row.automacoes,
            observacoes: row.observacoes ?? "",
            ativo: row.ativo,
        })
    }

    function cancelEdit() {
        setEditingId(null)
        setEditState(null)
    }

    async function saveEdit() {
        if (!editState || !editingId) return
        setSaving(true)
        try {
            const res = await fetch(`/api/admin/meta-templates/${editingId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    nome: (editState.nome ?? "").trim(),
                    categoria: (editState.categoria ?? "").trim() || null,
                    status: editState.status,
                    variaveis: editState.variaveis,
                    automacoes: editState.automacoes,
                    observacoes: (editState.observacoes ?? "").trim() || null,
                    ativo: editState.ativo,
                }),
            })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error ?? "Erro ao salvar")
            }
            toast.success("Template atualizado")
            cancelEdit()
            await fetchTemplates()
        } catch (err: any) {
            toast.error(err.message)
        } finally {
            setSaving(false)
        }
    }

    // ── Soft delete ──

    async function confirmDelete(tpl: MetaTemplate) {
        try {
            const res = await fetch(`/api/admin/meta-templates/${tpl.id}`, { method: "DELETE" })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error ?? "Erro ao desativar")
            }
            toast.success(`Template "${tpl.nome}" desativado`)
            setDeleteTarget(null)
            await fetchTemplates()
        } catch (err: any) {
            toast.error(err.message)
        }
    }

    return (
        <div className="flex flex-col gap-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <Link href="/developer">
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                </Link>
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <FileText className="h-5 w-5 text-primary" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Templates Meta</h1>
                    <p className="text-sm text-muted-foreground">
                        Catálogo de templates WhatsApp — fonte de verdade para worker, edge functions e portal
                    </p>
                </div>
                <Button
                    className="ml-auto gap-2"
                    onClick={() => setShowCreate(true)}
                    disabled={loading}
                >
                    <Plus className="h-4 w-4" />
                    Novo Template
                </Button>
            </div>

            {/* Filtros */}
            <div className="flex flex-wrap items-center gap-3">
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="h-8 w-40 text-sm">
                        <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="__all__">Todos os status</SelectItem>
                        {STATUS_OPTIONS.map(s => (
                            <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <Select value={filterAutomacao} onValueChange={setFilterAutomacao}>
                    <SelectTrigger className="h-8 w-48 text-sm">
                        <SelectValue placeholder="Automação" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="__all__">Todas as automações</SelectItem>
                        {todasAutomacoes.map(a => (
                            <SelectItem key={a} value={a}>{a}</SelectItem>
                        ))}
                    </SelectContent>
                </Select>

                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                    <Switch
                        checked={showInativos}
                        onCheckedChange={setShowInativos}
                        className="h-4 w-7"
                    />
                    Mostrar inativos
                </label>

                <span className="ml-auto text-xs text-muted-foreground">
                    {filtered.length} de {templates.length}
                </span>
            </div>

            {/* Tabela */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Templates cadastrados</CardTitle>
                    <CardDescription>
                        Clique em uma linha para editar. Status <Badge variant="outline" className={`text-xs ${STATUS_BADGE.aprovado}`}>aprovado</Badge> é necessário para o sistema utilizar o template.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex h-32 items-center justify-center">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : filtered.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                            {templates.length === 0
                                ? 'Nenhum template cadastrado. Clique em "+ Novo Template".'
                                : "Nenhum resultado para os filtros aplicados."}
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-64">Nome</TableHead>
                                    <TableHead className="w-32">Categoria</TableHead>
                                    <TableHead className="w-28">Status</TableHead>
                                    <TableHead>Automações</TableHead>
                                    <TableHead className="w-16">Ativo</TableHead>
                                    <TableHead className="w-28" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filtered.map((row) => {
                                    const isEditing = editingId === row.id
                                    const es = isEditing ? editState! : null

                                    return (
                                        <TableRow
                                            key={row.id}
                                            className={isEditing ? "bg-muted/50" : "cursor-pointer hover:bg-muted/30"}
                                            onClick={() => !isEditing && startEdit(row)}
                                        >
                                            {/* nome */}
                                            <TableCell className="font-mono text-xs">
                                                {isEditing ? (
                                                    <Input
                                                        className="h-7 text-xs font-mono"
                                                        value={es!.nome ?? ""}
                                                        onChange={e => setEditState(s => s ? { ...s, nome: e.target.value } : s)}
                                                        onClick={e => e.stopPropagation()}
                                                    />
                                                ) : row.nome}
                                            </TableCell>

                                            {/* categoria */}
                                            <TableCell className="text-xs text-muted-foreground">
                                                {isEditing ? (
                                                    <Input
                                                        className="h-7 text-xs"
                                                        value={es!.categoria ?? ""}
                                                        onChange={e => setEditState(s => s ? { ...s, categoria: e.target.value } : s)}
                                                        onClick={e => e.stopPropagation()}
                                                    />
                                                ) : (row.categoria ?? "—")}
                                            </TableCell>

                                            {/* status */}
                                            <TableCell>
                                                {isEditing ? (
                                                    <Select
                                                        value={es!.status}
                                                        onValueChange={v => setEditState(s => s ? { ...s, status: v as TemplateStatus } : s)}
                                                    >
                                                        <SelectTrigger className="h-7 w-28 text-xs" onClick={e => e.stopPropagation()}>
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {STATUS_OPTIONS.map(st => (
                                                                <SelectItem key={st} value={st}>{st}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                ) : (
                                                    <Badge variant="outline" className={`text-xs ${STATUS_BADGE[row.status]}`}>
                                                        {row.status}
                                                    </Badge>
                                                )}
                                            </TableCell>

                                            {/* automacoes */}
                                            <TableCell>
                                                {isEditing ? (
                                                    <Input
                                                        className="h-7 text-xs"
                                                        placeholder="ex: transbordo, Empregabilidade"
                                                        value={(es!.automacoes ?? []).join(", ")}
                                                        onChange={e => setEditState(s => s ? {
                                                            ...s,
                                                            automacoes: e.target.value.split(",").map(x => x.trim()).filter(Boolean),
                                                        } : s)}
                                                        onClick={e => e.stopPropagation()}
                                                    />
                                                ) : (
                                                    <div className="flex flex-wrap gap-1">
                                                        {row.automacoes.length === 0
                                                            ? <span className="text-xs text-muted-foreground">—</span>
                                                            : row.automacoes.map(a => (
                                                                <Badge key={a} variant="secondary" className="text-xs px-1.5 py-0">
                                                                    {a}
                                                                </Badge>
                                                            ))
                                                        }
                                                    </div>
                                                )}
                                            </TableCell>

                                            {/* ativo */}
                                            <TableCell>
                                                {isEditing ? (
                                                    <Switch
                                                        checked={es!.ativo ?? true}
                                                        onCheckedChange={v => setEditState(s => s ? { ...s, ativo: v } : s)}
                                                        onClick={e => e.stopPropagation()}
                                                    />
                                                ) : (
                                                    <Badge variant={row.ativo ? "default" : "secondary"} className="text-xs">
                                                        {row.ativo ? "Sim" : "Não"}
                                                    </Badge>
                                                )}
                                            </TableCell>

                                            {/* ações */}
                                            <TableCell onClick={e => e.stopPropagation()}>
                                                {isEditing ? (
                                                    <div className="flex gap-1">
                                                        <Button
                                                            size="sm"
                                                            className="h-7 gap-1 px-2 text-xs"
                                                            onClick={saveEdit}
                                                            disabled={saving}
                                                        >
                                                            {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                                                            Salvar
                                                        </Button>
                                                        <Button
                                                            size="sm"
                                                            variant="ghost"
                                                            className="h-7 w-7 p-0"
                                                            onClick={cancelEdit}
                                                            disabled={saving}
                                                        >
                                                            <X className="h-3 w-3" />
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                                        onClick={e => {
                                                            e.stopPropagation()
                                                            setDeleteTarget(row)
                                                        }}
                                                        title="Desativar template"
                                                    >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                    </Button>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* Modal: Criar template */}
            <CreateTemplateModal
                open={showCreate}
                onClose={() => setShowCreate(false)}
                onCreated={fetchTemplates}
            />

            {/* Dialog: Confirmar desativação */}
            <Dialog open={!!deleteTarget} onOpenChange={v => { if (!v) setDeleteTarget(null) }}>
                <DialogContent className="max-w-sm">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-destructive" />
                            Desativar template
                        </DialogTitle>
                        <DialogDescription>
                            O template <code className="text-xs font-mono">{deleteTarget?.nome}</code> será
                            marcado como <strong>inativo</strong> (ativo=false). Ele não será mais usado
                            pelos disparos automáticos até ser reativado.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
                        <Button
                            variant="destructive"
                            onClick={() => deleteTarget && confirmDelete(deleteTarget)}
                        >
                            Desativar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

// ─── Modal criar template ──────────────────────────────────────────────────────

type CreateTemplateModalProps = {
    open: boolean
    onClose: () => void
    onCreated: () => Promise<void>
}

type CreateForm = {
    nome: string
    categoria: string
    status: TemplateStatus
    variaveis: string
    automacoes: string
    waba_ids: string
    phone_number_ids: string
    observacoes: string
    ativo: boolean
}

const INITIAL_FORM: CreateForm = {
    nome: "", categoria: "", status: "pendente",
    variaveis: "", automacoes: "", waba_ids: "", phone_number_ids: "",
    observacoes: "", ativo: true,
}

function CreateTemplateModal({ open, onClose, onCreated }: CreateTemplateModalProps) {
    const [form, setForm] = useState<CreateForm>(INITIAL_FORM)
    const [submitting, setSubmitting] = useState(false)

    function handleClose() {
        setForm(INITIAL_FORM)
        onClose()
    }

    function split(val: string) {
        return val.split(",").map(x => x.trim()).filter(Boolean)
    }

    async function handleSubmit() {
        if (!form.nome.trim()) {
            toast.error("Nome do template é obrigatório")
            return
        }
        setSubmitting(true)
        try {
            const res = await fetch("/api/admin/meta-templates", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    nome: form.nome.trim(),
                    categoria: form.categoria.trim() || null,
                    status: form.status,
                    variaveis: split(form.variaveis),
                    automacoes: split(form.automacoes),
                    waba_ids: split(form.waba_ids),
                    phone_number_ids: split(form.phone_number_ids),
                    observacoes: form.observacoes.trim() || null,
                    ativo: form.ativo,
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error ?? "Erro ao criar template")
            toast.success(`Template "${form.nome}" criado`)
            handleClose()
            await onCreated()
        } catch (err: any) {
            toast.error(err.message)
        } finally {
            setSubmitting(false)
        }
    }

    function f(field: keyof CreateForm) {
        return (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
            setForm(p => ({ ...p, [field]: e.target.value }))
    }

    return (
        <Dialog open={open} onOpenChange={v => { if (!v) handleClose() }}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Plus className="h-4 w-4" />
                        Novo Template Meta
                    </DialogTitle>
                    <DialogDescription>
                        Cadastra um template no catálogo. Status inicial <code>pendente</code> — mude para
                        <code> aprovado</code> quando o template for aprovado no Meta Business Manager.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4 py-2">
                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="tpl-nome">Nome (exato, snake_case) <span className="text-destructive">*</span></Label>
                        <Input id="tpl-nome" placeholder="ex: cuca_transbordo_colaborador"
                            value={form.nome} onChange={f("nome")} className="font-mono text-sm" />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="tpl-categoria">Categoria</Label>
                            <Input id="tpl-categoria" placeholder="ex: Transbordo"
                                value={form.categoria} onChange={f("categoria")} />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Label>Status inicial</Label>
                            <Select value={form.status} onValueChange={v => setForm(p => ({ ...p, status: v as TemplateStatus }))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="tpl-automacoes">
                            Automações <span className="text-muted-foreground text-xs">(separadas por vírgula)</span>
                        </Label>
                        <Input id="tpl-automacoes" placeholder="ex: transbordo, Empregabilidade"
                            value={form.automacoes} onChange={f("automacoes")} />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="tpl-variaveis">
                            Variáveis <span className="text-muted-foreground text-xs">(separadas por vírgula)</span>
                        </Label>
                        <Input id="tpl-variaveis" placeholder="ex: nome_lead, unidade"
                            value={form.variaveis} onChange={f("variaveis")} />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="tpl-waba">
                                WABA IDs <span className="text-muted-foreground text-xs">(vírgula)</span>
                            </Label>
                            <Input id="tpl-waba" placeholder="ex: 27334860332..."
                                value={form.waba_ids} onChange={f("waba_ids")} />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Label htmlFor="tpl-pn">
                                Phone Number IDs <span className="text-muted-foreground text-xs">(vírgula)</span>
                            </Label>
                            <Input id="tpl-pn" placeholder="ex: 1233832826..."
                                value={form.phone_number_ids} onChange={f("phone_number_ids")} />
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="tpl-obs">Observações</Label>
                        <Textarea id="tpl-obs" placeholder="Contexto, variáveis, histórico de aprovação..."
                            value={form.observacoes} onChange={f("observacoes")} rows={3} />
                    </div>

                    <div className="flex items-center gap-3">
                        <Switch
                            id="tpl-ativo"
                            checked={form.ativo}
                            onCheckedChange={v => setForm(p => ({ ...p, ativo: v }))}
                        />
                        <Label htmlFor="tpl-ativo" className="cursor-pointer">Ativo imediatamente</Label>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={handleClose} disabled={submitting}>Cancelar</Button>
                    <Button onClick={handleSubmit} disabled={submitting} className="gap-2">
                        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        Criar Template
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
