"use client"

import { useState, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Building2, Briefcase, CheckCircle2, Loader2, AlertTriangle, Gift, Copy, X, Clock, MapPin } from "lucide-react"
import toast from "react-hot-toast"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const TIPOS_CONTRATO = ["CLT", "PJ", "Estágio", "Temporário", "Aprendiz", "Freelancer"]
const ESCOLARIDADES = ["Fundamental Incompleto", "Fundamental Completo", "Médio Incompleto", "Médio Completo", "Superior Incompleto", "Superior Completo"]

const SETORES_VAGA = [
    "Serviços Gerais (limpeza, portaria, zeladoria)",
    "Construção Civil (pedreiro, ajudante, eletricista, encanador)",
    "Logística e Entregas (estoque, separação, entregador, motorista)",
    "Comércio e Vendas (vendedor, caixa, atendimento)",
    "Alimentação (cozinha, garçom, lanchonete)",
    "Tecnologia (suporte técnico, programação, dados)",
    "Criativo / Digital (design, vídeo, redes sociais)",
    "Beleza e Estética (barbeiro, manicure, cabeleireiro)",
    "Cuidados Pessoais (babá, cuidador de idosos)",
    "Administrativo / Escritório (recepção, auxiliar administrativo)",
    "Produção (auxiliar, analista e tecnico)",
]

const BENEFICIOS_OPCOES = [
    "Plano de Saúde (co-participação)",
    "Vale Refeição",
    "Refeitório no Local",
    "Vale Transporte",
    "Cesta Básica",
    "Cartão Alimentação/Refeição",
]


const TIPOS_SELECAO = [
    { value: "coleta_curriculo", label: "Coleta de Currículo", desc: "A empresa conduz o processo seletivo de forma independente. O CUCA apenas coleta e encaminha os currículos." },
    { value: "entrevista_unidade", label: "Entrevista na Unidade", desc: "O processo inclui entrevistas presenciais na unidade CUCA. A equipe agenda e organiza as entrevistas." },
    { value: "triagem_cuca", label: "Triagem Inicial pelo CUCA", desc: "O CUCA realiza uma triagem inicial dos candidatos antes de encaminhar os pré-selecionados para a empresa." },
]

function buildCargaHoraria(tipo: string, horas: string, escalaT: string, escalaF: string, dias: string, trabSabado: boolean, sabadoAte: string): string {
    if (tipo === "escala") return escalaT && escalaF ? `${escalaT}x${escalaF}` : ""
    if (tipo === "jornada_corrida") return horas ? `Jornada Corrida ${horas}h/dia` : "Jornada Corrida"
    let str = horas ? `${horas}h/dia` : ""
    if (dias) str += ` | ${dias}`
    if (trabSabado) str += ` | Sábados até ${sabadoAte || "12:00"}`
    return str
}

export default function NovaVagaEmpresaPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-muted/30">
                <Loader2 className="h-10 w-10 animate-spin text-cuca-blue" />
            </div>
        }>
            <NovaVagaEmpresaContent />
        </Suspense>
    )
}

