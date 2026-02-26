"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Loader2, CheckCircle2, ChevronRight, ChevronLeft, MapPin, Calendar, User, FileText } from "lucide-react"
import { toast } from "sonner"

type Unidade = {
    id: string
    nome: string
    slug: string
}

type Espaco = {
    id: string
    nome: string
    unidade_cuca: string
}

export function AcessoForm() {
    const [step, setStep] = useState(1)
    const [loading, setLoading] = useState(false)
    const [submitted, setSubmitted] = useState(false)
    const [protocolo, setProtocolo] = useState("")

    const [unidades, setUnidades] = useState<Unidade[]>([])
    const [espacos, setEspacos] = useState<Espaco[]>([])
    const [filteredEspacos, setFilteredEspacos] = useState<Espaco[]>([])

    const [formData, setFormData] = useState({
        unidade: "",
        espaco_id: "",
        data_evento: "",
        horario_inicio: "",
        horario_fim: "",
        nome_solicitante: "",
        cpf_solicitante: "",
        telefone: "",
        email: "",
        natureza_evento: "",
        descricao_evento: "",
        numero_participantes: "",
    })

    const supabase = createClient()

    useEffect(() => {
        async function fetchData() {
            const { data: units } = await supabase.from("unidades_cuca").select("id, nome, slug").eq("ativo", true)
            const { data: spaces } = await supabase.from("espacos_cuca").select("id, nome, unidade_cuca").eq("status", "ativo")

            if (units) setUnidades(units)
            if (spaces) setEspacos(spaces)
        }
        fetchData()
    }, [])

    useEffect(() => {
        if (formData.unidade) {
            const selectedUnit = unidades.find(u => u.id === formData.unidade)
            if (selectedUnit) {
                // O banco usa o NOME da unidade na coluna unidade_cuca de espacos_cuca (baseado no MCP audit)
                setFilteredEspacos(espacos.filter(s => s.unidade_cuca === selectedUnit.nome))
            }
        } else {
            setFilteredEspacos([])
        }
    }, [formData.unidade, unidades, espacos])

    const nextStep = () => setStep(s => s + 1)
    const prevStep = () => setStep(s => s - 1)

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)

        try {
            const selectedUnit = unidades.find(u => u.id === formData.unidade)
            const unitSlug = selectedUnit?.slug.toUpperCase() || "GEN"
            const now = new Date()
            const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "")
            const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase()
            const newProtocolo = `AC-${unitSlug}-${dateStr}-${randomStr}`

            const { error } = await supabase.from("solicitacoes_acesso").insert({
                protocolo: newProtocolo,
                unidade_cuca: selectedUnit?.nome,
                espaco_id: formData.espaco_id,
                data_evento: formData.data_evento,
                horario_inicio: formData.horario_inicio,
                horario_fim: formData.horario_fim,
                nome_solicitante: formData.nome_solicitante,
                cpf_solicitante: formData.cpf_solicitante,
                telefone: formData.telefone,
                email: formData.email,
                natureza_evento: formData.natureza_evento,
                descricao_evento: formData.descricao_evento,
                numero_participantes: parseInt(formData.numero_participantes) || 0,
                status: "pendente",
            })

            if (error) throw error

            setProtocolo(newProtocolo)
            setSubmitted(true)
            toast.success("Solicitação enviada com sucesso!")
        } catch (error: any) {
            console.error("Erro ao enviar solicitação:", error)
            toast.error("Erro ao enviar solicitação. Tente novamente.")
        } finally {
            setLoading(false)
        }
    }

    if (submitted) {
        return (
            <Card className="border-2 border-green-100 bg-white shadow-xl animate-in fade-in zoom-in duration-300">
                <CardContent className="pt-12 pb-12 text-center pointer-events-auto">
                    <div className="flex justify-center mb-6">
                        <div className="bg-green-100 p-4 rounded-full">
                            <CheckCircle2 className="w-16 h-16 text-green-600" />
                        </div>
                    </div>
                    <h3 className="text-2xl font-bold text-slate-800 mb-2">Solicitação Enviada!</h3>
                    <p className="text-slate-600 mb-8 max-w-sm mx-auto">
                        Sua solicitação foi registrada com sucesso. Anote o número do seu protocolo para acompanhamento:
                    </p>
                    <div className="bg-slate-50 border-2 border-dashed border-slate-200 p-6 rounded-xl mb-8">
                        <span className="text-3xl font-mono font-bold text-cuca-blue tracking-wider">
                            {protocolo}
                        </span>
                    </div>
                    <p className="text-sm text-slate-500 mb-8">
                        A persona <b>Ana</b> entrará em contato via WhatsApp assim que houver uma atualização no status da sua solicitação.
                    </p>
                    <Button
                        onClick={() => window.location.reload()}
                        variant="outline"
                        className="w-full sm:w-auto"
                    >
                        Fazer outra solicitação
                    </Button>
                </CardContent>
            </Card>
        )
    }

    return (
        <Card className="border-none shadow-2xl bg-white overflow-hidden pointer-events-auto">
            {/* Progress Bar */}
            <div className="w-full h-2 bg-slate-100">
                <div
                    className="h-full bg-cuca-blue transition-all duration-500 ease-in-out"
                    style={{ width: `${(step / 4) * 100}%` }}
                />
            </div>

            <form onSubmit={handleSubmit}>
                <CardContent className="p-6 sm:p-8">
                    {/* Step 1: Unidade */}
                    {step === 1 && (
                        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="bg-cuca-blue/10 p-2 rounded-lg">
                                    <MapPin className="text-cuca-blue w-6 h-6" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-xl">Onde você deseja agendar?</h4>
                                    <p className="text-sm text-slate-500">Escolha a unidade da Rede CUCA</p>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 gap-4">
                                {unidades.map((u) => (
                                    <div
                                        key={u.id}
                                        onClick={() => setFormData({ ...formData, unidade: u.id, espaco_id: "" })}
                                        className={`
                      p-4 rounded-xl border-2 transition-all cursor-pointer flex items-center justify-between
                      ${formData.unidade === u.id
                                                ? "border-cuca-blue bg-cuca-blue/5 scale-[1.02]"
                                                : "border-slate-100 hover:border-slate-300 hover:bg-slate-50"}
                    `}
                                    >
                                        <span className="font-semibold text-slate-700">{u.nome}</span>
                                        <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${formData.unidade === u.id ? "border-cuca-blue bg-cuca-blue" : "border-slate-300"}`}>
                                            {formData.unidade === u.id && <div className="w-2 h-2 bg-white rounded-full" />}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Step 2: Espaço e Horário */}
                    {step === 2 && (
                        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="bg-cuca-blue/10 p-2 rounded-lg">
                                    <Calendar className="text-cuca-blue w-6 h-6" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-xl">O que e quando?</h4>
                                    <p className="text-sm text-slate-500">Selecione o local e o período</p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Espaço</Label>
                                    <Select
                                        value={formData.espaco_id}
                                        onValueChange={(val) => setFormData({ ...formData, espaco_id: val })}
                                        disabled={filteredEspacos.length === 0}
                                    >
                                        <SelectTrigger className="h-12">
                                            <SelectValue placeholder={filteredEspacos.length > 0 ? "Selecione um espaço disponível" : "Nenhum espaço disponível nesta unidade"} />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {filteredEspacos.map((s) => (
                                                <SelectItem key={s.id} value={s.id}>{s.nome}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <Label>Data do Evento</Label>
                                    <Input
                                        type="date"
                                        className="h-12"
                                        min={new Date().toISOString().split("T")[0]}
                                        value={formData.data_evento}
                                        onChange={(e) => setFormData({ ...formData, data_evento: e.target.value })}
                                        required
                                    />
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>Início</Label>
                                        <Input
                                            type="time"
                                            className="h-12"
                                            value={formData.horario_inicio}
                                            onChange={(e) => setFormData({ ...formData, horario_inicio: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Fim</Label>
                                        <Input
                                            type="time"
                                            className="h-12"
                                            value={formData.horario_fim}
                                            onChange={(e) => setFormData({ ...formData, horario_fim: e.target.value })}
                                            required
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 3: Dados Pessoais */}
                    {step === 3 && (
                        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="bg-cuca-blue/10 p-2 rounded-lg">
                                    <User className="text-cuca-blue w-6 h-6" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-xl">Quem está solicitando?</h4>
                                    <p className="text-sm text-slate-500">Seus dados para contato</p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Nome Completo</Label>
                                    <Input
                                        placeholder="Ex: João da Silva"
                                        className="h-12"
                                        value={formData.nome_solicitante}
                                        onChange={(e) => setFormData({ ...formData, nome_solicitante: e.target.value })}
                                        required
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label>CPF</Label>
                                    <Input
                                        placeholder="000.000.000-00"
                                        className="h-12"
                                        value={formData.cpf_solicitante}
                                        onChange={(e) => {
                                            let val = e.target.value.replace(/\D/g, "")
                                            if (val.length <= 11) {
                                                if (val.length > 9) val = val.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")
                                                else if (val.length > 6) val = val.replace(/(\d{3})(\d{3})(\d{0,3})/, "$1.$2.$3")
                                                else if (val.length > 3) val = val.replace(/(\d{3})(\d{0,3})/, "$1.$2")
                                                setFormData({ ...formData, cpf_solicitante: val })
                                            }
                                        }}
                                        required
                                    />
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label>WhatsApp / Telefone</Label>
                                        <Input
                                            placeholder="(85) 90000-0000"
                                            className="h-12"
                                            value={formData.telefone}
                                            onChange={(e) => setFormData({ ...formData, telefone: e.target.value })}
                                            required
                                        />
                                    </div>
                                    <div className="space-y-2">
                                        <Label>Email</Label>
                                        <Input
                                            type="email"
                                            placeholder="seu@email.com"
                                            className="h-12"
                                            value={formData.email}
                                            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                                            required
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Step 4: Natureza e Descrição */}
                    {step === 4 && (
                        <div className="space-y-6 animate-in slide-in-from-right-4 duration-300">
                            <div className="flex items-center gap-3 mb-4">
                                <div className="bg-cuca-blue/10 p-2 rounded-lg">
                                    <FileText className="text-cuca-blue w-6 h-6" />
                                </div>
                                <div>
                                    <h4 className="font-bold text-xl">Detalhes do Evento</h4>
                                    <p className="text-sm text-slate-500">O que você pretende realizar?</p>
                                </div>
                            </div>

                            <div className="space-y-4">
                                <div className="space-y-2">
                                    <Label>Natureza do Evento</Label>
                                    <Select
                                        value={formData.natureza_evento}
                                        onValueChange={(val) => setFormData({ ...formData, natureza_evento: val })}
                                    >
                                        <SelectTrigger className="h-12">
                                            <SelectValue placeholder="Selecione o tipo" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="reuniao">Reunião / Encontro</SelectItem>
                                            <SelectItem value="ensaio">Ensaio Artístico</SelectItem>
                                            <SelectItem value="aula">Aula / Workshop</SelectItem>
                                            <SelectItem value="esportivo">Atividade Esportiva</SelectItem>
                                            <SelectItem value="outro">Outro (Descrever abaixo)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <Label>Quantas pessoas participarão? (Expectativa)</Label>
                                    <Input
                                        type="number"
                                        placeholder="Ex: 20"
                                        className="h-12"
                                        value={formData.numero_participantes}
                                        onChange={(e) => setFormData({ ...formData, numero_participantes: e.target.value })}
                                        required
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label>Descrição Detalhada</Label>
                                    <Textarea
                                        placeholder="Conte brevemente o objetivo do uso do espaço..."
                                        className="min-h-[120px] resize-none"
                                        value={formData.descricao_evento}
                                        onChange={(e) => setFormData({ ...formData, descricao_evento: e.target.value })}
                                        required
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </CardContent>

                <CardFooter className="p-6 bg-slate-50 border-t flex items-center justify-between">
                    {step > 1 && (
                        <Button
                            type="button"
                            variant="outline"
                            onClick={prevStep}
                            className="px-6 h-12"
                        >
                            <ChevronLeft className="mr-2 w-4 h-4" /> Voltar
                        </Button>
                    )}

                    <div className="ml-auto flex gap-3">
                        {step < 4 ? (
                            <Button
                                type="button"
                                onClick={nextStep}
                                disabled={
                                    (step === 1 && !formData.unidade) ||
                                    (step === 2 && (!formData.espaco_id || !formData.data_evento || !formData.horario_inicio || !formData.horario_fim)) ||
                                    (step === 3 && (!formData.nome_solicitante || !formData.cpf_solicitante || !formData.telefone))
                                }
                                className="bg-cuca-blue hover:bg-sky-800 px-8 h-12"
                            >
                                Próximo <ChevronRight className="ml-2 w-4 h-4" />
                            </Button>
                        ) : (
                            <Button
                                type="submit"
                                disabled={loading || !formData.natureza_evento || !formData.descricao_evento}
                                className="bg-cuca-blue hover:bg-sky-800 px-10 h-12"
                            >
                                {loading ? (
                                    <>
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        Enviando...
                                    </>
                                ) : (
                                    "Finalizar Solicitação"
                                )}
                            </Button>
                        )}
                    </div>
                </CardFooter>
            </form>
        </Card>
    )
}
