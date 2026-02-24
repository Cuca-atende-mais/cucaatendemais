"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    MapPin,
    Building2,
    Phone,
    User,
    Pencil,
    Plus,
    CheckCircle2,
    XCircle,
} from "lucide-react"
import toast from "react-hot-toast"

type Unidade = {
    id: string
    nome: string
    slug: string
    endereco: string | null
    bairro: string | null
    territorio: string | null
    latitude: number | null
    longitude: number | null
    telefone: string | null
    email: string | null
    responsavel: string | null
    ativo: boolean
    created_at: string
}

const CORES_UNIDADES: Record<string, { bg: string; border: string; badge: string }> = {
    barra: { bg: "bg-sky-50", border: "border-sky-400", badge: "bg-sky-100 text-sky-700" },
    mondubim: { bg: "bg-emerald-50", border: "border-emerald-400", badge: "bg-emerald-100 text-emerald-700" },
    jangurussu: { bg: "bg-violet-50", border: "border-violet-400", badge: "bg-violet-100 text-violet-700" },
    "jose-walter": { bg: "bg-orange-50", border: "border-orange-400", badge: "bg-orange-100 text-orange-700" },
    pici: { bg: "bg-rose-50", border: "border-rose-400", badge: "bg-rose-100 text-rose-700" },
}

const EMPTY_FORM = {
    nome: "", slug: "", endereco: "", bairro: "",
    territorio: "", telefone: "", email: "", responsavel: "", ativo: true,
}