function NovaVagaEmpresaContent() {
    const searchParams = useSearchParams()
    const empresaId = searchParams.get("empresa_id")
    const unidadeCuca = searchParams.get("unidade_cuca") || ""
    const unidadeDestinoParam = searchParams.get("unidade_destino") || "global"
    const emailParam = searchParams.get("email_responsavel") || ""
    const telefoneParam = searchParams.get("telefone_responsavel") || ""

    const [unidadeDestino, setUnidadeDestino] = useState<string>("")
    const [unidadesOpcoes, setUnidadesOpcoes] = useState<{ value: string; label: string }[]>([])
    const [empresa, setEmpresa] = useState<{ id: string; nome: string } | null>(null)
    const [loadingEmpresa, setLoadingEmpresa] = useState(true)
    const [empresaInvalida, setEmpresaInvalida] = useState(false)

    // Dados da vaga
    const [titulo, setTitulo] = useState("")
    const [descricao, setDescricao] = useState("")
    const [requisitos, setRequisitos] = useState("")
    const [tipoContrato, setTipoContrato] = useState("")
    const [salario, setSalario] = useState("")
    const [setoresMarcados, setSetoresMarcados] = useState<string[]>([])
    // Responsável pela vaga (pré-preenchido se vindo do bot)
    const [emailResponsavel, setEmailResponsavel] = useState(emailParam)
    const [telefoneResponsavel, setTelefoneResponsavel] = useState(telefoneParam)
    const [totalVagas, setTotalVagas] = useState("1")
    const [escolaridadeMinima, setEscolaridadeMinima] = useState("")
    const [faixaEtaria, setFaixaEtaria] = useState("")
    const [local, setLocal] = useState("")
    const [localEntrevista, setLocalEntrevista] = useState("na_empresa")

    // Carga horária estruturada
    const [cargaTipo, setCargaTipo] = useState("horario_comercial")
    const [cargaHoras, setCargaHoras] = useState("")
    const [cargaEscalaT, setCargaEscalaT] = useState("")
    const [cargaEscalaF, setCargaEscalaF] = useState("")
    const [cargaDias, setCargaDias] = useState("Seg à Sex")
    const [cargaTrabSabado, setCargaTrabSabado] = useState(false)
    const [cargaSabadoAte, setCargaSabadoAte] = useState("12:00")

    // Benefícios
    const [beneficiosMarcados, setBeneficiosMarcados] = useState<string[]>([])
    const [beneficiosOutros, setBeneficiosOutros] = useState("")

    // Processo seletivo
    const [limiteCurriculos, setLimiteCurriculos] = useState("")
    const [tipoSelecao, setTipoSelecao] = useState("")

    // PCD
    const [pcdVaga, setPcdVaga] = useState(false)
    const [pcdTipo, setPcdTipo] = useState("")
    const [pcdHomologado, setPcdHomologado] = useState(false)

    const [loadingSubmit, setLoadingSubmit] = useState(false)
    const [success, setSuccess] = useState(false)
    const [numeroVaga, setNumeroVaga] = useState("")
    const [copiado, setCopiado] = useState(false)
    const [vagaResumo, setVagaResumo] = useState<{ titulo: string; tipo_contrato: string; total_vagas: string; salario: string } | null>(null)

    useEffect(() => {
        if (!empresaId) { setEmpresaInvalida(true); setLoadingEmpresa(false); return }
        fetch(`/api/empregabilidade/empresa?id=${encodeURIComponent(empresaId)}`)
            .then(r => r.json())
            .then(data => {
                if (data.error || !data.id) setEmpresaInvalida(true)
                else setEmpresa(data)
                setLoadingEmpresa(false)
            })
            .catch(() => { setEmpresaInvalida(true); setLoadingEmpresa(false) })
    }, [empresaId])

    useEffect(() => {
        fetch("/api/empregabilidade/unidades")
            .then(r => r.json())
            .then((data: { id: string; nome: string }[]) => {
                if (Array.isArray(data)) {
                    const opcoes = [
                        { value: "global", label: "🌐 Toda a Rede CUCA" },
                        ...data.map(u => ({ value: u.id, label: `📍 ${u.nome}` })),
                    ]
                    setUnidadesOpcoes(opcoes)
                }
            })
            .catch(() => {
                // fallback: deixa lista vazia, usuário não consegue submeter sem selecionar
            })
    }, [])

    const toggleSetor = (s: string) => {
        setSetoresMarcados(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])
    }

    const formatarSalario = (value: string) => {
        // Permite "A combinar" como texto livre
        if (/^[aA]/.test(value) && value.length <= 12) return value
        // Remove tudo que não é dígito
        const digits = value.replace(/\D/g, "")
        if (!digits) return ""
        // Formata como moeda brasileira: 1234567 → 12.345,67
        const number = parseInt(digits, 10) / 100
        return "R$ " + number.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    }

    const toggleBeneficio = (b: string) => {
        setBeneficiosMarcados(prev => prev.includes(b) ? prev.filter(x => x !== b) : [...prev, b])
    }

    const buildBeneficios = (): string | null => {
        const partes: string[] = [...beneficiosMarcados]
        if (beneficiosOutros.trim()) partes.push(`Outros: ${beneficiosOutros.trim()}`)
        return partes.length > 0 ? partes.join(", ") : null
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!titulo || !descricao || !tipoContrato) {
            toast.error("Preencha pelo menos título, descrição e tipo de contrato.")
            return
        }
        if (!unidadeDestino) {
            toast.error("Selecione a unidade de destino da vaga. Este campo é obrigatório.")
            return
        }
        if (setoresMarcados.length === 0) {
            toast.error("Selecione pelo menos uma área da vaga. Este campo é obrigatório.")
            return
        }
        if (!faixaEtaria) {
            toast.error("Selecione a idade mínima da vaga. Este campo é obrigatório.")
            return
        }
        if (!emailResponsavel || !telefoneResponsavel) {
            toast.error("Informe o e-mail e o telefone do responsável pela seleção.")
            return
        }
        setLoadingSubmit(true)
        try {
            const cargaHoraria = buildCargaHoraria(cargaTipo, cargaHoras, cargaEscalaT, cargaEscalaF, cargaDias, cargaTrabSabado, cargaSabadoAte)
            const res = await fetch("/api/empregabilidade/vagas", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    empresa_id: empresaId,
                    titulo,
                    descricao,
                    requisitos,
                    tipo_contrato: tipoContrato,
                    salario: salario || null,
                    total_vagas: totalVagas,
                    escolaridade_minima: escolaridadeMinima,
                    faixa_etaria: faixaEtaria,
                    carga_horaria: cargaHoraria || null,
                    local: local || null,
                    local_entrevista: localEntrevista,
                    beneficios: buildBeneficios(),
                    limite_curriculos: limiteCurriculos ? parseInt(limiteCurriculos) : null,
                    tipo_selecao: tipoSelecao || null,
                    unidade_cuca: unidadeCuca || null,
                    unidade_destino: unidadeDestino,
                    setor: setoresMarcados,
                    email_responsavel: emailResponsavel,
                    telefone_responsavel: telefoneResponsavel.replace(/\D/g, ""),
                    pcd_vaga: pcdVaga,
                    pcd_tipo: pcdVaga ? (pcdTipo || null) : null,
                    pcd_homologado: pcdVaga ? pcdHomologado : false,
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)
            const ref = data.numero_vaga ? `#${data.numero_vaga}` : data.id.slice(-6).toUpperCase()
            setNumeroVaga(ref)
            setVagaResumo({ titulo, tipo_contrato: tipoContrato, total_vagas: totalVagas, salario })
            setSuccess(true)
            toast.success("Vaga cadastrada com sucesso!")
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : "Erro desconhecido"
            toast.error(msg || "Não foi possível cadastrar a vaga agora.")
        } finally {
            setLoadingSubmit(false)
        }
    }

    if (loadingEmpresa) return (
        <div className="min-h-screen flex items-center justify-center bg-muted/30">
            <Loader2 className="h-10 w-10 animate-spin text-cuca-blue" />
        </div>
    )

    if (empresaInvalida) return (
        <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
            <Card className="max-w-md text-center p-8 border-none shadow-lg">
                <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
                <h2 className="text-xl font-bold mb-2">Link inválido</h2>
                <p className="text-muted-foreground text-sm">Este link não é válido ou a empresa não está cadastrada. Entre em contato com a unidade CUCA.</p>
            </Card>
        </div>
    )

    const copiarNumero = () => {
        navigator.clipboard.writeText(numeroVaga).then(() => { setCopiado(true); setTimeout(() => setCopiado(false), 2000) })
    }

    if (success) return (
        <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
            <Card className="max-w-md w-full border-none shadow-xl">
                <CardContent className="pt-10 pb-8 flex flex-col items-center text-center">
                    <div className="h-20 w-20 bg-green-500/15 rounded-full flex items-center justify-center mb-6">
                        <CheckCircle2 className="h-10 w-10 text-green-500" />
                    </div>
                    <h2 className="text-2xl font-bold tracking-tight mb-2">Vaga Cadastrada!</h2>
                    <p className="text-muted-foreground text-sm mb-6">Sua vaga foi recebida pela equipe do CUCA e será revisada antes de ser publicada.</p>
                    <div className="w-full bg-muted rounded-lg px-6 py-4 mb-4">
                        <p className="text-xs text-muted-foreground mb-2">Número de referência da vaga</p>
                        <div className="flex items-center justify-center gap-3">
                            <p className="text-3xl font-bold tracking-widest text-cuca-blue">{numeroVaga}</p>
                            <button onClick={copiarNumero} className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-md border border-cuca-blue/40 text-cuca-blue hover:bg-cuca-blue/10 transition-colors">
                                <Copy className="h-3.5 w-3.5" />
                                {copiado ? "Copiado!" : "Copiar"}
                            </button>
                        </div>
                    </div>
                    {vagaResumo && (
                        <div className="w-full bg-muted/50 rounded-lg px-5 py-4 mb-6 text-left space-y-2">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Resumo da Vaga</p>
                            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Cargo</span><span className="font-medium">{vagaResumo.titulo}</span></div>
                            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Contrato</span><span className="font-medium">{vagaResumo.tipo_contrato}</span></div>
                            <div className="flex justify-between text-sm"><span className="text-muted-foreground">Posições</span><span className="font-medium">{vagaResumo.total_vagas}</span></div>
                            {vagaResumo.salario && <div className="flex justify-between text-sm"><span className="text-muted-foreground">Remuneração</span><span className="font-medium">{vagaResumo.salario}</span></div>}
                            {unidadeCuca && <div className="flex justify-between text-sm"><span className="text-muted-foreground">Unidade</span><span className="font-medium">{unidadeCuca}</span></div>}
                        </div>
                    )}
                    <p className="text-xs text-muted-foreground mb-6">Guarde esse número para acompanhar o status pelo WhatsApp da unidade. Em breve você receberá uma confirmação.</p>
                    <button onClick={() => window.close()} className="flex items-center gap-2 w-full justify-center px-4 py-3 rounded-lg bg-muted hover:bg-muted/80 text-sm font-medium transition-colors">
                        <X className="h-4 w-4" />Encerrar
                    </button>
                </CardContent>
            </Card>
        </div>
    )

    const cargaPreview = buildCargaHoraria(cargaTipo, cargaHoras, cargaEscalaT, cargaEscalaF, cargaDias, cargaTrabSabado, cargaSabadoAte)

    return (
        <div className="min-h-screen bg-muted/30 pb-12">
            <div className="bg-cuca-dark text-white pt-16 pb-24 px-4 sm:px-6 lg:px-8">
                <div className="max-w-2xl mx-auto space-y-3">
                    <Badge className="bg-cuca-yellow text-cuca-dark hover:bg-cuca-yellow/90">Empregabilidade CUCA</Badge>
                    <h1 className="text-3xl font-bold tracking-tight">Cadastro de Vaga</h1>
                    <div className="flex items-center gap-2 text-gray-300 text-sm">
                        <Building2 className="h-4 w-4" />
                        <span>{empresa?.nome}</span>
                    </div>
                </div>
            </div>

            <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 -mt-12 space-y-5">
                <Card className="border-none shadow-md">
                    <CardHeader className="border-b bg-muted/20">
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <Briefcase className="h-5 w-5 text-cuca-blue" />
                            Dados da Vaga
                        </CardTitle>
                        <CardDescription>
                            Preencha todas as informações da oportunidade. As informações fornecidas são de responsabilidade da empresa. Após envio, a equipe CUCA revisará e publicará a vaga.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-6">
                        <form onSubmit={handleSubmit} className="space-y-5">

                            {/* Título */}
                            <div className="space-y-2">
                                <Label htmlFor="titulo">Título / Cargo *</Label>
                                <Input id="titulo" value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ex: Atendente de Loja, Auxiliar Administrativo" required />
                            </div>

                            {/* Unidade de Destino — OBRIGATÓRIO */}
                            <div className="space-y-2">
                                <Label htmlFor="unidadeDestino" className="flex items-center gap-1.5">
                                    <MapPin className="h-4 w-4 text-cuca-blue" />
                                    Unidade de Destino da Vaga *
                                </Label>
                                <Select value={unidadeDestino} onValueChange={setUnidadeDestino} required>
                                    <SelectTrigger id="unidadeDestino" className={`w-full ${!unidadeDestino ? "border-amber-500/60 focus:ring-amber-500" : ""}`}>
                                        <SelectValue placeholder="Selecione para qual unidade é esta vaga..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {unidadesOpcoes.map(u => (
                                            <SelectItem key={u.value} value={u.value}>{u.label}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground">
                                    Escolha <strong>Toda a Rede CUCA</strong> se qualquer unidade pode atender esta vaga, ou selecione a unidade específica responsável pelo processo seletivo.
                                </p>
                            </div>

                            {/* Descrição */}
                            <div className="space-y-2">
                                <Label htmlFor="descricao">Descrição da Vaga *</Label>
                                <Textarea id="descricao" value={descricao} onChange={e => setDescricao(e.target.value)} placeholder="Descreva as atividades, responsabilidades e o dia a dia da função..." rows={4} required />
                            </div>

                            {/* Requisitos */}
                            <div className="space-y-2">
                                <Label htmlFor="requisitos">Requisitos</Label>
                                <Textarea id="requisitos" value={requisitos} onChange={e => setRequisitos(e.target.value)} placeholder="Ex: Experiência com atendimento ao público, domínio de Excel..." rows={3} />
                            </div>

                            {/* Tipo de contrato + Posições */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="tipoContrato">Tipo de Contrato *</Label>
                                    <select id="tipoContrato" value={tipoContrato} onChange={e => setTipoContrato(e.target.value)} required className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                        <option value="">Selecionar...</option>
                                        {TIPOS_CONTRATO.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="totalVagas">Nº de Posições</Label>
                                    <Input id="totalVagas" type="number" min="1" value={totalVagas} onChange={e => setTotalVagas(e.target.value)} />
                                </div>
                            </div>

                            {/* Remuneração + Escolaridade */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="salario">Remuneração</Label>
                                    <Input id="salario" value={salario} onChange={e => setSalario(formatarSalario(e.target.value))} placeholder="Ex: R$ 1.500,00 ou A combinar" /></div>
                                <div className="space-y-2">
                                    <Label htmlFor="escolaridade">Escolaridade Mínima</Label>
                                    <select id="escolaridade" value={escolaridadeMinima} onChange={e => setEscolaridadeMinima(e.target.value)} className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                        <option value="">Não exigida</option>
                                        {ESCOLARIDADES.map(e => <option key={e} value={e}>{e}</option>)}
                                    </select>
                                </div>
                            </div>

                            {/* Faixa etária + Localização */}
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="faixaEtaria">Idade Mínima *</Label>
                                    <Select value={faixaEtaria} onValueChange={setFaixaEtaria} required>
                                        <SelectTrigger id="faixaEtaria" className={!faixaEtaria ? "border-amber-500/60" : ""}>
                                            <SelectValue placeholder="Selecione a idade mínima..." />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="A partir de 14 anos">A partir de 14 anos</SelectItem>
                                            <SelectItem value="Maior de 18 anos">Maior de 18 anos</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div className="space-y-2">
                                    <Label htmlFor="local">Localização da Vaga</Label>
                                    <Input id="local" value={local} onChange={e => setLocal(e.target.value)} placeholder="Bairro ou endereço do trabalho" />
                                </div>
                            </div>

                            {/* Local da entrevista */}
                            <div className="space-y-2">
                                <Label htmlFor="localEntrevista">Local da Entrevista</Label>
                                <div className="grid grid-cols-3 gap-2">
                                    {[
                                        { value: "na_empresa", label: "Na Empresa Contratante" },
                                        { value: "no_cuca", label: "No CUCA" },
                                        { value: "online", label: "Online" },
                                    ].map(op => (
                                        <label key={op.value} className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer text-sm transition-colors ${localEntrevista === op.value ? "border-cuca-blue bg-cuca-blue/10 text-cuca-blue font-medium" : "border-border hover:border-cuca-blue/50"}`}>
                                            <input type="radio" name="localEntrevista" value={op.value} checked={localEntrevista === op.value} onChange={() => setLocalEntrevista(op.value)} className="accent-cuca-blue" />
                                            {op.label}
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* Carga horária estruturada */}
                            <div className="space-y-3 border rounded-xl p-4 bg-muted/20">
                                <div className="flex items-center gap-2">
                                    <Clock className="h-4 w-4 text-cuca-blue" />
                                    <Label className="text-base font-semibold">Carga Horária</Label>
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    {(["horario_comercial", "escala", "jornada_corrida"] as const).map(t => (
                                        <button key={t} type="button" onClick={() => setCargaTipo(t)}
                                            className={`text-xs px-3 py-2 rounded-lg border transition-colors ${cargaTipo === t ? "bg-cuca-blue text-white border-cuca-blue" : "border-border text-muted-foreground hover:border-cuca-blue/50"}`}>
                                            {t === "horario_comercial" ? "Horário Comercial" : t === "escala" ? "Escala" : "Jornada Corrida"}
                                        </button>
                                    ))}
                                </div>

                                {cargaTipo === "escala" && (
                                    <div className="flex items-center gap-2 mt-1">
                                        <Input className="w-20 text-center" value={cargaEscalaT} onChange={e => setCargaEscalaT(e.target.value)} placeholder="6" />
                                        <span className="text-muted-foreground font-bold text-lg">×</span>
                                        <Input className="w-20 text-center" value={cargaEscalaF} onChange={e => setCargaEscalaF(e.target.value)} placeholder="2" />
                                        <span className="text-xs text-muted-foreground">(dias trabalhados × dias de folga)</span>
                                    </div>
                                )}

                                {(cargaTipo === "horario_comercial" || cargaTipo === "jornada_corrida") && (
                                    <div className="space-y-3 mt-1">
                                        <div className="flex items-center gap-2">
                                            <Input className="w-20 text-center" value={cargaHoras} onChange={e => setCargaHoras(e.target.value)} placeholder="8" />
                                            <span className="text-sm text-muted-foreground">horas / dia</span>
                                        </div>
                                        {cargaTipo === "horario_comercial" && (
                                            <>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm text-muted-foreground w-12 shrink-0">Dias:</span>
                                                    <Input value={cargaDias} onChange={e => setCargaDias(e.target.value)} placeholder="Seg à Sex" />
                                                </div>
                                                <div className="flex items-center gap-3 flex-wrap">
                                                    <label className="flex items-center gap-2 cursor-pointer">
                                                        <input type="checkbox" className="accent-cuca-blue" checked={cargaTrabSabado} onChange={e => setCargaTrabSabado(e.target.checked)} />
                                                        <span className="text-sm">Trabalha aos sábados até</span>
                                                    </label>
                                                    {cargaTrabSabado && (
                                                        <Input type="time" value={cargaSabadoAte} onChange={e => setCargaSabadoAte(e.target.value)} className="w-32" />
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}

                                {cargaPreview && (
                                    <p className="text-xs text-muted-foreground bg-muted px-3 py-1.5 rounded-md">
                                        Resumo: <span className="font-medium text-foreground">{cargaPreview}</span>
                                    </p>
                                )}
                            </div>

                            {/* Benefícios */}
                            <div className="space-y-3 pt-1">
                                <div className="flex items-center gap-2">
                                    <Gift className="h-4 w-4 text-cuca-blue" />
                                    <Label className="text-base font-semibold">Benefícios Oferecidos</Label>
                                    <span className="text-xs text-muted-foreground">(opcional)</span>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    {BENEFICIOS_OPCOES.map(b => (
                                        <label key={b} className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer text-sm transition-colors ${beneficiosMarcados.includes(b) ? "border-cuca-blue bg-cuca-blue/10 text-cuca-blue font-medium" : "border-border hover:border-cuca-blue/50"}`}>
                                            <input type="checkbox" className="accent-cuca-blue" checked={beneficiosMarcados.includes(b)} onChange={() => toggleBeneficio(b)} />
                                            {b}
                                        </label>
                                    ))}
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="beneficiosOutros" className="text-sm text-muted-foreground">Outros benefícios</Label>
                                    <Input id="beneficiosOutros" value={beneficiosOutros} onChange={e => setBeneficiosOutros(e.target.value)} placeholder="Ex: Gympass, seguro de vida, auxílio home office..." />
                                </div>
                            </div>

                            {/* Limite de currículos */}
                            <div className="space-y-2 pt-1">
                                <Label htmlFor="limiteCurriculos">Quantos currículos deseja analisar?</Label>
                                <Input id="limiteCurriculos" type="number" min="1" value={limiteCurriculos} onChange={e => setLimiteCurriculos(e.target.value)} placeholder="Ex: 20 (deixe em branco para sem limite)" />
                                <p className="text-xs text-muted-foreground">Ao atingir esse limite, novos candidatos serão direcionados ao banco de talentos da unidade.</p>
                            </div>

                            {/* Área da vaga */}
                            <div className="space-y-3 pt-1">
                                <div>
                                    <Label className="text-base font-semibold">Área da Vaga *</Label>
                                    <p className="text-xs text-muted-foreground mt-0.5">Selecione pelo menos uma categoria que melhor representa esta vaga.</p>
                                </div>
                                <div className="grid grid-cols-1 gap-2">
                                    {SETORES_VAGA.map(s => (
                                        <label key={s} className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer text-sm transition-colors ${setoresMarcados.includes(s) ? "border-cuca-blue bg-cuca-blue/10 text-cuca-blue font-medium" : "border-border hover:border-cuca-blue/50"}`}>
                                            <input type="checkbox" className="accent-cuca-blue" checked={setoresMarcados.includes(s)} onChange={() => toggleSetor(s)} />
                                            {s}
                                        </label>
                                    ))}
                                </div>
                            </div>

                            {/* PCD */}
                            <div className="space-y-3 pt-1">
                                <Label className="text-base font-semibold">Vaga para Pessoa com Deficiência (PCD)?</Label>
                                <div className="flex gap-3">
                                    <label className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 cursor-pointer text-sm transition-colors ${!pcdVaga ? "border-cuca-blue bg-cuca-blue/10 text-cuca-blue font-medium" : "border-border"}`}>
                                        <input type="radio" name="pcdVaga" checked={!pcdVaga} onChange={() => { setPcdVaga(false); setPcdTipo(""); setPcdHomologado(false) }} className="accent-cuca-blue" /> Não
                                    </label>
                                    <label className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 cursor-pointer text-sm transition-colors ${pcdVaga ? "border-cuca-blue bg-cuca-blue/10 text-cuca-blue font-medium" : "border-border"}`}>
                                        <input type="radio" name="pcdVaga" checked={pcdVaga} onChange={() => setPcdVaga(true)} className="accent-cuca-blue" /> Sim
                                    </label>
                                </div>
                                {pcdVaga && (
                                    <div className="space-y-3 border rounded-xl p-4 bg-blue-500/5 border-blue-500/20">
                                        <div className="space-y-1.5">
                                            <Label htmlFor="pcdTipo">Tipo de deficiência aceita (opcional)</Label>
                                            <Input id="pcdTipo" value={pcdTipo} onChange={e => setPcdTipo(e.target.value)} placeholder="Ex: Física, Visual, Auditiva, qualquer" />
                                        </div>
                                        <label className="flex items-center gap-2 cursor-pointer text-sm">
                                            <input type="checkbox" className="accent-cuca-blue" checked={pcdHomologado} onChange={e => setPcdHomologado(e.target.checked)} />
                                            Vaga homologada para PCD
                                        </label>
                                    </div>
                                )}
                            </div>

                            {/* Responsável pela seleção */}
                            <div className="space-y-3 pt-1 border rounded-xl p-4 bg-amber-500/5 border-amber-500/20">
                                <div>
                                    <Label className="text-base font-semibold">Contato do Responsável pela Seleção *</Label>
                                    <p className="text-xs text-muted-foreground mt-0.5">Informe os dados de quem coordena o processo seletivo nesta empresa — pode ser diferente do contato geral da empresa.</p>
                                </div>
                                <div className="grid grid-cols-1 gap-3">
                                    <div className="space-y-1.5">
                                        <Label htmlFor="emailResponsavel">E-mail para receber currículos *</Label>
                                        <Input id="emailResponsavel" type="email" value={emailResponsavel} onChange={e => setEmailResponsavel(e.target.value)} placeholder="rh@empresa.com.br" required />
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label htmlFor="telefoneResponsavel">Telefone / WhatsApp do responsável *</Label>
                                        <Input id="telefoneResponsavel" type="tel" value={telefoneResponsavel} onChange={e => setTelefoneResponsavel(e.target.value)} placeholder="(85) 99999-9999" required />
                                    </div>
                                </div>
                            </div>

                            {/* Tipo de seleção */}
                            <div className="space-y-3 pt-1">
                                <Label className="text-base font-semibold">Tipo de Processo Seletivo</Label>
                                <div className="space-y-2">
                                    {TIPOS_SELECAO.map(ts => {
                                        const label = ts.value === "triagem_cuca" && unidadeCuca ? `Triagem Inicial pelo CUCA ${unidadeCuca}` : ts.label
                                        return (
                                            <label key={ts.value} className={`flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${tipoSelecao === ts.value ? "border-cuca-blue bg-cuca-blue/10" : "border-border hover:border-cuca-blue/50"}`}>
                                                <input type="radio" name="tipoSelecao" value={ts.value} checked={tipoSelecao === ts.value} onChange={() => setTipoSelecao(ts.value)} className="mt-0.5 accent-cuca-blue" />
                                                <div>
                                                    <p className={`text-sm font-medium ${tipoSelecao === ts.value ? "text-cuca-blue" : ""}`}>{label}</p>
                                                    <p className="text-xs text-muted-foreground mt-0.5">{ts.desc}</p>
                                                </div>
                                            </label>
                                        )
                                    })}
                                </div>
                            </div>

                            <Button type="submit" className="w-full mt-2 bg-cuca-blue hover:bg-sky-800 text-white font-bold" disabled={loadingSubmit}>
                                {loadingSubmit ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enviando...</> : "Cadastrar Vaga"}
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
