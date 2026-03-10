"use client"

import { useState, useEffect } from "react"
import {
    Wifi, WifiOff, RefreshCw, QrCode, LogOut, Smartphone,
    Building2, Calendar, MessageSquare, Search, Filter,
    TriangleAlert, Plus, Pencil, Trash2, Shield, X, Save,
    Loader2, Phone, UserCheck, Info, Megaphone,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    Dialog, DialogContent, DialogDescription, DialogHeader,
    DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { toast } from "sonner"
import { createClient } from "@/lib/supabase/client"
import { unidadesCuca } from "@/lib/constants"

/* ─── Tipos ──────────────────────────────────────── */
type CanalTipo = "Institucional" | "Empregabilidade" | "Acesso" | "Ouvidoria" | "Reserva" | "Divulgação"
type StatusType = "connected" | "disconnected" | "error"

type Instancia = {
    id: string
    nome: string
    canal_tipo: CanalTipo
    agente_tipo: string
    unidade_cuca: string | null
    telefone: string | null
    token: string | null
    ativa: boolean
    reserva: boolean
    observacoes: string | null
    webhook_url: string | null
}

type Transbordo = {
    id: string
    unidade_cuca: string | null
    modulo: string
    responsavel: string
    telefone: string
    ativo: boolean
}

/* ─── Constantes ─────────────────────────────────── */
const CANAL_TIPOS: CanalTipo[] = ["Institucional", "Empregabilidade", "Acesso", "Ouvidoria", "Reserva", "Divulgação"]

const CANAL_COLORS: Record<string, string> = {
    Institucional: "border-sky-500/40 hover:border-sky-500/70",
    Empregabilidade: "border-emerald-500/40 hover:border-emerald-500/70",
    Acesso: "border-purple-500/40 hover:border-purple-500/70",
    Ouvidoria: "border-orange-500/40 hover:border-orange-500/70",
    Reserva: "border-amber-400/40 hover:border-amber-400/70 border-dashed",
    Divulgação: "border-yellow-500/40 hover:border-yellow-500/70",
}

const CANAL_ICONS: Record<string, React.ReactNode> = {
    Institucional: <Calendar className="h-4 w-4" />,
    Empregabilidade: <Building2 className="h-4 w-4" />,
    Acesso: <Shield className="h-4 w-4" />,
    Ouvidoria: <MessageSquare className="h-4 w-4" />,
    Reserva: <Smartphone className="h-4 w-4" />,
    Divulgação: <Megaphone className="h-4 w-4" />,
}

const CANAL_BADGE_CLASS: Record<string, string> = {
    Institucional: "bg-sky-500/10 text-sky-600 border-sky-500/30",
    Empregabilidade: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
    Acesso: "bg-purple-500/10 text-purple-600 border-purple-500/30",
    Ouvidoria: "bg-orange-500/10 text-orange-600 border-orange-500/30",
    Reserva: "bg-amber-500/10 text-amber-600 border-amber-400/30",
    Divulgação: "bg-yellow-500/10 text-yellow-600 border-yellow-500/30",
}

/* ─── Página ─────────────────────────────────────── */
/* ─── Developer-only: apenas esses emails veem o botão EXCLUIR ─── */
const DEVELOPER_EMAILS = ["valmir@cucateste.com", "dev.cucaatendemais@gmail.com"]

export default function InstanciasPage() {
    const supabase = createClient()
    const [instancias, setInstancias] = useState<Instancia[]>([])
    const [transbordos, setTransbordos] = useState<Transbordo[]>([])
    const [search, setSearch] = useState("")
    const [filterTipo, setFilterTipo] = useState("all")
    const [filterUnidade, setFilterUnidade] = useState("all")
    const [fetching, setFetching] = useState(true)
    const [loadingAction, setLoadingAction] = useState<string | null>(null)
    const [openQr, setOpenQr] = useState<Instancia | null>(null)
    const [userEmail, setUserEmail] = useState<string | null>(null)
    const isDeveloper = DEVELOPER_EMAILS.includes(userEmail ?? '')

    // S14-05: Progresso de criação de instância
    const [instProgress, setInstProgress] = useState<string | null>(null)

    // Modal Instância
    const [modalInst, setModalInst] = useState(false)
    const [editingInst, setEditingInst] = useState<Instancia | null>(null)
    const [iNome, setINome] = useState("")
    const [iCanalTipo, setICanalTipo] = useState<CanalTipo>("Institucional")
    const [iUnidade, setIUnidade] = useState("")
    const [iTelefone, setITelefone] = useState("")
    const [iToken, setIToken] = useState("")
    const [iWebhook, setIWebhook] = useState("")
    const [iAtiva, setIAtiva] = useState(false)
    const [iReserva, setIReserva] = useState(false)
    const [iObs, setIObs] = useState("")
    const [savingInst, setSavingInst] = useState(false)

    // Modal Transbordo
    const [modalTrans, setModalTrans] = useState(false)
    const [editingTrans, setEditingTrans] = useState<Transbordo | null>(null)
    const [tResponsavel, setTResponsavel] = useState("")
    const [tTelefone, setTTelefone] = useState("")
    const [tModulo, setTModulo] = useState("Institucional")
    const [tUnidade, setTUnidade] = useState("")
    const [savingTrans, setSavingTrans] = useState(false)

    useEffect(() => {
        supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null))
        fetchAll()
    }, [])

    const fetchAll = async () => {
        setFetching(true)
        try {
            const [instRes, transRes] = await Promise.all([
                supabase.from("instancias_uazapi").select("*").order("canal_tipo").order("unidade_cuca").order("nome"),
                supabase.from("transbordo_humano").select("*").order("unidade_cuca").order("modulo"),
            ])
            setInstancias(instRes.data || [])
            setTransbordos(transRes.data || [])
        } catch (err) {
            toast.error("Erro ao carregar dados.")
        } finally {
            setFetching(false)
        }
    }

    /* ─── CRUD Instância ─────────────────────────── */
    const openCreate = () => {
        setEditingInst(null)
        setINome(""); setICanalTipo("Institucional"); setIUnidade("")
        setITelefone(""); setIToken(""); setIWebhook("")
        setIAtiva(false); setIReserva(false); setIObs("")
        setModalInst(true)
    }

    const openEdit = (inst: Instancia) => {
        setEditingInst(inst)
        setINome(inst.nome)
        setICanalTipo(inst.canal_tipo)
        setIUnidade(inst.unidade_cuca || "global")
        setITelefone(inst.telefone || "")
        setIToken(inst.token || "")
        setIWebhook(inst.webhook_url || "")
        setIAtiva(inst.ativa)
        setIReserva(inst.reserva)
        setIObs(inst.observacoes || "")
        setModalInst(true)
    }

    const saveInstancia = async () => {
        if (!iNome.trim() || !iCanalTipo) {
            toast.error("Nome e Tipo de Canal são obrigatórios.")
            return
        }
        setSavingInst(true)
        try {
            // S26-04: Garantir sessão válida antes de salvar (evita falha silenciosa por JWT expirado)
            const { data: { session } } = await supabase.auth.getSession()
            if (!session) {
                await supabase.auth.refreshSession()
            }
            const payload = {
                nome: iNome.trim(),
                canal_tipo: iCanalTipo,
                agente_tipo: iCanalTipo,
                unidade_cuca: iUnidade === "global" || !iUnidade ? null : iUnidade,
                telefone: iTelefone.trim() || null,
                token: iToken.trim() || null,
                webhook_url: iWebhook.trim() || null,
                ativa: iAtiva,
                reserva: iReserva,
                observacoes: iObs.trim() || null,
                updated_at: new Date().toISOString(),
            }

            if (editingInst) {
                setInstProgress("Atualizando dados no banco...")
                const { error } = await supabase.from("instancias_uazapi").update(payload).eq("id", editingInst.id)
                if (error) throw error
                toast.success("Instância atualizada!")
            } else {
                setInstProgress("Registrando instância no banco de dados...")
                await new Promise(r => setTimeout(r, 400))
                const { error } = await supabase.from("instancias_uazapi").insert(payload)
                if (error) throw error
                setInstProgress("Instância criada! Configure o Token e Webhook no UAZAPI.")
                await new Promise(r => setTimeout(r, 1200))
                toast.success("Instância criada! Escaneie o QR Code para ativar.")
            }

            setInstProgress(null)
            setModalInst(false)
            await fetchAll()
        } catch (err: any) {
            console.error("Erro ao salvar instância:", err)
            toast.error(`Erro: ${err.message}`)
        } finally {
            setSavingInst(false)
            setInstProgress(null)
        }
    }

    const excluirInstancia = async (inst: Instancia) => {
        if (!isDeveloper) return
        if (!confirm(`EXCLUIR PERMANENTEMENTE "${inst.nome}"? Esta ação remove do UAZAPI e do banco. Não pode ser desfeita.`)) return
        try {
            const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || ""
            const res = await fetch(`${WORKER_URL}/api/instancias/${encodeURIComponent(inst.nome)}/excluir`, {
                method: "DELETE",
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err.error || `Status ${res.status}`)
            }
            toast.success("Instância excluída permanentemente (UAZAPI + banco).")
            await fetchAll()
        } catch (e: any) {
            toast.error(`Erro ao excluir: ${e.message}`)
        }
    }

    const toggleAtiva = async (inst: Instancia) => {
        const novo = !inst.ativa
        setLoadingAction(inst.id)
        try {
            const { error } = await supabase.from("instancias_uazapi")
                .update({ ativa: novo, updated_at: new Date().toISOString() })
                .eq("id", inst.id)
            if (error) throw error
            if (novo) setOpenQr(inst)
            toast.success(novo ? "Instância ativada!" : "Instância desativada.")
            await fetchAll()
        } catch {
            toast.error("Erro ao alterar status.")
        } finally {
            setLoadingAction(null)
        }
    }

    /* ─── CRUD Transbordo ────────────────────────── */
    const openCreateTrans = () => {
        setEditingTrans(null)
        setTResponsavel(""); setTTelefone(""); setTModulo("Institucional"); setTUnidade("")
        setModalTrans(true)
    }

    const openEditTrans = (t: Transbordo) => {
        setEditingTrans(t)
        setTResponsavel(t.responsavel); setTTelefone(t.telefone)
        setTModulo(t.modulo); setTUnidade(t.unidade_cuca || "global")
        setModalTrans(true)
    }

    const saveTransbordo = async () => {
        if (!tResponsavel.trim() || !tTelefone.trim()) {
            toast.error("Responsável e Telefone são obrigatórios.")
            return
        }
        setSavingTrans(true)
        try {
            const payload = {
                unidade_cuca: tUnidade === "global" || !tUnidade ? null : tUnidade,
                modulo: tModulo,
                responsavel: tResponsavel.trim(),
                telefone: tTelefone.trim(),
                ativo: true,
            }
            if (editingTrans) {
                await supabase.from("transbordo_humano").update(payload).eq("id", editingTrans.id)
                toast.success("Atendente atualizado!")
            } else {
                await supabase.from("transbordo_humano").insert(payload)
                toast.success("Atendente cadastrado!")
            }
            setModalTrans(false)
            await fetchAll()
        } catch (err: any) {
            toast.error(`Erro: ${err.message}`)
        } finally {
            setSavingTrans(false)
        }
    }

    const excluirTransbordo = async (t: Transbordo) => {
        if (!confirm(`Remover "${t.responsavel}"?`)) return
        await supabase.from("transbordo_humano").delete().eq("id", t.id)
        toast.success("Removido.")
        await fetchAll()
    }

    /* ─── Filtros ────────────────────────────────── */
    const filtered = instancias.filter(i => {
        const matchSearch = i.nome.toLowerCase().includes(search.toLowerCase()) ||
            (i.unidade_cuca || "").toLowerCase().includes(search.toLowerCase())
        const matchTipo = filterTipo === "all" || i.canal_tipo === filterTipo
        const matchUnidade = filterUnidade === "all" || i.unidade_cuca === filterUnidade
        return matchSearch && matchTipo && matchUnidade
    })

    const ativos = instancias.filter(i => i.ativa && !i.reserva).length
    const reservas = instancias.filter(i => i.reserva).length

    if (fetching) return (
        <div className="flex justify-center py-40"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
    )

    return (
        <div className="flex flex-col gap-6 p-2 md:p-6">

            {/* ── Header ── */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <Smartphone className="h-6 w-6 text-primary" />
                        Gestão de Instâncias UAZAPI
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Controle e monitoramento dos 20 canais do CUCA Atende+
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <div className="flex gap-2">
                        <Badge variant="outline" className="border-emerald-500/30 text-emerald-600">
                            🟢 {ativos} Ativos
                        </Badge>
                        <Badge variant="outline" className="border-amber-500/30 text-amber-600">
                            🛡️ {reservas} Reservas
                        </Badge>
                    </div>
                    <Button onClick={openCreate} className="gap-2">
                        <Plus className="h-4 w-4" /> Nova Instância
                    </Button>
                </div>
            </div>

            {/* ── Filtros ── */}
            <div className="flex flex-col md:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar por nome ou unidade..."
                        className="pl-9"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <Select value={filterTipo} onValueChange={setFilterTipo}>
                    <SelectTrigger className="w-full md:w-[180px]"><SelectValue placeholder="Tipo" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todos os Tipos</SelectItem>
                        {CANAL_TIPOS.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                </Select>
                <Select value={filterUnidade} onValueChange={setFilterUnidade}>
                    <SelectTrigger className="w-full md:w-[200px]"><SelectValue placeholder="Unidade" /></SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todas as Unidades</SelectItem>
                        {unidadesCuca.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                    </SelectContent>
                </Select>
            </div>

            {/* ── Grid de Instâncias agrupado por canal_tipo (S14-04) ── */}
            {filtered.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground border rounded-xl border-dashed">
                    <Smartphone className="h-12 w-12 mx-auto mb-4 opacity-20" />
                    <p className="font-medium">Nenhuma instância encontrada</p>
                    <p className="text-xs mt-1">Ajuste os filtros ou crie uma nova instância.</p>
                </div>
            ) : (
                <div className="flex flex-col gap-8">
                    {CANAL_TIPOS.map(tipo => {
                        const grupo = filtered.filter(i => i.canal_tipo === tipo)
                        if (grupo.length === 0) return null
                        return (
                            <div key={tipo} className="space-y-3">
                                <div className="flex items-center gap-2">
                                    <div className={`p-1.5 rounded-md ${CANAL_BADGE_CLASS[tipo]}`}>
                                        {CANAL_ICONS[tipo]}
                                    </div>
                                    <h2 className="font-semibold text-sm">{tipo}</h2>
                                    <Badge variant="outline" className="text-[10px]">{grupo.length}</Badge>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {grupo.map((inst) => (
                                        <Card key={inst.id}
                                            className={`overflow-hidden border shadow-sm transition-all ${CANAL_COLORS[inst.canal_tipo] || "border-border/50"} ${!inst.ativa ? "opacity-70" : ""}`}
                                        >
                                            <CardHeader className="pb-2 space-y-1">
                                                <div className="flex items-center justify-between">
                                                    <Badge variant="outline" className={`text-[10px] font-semibold uppercase tracking-wider gap-1 ${CANAL_BADGE_CLASS[inst.canal_tipo]}`}>
                                                        {CANAL_ICONS[inst.canal_tipo]}
                                                        {inst.canal_tipo}
                                                    </Badge>
                                                    {inst.ativa
                                                        ? <Wifi className="h-4 w-4 text-emerald-500" />
                                                        : <WifiOff className="h-4 w-4 text-muted-foreground/50" />
                                                    }
                                                </div>
                                                <CardTitle className="text-sm truncate">{inst.nome}</CardTitle>
                                                {inst.unidade_cuca && (
                                                    <CardDescription className="text-[10px]">{inst.unidade_cuca}</CardDescription>
                                                )}
                                                {inst.reserva && (
                                                    <Badge className="bg-amber-500/10 text-amber-600 border-amber-400/30 border text-[10px] w-fit">
                                                        🛡️ Reserva Anti-Ban
                                                    </Badge>
                                                )}
                                            </CardHeader>

                                            <CardContent className="text-[11px] space-y-1.5 pb-2">
                                                <div className="flex justify-between">
                                                    <span className="text-muted-foreground">Telefone:</span>
                                                    <span className="font-mono">{inst.telefone || "—"}</span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-muted-foreground">Token:</span>
                                                    <span className={inst.token ? "text-emerald-600 font-medium" : "text-amber-600"}>
                                                        {inst.token ? "✓ OK" : "⚠ Pendente"}
                                                    </span>
                                                </div>
                                                <div className="flex justify-between">
                                                    <span className="text-muted-foreground">Webhook:</span>
                                                    <span className={inst.webhook_url ? "text-emerald-600 font-medium" : "text-amber-600"}>
                                                        {inst.webhook_url ? "✓ OK" : "⚠ Pendente"}
                                                    </span>
                                                </div>
                                            </CardContent>

                                            <CardFooter className="pt-2 border-t bg-secondary/20 flex flex-col gap-1.5">
                                                <div className="flex w-full gap-1.5">
                                                    <Button variant="outline" size="sm" className="flex-1 h-7 text-[10px]" onClick={() => openEdit(inst)}>
                                                        <Pencil className="mr-1 h-3 w-3" /> Editar
                                                    </Button>
                                                    {isDeveloper && (
                                                        <Button variant="outline" size="sm" className="h-7 text-[10px] border-destructive/20 text-destructive hover:bg-destructive/5"
                                                            onClick={() => excluirInstancia(inst)}>
                                                            <Trash2 className="h-3 w-3" />
                                                        </Button>
                                                    )}
                                                </div>

                                                <Button
                                                    variant={inst.ativa ? "ghost" : "default"}
                                                    size="sm"
                                                    className={`w-full h-7 text-[10px] ${inst.ativa ? "text-amber-600 hover:bg-amber-500/10" : ""}`}
                                                    onClick={() => toggleAtiva(inst)}
                                                    disabled={loadingAction === inst.id}
                                                >
                                                    {loadingAction === inst.id
                                                        ? <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                                                        : inst.ativa
                                                            ? <><RefreshCw className="mr-1 h-3 w-3" />Desativar / Trocar Chip</>
                                                            : <><QrCode className="mr-1 h-3 w-3" />Ativar / QR Code</>
                                                    }
                                                </Button>
                                            </CardFooter>
                                        </Card>
                                    ))}
                                </div>
                            </div>
                        )
                    })}
                </div>
            )}

            {/* ── Seção Transbordo Global ── */}
            <div className="border rounded-xl p-5 space-y-4 mt-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <UserCheck className="h-5 w-5 text-primary" />
                        <div>
                            <h2 className="font-semibold text-base">Transbordo Humano — Global</h2>
                            <p className="text-xs text-muted-foreground">
                                Atendentes reais que recebem chamados quando a IA não consegue resolver.
                            </p>
                        </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={openCreateTrans} className="gap-2">
                        <Plus className="h-3.5 w-3.5" /> Adicionar
                    </Button>
                </div>

                {transbordos.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed">
                        <p className="text-xs">Nenhum atendente cadastrado.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                        {transbordos.map((t) => (
                            <div key={t.id} className="flex items-center justify-between p-3 rounded-lg border bg-secondary/10">
                                <div className="flex items-center gap-3">
                                    <div className="p-1.5 rounded-full bg-primary/10">
                                        <Phone className="h-4 w-4 text-primary" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium">{t.responsavel}</p>
                                        <p className="text-xs text-muted-foreground">
                                            <span className="font-mono">{t.telefone}</span>
                                            {" · "}
                                            <Badge variant="outline" className={`text-[10px] ${CANAL_BADGE_CLASS[t.modulo] || ""}`}>{t.modulo}</Badge>
                                            {t.unidade_cuca && <span className="ml-1 opacity-60">· {t.unidade_cuca}</span>}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex gap-1">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditTrans(t)}>
                                        <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                                        onClick={() => excluirTransbordo(t)}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ── Modal QR Code ── */}
            <Dialog open={!!openQr} onOpenChange={() => setOpenQr(null)}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Conectar — {openQr?.nome}</DialogTitle>
                        <DialogDescription className="text-xs">
                            Acesse o painel UAZAPI, encontre a instância <strong>{openQr?.nome}</strong> e escaneie o QR Code com o celular do canal.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex flex-col items-center gap-4 p-6 bg-muted/20 border-2 border-dashed rounded-xl">
                        <QrCode className="h-32 w-32 text-slate-300" />
                        <div className="space-y-1 text-center">
                            <p className="text-sm font-medium">Painel UAZAPI → Instâncias → QR Code</p>
                            <p className="text-xs text-muted-foreground">
                                Após escanear, o status mudará automaticamente para Conectado.
                            </p>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

            {/* ── Modal Instância ── */}
            <Dialog open={modalInst} onOpenChange={setModalInst}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editingInst ? "Editar Instância" : "Nova Instância UAZAPI"}</DialogTitle>
                        <DialogDescription className="text-xs">
                            Preencha todos os campos. O Token e Webhook são fornecidos pelo painel UAZAPI.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-2">
                        <div className="grid gap-1.5">
                            <Label>Nome da instância *</Label>
                            <Input placeholder="Ex: Cuca Barra – Institucional" value={iNome} onChange={e => setINome(e.target.value)} />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="grid gap-1.5">
                                <Label>Tipo de Canal *</Label>
                                <Select value={iCanalTipo} onValueChange={v => setICanalTipo(v as CanalTipo)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {CANAL_TIPOS.map(ct => <SelectItem key={ct} value={ct}>{ct}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-1.5">
                                <Label>Unidade CUCA</Label>
                                <Select value={iUnidade} onValueChange={setIUnidade}>
                                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="global">Global / Sem Unidade</SelectItem>
                                        {unidadesCuca.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="grid gap-1.5">
                                <Label>Telefone (com DDI)</Label>
                                <Input placeholder="+5585999998888" value={iTelefone} onChange={e => setITelefone(e.target.value)} />
                            </div>
                            <div className="grid gap-1.5">
                                <Label>Token UAZAPI</Label>
                                <Input placeholder="token_aqui" value={iToken} onChange={e => setIToken(e.target.value)} />
                            </div>
                        </div>

                        <div className="grid gap-1.5">
                            <Label>URL do Webhook</Label>
                            <Input placeholder="https://api.cucaatendemais.com.br/webhook" value={iWebhook} onChange={e => setIWebhook(e.target.value)} />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="flex items-center gap-3 p-3 rounded-lg border">
                                <Switch checked={iAtiva} onCheckedChange={setIAtiva} />
                                <div>
                                    <p className="text-sm font-medium">Ativa</p>
                                    <p className="text-xs text-muted-foreground">Instância aceitando mensagens</p>
                                </div>
                            </div>
                            <div className="flex items-center gap-3 p-3 rounded-lg border border-amber-500/20 bg-amber-500/5">
                                <Switch checked={iReserva} onCheckedChange={setIReserva} />
                                <div>
                                    <p className="text-sm font-medium text-amber-600">Reserva</p>
                                    <p className="text-xs text-muted-foreground">Standby anti-ban</p>
                                </div>
                            </div>
                        </div>

                        <div className="grid gap-1.5">
                            <Label>Observações internas</Label>
                            <Textarea placeholder="Notes sobre este chip..." value={iObs} onChange={e => setIObs(e.target.value)} rows={2} />
                        </div>
                    </div>

                    {/* S14-05: Feedback de progresso */}
                    {instProgress && (
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs text-primary">
                            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                            {instProgress}
                        </div>
                    )}

                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setModalInst(false)} disabled={savingInst}>
                            <X className="mr-2 h-4 w-4" /> Cancelar
                        </Button>
                        <Button onClick={saveInstancia} disabled={savingInst}>
                            {savingInst ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            {editingInst ? "Salvar" : "Criar Instância"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Modal Transbordo ── */}
            <Dialog open={modalTrans} onOpenChange={setModalTrans}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editingTrans ? "Editar Atendente" : "Novo Atendente de Transbordo"}</DialogTitle>
                        <DialogDescription className="text-xs">
                            Este número pessoal receberá alertas quando a IA precisar de intervenção humana.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-2">
                        <div className="grid gap-1.5">
                            <Label>Nome do Responsável *</Label>
                            <Input placeholder="Ex: João da Barra" value={tResponsavel} onChange={e => setTResponsavel(e.target.value)} />
                        </div>
                        <div className="grid gap-1.5">
                            <Label>WhatsApp pessoal (com DDI) *</Label>
                            <Input placeholder="+5585999998888" value={tTelefone} onChange={e => setTTelefone(e.target.value)} />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="grid gap-1.5">
                                <Label>Módulo</Label>
                                <Select value={tModulo} onValueChange={setTModulo}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="Institucional">Institucional</SelectItem>
                                        <SelectItem value="Empregabilidade">Empregabilidade</SelectItem>
                                        <SelectItem value="Acesso">Acesso CUCA</SelectItem>
                                        <SelectItem value="Ouvidoria">Ouvidoria</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-1.5">
                                <Label>Unidade</Label>
                                <Select value={tUnidade} onValueChange={setTUnidade}>
                                    <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="global">Global</SelectItem>
                                        {unidadesCuca.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>
                    </div>

                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setModalTrans(false)}>
                            <X className="mr-2 h-4 w-4" /> Cancelar
                        </Button>
                        <Button onClick={saveTransbordo} disabled={savingTrans}>
                            {savingTrans ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            {editingTrans ? "Salvar" : "Cadastrar"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Nota Técnica ── */}
            <div className="pt-2 border-t flex items-start gap-3 text-[11px] text-muted-foreground">
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                <p>
                    Total alvo: <strong>20 chips</strong> (12 ativos + 8 reserva). Instâncias do tipo Ouvidoria/Acesso são visíveis
                    somente para Super Admin — gerentes de unidade não têm acesso a esses canais.
                </p>
            </div>
        </div>
    )
}
