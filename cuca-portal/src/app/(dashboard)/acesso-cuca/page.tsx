"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import {
    ClipboardList, CheckCircle2, XCircle, Clock, Building2,
    Calendar, User, Phone, FileText, ChevronRight, Loader2,
    AlertTriangle, Filter, Eye
} from "lucide-react"
import { useUser } from "@/lib/auth/user-provider"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { toast } from "sonner"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { cn } from "@/lib/utils"

type Solicitacao = {
    id: string
    protocolo: string
    nome_solicitante: string
    cpf_solicitante: string
    telefone_solicitante: string
    unidade_cuca: string
    espaco_id: string
    data_evento: string
    horario_inicio: string
    horario_fim: string
    natureza_evento: string
    equipamentos_solicitados: string[]
    status: string
    aprovado_n1_em: string | null
    aprovado_n2_em: string | null
    motivo_reprovacao: string | null
    created_at: string
    cancelar_em: string | null
    // Join
    espacos_cuca?: { nome: string }
}

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: any }> = {
    aguardando_n1: { label: "Aguardando N1", color: "bg-amber-500/10 text-amber-600 border-amber-200", icon: Clock },
    aguardando_n2: { label: "Aguardando N2", color: "bg-blue-500/10 text-blue-600 border-blue-200", icon: Clock },
    aprovado: { label: "Aprovado", color: "bg-emerald-500/10 text-emerald-600 border-emerald-200", icon: CheckCircle2 },
    reprovado: { label: "Reprovado", color: "bg-red-500/10 text-red-600 border-red-200", icon: XCircle },
    cancelado_auto: { label: "Cancelado (48h)", color: "bg-slate-100 text-slate-500 border-slate-200", icon: AlertTriangle },
}

