"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/lib/auth/user-provider"
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
    DialogTitle, DialogDescription,
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
import { Users, Plus, Shield, Building2, Mail, Phone, Search, Loader2 } from "lucide-react"
import { toast } from "react-hot-toast"
import { unidadesCuca } from "@/lib/constants"

export default function ColaboradoresPage() {
    const [colaboradores, setColaboradores] = useState<any[]>([])
    const [roles, setRoles] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [isSaving, setIsSaving] = useState(false)
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [editingColaborador, setEditingColaborador] = useState<any>(null)
    const [searchTerm, setSearchTerm] = useState("")
    const { profile, isDeveloper } = useUser()

    const supabase = createClient()

    const formDataInit = {
        nome_completo: "",
        email: "",
        telefone: "",
        role_id: "",
        unidade_cuca: "Geral",
        ativo: true
    }
    const [formData, setFormData] = useState(formDataInit)

    useEffect(() => {
        fetchData()
    }, [])

    const fetchData = async () => {
        setLoading(true)
        const [cRes, rRes] = await Promise.all([
            supabase.from("colaboradores").select("*, sys_roles(name)").order("nome_completo"),
            supabase.from("sys_roles").select("*").order("name")
        ])

        if (cRes.data) {
            if (profile?.funcao?.nome === 'Gerente') {
                setColaboradores(cRes.data.filter(c => c.unidade_cuca === profile.unidade_cuca))
            } else {
                setColaboradores(cRes.data)
            }
        }
        if (rRes.data) {
            // Filtro simples de Hierarquia baseado em nomes conhecidos para não depender de nivel_acesso numérico
            let disponiveis = rRes.data
            if (!isDeveloper) {
                disponiveis = rRes.data.filter(r => r.name !== 'Developer')
            }
            if (profile?.funcao?.nome === 'Gerente') {
                disponiveis = rRes.data.filter(r => !['Developer', 'Super Admin Cuca'].includes(r.name))
            }
            setRoles(disponiveis)
        }
        setLoading(false)
    }

    const handleSave = async () => {
        setIsSaving(true)
        try {
            if (editingColaborador) {
                const { error } = await supabase
                    .from("colaboradores")
                    .update({
                        nome_completo: formData.nome_completo,
                        telefone: formData.telefone,
                        role_id: formData.role_id,
                        unidade_cuca: formData.unidade_cuca,
                        ativo: formData.ativo
                    })
                    .eq("id", editingColaborador.id)
                if (error) throw error
                toast.success("Colaborador atualizado!")
            } else {
                // Nova API de Criação Silenciosa com Resend Email
                const res = await fetch('/api/colaboradores/create', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email: formData.email,
                        nome: formData.nome_completo,
                        roleId: formData.role_id,
                        unidadeCuca: formData.unidade_cuca
                    })
                })
                const data = await res.json()
                if (!res.ok) throw new Error(data.error || 'Erro ao criar colaborador')
                toast.success("Colaborador cadastrado e convite enviado!")
            }
            setIsModalOpen(false)
            setEditingColaborador(null)
            setFormData(formDataInit)
            fetchData()
        } catch (error: any) {
            toast.error(error.message)
        } finally {
            setIsSaving(false)
        }
    }

    const handleEdit = (colab: any) => {
        setEditingColaborador(colab)
        setFormData({
            nome_completo: colab.nome_completo,
            email: colab.email,
            telefone: colab.telefone || "",
            role_id: colab.role_id || "",
            unidade_cuca: colab.unidade_cuca || "Geral",
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
                            <DialogTitle>
                                {editingColaborador ? "Editar Colaborador" : "Cadastrar Colaborador"}
                            </DialogTitle>
                            <DialogDescription>
                                {editingColaborador
                                    ? "Altere os dados de acesso e perfil."
                                    : "O colaborador receberá um e-mail com instruções para configurar sua própria senha."}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid gap-2">
                                <Label htmlFor="nome">Nome Completo</Label>
                                <Input id="nome" value={formData.nome_completo} onChange={e => setFormData({ ...formData, nome_completo: e.target.value })} disabled={isSaving} />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="email">E-mail {editingColaborador && "(Fixo)"}</Label>
                                    <Input id="email" type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} disabled={!!editingColaborador || isSaving} />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="tel">Telefone (Opcional)</Label>
                                    <Input id="tel" value={formData.telefone} onChange={e => setFormData({ ...formData, telefone: e.target.value })} disabled={isSaving} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label>Perfil de Acesso (Cargo)</Label>
                                    <Select
                                        value={formData.role_id}
                                        onValueChange={val => setFormData({ ...formData, role_id: val })}
                                        disabled={isSaving}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Selecione..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {roles.map(r => (
                                                <SelectItem key={r.id} value={r.id}>
                                                    {r.name}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid gap-2">
                                    <Label>Unidade de Lotação</Label>
                                    <Select
                                        value={formData.unidade_cuca}
                                        onValueChange={val => setFormData({ ...formData, unidade_cuca: val })}
                                        disabled={profile?.funcao?.nome === 'Gerente' || isSaving}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Selecione..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="Geral">Administração Geral</SelectItem>
                                            {unidadesCuca.map(u => (
                                                <SelectItem key={u} value={u}>{u}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsModalOpen(false)} disabled={isSaving}>Cancelar</Button>
                            <Button onClick={handleSave} className="bg-cuca-yellow text-cuca-dark hover:bg-cuca-yellow/90" disabled={isSaving}>
                                {isSaving ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                                {isSaving ? "Salvando..." : "Salvar e Enviar Convite"}
                            </Button>
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
                            <TableRow className="bg-muted/50">
                                <TableHead>Colaborador</TableHead>
                                <TableHead>Contato</TableHead>
                                <TableHead>Cargo</TableHead>
                                <TableHead>Unidade</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                        Carregando equipe...
                                    </TableCell>
                                </TableRow>
                            ) : filteredColabs.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                        Nenhum colaborador encontrado.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                filteredColabs.map((colab) => (
                                    <TableRow key={colab.id}>
                                        <TableCell>
                                            <div className="flex items-center gap-3">
                                                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-medium">
                                                    {colab.nome_completo.charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <p className="font-medium">{colab.nome_completo}</p>
                                                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                                        <Mail className="w-3 h-3" />
                                                        {colab.email}
                                                    </div>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            {colab.telefone && (
                                                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                                                    <Phone className="w-3 h-3" />
                                                    {colab.telefone}
                                                </div>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant="outline" className="font-medium bg-blue-50/50 text-blue-700 border-blue-200">
                                                <Shield className="w-3 h-3 mr-1" />
                                                {colab.sys_roles?.name || "Sem Perfil"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1 text-sm">
                                                <Building2 className="w-4 h-4 text-muted-foreground" />
                                                {colab.unidade_cuca}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={colab.ativo ? "default" : "secondary"}
                                                className={colab.ativo ? "bg-green-100 text-green-700 hover:bg-green-100 border-green-200" : ""}>
                                                {colab.ativo ? "Ativo" : "Inativo"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button variant="ghost" size="sm" onClick={() => handleEdit(colab)}>
                                                Editar
                                            </Button>
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
