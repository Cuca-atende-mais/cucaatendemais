"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/lib/auth/user-provider"
import {
    Building2, Plus, Pencil, Trash2, ChevronDown, ChevronRight,
    CheckCircle2, AlertTriangle, WrenchIcon, Loader2, Monitor
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle
} from "@/components/ui/dialog"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

type Espaco = {
    id: string
    nome: string
    descricao: string
    capacidade: number
    unidade_cuca: string
    status: "ativo" | "desativado" | "manutencao"
}

type Equipamento = {
    id: string
    espaco_id: string
    nome: string
    descricao: string
    status: "ativo" | "desativado" | "manutencao"
}

const STATUS_CONFIG = {
    ativo: { label: "Ativo", color: "bg-emerald-500/10 text-emerald-600 border-emerald-200", icon: CheckCircle2 },
    desativado: { label: "Desativado", color: "bg-slate-100 text-slate-500 border-slate-200", icon: AlertTriangle },
    manutencao: { label: "Em Manutenção", color: "bg-amber-500/10 text-amber-600 border-amber-200", icon: WrenchIcon },
}

const UNIDADES = ["Barra", "Mondubim", "Jangurussu", "José Walter", "Pici"]

export default function EspacosPage() {
    const supabase = createClient()
    const [espacos, setEspacos] = useState<Espaco[]>([])
    const [equipamentosPorEspaco, setEquipamentosPorEspaco] = useState<Record<string, Equipamento[]>>({})
    const [expanded, setExpanded] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)

    // Modal de Espaço
    const [modalEspaco, setModalEspaco] = useState(false)
    const [editingEspaco, setEditingEspaco] = useState<Espaco | null>(null)
    const [eNome, setENome] = useState("")
    const [eDescricao, setEDescricao] = useState("")
    const [eCapacidade, setECapacidade] = useState("")
    const [eUnidade, setEUnidade] = useState("")
    const [eStatus, setEStatus] = useState<"ativo" | "desativado" | "manutencao">("ativo")
    const [savingEspaco, setSavingEspaco] = useState(false)

    // Modal de Equipamento
    const [modalEquip, setModalEquip] = useState(false)
    const [editingEquip, setEditingEquip] = useState<Equipamento | null>(null)
    const [equipEspacoId, setEquipEspacoId] = useState("")
    const [qNome, setQNome] = useState("")
    const [qDescricao, setQDescricao] = useState("")
    const [qStatus, setQStatus] = useState<"ativo" | "desativado" | "manutencao">("ativo")
    const [savingEquip, setSavingEquip] = useState(false)

    const { profile, isDeveloper } = useUser()
    const canSeeAllUnits = isDeveloper || profile?.funcao?.nome === 'Super Admin Cuca'

    useEffect(() => {
        if (profile) fetchEspacos()
    }, [profile])

    const fetchEspacos = async () => {
        setLoading(true)
        let query = supabase.from("espacos_cuca").select("*").order("unidade_cuca").order("nome")

        if (!canSeeAllUnits && profile?.unidade_cuca) {
            query = query.eq('unidade_cuca', profile.unidade_cuca)
        }

        const { data } = await query
        setEspacos(data || [])
        setLoading(false)
    }

    const fetchEquipamentos = async (espacoId: string) => {
        if (equipamentosPorEspaco[espacoId]) return
        const { data } = await supabase.from("equipamentos_cuca").select("*").eq("espaco_id", espacoId).order("nome")
        setEquipamentosPorEspaco(prev => ({ ...prev, [espacoId]: data || [] }))
    }

    const toggleExpand = (id: string) => {
        if (expanded === id) {
            setExpanded(null)
        } else {
            setExpanded(id)
            fetchEquipamentos(id)
        }
    }

    const openEspacoModal = (e?: Espaco) => {
        setEditingEspaco(e || null)
        setENome(e?.nome || "")
        setEDescricao(e?.descricao || "")
        setECapacidade(e?.capacidade?.toString() || "")
        setEUnidade(e?.unidade_cuca || (!canSeeAllUnits && profile?.unidade_cuca ? profile.unidade_cuca : ""))
        setEStatus(e?.status || "ativo")
        setModalEspaco(true)
    }

    const saveEspaco = async () => {
        if (!eNome || !eUnidade) return
        setSavingEspaco(true)
        try {
            const payload = { nome: eNome, descricao: eDescricao, capacidade: parseInt(eCapacidade) || null, unidade_cuca: eUnidade, status: eStatus }
            if (editingEspaco) {
                await supabase.from("espacos_cuca").update(payload).eq("id", editingEspaco.id)
                toast.success("Espaço atualizado!")
            } else {
                await supabase.from("espacos_cuca").insert(payload)
                toast.success("Espaço criado!")
            }
            await fetchEspacos()
            setModalEspaco(false)
        } finally { setSavingEspaco(false) }
    }

    const deleteEspaco = async (id: string) => {
        if (!confirm("Remover este espaço? Os equipamentos vinculados também serão removidos.")) return
        await supabase.from("espacos_cuca").delete().eq("id", id)
        toast.success("Espaço removido.")
        await fetchEspacos()
    }

    const openEquipModal = (espacoId: string, eq?: Equipamento) => {
        setEquipEspacoId(espacoId)
        setEditingEquip(eq || null)
        setQNome(eq?.nome || "")
        setQDescricao(eq?.descricao || "")
        setQStatus(eq?.status || "ativo")
        setModalEquip(true)
    }

    const saveEquip = async () => {
        if (!qNome) return
        setSavingEquip(true)
        try {
            const payload = { nome: qNome, descricao: qDescricao, status: qStatus, espaco_id: equipEspacoId }
            if (editingEquip) {
                await supabase.from("equipamentos_cuca").update(payload).eq("id", editingEquip.id)
                toast.success("Equipamento atualizado!")
            } else {
                await supabase.from("equipamentos_cuca").insert(payload)
                toast.success("Equipamento adicionado!")
            }
            // Force reload dos equipamentos deste espaço
            setEquipamentosPorEspaco(prev => { const n = { ...prev }; delete n[equipEspacoId]; return n })
            await fetchEquipamentos(equipEspacoId)
            setModalEquip(false)
        } finally { setSavingEquip(false) }
    }

    const deleteEquip = async (eq: Equipamento) => {
        if (!confirm(`Remover "${eq.nome}"?`)) return
        await supabase.from("equipamentos_cuca").delete().eq("id", eq.id)
        toast.success("Equipamento removido.")
        setEquipamentosPorEspaco(prev => {
            const n = { ...prev }
            n[eq.espaco_id] = (n[eq.espaco_id] || []).filter(e => e.id !== eq.id)
            return n
        })
    }

    // Agrupar por unidade
    const porUnidade = UNIDADES.map(u => ({ unidade: u, items: espacos.filter(e => e.unidade_cuca === u) })).filter(g => g.items.length > 0)

    return (
        <div className="flex flex-col gap-6 p-2 md:p-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <Building2 className="h-6 w-6 text-primary" />
                        Espaços & Equipamentos
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">Gerencie os espaços e equipamentos disponíveis para reserva nos CUCAs.</p>
                </div>
                {hasPermission("acesso_espacos", "create") && (
                    <Button onClick={() => openEspacoModal()} className="gap-2">
                        <Plus className="h-4 w-4" /> Novo Espaço
                    </Button>
                )}
            </div>

            {/* Link para formulário público */}
            <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/5 border border-primary/20 text-sm">
                <Monitor className="h-4 w-4 text-primary shrink-0" />
                <span className="text-muted-foreground">Link público para solicitações:</span>
                <a href="/acesso-cuca" target="_blank" className="text-primary font-mono hover:underline">/acesso-cuca</a>
            </div>

            {loading ? (
                <div className="flex items-center justify-center py-20">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            ) : (
                <div className="space-y-6">
                    {porUnidade.map(grupo => (
                        <div key={grupo.unidade}>
                            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">CUCA {grupo.unidade}</h2>
                            <div className="space-y-2">
                                {grupo.items.map(espaco => {
                                    const cfg = STATUS_CONFIG[espaco.status]
                                    const Icon = cfg.icon
                                    const equips = equipamentosPorEspaco[espaco.id] || []
                                    const isExpanded = expanded === espaco.id

                                    return (
                                        <div key={espaco.id} className="border rounded-xl overflow-hidden bg-card">
                                            {/* Row do Espaço */}
                                            <div className="flex items-center gap-3 p-4">
                                                <button onClick={() => toggleExpand(espaco.id)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
                                                    {isExpanded ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
                                                    <div className="min-w-0">
                                                        <p className="font-medium truncate">{espaco.nome}</p>
                                                        <p className="text-xs text-muted-foreground truncate">{espaco.descricao} · {espaco.capacidade} pessoas</p>
                                                    </div>
                                                </button>
                                                <Badge className={cn("text-[10px] border shrink-0", cfg.color)}>
                                                    <Icon className="h-3 w-3 mr-1" /> {cfg.label}
                                                </Badge>
                                                <div className="flex gap-1 shrink-0">
                                                    {hasPermission("acesso_espacos", "update") && (
                                                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEspacoModal(espaco)}>
                                                            <Pencil className="h-3.5 w-3.5" />
                                                        </Button>
                                                    )}
                                                    {hasPermission("acesso_espacos", "delete") && (
                                                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => deleteEspaco(espaco.id)}>
                                                            <Trash2 className="h-3.5 w-3.5" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Subrow de Equipamentos */}
                                            {isExpanded && (
                                                <div className="border-t bg-muted/30 p-4 space-y-3">
                                                    <div className="flex items-center justify-between">
                                                        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Equipamentos</p>
                                                        {hasPermission("acesso_espacos", "create") && (
                                                            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => openEquipModal(espaco.id)}>
                                                                <Plus className="h-3 w-3" /> Adicionar
                                                            </Button>
                                                        )}
                                                    </div>
                                                    {equips.length === 0 ? (
                                                        <p className="text-sm text-muted-foreground">Nenhum equipamento cadastrado.</p>
                                                    ) : (
                                                        <div className="space-y-1.5">
                                                            {equips.map(eq => {
                                                                const eqCfg = STATUS_CONFIG[eq.status]
                                                                const EqIcon = eqCfg.icon
                                                                return (
                                                                    <div key={eq.id} className="flex items-center gap-2 p-2 rounded-lg bg-background border">
                                                                        <div className="flex-1 min-w-0">
                                                                            <p className="text-sm font-medium truncate">{eq.nome}</p>
                                                                            {eq.descricao && <p className="text-xs text-muted-foreground truncate">{eq.descricao}</p>}
                                                                        </div>
                                                                        <Badge className={cn("text-[10px] border", eqCfg.color)}>
                                                                            <EqIcon className="h-3 w-3 mr-1" /> {eqCfg.label}
                                                                        </Badge>
                                                                        <div className="flex gap-1">
                                                                            {hasPermission("acesso_espacos", "update") && (
                                                                                <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => openEquipModal(espaco.id, eq)}>
                                                                                    <Pencil className="h-3 w-3" />
                                                                                </Button>
                                                                            )}
                                                                            {hasPermission("acesso_espacos", "delete") && (
                                                                                <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => deleteEquip(eq)}>
                                                                                    <Trash2 className="h-3 w-3" />
                                                                                </Button>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                )
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    ))}

                    {porUnidade.length === 0 && (
                        <div className="text-center py-16 text-muted-foreground">
                            <Building2 className="h-12 w-12 mx-auto mb-4 opacity-20" />
                            <p>Nenhum espaço cadastrado. Clique em "Novo Espaço" para começar.</p>
                        </div>
                    )}
                </div>
            )}

            {/* Modal de Espaço */}
            <Dialog open={modalEspaco} onOpenChange={setModalEspaco}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editingEspaco ? "Editar Espaço" : "Novo Espaço"}</DialogTitle>
                        <DialogDescription className="sr-only">Preencha os dados do espaço do CUCA.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-2">
                        <div className="grid gap-1.5">
                            <Label>Nome do Espaço *</Label>
                            <Input value={eNome} onChange={e => setENome(e.target.value)} placeholder="ex: Auditório Principal" />
                        </div>
                        <div className="grid gap-1.5">
                            <Label>Descrição</Label>
                            <Textarea value={eDescricao} onChange={e => setEDescricao(e.target.value)} placeholder="Descreva o espaço..." className="resize-none" rows={2} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="grid gap-1.5">
                                <Label>Capacidade</Label>
                                <Input type="number" value={eCapacidade} onChange={e => setECapacidade(e.target.value)} placeholder="Pessoas" />
                            </div>
                            <div className="grid gap-1.5">
                                <Label>Status</Label>
                                <Select value={eStatus} onValueChange={(v: any) => setEStatus(v)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="ativo">Ativo</SelectItem>
                                        <SelectItem value="desativado">Desativado</SelectItem>
                                        <SelectItem value="manutencao">Manutenção</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                        <div className="grid gap-1.5">
                            <Label>Unidade CUCA *</Label>
                            <Select value={eUnidade} onValueChange={setEUnidade} disabled={!canSeeAllUnits}>
                                <SelectTrigger><SelectValue placeholder="Selecione a unidade" /></SelectTrigger>
                                <SelectContent>
                                    {UNIDADES.map(u => {
                                        if (!canSeeAllUnits && u !== profile?.unidade_cuca) return null;
                                        return <SelectItem key={u} value={u}>CUCA {u}</SelectItem>
                                    })}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" onClick={() => setModalEspaco(false)}>Cancelar</Button>
                        <Button onClick={saveEspaco} disabled={savingEspaco || !eNome || !eUnidade}>
                            {savingEspaco ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            {editingEspaco ? "Salvar" : "Criar"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>

            {/* Modal de Equipamento */}
            <Dialog open={modalEquip} onOpenChange={setModalEquip}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editingEquip ? "Editar Equipamento" : "Novo Equipamento"}</DialogTitle>
                        <DialogDescription className="sr-only">Preencha os dados do equipamento.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-2">
                        <div className="grid gap-1.5">
                            <Label>Nome do Equipamento *</Label>
                            <Input value={qNome} onChange={e => setQNome(e.target.value)} placeholder="ex: Projetor Epson" />
                        </div>
                        <div className="grid gap-1.5">
                            <Label>Descrição</Label>
                            <Input value={qDescricao} onChange={e => setQDescricao(e.target.value)} placeholder="ex: 4500 lumens, HDMI" />
                        </div>
                        <div className="grid gap-1.5">
                            <Label>Status</Label>
                            <Select value={qStatus} onValueChange={(v: any) => setQStatus(v)}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ativo">Ativo</SelectItem>
                                    <SelectItem value="desativado">Desativado</SelectItem>
                                    <SelectItem value="manutencao">Manutenção</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-2">
                        <Button variant="outline" onClick={() => setModalEquip(false)}>Cancelar</Button>
                        <Button onClick={saveEquip} disabled={savingEquip || !qNome}>
                            {savingEquip ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                            {editingEquip ? "Salvar" : "Adicionar"}
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
