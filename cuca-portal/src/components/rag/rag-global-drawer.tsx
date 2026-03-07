"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/lib/auth/user-provider"
import {
    Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
    Dialog, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
    Globe, Plus, Zap, FileText, CheckCircle2,
    Clock, AlertCircle, Pencil, Trash2, ShieldAlert,
} from "lucide-react"
import toast from "react-hot-toast"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"

type Documento = {
    id: string
    titulo: string
    tipo: string
    conteudo: string
    metadados: Record<string, unknown> | null
    unidade_cuca: string | null
    ativo: boolean
    created_at: string
}

const TIPOS = ["Institucional", "Endereços", "Programas", "Horários", "Contatos", "FAQ", "Outro"]
const EMPTY_FORM = { titulo: "", tipo: "Institucional", conteudo: "", ativo: true }

const STATUS_CHUNK = (doc: Documento) => {
    const idx = doc.metadados?.indexado_em as string | null
    const chunks = doc.metadados?.total_chunks as number | null
    if (!idx) return { label: "Não indexado", color: "secondary" as const, icon: AlertCircle }
    return { label: `${chunks ?? "?"} chunks`, color: "default" as const, icon: CheckCircle2 }
}

interface RagGlobalDrawerProps {
    open: boolean
    onOpenChange: (open: boolean) => void
}

