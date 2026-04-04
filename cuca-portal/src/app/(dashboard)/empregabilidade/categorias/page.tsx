"use client"

import { useState, useEffect, useCallback } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
    Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { ChevronDown, ChevronRight, Plus, Pencil, Trash2, Layers, Tag } from "lucide-react"
import toast from "react-hot-toast"

type Categoria = {
    id: string
    nome: string
    icone: string | null
    ordem: number
    ativo: boolean
    pai_id: string | null
    created_at: string
}

type Eixo = Categoria & { modalidades: Categoria[] }

const EMPTY_FORM = { nome: "", icone: "", ativo: true, pai_id: "" }

export default function CategoriasInteressePage() {
    const [eixos, setEixos] = useState<Eixo[]>([])
    const [loading, setLoading] = useState(true)
    const [expanded, setExpanded] = useState<Set<string>>(new Set())

    // Dialog de create/edit
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editing, setEditing] = useState<Categoria | null>(null)
    const [form, setForm] = useState(EMPTY_FORM)
    const [saving, setSaving] = useState(false)

    // AlertDialog de delete
    const [deleteTarget, setDeleteTarget] = useState<Categoria | null>(null)
    const [deleting, setDeleting] = useState(false)

    const fetchCategorias = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch("/api/empregabilidade/categorias")
            const data: Categoria[] = await res.json()

            const eixosMap = new Map<string, Eixo>()
            const modalidades: Categoria[] = []

            for (const cat of data) {
                if (cat.pai_id === null) {
                    eixosMap.set(cat.id, { ...cat, modalidades: [] })
                } else {
                    modalidades.push(cat)
                }
            }
            for (const mod of modalidades) {
                eixosMap.get(mod.pai_id!)?.modalidades.push(mod)
            }

            setEixos(Array.from(eixosMap.values()))
        } catch {
            toast.error("Erro ao carregar categorias")
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => { fetchCategorias() }, [fetchCategorias])

    const toggleExpand = (id: string) =>
        setExpanded(prev => {
            const next = new Set(prev)
            next.has(id) ? next.delete(id) : next.add(id)
            return next
        })

    const openCreate = (pai_id?: string) => {
        setEditing(null)
        setForm({ ...EMPTY_FORM, pai_id: pai_id ?? "" })
        setDialogOpen(true)
    }

    const openEdit = (cat: Categoria) => {
        setEditing(cat)
        setForm({ nome: cat.nome, icone: cat.icone ?? "", ativo: cat.ativo, pai_id: cat.pai_id ?? "" })
        setDialogOpen(true)
    }

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault()
        setSaving(true)
        try {
            const payload = {
                nome: form.nome,
                icone: form.icone || null,
                ativo: form.ativo,
                pai_id: form.pai_id || null,
            }
            const url = editing
                ? `/api/empregabilidade/categorias/${editing.id}`
                : "/api/empregabilidade/categorias"
            const res = await fetch(url, {
                method: editing ? "PUT" : "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            })
            const data = await res.json()
            if (!res.ok) {
                toast.error(data.error ?? "Erro ao salvar")
                return
            }
            toast.success(editing ? "Categoria atualizada!" : "Categoria criada!")
            setDialogOpen(false)
            fetchCategorias()
            // Abre o eixo pai automaticamente ao criar modalidade
            if (!editing && form.pai_id) {
                setExpanded(prev => new Set(prev).add(form.pai_id))
            }
        } finally {
            setSaving(false)
        }
    }

    const handleDelete = async () => {
        if (!deleteTarget) return
        setDeleting(true)
        try {
            const res = await fetch(`/api/empregabilidade/categorias/${deleteTarget.id}`, { method: "DELETE" })
            const data = await res.json()
            if (!res.ok) {
                toast.error(data.error ?? "Erro ao excluir")
                return
            }
            toast.success("Categoria excluída!")
            setDeleteTarget(null)
            fetchCategorias()
        } finally {
            setDeleting(false)
        }
    }

    const totalModalidades = eixos.reduce((acc, e) => acc + e.modalidades.length, 0)
    const totalAtivas = eixos.reduce((acc, e) => acc + e.modalidades.filter(m => m.ativo).length, 0)

    const isModalidade = form.pai_id !== ""

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Áreas de Interesse</h1>
                    <p className="text-muted-foreground text-sm mt-1">
                        Gerencie os eixos e modalidades que o bot e o portal usam para classificar candidatos e vagas.
                    </p>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                        <Button className="bg-cuca-blue hover:bg-sky-800" onClick={() => openCreate()}>
                            <Plus className="mr-2 h-4 w-4" /> Novo Eixo
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <form onSubmit={handleSave}>
                            <DialogHeader>
                                <DialogTitle>
                                    {editing
                                        ? `Editar — ${editing.nome}`
                                        : isModalidade ? "Nova Modalidade" : "Novo Eixo"}
                                </DialogTitle>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                {!editing && (
                                    <div className="grid gap-2">
                                        <Label>Tipo</Label>
                                        <Select
                                            value={form.pai_id === "" ? "eixo" : form.pai_id}
                                            onValueChange={v => setForm(f => ({ ...f, pai_id: v === "eixo" ? "" : v }))}
                                        >
                                            <SelectTrigger>
                                                <SelectValue placeholder="Selecione o tipo" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectItem value="eixo">Eixo (raiz)</SelectItem>
                                                {eixos.map(e => (
                                                    <SelectItem key={e.id} value={e.id}>
                                                        Modalidade de: {e.icone} {e.nome}
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                )}
                                <div className="grid gap-2">
                                    <Label htmlFor="nome">Nome *</Label>
                                    <Input
                                        id="nome"
                                        value={form.nome}
                                        onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                                        placeholder={isModalidade ? "Ex: Vendas, Caixa, Estoque" : "Ex: Comércio e Vendas"}
                                        required
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="icone">Ícone (emoji)</Label>
                                    <Input
                                        id="icone"
                                        value={form.icone}
                                        onChange={e => setForm(f => ({ ...f, icone: e.target.value }))}
                                        placeholder="Ex: 🛒"
                                        maxLength={4}
                                    />
                                </div>
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="ativo">Ativo</Label>
                                    <Switch
                                        id="ativo"
                                        checked={form.ativo}
                                        onCheckedChange={v => setForm(f => ({ ...f, ativo: v }))}
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                                    Cancelar
                                </Button>
                                <Button type="submit" className="bg-cuca-blue hover:bg-sky-800" disabled={saving}>
                                    {saving ? "Salvando…" : editing ? "Atualizar" : "Criar"}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>

            {/* Cards de resumo */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Eixos</CardTitle>
                        <Layers className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-bold">{eixos.length}</p>
                        <p className="text-xs text-muted-foreground">categorias raiz</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Modalidades</CardTitle>
                        <Tag className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-bold">{totalModalidades}</p>
                        <p className="text-xs text-muted-foreground">{totalAtivas} ativas</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Bot</CardTitle>
                        <Tag className="h-4 w-4 text-green-500" />
                    </CardHeader>
                    <CardContent>
                        <p className="text-2xl font-bold text-green-600">Dinâmico</p>
                        <p className="text-xs text-muted-foreground">lê em tempo real</p>
                    </CardContent>
                </Card>
            </div>

            {/* Árvore de Eixos */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">Eixos e Modalidades</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                    {loading ? (
                        <p className="text-muted-foreground text-sm py-4">Carregando…</p>
                    ) : eixos.length === 0 ? (
                        <p className="text-muted-foreground text-sm py-4">
                            Nenhum eixo cadastrado. Use o seed em <code>Developer › Seed Categorias</code> ou crie manualmente.
                        </p>
                    ) : (
                        eixos.map(eixo => (
                            <div key={eixo.id} className="border rounded-lg overflow-hidden">
                                {/* Linha do eixo */}
                                <div
                                    className="flex items-center gap-3 px-4 py-3 bg-muted/40 cursor-pointer hover:bg-muted/60 transition-colors"
                                    onClick={() => toggleExpand(eixo.id)}
                                >
                                    <button type="button" className="text-muted-foreground">
                                        {expanded.has(eixo.id)
                                            ? <ChevronDown className="h-4 w-4" />
                                            : <ChevronRight className="h-4 w-4" />}
                                    </button>
                                    <span className="text-lg">{eixo.icone ?? "📁"}</span>
                                    <span className="font-semibold flex-1">{eixo.nome}</span>
                                    <Badge variant={eixo.ativo ? "default" : "secondary"} className={eixo.ativo ? "bg-green-600" : ""}>
                                        {eixo.ativo ? "Ativo" : "Inativo"}
                                    </Badge>
                                    <span className="text-xs text-muted-foreground w-20 text-right">
                                        {eixo.modalidades.length} modalidade(s)
                                    </span>
                                    <div className="flex gap-1 ml-2" onClick={e => e.stopPropagation()}>
                                        <Button variant="ghost" size="sm" onClick={() => openCreate(eixo.id)} title="Adicionar modalidade">
                                            <Plus className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={() => openEdit(eixo)} title="Editar eixo">
                                            <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button
                                            variant="ghost" size="sm"
                                            className="text-destructive hover:text-destructive"
                                            onClick={() => setDeleteTarget(eixo)}
                                            title="Excluir eixo"
                                        >
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>

                                {/* Modalidades (expandível) */}
                                {expanded.has(eixo.id) && (
                                    <div className="divide-y">
                                        {eixo.modalidades.length === 0 ? (
                                            <p className="px-12 py-3 text-sm text-muted-foreground">
                                                Nenhuma modalidade. Clique em <Plus className="inline h-3 w-3" /> para adicionar.
                                            </p>
                                        ) : (
                                            eixo.modalidades.map(mod => (
                                                <div key={mod.id} className="flex items-center gap-3 px-12 py-2.5 hover:bg-muted/20 transition-colors">
                                                    <span className="text-sm flex-1 flex items-center gap-2">
                                                        {mod.icone && <span>{mod.icone}</span>}
                                                        {mod.nome}
                                                    </span>
                                                    <Badge variant={mod.ativo ? "outline" : "secondary"} className="text-xs">
                                                        {mod.ativo ? "Ativa" : "Inativa"}
                                                    </Badge>
                                                    <div className="flex gap-1">
                                                        <Button variant="ghost" size="sm" onClick={() => openEdit(mod)}>
                                                            <Pencil className="h-3.5 w-3.5" />
                                                        </Button>
                                                        <Button
                                                            variant="ghost" size="sm"
                                                            className="text-destructive hover:text-destructive"
                                                            onClick={() => setDeleteTarget(mod)}
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </div>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </CardContent>
            </Card>

            {/* AlertDialog de confirmação de delete */}
            <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Confirmar exclusão</AlertDialogTitle>
                        <AlertDialogDescription>
                            Deseja excluir <strong>{deleteTarget?.nome}</strong>?
                            {deleteTarget?.pai_id === null && (
                                <span className="block mt-2 text-destructive font-medium">
                                    Atenção: se este eixo tiver modalidades vinculadas, a exclusão será bloqueada.
                                </span>
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            className="bg-destructive hover:bg-destructive/90"
                            onClick={handleDelete}
                            disabled={deleting}
                        >
                            {deleting ? "Excluindo…" : "Excluir"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
