"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import {
    Wifi,
    WifiOff,
    RefreshCw,
    QrCode,
    Building2,
    Calendar,
    Smartphone,
    TriangleAlert,
    Info,
    Loader2,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select"

type InstanceType = {
    id: string
    name: string
    category: string
    unit: string
    status: "connected" | "disconnected" | "error"
    phone?: string | null
    token?: string
}

type UserProfile = {
    unidade_cuca: string | null
    isSuperAdmin: boolean
}

const TODAS_UNIDADES = [
    "Cuca Barra",
    "Cuca Mondubim",
    "Cuca Jangurussu",
    "Cuca José Walter",
    "Cuca Pici",
]

export default function WhatsAppUnidadePage() {
    const supabase = createClient()
    const [instances, setInstances] = useState<InstanceType[]>([])
    const [loadingAction, setLoadingAction] = useState<string | null>(null)
    const [fetching, setFetching] = useState(true)
    const [profile, setProfile] = useState<UserProfile | null>(null)
    const [selectedUnit, setSelectedUnit] = useState<string>("all")

    useEffect(() => {
        loadProfileAndInstances()
    }, [])

    const loadProfileAndInstances = async () => {
        setFetching(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            // Busca perfil do colaborador
            const { data: colab } = await supabase
                .from("colaboradores")
                .select("unidade_cuca, funcao_id")
                .eq("user_id", user.id)
                .maybeSingle()

            // Verifica se é super admin (sem unidade vinculada ou com flag)
            const isSuperAdmin = !colab?.unidade_cuca

            const userProfile: UserProfile = {
                unidade_cuca: colab?.unidade_cuca || null,
                isSuperAdmin,
            }
            setProfile(userProfile)

            await fetchInstances(userProfile)
        } catch (err) {
            console.error("Erro ao carregar perfil:", err)
            toast.error("Erro ao carregar dados do usuário.")
        } finally {
            setFetching(false)
        }
    }

    const fetchInstances = async (userProfile?: UserProfile) => {
        const prof = userProfile || profile
        if (!prof) return

        try {
            let query = supabase
                .from("instancias_uazapi")
                .select("*")
                .order("unidade_cuca")
                .order("nome")

            // Se não for super admin, filtra pela unidade do colaborador
            if (!prof.isSuperAdmin && prof.unidade_cuca) {
                query = query.eq("unidade_cuca", prof.unidade_cuca)
            }

            const { data, error } = await query
            if (error) throw error

            const mapped: InstanceType[] = (data || []).map(row => ({
                id: row.id,
                name: row.nome,
                category: row.agente_tipo || "Geral",
                unit: row.unidade_cuca || "—",
                status: row.ativa ? "connected" : "disconnected",
                phone: row.telefone,
                token: row.token,
            }))

            setInstances(mapped)
        } catch (err) {
            console.error("Erro ao carregar instâncias:", err)
            toast.error("Erro ao carregar instâncias.")
        }
    }

    const handleConnect = async (id: string) => {
        setLoadingAction(id)
        try {
            const { error } = await supabase.from("instancias_uazapi").update({ ativa: true }).eq("id", id)
            if (error) throw error
            toast.success("Instância marcada como ativa. Configure o QR Code no painel UAZAPI.")
            await fetchInstances()
        } catch {
            toast.error("Erro ao ativar instância.")
        } finally {
            setLoadingAction(null)
        }
    }

    const handleLogout = async (id: string) => {
        if (!confirm("Isso desconectará o número atual. Você tem um chip novo para conectar em seguida?")) return
        setLoadingAction(id)
        try {
            const { error } = await supabase.from("instancias_uazapi").update({ ativa: false, telefone: null }).eq("id", id)
            if (error) throw error
            toast.success("Número desconectado. Pronto para conectar chip reserva.")
            await fetchInstances()
        } catch {
            toast.error("Erro ao desconectar.")
        } finally {
            setLoadingAction(null)
        }
    }

    // Filtra por unidade selecionada (para Super Admin)
    const filteredInstances = profile?.isSuperAdmin && selectedUnit !== "all"
        ? instances.filter(i => i.unit === selectedUnit)
        : instances

    if (fetching) {
        return (
            <div className="flex justify-center py-40">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    const displayUnit = profile?.isSuperAdmin ? "Rede CUCA" : (profile?.unidade_cuca || "sua unidade")

    return (
        <div className="flex flex-col gap-6 p-2 md:p-6">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <Smartphone className="h-6 w-6 text-primary" />
                        WhatsApp — {displayUnit}
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">
                        Gerenciamento autônomo de conexão para os canais de atendimento.
                    </p>
                </div>

                {/* Filtro de unidade para Super Admin */}
                {profile?.isSuperAdmin && (
                    <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground" />
                        <Select value={selectedUnit} onValueChange={setSelectedUnit}>
                            <SelectTrigger className="w-[200px]">
                                <SelectValue placeholder="Todas as Unidades" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todas as Unidades</SelectItem>
                                {TODAS_UNIDADES.map(u => (
                                    <SelectItem key={u} value={u}>{u}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                )}
            </div>

            {/* Aviso de Auto-Serviço */}
            <Alert className="bg-primary/5 border-primary/20">
                <Info className="h-4 w-4 text-primary" />
                <AlertTitle className="text-primary font-semibold">Autonomia de Unidade</AlertTitle>
                <AlertDescription className="text-xs">
                    Se o seu número for banido, você não precisa ligar para a central.
                    Basta clicar em <strong>"Recuperar Ban / Trocar Chip"</strong> abaixo, inserir um chip novo no
                    aparelho da unidade e escanear o novo QR Code no painel UAZAPI.
                    A inteligência artificial voltará a funcionar instantaneamente com o novo número.
                </AlertDescription>
            </Alert>

            {/* Instâncias */}
            {filteredInstances.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground border rounded-xl border-dashed">
                    <Smartphone className="h-12 w-12 mx-auto mb-4 opacity-20" />
                    <p className="font-medium">Nenhuma instância encontrada</p>
                    <p className="text-xs mt-1">
                        {profile?.isSuperAdmin
                            ? "Verifique se as instâncias foram cadastradas no banco de dados."
                            : "Seu perfil não possui instâncias WhatsApp configuradas. Contate o administrador."}
                    </p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {filteredInstances.map((inst) => (
                        <Card key={inst.id} className="border-primary/10 shadow-sm relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-3">
                                {inst.status === "connected" ? (
                                    <Wifi className="h-5 w-5 text-emerald-500" />
                                ) : (
                                    <WifiOff className="h-5 w-5 text-muted-foreground opacity-40" />
                                )}
                            </div>

                            <CardHeader>
                                <div className="flex items-center gap-2 mb-2">
                                    <div className="p-2 rounded-full bg-primary/10 text-primary">
                                        {inst.category === "Empregabilidade"
                                            ? <Building2 className="h-5 w-5" />
                                            : <Calendar className="h-5 w-5" />}
                                    </div>
                                    <div className="flex flex-col gap-0.5">
                                        <Badge variant="outline" className="font-normal text-[10px] uppercase tracking-wider w-fit">
                                            {inst.category}
                                        </Badge>
                                        {profile?.isSuperAdmin && (
                                            <span className="text-[10px] text-muted-foreground">{inst.unit}</span>
                                        )}
                                    </div>
                                </div>
                                <CardTitle className="text-lg">{inst.name}</CardTitle>
                                <CardDescription className="text-xs">
                                    Canal oficial de {inst.category.toLowerCase()} — {inst.unit}
                                </CardDescription>
                            </CardHeader>

                            <CardContent>
                                <div className="space-y-3">
                                    <div className="flex justify-between items-center py-2 border-b border-dashed">
                                        <span className="text-xs text-muted-foreground">Status:</span>
                                        <Badge
                                            variant={inst.status === "connected" ? "default" : "secondary"}
                                            className={inst.status === "connected" ? "bg-emerald-500" : ""}
                                        >
                                            {inst.status === "connected" ? "✓ Ativo" : "Desconectado"}
                                        </Badge>
                                    </div>
                                    <div className="flex justify-between items-center py-2 border-b border-dashed">
                                        <span className="text-xs text-muted-foreground">Número:</span>
                                        <span className="text-sm font-mono">
                                            {inst.phone || "Aguardando conexão..."}
                                        </span>
                                    </div>
                                    <div className="flex justify-between items-center py-2">
                                        <span className="text-xs text-muted-foreground">Token UAZAPI:</span>
                                        <Badge variant="outline" className="text-[10px]">
                                            {inst.token === "CONFIGURAR" ? "⚠ Pendente" : "✓ Configurado"}
                                        </Badge>
                                    </div>
                                </div>
                            </CardContent>

                            <CardFooter className="flex gap-3 bg-secondary/10 pt-4">
                                {inst.status === "connected" ? (
                                    <Button
                                        variant="outline"
                                        className="w-full text-destructive border-destructive/20 hover:bg-destructive/5 h-10"
                                        onClick={() => handleLogout(inst.id)}
                                        disabled={loadingAction === inst.id}
                                    >
                                        {loadingAction === inst.id
                                            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            : <RefreshCw className="mr-2 h-4 w-4" />}
                                        Recuperar Ban / Trocar Chip
                                    </Button>
                                ) : (
                                    <Dialog>
                                        <DialogTrigger asChild>
                                            <Button
                                                className="w-full h-10 bg-primary hover:bg-primary/90"
                                                onClick={() => handleConnect(inst.id)}
                                                disabled={loadingAction === inst.id}
                                            >
                                                {loadingAction === inst.id
                                                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                    : <QrCode className="mr-2 h-4 w-4" />}
                                                Conectar WhatsApp
                                            </Button>
                                        </DialogTrigger>
                                        <DialogContent className="sm:max-w-md">
                                            <DialogHeader>
                                                <DialogTitle>Vincular WhatsApp — {inst.name}</DialogTitle>
                                                <DialogDescription className="text-xs">
                                                    Use o celular oficial da unidade {inst.unit} para escanear.
                                                    A automação assumirá o controle deste chip imediatamente.
                                                </DialogDescription>
                                            </DialogHeader>
                                            <div className="flex flex-col items-center gap-4 p-6 bg-muted/20 border-2 border-dashed rounded-xl">
                                                <QrCode className="h-40 w-40 text-slate-200" />
                                                <div className="text-center space-y-1">
                                                    <p className="text-sm font-medium">QR Code — Painel UAZAPI</p>
                                                    <p className="text-xs text-muted-foreground">
                                                        Acesse o painel UAZAPI e escaneie o QR Code da instância{" "}
                                                        <strong>{inst.name}</strong> com o celular da unidade.
                                                    </p>
                                                </div>
                                                <div className="w-full space-y-2 pt-2 border-t">
                                                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                                        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                                        Webhook configurado e aguardando conexão
                                                    </div>
                                                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                                        <div className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                                                        Instância registrada no banco: {inst.unit}
                                                    </div>
                                                </div>
                                            </div>
                                        </DialogContent>
                                    </Dialog>
                                )}
                            </CardFooter>

                            {/* Banner de Banimento */}
                            {inst.status === "error" && (
                                <div className="absolute inset-0 bg-destructive/90 flex flex-col items-center justify-center p-6 text-center text-white rounded-xl">
                                    <TriangleAlert className="h-12 w-12 mb-2" />
                                    <h3 className="font-bold text-lg">Número Banido</h3>
                                    <p className="text-xs mb-4">A Meta desconectou este chip por comportamento suspeito.</p>
                                    <Button variant="secondary" className="w-full" onClick={() => handleLogout(inst.id)}>
                                        Conectar Chip Reserva
                                    </Button>
                                </div>
                            )}
                        </Card>
                    ))}
                </div>
            )}

            <div className="mt-auto pt-4 border-t flex items-start gap-3 text-[11px] text-muted-foreground">
                <Info className="h-4 w-4 mt-0.5 shrink-0" />
                <p>
                    Após conectar, configure o <strong>Token UAZAPI</strong> e o <strong>Webhook</strong> corretamente
                    no Developer Console → Instâncias. Nunca use o WhatsApp pessoal para as instâncias do sistema.
                </p>
            </div>
        </div>
    )
}
