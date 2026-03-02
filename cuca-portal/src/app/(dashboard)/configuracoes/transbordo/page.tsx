"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { HumanHandoverContact } from "@/lib/types/database"
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Search, Plus, Pencil, PhoneForwarded } from "lucide-react"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import toast from "react-hot-toast"
import { unidadesCuca, UnidadeCuca } from "@/lib/constants"

const MÓDULOS_PERMITIDOS = [
    { value: 'empregabilidade', label: 'Empregabilidade' },
    { value: 'ouvidoria', label: 'Ouvidoria' },
    { value: 'programacao', label: 'Programação' },
    { value: 'acesso_cuca', label: 'Acesso CUCA' },
    { value: 'geral', label: 'Geral (Fallback)' },
]

export default function TransbordoPage() {
    const [contatos, setContatos] = useState<HumanHandoverContact[]>([])
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState("")
    const [dialogOpen, setDialogOpen] = useState(false)
    const [editingContato, setEditingContato] = useState<HumanHandoverContact | null>(null)
    const [formData, setFormData] = useState({
        modulo: "",
        unidade_cuca: "todas", // "todas" map to null in DB
        telefone_destino: "",
        nome_responsavel: "",
        ativo: true,
    })
    const supabase = createClient()

    useEffect(() => {
        fetchContatos()
    }, [])

    const fetchContatos = async () => {
        setLoading(true)
        const { data, error } = await supabase
            .from("human_handover_contacts")
            .select("*")
            .order("modulo", { ascending: true })

        if (error) {
            console.error("Erro ao buscar contatos:", error)
            toast.error("Erro ao carregar configurações de transbordo")
        } else {
            setContatos(data || [])
        }
        setLoading(false)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        const payload = {
            modulo: formData.modulo,
            unidade_cuca: formData.unidade_cuca === "todas" ? null : formData.unidade_cuca,
            telefone_destino: formData.telefone_destino.replace(/\D/g, ''), // Salvar apenas números
            nome_responsavel: formData.nome_responsavel,
            ativo: formData.ativo,
        }

        if (editingContato) {
            const { error } = await supabase
                .from("human_handover_contacts")
                .update(payload)
                .eq("id", editingContato.id)

            if (error) {
                console.error("Erro ao atualizar contato:", error)
                toast.error("Erro ao atualizar contato")
            } else {
                toast.success("Regra de transbordo atualizada com sucesso!")
                fetchContatos()
                handleCloseDialog()
            }
        } else {
            const { error } = await supabase
                .from("human_handover_contacts")
                .insert(payload)

            if (error) {
                console.error("Erro ao criar contato:", error)
                toast.error("Erro ao criar regra de transbordo")
            } else {
                toast.success("Regra de transbordo criada com sucesso!")
                fetchContatos()
                handleCloseDialog()
            }
        }
    }

    const handleEdit = (contato: HumanHandoverContact) => {
        setEditingContato(contato)
        setFormData({
            modulo: contato.modulo,
            unidade_cuca: contato.unidade_cuca || "todas",
            telefone_destino: contato.telefone_destino,
            nome_responsavel: contato.nome_responsavel || "",
            ativo: contato.ativo,
        })
        setDialogOpen(true)
    }

    const handleCloseDialog = () => {
        setDialogOpen(false)
        setEditingContato(null)
        setFormData({
            modulo: "",
            unidade_cuca: "todas",
            telefone_destino: "",
            nome_responsavel: "",
            ativo: true,
        })
    }

    const getModuloLabel = (val: string) => MÓDULOS_PERMITIDOS.find(m => m.value === val)?.label || val

    const filteredContatos = contatos.filter((c) =>
        getModuloLabel(c.modulo).toLowerCase().includes(searchTerm.toLowerCase()) ||
        (c.nome_responsavel && c.nome_responsavel.toLowerCase().includes(searchTerm.toLowerCase())) ||
        c.telefone_destino.includes(searchTerm)
    )

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Atendimento Humano</h1>
                    <p className="text-muted-foreground">
                        Configure para quais números de WhatsApp os resumos de atendimento serão enviados.
                    </p>
                </div>
                <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                    <DialogTrigger asChild>
                        <Button className="bg-cuca-blue hover:bg-sky-800" onClick={() => setEditingContato(null)}>
                            <Plus className="mr-2 h-4 w-4" />
                            Nova Regra
                        </Button>
                    </DialogTrigger>
                    <DialogContent>
                        <form onSubmit={handleSubmit}>
                            <DialogHeader>
                                <DialogTitle>
                                    {editingContato ? "Editar Regra de Transbordo" : "Nova Regra de Transbordo"}
                                </DialogTitle>
                                <DialogDescription>
                                    Defina quem receberá mensagens quando a IA detectar a necessidade de assumir presencialmente/humanamente.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="grid gap-4 py-4">
                                <div className="grid gap-2">
                                    <Label htmlFor="modulo">Módulo IA *</Label>
                                    <Select
                                        value={formData.modulo}
                                        onValueChange={(v) => setFormData({ ...formData, modulo: v })}
                                        required
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Selecione o módulo de origem" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {MÓDULOS_PERMITIDOS.map(m => (
                                                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="unidade_cuca">Unidade CUCA (Filtro)</Label>
                                    <Select
                                        value={formData.unidade_cuca}
                                        onValueChange={(v) => setFormData({ ...formData, unidade_cuca: v })}
                                    >
                                        <SelectTrigger>
                                            <SelectValue placeholder="Selecione a unidade" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="todas">Todas as Unidades (Fallback Geral)</SelectItem>
                                            {unidadesCuca.map((u) => (
                                                <SelectItem key={u} value={u}>{u}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <span className="text-xs text-muted-foreground">Útil para rotear atendimento de Empregabilidade ou Ouvidoria por campus.</span>
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="nome_responsavel">Nome do Responsável / Setor</Label>
                                    <Input
                                        id="nome_responsavel"
                                        value={formData.nome_responsavel}
                                        onChange={(e) => setFormData({ ...formData, nome_responsavel: e.target.value })}
                                        placeholder="Ex: RH Geral, Atendente João"
                                    />
                                </div>
                                <div className="grid gap-2">
                                    <Label htmlFor="telefone_destino">WhatsApp de Destino (DDI+DDD+Número) *</Label>
                                    <Input
                                        id="telefone_destino"
                                        value={formData.telefone_destino}
                                        onChange={(e) => setFormData({ ...formData, telefone_destino: e.target.value })}
                                        placeholder="Ex: 5585999999999"
                                        required
                                    />
                                    <span className="text-xs text-muted-foreground">Número que receberá o alerta ativo do Worker.</span>
                                </div>
                                <div className="flex items-center justify-between mt-2">
                                    <Label htmlFor="ativo">Regra Ativa</Label>
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
                                <Button type="submit" className="bg-cuca-blue hover:bg-sky-800" disabled={!formData.modulo || !formData.telefone_destino}>
                                    {editingContato ? "Atualizar Regra" : "Criar Regra"}
                                </Button>
                            </DialogFooter>
                        </form>
                    </DialogContent>
                </Dialog>
            </div>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <div>
                        <CardTitle>Regras de Roteamento</CardTitle>
                        <CardDescription>
                            Prioridade: Regras com "Unidade CUCA" têm maior peso sobre as regras "Todas".
                        </CardDescription>
                    </div>
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar contatos..."
                            className="pl-10 w-64"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="text-center py-8 text-muted-foreground">
                            Carregando rotas...
                        </div>
                    ) : filteredContatos.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            Nenhuma regra configurada.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Módulo IA</TableHead>
                                    <TableHead>Unidade CUCA</TableHead>
                                    <TableHead>Setor / Nome</TableHead>
                                    <TableHead>WhatsApp Destino</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredContatos.map((contato) => (
                                    <TableRow key={contato.id}>
                                        <TableCell className="font-semibold text-slate-700">
                                            {getModuloLabel(contato.modulo)}
                                        </TableCell>
                                        <TableCell>
                                            {contato.unidade_cuca ? (
                                                <Badge variant="outline" className="border-cuca-blue text-cuca-blue">
                                                    {contato.unidade_cuca}
                                                </Badge>
                                            ) : (
                                                <Badge variant="secondary">Global (Fallback)</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground">
                                            <div className="flex items-center gap-2">
                                                <PhoneForwarded className="w-3 h-3" />
                                                {contato.nome_responsavel || "Setor Padrão"}
                                            </div>
                                        </TableCell>
                                        <TableCell className="font-mono text-sm">
                                            +{contato.telefone_destino}
                                        </TableCell>
                                        <TableCell>
                                            {contato.ativo ? (
                                                <Badge variant="default" className="bg-green-600">
                                                    Ativo
                                                </Badge>
                                            ) : (
                                                <Badge variant="secondary">Inativo</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="text-cuca-blue hover:text-sky-800"
                                                onClick={() => handleEdit(contato)}
                                            >
                                                <Pencil className="h-4 w-4 mr-1" /> Editar
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
