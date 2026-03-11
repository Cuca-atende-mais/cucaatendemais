"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import {
    Wifi, WifiOff, RefreshCw, QrCode, Building2, Calendar,
    Smartphone, TriangleAlert, Info, Loader2, Plus, Pencil,
    Trash2, Phone, UserCheck, Shield, X, Save, ChevronDown, Megaphone,
} from "lucide-react"
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Dialog, DialogContent, DialogDescription, DialogHeader,
    DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Switch } from "@/components/ui/switch"
import { unidadesCuca } from "@/lib/constants"
import { useUazapi } from "@/hooks/use-uazapi"

/* ─── Tipos ──────────────────────────────────────────────── */
type CanalTipo = "Institucional" | "Empregabilidade" | "Acesso" | "Ouvidoria" | "Reserva" | "Divulgação"

type Instancia = {
    id: string
    nome: string
    canal_tipo: CanalTipo
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

type UserProfile = {
    email: string | null
    unidade_cuca: string | null
    isSuperAdmin: boolean
    isGerente: boolean
}

/* ─── Constantes ─────────────────────────────────────────── */
const CANAL_TIPOS_GERENTE: CanalTipo[] = ["Institucional", "Empregabilidade"]
const CANAL_TIPOS_ADMIN: CanalTipo[] = ["Institucional", "Empregabilidade", "Acesso", "Ouvidoria", "Reserva", "Divulgação"]

const CANAL_ICONS: Record<string, React.ReactNode> = {
    Institucional: <Calendar className="h-5 w-5" />,
    Empregabilidade: <Building2 className="h-5 w-5" />,
    Acesso: <Shield className="h-5 w-5" />,
    Ouvidoria: <Phone className="h-5 w-5" />,
    Reserva: <Smartphone className="h-5 w-5" />,
    Divulgação: <Megaphone className="h-5 w-5" />,
}

const CANAL_DESC: Record<string, string> = {
    Institucional: "Programação mensal, pontual, atendimento geral",
    Empregabilidade: "Vagas, candidaturas, orientação profissional",
    Acesso: "Agendamento de espaços (GLOBAL)",
    Ouvidoria: "Críticas e sugestões (GLOBAL – Super Admin)",
    Reserva: "Chip em standby anti-ban",
    Divulgação: "Aviso mensal global para toda a Rede — Gestor Geral",
}

/* ─── Componente Principal ───────────────────────────────── */
export default function WhatsAppUnidadePage() {
    const supabase = createClient()

    const [instancias, setInstancias] = useState<Instancia[]>([])
    const [transbordos, setTransbordos] = useState<Transbordo[]>([])
    const [profile, setProfile] = useState<UserProfile | null>(null)
    const [fetching, setFetching] = useState(true)

    // Modal de Instância
    const [modalInst, setModalInst] = useState(false)
    const [editingInst, setEditingInst] = useState<Instancia | null>(null)
    const [iNome, setINome] = useState("")
    const [iCanalTipo, setICanalTipo] = useState<CanalTipo>("Institucional")
    const [iUnidade, setIUnidade] = useState("")
    const [iTelefone, setITelefone] = useState("")
    const [iReserva, setIReserva] = useState(false)
    const [iObs, setIObs] = useState("")
    const [savingInst, setSavingInst] = useState(false)

    // Modal de Transbordo
    const [modalTrans, setModalTrans] = useState(false)
    const [editingTrans, setEditingTrans] = useState<Transbordo | null>(null)
    const [tResponsavel, setTResponsavel] = useState("")
    const [tTelefone, setTTelefone] = useState("")
    const [tModulo, setTModulo] = useState("Institucional")
    const [savingTrans, setSavingTrans] = useState(false)

    const [loadingQr, setLoadingQr] = useState<string | null>(null)
    const [openQr, setOpenQr] = useState<string | null>(null)
    const [instOpened, setInstOpened] = useState<string | null>(null)

    // Hook de integração real com UAZAPI
    const { qrStatus, qrCode, criarInstancia, refreshQrCode, logoutInstancia, excluirInstancia, resetQr } = useUazapi()
    const [modalQrReal, setModalQrReal] = useState(false)
    const [nomeQrReal, setNomeQrReal] = useState("")

    useEffect(() => {
        loadAll()
    }, [])

    /* ─── Data Loading ───────────────────────────────────── */
    const loadAll = async () => {
        setFetching(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const { data: colab } = await supabase
                .from("colaboradores")
                .select("unidade_cuca, role_id")
                .eq("user_id", user.id)
                .maybeSingle()

            const { data: roleData } = await supabase
                .from("sys_roles")
                .select("name")
                .eq("id", colab?.role_id)
                .maybeSingle()

            const roleName = roleData?.name || ""
            const isSuperAdmin = ["Super Admin", "Desenvolvedor"].includes(roleName)
            const isGerente = ["Gerente", "Admin"].includes(roleName)

            const prof: UserProfile = {
                email: user.email || null,
                unidade_cuca: colab?.unidade_cuca || null,
                isSuperAdmin,
                isGerente,
            }
            setProfile(prof)

            await Promise.all([
                fetchInstancias(prof),
                fetchTransbordos(prof),
            ])
        } catch (err) {
            console.error("Erro ao carregar dados:", err)
            toast.error("Erro ao carregar dados.")
        } finally {
            setFetching(false)
        }
    }

    const fetchInstancias = async (prof: UserProfile) => {
        let query = supabase.from("instancias_uazapi").select("*").order("canal_tipo").order("nome")
        if (!prof.isSuperAdmin && prof.unidade_cuca) {
            query = query.eq("unidade_cuca", prof.unidade_cuca).not("canal_tipo", "in", '("Ouvidoria","Acesso")')
        }
        const { data } = await query
        setInstancias(data || [])
    }

    const fetchTransbordos = async (prof: UserProfile) => {
        let query = supabase.from("transbordo_humano").select("*").order("modulo").order("responsavel")
        if (!prof.isSuperAdmin && prof.unidade_cuca) {
            query = query.eq("unidade_cuca", prof.unidade_cuca)
        }
        const { data } = await query
        setTransbordos(data || [])
    }

    /* ─── CRUD Instância ─────────────────────────────────── */
    const openCreateInst = () => {
        setEditingInst(null)
        setINome("")
        setICanalTipo("Institucional")
        setIUnidade(profile?.unidade_cuca || "")
        setITelefone("")
        setIReserva(false)
        setIObs("")
        setModalInst(true)
    }

    const openEditInst = (inst: Instancia) => {
        setEditingInst(inst)
        setINome(inst.nome)
        setICanalTipo(inst.canal_tipo)
        setIUnidade(inst.unidade_cuca || "")
        setITelefone(inst.telefone || "")
        setIReserva(inst.reserva)
        setIObs(inst.observacoes || "")
        setModalInst(true)
    }

    const saveInstancia = async () => {
        if (!iNome.trim() || !iCanalTipo) {
            toast.error("Nome e Tipo de Canal são obrigatórios.")
            return
        }
        // S27-06: telefone obrigatório ao salvar instância
        if (!iTelefone.trim()) {
            toast.error("Telefone é obrigatório. Informe o número com DDI (ex: 558599999888).")
            return
        }

        setSavingInst(true)
        try {
            if (editingInst) {
                // EDITAR: atualiza apenas no banco (sem recriar na UAZAPI)
                const payload = {
                    nome: iNome.trim(),
                    canal_tipo: iCanalTipo,
                    unidade_cuca: profile?.isSuperAdmin ? (iUnidade || null) : profile?.unidade_cuca,
                    agente_tipo: iCanalTipo,
                    telefone: iTelefone.trim() || null, // S27-05: incluir telefone no payload de update
                    reserva: iReserva,
                    observacoes: iObs.trim() || null,
                    updated_at: new Date().toISOString(),
                }
                const { error } = await supabase.from("instancias_uazapi").update(payload).eq("id", editingInst.id)
                if (error) throw error
                toast.success("Instância atualizada com sucesso!")
                setModalInst(false)
                await fetchInstancias(profile!)
            } else {
                // CRIAR: chama o Worker que executa o fluxo real da UAZAPI
                // A→ POST /instance/create | B→ POST /webhook/set | C→ GET /instance/connect
                setModalInst(false)
                setNomeQrReal(iNome.trim())
                setModalQrReal(true)

                await criarInstancia(
                    {
                        nome: iNome.trim(),
                        canal_tipo: iCanalTipo,
                        unidade_cuca: profile?.isSuperAdmin ? (iUnidade || null) : profile?.unidade_cuca,
                        observacoes: iObs.trim() || null,
                    },
                    async () => {
                        // Aguarda 1.5s para o Worker processar o webhook de conexão antes de buscar
                        await new Promise(r => setTimeout(r, 1500))
                        await fetchInstancias(profile!)
                    }
                )
            }
        } catch (err: any) {
            toast.error(`Erro: ${err.message || "Tente novamente."}`)
        } finally {
            setSavingInst(false)
        }
    }

    const desativarInstancia = async (inst: Instancia) => {
        if (!confirm(`Desconectar "${inst.nome}"? O chip será desconectado com segurança. Após isso, conecte um chip de reserva.`)) return
        try {
            const ok = await logoutInstancia(inst.nome)
            if (ok) {
                toast.success("Instância desconectada com segurança.")
                await fetchInstancias(profile!)
            }
        } catch {
            toast.error("Erro ao desconectar.")
        }
    }


    /* ─── Conectar: usa QR real via modal ─────────────── */
    const conectarInstancia = async (inst: Instancia) => {
        setNomeQrReal(inst.nome)
        setModalQrReal(true)
        await refreshQrCode(inst.nome, async () => {
            await fetchInstancias(profile!)
        })
    }


    /* ─── CRUD Transbordo ────────────────────────────────── */
    const openCreateTrans = () => {
        setEditingTrans(null)
        setTResponsavel("")
        setTTelefone("")
        setTModulo("Institucional")
        setModalTrans(true)
    }

    const openEditTrans = (t: Transbordo) => {
        setEditingTrans(t)
        setTResponsavel(t.responsavel)
        setTTelefone(t.telefone)
        setTModulo(t.modulo)
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
                unidade_cuca: profile?.isSuperAdmin ? (editingTrans?.unidade_cuca || null) : profile?.unidade_cuca,
                modulo: tModulo,
                responsavel: tResponsavel.trim(),
                telefone: tTelefone.trim(),
                ativo: true,
                updated_at: new Date().toISOString(),
            }
            if (editingTrans) {
                const { error } = await supabase.from("transbordo_humano").update(payload).eq("id", editingTrans.id)
                if (error) throw error
                toast.success("Atendente atualizado!")
            } else {
                const { error } = await supabase.from("transbordo_humano").insert(payload)
                if (error) throw error
                toast.success("Atendente de transbordo cadastrado!")
            }
            setModalTrans(false)
            await fetchTransbordos(profile!)
        } catch (err: any) {
            toast.error(`Erro: ${err.message}`)
        } finally {
            setSavingTrans(false)
        }
    }

    const excluirTransbordo = async (t: Transbordo) => {
        if (!confirm(`Remover "${t.responsavel}" (${t.telefone})? Ele não receberá mais chamados de transbordo.`)) return
        try {
            await supabase.from("transbordo_humano").delete().eq("id", t.id)
            toast.success("Removido com sucesso.")
            await fetchTransbordos(profile!)
        } catch {
            toast.error("Erro ao remover.")
        }
    }

    const isDevUser = profile?.email === "valmir@cucateste.com" || profile?.email === "dev.cucaatendemais@gmail.com"

    const handleDeleteInstancia = async (inst: Instancia) => {
        if (!isDevUser) return
        if (!confirm(`TEM CERTEZA ABSOLUTA que deseja E X C L U I R permanentemente a instância "${inst.nome}" do banco e do provedor? Isso é IRREVERSÍVEL e dados podem ser perdidos.`)) return

        try {
            const result = await excluirInstancia(inst.nome)
            if (result) {
                toast.success("Instância permanentemente removida!")
                await fetchInstancias(profile!)
            }
        } catch (err: any) {
            toast.error(`Falha ao excluir: ${err.message}`)
        }
    }

    /* ─── Render ──────────────────────────────────────────── */
    if (fetching) {
        return <div className="flex justify-center py-40"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
    }

    const cantipoDisp = profile?.isSuperAdmin ? CANAL_TIPOS_ADMIN : CANAL_TIPOS_GERENTE
    const displayUnit = profile?.isSuperAdmin ? "Toda a Rede CUCA" : (profile?.unidade_cuca || "Minha Unidade")

    return (
        <div className="flex flex-col gap-8 p-2 md:p-6">

            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <Smartphone className="h-6 w-6 text-primary" />
                        WhatsApp — {displayUnit}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Gerencie os números de atendimento e os responsáveis pelo transbordo humano.
                    </p>
                </div>
                <Button onClick={openCreateInst} className="gap-2 shrink-0">
                    <Plus className="h-4 w-4" />
                    Nova Instância
                </Button>
            </div>

            {/* ── Aviso ── */}
            <Alert className="bg-amber-500/5 border-amber-500/20">
                <TriangleAlert className="h-4 w-4 text-amber-500" />
                <AlertTitle className="text-amber-500 font-semibold">Autossuficiência de Canal</AlertTitle>
                <AlertDescription className="text-xs text-muted-foreground">
                    {profile?.isSuperAdmin
                        ? "Você tem acesso a todos os 20 canais (12 ativos + 8 reserva). Os tipos Acesso e Ouvidoria são exclusivos do Super Admin."
                        : `Você gerencia os canais Institucional e Empregabilidade da ${profile?.unidade_cuca}. Em caso de ban, clique em "Recuperar Ban / Trocar Chip" e conecte um chip de reserva.`}
                </AlertDescription>
            </Alert>

            {/* ── Grid de Instâncias ── */}
            {instancias.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground border rounded-xl border-dashed">
                    <Smartphone className="h-12 w-12 mx-auto mb-4 opacity-20" />
                    <p className="font-medium">Nenhuma instância cadastrada</p>
                    <p className="text-xs mt-1">Clique em "Nova Instância" para configurar o primeiro canal.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                    {instancias.map((inst) => (
                        <Card key={inst.id}
                            className={`border-border/50 shadow-sm relative overflow-hidden hover:border-primary/30 transition-all
                                ${inst.reserva ? "border-dashed opacity-75" : ""}
                                ${!inst.ativa && !inst.reserva ? "border-destructive/20" : ""}
                            `}
                        >
                            {/* Badge reserva */}
                            {inst.reserva && (
                                <div className="absolute top-0 left-0 right-0 bg-amber-500/10 text-amber-600 text-[10px] font-semibold py-1 text-center tracking-wider uppercase">
                                    🛡️ Chip Reserva — Anti-Ban
                                </div>
                            )}

                            <CardHeader className={inst.reserva ? "mt-6" : ""}>
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <div className={`p-2 rounded-full ${inst.ativa ? "bg-emerald-500/10 text-emerald-600" : "bg-muted text-muted-foreground"}`}>
                                            {CANAL_ICONS[inst.canal_tipo] || <Smartphone className="h-5 w-5" />}
                                        </div>
                                        <div>
                                            <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                                                {inst.canal_tipo}
                                            </Badge>
                                            {profile?.isSuperAdmin && inst.unidade_cuca && (
                                                <p className="text-[10px] text-muted-foreground mt-0.5">{inst.unidade_cuca}</p>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-7 w-7"
                                            onClick={() => openEditInst(inst)}
                                            title="Editar Instância"
                                        >
                                            <Pencil className="h-3.5 w-3.5 text-muted-foreground hover:text-primary transition-colors" />
                                        </Button>
                                        {inst.ativa
                                            ? <Wifi className="h-5 w-5 text-emerald-500" />
                                            : <WifiOff className="h-5 w-5 text-muted-foreground/40" />}
                                    </div>
                                </div>
                                <CardTitle className="text-base mt-2">{inst.nome}</CardTitle>
                                <CardDescription className="text-xs">{CANAL_DESC[inst.canal_tipo]}</CardDescription>
                            </CardHeader>

                            <CardContent className="space-y-2 text-xs">
                                <div className="flex justify-between py-1.5 border-b border-dashed">
                                    <span className="text-muted-foreground">Status:</span>
                                    <Badge variant={inst.ativa ? "default" : "secondary"}
                                        className={inst.ativa ? "bg-emerald-500 text-white text-[10px]" : "text-[10px]"}>
                                        {inst.ativa ? "✓ Ativo" : "Desconectado"}
                                    </Badge>
                                </div>
                                <div className="flex justify-between py-1.5 border-b border-dashed">
                                    <span className="text-muted-foreground">Número:</span>
                                    <span className="font-mono">{inst.telefone || "—"}</span>
                                </div>
                                <div className="flex justify-between py-1.5">
                                    <span className="text-muted-foreground">Token:</span>
                                    <Badge variant="outline" className="text-[10px]">
                                        {inst.token ? "✓ Configurado" : "⚠ Pendente"}
                                    </Badge>
                                </div>
                            </CardContent>

                            <CardFooter className="flex flex-col gap-2 bg-secondary/10 pt-3 border-t">

                                {/* Conectar / Desativar */}
                                {inst.ativa ? (
                                    <Button
                                        variant="ghost" size="sm"
                                        className="w-full h-8 text-[11px] text-amber-600 hover:bg-amber-500/10"
                                        onClick={() => desativarInstancia(inst)}
                                    >
                                        <RefreshCw className="mr-1.5 h-3 w-3" /> Desconectar / Trocar Chip
                                    </Button>
                                ) : (
                                    <div className="w-full flex flex-col gap-2">
                                        {!inst.ativa && !inst.reserva && inst.token ? (
                                            <>
                                                <div className="bg-destructive/10 text-destructive text-xs p-2 rounded flex items-center gap-2 mb-1 border border-destructive/20">
                                                    <TriangleAlert className="h-4 w-4 shrink-0" />
                                                    <span><b>Desconectado.</b> Conecte o chip novamente ou um reserva.</span>
                                                </div>
                                                <Button
                                                    variant="secondary" size="sm"
                                                    className="w-full h-8 text-[11px]"
                                                    onClick={() => desativarInstancia(inst)}
                                                >
                                                    <RefreshCw className="mr-1.5 h-3 w-3" /> Limpar Sessão / Trocar Chip
                                                </Button>
                                            </>
                                        ) : (
                                            <Button
                                                size="sm"
                                                className="w-full h-8 text-[11px]"
                                                onClick={() => conectarInstancia(inst)}
                                                disabled={loadingQr === inst.id}
                                            >
                                                {loadingQr === inst.id
                                                    ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                                                    : <QrCode className="mr-1.5 h-3 w-3" />}
                                                Conectar WhatsApp (QR)
                                            </Button>
                                        )}
                                    </div>
                                )}

                                {/* Exclusão Definitiva P/ Developers */}
                                {isDevUser && (
                                    <Button
                                        variant="outline" size="sm"
                                        className="w-full h-8 text-[11px] text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700 mt-1"
                                        onClick={() => handleDeleteInstancia(inst)}
                                    >
                                        <Trash2 className="mr-1.5 h-3 w-3" /> Deletar Instância Permanentemente
                                    </Button>
                                )}
                            </CardFooter>
                        </Card>
                    ))}
                </div>
            )
            }

            {/* ── Modal QR Code REAL (base64 via UAZAPI) ── */}
            <Dialog open={modalQrReal} onOpenChange={(open) => {
                if (!open) {
                    resetQr()
                    setModalQrReal(false)
                    // Sempre atualiza a lista ao fechar o modal — independente do timing do onConnected
                    if (profile) fetchInstancias(profile)
                }
            }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <QrCode className="h-5 w-5 text-primary" />
                            Parear WhatsApp — {nomeQrReal}
                        </DialogTitle>
                        <DialogDescription className="text-xs">
                            Abra o WhatsApp Business no celular → Dispositivos Vinculados → Vincular dispositivo → leia o QR Code abaixo.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-col items-center gap-4 py-2">
                        {qrStatus === "loading" && (
                            <div className="flex flex-col items-center gap-3 py-8">
                                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                                <p className="text-sm text-muted-foreground">Criando instância na UAZAPI...</p>
                            </div>
                        )}

                        {qrStatus === "qr_ready" && qrCode && (
                            <>
                                <div className="bg-white p-3 rounded-xl border-2 border-primary/20">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
                                        alt="QR Code WhatsApp"
                                        className="w-48 h-48"
                                    />
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <div className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                                    Aguardando leitura... (verificando a cada 3s)
                                </div>
                                <p className="text-[11px] text-muted-foreground text-center">
                                    O QR Code expira em 30 segundos. Leia rápido!
                                </p>
                            </>
                        )}

                        {qrStatus === "connected" && (
                            <div className="flex flex-col items-center gap-3 py-8 text-emerald-600">
                                <div className="h-16 w-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
                                    <Wifi className="h-8 w-8" />
                                </div>
                                <p className="font-semibold text-lg">✅ WhatsApp Conectado!</p>
                                <p className="text-xs text-muted-foreground text-center">
                                    A instância foi ativada automaticamente. O atendimento está ativo.
                                </p>
                                <Button onClick={() => { resetQr(); setModalQrReal(false) }} className="mt-2">
                                    Fechar
                                </Button>
                            </div>
                        )}

                        {qrStatus === "error" && (
                            <div className="flex flex-col items-center gap-3 py-6 text-destructive">
                                <TriangleAlert className="h-10 w-10" />
                                <p className="font-medium">Falha ao gerar QR Code</p>
                                <p className="text-xs text-muted-foreground text-center">
                                    Verifique se o Worker está online (UAZAPI_MASTER_TOKEN configurado) e tente novamente.
                                </p>
                                <Button variant="outline" onClick={() => { resetQr(); setModalQrReal(false) }}>
                                    Fechar
                                </Button>
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>


            {/* ── Seção Transbordo Humano ── */}
            <div className="border rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <UserCheck className="h-5 w-5 text-primary" />
                        <div>
                            <h2 className="font-semibold text-base">Transbordo Humano</h2>
                            <p className="text-xs text-muted-foreground">
                                Quando a IA não consegue ajudar, o sistema encaminha para estes números.
                            </p>
                        </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={openCreateTrans} className="gap-2">
                        <Plus className="h-3.5 w-3.5" /> Adicionar
                    </Button>
                </div>

                {transbordos.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed">
                        <UserCheck className="h-8 w-8 mx-auto mb-2 opacity-20" />
                        <p className="text-xs">Nenhum atendente cadastrado.</p>
                    </div>
                ) : (
                    <div className="space-y-2">
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
                                            <Badge variant="outline" className="text-[10px]">{t.modulo}</Badge>
                                        </p>
                                    </div>
                                </div>
                                <div className="flex gap-1">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditTrans(t)}>
                                        <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => excluirTransbordo(t)}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ── Modal Instância ── */}
            <Dialog open={modalInst} onOpenChange={setModalInst}>
                <DialogContent className="sm:max-w-lg">
                    <DialogHeader>
                        <DialogTitle>{editingInst ? "Editar Instância" : "Nova Instância WhatsApp"}</DialogTitle>
                        <DialogDescription className="text-xs">
                            {editingInst
                                ? "Atualize os dados do canal de atendimento."
                                : "Configure um novo canal de atendimento para sua unidade."}
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-2">
                        <div className="grid gap-1.5">
                            <Label>Nome da Instância *</Label>
                            <Input
                                placeholder="Ex: Cuca Barra – Institucional"
                                value={iNome}
                                onChange={(e) => setINome(e.target.value)}
                            />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div className="grid gap-1.5">
                                <Label>Tipo de Canal *</Label>
                                <Select value={iCanalTipo} onValueChange={(v) => setICanalTipo(v as CanalTipo)}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        {cantipoDisp.map(ct => (
                                            <SelectItem key={ct} value={ct}>{ct}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            {profile?.isSuperAdmin && (
                                <div className="grid gap-1.5">
                                    <Label>Unidade CUCA</Label>
                                    <Select value={iUnidade} onValueChange={setIUnidade}>
                                        <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="">Global (Todos)</SelectItem>
                                            {unidadesCuca.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        </div>

                        <div className="grid gap-1.5">
                            <Label>Telefone (com DDI)
                                <span className="ml-1 text-[10px] text-muted-foreground font-normal">(opcional — preenchido automaticamente ao parear)</span>
                            </Label>
                            <Input
                                placeholder="+5585999998888"
                                value={iTelefone}
                                onChange={(e) => setITelefone(e.target.value)}
                            />
                        </div>

                        <div className="flex items-center gap-3 p-3 rounded-lg border bg-amber-500/5">
                            <Switch checked={iReserva} onCheckedChange={setIReserva} />
                            <div>
                                <p className="text-sm font-medium">Chip de Reserva</p>
                                <p className="text-xs text-muted-foreground">Não processa mensagens. Em standby para substituição anti-ban.</p>
                            </div>
                        </div>

                        <div className="grid gap-1.5">
                            <Label>Observações (opcional)</Label>
                            <Textarea
                                placeholder="Notas internas sobre este canal..."
                                value={iObs}
                                onChange={(e) => setIObs(e.target.value)}
                                rows={2}
                            />
                        </div>
                    </div>

                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setModalInst(false)}>
                            <X className="mr-2 h-4 w-4" /> Cancelar
                        </Button>
                        <Button onClick={saveInstancia} disabled={savingInst}>
                            {savingInst
                                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                : <Save className="mr-2 h-4 w-4" />}
                            {editingInst ? "Salvar Alterações" : "Criar Instância"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Modal Transbordo ── */}
            <Dialog open={modalTrans} onOpenChange={setModalTrans}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editingTrans ? "Editar Atendente de Transbordo" : "Novo Atendente de Transbordo"}</DialogTitle>
                        <DialogDescription className="text-xs">
                            Quando a IA não conseguir resolver, o sistema enviará um alerta para este número pessoal.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-2">
                        <div className="grid gap-1.5">
                            <Label>Nome do Responsável *</Label>
                            <Input
                                placeholder="Ex: Mariazinha do RH"
                                value={tResponsavel}
                                onChange={(e) => setTResponsavel(e.target.value)}
                            />
                        </div>
                        <div className="grid gap-1.5">
                            <Label>WhatsApp Pessoal (com DDI) *</Label>
                            <Input
                                placeholder="+5585999998888"
                                value={tTelefone}
                                onChange={(e) => setTTelefone(e.target.value)}
                            />
                        </div>
                        <div className="grid gap-1.5">
                            <Label>Módulo de Atuação</Label>
                            <Select value={tModulo} onValueChange={setTModulo}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="Institucional">Institucional (Maria)</SelectItem>
                                    <SelectItem value="Empregabilidade">Empregabilidade (Júlia)</SelectItem>
                                    <SelectItem value="Acesso">Acesso CUCA (Ana)</SelectItem>
                                    <SelectItem value="Ouvidoria">Ouvidoria (Sofia)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setModalTrans(false)}>
                            <X className="mr-2 h-4 w-4" /> Cancelar
                        </Button>
                        <Button onClick={saveTransbordo} disabled={savingTrans}>
                            {savingTrans
                                ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                : <Save className="mr-2 h-4 w-4" />}
                            {editingTrans ? "Salvar" : "Cadastrar"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Footer info ── */}
            <div className="pt-2 border-t flex items-start gap-3 text-[11px] text-muted-foreground">
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                <p>
                    Após criar, configure o Token e Webhook no campo "Editar". Conecte o celular físico via "QR Code" acima.
                    Nunca use WhatsApp pessoal como canal do sistema.
                </p>
            </div>
        </div >
    )
}
