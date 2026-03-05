"use client"

import { useEffect, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import {
    Megaphone, CheckCircle2, Clock, AlertCircle, Send,
    RefreshCw, BarChart3, MessageSquare, Loader2, Radio,
    Building2, CalendarCheck, ShieldAlert, Info, ChevronDown,
    Wifi, WifiOff, QrCode, Settings, ExternalLink,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
    Dialog, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { unidadesCuca } from "@/lib/constants"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"

/* ─── Tipos ─── */
type StatusCampanha = "sem_planilha" | "pendente" | "aprovado"
type StatusDisparo = "pendente" | "em_andamento" | "concluido" | "pausado" | "erro"
type ChipStatus = "connected" | "disconnected" | "unknown"

type ChipDetalhes = {
    nome: string
    telefone: string | null
    token: string | null
    status: ChipStatus
}

type UnidadeStatus = {
    unidade: string
    status: StatusCampanha
    total_atividades: number
    campanha_id: string | null
    updated_at: string | null
}

type DisparoHistorico = {
    id: string
    titulo: string | null
    mes: number
    ano: number
    status: StatusDisparo
    total_leads: number
    total_enviados: number
    total_erros: number
    total_stop: number
    created_at: string
}

/* ─── Constantes ─── */
const MESES = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]

const STATUS_CONFIG: Record<StatusCampanha, { label: string; color: string; icon: React.ReactNode }> = {
    sem_planilha: {
        label: "Sem planilha",
        color: "bg-slate-100 text-slate-600 border-slate-200",
        icon: <AlertCircle className="h-3.5 w-3.5" />,
    },
    pendente: {
        label: "Aguardando aprovação",
        color: "bg-amber-100 text-amber-700 border-amber-200",
        icon: <Clock className="h-3.5 w-3.5" />,
    },
    aprovado: {
        label: "Aprovada ✓",
        color: "bg-green-100 text-green-700 border-green-200",
        icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    },
}

const DISPARO_STATUS_CONFIG: Record<StatusDisparo, { label: string; color: string }> = {
    pendente: { label: "Na fila", color: "bg-blue-100 text-blue-700" },
    em_andamento: { label: "Enviando...", color: "bg-amber-100 text-amber-700" },
    concluido: { label: "Concluído", color: "bg-green-100 text-green-700" },
    pausado: { label: "Pausado", color: "bg-orange-100 text-orange-700" },
    erro: { label: "Erro", color: "bg-red-100 text-red-700" },
}

/* ─── Componente ─── */
export default function DivulgacaoPage() {
    const router = useRouter()
    const supabase = createClient()
    const hoje = new Date()
    const [mesAtual] = useState(hoje.getMonth() + 1)
    const [anoAtual] = useState(hoje.getFullYear())

    const [carregando, setCarregando] = useState(true)
    const [semPermissao, setSemPermissao] = useState(false)
    const [unidades, setUnidades] = useState<UnidadeStatus[]>([])
    const [historico, setHistorico] = useState<DisparoHistorico[]>([])

    // Modal de disparo
    const [modalAberto, setModalAberto] = useState(false)
    const [template, setTemplate] = useState("")
    const [instanciaDisp, setInstanciaDisp] = useState<string | null>(null)
    const [chipDetalhes, setChipDetalhes] = useState<ChipDetalhes | null>(null)
    const [chipStatusReq, setChipStatusReq] = useState(false)
    const [disparando, setDisparando] = useState(false)
    const [qrModal, setQrModal] = useState(false)
    const [qrCode, setQrCode] = useState<string | null>(null)

    const fetchData = useCallback(async () => {
        setCarregando(true)
        try {
            // 1. Verificar permissão
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) { router.push("/login"); return }

            const { data: perfil } = await supabase
                .from("user_profiles")
                .select("role_id")
                .eq("id", user.id)
                .single()

            if (perfil?.role_id) {
                const { count } = await supabase
                    .from("sys_permissions")
                    .select("*", { count: "exact", head: true })
                    .eq("role_id", perfil.role_id)
                    .eq("module", "divulgacao")
                    .eq("can_read", true)

                // Developer sempre tem acesso
                const { data: role } = await supabase
                    .from("sys_roles")
                    .select("name")
                    .eq("id", perfil.role_id)
                    .single()

                if (count === 0 && role?.name !== "Developer") {
                    setSemPermissao(true)
                    return
                }
            }

            // 2. Buscar status das campanhas do mês atual por unidade
            const { data: campanhas } = await supabase
                .from("campanhas_mensais")
                .select("id, unidade_cuca, status, total_atividades, updated_at")
                .eq("mes", mesAtual)
                .eq("ano", anoAtual)

            const statusPorUnidade: UnidadeStatus[] = unidadesCuca.map(u => {
                const camp = campanhas?.find(c => c.unidade_cuca === u)
                return {
                    unidade: u,
                    status: (camp?.status as StatusCampanha) ?? "sem_planilha",
                    total_atividades: camp?.total_atividades ?? 0,
                    campanha_id: camp?.id ?? null,
                    updated_at: camp?.updated_at ?? null,
                }
            })
            setUnidades(statusPorUnidade)

            // 3. Buscar instância Divulgação ativa (detalhes completos)
            const { data: inst } = await supabase
                .from("instancias_uazapi")
                .select("nome, telefone, token")
                .eq("canal_tipo", "Divulgação")
                .eq("ativa", true)
                .limit(1)
                .maybeSingle()

            setInstanciaDisp(inst?.nome ?? null)

            if (inst) {
                // Checar status de conexão via UAZAPI
                try {
                    const UAZAPI_URL = process.env.NEXT_PUBLIC_UAZAPI_URL || "https://uazapi.com.br"
                    const statusRes = await fetch(`${UAZAPI_URL}/instance/connectionState/${inst.nome}`, {
                        headers: { "apikey": inst.token || "" }
                    })
                    const statusJson = statusRes.ok ? await statusRes.json() : null
                    const isConnected = statusJson?.state === "open" || statusJson?.status?.connected === true
                    setChipDetalhes({
                        nome: inst.nome,
                        telefone: inst.telefone,
                        token: inst.token,
                        status: isConnected ? "connected" : "disconnected",
                    })
                } catch {
                    setChipDetalhes({ nome: inst.nome, telefone: inst.telefone, token: inst.token, status: "unknown" })
                }
            } else {
                setChipDetalhes(null)
            }

            // 4. Histórico de disparos
            const { data: hist } = await supabase
                .from("disparos_divulgacao")
                .select("id, titulo, mes, ano, status, total_leads, total_enviados, total_erros, total_stop, created_at")
                .order("created_at", { ascending: false })
                .limit(10)
            setHistorico(hist ?? [])

        } catch (e: any) {
            toast.error("Erro ao carregar: " + e.message)
        } finally {
            setCarregando(false)
        }
    }, [mesAtual, anoAtual])

    useEffect(() => { fetchData() }, [fetchData])

    // Montar template padrão quando abrir o modal
    const abrirModal = () => {
        const nomeMes = MESES[mesAtual - 1]
        const tpl = `🎉 A programação de ${nomeMes}/${anoAtual} chegou! Acesse o Portal da Juventude: cucaatendemais.com.br

Para saber o que rola no seu CUCA, fale direto:
📍 CUCA Barra: [wa.me/+55...]
📍 CUCA Mondubim: [wa.me/+55...]
📍 CUCA Jangurussu: [wa.me/+55...]
📍 CUCA José Walter: [wa.me/+55...]
📍 CUCA Pici: [wa.me/+55...]`
        setTemplate(tpl)
        setModalAberto(true)
    }

    const handleDisparar = async () => {
        if (!template.trim()) { toast.error("Escreva a mensagem antes de disparar."); return }
        setDisparando(true)
        try {
            const res = await fetch("/api/divulgacao/disparar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    mes: mesAtual,
                    ano: anoAtual,
                    titulo: `Aviso Programação ${MESES[mesAtual - 1]}/${anoAtual}`,
                    mensagem_template: template,
                })
            })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error || "Falha na API")
            }
            toast.success("Disparo criado e na fila! O motor iniciará o envio em instantes.")
            setModalAberto(false)
            fetchData()
        } catch (e: any) {
            toast.error("Erro: " + e.message)
        } finally {
            setDisparando(false)
        }
    }

    const aprovadas = unidades.filter(u => u.status === "aprovado").length
    const podeDiparar = aprovadas > 0 && !!instanciaDisp

    if (carregando) {
        return (
            <div className="flex-1 flex items-center justify-center p-12">
                <Loader2 className="h-8 w-8 animate-spin text-yellow-500" />
            </div>
        )
    }

    if (semPermissao) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-12 gap-4 text-center">
                <ShieldAlert className="h-16 w-16 text-slate-300" />
                <h2 className="text-xl font-bold text-slate-700">Acesso Restrito</h2>
                <p className="text-slate-500 max-w-sm">Este módulo é exclusivo do Gestor de Divulgação. Solicite permissão ao Developer.</p>
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col gap-6 p-4 lg:p-8">
            {/* Header */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-yellow-100 border border-yellow-200">
                        <Megaphone className="h-6 w-6 text-yellow-600" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-slate-800">Central de Divulgação</h1>
                        <p className="text-sm text-slate-500">
                            {MESES[mesAtual - 1]}/{anoAtual} — {aprovadas} de {unidadesCuca.length} unidades aprovadas
                        </p>
                    </div>
                </div>
                <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={fetchData}>
                        <RefreshCw className="h-4 w-4 mr-1.5" /> Atualizar
                    </Button>
                    <Button
                        className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold gap-2"
                        onClick={abrirModal}
                        disabled={!podeDiparar}
                    >
                        <Radio className="h-4 w-4" />
                        Disparar Aviso Global
                    </Button>
                </div>
            </div>

            {/* S9-11: Chip Divulgação — Status e QR Code */}
            <Card className="shadow-sm border-slate-100">
                <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between text-base">
                        <span className="flex items-center gap-2">
                            <Radio className="h-5 w-5 text-yellow-500" />
                            Chip de Divulgação
                        </span>
                        <a href="/configuracoes/whatsapp" className="text-xs text-blue-500 hover:underline flex items-center gap-1">
                            <Settings className="h-3.5 w-3.5" /> Gerenciar em Config
                        </a>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {!chipDetalhes ? (
                        <div className="flex items-center gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-sm">
                            <AlertCircle className="h-4 w-4 shrink-0" />
                            <div>
                                <p className="font-semibold">Nenhuma instância Divulgação criada.</p>
                                <p className="text-xs mt-0.5">Vá em <strong>Configurações → WhatsApp</strong> e crie uma instância do tipo <strong>Divulgação</strong>.</p>
                            </div>
                        </div>
                    ) : (
                        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-3 rounded-lg border border-slate-100 bg-slate-50">
                            <div className="flex items-center gap-3">
                                {chipDetalhes.status === "connected" ? (
                                    <Wifi className="h-5 w-5 text-green-500" />
                                ) : (
                                    <WifiOff className="h-5 w-5 text-red-400" />
                                )}
                                <div>
                                    <p className="font-semibold text-slate-700 text-sm">{chipDetalhes.nome}</p>
                                    <p className="text-xs text-slate-500">{chipDetalhes.telefone ?? "Número não registrado"}</p>
                                </div>
                                <Badge className={chipDetalhes.status === "connected"
                                    ? "bg-green-100 text-green-700 border-green-200"
                                    : chipDetalhes.status === "disconnected"
                                        ? "bg-red-100 text-red-600 border-red-200"
                                        : "bg-slate-100 text-slate-600 border-slate-200"
                                }>
                                    {chipDetalhes.status === "connected" ? "Conectado" :
                                        chipDetalhes.status === "disconnected" ? "Desconectado" : "Desconhecido"}
                                </Badge>
                            </div>
                            {chipDetalhes.status !== "connected" && (
                                <a href="/configuracoes/whatsapp" className="shrink-0">
                                    <Button size="sm" variant="outline" className="gap-1.5 text-xs border-yellow-200 text-yellow-700 hover:bg-yellow-50">
                                        <QrCode className="h-3.5 w-3.5" />
                                        Conectar Chip
                                    </Button>
                                </a>
                            )}
                        </div>
                    )}
                </CardContent>
            </Card>

            {!instanciaDisp && (
                <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-sm">
                    <Info className="h-5 w-5 shrink-0 mt-0.5" />
                    <span>Nenhuma instância do tipo <strong>Divulgação</strong> conectada. Crie e conecte o chip em <strong>Configurações → WhatsApp</strong> antes de disparar.</span>
                </div>
            )}

            {/* Status por unidade */}
            <Card className="shadow-sm border-slate-100">
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <CalendarCheck className="h-5 w-5 text-slate-500" />
                        Status da Programação — {MESES[mesAtual - 1]}/{anoAtual}
                    </CardTitle>
                    <CardDescription className="text-xs">
                        Cada Gerente deve subir a planilha e clicar em "Aprovar Programação" antes do disparo global.
                    </CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                    <div className="divide-y divide-slate-50">
                        {unidades.map(u => {
                            const cfg = STATUS_CONFIG[u.status]
                            return (
                                <div key={u.unidade} className="flex items-center justify-between px-6 py-3.5 hover:bg-slate-50/50 transition-colors">
                                    <div className="flex items-center gap-3">
                                        <Building2 className="h-4 w-4 text-slate-400 shrink-0" />
                                        <span className="font-medium text-slate-700 text-sm">{u.unidade}</span>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        {u.total_atividades > 0 && (
                                            <span className="text-xs text-slate-500 hidden sm:block">
                                                {u.total_atividades} atividades
                                            </span>
                                        )}
                                        {u.updated_at && (
                                            <span className="text-xs text-slate-400 hidden md:block">
                                                {format(new Date(u.updated_at), "dd/MM HH:mm", { locale: ptBR })}
                                            </span>
                                        )}
                                        <Badge className={`flex items-center gap-1.5 text-xs font-medium border ${cfg.color}`}>
                                            {cfg.icon}
                                            {cfg.label}
                                        </Badge>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </CardContent>
            </Card>

            {/* Histórico */}
            <Card className="shadow-sm border-slate-100">
                <CardHeader className="pb-3">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <BarChart3 className="h-5 w-5 text-slate-500" />
                        Histórico de Disparos Globais
                    </CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                    {historico.length === 0 ? (
                        <div className="py-12 text-center text-slate-400 text-sm">
                            Nenhum disparo realizado ainda.
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-50">
                            {historico.map(d => {
                                const cfg = DISPARO_STATUS_CONFIG[d.status]
                                return (
                                    <div key={d.id} className="flex flex-col sm:flex-row sm:items-center justify-between px-6 py-3.5 gap-2">
                                        <div>
                                            <p className="font-medium text-sm text-slate-700">{d.titulo || `Aviso ${MESES[d.mes - 1]}/${d.ano}`}</p>
                                            <p className="text-xs text-slate-400 mt-0.5">
                                                {format(new Date(d.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-3 flex-wrap">
                                            <span className="text-xs text-slate-500">{d.total_enviados}/{d.total_leads} enviados</span>
                                            {d.total_stop > 0 && (
                                                <span className="text-xs text-orange-600">{d.total_stop} STOP</span>
                                            )}
                                            {d.total_erros > 0 && (
                                                <span className="text-xs text-red-600">{d.total_erros} erros</span>
                                            )}
                                            <Badge className={`text-xs font-medium ${cfg.color}`}>{cfg.label}</Badge>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Modal de Disparo */}
            <Dialog open={modalAberto} onOpenChange={setModalAberto}>
                <DialogContent className="sm:max-w-[580px]">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Megaphone className="h-5 w-5 text-yellow-500" />
                            Disparar Aviso Global — {MESES[mesAtual - 1]}/{anoAtual}
                        </DialogTitle>
                        <DialogDescription>
                            Esta mensagem será enviada para <strong>todos os leads opt-in</strong> da base completa da Rede CUCA.
                            Edite o template abaixo e clique em Confirmar Disparo.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="space-y-4 py-2">
                        <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm">
                            <Info className="h-4 w-4 shrink-0" />
                            <span>Chip de disparo: <strong>{instanciaDisp ?? "(nenhum)"}</strong> · {aprovadas}/{unidadesCuca.length} unidades aprovadas</span>
                        </div>

                        <div className="space-y-1.5">
                            <Label>Mensagem (Edite os links wa.me antes de enviar)</Label>
                            <Textarea
                                value={template}
                                onChange={e => setTemplate(e.target.value)}
                                rows={10}
                                className="font-mono text-sm resize-none"
                                placeholder="Digite a mensagem do aviso..."
                            />
                            <p className="text-xs text-slate-500">
                                Use {"{nome}"} para personalizar com o nome do lead. O motor irá variar automaticamente as saudações (Spintax).
                            </p>
                        </div>
                    </div>

                    <DialogFooter>
                        <Button variant="outline" onClick={() => setModalAberto(false)} disabled={disparando}>
                            Cancelar
                        </Button>
                        <Button
                            className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold"
                            onClick={handleDisparar}
                            disabled={disparando || !template.trim()}
                        >
                            {disparando ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                            Confirmar Disparo
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
