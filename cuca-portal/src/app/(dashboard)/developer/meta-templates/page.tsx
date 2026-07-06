"use client"

import { useState, useEffect, useCallback } from "react"
import {
    FileText, Plus, ArrowLeft, Loader2, Trash2, AlertTriangle, Pencil,
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
import Link from "next/link"
import {
    Dialog, DialogContent, DialogDescription, DialogHeader,
    DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import { toast } from "sonner"
// ─── Tipos & constantes ────────────────────────────────────────────────────────

type TemplateStatus = "pendente" | "aprovado" | "rejeitado" | "pausado"

type MetaTemplate = {
    id: string
    nome: string
    categoria: string | null
    status: TemplateStatus
    variaveis: { posicao: number; descricao: string }[]
    automacoes: string[]
    waba_ids: string[]
    phone_number_ids: string[]
    observacoes: string | null
    corpo_texto: string | null
    ativo: boolean
    created_at: string
    updated_at: string
}

type PhoneNumber = {
    id: string
    phone_number_id: string
    waba_id: string
    display_name: string
    canal_tipo: string
    agente_tipo: string
    ativo: boolean
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

    // Modais
    const [showCreate, setShowCreate] = useState(false)
    const [deleteTarget, setDeleteTarget] = useState<MetaTemplate | null>(null)

    const fetchTemplates = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch("/api/admin/meta-templates")
            if (!res.ok) throw new Error(await res.text())
            setTemplates(await res.json())
        } catch (err) {
            toast.error("Erro ao carregar templates: " + (err instanceof Error ? err.message : String(err)))
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
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err))
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
                        Clique em <Pencil className="inline h-3 w-3" /> para editar o texto e as configurações.{" "}
                        Status <Badge variant="outline" className={`text-xs ${STATUS_BADGE.aprovado}`}>aprovado</Badge>{" "}
                        é necessário para o sistema utilizar o template.
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
                                    <TableHead className="w-28">Categoria</TableHead>
                                    <TableHead className="w-28">Status</TableHead>
                                    <TableHead>Automações</TableHead>
                                    <TableHead className="w-40">Corpo</TableHead>
                                    <TableHead className="w-16">Ativo</TableHead>
                                    <TableHead className="w-20" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filtered.map((row) => (
                                    <TableRow key={row.id} className="hover:bg-muted/30">
                                        {/* nome */}
                                        <TableCell className="font-mono text-xs">{row.nome}</TableCell>

                                        {/* categoria */}
                                        <TableCell className="text-xs text-muted-foreground">
                                            {row.categoria ?? "—"}
                                        </TableCell>

                                        {/* status */}
                                        <TableCell>
                                            <Badge variant="outline" className={`text-xs ${STATUS_BADGE[row.status]}`}>
                                                {row.status}
                                            </Badge>
                                        </TableCell>

                                        {/* automações */}
                                        <TableCell>
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
                                        </TableCell>

                                        {/* corpo preview */}
                                        <TableCell className="text-xs text-muted-foreground max-w-[10rem] truncate">
                                            {row.corpo_texto
                                                ? row.corpo_texto.slice(0, 45) + (row.corpo_texto.length > 45 ? "…" : "")
                                                : <span className="text-destructive/70">sem texto</span>
                                            }
                                        </TableCell>

                                        {/* ativo */}
                                        <TableCell>
                                            <Badge variant={row.ativo ? "default" : "secondary"} className="text-xs">
                                                {row.ativo ? "Sim" : "Não"}
                                            </Badge>
                                        </TableCell>

                                        {/* ações */}
                                        <TableCell>
                                            <div className="flex gap-1">
                                                <Link href={`/developer/meta-templates/${row.id}`}>
                                                    <Button
                                                        size="sm"
                                                        variant="ghost"
                                                        className="h-7 w-7 p-0"
                                                        title="Editar template"
                                                    >
                                                        <Pencil className="h-3.5 w-3.5" />
                                                    </Button>
                                                </Link>
                                                <Button
                                                    size="sm"
                                                    variant="ghost"
                                                    className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                                    onClick={() => setDeleteTarget(row)}
                                                    title="Desativar template"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
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
    phoneNumberId: string
    corpo_texto: string
    observacoes: string
    ativo: boolean
}

const INITIAL_FORM: CreateForm = {
    nome: "", categoria: "UTILITY", status: "pendente",
    phoneNumberId: "", corpo_texto: "", observacoes: "", ativo: true,
}

const CATEGORIAS = ["UTILITY", "MARKETING", "AUTHENTICATION"]

function CreateTemplateModal({ open, onClose, onCreated }: CreateTemplateModalProps) {
    const [form, setForm] = useState<CreateForm>(INITIAL_FORM)
    const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([])
    const [submitting, setSubmitting] = useState(false)

    useEffect(() => {
        if (!open) return
        fetch("/api/admin/meta-phone-numbers")
            .then(res => res.ok ? res.json() : [])
            .then((data: PhoneNumber[]) => setPhoneNumbers(data.filter(p => p.ativo)))
            .catch(() => setPhoneNumbers([]))
    }, [open])

    const selectedPhone = phoneNumbers.find(p => p.phone_number_id === form.phoneNumberId) ?? null

    function handleClose() {
        setForm(INITIAL_FORM)
        onClose()
    }

    async function handleSubmit() {
        if (!form.nome.trim()) {
            toast.error("Nome do template é obrigatório")
            return
        }
        if (!selectedPhone) {
            toast.error("Selecione um número Meta")
            return
        }
        setSubmitting(true)
        try {
            const res = await fetch("/api/admin/meta-templates", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    nome: form.nome.trim(),
                    categoria: form.categoria || null,
                    status: form.status,
                    automacoes: [selectedPhone.canal_tipo],
                    phone_number_ids: [selectedPhone.phone_number_id],
                    waba_ids: [selectedPhone.waba_id],
                    corpo_texto: form.corpo_texto.trim() || null,
                    observacoes: form.observacoes.trim() || null,
                    ativo: form.ativo,
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error ?? "Erro ao criar template")
            toast.success(`Template "${form.nome}" criado`)
            handleClose()
            await onCreated()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err))
        } finally {
            setSubmitting(false)
        }
    }

    function f(field: "nome" | "corpo_texto" | "observacoes") {
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
                        <Label htmlFor="tpl-nome">Nome do template (exato, como aprovado na Meta) <span className="text-destructive">*</span></Label>
                        <Input id="tpl-nome" placeholder="ex: institucional_transbordo_v1"
                            value={form.nome} onChange={f("nome")} className="font-mono text-sm" />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1.5">
                            <Label>Categoria</Label>
                            <Select value={form.categoria} onValueChange={v => setForm(p => ({ ...p, categoria: v }))}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {CATEGORIAS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                </SelectContent>
                            </Select>
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
                        <Label htmlFor="tpl-corpo">Corpo do texto <span className="text-muted-foreground text-xs">— use {"{{1}}"}, {"{{2}}"} para variáveis</span></Label>
                        <Textarea id="tpl-corpo" placeholder={"Olá {{1}}! ..."}
                            value={form.corpo_texto} onChange={f("corpo_texto")} rows={5} className="font-mono text-sm" />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label>Telefone <span className="text-destructive">*</span></Label>
                        <Select value={form.phoneNumberId} onValueChange={v => setForm(p => ({ ...p, phoneNumberId: v }))}>
                            <SelectTrigger><SelectValue placeholder="Selecione o número Meta" /></SelectTrigger>
                            <SelectContent>
                                {phoneNumbers.map(p => (
                                    <SelectItem key={p.phone_number_id} value={p.phone_number_id}>
                                        {p.display_name} — {p.phone_number_id}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div className="flex flex-col gap-1.5">
                            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Automação</Label>
                            <Input readOnly value={selectedPhone?.canal_tipo ?? ""} className="text-sm text-muted-foreground cursor-not-allowed" />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Agente</Label>
                            <Input readOnly value={selectedPhone?.agente_tipo ?? ""} className="text-sm text-muted-foreground cursor-not-allowed" />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <Label className="text-xs uppercase tracking-wide text-muted-foreground">WABA</Label>
                            <Input readOnly value={selectedPhone?.waba_id ?? ""} className="font-mono text-xs text-muted-foreground cursor-not-allowed" />
                        </div>
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <Label htmlFor="tpl-obs">Observações</Label>
                        <Textarea id="tpl-obs" placeholder="Contexto, histórico de aprovação..."
                            value={form.observacoes} onChange={f("observacoes")} rows={2} />
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
