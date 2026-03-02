"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Lead } from "@/lib/types/database"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
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
    Search, UserPlus, Phone, Mail, Tag, Filter,
    MoreHorizontal, BellOff, Bell, ShieldBan, ShieldCheck, Eraser,
} from "lucide-react"
import { unidadesCuca } from "@/lib/constants"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import toast from "react-hot-toast"
import { useUser } from "@/lib/auth/user-provider"

export default function LeadsPage() {
    const { hasPermission } = useUser()
    const [leads, setLeads] = useState<Lead[]>([])
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState("")
    const [unidadeFilter, setUnidadeFilter] = useState<string>("all")
    const [statusFilter, setStatusFilter] = useState<string>("all")

    // Modal criar lead
    const [createDialog, setCreateDialog] = useState(false)
    const [newLead, setNewLead] = useState({ nome: "", telefone: "", email: "", unidade_cuca: "" })
    const [creating, setCreating] = useState(false)

    // Modal bloquear
    const [bloqDialog, setBloqDialog] = useState(false)
    const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
    const [motivo, setMotivo] = useState("")

    const supabase = createClient()

    useEffect(() => { fetchLeads() }, [])

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
            opt_in: true,
        })
        if (error) {
            toast.error("Erro ao criar lead: " + error.message)
            setCreating(false)
            return
        }
        toast.success("Lead criado com sucesso!")
        setCreateDialog(false)
        setNewLead({ nome: "", telefone: "", email: "", unidade_cuca: "" })
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
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Novo Lead</DialogTitle>
                        <DialogDescription>Cadastre um novo contato na base da Rede CUCA.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-2">
                        <div className="grid gap-2">
                            <Label htmlFor="new-nome">Nome</Label>
                            <Input id="new-nome" placeholder="Nome do contato" value={newLead.nome} onChange={(e) => setNewLead({ ...newLead, nome: e.target.value })} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="new-telefone">Telefone *</Label>
                            <Input id="new-telefone" placeholder="5585999999999" value={newLead.telefone} onChange={(e) => setNewLead({ ...newLead, telefone: e.target.value })} />
                        </div>
                        <div className="grid gap-2">
                            <Label htmlFor="new-email">Email</Label>
                            <Input id="new-email" type="email" placeholder="email@exemplo.com" value={newLead.email} onChange={(e) => setNewLead({ ...newLead, email: e.target.value })} />
                        </div>
                        <div className="grid gap-2">
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
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setCreateDialog(false)}>Cancelar</Button>
                        <Button className="bg-cuca-blue hover:bg-sky-800" onClick={handleCreateLead} disabled={creating}>
                            {creating ? "Salvando..." : "Criar Lead"}
                        </Button>
                    </DialogFooter>
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
