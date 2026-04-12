"use client"

import { useState, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Building2, Briefcase, CheckCircle2, Loader2, AlertTriangle, Gift, X, PencilLine } from "lucide-react"
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

function parseBeneficios(raw: string | null): { marcados: string[]; outros: string } {
    if (!raw) return { marcados: [], outros: "" }
    const partes = raw.split(", ")
    const marcados: string[] = []
    const outrosParts: string[] = []
    for (const p of partes) {
        if (BENEFICIOS_OPCOES.includes(p)) {
            marcados.push(p)
        } else if (p.startsWith("Outros: ")) {
            outrosParts.push(p.replace("Outros: ", ""))
        } else if (p.trim()) {
            outrosParts.push(p.trim())
        }
    }
    return { marcados, outros: outrosParts.join(", ") }
}

type VagaData = {
    id: string
    empresa_id: string
    titulo: string
    descricao: string
    requisitos: string | null
    tipo_contrato: string
    salario: string | null
    total_vagas: number
    escolaridade_minima: string | null
    beneficios: string | null
    limite_curriculos: number | null
    tipo_selecao: string | null
    unidade_cuca: string | null
    status: string
    numero_vaga: number | null
}

export default function EditarVagaEmpresaPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-muted/30">
                <Loader2 className="h-10 w-10 animate-spin text-cuca-blue" />
            </div>
        }>
            <EditarVagaEmpresaContent />
        </Suspense>
    )
}

