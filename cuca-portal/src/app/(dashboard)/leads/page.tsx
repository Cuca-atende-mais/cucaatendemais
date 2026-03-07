"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { Lead, LeadPercursoFormativo } from "@/lib/types/database"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem,
    DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    Dialog, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Search, UserPlus, Phone, MoreHorizontal, BellOff, Bell,
    ShieldBan, ShieldCheck, Eraser, ClipboardList, Plus, Trash2, Save,
} from "lucide-react"
import { unidadesCuca } from "@/lib/constants"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import toast from "react-hot-toast"
import { useUser } from "@/lib/auth/user-provider"

const UFS_BR = [
    "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS",
    "MG","PA","PB","PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
]

type PercursoRow = Omit<LeadPercursoFormativo, "id" | "lead_id" | "created_at"> & {
    _id?: string
    _novo?: boolean
}

export default function LeadsPage() {
    const { hasPermission } = useUser()
    const [leads, setLeads] = useState<Lead[]>([])
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState("")
    const [unidadeFilter, setUnidadeFilter] = useState<string>("all")
    const [statusFilter, setStatusFilter] = useState<string>("all")

    // Modal criar lead
    const [createDialog, setCreateDialog] = useState(false)
    const [newLead, setNewLead] = useState({
        nome: "", telefone: "", email: "", unidade_cuca: "",
        nome_social: "", data_nascimento: "", numero_juventude: "",
        data_cadastro_juv: "", contato_alternativo: "", uf_origem: "",
    })
    const [creating, setCreating] = useState(false)

    // Modal bloquear
    const [bloqDialog, setBloqDialog] = useState(false)
    const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
    const [motivo, setMotivo] = useState("")

    // Modal ficha completa
    const [fichaDialog, setFichaDialog] = useState(false)
    const [fichaLead, setFichaLead] = useState<Lead | null>(null)
    const [fichaEdit, setFichaEdit] = useState<Partial<Lead>>({})
    const [savingFicha, setSavingFicha] = useState(false)

    // Percurso formativo
    const [percurso, setPercurso] = useState<(LeadPercursoFormativo & { _novo?: boolean })[]>([])
    const [loadingPercurso, setLoadingPercurso] = useState(false)
    const [percursoEdit, setPercursoEdit] = useState<Record<string, Partial<PercursoRow>>>({})

    const supabase = createClient()

    useEffect(() => { fetchLeads() }, [])

    const fetchPercurso = useCallback(async (leadId: string) => {
        setLoadingPercurso(true)
        const { data } = await supabase
            .from("lead_percurso_formativo")
            .select("*")
            .eq("lead_id", leadId)
            .order("ano", { ascending: false })
        setPercurso(data || [])
        setLoadingPercurso(false)
    }, [supabase])

    const openFicha = (lead: Lead) => {
        setFichaLead(lead)
        setFichaEdit({
            nome: lead.nome || "",
            email: lead.email || "",
            unidade_cuca: lead.unidade_cuca || "",
            nome_social: lead.nome_social || "",
            data_nascimento: lead.data_nascimento || "",
            numero_juventude: lead.numero_juventude || "",
            data_cadastro_juv: lead.data_cadastro_juv || "",
            contato_alternativo: lead.contato_alternativo || "",
            uf_origem: lead.uf_origem || "",
        })
        fetchPercurso(lead.id)
        setFichaDialog(true)
    }

    const handleSaveFicha = async () => {
        if (!fichaLead) return
        setSavingFicha(true)
        const { error } = await supabase.from("leads").update({
            ...fichaEdit,
            updated_at: new Date().toISOString(),
        }).eq("id", fichaLead.id)
        if (error) { toast.error("Erro ao salvar ficha: " + error.message) }
        else { toast.success("Ficha salva!"); fetchLeads() }
        setSavingFicha(false)
    }

    const addPercursoRow = () => {
        const tempId = `novo_${Date.now()}`
        setPercurso(prev => [...prev, {
            id: tempId, lead_id: fichaLead!.id, created_at: "",
            programa: null, equipamento: null, ano: null, mes: null,
            curso_atividade: null, carga_horaria: null, turma: null,
            frequencia_pct: null, nota: null, situacao: null, _novo: true,
        }])
        setPercursoEdit(prev => ({ ...prev, [tempId]: {} }))
    }

    const updatePercursoCell = (rowId: string, field: string, value: string | number | null) => {
        setPercursoEdit(prev => ({ ...prev, [rowId]: { ...prev[rowId], [field]: value } }))
    }

    const savePercursoRow = async (row: LeadPercursoFormativo & { _novo?: boolean }) => {
        const edits = percursoEdit[row.id] || {}
        const payload = { ...edits }

        if (row._novo) {
            const { error } = await supabase.from("lead_percurso_formativo").insert({
                lead_id: fichaLead!.id, ...payload,
            })
            if (error) { toast.error("Erro ao adicionar linha: " + error.message); return }
        } else {
            const { error } = await supabase.from("lead_percurso_formativo").update(payload).eq("id", row.id)
            if (error) { toast.error("Erro ao salvar linha: " + error.message); return }
        }
        toast.success("Linha salva!")
        fetchPercurso(fichaLead!.id)
        setPercursoEdit(prev => { const n = { ...prev }; delete n[row.id]; return n })
    }

    const deletePercursoRow = async (row: LeadPercursoFormativo & { _novo?: boolean }) => {
        if (row._novo) {
            setPercurso(prev => prev.filter(r => r.id !== row.id))
            return
        }
        const { error } = await supabase.from("lead_percurso_formativo").delete().eq("id", row.id)
        if (error) { toast.error("Erro ao excluir linha"); return }
        setPercurso(prev => prev.filter(r => r.id !== row.id))
    }

    const fetchLeads = async () => {
        setLoading(true)
        const { data, error } = await supabase
            .from("leads")
            .select("*")
            .order("created_at", { ascending: false })
            .limit(100)
        if (error) console.error("Erro ao buscar leads:", error)
        else setLeads(data || [])
        setLoading(false)
    }

    const toggleOptIn = async (lead: Lead) => {
        const novoOptIn = !lead.opt_in
        const { error } = await supabase
            .from("leads")
            .update({ opt_in: novoOptIn, updated_at: new Date().toISOString() })
            .eq("id", lead.id)

        if (error) {
            toast.error("Erro ao atualizar opt-in")
            return
        }

        // Registrar no histórico
        await supabase.from("historico_opt_in").insert({
            lead_id: lead.id,
            opt_in: novoOptIn,
            motivo: novoOptIn ? "reativacao" : "manual",
            canal: "portal",
        })

        toast.success(novoOptIn ? "✅ Opt-in reativado!" : "🔕 Opt-out registrado")
        fetchLeads()
    }

    const handleBloquear = async () => {
        if (!selectedLead) return
        const { error } = await supabase
            .from("leads")
            .update({ bloqueado: true, motivo_bloqueio: motivo, opt_in: false, updated_at: new Date().toISOString() })
            .eq("id", selectedLead.id)

        if (error) { toast.error("Erro ao bloquear lead"); return }

        await supabase.from("historico_opt_in").insert({
            lead_id: selectedLead.id,
            opt_in: false,
            motivo: "manual",
            canal: "portal",
        })

        toast.success("Lead bloqueado")
        setBloqDialog(false); setMotivo(""); setSelectedLead(null)
        fetchLeads()
    }

    const handleCreateLead = async () => {
        if (!newLead.telefone.trim()) {
            toast.error("Telefone é obrigatório")
            return
        }
        setCreating(true)
        const { error } = await supabase.from("leads").insert({
            nome: newLead.nome || null,
            telefone: newLead.telefone.trim(),
            email: newLead.email || null,
            unidade_cuca: newLead.unidade_cuca || null,
            nome_social: newLead.nome_social || null,
            data_nascimento: newLead.data_nascimento || null,
            numero_juventude: newLead.numero_juventude || null,
            data_cadastro_juv: newLead.data_cadastro_juv || null,
            contato_alternativo: newLead.contato_alternativo || null,
            uf_origem: newLead.uf_origem || null,
            opt_in: true,
        })
        if (error) {
            toast.error("Erro ao criar lead: " + error.message)
            setCreating(false)
            return
        }
        toast.success("Lead criado com sucesso!")
        setCreateDialog(false)
        setNewLead({
            nome: "", telefone: "", email: "", unidade_cuca: "",
            nome_social: "", data_nascimento: "", numero_juventude: "",
            data_cadastro_juv: "", contato_alternativo: "", uf_origem: "",
        })
        setCreating(false)
        fetchLeads()
    }

    const handleDesbloquear = async (lead: Lead) => {
        const { error } = await supabase
            .from("leads")
            .update({ bloqueado: false, motivo_bloqueio: null, opt_in: true, updated_at: new Date().toISOString() })
            .eq("id", lead.id)

        if (error) { toast.error("Erro ao desbloquear lead"); return }

        await supabase.from("historico_opt_in").insert({
            lead_id: lead.id,
            opt_in: true,
            motivo: "reativacao",
            canal: "portal",
        })

        toast.success("Lead desbloqueado ✅")
        fetchLeads()
    }

    // S14-03: Anonimizar Lead (Direito ao Esquecimento)
    const handleAnonimizar = async (lead: Lead) => {
        const confirmado = window.confirm(
            `⚠️ ATENÇÃO: Esta operação é IRREVERSÍVEL!\n\nO nome, e-mail etelefone de "${lead.nome || lead.telefone}" serão substituídos por dados anonimizados.\n\nDeseja confirmar a Anonimização de Dados conforme a LGPD?`
        )
        if (!confirmado) return

        const hash = `anonimo_${lead.id.substring(0, 8)}`
        const { error } = await supabase
            .from("leads")
            .update({
                nome: null,
                email: null,
                telefone: hash,
                tags: [],
                opt_in: false,
                bloqueado: true,
                motivo_bloqueio: "Dados anonimizados por solicitação LGPD",
                updated_at: new Date().toISOString()
            })
            .eq("id", lead.id)

        if (error) { toast.error("Erro ao anonimizar dados"); return }
        toast.success("Dados anonimizados com sucesso (LGPD)")
        fetchLeads()
    }

    const filteredLeads = leads.filter((lead) => {
        const matchesSearch =
            lead.nome?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            lead.telefone.includes(searchTerm) ||
            lead.email?.toLowerCase().includes(searchTerm.toLowerCase())

        const matchesUnidade = unidadeFilter === "all" || lead.unidade_cuca === unidadeFilter

        const matchesStatus =
            statusFilter === "all" ||
            (statusFilter === "ativo" && lead.opt_in && !lead.bloqueado) ||
            (statusFilter === "optout" && !lead.opt_in && !lead.bloqueado) ||
            (statusFilter === "bloqueado" && lead.bloqueado)

        return matchesSearch && matchesUnidade && matchesStatus
    })

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Leads</h1>
                    <p className="text-muted-foreground">Gerencie sua base de contatos da Rede CUCA</p>
                </div>
                {hasPermission("leads_novo", "create") && (
                    <Button className="bg-cuca-blue hover:bg-sky-800" onClick={() => setCreateDialog(true)}>
                        <UserPlus className="mr-2 h-4 w-4" /> Novo Lead
                    </Button>
                )}
            </div>

            {/* Cards de métricas */}
            <div className="grid gap-4 md:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total de Leads</CardTitle>
                        <Phone className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{leads.length}</div>
                        <p className="text-xs text-muted-foreground">{filteredLeads.length} filtrados</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Opt-in Ativo</CardTitle>
                        <Bell className="h-4 w-4 text-green-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-600">
                            {leads.filter((l) => l.opt_in && !l.bloqueado).length}
                        </div>
                        <p className="text-xs text-muted-foreground">Podem receber mensagens</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Opt-out</CardTitle>
                        <BellOff className="h-4 w-4 text-yellow-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-yellow-600">
                            {leads.filter((l) => !l.opt_in && !l.bloqueado).length}
                        </div>
                        <p className="text-xs text-muted-foreground">Saíram voluntariamente</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Bloqueados</CardTitle>
                        <ShieldBan className="h-4 w-4 text-red-600" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-red-600">
                            {leads.filter((l) => l.bloqueado).length}
                        </div>
                        <p className="text-xs text-muted-foreground">Bloqueados manualmente</p>
                    </CardContent>
                </Card>
            </div>

            {/* Tabela */}
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between flex-wrap gap-3">
                        <div>
                            <CardTitle>Lista de Leads</CardTitle>
                            <CardDescription>{filteredLeads.length} lead(s) encontrado(s)</CardDescription>
                        </div>
                        <div className="flex gap-2 flex-wrap">
                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                <Input
                                    placeholder="Nome, telefone ou email..."
                                    className="pl-10 w-72"
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                            <Select value={statusFilter} onValueChange={setStatusFilter}>
                                <SelectTrigger className="w-36">
                                    <SelectValue placeholder="Status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todos</SelectItem>
                                    <SelectItem value="ativo">Opt-in ativo</SelectItem>
                                    <SelectItem value="optout">Opt-out</SelectItem>
                                    <SelectItem value="bloqueado">Bloqueados</SelectItem>
                                </SelectContent>
                            </Select>
                            <Select value={unidadeFilter} onValueChange={setUnidadeFilter}>
                                <SelectTrigger className="w-44">
                                    <SelectValue placeholder="Unidade" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Todas as unidades</SelectItem>
                                    {unidadesCuca.map((u) => (
                                        <SelectItem key={u} value={u}>{u}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="text-center py-8 text-muted-foreground">Carregando leads...</div>
                    ) : filteredLeads.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">Nenhum lead encontrado</div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Nome</TableHead>
                                    <TableHead>Telefone</TableHead>
                                    <TableHead>Unidade</TableHead>
                                    <TableHead>Tags</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Cadastro</TableHead>
                                    <TableHead className="text-right">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredLeads.map((lead) => (
                                    <TableRow key={lead.id} className={lead.bloqueado ? "opacity-60" : ""}>
                                        <TableCell className="font-medium">{lead.nome || "Sem nome"}</TableCell>
                                        <TableCell className="font-mono text-sm">{lead.telefone}</TableCell>
                                        <TableCell>
                                            {lead.unidade_cuca
                                                ? <Badge variant="outline" className="text-xs">{lead.unidade_cuca}</Badge>
                                                : <span className="text-muted-foreground">-</span>}
                                        </TableCell>
                                        <TableCell>
                                            {lead.tags && lead.tags.length > 0 ? (
                                                <div className="flex gap-1 flex-wrap">
                                                    {lead.tags.slice(0, 2).map((tag, i) => (
                                                        <Badge key={i} variant="secondary" className="text-xs">{tag}</Badge>
                                                    ))}
                                                    {lead.tags.length > 2 && (
                                                        <Badge variant="secondary" className="text-xs">+{lead.tags.length - 2}</Badge>
                                                    )}
                                                </div>
                                            ) : <span className="text-muted-foreground">-</span>}
                                        </TableCell>
                                        <TableCell>
                                            {lead.bloqueado ? (
                                                <Badge variant="destructive" className="gap-1">
                                                    <ShieldBan className="h-3 w-3" /> Bloqueado
                                                </Badge>
                                            ) : lead.opt_in ? (
                                                <Badge className="bg-green-600 text-white gap-1">
                                                    <Bell className="h-3 w-3" /> Ativo
                                                </Badge>
                                            ) : (
                                                <Badge variant="secondary" className="gap-1">
                                                    <BellOff className="h-3 w-3" /> Opt-out
                                                </Badge>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-muted-foreground text-sm">
                                            {format(new Date(lead.created_at), "dd/MM/yyyy", { locale: ptBR })}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button variant="ghost" size="sm">
                                                        <MoreHorizontal className="h-4 w-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuItem onClick={() => openFicha(lead)}>
                                                        <ClipboardList className="mr-2 h-4 w-4" /> Ver Ficha Completa
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator />
                                                    {(!lead.bloqueado && hasPermission("leads_bloquear", "update")) && (
                                                        <DropdownMenuItem onClick={() => toggleOptIn(lead)}>
                                                            {lead.opt_in
                                                                ? <><BellOff className="mr-2 h-4 w-4" /> Registrar opt-out</>
                                                                : <><Bell className="mr-2 h-4 w-4" /> Reativar opt-in</>}
                                                        </DropdownMenuItem>
                                                    )}

                                                    {hasPermission("leads_bloquear", "update") && (
                                                        <>
                                                            <DropdownMenuSeparator />
                                                            {lead.bloqueado ? (
                                                                <DropdownMenuItem onClick={() => handleDesbloquear(lead)}>
                                                                    <ShieldCheck className="mr-2 h-4 w-4 text-green-600" />
                                                                    Desbloquear
                                                                </DropdownMenuItem>
                                                            ) : (
                                                                <DropdownMenuItem
                                                                    className="text-red-600"
                                                                    onClick={() => { setSelectedLead(lead); setBloqDialog(true) }}
                                                                >
                                                                    <ShieldBan className="mr-2 h-4 w-4" /> Bloquear
                                                                </DropdownMenuItem>
                                                            )}
                                                        </>
                                                    )}

                                                    {hasPermission("leads_anonimizar", "delete") && (
                                                        <>
                                                            <DropdownMenuSeparator />
                                                            <DropdownMenuItem
                                                                className="text-orange-600"
                                                                onClick={() => handleAnonimizar(lead)}
                                                            >
                                                                <Eraser className="mr-2 h-4 w-4" /> Anonimizar Dados (LGPD)
                                                            </DropdownMenuItem>
                                                        </>
                                                    )}
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* Modal criar lead */}
            <Dialog open={createDialog} onOpenChange={setCreateDialog}>
                <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Novo Lead</DialogTitle>
                        <DialogDescription>Cadastre um novo contato na base da Rede CUCA.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-2">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Dados de Contato</p>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="grid gap-2 col-span-2">
                                <Label htmlFor="new-nome">Nome completo</Label>
                                <Input id="new-nome" placeholder="Nome do contato" value={newLead.nome} onChange={(e) => setNewLead({ ...newLead, nome: e.target.value })} />
                            </div>
                            <div className="grid gap-2 col-span-2">
                                <Label htmlFor="new-telefone">Telefone * <span className="text-xs text-muted-foreground">(com DDI: 5585999...)</span></Label>
                                <Input id="new-telefone" placeholder="5585999999999" value={newLead.telefone} onChange={(e) => setNewLead({ ...newLead, telefone: e.target.value })} />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="new-email">Email</Label>
                                <Input id="new-email" type="email" placeholder="email@exemplo.com" value={newLead.email} onChange={(e) => setNewLead({ ...newLead, email: e.target.value })} />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="new-contato-alt">Contato alternativo</Label>
                                <Input id="new-contato-alt" placeholder="85999..." value={newLead.contato_alternativo} onChange={(e) => setNewLead({ ...newLead, contato_alternativo: e.target.value })} />
                            </div>
                            <div className="grid gap-2 col-span-2">
                                <Label>Unidade CUCA</Label>
                                <Select value={newLead.unidade_cuca} onValueChange={(v) => setNewLead({ ...newLead, unidade_cuca: v })}>
                                    <SelectTrigger><SelectValue placeholder="Selecione a unidade" /></SelectTrigger>
                                    <SelectContent>
                                        {unidadesCuca.map((u) => (
                                            <SelectItem key={u} value={u}>{u}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2">Dados Complementares (Ficha CUCA)</p>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="grid gap-2">
                                <Label htmlFor="new-nome-social">Nome social</Label>
                                <Input id="new-nome-social" placeholder="Nome social" value={newLead.nome_social} onChange={(e) => setNewLead({ ...newLead, nome_social: e.target.value })} />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="new-nascimento">Data de nascimento</Label>
                                <Input id="new-nascimento" type="date" value={newLead.data_nascimento} onChange={(e) => setNewLead({ ...newLead, data_nascimento: e.target.value })} />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="new-juv">N° Juventude (JUV)</Label>
                                <Input id="new-juv" placeholder="JUV-00000" value={newLead.numero_juventude} onChange={(e) => setNewLead({ ...newLead, numero_juventude: e.target.value })} />
                            </div>
                            <div className="grid gap-2">
                                <Label htmlFor="new-data-juv">Data cadastro JUV</Label>
                                <Input id="new-data-juv" type="date" value={newLead.data_cadastro_juv} onChange={(e) => setNewLead({ ...newLead, data_cadastro_juv: e.target.value })} />
                            </div>
                            <div className="grid gap-2">
                                <Label>UF de origem</Label>
                                <Select value={newLead.uf_origem} onValueChange={(v) => setNewLead({ ...newLead, uf_origem: v })}>
                                    <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
                                    <SelectContent>
                                        {UFS_BR.map((uf) => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateDialog(false)}>Cancelar</Button>
                        <Button className="bg-cuca-blue hover:bg-sky-800" onClick={handleCreateLead} disabled={creating}>
                            {creating ? "Salvando..." : "Criar Lead"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Modal Ficha Completa */}
            <Dialog open={fichaDialog} onOpenChange={(open) => { if (!open) { setFichaDialog(false); setFichaLead(null); setPercurso([]) } }}>
                <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Ficha do Lead — {fichaLead?.nome || fichaLead?.telefone}</DialogTitle>
                        <DialogDescription>Dados completos e Percurso Formativo na Rede CUCA</DialogDescription>
                    </DialogHeader>

                    <Tabs defaultValue="dados">
                        <TabsList className="mb-4">
                            <TabsTrigger value="dados">Dados do Lead</TabsTrigger>
                            <TabsTrigger value="percurso">Percurso Formativo</TabsTrigger>
                        </TabsList>

                        {/* Aba: Dados */}
                        <TabsContent value="dados">
                            <div className="grid gap-4">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Contato</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="grid gap-2">
                                        <Label>Nome completo</Label>
                                        <Input value={fichaEdit.nome as string || ""} onChange={(e) => setFichaEdit(p => ({ ...p, nome: e.target.value }))} />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label>Telefone</Label>
                                        <Input value={fichaLead?.telefone || ""} disabled className="bg-muted" />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label>Email</Label>
                                        <Input value={fichaEdit.email as string || ""} onChange={(e) => setFichaEdit(p => ({ ...p, email: e.target.value }))} />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label>Contato alternativo</Label>
                                        <Input value={fichaEdit.contato_alternativo as string || ""} onChange={(e) => setFichaEdit(p => ({ ...p, contato_alternativo: e.target.value }))} />
                                    </div>
                                    <div className="grid gap-2 col-span-2">
                                        <Label>Unidade CUCA</Label>
                                        <Select value={fichaEdit.unidade_cuca as string || ""} onValueChange={(v) => setFichaEdit(p => ({ ...p, unidade_cuca: v }))}>
                                            <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                                            <SelectContent>
                                                {unidadesCuca.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mt-2">Dados Ficha CUCA</p>
                                <div className="grid grid-cols-2 gap-3">
                                    <div className="grid gap-2">
                                        <Label>Nome social</Label>
                                        <Input value={fichaEdit.nome_social as string || ""} onChange={(e) => setFichaEdit(p => ({ ...p, nome_social: e.target.value }))} />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label>Data de nascimento</Label>
                                        <Input type="date" value={fichaEdit.data_nascimento as string || ""} onChange={(e) => setFichaEdit(p => ({ ...p, data_nascimento: e.target.value }))} />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label>N° Juventude (JUV)</Label>
                                        <Input placeholder="JUV-00000" value={fichaEdit.numero_juventude as string || ""} onChange={(e) => setFichaEdit(p => ({ ...p, numero_juventude: e.target.value }))} />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label>Data cadastro JUV</Label>
                                        <Input type="date" value={fichaEdit.data_cadastro_juv as string || ""} onChange={(e) => setFichaEdit(p => ({ ...p, data_cadastro_juv: e.target.value }))} />
                                    </div>
                                    <div className="grid gap-2">
                                        <Label>UF de origem</Label>
                                        <Select value={fichaEdit.uf_origem as string || ""} onValueChange={(v) => setFichaEdit(p => ({ ...p, uf_origem: v }))}>
                                            <SelectTrigger><SelectValue placeholder="UF" /></SelectTrigger>
                                            <SelectContent>
                                                {UFS_BR.map((uf) => <SelectItem key={uf} value={uf}>{uf}</SelectItem>)}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                </div>

                                <div className="flex justify-end pt-2">
                                    <Button className="bg-cuca-blue hover:bg-sky-800" onClick={handleSaveFicha} disabled={savingFicha}>
                                        <Save className="mr-2 h-4 w-4" />
                                        {savingFicha ? "Salvando..." : "Salvar Dados"}
                                    </Button>
                                </div>
                            </div>
                        </TabsContent>

                        {/* Aba: Percurso Formativo */}
                        <TabsContent value="percurso">
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <p className="text-sm text-muted-foreground">Histórico de cursos e atividades na Rede CUCA</p>
                                    {hasPermission("leads", "create") && (
                                        <Button size="sm" variant="outline" onClick={addPercursoRow}>
                                            <Plus className="mr-1 h-4 w-4" /> Adicionar
                                        </Button>
                                    )}
                                </div>

                                {loadingPercurso ? (
                                    <p className="text-center text-sm text-muted-foreground py-6">Carregando...</p>
                                ) : percurso.length === 0 ? (
                                    <p className="text-center text-sm text-muted-foreground py-6">Nenhum registro de percurso formativo.</p>
                                ) : (
                                    <div className="overflow-x-auto">
                                        <Table>
                                            <TableHeader>
                                                <TableRow>
                                                    <TableHead className="min-w-[90px]">Programa</TableHead>
                                                    <TableHead className="min-w-[100px]">Equipamento</TableHead>
                                                    <TableHead className="w-16">Ano</TableHead>
                                                    <TableHead className="w-14">Mês</TableHead>
                                                    <TableHead className="min-w-[140px]">Curso / Atividade</TableHead>
                                                    <TableHead className="w-14">C.H.</TableHead>
                                                    <TableHead className="w-20">Turma</TableHead>
                                                    <TableHead className="w-16">Freq%</TableHead>
                                                    <TableHead className="w-14">Nota</TableHead>
                                                    <TableHead className="w-24">Situação</TableHead>
                                                    <TableHead className="w-20"></TableHead>
                                                </TableRow>
                                            </TableHeader>
                                            <TableBody>
                                                {percurso.map((row) => {
                                                    const e = percursoEdit[row.id] || {}
                                                    const v = (f: string) => f in e ? (e as any)[f] : (row as any)[f] ?? ""
                                                    const nc = (f: string) => (ev: React.ChangeEvent<HTMLInputElement>) =>
                                                        updatePercursoCell(row.id, f, ev.target.value)
                                                    const nn = (f: string) => (ev: React.ChangeEvent<HTMLInputElement>) =>
                                                        updatePercursoCell(row.id, f, ev.target.value ? Number(ev.target.value) : null)
                                                    return (
                                                        <TableRow key={row.id}>
                                                            <TableCell><Input className="h-7 text-xs min-w-[80px]" value={v("programa")} onChange={nc("programa")} /></TableCell>
                                                            <TableCell><Input className="h-7 text-xs min-w-[90px]" value={v("equipamento")} onChange={nc("equipamento")} /></TableCell>
                                                            <TableCell><Input className="h-7 text-xs w-16" type="number" value={v("ano")} onChange={nn("ano")} /></TableCell>
                                                            <TableCell><Input className="h-7 text-xs w-14" type="number" min={1} max={12} value={v("mes")} onChange={nn("mes")} /></TableCell>
                                                            <TableCell><Input className="h-7 text-xs min-w-[130px]" value={v("curso_atividade")} onChange={nc("curso_atividade")} /></TableCell>
                                                            <TableCell><Input className="h-7 text-xs w-14" type="number" value={v("carga_horaria")} onChange={nn("carga_horaria")} /></TableCell>
                                                            <TableCell><Input className="h-7 text-xs w-20" value={v("turma")} onChange={nc("turma")} /></TableCell>
                                                            <TableCell><Input className="h-7 text-xs w-16" type="number" min={0} max={100} value={v("frequencia_pct")} onChange={nn("frequencia_pct")} /></TableCell>
                                                            <TableCell><Input className="h-7 text-xs w-14" type="number" value={v("nota")} onChange={nn("nota")} /></TableCell>
                                                            <TableCell><Input className="h-7 text-xs w-24" value={v("situacao")} onChange={nc("situacao")} /></TableCell>
                                                            <TableCell>
                                                                <div className="flex gap-1">
                                                                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => savePercursoRow(row)} title="Salvar">
                                                                        <Save className="h-3.5 w-3.5 text-green-600" />
                                                                    </Button>
                                                                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => deletePercursoRow(row)} title="Excluir">
                                                                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                                                                    </Button>
                                                                </div>
                                                            </TableCell>
                                                        </TableRow>
                                                    )
                                                })}
                                            </TableBody>
                                        </Table>
                                    </div>
                                )}
                            </div>
                        </TabsContent>
                    </Tabs>
                </DialogContent>
            </Dialog>

            {/* Modal de bloqueio */}
            <Dialog open={bloqDialog} onOpenChange={setBloqDialog}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Bloquear lead</DialogTitle>
                        <DialogDescription>
                            Bloquear <strong>{selectedLead?.nome || selectedLead?.telefone}</strong> impedirá o envio de qualquer mensagem para este contato.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-2 py-2">
                        <Label htmlFor="motivo">Motivo do bloqueio</Label>
                        <Textarea
                            id="motivo"
                            placeholder="Ex: Solicitação via WhatsApp, comportamento inadequado..."
                            value={motivo}
                            onChange={(e) => setMotivo(e.target.value)}
                            rows={3}
                        />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setBloqDialog(false); setMotivo("") }}>Cancelar</Button>
                        <Button variant="destructive" onClick={handleBloquear}>
                            <ShieldBan className="mr-2 h-4 w-4" /> Confirmar Bloqueio
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
