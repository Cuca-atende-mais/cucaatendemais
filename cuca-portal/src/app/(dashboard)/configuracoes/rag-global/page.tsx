"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/lib/auth/user-provider"
import { useRouter } from "next/navigation"
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

const EMPTY_FORM = {
    titulo: "", tipo: "Institucional", conteudo: "", ativo: true,
}

const STATUS_CHUNK = (doc: Documento) => {
    const idx = doc.metadados?.indexado_em as string | null
    const chunks = doc.metadados?.total_chunks as number | null
    if (!idx) return { label: "Não indexado", color: "secondary" as const, icon: AlertCircle }
    return { label: `${chunks ?? "?"} chunks`, color: "default" as const, icon: CheckCircle2 }
}

export default function RagGlobalPage() {
    const { isDeveloper, hasPermission } = useUser()
    const router = useRouter()

    const [docs, setDocs] = useState<Documento[]>([])
    const [loading, setLoading] = useState(true)
    const [semPermissao, setSemPermissao] = useState(false)
    const [indexando, setIndexando] = useState<string | null>(null)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editing, setEditing] = useState<Documento | null>(null)
    const [form, setForm] = useState(EMPTY_FORM)
    const supabase = createClient()

    useEffect(() => {
        // Verifica permissão: developer tem acesso total; outros precisam de programacao_rag_global
        if (!isDeveloper && !hasPermission("programacao_rag_global", "read")) {
            setSemPermissao(true)
            return
        }
        fetchDocs()
    }, [isDeveloper])

    const fetchDocs = async () => {
        setLoading(true)
        // Busca apenas documentos globais (sem unidade) — base da Rede CUCA
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
        // Documentos globais sempre têm unidade_cuca = null
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
            toast.success(`✅ ${result.total_chunks} chunks indexados no RAG Global!`)
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

    if (semPermissao) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-12 gap-4 text-center">
                <ShieldAlert className="h-16 w-16 text-slate-300" />
                <h2 className="text-xl font-bold text-slate-700">Acesso Restrito</h2>
                <p className="text-slate-500 max-w-sm">Este módulo é exclusivo do Gestor de Divulgação com permissão de Base de Conhecimento Global.</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-blue-100 border border-blue-200">
                        <Globe className="h-6 w-6 text-blue-600" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Base de Conhecimento — Rede Geral</h1>
                        <p className="text-muted-foreground text-sm">
                            Documentos globais sobre a Rede CUCA: endereços, missão, contatos, programas institucionais.
                            Usados pela persona Divulgação e como fallback dos Institucionais.
                        </p>
                    </div>
                </div>
                <Button
                    className="bg-blue-600 hover:bg-blue-700"
                    onClick={() => { setEditing(null); setForm(EMPTY_FORM); setDialogOpen(true) }}
                >
                    <Plus className="mr-2 h-4 w-4" /> Novo Documento
                </Button>
            </div>

            {/* Métricas */}
            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Total de Documentos</CardTitle>
                        <FileText className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{docs.length}</div>
                        <p className="text-xs text-muted-foreground">{docs.filter(d => d.ativo).length} ativos</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Indexados no RAG</CardTitle>
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">{indexados}</div>
                        <p className="text-xs text-muted-foreground">{docs.length - indexados} pendentes</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Chunks Globais</CardTitle>
                        <Globe className="h-4 w-4 text-blue-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-blue-600">{totalChunks}</div>
                        <p className="text-xs text-muted-foreground">source_type: rede_cuca_global</p>
                    </CardContent>
                </Card>
            </div>

            {/* Info */}
            <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm">
                <Globe className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                    Estes documentos são indexados com <code className="bg-blue-100 px-1 rounded text-xs">source_type = &apos;rede_cuca_global&apos;</code> e
                    sem filtro de unidade. A persona Divulgação (Maria Geral) os consulta para responder perguntas gerais
                    sobre a Rede CUCA. Os canais Institucionais os usam como fallback.
                </span>
            </div>

            {/* Tabela */}
            <Card>
                <CardHeader>
                    <CardTitle>Documentos Globais</CardTitle>
                    <CardDescription>Base de conhecimento compartilhada por todos os canais da Rede CUCA</CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="text-center py-8 text-muted-foreground">Carregando...</div>
                    ) : docs.length === 0 ? (
                        <div className="text-center py-12 space-y-2">
                            <Globe className="mx-auto h-12 w-12 text-muted-foreground/40" />
                            <p className="text-muted-foreground">Nenhum documento global cadastrado</p>
                            <p className="text-xs text-muted-foreground">Adicione endereços, missão, contatos e informações institucionais da Rede CUCA</p>
                            <Button variant="outline" onClick={() => setDialogOpen(true)}>
                                <Plus className="mr-2 h-4 w-4" /> Adicionar primeiro documento
                            </Button>
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Título</TableHead>
                                    <TableHead>Tipo</TableHead>
                                    <TableHead>Status RAG</TableHead>
                                    <TableHead>Indexado em</TableHead>
                                    <TableHead>Ativo</TableHead>
                                    <TableHead className="text-right">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {docs.map((doc) => {
                                    const status = STATUS_CHUNK(doc)
                                    const Icon = status.icon
                                    return (
                                        <TableRow key={doc.id} className={!doc.ativo ? "opacity-50" : ""}>
                                            <TableCell className="font-medium max-w-xs truncate">{doc.titulo}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="text-xs">{doc.tipo}</Badge>
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-1.5">
                                                    <Icon className={`h-4 w-4 ${status.color === "default" ? "text-green-600" : "text-yellow-600"}`} />
                                                    <span className="text-sm">{status.label}</span>
                                                </div>
                                            </TableCell>
                                            <TableCell className="text-muted-foreground text-sm">
                                                {doc.metadados?.indexado_em
                                                    ? format(new Date(doc.metadados.indexado_em as string), "dd/MM HH:mm", { locale: ptBR })
                                                    : "-"}
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={doc.ativo ? "default" : "secondary"} className={doc.ativo ? "bg-green-600 text-white" : ""}>
                                                    {doc.ativo ? "Ativo" : "Inativo"}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex items-center justify-end gap-1">
                                                    <Button
                                                        variant="outline" size="sm"
                                                        onClick={() => handleIndexar(doc)}
                                                        disabled={indexando === doc.id}
                                                    >
                                                        {indexando === doc.id
                                                            ? <Clock className="h-4 w-4 animate-spin" />
                                                            : <Zap className="h-4 w-4" />}
                                                        <span className="ml-1 text-xs">Indexar</span>
                                                    </Button>
                                                    <Button variant="ghost" size="sm" onClick={() => handleEdit(doc)}>
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    <Button variant="ghost" size="sm" className="text-red-600"
                                                        onClick={() => handleDelete(doc.id)}>
                                                        <Trash2 className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* Modal criar/editar */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <form onSubmit={handleSubmit}>
                        <DialogHeader>
                            <DialogTitle>{editing ? "Editar Documento Global" : "Novo Documento Global"}</DialogTitle>
                            <DialogDescription>
                                Adicione informações institucionais da Rede CUCA que a IA usará para responder perguntas gerais.
                                Ex: endereços, horários gerais, missão, programas, contatos dos gerentes.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-3 py-4">
                            <div className="grid gap-1">
                                <Label htmlFor="titulo">Título *</Label>
                                <Input id="titulo" value={form.titulo}
                                    onChange={e => f("titulo", e.target.value)}
                                    placeholder="Ex: Endereços das 5 Unidades CUCA" required />
                            </div>
                            <div className="grid gap-1">
                                <Label htmlFor="tipo">Tipo *</Label>
                                <Select value={form.tipo} onValueChange={v => f("tipo", v)}>
                                    <SelectTrigger id="tipo"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {TIPOS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-1">
                                <Label htmlFor="conteudo">Conteúdo *</Label>
                                <Textarea id="conteudo" rows={14} value={form.conteudo}
                                    onChange={e => f("conteudo", e.target.value)}
                                    placeholder="Escreva as informações institucionais que a IA deve saber sobre a Rede CUCA..."
                                    required />
                                <p className="text-xs text-muted-foreground">{form.conteudo.length} caracteres</p>
                            </div>
                            <div className="flex items-center justify-between">
                                <Label htmlFor="ativo">Documento ativo</Label>
                                <Switch id="ativo" checked={form.ativo} onCheckedChange={v => f("ativo", v)} />
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
        </div>
    )
}
