"use client"

import { useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Building2, Briefcase, CheckCircle2, Loader2, AlertTriangle, Gift } from "lucide-react"
import toast from "react-hot-toast"

const TIPOS_CONTRATO = ["CLT", "PJ", "Estágio", "Temporário", "Aprendiz", "Freelancer"]
const ESCOLARIDADES = ["Fundamental Incompleto", "Fundamental Completo", "Médio Incompleto", "Médio Completo", "Superior Incompleto", "Superior Completo"]

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

export default function NovaVagaEmpresaPage() {
    const searchParams = useSearchParams()
    const empresaId = searchParams.get("empresa_id")
    const unidadeCuca = searchParams.get("unidade_cuca") || ""

    const [empresa, setEmpresa] = useState<{ id: string; nome: string } | null>(null)
    const [loadingEmpresa, setLoadingEmpresa] = useState(true)
    const [empresaInvalida, setEmpresaInvalida] = useState(false)

    const [titulo, setTitulo] = useState("")
    const [descricao, setDescricao] = useState("")
    const [requisitos, setRequisitos] = useState("")
    const [tipoContrato, setTipoContrato] = useState("")
    const [salario, setSalario] = useState("")
    const [totalVagas, setTotalVagas] = useState("1")
    const [escolaridadeMinima, setEscolaridadeMinima] = useState("")

    // Novos campos Sprint 30
    const [beneficiosMarcados, setBeneficiosMarcados] = useState<string[]>([])
    const [beneficiosOutros, setBeneficiosOutros] = useState("")
    const [limiteCurriculos, setLimiteCurriculos] = useState("")
    const [tipoSelecao, setTipoSelecao] = useState("")

    const [loadingSubmit, setLoadingSubmit] = useState(false)
    const [success, setSuccess] = useState(false)
    const [numeroVaga, setNumeroVaga] = useState("")

    useEffect(() => {
        if (!empresaId) {
            setEmpresaInvalida(true)
            setLoadingEmpresa(false)
            return
        }
        fetch(`/api/empregabilidade/empresa?id=${encodeURIComponent(empresaId)}`)
            .then((r) => r.json())
            .then((data) => {
                if (data.error || !data.id) {
                    setEmpresaInvalida(true)
                } else {
                    setEmpresa(data)
                }
                setLoadingEmpresa(false)
            })
            .catch(() => {
                setEmpresaInvalida(true)
                setLoadingEmpresa(false)
            })
    }, [empresaId])

    const toggleBeneficio = (b: string) => {
        setBeneficiosMarcados((prev) =>
            prev.includes(b) ? prev.filter((x) => x !== b) : [...prev, b]
        )
    }

    const buildBeneficios = (): string | null => {
        const partes: string[] = [...beneficiosMarcados]
        if (beneficiosOutros.trim()) partes.push(`Outros: ${beneficiosOutros.trim()}`)
        return partes.length > 0 ? partes.join(", ") : null
    }

    const getLabelTipoSelecao = (value: string) => {
        if (value === "triagem_cuca" && unidadeCuca) {
            return `Triagem Inicial pelo CUCA ${unidadeCuca}`
        }
        return TIPOS_SELECAO.find((t) => t.value === value)?.label || value
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!titulo || !descricao || !tipoContrato) {
            toast.error("Preencha pelo menos título, descrição e tipo de contrato.")
            return
        }

        setLoadingSubmit(true)
        try {
            const res = await fetch("/api/empregabilidade/vagas", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    empresa_id: empresaId,
                    titulo,
                    descricao,
                    requisitos,
                    tipo_contrato: tipoContrato,
                    salario,
                    total_vagas: totalVagas,
                    escolaridade_minima: escolaridadeMinima,
                    beneficios: buildBeneficios(),
                    limite_curriculos: limiteCurriculos ? parseInt(limiteCurriculos) : null,
                    tipo_selecao: tipoSelecao || null,
                    unidade_cuca: unidadeCuca || null,
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)

            setNumeroVaga(data.id.slice(-6).toUpperCase())
            setSuccess(true)
            toast.success("Vaga cadastrada com sucesso!")
        } catch (error: any) {
            console.error("Erro ao cadastrar vaga:", error)
            toast.error(error.message || "Não foi possível cadastrar a vaga agora.")
        } finally {
            setLoadingSubmit(false)
        }
    }

    if (loadingEmpresa) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-muted/30">
                <Loader2 className="h-10 w-10 animate-spin text-cuca-blue" />
            </div>
        )
    }

    if (empresaInvalida) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
                <Card className="max-w-md text-center p-8 border-none shadow-lg">
                    <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
                    <h2 className="text-xl font-bold mb-2">Link inválido</h2>
                    <p className="text-muted-foreground text-sm">
                        Este link não é válido ou a empresa não está cadastrada. Entre em contato com a unidade CUCA.
                    </p>
                </Card>
            </div>
        )
    }

    if (success) {
        return (
            <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
                <Card className="max-w-md w-full border-none shadow-xl text-center">
                    <CardContent className="pt-10 pb-8 flex flex-col items-center">
                        <div className="h-20 w-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
                            <CheckCircle2 className="h-10 w-10 text-green-600" />
                        </div>
                        <h2 className="text-2xl font-bold tracking-tight mb-2">Vaga Cadastrada!</h2>
                        <p className="text-muted-foreground text-sm mb-4">
                            Sua vaga foi recebida pela equipe do CUCA e será revisada antes de ser publicada.
                        </p>
                        <div className="bg-muted rounded-lg px-6 py-3 mb-6">
                            <p className="text-xs text-muted-foreground mb-1">Número de referência da vaga</p>
                            <p className="text-2xl font-bold tracking-widest text-cuca-blue">{numeroVaga}</p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Guarde esse número para acompanhar o status da vaga pelo WhatsApp da unidade.
                        </p>
                    </CardContent>
                </Card>
            </div>
        )
    }

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
                {/* Dados da Vaga */}
                <Card className="border-none shadow-md">
                    <CardHeader className="border-b bg-muted/20">
                        <CardTitle className="flex items-center gap-2 text-lg">
                            <Briefcase className="h-5 w-5 text-cuca-blue" />
                            Dados da Vaga
                        </CardTitle>
                        <CardDescription>
                            Preencha as informações da oportunidade. Após envio, a equipe CUCA revisará e publicará a vaga.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="p-6">
                        <form onSubmit={handleSubmit} className="space-y-5">
                            <div className="space-y-2">
                                <Label htmlFor="titulo">Título / Cargo *</Label>
                                <Input
                                    id="titulo"
                                    value={titulo}
                                    onChange={(e) => setTitulo(e.target.value)}
                                    placeholder="Ex: Atendente de Loja, Auxiliar Administrativo"
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="descricao">Descrição da Vaga *</Label>
                                <Textarea
                                    id="descricao"
                                    value={descricao}
                                    onChange={(e) => setDescricao(e.target.value)}
                                    placeholder="Descreva as atividades, responsabilidades e o dia a dia da função..."
                                    rows={4}
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="requisitos">Requisitos</Label>
                                <Textarea
                                    id="requisitos"
                                    value={requisitos}
                                    onChange={(e) => setRequisitos(e.target.value)}
                                    placeholder="Ex: Experiência com atendimento ao público, domínio de Excel..."
                                    rows={3}
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="tipoContrato">Tipo de Contrato *</Label>
                                    <select
                                        id="tipoContrato"
                                        value={tipoContrato}
                                        onChange={(e) => setTipoContrato(e.target.value)}
                                        required
                                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    >
                                        <option value="">Selecionar...</option>
                                        {TIPOS_CONTRATO.map((t) => (
                                            <option key={t} value={t}>{t}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="totalVagas">Nº de Posições</Label>
                                    <Input
                                        id="totalVagas"
                                        type="number"
                                        min="1"
                                        value={totalVagas}
                                        onChange={(e) => setTotalVagas(e.target.value)}
                                    />
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-2">
                                    <Label htmlFor="salario">Remuneração</Label>
                                    <Input
                                        id="salario"
                                        value={salario}
                                        onChange={(e) => setSalario(e.target.value)}
                                        placeholder="Ex: R$ 1.500 ou A combinar"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="escolaridade">Escolaridade Mínima</Label>
                                    <select
                                        id="escolaridade"
                                        value={escolaridadeMinima}
                                        onChange={(e) => setEscolaridadeMinima(e.target.value)}
                                        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    >
                                        <option value="">Não exigida</option>
                                        {ESCOLARIDADES.map((e) => (
                                            <option key={e} value={e}>{e}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* S30-02: Benefícios */}
                            <div className="space-y-3 pt-1">
                                <div className="flex items-center gap-2">
                                    <Gift className="h-4 w-4 text-cuca-blue" />
                                    <Label className="text-base font-semibold">Benefícios Oferecidos</Label>
                                    <span className="text-xs text-muted-foreground">(opcional)</span>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                    {BENEFICIOS_OPCOES.map((b) => (
                                        <label
                                            key={b}
                                            className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer text-sm transition-colors ${
                                                beneficiosMarcados.includes(b)
                                                    ? "border-cuca-blue bg-cuca-blue/10 text-cuca-blue font-medium"
                                                    : "border-border hover:border-cuca-blue/50"
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                className="accent-cuca-blue"
                                                checked={beneficiosMarcados.includes(b)}
                                                onChange={() => toggleBeneficio(b)}
                                            />
                                            {b}
                                        </label>
                                    ))}
                                </div>
                                <div className="space-y-1">
                                    <Label htmlFor="beneficiosOutros" className="text-sm text-muted-foreground">Outros benefícios</Label>
                                    <Input
                                        id="beneficiosOutros"
                                        value={beneficiosOutros}
                                        onChange={(e) => setBeneficiosOutros(e.target.value)}
                                        placeholder="Ex: Gympass, seguro de vida, auxílio home office..."
                                    />
                                </div>
                            </div>

                            {/* S30-03: Limite de currículos */}
                            <div className="space-y-2 pt-1">
                                <Label htmlFor="limiteCurriculos">Quantos currículos deseja analisar?</Label>
                                <Input
                                    id="limiteCurriculos"
                                    type="number"
                                    min="1"
                                    value={limiteCurriculos}
                                    onChange={(e) => setLimiteCurriculos(e.target.value)}
                                    placeholder="Ex: 20 (deixe em branco para sem limite)"
                                />
                                <p className="text-xs text-muted-foreground">
                                    Ao atingir esse limite, novos candidatos serão direcionados ao banco de talentos da unidade.
                                </p>
                            </div>

                            {/* S30-04: Tipo de seleção */}
                            <div className="space-y-3 pt-1">
                                <Label className="text-base font-semibold">Tipo de Processo Seletivo</Label>
                                <div className="space-y-2">
                                    {TIPOS_SELECAO.map((ts) => {
                                        const label = ts.value === "triagem_cuca" && unidadeCuca
                                            ? `Triagem Inicial pelo CUCA ${unidadeCuca}`
                                            : ts.label
                                        return (
                                            <label
                                                key={ts.value}
                                                className={`flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer transition-colors ${
                                                    tipoSelecao === ts.value
                                                        ? "border-cuca-blue bg-cuca-blue/10"
                                                        : "border-border hover:border-cuca-blue/50"
                                                }`}
                                            >
                                                <input
                                                    type="radio"
                                                    name="tipoSelecao"
                                                    value={ts.value}
                                                    checked={tipoSelecao === ts.value}
                                                    onChange={() => setTipoSelecao(ts.value)}
                                                    className="mt-0.5 accent-cuca-blue"
                                                />
                                                <div>
                                                    <p className={`text-sm font-medium ${tipoSelecao === ts.value ? "text-cuca-blue" : ""}`}>{label}</p>
                                                    <p className="text-xs text-muted-foreground mt-0.5">{ts.desc}</p>
                                                </div>
                                            </label>
                                        )
                                    })}
                                </div>
                            </div>

                            <Button
                                type="submit"
                                className="w-full mt-2 bg-cuca-blue hover:bg-sky-800 text-white font-bold"
                                disabled={loadingSubmit}
                            >
                                {loadingSubmit ? (
                                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando...</>
                                ) : (
                                    "Cadastrar Vaga"
                                )}
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
