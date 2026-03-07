"use client"

import { useState, useEffect, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/lib/auth/user-provider"
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
    Clock, AlertCircle, Pencil, Trash2, ShieldAlert, Upload, FileUp,
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
    titulo: "",
    tipo: "Institucional",
    conteudo: "",
    ativo: true,
    modo: "texto" as "texto" | "pdf",
}

const STATUS_CHUNK = (doc: Documento) => {
    const idx = doc.metadados?.indexado_em as string | null
    const chunks = doc.metadados?.total_chunks as number | null
    if (!idx) return { label: "Não indexado", color: "secondary" as const, icon: AlertCircle }
    return { label: `${chunks ?? "?"} chunks`, color: "default" as const, icon: CheckCircle2 }
}

export default function RagGlobalPage() {
    const { isDeveloper, hasPermission } = useUser()

    const [docs, setDocs] = useState<Documento[]>([])
    const [loading, setLoading] = useState(true)
    const [semPermissao, setSemPermissao] = useState(false)
    const [indexando, setIndexando] = useState<string | null>(null)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editing, setEditing] = useState<Documento | null>(null)
    const [form, setForm] = useState(EMPTY_FORM)
    const [pdfFile, setPdfFile] = useState<File | null>(null)
    const [uploadandoPdf, setUploadandoPdf] = useState(false)
    const fileRef = useRef<HTMLInputElement>(null)
    const supabase = createClient()

    useEffect(() => {
        if (!isDeveloper && !hasPermission("programacao_rag_global", "read")) {
            setSemPermissao(true)
            return
        }
        fetchDocs()
    }, [isDeveloper])

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
        if (!form.titulo.trim()) { toast.error("Título obrigatório"); return }
        if (form.modo === "texto" && !form.conteudo.trim()) { toast.error("Conteúdo obrigatório"); return }
        if (form.modo === "pdf" && !editing && !pdfFile) { toast.error("Selecione um arquivo PDF"); return }

        setUploadandoPdf(true)
        try {
            let pdfUrl: string | null = null
            let metadados: Record<string, unknown> = { source_type: "rede_cuca_global" }

            // Upload do PDF se necessário
            if (form.modo === "pdf" && pdfFile) {
                const path = `global/${Date.now()}_${pdfFile.name.replace(/\s+/g, "_")}`
                const { error: uploadError } = await supabase.storage
                    .from("rag-documentos")
                    .upload(path, pdfFile, { contentType: "application/pdf", upsert: false })
                if (uploadError) throw new Error("Erro no upload: " + uploadError.message)

                const { data: urlData } = supabase.storage.from("rag-documentos").getPublicUrl(path)
                pdfUrl = urlData?.publicUrl ?? null
                metadados = { ...metadados, pdf_path: path, pdf_nome: pdfFile.name }
            }

            const payload = {
                titulo: form.titulo,
                tipo: form.tipo,
                conteudo: form.modo === "pdf" ? (pdfUrl ?? "") : form.conteudo,
                unidade_cuca: null,
                ativo: form.ativo,
                metadados: editing
                    ? { ...(editing.metadados ?? {}), source_type: "rede_cuca_global", ...(pdfUrl ? { pdf_path: metadados.pdf_path, pdf_nome: metadados.pdf_nome } : {}) }
                    : metadados,
            }

            if (editing) {
                const { error } = await supabase.from("documentos_rag").update(payload).eq("id", editing.id)
                if (error) throw error
                toast.success("Documento atualizado!")
            } else {
                const { error } = await supabase.from("documentos_rag").insert(payload)
                if (error) throw error
                toast.success("Documento criado! Clique em Indexar para processar no RAG.")
            }
            fetchDocs()
            closeDialog()
        } catch (err: any) {
            toast.error(err.message ?? "Erro ao salvar")
        } finally {
            setUploadandoPdf(false)
        }
    }

    const handleIndexar = async (doc: Documento) => {
        setIndexando(doc.id)
        try {
            const { data: { session } } = await supabase.auth.getSession()
            const pdfPath = doc.metadados?.pdf_path as string | null

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
                        ...(pdfPath && { pdf_path: pdfPath }),
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

    const handleDelete = async (doc: Documento) => {
        if (!confirm("Remover este documento da base de conhecimento global?")) return
        // Remover PDF do storage se existir
        const pdfPath = doc.metadados?.pdf_path as string | null
        if (pdfPath) {
            await supabase.storage.from("rag-documentos").remove([pdfPath])
        }
        const { error } = await supabase.from("documentos_rag").delete().eq("id", doc.id)
        if (error) toast.error("Erro ao deletar")
        else { toast.success("Documento removido"); fetchDocs() }
    }

    const handleEdit = (doc: Documento) => {
        const temPdf = !!(doc.metadados?.pdf_path)
        setEditing(doc)
        setForm({
            titulo: doc.titulo,
            tipo: doc.tipo,
            conteudo: doc.conteudo,
            ativo: doc.ativo,
            modo: temPdf ? "pdf" : "texto",
        })
        setPdfFile(null)
        setDialogOpen(true)
    }

    const closeDialog = () => {
        setDialogOpen(false)
        setEditing(null)
        setForm(EMPTY_FORM)
        setPdfFile(null)
    }
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
                            Documentos globais sobre a Rede CUCA. Usados pela persona Divulgação e como fallback dos Institucionais.
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
                    sem filtro de unidade. Suporte a texto livre ou upload de PDF (até 50 MB).
                    Após criar, clique em <strong>Indexar</strong> para processar no RAG.
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
                            <p className="text-xs text-muted-foreground">Adicione texto livre ou faça upload de um PDF com informações da Rede CUCA</p>
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
                                    <TableHead>Formato</TableHead>
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
                                    const temPdf = !!(doc.metadados?.pdf_path)
                                    return (
                                        <TableRow key={doc.id} className={!doc.ativo ? "opacity-50" : ""}>
                                            <TableCell className="font-medium max-w-xs truncate">{doc.titulo}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className="text-xs">{doc.tipo}</Badge>
                                            </TableCell>
                                            <TableCell>
                                                {temPdf ? (
                                                    <div className="flex items-center gap-1 text-xs text-red-700">
                                                        <FileUp className="h-3.5 w-3.5" />
                                                        PDF
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                                        <FileText className="h-3.5 w-3.5" />
                                                        Texto
                                                    </div>
                                                )}
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
                                                        onClick={() => handleDelete(doc)}>
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
            <Dialog open={dialogOpen} onOpenChange={open => { if (!open) closeDialog() }}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    <form onSubmit={handleSubmit}>
                        <DialogHeader>
                            <DialogTitle>{editing ? "Editar Documento Global" : "Novo Documento Global"}</DialogTitle>
                            <DialogDescription>
                                Adicione informações institucionais da Rede CUCA via texto livre ou upload de PDF.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="grid gap-4 py-4">
                            {/* Título */}
                            <div className="grid gap-1">
                                <Label htmlFor="titulo">Título *</Label>
                                <Input id="titulo" value={form.titulo}
                                    onChange={e => f("titulo", e.target.value)}
                                    placeholder="Ex: Endereços das 5 Unidades CUCA" required />
                            </div>

                            {/* Tipo */}
                            <div className="grid gap-1">
                                <Label>Tipo *</Label>
                                <Select value={form.tipo} onValueChange={v => f("tipo", v)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {TIPOS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Seletor de modo */}
                            <div className="grid gap-2">
                                <Label>Formato do conteúdo</Label>
                                <div className="flex gap-2">
                                    <Button
                                        type="button"
                                        variant={form.modo === "texto" ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => { f("modo", "texto"); setPdfFile(null) }}
                                    >
                                        <FileText className="mr-1.5 h-3.5 w-3.5" />
                                        Texto livre
                                    </Button>
                                    <Button
                                        type="button"
                                        variant={form.modo === "pdf" ? "default" : "outline"}
                                        size="sm"
                                        onClick={() => f("modo", "pdf")}
                                    >
                                        <FileUp className="mr-1.5 h-3.5 w-3.5" />
                                        Upload de PDF
                                    </Button>
                                </div>
                            </div>

                            {/* Conteúdo: texto ou PDF */}
                            {form.modo === "texto" ? (
                                <div className="grid gap-1">
                                    <Label htmlFor="conteudo">Conteúdo *</Label>
                                    <Textarea id="conteudo" rows={14} value={form.conteudo}
                                        onChange={e => f("conteudo", e.target.value)}
                                        placeholder="Escreva as informações institucionais que a IA deve saber sobre a Rede CUCA..."
                                        required={form.modo === "texto"} />
                                    <p className="text-xs text-muted-foreground">{form.conteudo.length} caracteres</p>
                                </div>
                            ) : (
                                <div className="grid gap-2">
                                    <Label>Arquivo PDF *</Label>
                                    {editing && (editing.metadados?.pdf_nome as string | null) && !pdfFile && (
                                        <div className="flex items-center gap-2 p-2 rounded-lg bg-muted text-sm">
                                            <FileUp className="h-4 w-4 text-red-600 shrink-0" />
                                            <span className="truncate">{editing.metadados?.pdf_nome as string}</span>
                                            <Badge variant="secondary" className="text-xs shrink-0">atual</Badge>
                                        </div>
                                    )}
                                    <div
                                        className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center cursor-pointer hover:border-primary/40 hover:bg-muted/30 transition-colors"
                                        onClick={() => fileRef.current?.click()}
                                    >
                                        {pdfFile ? (
                                            <div className="flex flex-col items-center gap-2">
                                                <FileUp className="h-8 w-8 text-red-600" />
                                                <p className="font-medium text-sm">{pdfFile.name}</p>
                                                <p className="text-xs text-muted-foreground">
                                                    {(pdfFile.size / 1024 / 1024).toFixed(2)} MB
                                                </p>
                                                <Button type="button" variant="ghost" size="sm"
                                                    onClick={e => { e.stopPropagation(); setPdfFile(null) }}>
                                                    Trocar arquivo
                                                </Button>
                                            </div>
                                        ) : (
                                            <div className="flex flex-col items-center gap-2">
                                                <Upload className="h-8 w-8 text-muted-foreground/50" />
                                                <p className="text-sm text-muted-foreground">
                                                    Clique para selecionar um PDF
                                                </p>
                                                <p className="text-xs text-muted-foreground">Até 50 MB</p>
                                            </div>
                                        )}
                                    </div>
                                    <input
                                        ref={fileRef}
                                        type="file"
                                        accept="application/pdf"
                                        className="hidden"
                                        onChange={e => setPdfFile(e.target.files?.[0] ?? null)}
                                    />
                                </div>
                            )}

                            {/* Ativo */}
                            <div className="flex items-center justify-between">
                                <Label htmlFor="ativo">Documento ativo</Label>
                                <Switch id="ativo" checked={form.ativo} onCheckedChange={v => f("ativo", v)} />
                            </div>
                        </div>

                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={closeDialog}>Cancelar</Button>
                            <Button type="submit" className="bg-blue-600 hover:bg-blue-700" disabled={uploadandoPdf}>
                                {uploadandoPdf
                                    ? <><Clock className="mr-2 h-4 w-4 animate-spin" />Enviando...</>
                                    : editing ? "Atualizar" : "Criar"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