export default function AcessoCucaPortalPage() {
    const supabase = createClient()
    const [solicitacoes, setSolicitacoes] = useState<Solicitacao[]>([])
    const [loading, setLoading] = useState(true)
    const [detalhando, setDetalhando] = useState<Solicitacao | null>(null)
    const [observacao, setObservacao] = useState("")
    const [motivoReprovacao, setMotivoReprovacao] = useState("")
    const [reviewMode, setReviewMode] = useState<"aprovar" | "reprovar" | null>(null)
    const [saving, setSaving] = useState(false)

    const { profile, isDeveloper } = useUser()

    useEffect(() => {
        if (profile) fetchSolicitacoes()
    }, [profile])

    const fetchSolicitacoes = async () => {
        setLoading(true)

        let query = supabase
            .from("solicitacoes_acesso")
            .select("*, espacos_cuca(nome)")
            .order("created_at", { ascending: false })

        const canSeeAllUnits = isDeveloper || profile?.funcao?.nome === 'Super Admin Cuca'

        if (!canSeeAllUnits && profile?.unidade_cuca) {
            query = query.eq('unidade_cuca', profile.unidade_cuca)
        }

        const { data } = await query
        setSolicitacoes(data || [])
        setLoading(false)
    }

    const confirmarAcao = async (acao: "aprovar_n1" | "aprovar_n2" | "reprovar") => {
        if (!detalhando) return
        setSaving(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()

            let update: any = { updated_at: new Date().toISOString() }

            if (acao === "aprovar_n1") {
                update.status = "aguardando_n2"
                update.aprovado_n1_por = user?.id
                update.aprovado_n1_em = new Date().toISOString()
                update.observacao_n1 = observacao
            } else if (acao === "aprovar_n2") {
                update.status = "aprovado"
                update.aprovado_n2_por = user?.id
                update.aprovado_n2_em = new Date().toISOString()
                update.observacao_n2 = observacao
            } else if (acao === "reprovar") {
                update.status = "reprovado"
                update.motivo_reprovacao = motivoReprovacao
            }

            const { error } = await supabase.from("solicitacoes_acesso").update(update).eq("id", detalhando.id)
            if (error) throw error

            toast.success(acao === "reprovar" ? "Solicitação reprovada." : "Aprovação registrada com sucesso!")
            setDetalhando(null)
            setObservacao("")
            setMotivoReprovacao("")
            setReviewMode(null)
            await fetchSolicitacoes()
        } catch (err) {
            toast.error("Erro ao processar ação.")
        } finally {
            setSaving(false)
        }
    }

    const filtrarPorStatus = (status: string) => solicitacoes.filter(s => s.status === status)
    const pendentes = solicitacoes.filter(s => s.status === "aguardando_n1" || s.status === "aguardando_n2")

    const SolicitacaoCard = ({ s }: { s: Solicitacao }) => {
        const cfg = STATUS_CONFIG[s.status] || STATUS_CONFIG.aguardando_n1
        const Icon = cfg.icon
        return (
            <div
                className="border rounded-xl p-4 bg-card hover:shadow-md transition-all cursor-pointer"
                onClick={() => { setDetalhando(s); setReviewMode(null); setObservacao(""); setMotivoReprovacao("") }}
            >
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono font-bold text-primary text-sm">{s.protocolo}</span>
                            <Badge className={cn("text-[10px] border", cfg.color)}>
                                <Icon className="h-3 w-3 mr-1" /> {cfg.label}
                            </Badge>
                        </div>
                        <p className="font-medium truncate">{s.nome_solicitante}</p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1 flex-wrap">
                            <span className="flex items-center gap-1"><Building2 className="h-3 w-3" /> {s.unidade_cuca}</span>
                            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" /> {s.data_evento ? format(new Date(s.data_evento + "T12:00:00"), "dd/MM/yyyy") : ""}</span>
                            <span>{s.horario_inicio} – {s.horario_fim}</span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 truncate">{s.natureza_evento}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 mt-1" />
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-6 p-2 md:p-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                        <ClipboardList className="h-6 w-6 text-primary" />
                        Solicitações de Acesso CUCA
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1">Gerencie e aprove as solicitações de uso dos espaços do CUCA.</p>
                </div>
                <div className="flex items-center gap-2">
                    {pendentes.length > 0 && (
                        <Badge className="bg-amber-500 text-white">{pendentes.length} pendentes</Badge>
                    )}
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-16"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            ) : (
                <Tabs defaultValue="pendentes">
                    <TabsList>
                        <TabsTrigger value="pendentes">Pendentes ({pendentes.length})</TabsTrigger>
                        <TabsTrigger value="aprovados">Aprovados ({filtrarPorStatus("aprovado").length})</TabsTrigger>
                        <TabsTrigger value="reprovados">Reprovados ({filtrarPorStatus("reprovado").length})</TabsTrigger>
                        <TabsTrigger value="todos">Todos ({solicitacoes.length})</TabsTrigger>
                    </TabsList>

                    <TabsContent value="pendentes" className="space-y-3 mt-4">
                        {pendentes.length === 0 ? (
                            <div className="text-center py-12 text-muted-foreground">
                                <CheckCircle2 className="h-12 w-12 mx-auto mb-4 opacity-20" />
                                <p>Nenhuma solicitação pendente.</p>
                            </div>
                        ) : pendentes.map(s => <SolicitacaoCard key={s.id} s={s} />)}
                    </TabsContent>

                    <TabsContent value="aprovados" className="space-y-3 mt-4">
                        {filtrarPorStatus("aprovado").map(s => <SolicitacaoCard key={s.id} s={s} />)}
                    </TabsContent>

                    <TabsContent value="reprovados" className="space-y-3 mt-4">
                        {filtrarPorStatus("reprovado").map(s => <SolicitacaoCard key={s.id} s={s} />)}
                    </TabsContent>

                    <TabsContent value="todos" className="space-y-3 mt-4">
                        {solicitacoes.map(s => <SolicitacaoCard key={s.id} s={s} />)}
                    </TabsContent>
                </Tabs>
            )}

            {/* Modal de Detalhes + Aprovação */}
            <Dialog open={!!detalhando} onOpenChange={() => setDetalhando(null)}>
                <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <span className="font-mono text-primary">{detalhando?.protocolo}</span>
                            {detalhando && STATUS_CONFIG[detalhando.status] && (
                                <Badge className={cn("text-[10px] border", STATUS_CONFIG[detalhando.status].color)}>
                                    {STATUS_CONFIG[detalhando.status].label}
                                </Badge>
                            )}
                        </DialogTitle>
                        <DialogDescription className="sr-only">Detalhes e ações de aprovação da solicitação de acesso ao CUCA.</DialogDescription>
                    </DialogHeader>

                    {detalhando && (
                        <div className="space-y-4">
                            {/* Dados */}
                            <div className="grid gap-2">
                                {[
                                    { label: "Solicitante", value: detalhando.nome_solicitante, icon: User },
                                    { label: "CPF", value: detalhando.cpf_solicitante, icon: FileText },
                                    { label: "WhatsApp", value: detalhando.telefone_solicitante, icon: Phone },
                                    { label: "Unidade", value: `CUCA ${detalhando.unidade_cuca}`, icon: Building2 },
                                    { label: "Data", value: detalhando.data_evento ? format(new Date(detalhando.data_evento + "T12:00:00"), "dd 'de' MMMM 'de' yyyy", { locale: ptBR }) : "", icon: Calendar },
                                    { label: "Horário", value: `${detalhando.horario_inicio} às ${detalhando.horario_fim}`, icon: Clock },
                                ].map(item => {
                                    const Icon = item.icon
                                    return (
                                        <div key={item.label} className="flex items-start gap-3 p-2.5 rounded-lg bg-muted/40">
                                            <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                                            <div>
                                                <p className="text-xs text-muted-foreground">{item.label}</p>
                                                <p className="text-sm font-medium">{item.value}</p>
                                            </div>
                                        </div>
                                    )
                                })}
                                <div className="p-2.5 rounded-lg bg-muted/40">
                                    <p className="text-xs text-muted-foreground mb-1">Natureza do Evento</p>
                                    <p className="text-sm">{detalhando.natureza_evento}</p>
                                </div>
                            </div>

                            {/* Ações de aprovação */}
                            {(detalhando.status === "aguardando_n1" || detalhando.status === "aguardando_n2") && !reviewMode && (
                                <div className="flex gap-2 pt-2 border-t">
                                    <Button
                                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 gap-2"
                                        onClick={() => setReviewMode("aprovar")}
                                    >
                                        <CheckCircle2 className="h-4 w-4" />
                                        {detalhando.status === "aguardando_n1" ? "Aprovar (N1)" : "Aprovação Final (N2)"}
                                    </Button>
                                    <Button
                                        variant="outline"
                                        className="flex-1 text-destructive border-destructive/20 hover:bg-destructive/5 gap-2"
                                        onClick={() => setReviewMode("reprovar")}
                                    >
                                        <XCircle className="h-4 w-4" /> Reprovar
                                    </Button>
                                </div>
                            )}

                            {reviewMode === "aprovar" && (
                                <div className="space-y-3 pt-2 border-t">
                                    <Label>Observação (opcional)</Label>
                                    <Textarea
                                        value={observacao}
                                        onChange={e => setObservacao(e.target.value)}
                                        placeholder="Adicione alguma observação sobre a aprovação..."
                                        className="resize-none"
                                        rows={3}
                                    />
                                    <div className="flex gap-2">
                                        <Button variant="outline" onClick={() => setReviewMode(null)} className="flex-1">Cancelar</Button>
                                        <Button
                                            className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                                            onClick={() => confirmarAcao(detalhando?.status === "aguardando_n1" ? "aprovar_n1" : "aprovar_n2")}
                                            disabled={saving}
                                        >
                                            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                            Confirmar Aprovação
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {reviewMode === "reprovar" && (
                                <div className="space-y-3 pt-2 border-t">
                                    <Label className="text-destructive">Motivo da Reprovação (interno)</Label>
                                    <Textarea
                                        value={motivoReprovacao}
                                        onChange={e => setMotivoReprovacao(e.target.value)}
                                        placeholder="Este motivo NÃO será compartilhado com o solicitante. A Ana redirecionará para a unidade."
                                        className="resize-none border-destructive/30"
                                        rows={3}
                                    />
                                    <p className="text-xs text-muted-foreground bg-amber-50 border border-amber-200 p-2 rounded-lg">
                                        ⚠️ O motivo é interno. O Agente Ana responderá ao solicitante sem compartilhá-lo.
                                    </p>
                                    <div className="flex gap-2">
                                        <Button variant="outline" onClick={() => setReviewMode(null)} className="flex-1">Cancelar</Button>
                                        <Button
                                            variant="destructive"
                                            className="flex-1"
                                            onClick={() => confirmarAcao("reprovar")}
                                            disabled={saving || !motivoReprovacao}
                                        >
                                            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                                            Confirmar Reprovação
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {/* Cancelamento automático */}
                            {detalhando.status === "aprovado" && detalhando.cancelar_em && (
                                <div className="p-3 rounded-lg bg-blue-50 border border-blue-200 text-xs text-blue-700">
                                    <p className="font-medium mb-1">⏱ Cancelamento Automático</p>
                                    <p>Esta reserva será cancelada automaticamente em: <strong>{format(new Date(detalhando.cancelar_em), "dd/MM/yyyy 'às' HH:mm")}</strong> caso o solicitante não confirme presença.</p>
                                </div>
                            )}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    )
}
