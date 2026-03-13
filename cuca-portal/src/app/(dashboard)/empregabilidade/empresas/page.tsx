"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Empresa } from "@/lib/types/database"
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
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Search, Plus, Pencil, Building2, Download, Upload } from "lucide-react"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import toast from "react-hot-toast"

export default function EmpresasPage() {
    const [empresas, setEmpresas] = useState<Empresa[]>([])
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState("")
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editingEmpresa, setEditingEmpresa] = useState<Empresa | null>(null)
    const [formData, setFormData] = useState({
        nome: "",
        cnpj: "",
        telefone: "",
        email: "",
        endereco: "",
        setor: "",
        porte: "",
        contato_responsavel: "",
        ativa: true,
    })
    const supabase = createClient()

    useEffect(() => {
        fetchEmpresas()
    }, [])

    const fetchEmpresas = async () => {
        setLoading(true)
        const { data, error } = await supabase
            .from("empresas")
            .select("*")
            .order("nome", { ascending: true })

        if (error) {
            console.error("Erro ao buscar empresas:", error)
            toast.error("Erro ao carregar empresas")
        } else {
            setEmpresas(data || [])
        }
        setLoading(false)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (editingEmpresa) {
            // Atualizar
            const { error } = await supabase
                .from("empresas")
                .update({
                    ...formData
                })
                .eq("id", editingEmpresa.id)

            if (error) {
                console.error("Erro ao atualizar empresa:", error)
                toast.error("Erro ao atualizar empresa")
            } else {
                toast.success("Empresa atualizada com sucesso!")
                fetchEmpresas()
                handleCloseDialog()
            }
        } else {
            // Criar
            const { error } = await supabase
                .from("empresas")
                .insert({
                    ...formData
                })

            if (error) {
                console.error("Erro ao criar empresa:", error)
                toast.error("Erro ao criar empresa. Verifique se o CNPJ já existe.")
            } else {
                toast.success("Empresa criada com sucesso!")
                fetchEmpresas()
                handleCloseDialog()
            }
        }
    }

    const handleEdit = (empresa: Empresa) => {
        setEditingEmpresa(empresa)
        setFormData({
            nome: empresa.nome,
            cnpj: empresa.cnpj || "",
            telefone: empresa.telefone || "",
            email: empresa.email || "",
            endereco: empresa.endereco || "",
            setor: empresa.setor || "",
            porte: empresa.porte || "",
            contato_responsavel: empresa.contato_responsavel || "",
            ativa: empresa.ativa,
        })
        setDialogOpen(true)
    }

    const handleCloseDialog = () => {
        setDialogOpen(false)
        setEditingEmpresa(null)
        setFormData({
            nome: "",
            cnpj: "",
            telefone: "",
            email: "",
            endereco: "",
            setor: "",
            porte: "",
            contato_responsavel: "",
            ativa: true,
        })
    }

    const exportarCSV = () => {
        const cabecalho = "nome,cnpj,telefone,email,endereco,setor,porte,contato_responsavel"
        const linhas = empresas.map((emp) =>
            [
                emp.nome,
                emp.cnpj || "",
                emp.telefone || "",
                emp.email || "",
                emp.endereco || "",
                emp.setor || "",
                emp.porte || "",
                emp.contato_responsavel || "",
            ]
                .map((v) => `"${String(v).replace(/"/g, '""')}"`)
                .join(",")
        )
        const csv = [cabecalho, ...linhas].join("\n")
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `empresas_cuca_${new Date().toISOString().slice(0, 10)}.csv`
        a.click()
        URL.revokeObjectURL(url)
        toast.success("CSV exportado com sucesso!")
    }

    const importarCSV = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        const texto = await file.text()
        const linhas = texto.trim().split("\n").slice(1) // pula cabeçalho
        if (linhas.length === 0) { toast.error("Arquivo vazio ou sem dados."); return }

        const registros = linhas.map((linha) => {
            const cols = linha.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, "").replace(/""/g, '"').trim())
            return {
                nome: cols[0] || "",
                cnpj: cols[1] || null,
                telefone: cols[2] || null,
                email: cols[3] || null,
                endereco: cols[4] || null,
                setor: cols[5] || null,
                porte: cols[6] || null,
                contato_responsavel: cols[7] || null,
                ativa: true,
            }
        }).filter((r) => r.nome)

        const { error } = await supabase.from("empresas").upsert(registros, { onConflict: "cnpj" })
        if (error) {
            console.error("Erro ao importar CSV:", error)
            toast.error("Erro na importação. Verifique o formato do arquivo.")
        } else {
            toast.success(`${registros.length} empresa(s) importada(s) com sucesso!`)
            fetchEmpresas()
        }
        e.target.value = ""
    }

    const filteredEmpresas = empresas.filter((emp) =>
        emp.nome.toLowerCase().includes(searchTerm.toLowerCase()) ||
        emp.cnpj?.includes(searchTerm) ||
        emp.setor?.toLowerCase().includes(searchTerm.toLowerCase())
    )

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Empresas Parceiras</h1>
                    <p className="text-muted-foreground">
                        Gerencie os convênios e cadastro de empresas mantenedoras de vagas.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={exportarCSV} disabled={empresas.length === 0}>
                        <Download className="mr-2 h-4 w-4" />
                        Exportar CSV
                    </Button>
                    <label>
                        <input type="file" accept=".csv" className="hidden" onChange={importarCSV} />
                        <Button variant="outline" size="sm" asChild>
                            <span className="cursor-pointer">
                                <Upload className="mr-2 h-4 w-4" />
                                Importar CSV
                            </span>
                        </Button>
                    </label>
                    <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                        <Button className="bg-cuca-blue hover:bg-sky-800" onClick={() => setEditingEmpresa(null)}>
                            <Plus className="mr-2 h-4 w-4" />
                            Nova Empresa
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                        <form onSubmit={handleSubmit}>
                            <DialogHeader>
                                <DialogTitle>
                                    {editingEmpresa ? "Editar Empresa" : "Nova Empresa"}
                                </DialogTitle>
                                <DialogDescription>
                                    {editingEmpresa
                                        ? "Atualize as informações da empresa parceira."
                                        : "Preencha os dados da nova empresa."}
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4 md:grid-cols-2">
                                <div className="grid gap-2">
                                    <Label htmlFor="nome">Nome / Razão Social *</Label>
                                    <Input
                                        id="nome"
                                        value={formData.nome}
                                        onChange={(e) => setFormData({ ...formData, nome: e.target.value })}
                                        placeholder="Ex: ACME Coporation"
                                        required
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="cnpj">CNPJ</Label>
                                    <Input
                                        id="cnpj"
                                        value={formData.cnpj}
                                        onChange={(e) => setFormData({ ...formData, cnpj: e.target.value })}
                                        placeholder="Ex: 00.000.000/0001-00"
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="email">E-mail</Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        value={formData.email}
                                        onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                        placeholder="contato@empresa.com"
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="telefone">Telefone</Label>
                                    <Input
                                        id="telefone"
                                        value={formData.telefone}
                                        onChange={(e) => setFormData({ ...formData, telefone: e.target.value })}
                                        placeholder="(85) 99999-9999"
                                    />
                                </div>
                                <div className="grid gap-2 md:col-span-2">
                                    <Label htmlFor="endereco">Endereço</Label>
                                    <Input
                                        id="endereco"
                                        value={formData.endereco}
                                        onChange={(e) => setFormData({ ...formData, endereco: e.target.value })}
                                        placeholder="Av. Exemplo, 123"
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="setor">Setor</Label>
                                    <Input
                                        id="setor"
                                        value={formData.setor}
                                        onChange={(e) => setFormData({ ...formData, setor: e.target.value })}
                                        placeholder="Ex: Tecnologia, Varejo"
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="porte">Porte</Label>
                                    <Input
                                        id="porte"
                                        value={formData.porte}
                                        onChange={(e) => setFormData({ ...formData, porte: e.target.value })}
                                        placeholder="Micro, Pequena, Grande"
                                    />
                                </div>
                                <div className="grid gap-2 md:col-span-2">
                                    <Label htmlFor="contato_responsavel">Contato Responsável (Nome)</Label>
                                    <Input
                                        id="contato_responsavel"
                                        value={formData.contato_responsavel}
                                        onChange={(e) => setFormData({ ...formData, contato_responsavel: e.target.value })}
                                        placeholder="Nome do RH ou responsável"
                                    />
                                </div>
                                <div className="flex items-center justify-between md:col-span-2 p-2 border rounded-md">
                                    <Label htmlFor="ativa">Empresa ativa no sistema</Label>
                                    <Switch
                                        id="ativa"
                                        checked={formData.ativa}
                                        onCheckedChange={(checked) => setFormData({ ...formData, ativa: checked })}
                                    />
                                </div>
                            </div>
                            <DialogFooter>
                                <Button type="button" variant="outline" onClick={handleCloseDialog}>
                                    Cancelar
                                </Button>
                                <Button type="submit" className="bg-cuca-blue hover:bg-sky-800">
                                    {editingEmpresa ? "Atualizar" : "Salvar Empresa"}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total de Parceiros</CardTitle>
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{empresas.length}</div>
                        <p className="text-xs text-muted-foreground">
                            {filteredEmpresas.length} listados na busca
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Empresas Ativas</CardTitle>
                        <Building2 className="h-4 w-4 text-green-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {empresas.filter((c) => c.ativa).length}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Fornecem vagas ativas
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Empresas Inativas</CardTitle>
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {empresas.filter((c) => !c.ativa).length}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Desativadas do painel
                        </p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div>
                            <CardTitle>Listagem de Empresas</CardTitle>
                            <CardDescription>
                                Visualize as empresas parceiras do módulo de Empregabilidade.
                            </CardDescription>
                        </div>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar empresas..."
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
                            Carregando empresas...
                        </div>
                    ) : filteredEmpresas.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            Nenhuma empresa encontrada.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Nome</TableHead>
                                    <TableHead>CNPJ</TableHead>
                                    <TableHead>Setor</TableHead>
                                    <TableHead>Contato RH</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredEmpresas.map((emp) => (
                                    <TableRow key={emp.id}>
                                        <TableCell className="font-medium">{emp.nome}</TableCell>
                                        <TableCell className="text-muted-foreground">
                                            {emp.cnpj || "-"}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">{emp.setor || "-"}</TableCell>
                                        <TableCell>
                                            <div className="text-sm">
                                                <div>{emp.contato_responsavel || "-"}</div>
                                                <div className="text-xs text-muted-foreground">{emp.email || emp.telefone || ""}</div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {emp.ativa ? (
                                                <Badge variant="default" className="bg-green-600">
                                                    Ativa
                                                </Badge>
                                            ) : (
                                                <Badge variant="secondary">Inativa</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="gap-2"
                                                onClick={() => handleEdit(emp)}
                                            >
                                                <Pencil className="h-4 w-4 text-cuca-blue" />
                                                <span className="hidden sm:inline">Editar</span>
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