function EditarVagaEmpresaContent() {
    const searchParams = useSearchParams()
    const vagaId = searchParams.get("vaga_id")
    const empresaId = searchParams.get("empresa_id")

    const [vaga, setVaga] = useState<VagaData | null>(null)
    const [empresa, setEmpresa] = useState<{ id: string; nome: string } | null>(null)
    const [loading, setLoading] = useState(true)
    const [linkInvalido, setLinkInvalido] = useState(false)
    const [cancelada, setCancelada] = useState(false)

    // Campos do formulário
    const [titulo, setTitulo] = useState("")
    const [descricao, setDescricao] = useState("")
    const [requisitos, setRequisitos] = useState("")
    const [tipoContrato, setTipoContrato] = useState("")
    const [salario, setSalario] = useState("")
    const [totalVagas, setTotalVagas] = useState("1")
    const [escolaridadeMinima, setEscolaridadeMinima] = useState("")
    const [beneficiosMarcados, setBeneficiosMarcados] = useState<string[]>([])
    const [beneficiosOutros, setBeneficiosOutros] = useState("")
    const [limiteCurriculos, setLimiteCurriculos] = useState("")
    const [tipoSelecao, setTipoSelecao] = useState("")

    // Snapshot dos valores originais para calcular diff
    const [snapshot, setSnapshot] = useState<Record<string, string | number | null>>({})

    const [loadingSubmit, setLoadingSubmit] = useState(false)
    const [success, setSuccess] = useState(false)

    useEffect(() => {
        if (!vagaId || !empresaId) {
            setLinkInvalido(true)
            setLoading(false)
            return
        }

        const fetchData = async () => {
            try {
                // Buscar dados da vaga (via endpoint público de empresa para validar posse)
                const res = await fetch(`/api/empregabilidade/vagas/${vagaId}?empresa_id=${encodeURIComponent(empresaId)}`)
                const data = await res.json()

                if (!res.ok || data.error) {
                    setLinkInvalido(true)
                    setLoading(false)
                    return
                }

                if (data.status === "cancelada") {
                    setCancelada(true)
                    setLoading(false)
                    return
                }

                const v: VagaData = data
                setVaga(v)
                setEmpresa({ id: v.empresa_id, nome: data.empresa_nome || "" })

                // Preencher formulário com dados existentes
                setTitulo(v.titulo || "")
                setDescricao(v.descricao || "")
                setRequisitos(v.requisitos || "")
                setTipoContrato(v.tipo_contrato || "")
                setSalario(v.salario || "")
                setTotalVagas(String(v.total_vagas || 1))
                setEscolaridadeMinima(v.escolaridade_minima || "")
                setLimiteCurriculos(v.limite_curriculos ? String(v.limite_curriculos) : "")
                setTipoSelecao(v.tipo_selecao || "")

                const { marcados, outros } = parseBeneficios(v.beneficios)
                setBeneficiosMarcados(marcados)
                setBeneficiosOutros(outros)

                // Guardar snapshot dos valores originais
                setSnapshot({
                    titulo: v.titulo || "",
                    descricao: v.descricao || "",
                    requisitos: v.requisitos || "",
                    tipo_contrato: v.tipo_contrato || "",
                    salario: v.salario || "",
                    total_vagas: v.total_vagas || 1,
                    escolaridade_minima: v.escolaridade_minima || "",
                    beneficios: v.beneficios || "",
                    limite_curriculos: v.limite_curriculos ?? "",
                    tipo_selecao: v.tipo_selecao || "",
                })
            } catch {
                setLinkInvalido(true)
            } finally {
                setLoading(false)
            }
        }

        fetchData()
    }, [vagaId, empresaId])

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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!titulo || !descricao || !tipoContrato) {
            toast.error("Preencha pelo menos título, descrição e tipo de contrato.")
            return
        }

        // Calcular diff — apenas campos que mudaram
        const atual: Record<string, string | number | null> = {
            titulo,
            descricao,
            requisitos: requisitos || "",
            tipo_contrato: tipoContrato,
            salario: salario || "",
            total_vagas: parseInt(totalVagas) || 1,
            escolaridade_minima: escolaridadeMinima || "",
            beneficios: buildBeneficios() || "",
            limite_curriculos: limiteCurriculos ? parseInt(limiteCurriculos) : "",
            tipo_selecao: tipoSelecao || "",
        }

        const diff: Record<string, string | number | null> = {}
        for (const key of Object.keys(atual)) {
            const valorAtual = atual[key]
            const valorOriginal = snapshot[key]
            if (String(valorAtual) !== String(valorOriginal ?? "")) {
                diff[key] = valorAtual === "" ? null : valorAtual
            }
        }

        if (Object.keys(diff).length === 0) {
            toast("Nenhuma alteração detectada.", { icon: "ℹ️" })
            return
        }

        setLoadingSubmit(true)
        try {
            const res = await fetch(`/api/empregabilidade/vagas/${vagaId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ empresa_id: empresaId, diff }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)

            setSuccess(true)
            toast.success("Alterações enviadas com sucesso!")
        } catch (error: any) {
            console.error("Erro ao editar vaga:", error)
            toast.error(error.message || "Não foi possível salvar as alterações.")
        } finally {
            setLoadingSubmit(false)
        }
    }

    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-muted/30">
                <Loader2 className="h-10 w-10 animate-spin text-cuca-blue" />
            </div>
        )
    }

    if (cancelada) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
                <Card className="max-w-md text-center p-8 border-none shadow-lg">
                    <AlertTriangle className="h-12 w-12 text-red-500 mx-auto mb-4" />
                    <h2 className="text-xl font-bold mb-2">Vaga cancelada</h2>
                    <p className="text-muted-foreground text-sm">
                        Esta vaga foi cancelada e não pode mais ser editada. Caso queira publicar essa oportunidade novamente, entre em contato com a unidade CUCA para cadastrar uma nova vaga.
                    </p>
                </Card>
            </div>
        )
    }

    if (linkInvalido) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
                <Card className="max-w-md text-center p-8 border-none shadow-lg">
                    <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
                    <h2 className="text-xl font-bold mb-2">Link inválido</h2>
                    <p className="text-muted-foreground text-sm">
                        Este link não é válido ou a vaga não pertence à sua empresa. Entre em contato com a unidade CUCA.
                    </p>
                </Card>
            </div>
        )
    }

    if (success) {
        const unidadeCuca = vaga?.unidade_cuca || "CUCA"
        return (
            <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
                <Card className="max-w-md w-full border-none shadow-xl">
                    <CardContent className="pt-10 pb-8 flex flex-col items-center text-center">
                        <div className="h-20 w-20 bg-green-500/15 rounded-full flex items-center justify-center mb-6">
                            <CheckCircle2 className="h-10 w-10 text-green-500" />
                        </div>
                        <h2 className="text-2xl font-bold tracking-tight mb-2">Alterações Enviadas!</h2>
                        <p className="text-muted-foreground text-sm mb-6">
                            Suas alterações foram salvas. A vaga voltou para análise e em breve você receberá uma confirmação pelo WhatsApp.
                        </p>
                        <div className="w-full bg-muted/50 rounded-lg px-5 py-4 mb-6 text-left text-sm text-muted-foreground">
                            <p className="font-semibold text-foreground mb-1">Próximos passos</p>
                            <p>A equipe <strong>CUCA {unidadeCuca}</strong> irá revisar as alterações antes de a vaga voltar a aceitar novas candidaturas.</p>
                        </div>
                        <button
                            onClick={() => window.close()}
                            className="flex items-center gap-2 w-full justify-center px-4 py-3 rounded-lg bg-muted hover:bg-muted/80 text-sm font-medium transition-colors"
                        >
                            <X className="h-4 w-4" />
                            Encerrar
                        </button>
                    </CardContent>
                </Card>
            </div>
        )
    }

    const unidadeCuca = vaga?.unidade_cuca || ""
    const numeroRef = vaga?.numero_vaga ? `#${vaga.numero_vaga}` : ""

    return (
        <div className="min-h-screen bg-muted/30 pb-12">
            <div className="bg-cuca-dark text-white pt-16 pb-24 px-4 sm:px-6 lg:px-8">
                <div className="max-w-2xl mx-auto space-y-3">
                    <Badge className="bg-cuca-yellow text-cuca-dark hover:bg-cuca-yellow/90">Empregabilidade CUCA</Badge>
                    <h1 className="text-3xl font-bold tracking-tight">Editar Vaga {numeroRef}</h1>
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
                            <PencilLine className="h-5 w-5 text-cuca-blue" />
                            Dados da Vaga
                        </CardTitle>
                        <CardDescription>
                            Altere apenas os campos que deseja modificar. Após envio, a equipe CUCA revisará as alterações antes de publicar novamente.
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

                            {/* Benefícios */}
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

                            {/* Limite de currículos */}
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

                            {/* Tipo de seleção */}
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
                                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando...</>
                                ) : (
                                    "Salvar Alterações"
                                )}
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
