"use client"

import { useState, useEffect, useCallback } from "react"
import {
    Phone, Plus, Save, X, ArrowLeft, Loader2, Hash, Building2, Trash2,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
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
import { unidadesCuca } from "@/lib/constants"

// ─── Constantes ────────────────────────────────────────────────────────────────

const AGENTES_META = ["Empregabilidade", "Institucional", "maria", "sofia", "ana"] as const
const CANAL_TIPOS_META = ["Empregabilidade", "Institucional", "Divulgação", "Ouvidoria", "Acesso"] as const

type AgenteMetaTipo = typeof AGENTES_META[number]
type CanalMetaTipo = typeof CANAL_TIPOS_META[number]

type MetaPhoneNumber = {
    phone_number_id: string
    waba_id: string
    display_name: string
    agente_tipo: AgenteMetaTipo
    canal_tipo: CanalMetaTipo
    unidade_cuca: string | null
    ativo: boolean
}

type EditState = {
    phone_number_id: string
    waba_id: string
    agente_tipo: AgenteMetaTipo
    canal_tipo: CanalMetaTipo
    display_name: string
    unidade_cuca: string | null
    ativo: boolean
}

// Formato real de phone_number_id/waba_id na Meta Graph API: string numérica, 15-17 dígitos
const META_ID_REGEX = /^\d{15,17}$/

const CANAL_BADGE_COLORS: Record<string, string> = {
    "Empregabilidade": "bg-blue-500/10 text-blue-600 border-blue-200",
    "Institucional":   "bg-purple-500/10 text-purple-600 border-purple-200",
    "Divulgação":      "bg-orange-500/10 text-orange-600 border-orange-200",
    "Ouvidoria":       "bg-red-500/10 text-red-600 border-red-200",
    "Acesso":          "bg-green-500/10 text-green-600 border-green-200",
}

// ─── Componente principal ──────────────────────────────────────────────────────

export default function MetaNumerosPage() {
    const [numeros, setNumeros] = useState<MetaPhoneNumber[]>([])
    const [loading, setLoading] = useState(true)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [editState, setEditState] = useState<EditState | null>(null)
    const [saving, setSaving] = useState(false)
    const [showModal, setShowModal] = useState(false)
    const [confirmCritical, setConfirmCritical] = useState(false)
    const [deactivating, setDeactivating] = useState<string | null>(null)
    const [confirmDeactivate, setConfirmDeactivate] = useState<MetaPhoneNumber | null>(null)

    const fetchNumeros = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch("/api/admin/meta-phone-numbers")
            if (!res.ok) throw new Error(await res.text())
            setNumeros(await res.json())
        } catch (err: any) {
            toast.error("Erro ao carregar números: " + err.message)
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { fetchNumeros() }, [fetchNumeros])

    function startEdit(row: MetaPhoneNumber) {
        setEditingId(row.phone_number_id)
        setEditState({
            phone_number_id: row.phone_number_id,
            waba_id: row.waba_id,
            agente_tipo: row.agente_tipo,
            canal_tipo: row.canal_tipo,
            display_name: row.display_name,
            unidade_cuca: row.unidade_cuca,
            ativo: row.ativo,
        })
        setConfirmCritical(false)
    }

    function cancelEdit() {
        setEditingId(null)
        setEditState(null)
        setConfirmCritical(false)
    }

    function criticalFieldsChanged(): boolean {
        if (!editState || !editingId) return false
        return editState.phone_number_id !== editingId ||
            editState.waba_id !== numeros.find(n => n.phone_number_id === editingId)?.waba_id
    }

    function requestSave() {
        if (!editState) return
        if (!META_ID_REGEX.test(editState.phone_number_id)) {
            toast.error("phone_number_id inválido — deve ser numérico com 15 a 17 dígitos")
            return
        }
        if (!META_ID_REGEX.test(editState.waba_id)) {
            toast.error("waba_id inválido — deve ser numérico com 15 a 17 dígitos")
            return
        }
        if (criticalFieldsChanged()) {
            // Modal de confirmação explícita antes de mudar phone_number_id/waba_id (S-WM-16 Task 3)
            setConfirmCritical(true)
            return
        }
        saveEdit()
    }

    async function saveEdit() {
        if (!editState || !editingId) return
        setSaving(true)
        try {
            const res = await fetch(`/api/admin/meta-phone-numbers/${encodeURIComponent(editingId)}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    phone_number_id: editState.phone_number_id,
                    waba_id: editState.waba_id,
                    agente_tipo: editState.agente_tipo,
                    canal_tipo: editState.canal_tipo,
                    display_name: editState.display_name,
                    unidade_cuca: editState.unidade_cuca || null,
                    ativo: editState.ativo,
                }),
            })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error ?? "Erro ao salvar")
            }
            toast.success("Mapeamento atualizado com sucesso")
            setEditingId(null)
            setEditState(null)
            setConfirmCritical(false)
            await fetchNumeros()
        } catch (err: any) {
            toast.error(err.message)
        } finally {
            setSaving(false)
        }
    }

    async function confirmarDeactivate() {
        if (!confirmDeactivate) return
        setDeactivating(confirmDeactivate.phone_number_id)
        try {
            const res = await fetch(`/api/admin/meta-phone-numbers/${encodeURIComponent(confirmDeactivate.phone_number_id)}`, {
                method: "DELETE",
            })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error ?? "Erro ao desativar")
            }
            toast.success(`"${confirmDeactivate.display_name}" desativado`)
            setConfirmDeactivate(null)
            await fetchNumeros()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err))
        } finally {
            setDeactivating(null)
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
                    <Phone className="h-5 w-5 text-primary" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Números WhatsApp (Meta)</h1>
                    <p className="text-sm text-muted-foreground">
                        Mapeamento <code className="text-xs">phone_number_id → agente_tipo</code> — fonte de verdade do worker
                    </p>
                </div>
                <Button
                    className="ml-auto gap-2"
                    onClick={() => setShowModal(true)}
                    disabled={loading}
                >
                    <Plus className="h-4 w-4" />
                    Adicionar Número
                </Button>
            </div>

            {/* Tabela */}
            <Card>
                <CardHeader className="pb-3">
                    <CardTitle className="text-base">Registros ativos</CardTitle>
                    <CardDescription>
                        Clique em uma linha para editar <code>agente_tipo</code>, <code>canal_tipo</code> e <code>ativo</code>.
                        Alterações são aplicadas imediatamente ao worker sem restart.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex h-32 items-center justify-center">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : numeros.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                            Nenhum número cadastrado. Clique em "+ Adicionar Número".
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Nome</TableHead>
                                    <TableHead>Phone Number ID</TableHead>
                                    <TableHead>Agente</TableHead>
                                    <TableHead>Canal</TableHead>
                                    <TableHead>WABA ID</TableHead>
                                    <TableHead>Ativo</TableHead>
                                    <TableHead className="w-24" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {numeros.map((row) => {
                                    const isEditing = editingId === row.phone_number_id
                                    const es = isEditing ? editState! : null

                                    return (
                                        <TableRow
                                            key={row.phone_number_id}
                                            className={isEditing ? "bg-muted/50" : "cursor-pointer hover:bg-muted/30"}
                                            onClick={() => !isEditing && startEdit(row)}
                                        >
                                            {/* display_name */}
                                            <TableCell className="font-medium">
                                                {isEditing ? (
                                                    <Input
                                                        className="h-8 text-sm"
                                                        value={es!.display_name}
                                                        onChange={(e) => setEditState(s => s ? { ...s, display_name: e.target.value } : s)}
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                ) : (
                                                    row.display_name
                                                )}
                                            </TableCell>

                                            {/* phone_number_id — editável (S-WM-16 Task 3, exige confirmação explícita ao salvar) */}
                                            <TableCell>
                                                {isEditing ? (
                                                    <Input
                                                        className="h-8 w-40 text-xs font-mono"
                                                        value={es!.phone_number_id}
                                                        onChange={(e) => setEditState(s => s ? { ...s, phone_number_id: e.target.value.trim() } : s)}
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                ) : (
                                                    <code className="text-xs text-muted-foreground">{row.phone_number_id}</code>
                                                )}
                                            </TableCell>

                                            {/* agente_tipo */}
                                            <TableCell>
                                                {isEditing ? (
                                                    <Select
                                                        value={es!.agente_tipo}
                                                        onValueChange={(v) => setEditState(s => s ? { ...s, agente_tipo: v as AgenteMetaTipo } : s)}
                                                    >
                                                        <SelectTrigger className="h-8 w-40 text-sm" onClick={(e) => e.stopPropagation()}>
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {AGENTES_META.map(a => (
                                                                <SelectItem key={a} value={a}>{a}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                ) : (
                                                    <Badge variant="outline" className="text-xs">{row.agente_tipo}</Badge>
                                                )}
                                            </TableCell>

                                            {/* canal_tipo */}
                                            <TableCell>
                                                {isEditing ? (
                                                    <Select
                                                        value={es!.canal_tipo}
                                                        onValueChange={(v) => setEditState(s => s ? { ...s, canal_tipo: v as CanalMetaTipo } : s)}
                                                    >
                                                        <SelectTrigger className="h-8 w-36 text-sm" onClick={(e) => e.stopPropagation()}>
                                                            <SelectValue />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            {CANAL_TIPOS_META.map(c => (
                                                                <SelectItem key={c} value={c}>{c}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                ) : (
                                                    <Badge
                                                        variant="outline"
                                                        className={`text-xs ${CANAL_BADGE_COLORS[row.canal_tipo] ?? ""}`}
                                                    >
                                                        {row.canal_tipo}
                                                    </Badge>
                                                )}
                                            </TableCell>

                                            {/* waba_id — editável (S-WM-16 Task 3, exige confirmação explícita ao salvar) */}
                                            <TableCell>
                                                {isEditing ? (
                                                    <Input
                                                        className="h-8 w-40 text-xs font-mono"
                                                        value={es!.waba_id}
                                                        onChange={(e) => setEditState(s => s ? { ...s, waba_id: e.target.value.trim() } : s)}
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                ) : (
                                                    <code className="text-xs text-muted-foreground">{row.waba_id}</code>
                                                )}
                                            </TableCell>

                                            {/* ativo */}
                                            <TableCell>
                                                {isEditing ? (
                                                    <Switch
                                                        checked={es!.ativo}
                                                        onCheckedChange={(v) => setEditState(s => s ? { ...s, ativo: v } : s)}
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                ) : (
                                                    <Badge variant={row.ativo ? "default" : "secondary"} className="text-xs">
                                                        {row.ativo ? "Ativo" : "Inativo"}
                                                    </Badge>
                                                )}
                                            </TableCell>

                                            {/* Ações */}
                                            <TableCell onClick={(e) => e.stopPropagation()}>
                                                {isEditing ? (
                                                    <div className="flex gap-1">
                                                        <Button
                                                            size="sm"
                                                            className="h-7 gap-1 px-2 text-xs"
                                                            onClick={requestSave}
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
                                                        onClick={() => setConfirmDeactivate(row)}
                                                        title="Desativar (soft delete)"
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

            {/* Modal: Adicionar Número */}
            <AddNumberModal
                open={showModal}
                onClose={() => setShowModal(false)}
                onCreated={fetchNumeros}
            />

            {/* Modal: confirmação de troca de phone_number_id/waba_id (S-WM-16 Task 3) */}
            <Dialog open={confirmCritical} onOpenChange={(v) => { if (!v) setConfirmCritical(false) }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Tem certeza?</DialogTitle>
                        <DialogDescription>
                            Isso muda para qual número as mensagens desta automação serão enviadas/recebidas.
                            phone_number_id: <code className="text-xs">{editState?.phone_number_id}</code>{" "}
                            waba_id: <code className="text-xs">{editState?.waba_id}</code>
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmCritical(false)} disabled={saving}>
                            Cancelar
                        </Button>
                        <Button
                            onClick={() => { setConfirmCritical(false); saveEdit() }}
                            disabled={saving}
                            className="gap-2"
                        >
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            Confirmar e salvar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Modal: confirmação de desativação (soft delete) */}
            <Dialog open={!!confirmDeactivate} onOpenChange={(v) => { if (!v) setConfirmDeactivate(null) }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Desativar número?</DialogTitle>
                        <DialogDescription>
                            &ldquo;{confirmDeactivate?.display_name}&rdquo; ({confirmDeactivate?.phone_number_id}) deixa de aparecer como ativo,
                            mas o histórico é preservado (soft delete — <code className="text-xs">ativo=false</code>).
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmDeactivate(null)} disabled={!!deactivating}>
                            Cancelar
                        </Button>
                        <Button variant="destructive" onClick={confirmarDeactivate} disabled={!!deactivating} className="gap-2">
                            {deactivating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            Desativar
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

// ─── Modal Adicionar Número ────────────────────────────────────────────────────

type AddNumberModalProps = {
    open: boolean
    onClose: () => void
    onCreated: () => Promise<void>
}

function AddNumberModal({ open, onClose, onCreated }: AddNumberModalProps) {
    const [form, setForm] = useState({
        phone_number_id: "",
        waba_id: "",
        display_name: "",
        agente_tipo: "Institucional" as AgenteMetaTipo,
        canal_tipo: "Institucional" as CanalMetaTipo,
        unidade_cuca: "" as string,
        ativo: true,
    })
    const [submitting, setSubmitting] = useState(false)

    function resetForm() {
        setForm({
            phone_number_id: "",
            waba_id: "",
            display_name: "",
            agente_tipo: "Institucional",
            canal_tipo: "Institucional",
            unidade_cuca: "",
            ativo: true,
        })
    }

    function handleClose() {
        resetForm()
        onClose()
    }

    async function handleSubmit() {
        if (!form.phone_number_id.trim() || !form.waba_id.trim() || !form.display_name.trim()) {
            toast.error("Phone Number ID, WABA ID e Nome são obrigatórios")
            return
        }
        setSubmitting(true)
        try {
            const res = await fetch("/api/admin/meta-phone-numbers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    ...form,
                    unidade_cuca: form.unidade_cuca || null,
                }),
            })
            const data = await res.json()
            if (!res.ok) {
                throw new Error(data.error ?? "Erro ao criar registro")
            }
            toast.success(`Número "${form.display_name}" cadastrado com sucesso`)
            handleClose()
            await onCreated()
        } catch (err: any) {
            toast.error(err.message)
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
            <DialogContent className="max-w-lg">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Hash className="h-4 w-4" />
                        Adicionar Número WhatsApp (Meta)
                    </DialogTitle>
                    <DialogDescription>
                        Cadastra um novo <code>phone_number_id</code> no mapeamento do worker.
                    </DialogDescription>
                </DialogHeader>

                <div className="flex flex-col gap-4 py-2">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="col-span-2 flex flex-col gap-1.5">
                            <Label htmlFor="phone_number_id">Phone Number ID <span className="text-destructive">*</span></Label>
                            <Input
                                id="phone_number_id"
                                placeholder="ex: 1233832826470497"
                                value={form.phone_number_id}
                                onChange={(e) => setForm(f => ({ ...f, phone_number_id: e.target.value.trim() }))}
                            />
                        </div>

                        <div className="col-span-2 flex flex-col gap-1.5">
                            <Label htmlFor="waba_id">WABA ID <span className="text-destructive">*</span></Label>
                            <Input
                                id="waba_id"
                                placeholder="ex: 27334860332820469"
                                value={form.waba_id}
                                onChange={(e) => setForm(f => ({ ...f, waba_id: e.target.value.trim() }))}
                            />
                        </div>

                        <div className="col-span-2 flex flex-col gap-1.5">
                            <Label htmlFor="display_name">Nome legível <span className="text-destructive">*</span></Label>
                            <Input
                                id="display_name"
                                placeholder="ex: CUCA Institucional"
                                value={form.display_name}
                                onChange={(e) => setForm(f => ({ ...f, display_name: e.target.value }))}
                            />
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <Label>Agente</Label>
                            <Select
                                value={form.agente_tipo}
                                onValueChange={(v) => setForm(f => ({ ...f, agente_tipo: v as AgenteMetaTipo }))}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {AGENTES_META.map(a => (
                                        <SelectItem key={a} value={a}>{a}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="flex flex-col gap-1.5">
                            <Label>Canal</Label>
                            <Select
                                value={form.canal_tipo}
                                onValueChange={(v) => setForm(f => ({ ...f, canal_tipo: v as CanalMetaTipo }))}
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {CANAL_TIPOS_META.map(c => (
                                        <SelectItem key={c} value={c}>{c}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="col-span-2 flex flex-col gap-1.5">
                            <Label className="flex items-center gap-1">
                                <Building2 className="h-3.5 w-3.5" />
                                Unidade CUCA <span className="text-muted-foreground text-xs">(opcional)</span>
                            </Label>
                            <Select
                                value={form.unidade_cuca || "__none__"}
                                onValueChange={(v) => setForm(f => ({ ...f, unidade_cuca: v === "__none__" ? "" : v }))}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Todas as unidades" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="__none__">Todas as unidades</SelectItem>
                                    {unidadesCuca.map(u => (
                                        <SelectItem key={u} value={u}>{u}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <div className="col-span-2 flex items-center gap-3">
                            <Switch
                                id="ativo"
                                checked={form.ativo}
                                onCheckedChange={(v) => setForm(f => ({ ...f, ativo: v }))}
                            />
                            <Label htmlFor="ativo" className="cursor-pointer">
                                Ativo imediatamente
                            </Label>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={handleClose} disabled={submitting}>
                        Cancelar
                    </Button>
                    <Button onClick={handleSubmit} disabled={submitting} className="gap-2">
                        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        Adicionar
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
