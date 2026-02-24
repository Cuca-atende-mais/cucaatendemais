"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle, DialogDescription,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Search, Plus, Pencil, Tag } from "lucide-react"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import toast from "react-hot-toast"

type Categoria = {
    id: string
    nome: string
    descricao: string | null
    ativo: boolean
    created_at: string
}

export default function CategoriasPage() {
    const [categorias, setCategorias] = useState<Categoria[]>([])
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState("")
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editingCategoria, setEditingCategoria] = useState<Categoria | null>(null)
    const [formData, setFormData] = useState({
        nome: "",
        descricao: "",
        ativo: true,
    })
    const supabase = createClient()

    useEffect(() => {
        fetchCategorias()
    }, [])

    const fetchCategorias = async () => {
        setLoading(true)
        const { data, error } = await supabase
            .from("categorias_feedback")
            .select("*")
            .order("nome", { ascending: true })

        if (error) {
            console.error("Erro ao buscar categorias:", error)
            toast.error("Erro ao carregar categorias")
        } else {
            setCategorias(data || [])
        }
        setLoading(false)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (editingCategoria) {
            // Atualizar
            const { error } = await supabase
                .from("categorias_feedback")
                .update({
                    nome: formData.nome,
                    descricao: formData.descricao,
                    ativo: formData.ativo,
                })
                .eq("id", editingCategoria.id)

            if (error) {
                console.error("Erro ao atualizar categoria:", error)
                toast.error("Erro ao atualizar categoria")
            } else {
                toast.success("Categoria atualizada com sucesso!")
                fetchCategorias()
                handleCloseDialog()
            }
        } else {
            // Criar
            const { error } = await supabase
                .from("categorias_feedback")
                .insert({
                    nome: formData.nome,
                    descricao: formData.descricao,
                    ativo: formData.ativo,
                })

            if (error) {
                console.error("Erro ao criar categoria:", error)
                toast.error("Erro ao criar categoria")
            } else {
                toast.success("Categoria criada com sucesso!")
                fetchCategorias()
                handleCloseDialog()
            }
        }
    }

    const handleEdit = (categoria: Categoria) => {
        setEditingCategoria(categoria)
        setFormData({
            nome: categoria.nome,
            descricao: categoria.descricao || "",
            ativo: categoria.ativo,
        })
        setDialogOpen(true)
    }

    const handleCloseDialog = () => {
        setDialogOpen(false)
        setEditingCategoria(null)
        setFormData({
            nome: "",
            descricao: "",
            ativo: true,
        })
    }

    const filteredCategorias = categorias.filter((cat) =>
        cat.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
        cat.descricao?.toLowerCase().includes(searchTerm.toLowerCase())
    )

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Categorias</h1>
                    <p className="text-muted-foreground">
                        Gerencie as categorias de feedback e atividades
                    </p>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                        <Button className="bg-cuca-blue hover:bg-sky-800" onClick={() => setEditingCategoria(null)}>
                            <Plus className="mr-2 h-4 w-4" />
                            Nova Categoria
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <form onSubmit={handleSubmit}>
                            <DialogHeader>
                                <DialogTitle>
                                    {editingCategoria ? "Editar Categoria" : "Nova Categoria"}
                                </DialogTitle>
                                <DialogDescription>
                                    {editingCategoria
                                        ? "Atualize as informações da categoria"
                                        : "Preencha os dados para criar uma nova categoria"}
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="nome">Nome *</Label>
                                    <Input
                                        id="nome"
                                        value={formData.nome}
                                        onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                                        placeholder="Ex: Cultura, Esporte, Tecnologia"
                                        required
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="descricao">Descrição</Label>
                                    <Textarea
                                        id="descricao"
                                        value={formData.descricao}
                                        onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
                                        placeholder="Descreva o tipo de atividades desta categoria"
                                        rows={3}
                                    />
                                </div>
                                <div className="flex items-center justify-between">
                                    <Label htmlFor="ativo">Categoria ativa</Label>
                                    <Switch
                                        id="ativo"
                                        checked={formData.ativo}
                                        onCheckedChange={(checked) => setFormData({ ...formData, ativo: checked })}
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={handleCloseDialog}>
                                    Cancelar
                                </Button>
                                <Button type="submit" className="bg-cuca-blue hover:bg-sky-800">
                                    {editingCategoria ? "Atualizar" : "Criar"}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total de Categorias</CardTitle>
                        <Tag className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{categorias.length}</div>
                        <p className="text-xs text-muted-foreground">
                            {filteredCategorias.length} filtradas
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Ativas</CardTitle>
                        <Tag className="h-4 w-4 text-green-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {categorias.filter((c) => c.ativo).length}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Disponíveis para uso
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Inativas</CardTitle>
                        <Tag className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {categorias.filter((c) => !c.ativo).length}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Desativadas
                        </p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>Lista de Categorias</CardTitle>
                            <CardDescription>
                                {filteredCategorias.length} categoria(s) encontrada(s)
                            </CardDescription>
                        </div>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar categorias..."
                                className="pl-10 w-80"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="text-center py-8 text-muted-foreground">
                            Carregando categorias...
                        </div>
                    ) : filteredCategorias.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            Nenhuma categoria encontrada
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Nome</TableHead>
                                    <TableHead>Descrição</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Criado em</TableHead>
                                    <TableHead className="text-right">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredCategorias.map((categoria) => (
                                    <TableRow key={categoria.id}>
                                        <TableCell className="font-medium">{categoria.nome}</TableCell>
                                        <TableCell className="text-muted-foreground">
                                            {categoria.descricao || "-"}
                                        </TableCell>
                                        <TableCell>
                                            {categoria.ativo ? (
                                                <Badge variant="default" className="bg-green-600">
                                                    Ativa
                                                </Badge>
                                            ) : (
                                                <Badge variant="secondary">Inativa</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground text-sm">
                                            {format(new Date(categoria.created_at), "dd/MM/yyyy", {
                                                locale: ptBR,
                                            })}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleEdit(categoria)}
                                            >
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
