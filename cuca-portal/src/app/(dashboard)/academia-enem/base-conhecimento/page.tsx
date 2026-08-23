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
    GraduationCap, Plus, Zap, FileText, CheckCircle2,
    Clock, AlertCircle, Pencil, Trash2, ShieldAlert, Upload, FileUp,
} from "lucide-react"
import toast from "react-hot-toast"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"

// S-AE-10 (reconstrução, 2026-08-23): a base de RAG da Academia Enem vive numa tabela própria
// (`ae_documentos_rag`), nunca em `documentos_rag` (compartilhada) — isolamento é da tabela em
// si, sem precisar de um discriminador `source_type`.

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

const TIPOS = ["Enem", "Inscrição", "Cronograma", "Locais de Prova", "Documentos", "FAQ", "Outro"]

const EMPTY_FORM = {
    titulo: "",
    tipo: "Enem",
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

export default function AcademiaEnemRagPage() {
    const { isDeveloper, hasPermission, loading: authLoading } = useUser()

    // DoD transversal S-AE-01: leitura protege a rota; create/update/delete escondem os controles.
    const canRead = isDeveloper || hasPermission("ae_rag", "read")
    const canCreate = isDeveloper || hasPermission("ae_rag", "create")
    const canUpdate = isDeveloper || hasPermission("ae_rag", "update")
    const canDelete = isDeveloper || hasPermission("ae_rag", "delete")
    const canIndex = canCreate || canUpdate

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
        // Aguarda o perfil/permissões resolverem antes de decidir acesso (evita flash de "Acesso Restrito").
        if (authLoading) return
        if (!canRead) {
            setSemPermissao(true)
            return
        }
        setSemPermissao(false)
        fetchDocs()
    }, [authLoading, canRead])

    const fetchDocs = async () => {
        setLoading(true)
        // Tabela EXCLUSIVA da Academia Enem (S-AE-10, reconstrução) — sem filtro de source_type,
        // a isolação vem da tabela em si, não mais de um valor de metadados compartilhado.
        const { data, error } = await supabase
            .from("ae_documentos_rag")
            .select("*")
            .order("created_at", { ascending: false })
        if (error) toast.error("Erro ao carregar documentos")
        else setDocs(data || [])
        setLoading(false)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (editing ? !canUpdate : !canCreate) { toast.error("Sem permissão"); return }
        if (!form.titulo.trim()) { toast.error("Título obrigatório"); return }
        if (form.modo === "texto" && !form.conteudo.trim()) { toast.error("Conteúdo obrigatório"); return }
        if (form.modo === "pdf" && !editing && !pdfFile) { toast.error("Selecione um arquivo PDF"); return }

        setUploadandoPdf(true)
        try {
            let pdfUrl: string | null = null
            let metadados: Record<string, unknown> = {}

            // Upload do PDF se necessário
            if (form.modo === "pdf" && pdfFile) {
                const path = `academia-enem/${Date.now()}_${pdfFile.name.replace(/\s+/g, "_")}`
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
                ativo: form.ativo,
                metadados: editing
                    ? { ...(editing.metadados ?? {}), ...(pdfUrl ? { pdf_path: metadados.pdf_path, pdf_nome: metadados.pdf_nome } : {}) }
                    : metadados,
            }

            if (editing) {
                const { error } = await supabase.from("ae_documentos_rag").update(payload).eq("id", editing.id)
                if (error) throw error
                toast.success("Documento atualizado!")
            } else {
                const { error } = await supabase.from("ae_documentos_rag").insert(payload)
                if (error) throw error
                toast.success("Documento criado! Clique em Indexar para processar no RAG.")
            }
            fetchDocs()
            closeDialog()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Erro ao salvar")
        } finally {
            setUploadandoPdf(false)
        }
    }

    const handleIndexar = async (doc: Documento) => {
        if (!canIndex) { toast.error("Sem permissão"); return }
        setIndexando(doc.id)
        try {
            const { data: { session } } = await supabase.auth.getSession()
            const pdfPath = doc.metadados?.pdf_path as string | null

            // Edge Function EXCLUSIVA da Academia Enem — nunca a compartilhada processar-documento.
            const res = await fetch(
                `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/academia-enem-processar-documento`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${session?.access_token}`,
                    },
                    body: JSON.stringify({
                        documento_id: doc.id,
                        ...(pdfPath && { pdf_path: pdfPath }),
                    }),
                }
            )
            const result = await res.json()
            if (!res.ok) throw new Error(result.error)
            toast.success(`${result.total_chunks} chunks indexados no RAG da Academia Enem!`)
            fetchDocs()
        } catch (err) {
            toast.error(`Erro ao indexar: ${err}`)
        } finally {
            setIndexando(null)
        }
    }

    const handleDelete = async (doc: Documento) => {
        if (!canDelete) { toast.error("Sem permissão"); return }
        if (!confirm("Remover este documento da base de conhecimento da Academia Enem?")) return
        // Remover PDF do storage se existir
        const pdfPath = doc.metadados?.pdf_path as string | null
        if (pdfPath) {
            await supabase.storage.from("rag-documentos").remove([pdfPath])
        }
        const { error } = await supabase.from("ae_documentos_rag").delete().eq("id", doc.id)
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

    // Enquanto o perfil/permissões carregam, não decide acesso (evita flash de "Acesso Restrito").
    if (authLoading) {
        return (
            <div className="space-y-4 animate-pulse">
                <div className="h-9 w-80 bg-muted rounded" />
                <div className="grid gap-4 md:grid-cols-3">
                    <div className="h-24 bg-muted rounded" />
                    <div className="h-24 bg-muted rounded" />
                    <div className="h-24 bg-muted rounded" />
                </div>
                <div className="h-64 bg-muted rounded" />
            </div>
        )
    }

    if (semPermissao) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-12 gap-4 text-center">
                <ShieldAlert className="h-16 w-16 text-slate-300" />
                <h2 className="text-xl font-bold text-slate-700">Acesso Restrito</h2>
                <p className="text-slate-500 max-w-sm">Você não tem permissão para acessar a Base de Conhecimento da Academia Enem.</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20">
                        <GraduationCap className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Base de Conhecimento — Academia Enem</h1>
                        <p className="text-muted-foreground text-sm">
                            Documentos sobre o Enem usados pela automação da Academia Enem para responder dúvidas (RAG).
                        </p>
                    </div>
                </div>
                {canCreate && (
                    <Button
                        onClick={() => { setEditing(null); setForm(EMPTY_FORM); setDialogOpen(true) }}
                    >
                        <Plus className="mr-2 h-4 w-4" /> Novo Documento
                    </Button>
                )}
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
                        <CardTitle className="text-sm font-medium">Chunks da Academia Enem</CardTitle>
                        <GraduationCap className="h-4 w-4 text-primary" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-primary">{totalChunks}</div>
                        <p className="text-xs text-muted-foreground">tabela própria: ae_documentos_rag</p>
                    </CardContent>
                </Card>
            </div>

            {/* Info */}
            <div className="flex items-start gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 text-foreground text-sm">
                <GraduationCap className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
                <span>
                    Estes documentos ficam numa base RAG <strong>própria e isolada</strong> da Academia Enem
                    (nunca compartilhada com outros canais). Suporte a texto livre ou upload de PDF (até 50 MB).
                    Após criar, clique em <strong>Indexar</strong> para processar no RAG.
                </span>
            </div>

            {/* Tabela */}
            <Card>
                <CardHeader>
                    <CardTitle>Documentos da Academia Enem</CardTitle>
                    <CardDescription>Base de conhecimento restrita ao tema Enem, consumida pela automação do módulo</CardDescription>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="text-center py-8 text-muted-foreground">Carregando...</div>
                    ) : docs.length === 0 ? (
                        <div className="text-center py-12 space-y-2">
                            <GraduationCap className="mx-auto h-12 w-12 text-muted-foreground/40" />
                            <p className="text-muted-foreground">Nenhum documento cadastrado</p>
                            <p className="text-xs text-muted-foreground">Adicione texto livre ou faça upload de um PDF com informações sobre o Enem</p>
                            {canCreate && (
                                <Button variant="outline" onClick={() => setDialogOpen(true)}>
                                    <Plus className="mr-2 h-4 w-4" /> Adicionar primeiro documento
                                </Button>
                            )}
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
                                                    {canIndex && (
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
                                                    )}
                                                    {canUpdate && (
                                                        <Button variant="ghost" size="sm" onClick={() => handleEdit(doc)}>
                                                            <Pencil className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                    {canDelete && (
                                                        <Button variant="ghost" size="sm" className="text-red-600"
                                                            onClick={() => handleDelete(doc)}>
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    )}
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
                            <DialogTitle>{editing ? "Editar Documento" : "Novo Documento"}</DialogTitle>
                            <DialogDescription>
                                Adicione informações sobre o Enem via texto livre ou upload de PDF.
                            </DialogDescription>
                        </DialogHeader>

                        <div className="grid gap-4 py-4">
                            {/* Título */}
                            <div className="grid gap-1">
                                <Label htmlFor="titulo">Título *</Label>
                                <Input id="titulo" value={form.titulo}
                                    onChange={e => f("titulo", e.target.value)}
                                    placeholder="Ex: Datas e locais de prova do Enem 2026" required />
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
                                        placeholder="Escreva as informações sobre o Enem que a IA deve saber (inscrição, datas, locais, documentos, etc.)..."
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
                            <Button type="submit" disabled={uploadandoPdf}>
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
