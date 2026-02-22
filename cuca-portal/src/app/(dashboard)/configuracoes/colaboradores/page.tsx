"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
    DialogFooter
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Users, Plus, Shield, Building2, Mail, Phone, Search } from "lucide-react"
import { toast } from "react-hot-toast"
import { unidadesCuca } from "@/lib/constants"

export default function ColaboradoresPage() {
    const [colaboradores, setColaboradores] = useState<any[]>([])
    const [funcoes, setFuncoes] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [editingColaborador, setEditingColaborador] = useState<any>(null)
    const [searchTerm, setSearchTerm] = useState("")

    const supabase = createClient()

    const formDataInit = {
        nome_completo: "",
        email: "",
        telefone: "",
        funcao_id: "",
        unidade_cuca: "Geral",
        ativo: true
    }
    const [formData, setFormData] = useState(formDataInit)

    useEffect(() => {
        fetchData()
    }, [])

    const fetchData = async () => {
        setLoading(true)
        const [cRes, fRes] = await Promise.all([
            supabase.from("colaboradores").select("*, funcoes(nome)").order("nome_completo"),
            supabase.from("funcoes").select("*").order("nome")
        ])

        if (cRes.data) setColaboradores(cRes.data)
        if (fRes.data) setFuncoes(fRes.data)
        setLoading(false)
    }

    const handleSave = async () => {
        try {
            if (editingColaborador) {
                const { error } = await supabase
                    .from("colaboradores")
                    .update(formData)
                    .eq("id", editingColaborador.id)
                if (error) throw error
                toast.success("Colaborador atualizado!")
            } else {
                const { error } = await supabase
                    .from("colaboradores")
                    .insert([formData])
                if (error) throw error
                toast.success("Colaborador cadastrado!")
            }
            setIsModalOpen(false)
            setEditingColaborador(null)
            setFormData(formDataInit)
            fetchData()
        } catch (error: any) {
            toast.error(error.message)
        }
    }

    const handleEdit = (colab: any) => {
        setEditingColaborador(colab)
        setFormData({
            nome_completo: colab.nome_completo,
            email: colab.email,
            telefone: colab.telefone,
            funcao_id: colab.funcao_id,
            unidade_cuca: colab.unidade_cuca,
            ativo: colab.ativo
        })
        setIsModalOpen(true)
    }

    const filteredColabs = colaboradores.filter(c =>
        c.nome_completo.toLowerCase().includes(searchTerm.toLowerCase()) ||
        c.email.toLowerCase().includes(searchTerm.toLowerCase())
    )

    return (
        <div className="p-6 space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Equipe & Colaboradores</h1>
                    <p className="text-muted-foreground">Gerencie quem acessa o portal e suas permissões.</p>
                </div>
                <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
                    <DialogTrigger asChild>
                        <Button onClick={() => { setEditingColaborador(null); setFormData(formDataInit); }} className="bg-cuca-yellow text-cuca-dark hover:bg-cuca-yellow/90">
                            <Plus className="w-4 h-4 mr-2" />
                            Novo Colaborador
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-[500px]">
                        <DialogHeader>
                            <DialogTitle>{editingColaborador ? "Editar Colaborador" : "Cadastrar Colaborador"}</DialogTitle>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid gap-2">
                                <Label htmlFor="nome">Nome Completo</Label>
                                <Input id="nome" value={formData.nome_completo} onChange={e => setFormData({ ...formData, nome_completo: e.target.value })} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="email">E-mail</Label>
                                    <Input id="email" type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="tel">Telefone (WP)</Label>
                                    <Input id="tel" value={formData.telefone} onChange={e => setFormData({ ...formData, telefone: e.target.value })} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label>Função (Role)</Label>
                                    <Select value={formData.funcao_id} onValueChange={val => setFormData({ ...formData, funcao_id: val })}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Selecione..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {funcoes.map(f => (
                                                <SelectItem key={f.id} value={f.id}>{f.nome.replace('_', ' ').toUpperCase()}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid gap-2">
                                    <Label>Unidade Ativa</Label>
                                    <Select value={formData.unidade_cuca} onValueChange={val => setFormData({ ...formData, unidade_cuca: val })}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Selecione..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="Geral">Todas as Unidades</SelectItem>
                                            {unidadesCuca.map(u => (
                                                <SelectItem key={u} value={u}>{u}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsModalOpen(false)}>Cancelar</Button>
                            <Button onClick={handleSave} className="bg-cuca-yellow text-cuca-dark hover:bg-cuca-yellow/90">Salvar</Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>
            </div>

            <div className="flex items-center gap-4 bg-card p-4 rounded-lg border border-border shadow-sm">
                <Search className="w-5 h-5 text-muted-foreground" />
                <Input
                    placeholder="Buscar por nome ou e-mail..."
                    className="flex-1 border-none focus-visible:ring-0 shadow-none"
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                />
            </div>

            <Card>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Colaborador</TableHead>
                                <TableHead>Função</TableHead>
                                <TableHead>Unidade</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow><TableCell colSpan={5} className="text-center py-10">Carregando...</TableCell></TableRow>
                            ) : filteredColabs.length === 0 ? (
                                <TableRow><TableCell colSpan={5} className="text-center py-10">Nenhum colaborador encontrado.</TableCell></TableRow>
                            ) : (
                                filteredColabs.map((colab) => (
                                    <TableRow key={colab.id}>
                                        <TableCell>
                                            <div className="flex flex-col">
                                                <span className="font-medium text-foreground">{colab.nome_completo}</span>
                                                <span className="text-xs text-muted-foreground">{colab.email}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="secondary" className="font-mono text-[10px] uppercase">
                                                <Shield className="w-3 h-3 mr-1" />
                                                {colab.funcoes?.nome.replace('_', ' ')}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center text-sm text-muted-foreground">
                                                <Building2 className="w-3 h-3 mr-1" />
                                                {colab.unidade_cuca}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge className={colab.ativo ? "bg-green-600 text-white hover:bg-green-700" : "bg-destructive text-destructive-foreground hover:bg-destructive/90"}>
                                                {colab.ativo ? "Ativo" : "Inativo"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="sm" onClick={() => handleEdit(colab)}>Configurar</Button>
                                        </TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}
