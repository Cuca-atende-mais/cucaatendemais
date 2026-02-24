"use client"

import { useState, useEffect } from "react"
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs"
import { CheckCircle2, Building2, Calendar, Clock, User, Phone, IdCard, FileText, ChevronRight, ChevronLeft, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"

const UNIDADES = ["Barra", "Mondubim", "Jangurussu", "José Walter", "Pici"]

type Espaco = {
    id: string
    nome: string
    descricao: string
    capacidade: number
    unidade_cuca: string
    status: string
}

type Equipamento = {
    id: string
    espaco_id: string
    nome: string
    descricao: string
    status: string
}

const STEPS = [
    { id: 1, label: "Unidade & Espaço", icon: Building2 },
    { id: 2, label: "Data & Horário", icon: Calendar },
    { id: 3, label: "Seus Dados", icon: User },
    { id: 4, label: "Confirmação", icon: CheckCircle2 },
]

export default function AcessoCucaPage() {
    const supabase = createClientComponentClient()
    const [step, setStep] = useState(1)
    const [submitting, setSubmitting] = useState(false)
    const [submitted, setSubmitted] = useState(false)
    const [protocolo, setProtocolo] = useState("")

    // Form state
    const [unidadeSelecionada, setUnidadeSelecionada] = useState("")
    const [espacos, setEspacos] = useState<Espaco[]>([])
    const [espacoSelecionado, setEspacoSelecionado] = useState<Espaco | null>(null)
    const [equipamentos, setEquipamentos] = useState<Equipamento[]>([])
    const [equipamentosSelecionados, setEquipamentosSelecionados] = useState<string[]>([])
    const [dataEvento, setDataEvento] = useState("")
    const [horarioInicio, setHorarioInicio] = useState("")
    const [horarioFim, setHorarioFim] = useState("")
    const [naturezaEvento, setNaturezaEvento] = useState("")
    const [nomeSolicitante, setNomeSolicitante] = useState("")
    const [cpfSolicitante, setCpfSolicitante] = useState("")
    const [telefoneSolicitante, setTelefoneSolicitante] = useState("")

    useEffect(() => {
        if (unidadeSelecionada) {
            fetchEspacos()
        }
    }, [unidadeSelecionada])

    useEffect(() => {
        if (espacoSelecionado) {
            fetchEquipamentos()
        }
    }, [espacoSelecionado])

    const fetchEspacos = async () => {
        const { data } = await supabase
            .from("espacos_cuca")
            .select("*")
            .eq("unidade_cuca", unidadeSelecionada)
            .eq("status", "ativo")
            .order("nome")
        setEspacos(data || [])
        setEspacoSelecionado(null)
        setEquipamentos([])
    }

    const fetchEquipamentos = async () => {
        if (!espacoSelecionado) return
        const { data } = await supabase
            .from("equipamentos_cuca")
            .select("*")
            .eq("espaco_id", espacoSelecionado.id)
            .eq("status", "ativo")
            .order("nome")
        setEquipamentos(data || [])
    }

    const toggleEquipamento = (id: string) => {
        setEquipamentosSelecionados(prev =>
            prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]
        )
    }

    const canProceed = () => {
        if (step === 1) return unidadeSelecionada && espacoSelecionado
        if (step === 2) return dataEvento && horarioInicio && horarioFim && naturezaEvento
        if (step === 3) return nomeSolicitante && cpfSolicitante.length >= 11 && telefoneSolicitante.length >= 10
        return true
    }

    const handleSubmit = async () => {
        if (!espacoSelecionado) return
        setSubmitting(true)
        try {
            const { data, error } = await supabase
                .from("solicitacoes_acesso")
                .insert({
                    nome_solicitante: nomeSolicitante,
                    cpf_solicitante: cpfSolicitante.replace(/\D/g, ""),
                    telefone_solicitante: telefoneSolicitante.replace(/\D/g, ""),
                    unidade_cuca: unidadeSelecionada,
                    espaco_id: espacoSelecionado.id,
                    data_evento: dataEvento,
                    horario_inicio: horarioInicio,
                    horario_fim: horarioFim,
                    natureza_evento: naturezaEvento,
                    equipamentos_solicitados: equipamentosSelecionados,
                    status: "aguardando_n1",
                    // campos legados compatíveis
                    tipo_evento: naturezaEvento,
                    descricao_evento: naturezaEvento,
                    hora_inicio: horarioInicio,
                    hora_fim: horarioFim,
                    telefone: telefoneSolicitante.replace(/\D/g, ""),
                })
                .select("protocolo")
                .single()

            if (error) throw error
            setProtocolo(data?.protocolo || "")
            setSubmitted(true)
        } catch (err) {
            console.error("Erro ao enviar solicitação:", err)
        } finally {
            setSubmitting(false)
        }
    }

    const formatarCPF = (v: string) => {
        const d = v.replace(/\D/g, "").slice(0, 11)
        return d.replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d{1,2})$/, "$1-$2")
    }

    const formatarTelefone = (v: string) => {
        const d = v.replace(/\D/g, "").slice(0, 11)
        return d.replace(/(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2")
    }

    if (submitted) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-slate-900 via-primary/10 to-slate-900 flex items-center justify-center p-4">
                <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-10 max-w-lg w-full text-center text-white">
                    <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle2 className="h-10 w-10 text-emerald-400" />
                    </div>
                    <h1 className="text-3xl font-bold mb-2">Solicitação Enviada!</h1>
                    <p className="text-white/70 mb-6">Sua solicitação foi recebida e está aguardando aprovação dos coordenadores do CUCA.</p>
                    <div className="bg-white/10 rounded-2xl p-6 mb-8">
                        <p className="text-sm text-white/50 uppercase tracking-wider mb-1">Seu protocolo</p>
                        <p className="text-4xl font-mono font-bold text-cuca-yellow tracking-widest">{protocolo}</p>
                    </div>
                    <p className="text-sm text-white/60">
                        Guarde esse número! Você pode usá-lo para acompanhar o status da sua solicitação via WhatsApp com a Ana, nossa assistente virtual.
                    </p>
                    <div className="mt-6 pt-6 border-t border-white/10">
                        <p className="text-xs text-white/40">Você será notificado pelo WhatsApp quando houver atualização.</p>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-900 via-primary/10 to-slate-900 py-12 px-4">
            <div className="max-w-2xl mx-auto">
                {/* Header */}
                <div className="text-center mb-10">
                    <div className="inline-flex items-center gap-2 bg-primary/20 border border-primary/30 rounded-full px-4 py-1.5 text-sm text-primary font-medium mb-4">
                        <Building2 className="h-4 w-4" />
                        Acesso CUCA
                    </div>
                    <h1 className="text-4xl font-bold text-white mb-3">Solicite um Espaço</h1>
                    <p className="text-white/60 text-lg">Preencha o formulário para reservar espaços e equipamentos do CUCA</p>
                </div>

                {/* Stepper */}
                <div className="flex items-center justify-center gap-0 mb-10">
                    {STEPS.map((s, idx) => {
                        const Icon = s.icon
                        const isActive = step === s.id
                        const isDone = step > s.id
                        return (
                            <div key={s.id} className="flex items-center">
                                <div className={cn(
                                    "flex items-center gap-2 px-3 py-2 rounded-full text-sm font-medium transition-all",
                                    isActive ? "bg-primary text-white" : isDone ? "bg-emerald-500/20 text-emerald-400" : "text-white/30"
                                )}>
                                    <Icon className="h-4 w-4" />
                                    <span className="hidden sm:inline">{s.label}</span>
                                </div>
                                {idx < STEPS.length - 1 && (
                                    <ChevronRight className={cn("h-4 w-4 mx-1", isDone ? "text-emerald-400" : "text-white/20")} />
                                )}
                            </div>
                        )
                    })}
                </div>

                {/* Form Card */}
                <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8">

                    {/* Passo 1: Unidade e Espaço */}
                    {step === 1 && (
                        <div className="space-y-6">
                            <h2 className="text-xl font-semibold text-white">Escolha a Unidade CUCA</h2>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                {UNIDADES.map(u => (
                                    <button
                                        key={u}
                                        onClick={() => setUnidadeSelecionada(u)}
                                        className={cn(
                                            "p-4 rounded-2xl border text-sm font-medium transition-all text-left",
                                            unidadeSelecionada === u
                                                ? "bg-primary border-primary text-white"
                                                : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
                                        )}
                                    >
                                        <Building2 className="h-5 w-5 mb-2 opacity-70" />
                                        CUCA {u}
                                    </button>
                                ))}
                            </div>

                            {unidadeSelecionada && (
                                <div className="space-y-3">
                                    <h3 className="text-white/80 font-medium">Selecione o Espaço</h3>
                                    {espacos.length === 0 ? (
                                        <p className="text-white/40 text-sm">Carregando espaços...</p>
                                    ) : (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                            {espacos.map(e => (
                                                <button
                                                    key={e.id}
                                                    onClick={() => setEspacoSelecionado(e)}
                                                    className={cn(
                                                        "p-4 rounded-2xl border text-left transition-all",
                                                        espacoSelecionado?.id === e.id
                                                            ? "bg-primary/30 border-primary text-white"
                                                            : "bg-white/5 border-white/10 text-white/70 hover:bg-white/10"
                                                    )}
                                                >
                                                    <p className="font-medium text-sm">{e.nome}</p>
                                                    <p className="text-xs opacity-60 mt-1">{e.descricao}</p>
                                                    <Badge variant="outline" className="mt-2 text-[10px] border-white/20 text-white/50">
                                                        Capacidade: {e.capacidade} pessoas
                                                    </Badge>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {espacoSelecionado && equipamentos.length > 0 && (
                                <div className="space-y-3">
                                    <h3 className="text-white/80 font-medium">Equipamentos Necessários <span className="text-white/40 text-xs">(opcional)</span></h3>
                                    <div className="space-y-2">
                                        {equipamentos.map(eq => (
                                            <label key={eq.id} className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10 cursor-pointer hover:bg-white/10 transition-all">
                                                <Checkbox
                                                    id={eq.id}
                                                    checked={equipamentosSelecionados.includes(eq.id)}
                                                    onCheckedChange={() => toggleEquipamento(eq.id)}
                                                    className="border-white/30"
                                                />
                                                <div>
                                                    <p className="text-sm text-white font-medium">{eq.nome}</p>
                                                    {eq.descricao && <p className="text-xs text-white/40">{eq.descricao}</p>}
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Passo 2: Data e Horário */}
                    {step === 2 && (
                        <div className="space-y-6">
                            <h2 className="text-xl font-semibold text-white">Data e Horário do Evento</h2>
                            <div className="space-y-4">
                                <div>
                                    <Label className="text-white/70 flex items-center gap-2 mb-2"><Calendar className="h-4 w-4" /> Data do Evento</Label>
                                    <Input
                                        type="date"
                                        value={dataEvento}
                                        onChange={e => setDataEvento(e.target.value)}
                                        min={new Date().toISOString().split("T")[0]}
                                        className="bg-white/10 border-white/20 text-white [color-scheme:dark]"
                                    />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <Label className="text-white/70 flex items-center gap-2 mb-2"><Clock className="h-4 w-4" /> Início</Label>
                                        <Input
                                            type="time"
                                            value={horarioInicio}
                                            onChange={e => setHorarioInicio(e.target.value)}
                                            className="bg-white/10 border-white/20 text-white [color-scheme:dark]"
                                        />
                                    </div>
                                    <div>
                                        <Label className="text-white/70 flex items-center gap-2 mb-2"><Clock className="h-4 w-4" /> Término</Label>
                                        <Input
                                            type="time"
                                            value={horarioFim}
                                            onChange={e => setHorarioFim(e.target.value)}
                                            className="bg-white/10 border-white/20 text-white [color-scheme:dark]"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <Label className="text-white/70 flex items-center gap-2 mb-2"><FileText className="h-4 w-4" /> Natureza do Evento</Label>
                                    <Textarea
                                        placeholder="Descreva o objetivo e o tipo de atividade que será realizada..."
                                        value={naturezaEvento}
                                        onChange={e => setNaturezaEvento(e.target.value)}
                                        className="bg-white/10 border-white/20 text-white placeholder:text-white/30 min-h-[100px]"
                                    />
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Passo 3: Dados Pessoais */}
                    {step === 3 && (
                        <div className="space-y-6">
                            <h2 className="text-xl font-semibold text-white">Seus Dados</h2>
                            <div className="space-y-4">
                                <div>
                                    <Label className="text-white/70 flex items-center gap-2 mb-2"><User className="h-4 w-4" /> Nome Completo</Label>
                                    <Input
                                        placeholder="Seu nome completo"
                                        value={nomeSolicitante}
                                        onChange={e => setNomeSolicitante(e.target.value)}
                                        className="bg-white/10 border-white/20 text-white placeholder:text-white/30"
                                    />
                                </div>
                                <div>
                                    <Label className="text-white/70 flex items-center gap-2 mb-2"><IdCard className="h-4 w-4" /> CPF</Label>
                                    <Input
                                        placeholder="000.000.000-00"
                                        value={cpfSolicitante}
                                        onChange={e => setCpfSolicitante(formatarCPF(e.target.value))}
                                        className="bg-white/10 border-white/20 text-white placeholder:text-white/30"
                                    />
                                </div>
                                <div>
                                    <Label className="text-white/70 flex items-center gap-2 mb-2"><Phone className="h-4 w-4" /> WhatsApp</Label>
                                    <Input
                                        placeholder="(00) 00000-0000"
                                        value={telefoneSolicitante}
                                        onChange={e => setTelefoneSolicitante(formatarTelefone(e.target.value))}
                                        className="bg-white/10 border-white/20 text-white placeholder:text-white/30"
                                    />
                                    <p className="text-xs text-white/40 mt-1">Enviaremos o protocolo e atualizações de status por aqui.</p>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Passo 4: Confirmação */}
                    {step === 4 && (
                        <div className="space-y-5">
                            <h2 className="text-xl font-semibold text-white">Confirme sua Solicitação</h2>
                            <div className="space-y-3">
                                {[
                                    { label: "Unidade", value: `CUCA ${unidadeSelecionada}` },
                                    { label: "Espaço", value: espacoSelecionado?.nome },
                                    { label: "Data", value: dataEvento ? new Date(dataEvento + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }) : "" },
                                    { label: "Horário", value: `${horarioInicio} às ${horarioFim}` },
                                    { label: "Evento", value: naturezaEvento },
                                    { label: "Solicitante", value: nomeSolicitante },
                                    { label: "CPF", value: cpfSolicitante },
                                    { label: "WhatsApp", value: telefoneSolicitante },
                                    ...(equipamentosSelecionados.length > 0 ? [{ label: "Equipamentos", value: equipamentos.filter(e => equipamentosSelecionados.includes(e.id)).map(e => e.nome).join(", ") }] : []),
                                ].map(item => (
                                    <div key={item.label} className="flex justify-between items-start p-3 rounded-xl bg-white/5 border border-white/10">
                                        <span className="text-white/50 text-sm">{item.label}:</span>
                                        <span className="text-white text-sm font-medium text-right max-w-[60%]">{item.value}</span>
                                    </div>
                                ))}
                            </div>
                            <p className="text-xs text-white/40 pt-2 border-t border-white/10">
                                Ao confirmar, sua solicitação será enviada para análise da coordenação do CUCA. Você receberá o protocolo e atualizações via WhatsApp.
                            </p>
                        </div>
                    )}

                    {/* Navigation */}
                    <div className="flex justify-between mt-8 pt-6 border-t border-white/10">
                        {step > 1 ? (
                            <Button variant="ghost" onClick={() => setStep(s => s - 1)} className="text-white/70 hover:text-white hover:bg-white/10">
                                <ChevronLeft className="h-4 w-4 mr-2" /> Voltar
                            </Button>
                        ) : <div />}

                        {step < 4 ? (
                            <Button
                                onClick={() => setStep(s => s + 1)}
                                disabled={!canProceed()}
                                className="bg-primary hover:bg-primary/90"
                            >
                                Próximo <ChevronRight className="h-4 w-4 ml-2" />
                            </Button>
                        ) : (
                            <Button
                                onClick={handleSubmit}
                                disabled={submitting}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            >
                                {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enviando...</> : <><CheckCircle2 className="h-4 w-4 mr-2" /> Confirmar Solicitação</>}
                            </Button>
                        )}
                    </div>
                </div>

                <p className="text-center text-white/30 text-xs mt-6">
                    CUCA — Centro Urbano de Cultura, Arte, Ciência e Esporte
                </p>
            </div>
        </div>
    )
}