export default function RagGlobalDrawer({ open, onOpenChange }: RagGlobalDrawerProps) {
    const { isDeveloper, hasPermission } = useUser()
    const supabase = createClient()

    const [docs, setDocs] = useState<Documento[]>([])
    const [loading, setLoading] = useState(false)
    const [indexando, setIndexando] = useState<string | null>(null)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editing, setEditing] = useState<Documento | null>(null)
    const [form, setForm] = useState(EMPTY_FORM)

    const temPermissao = isDeveloper || hasPermission("programacao_rag_global", "read")

    useEffect(() => {
        if (open && temPermissao) fetchDocs()
    }, [open])

    const fetchDocs = async () => {
        setLoading(true)
        const { data, error } = await supabase
            .from("documentos_rag")
            .select("*")
            .is("unidade_cuca", null)
            .order("created_at", { ascending: false })
        if (error) toast.error("Erro ao carregar documentos")
        else setDocs(data || [])
        setLoading(false)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        const payload = {
            titulo: form.titulo,
            tipo: form.tipo,
            conteudo: form.conteudo,
            unidade_cuca: null,
            ativo: form.ativo,
            metadados: { source_type: "rede_cuca_global" },
        }
        if (editing) {
            const { error } = await supabase.from("documentos_rag").update(payload).eq("id", editing.id)
            if (error) toast.error("Erro ao atualizar")
            else { toast.success("Documento atualizado!"); fetchDocs(); closeDialog() }
        } else {
            const { error } = await supabase.from("documentos_rag").insert(payload)
            if (error) toast.error("Erro ao criar")
            else { toast.success("Documento criado!"); fetchDocs(); closeDialog() }
        }
    }

    const handleIndexar = async (doc: Documento) => {
        setIndexando(doc.id)
        try {
            const { data: { session } } = await supabase.auth.getSession()
            const res = await fetch(
                `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/processar-documento`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${session?.access_token}`,
                    },
                    body: JSON.stringify({
                        documento_id: doc.id,
                        source_type: "rede_cuca_global",
                        cuca_unit_id: null,
                    }),
                }
            )
            const result = await res.json()
            if (!res.ok) throw new Error(result.error)
            toast.success(`${result.total_chunks} chunks indexados no RAG Global!`)
            fetchDocs()
        } catch (err) {
            toast.error(`Erro ao indexar: ${err}`)
        } finally {
            setIndexando(null)
        }
    }

    const handleDelete = async (id: string) => {
        if (!confirm("Remover este documento da base de conhecimento global?")) return
        const { error } = await supabase.from("documentos_rag").delete().eq("id", id)
        if (error) toast.error("Erro ao deletar")
        else { toast.success("Documento removido"); fetchDocs() }
    }

    const handleEdit = (doc: Documento) => {
        setEditing(doc)
        setForm({ titulo: doc.titulo, tipo: doc.tipo, conteudo: doc.conteudo, ativo: doc.ativo })
        setDialogOpen(true)
    }

    const closeDialog = () => { setDialogOpen(false); setEditing(null); setForm(EMPTY_FORM) }
    const f = (k: string, v: string | boolean) => setForm(prev => ({ ...prev, [k]: v }))

    const totalChunks = docs.reduce((acc, d) => acc + ((d.metadados?.total_chunks as number) || 0), 0)
    const indexados = docs.filter(d => d.metadados?.indexado_em).length

    return (
        <>
            <Sheet open={open} onOpenChange={onOpenChange}>
                <SheetContent className="w-full sm:max-w-3xl overflow-y-auto">
                    <SheetHeader className="mb-4">
                        <div className="flex items-center gap-2">
                            <div className="p-2 rounded-lg bg-blue-100 border border-blue-200">
                                <Globe className="h-5 w-5 text-blue-600" />
                            </div>
                            <div>
                                <SheetTitle>Base de Conhecimento — Rede Geral</SheetTitle>
                                <SheetDescription>
                                    Documentos globais usados pela persona Divulgação e como fallback dos Institucionais.
                                </SheetDescription>
                            </div>
                        </div>
                    </SheetHeader>

                    {!temPermissao ? (
                        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                            <ShieldAlert className="h-12 w-12 text-slate-300" />
                            <p className="font-semibold text-slate-700">Acesso Restrito</p>
                            <p className="text-sm text-slate-500 max-w-sm">
                                Exclusivo do Gestor de Divulgação com permissão de Base de Conhecimento Global.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {/* Métricas */}
                            <div className="grid grid-cols-3 gap-3">
                                <Card>
                                    <CardHeader className="pb-1 pt-3 px-3">
                                        <CardTitle className="text-xs font-medium text-muted-foreground">Documentos</CardTitle>
                                    </CardHeader>
                                    <CardContent className="px-3 pb-3">
                                        <div className="text-xl font-bold">{docs.length}</div>
                                        <p className="text-xs text-muted-foreground">{docs.filter(d => d.ativo).length} ativos</p>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardHeader className="pb-1 pt-3 px-3">
                                        <CardTitle className="text-xs font-medium text-muted-foreground">Indexados</CardTitle>
                                    </CardHeader>
                                    <CardContent className="px-3 pb-3">
                                        <div className="text-xl font-bold text-green-600">{indexados}</div>
                                        <p className="text-xs text-muted-foreground">{docs.length - indexados} pendentes</p>
                                    </CardContent>
                                </Card>
                                <Card>
                                    <CardHeader className="pb-1 pt-3 px-3">
                                        <CardTitle className="text-xs font-medium text-muted-foreground">Chunks</CardTitle>
                                    </CardHeader>
                                    <CardContent className="px-3 pb-3">
                                        <div className="text-xl font-bold text-blue-600">{totalChunks}</div>
                                        <p className="text-xs text-muted-foreground">rede_cuca_global</p>
                                    </CardContent>
                                </Card>
                            </div>

                            {/* Botão novo */}
                            <div className="flex justify-end">
                                <Button
                                    size="sm"
                                    className="bg-blue-600 hover:bg-blue-700"
                                    onClick={() => { setEditing(null); setForm(EMPTY_FORM); setDialogOpen(true) }}
                                >
                                    <Plus className="mr-1.5 h-3.5 w-3.5" /> Novo Documento
                                </Button>
                            </div>

                            {/* Tabela */}
                            {loading ? (
                                <div className="text-center py-8 text-muted-foreground text-sm">Carregando...</div>
                            ) : docs.length === 0 ? (
                                <div className="text-center py-10 space-y-2">
                                    <Globe className="mx-auto h-10 w-10 text-muted-foreground/30" />
                                    <p className="text-sm text-muted-foreground">Nenhum documento global cadastrado</p>
                                </div>
                            ) : (
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead>Título</TableHead>
                                            <TableHead>Tipo</TableHead>
                                            <TableHead>Status RAG</TableHead>
                                            <TableHead className="text-right">Ações</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {docs.map((doc) => {
                                            const status = STATUS_CHUNK(doc)
                                            const Icon = status.icon
                                            return (
                                                <TableRow key={doc.id} className={!doc.ativo ? "opacity-50" : ""}>
                                                    <TableCell className="font-medium max-w-[180px] truncate text-sm">{doc.titulo}</TableCell>
                                                    <TableCell>
                                                        <Badge variant="outline" className="text-xs">{doc.tipo}</Badge>
                                                    </TableCell>
                                                    <TableCell>
                                                        <div className="flex items-center gap-1">
                                                            <Icon className={`h-3.5 w-3.5 ${status.color === "default" ? "text-green-600" : "text-yellow-600"}`} />
                                                            <span className="text-xs">{status.label}</span>
                                                        </div>
                                                    </TableCell>
                                                    <TableCell className="text-right">
                                                        <div className="flex items-center justify-end gap-1">
                                                            <Button
                                                                variant="outline" size="sm"
                                                                onClick={() => handleIndexar(doc)}
                                                                disabled={indexando === doc.id}
                                                            >
                                                                {indexando === doc.id
                                                                    ? <Clock className="h-3.5 w-3.5 animate-spin" />
                                                                    : <Zap className="h-3.5 w-3.5" />}
                                                            </Button>
                                                            <Button variant="ghost" size="sm" onClick={() => handleEdit(doc)}>
                                                                <Pencil className="h-3.5 w-3.5" />
                                                            </Button>
                                                            <Button variant="ghost" size="sm" className="text-red-600"
                                                                onClick={() => handleDelete(doc.id)}>
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </div>
                                                    </TableCell>
                                                </TableRow>
                                            )
                                        })}
                                    </TableBody>
                                </Table>
                            )}
                        </div>
                    )}
                </SheetContent>
            </Sheet>

            {/* Modal criar/editar — fora do Sheet para evitar sobreposição */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <form onSubmit={handleSubmit}>
                        <DialogHeader>
                            <DialogTitle>{editing ? "Editar Documento Global" : "Novo Documento Global"}</DialogTitle>
                            <DialogDescription>
                                Informações institucionais da Rede CUCA usadas pela IA para responder perguntas gerais.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-3 py-4">
                            <div className="grid gap-1">
                                <Label htmlFor="rag-titulo">Título *</Label>
                                <Input id="rag-titulo" value={form.titulo}
                                    onChange={e => f("titulo", e.target.value)}
                                    placeholder="Ex: Endereços das 5 Unidades CUCA" required />
                            </div>
                            <div className="grid gap-1">
                                <Label>Tipo *</Label>
                                <Select value={form.tipo} onValueChange={v => f("tipo", v)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {TIPOS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-1">
                                <Label htmlFor="rag-conteudo">Conteúdo *</Label>
                                <Textarea id="rag-conteudo" rows={12} value={form.conteudo}
                                    onChange={e => f("conteudo", e.target.value)}
                                    placeholder="Escreva as informações institucionais que a IA deve saber..."
                                    required />
                                <p className="text-xs text-muted-foreground">{form.conteudo.length} caracteres</p>
                            </div>
                            <div className="flex items-center justify-between">
                                <Label>Documento ativo</Label>
                                <Switch checked={form.ativo} onCheckedChange={v => f("ativo", v)} />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={closeDialog}>Cancelar</Button>
                            <Button type="submit" className="bg-blue-600 hover:bg-blue-700">
                                {editing ? "Atualizar" : "Criar"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </>
    )
}