export default function UnidadesPage() {
    const [unidades, setUnidades] = useState<Unidade[]>([])
    const [loading, setLoading] = useState(true)
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editing, setEditing] = useState<Unidade | null>(null)
    const [form, setForm] = useState(EMPTY_FORM)
    const supabase = createClient()

    useEffect(() => { fetchUnidades() }, [])

    const fetchUnidades = async () => {
        setLoading(true)
        const { data, error } = await supabase
            .from("unidades_cuca")
            .select("*")
            .order("nome", { ascending: true })
        if (error) toast.error("Erro ao carregar unidades")
        else setUnidades(data || [])
        setLoading(false)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        const payload = {
            nome: form.nome, slug: form.slug, endereco: form.endereco,
            bairro: form.bairro, territorio: form.territorio, telefone: form.telefone,
            email: form.email, responsavel: form.responsavel, ativo: form.ativo,
        }
        if (editing) {
            const { error } = await supabase.from("unidades_cuca").update(payload).eq("id", editing.id)
            if (error) toast.error("Erro ao atualizar unidade")
            else { toast.success("Unidade atualizada!"); fetchUnidades(); closeDialog() }
        } else {
            const { error } = await supabase.from("unidades_cuca").insert(payload)
            if (error) toast.error("Erro ao criar unidade")
            else { toast.success("Unidade criada!"); fetchUnidades(); closeDialog() }
        }
    }

    const handleEdit = (u: Unidade) => {
        setEditing(u)
        setForm({
            nome: u.nome, slug: u.slug, endereco: u.endereco || "",
            bairro: u.bairro || "", territorio: u.territorio || "",
            telefone: u.telefone || "", email: u.email || "",
            responsavel: u.responsavel || "", ativo: u.ativo,
        })
        setDialogOpen(true)
    }

    const closeDialog = () => {
        setDialogOpen(false); setEditing(null); setForm(EMPTY_FORM)
    }

    const f = (field: string, value: string | boolean) =>
        setForm((prev) => ({ ...prev, [field]: value }))

    return (
        <div className="space-y-6">
            {/* Cabeçalho */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Unidades CUCA</h1>
                    <p className="text-muted-foreground">
                        Gerencie as 5 unidades da Rede CUCA de Fortaleza
                    </p>
                </div>
                <Button
                    className="bg-cuca-blue hover:bg-sky-800"
                    onClick={() => { setEditing(null); setForm(EMPTY_FORM); setDialogOpen(true) }}
                >
                    <Plus className="mr-2 h-4 w-4" /> Nova Unidade
                </Button>
            </div>

            {/* Cards de resumo */}
            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Total de Unidades</CardTitle>
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{unidades.length}</div>
                        <p className="text-xs text-muted-foreground">Rede CUCA Fortaleza</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Ativas</CardTitle>
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{unidades.filter(u => u.ativo).length}</div>
                        <p className="text-xs text-muted-foreground">Em operação</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between pb-2">
                        <CardTitle className="text-sm font-medium">Inativas</CardTitle>
                        <XCircle className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{unidades.filter(u => !u.ativo).length}</div>
                        <p className="text-xs text-muted-foreground">Fora de operação</p>
                    </CardContent>
                </Card>
            </div>

            {/* Cards visuais das unidades */}
            {loading ? (
                <div className="text-center py-12 text-muted-foreground">Carregando unidades...</div>
            ) : (
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {unidades.map((u) => {
                        const cores = CORES_UNIDADES[u.slug] ?? { bg: "bg-gray-50", border: "border-gray-300", badge: "bg-gray-100 text-gray-700" }
                        return (
                            <Card key={u.id} className={`border-l-4 ${cores.border} ${cores.bg}`}>
                                <CardHeader className="pb-3">
                                    <div className="flex items-start justify-between">
                                        <div>
                                            <CardTitle className="text-lg">{u.nome}</CardTitle>
                                            <CardDescription className="mt-1">
                                                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${cores.badge}`}>
                                                    {u.territorio ?? "Território não definido"}
                                                </span>
                                            </CardDescription>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {u.ativo
                                                ? <Badge className="bg-green-600 text-white">Ativa</Badge>
                                                : <Badge variant="secondary">Inativa</Badge>}
                                            <Button variant="ghost" size="sm" onClick={() => handleEdit(u)}>
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                </CardHeader>
                                <CardContent className="space-y-2 text-sm">
                                    {u.endereco && (
                                        <div className="flex items-start gap-2 text-muted-foreground">
                                            <MapPin className="h-4 w-4 mt-0.5 shrink-0" />
                                            <span>{u.endereco}{u.bairro ? `, ${u.bairro}` : ""}</span>
                                        </div>
                                    )}
                                    {u.telefone && (
                                        <div className="flex items-center gap-2 text-muted-foreground">
                                            <Phone className="h-4 w-4 shrink-0" />
                                            <span>{u.telefone}</span>
                                        </div>
                                    )}
                                    {u.responsavel && (
                                        <div className="flex items-center gap-2 text-muted-foreground">
                                            <User className="h-4 w-4 shrink-0" />
                                            <span>{u.responsavel}</span>
                                        </div>
                                    )}
                                </CardContent>
                            </Card>
                        )
                    })}
                </div>
            )}

            {/* Tabela resumida */}
            {!loading && unidades.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle>Visão Geral</CardTitle>
                        <CardDescription>Resumo de todas as unidades</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Unidade</TableHead>
                                    <TableHead>Bairro</TableHead>
                                    <TableHead>Território</TableHead>
                                    <TableHead>Telefone</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {unidades.map((u) => (
                                    <TableRow key={u.id}>
                                        <TableCell className="font-medium">{u.nome}</TableCell>
                                        <TableCell className="text-muted-foreground">{u.bairro ?? "-"}</TableCell>
                                        <TableCell className="text-muted-foreground">{u.territorio ?? "-"}</TableCell>
                                        <TableCell className="text-muted-foreground">{u.telefone ?? "-"}</TableCell>
                                        <TableCell>
                                            {u.ativo
                                                ? <Badge className="bg-green-600 text-white">Ativa</Badge>
                                                : <Badge variant="secondary">Inativa</Badge>}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="sm" onClick={() => handleEdit(u)}>
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </CardContent>
                </Card>
            )}

            {/* Dialog criar/editar */}
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-lg">
                    <form onSubmit={handleSubmit}>
                        <DialogHeader>
                            <DialogTitle>{editing ? "Editar Unidade" : "Nova Unidade"}</DialogTitle>
                            <DialogDescription>
                                {editing ? "Atualize os dados da unidade" : "Preencha os dados da nova unidade"}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-3 py-4">
                            <div className="grid grid-cols-2 gap-3">
                                <div className="grid gap-1">
                                    <Label htmlFor="nome">Nome *</Label>
                                    <Input id="nome" value={form.nome} onChange={e => f("nome", e.target.value)} placeholder="CUCA Barra" required />
                                </div>
                                <div className="grid gap-1">
                                    <Label htmlFor="slug">Slug *</Label>
                                    <Input id="slug" value={form.slug} onChange={e => f("slug", e.target.value)} placeholder="barra" required />
                                </div>
                            </div>
                            <div className="grid gap-1">
                                <Label htmlFor="endereco">Endereço</Label>
                                <Input id="endereco" value={form.endereco} onChange={e => f("endereco", e.target.value)} placeholder="Av. Barão de Studart, 2929" />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="grid gap-1">
                                    <Label htmlFor="bairro">Bairro</Label>
                                    <Input id="bairro" value={form.bairro} onChange={e => f("bairro", e.target.value)} placeholder="Aldeota" />
                                </div>
                                <div className="grid gap-1">
                                    <Label htmlFor="territorio">Território</Label>
                                    <Input id="territorio" value={form.territorio} onChange={e => f("territorio", e.target.value)} placeholder="Regional II" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="grid gap-1">
                                    <Label htmlFor="telefone">Telefone</Label>
                                    <Input id="telefone" value={form.telefone} onChange={e => f("telefone", e.target.value)} placeholder="(85) 3101-2040" />
                                </div>
                                <div className="grid gap-1">
                                    <Label htmlFor="email">E-mail</Label>
                                    <Input id="email" type="email" value={form.email} onChange={e => f("email", e.target.value)} placeholder="barra@cuca.ce.gov.br" />
                                </div>
                            </div>
                            <div className="grid gap-1">
                                <Label htmlFor="responsavel">Responsável</Label>
                                <Input id="responsavel" value={form.responsavel} onChange={e => f("responsavel", e.target.value)} placeholder="Nome do gestor" />
                            </div>
                            <div className="flex items-center justify-between pt-1">
                                <Label htmlFor="ativo">Unidade ativa</Label>
                                <Switch id="ativo" checked={form.ativo} onCheckedChange={v => f("ativo", v)} />
                            </div>
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={closeDialog}>Cancelar</Button>
                            <Button type="submit" className="bg-cuca-blue hover:bg-sky-800">
                                {editing ? "Atualizar" : "Criar"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    )
}
