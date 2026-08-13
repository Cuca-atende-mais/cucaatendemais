"use client"

import { Suspense, useEffect, useState } from "react"
import type { ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { Controller, useFieldArray, useForm } from "react-hook-form"
import toast from "react-hot-toast"
import {
    AlertTriangle,
    ArrowLeft,
    BookOpen,
    Briefcase,
    CheckCircle2,
    Download,
    FileText,
    GraduationCap,
    Loader2,
    Plus,
    Save,
    Sparkles,
    Trash2,
    User,
    Wrench,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { serializarLinkParams, validarLinkAssinadoNoServidor } from "@/lib/empregabilidade/link-assinado-client"
import type { Atividade, CvDados } from "@/lib/empregabilidade/curriculo-tipos"

const ESCOLARIDADES = [
    "Ensino Fundamental Incompleto",
    "Ensino Fundamental Completo",
    "Ensino Médio Incompleto",
    "Ensino Médio Completo",
    "Ensino Técnico / Profissionalizante",
    "Ensino Superior Incompleto",
    "Ensino Superior Completo",
    "Pós-Graduação / MBA",
    "Mestrado",
    "Doutorado",
]

const defaultValues: CvDados = {
    nome: "",
    endereco: "",
    telefone: "",
    email: "",
    linkedin: "",
    portfolio: "",
    apresentacao: "",
    objetivo: "",
    experiencias: [],
    formacoes: [],
    cursos: [],
    habilidades: [],
}

// Máscara automática MM/AAAA pros campos de período de experiência (achado do
// Junior, 2026-08-13): candidato digitava livre e errava o formato esperado
// pelo matching da IA. Só dígitos são aceitos; a barra é inserida sozinha
// depois do 2º dígito, limitado a 6 dígitos (MMAAAA).
function formatMesAno(valor: string): string {
    const digitos = valor.replace(/\D/g, "").slice(0, 6)
    if (digitos.length <= 2) return digitos
    return `${digitos.slice(0, 2)}/${digitos.slice(2)}`
}

// SQS-61: dica de preenchimento por campo, linguagem simples — rascunho
// revisado e aprovado pelo Junior em 2026-08-13. Não aparece no formulário
// interno do dashboard (esse é só pro público, que nunca teve orientação
// nenhuma pra preencher currículo).
function Dica({ children }: { children: ReactNode }) {
    return <p className="text-xs text-muted-foreground">{children}</p>
}

function Section({ icon, title, children }: {
    icon: ReactNode
    title: string
    children: ReactNode
}) {
    return (
        <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base text-slate-900">
                    {icon}
                    {title}
                </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
                {children}
            </CardContent>
        </Card>
    )
}

export default function CurriculoPublicoPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen bg-slate-50 flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-cuca-blue" />
            </div>
        }>
            <CurriculoPublicoContent />
        </Suspense>
    )
}

function CurriculoPublicoContent() {
    const searchParams = useSearchParams()
    const linkParams = serializarLinkParams(searchParams)
    const [loadingLink, setLoadingLink] = useState(true)
    const [linkInvalido, setLinkInvalido] = useState(false)
    const [saving, setSaving] = useState(false)
    const [downloadUrl, setDownloadUrl] = useState("")
    // SQS-62: 3 habilidades em texto livre que a IA usa pra montar o texto
    // de apresentação — não fazem parte do CvDados, são só insumo do botão.
    const [habilidadesIA, setHabilidadesIA] = useState(["", "", ""])
    const [gerandoApresentacao, setGerandoApresentacao] = useState(false)

    // Nome já vem preenchido (coletado no WhatsApp antes do link ser emitido).
    // Telefone e os demais campos ficam em branco: quem abre o link pode estar
    // usando um celular diferente do número que deve constar no currículo —
    // decisão do Junior, 2026-08-12.
    const { control, handleSubmit, register, reset, watch, setValue, getValues } = useForm<CvDados>({
        defaultValues: {
            ...defaultValues,
            nome: searchParams.get("nome") || "",
        },
    })

    const expFields = useFieldArray({ control, name: "experiencias" })
    const formFields = useFieldArray({ control, name: "formacoes" })
    const cursoFields = useFieldArray({ control, name: "cursos" })
    const habFields = useFieldArray({ control, name: "habilidades" })

    useEffect(() => {
        let cancelled = false
        async function validate() {
            const ok = await validarLinkAssinadoNoServidor(searchParams)
            if (cancelled) return
            setLinkInvalido(!ok)
            setLoadingLink(false)
        }
        validate()
        return () => { cancelled = true }
    }, [searchParams])

    // SQS-62: gera o texto de apresentação a partir das 3 habilidades. Se já
    // houver texto no campo, pede confirmação antes de sobrescrever (AC3).
    const gerarApresentacaoComIA = async () => {
        const habilidadesPreenchidas = habilidadesIA.map(h => h.trim()).filter(Boolean)
        if (habilidadesPreenchidas.length === 0) {
            toast.error("Informe ao menos 1 habilidade pra IA usar.")
            return
        }
        const textoAtual = getValues("apresentacao")
        if (textoAtual?.trim() && !window.confirm("Já existe um texto de apresentação. Substituir pelo texto gerado pela IA?")) {
            return
        }
        setGerandoApresentacao(true)
        try {
            const res = await fetch("/api/empregabilidade/curriculo/gerar-apresentacao", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ habilidades: habilidadesPreenchidas, link_params: linkParams }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)
            setValue("apresentacao", data.apresentacao, { shouldDirty: true })
            toast.success("Texto gerado! Você pode editar à vontade antes de salvar.")
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Não foi possível gerar o texto agora."
            toast.error(message)
        } finally {
            setGerandoApresentacao(false)
        }
    }

    const onSubmit = async (values: CvDados) => {
        if (!values.nome || !values.telefone) {
            toast.error("Informe nome e telefone para salvar o currículo.")
            return
        }
        setSaving(true)
        setDownloadUrl("")
        try {
            const res = await fetch("/api/empregabilidade/curriculo/publico", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ link_params: linkParams, dados: values }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)
            setDownloadUrl(data.pdf_url)
            reset(values)
            toast.success("Currículo salvo e PDF gerado.")
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : "Não foi possível salvar agora."
            toast.error(message)
        } finally {
            setSaving(false)
        }
    }

    if (loadingLink) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
                <div className="flex items-center gap-3 text-slate-700">
                    <Loader2 className="h-5 w-5 animate-spin text-cuca-blue" />
                    Validando seu link...
                </div>
            </div>
        )
    }

    if (linkInvalido) {
        return (
            <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
                <Card className="max-w-md border-amber-200">
                    <CardContent className="pt-6 text-center space-y-3">
                        <AlertTriangle className="h-10 w-10 text-amber-600 mx-auto" />
                        <h1 className="text-xl font-semibold">Link inválido ou expirado</h1>
                        <p className="text-sm text-slate-600">
                            Solicite um novo link pelo WhatsApp da CUCA. Nenhum dado foi carregado.
                        </p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <main className="min-h-screen bg-slate-50">
            <div className="mx-auto max-w-4xl px-4 py-6 md:py-10">
                <div className="mb-6 rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
                    <p className="text-sm font-medium text-cuca-blue">Banco de Talentos CUCA</p>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-950">Criar currículo</h1>
                    <p className="mt-1 text-sm text-slate-600">
                        Preencha seus dados. Ao salvar, você receberá seu currículo em PDF.
                    </p>
                </div>

                {downloadUrl ? (
                    <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                        <div className="flex items-start gap-2">
                            <CheckCircle2 className="mt-0.5 h-4 w-4" />
                            <p>
                                Currículo salvo! O botão de download está logo abaixo do botão de salvar,
                                no final do formulário. Funciona uma única vez e expira em alguns minutos.
                            </p>
                        </div>
                    </div>
                ) : null}

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pb-24">
                    <Section icon={<User className="h-4 w-4" />} title="Dados Pessoais">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div className="space-y-1.5 md:col-span-2">
                                <Label>Nome Completo</Label>
                                <Input {...register("nome")} placeholder="Seu nome completo" />
                                <Dica>Escreva seu nome completo, como está no documento.</Dica>
                            </div>
                            <div className="space-y-1.5 md:col-span-2">
                                <Label>Endereço</Label>
                                <Input {...register("endereco")} placeholder="Rua, número, bairro, cidade" />
                                <Dica>Bairro e cidade já ajudam. Não precisa escrever o endereço completo se não quiser.</Dica>
                            </div>
                            <div className="space-y-1.5">
                                <Label>Telefone</Label>
                                <Input {...register("telefone")} placeholder="(85) 99999-9999" />
                                <Dica>Número que a equipe da CUCA pode usar pra te chamar — pode ser diferente do WhatsApp que você está usando agora.</Dica>
                            </div>
                            <div className="space-y-1.5">
                                <Label>E-mail</Label>
                                <Input {...register("email")} type="email" placeholder="email@exemplo.com" />
                                <Dica>Se você tiver um e-mail, coloque aqui. Não é obrigatório.</Dica>
                            </div>
                            <div className="space-y-1.5">
                                <Label>LinkedIn</Label>
                                <Input {...register("linkedin")} placeholder="linkedin.com/in/seu-nome" />
                                <Dica>Se você tiver perfil no LinkedIn, cole o link aqui. Se não tiver, pode deixar em branco.</Dica>
                            </div>
                            <div className="space-y-1.5">
                                <Label>GitHub / Portfólio</Label>
                                <Input {...register("portfolio")} placeholder="github.com/nome ou behance.net/nome" />
                                <Dica>Só preencha se tiver algum trabalho pra mostrar online (projetos, fotos, site). Se não tiver, deixe em branco.</Dica>
                            </div>
                        </div>
                    </Section>

                    <Section icon={<FileText className="h-4 w-4" />} title="Apresentação Profissional">
                        <div className="space-y-1.5">
                            <Label>Texto de Apresentação</Label>
                            <Textarea {...register("apresentacao")} rows={5} placeholder="Conte um pouco sobre sua experiência, interesses e pontos fortes." />
                            <Dica>
                                Aqui você conta, com suas próprias palavras, o que sabe fazer — mesmo que nunca
                                tenha trabalhado com carteira assinada ou não tenha curso na área. Fale das suas
                                habilidades, do seu jeito de trabalhar e do que você tem vontade de aprender.
                            </Dica>
                        </div>

                        {/* SQS-62: não sabe o que escrever? A IA monta um texto a partir de até 3
                            habilidades, usando só o que o candidato informou aqui. */}
                        <div className="rounded-lg border border-dashed border-cuca-blue/40 bg-sky-50/50 p-3 space-y-2">
                            <Label className="text-sm">Não sabe o que escrever? Deixe a IA te ajudar</Label>
                            <Dica>Digite até 3 habilidades que você sabe fazer (uma palavra ou frase curta em cada) e a IA monta um texto de apresentação pra você — depois é só editar à vontade.</Dica>
                            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                {[0, 1, 2].map(i => (
                                    <Input
                                        key={i}
                                        value={habilidadesIA[i]}
                                        onChange={e => {
                                            const novas = [...habilidadesIA]
                                            novas[i] = e.target.value
                                            setHabilidadesIA(novas)
                                        }}
                                        placeholder={`Habilidade ${i + 1}`}
                                    />
                                ))}
                            </div>
                            <Button
                                type="button"
                                variant="outline"
                                className="border-cuca-blue text-cuca-blue hover:bg-sky-100"
                                disabled={gerandoApresentacao}
                                onClick={gerarApresentacaoComIA}
                            >
                                {gerandoApresentacao ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                                Gerar com IA
                            </Button>
                        </div>
                    </Section>

                    <Section icon={<Briefcase className="h-4 w-4" />} title="Objetivo Profissional">
                        <div className="space-y-1.5">
                            <Label>Cargo / Área desejada</Label>
                            <Input {...register("objetivo")} placeholder="Ex: Auxiliar Administrativo | Atendente de Loja" />
                            <Dica>
                                Escreva o tipo de trabalho que você procura. Exemplo: Auxiliar de Limpeza,
                                Vendedor, Cuidador de Idosos. Pode colocar mais de uma opção, separando com
                                uma barra ( | ).
                            </Dica>
                        </div>
                    </Section>

                    <Section icon={<Briefcase className="h-4 w-4" />} title="Experiência Profissional">
                        {expFields.fields.map((field, i) => {
                            const atual = watch(`experiencias.${i}.atual`)
                            return (
                                <div key={field.id} className="relative rounded-lg border p-4 space-y-3">
                                    <Button type="button" variant="ghost" size="icon" className="absolute right-2 top-2 text-destructive" onClick={() => expFields.remove(i)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                        <div className="space-y-1">
                                            <Label>Cargo</Label>
                                            <Input {...register(`experiencias.${i}.cargo`)} placeholder="Ex: Auxiliar de Estoque" />
                                            <Dica>O nome da função que você exercia. Exemplo: Ajudante Geral, Balconista.</Dica>
                                        </div>
                                        <div className="space-y-1">
                                            <Label>Empresa</Label>
                                            <Input {...register(`experiencias.${i}.empresa`)} placeholder="Nome da empresa" />
                                            <Dica>Nome do lugar onde você trabalhou. Se foi um trabalho informal (bico, autônomo), pode escrever assim mesmo.</Dica>
                                        </div>
                                        <div className="space-y-1">
                                            <Label>Início (MM/AAAA)</Label>
                                            <Input
                                                {...register(`experiencias.${i}.data_inicio`)}
                                                onChange={e => {
                                                    e.target.value = formatMesAno(e.target.value)
                                                    register(`experiencias.${i}.data_inicio`).onChange(e)
                                                }}
                                                placeholder="01/2023"
                                                inputMode="numeric"
                                                maxLength={7}
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <Label>Fim (MM/AAAA)</Label>
                                            <Input
                                                {...register(`experiencias.${i}.data_fim`)}
                                                onChange={e => {
                                                    e.target.value = formatMesAno(e.target.value)
                                                    register(`experiencias.${i}.data_fim`).onChange(e)
                                                }}
                                                placeholder="01/2024"
                                                inputMode="numeric"
                                                maxLength={7}
                                                disabled={atual}
                                            />
                                        </div>
                                        <div className="md:col-span-2">
                                            <Dica>Mês e ano de início e fim. Não precisa ser exato — use a data mais próxima que você lembrar.</Dica>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Controller
                                            control={control}
                                            name={`experiencias.${i}.atual`}
                                            render={({ field: f }) => (
                                                <Checkbox checked={f.value} onCheckedChange={f.onChange} id={`atual-${i}`} />
                                            )}
                                        />
                                        <Label htmlFor={`atual-${i}`} className="cursor-pointer text-sm">Emprego atual</Label>
                                    </div>
                                    <Controller
                                        control={control}
                                        name={`experiencias.${i}.atividades`}
                                        render={({ field: f }) => (
                                            <div className="space-y-2">
                                                <Label>Atividades realizadas</Label>
                                                <Dica>O que você fazia no dia a dia desse trabalho. Exemplo: atender clientes, organizar o estoque, limpar o ambiente.</Dica>
                                                {(f.value || []).map((at: Atividade, j: number) => (
                                                    <div key={j} className="flex gap-2">
                                                        <Input
                                                            value={at.descricao}
                                                            onChange={event => {
                                                                const updated = [...(f.value || [])]
                                                                updated[j] = { descricao: event.target.value }
                                                                f.onChange(updated)
                                                            }}
                                                            placeholder={`Atividade ${j + 1}`}
                                                        />
                                                        <Button type="button" variant="ghost" size="icon" onClick={() => f.onChange((f.value || []).filter((_: Atividade, k: number) => k !== j))}>
                                                            <Trash2 className="h-4 w-4 text-destructive" />
                                                        </Button>
                                                    </div>
                                                ))}
                                                <Button type="button" variant="outline" size="sm" onClick={() => f.onChange([...(f.value || []), { descricao: "" }])}>
                                                    <Plus className="mr-1 h-4 w-4" />
                                                    Adicionar atividade
                                                </Button>
                                            </div>
                                        )}
                                    />
                                </div>
                            )
                        })}
                        <Button type="button" variant="outline" onClick={() => expFields.append({ empresa: "", cargo: "", data_inicio: "", data_fim: "", atual: false, atividades: [] })}>
                            <Plus className="mr-2 h-4 w-4" />
                            Adicionar Experiência
                        </Button>
                    </Section>

                    <Section icon={<GraduationCap className="h-4 w-4" />} title="Formação Acadêmica">
                        {formFields.fields.map((field, i) => (
                            <div key={field.id} className="relative rounded-lg border p-4 space-y-3">
                                <Button type="button" variant="ghost" size="icon" className="absolute right-2 top-2 text-destructive" onClick={() => formFields.remove(i)}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                    <div className="space-y-1">
                                        <Label>Nível de Escolaridade</Label>
                                        <Controller
                                            control={control}
                                            name={`formacoes.${i}.escolaridade`}
                                            render={({ field: f }) => (
                                                <Select value={f.value} onValueChange={f.onChange}>
                                                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                                                    <SelectContent>{ESCOLARIDADES.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}</SelectContent>
                                                </Select>
                                            )}
                                        />
                                        <Dica>Escolha até onde você estudou. Se ainda está estudando, escolha &quot;Cursando&quot;.</Dica>
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Instituição</Label>
                                        <Input {...register(`formacoes.${i}.instituicao`)} placeholder="Nome da escola ou faculdade" />
                                        <Dica>Nome da escola, faculdade ou curso onde você estudou.</Dica>
                                    </div>
                                    <div className="space-y-1 md:col-span-2">
                                        <Label>Curso / Graduação</Label>
                                        <Input {...register(`formacoes.${i}.curso`)} placeholder="Ex: Administração" />
                                        <Dica>Se for ensino técnico ou superior, escreva o nome do curso. Se for ensino fundamental ou médio, pode deixar em branco.</Dica>
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Status</Label>
                                        <Controller
                                            control={control}
                                            name={`formacoes.${i}.status`}
                                            render={({ field: f }) => (
                                                <Select value={f.value} onValueChange={f.onChange}>
                                                    <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="concluido">Concluído</SelectItem>
                                                        <SelectItem value="cursando">Cursando</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        />
                                        <Dica>Se já terminou, marque &quot;Concluído&quot;. Se ainda está estudando, marque &quot;Cursando&quot;.</Dica>
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Ano</Label>
                                        <Input {...register(`formacoes.${i}.ano`)} placeholder="2024" maxLength={4} />
                                        <Dica>Ano em que concluiu ou em que está cursando atualmente.</Dica>
                                    </div>
                                </div>
                            </div>
                        ))}
                        <Button type="button" variant="outline" onClick={() => formFields.append({ escolaridade: "", instituicao: "", curso: "", status: "concluido", ano: "" })}>
                            <Plus className="mr-2 h-4 w-4" />
                            Adicionar Formação
                        </Button>
                    </Section>

                    <Section icon={<BookOpen className="h-4 w-4" />} title="Cursos e Certificações">
                        {cursoFields.fields.map((field, i) => (
                            <div key={field.id} className="relative rounded-lg border p-4 space-y-3">
                                <Button type="button" variant="ghost" size="icon" className="absolute right-2 top-2 text-destructive" onClick={() => cursoFields.remove(i)}>
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                                    <div className="space-y-1">
                                        <Label>Título do Curso</Label>
                                        <Input {...register(`cursos.${i}.titulo`)} placeholder="Ex: Pacote Office Completo" />
                                        <Dica>Nome do curso que você fez. Exemplo: Curso de Informática Básica, Auxiliar de Cozinha.</Dica>
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Instituição</Label>
                                        <Input {...register(`cursos.${i}.instituicao`)} placeholder="Ex: SENAC, SEBRAE" />
                                        <Dica>Onde você fez o curso (escola, ONG, SENAI, SENAC, online etc.).</Dica>
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Ano</Label>
                                        <Input {...register(`cursos.${i}.ano`)} placeholder="2023" maxLength={4} />
                                        <Dica>Ano em que fez ou concluiu o curso.</Dica>
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Descrição</Label>
                                        <Input {...register(`cursos.${i}.descricao`)} placeholder="Breve descrição ou carga horária" />
                                        <Dica>Se quiser, explique rapidamente o que aprendeu ou quantas horas teve o curso. Não é obrigatório.</Dica>
                                    </div>
                                </div>
                            </div>
                        ))}
                        <Button type="button" variant="outline" onClick={() => cursoFields.append({ titulo: "", instituicao: "", ano: "", descricao: "" })}>
                            <Plus className="mr-2 h-4 w-4" />
                            Adicionar Curso
                        </Button>
                    </Section>

                    <Section icon={<Wrench className="h-4 w-4" />} title="Habilidades Técnicas">
                        {habFields.fields.map((field, i) => (
                            <div key={field.id} className="flex gap-2 items-start">
                                <div className="w-36 shrink-0 space-y-1 md:w-48">
                                    <Input {...register(`habilidades.${i}.titulo`)} placeholder="Ex: Excel" />
                                    <Dica>Nome da habilidade. Ex: Excel, CNH, Atendimento.</Dica>
                                </div>
                                <div className="flex-1 space-y-1">
                                    <Input {...register(`habilidades.${i}.descricao`)} placeholder="Nível ou detalhe" />
                                    <Dica>Se quiser, diga o quanto você sabe disso. Exemplo: básico, intermediário, avançado.</Dica>
                                </div>
                                <Button type="button" variant="ghost" size="icon" onClick={() => habFields.remove(i)}>
                                    <Trash2 className="h-4 w-4 text-destructive" />
                                </Button>
                            </div>
                        ))}
                        <Button type="button" variant="outline" onClick={() => habFields.append({ titulo: "", descricao: "" })}>
                            <Plus className="mr-2 h-4 w-4" />
                            Adicionar Habilidade
                        </Button>
                    </Section>

                    <div className="sticky bottom-0 -mx-4 space-y-2 border-t bg-white/95 px-4 py-3 backdrop-blur md:rounded-lg md:border md:shadow-sm">
                        <Button type="submit" className="w-full bg-cuca-blue text-white hover:bg-sky-800" disabled={saving}>
                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Salvar currículo e gerar PDF
                        </Button>
                        {downloadUrl ? (
                            <>
                                {/* Logo abaixo do botão de salvar, não no topo da página — achado
                                    do Junior 2026-08-13: o candidato ficava procurando o botão em
                                    cima e não achava. */}
                                <Button asChild className="w-full bg-cuca-blue text-white hover:bg-sky-800">
                                    <a href={downloadUrl}>
                                        <Download className="mr-2 h-4 w-4" />
                                        Baixar PDF
                                    </a>
                                </Button>
                                {/* O link foi aberto de dentro do WhatsApp (in-app browser) — só
                                    volta pra conversa que já estava aberta, sem precisar saber o
                                    número do bot (decisão do Junior, 2026-08-13). */}
                                <Button
                                    type="button"
                                    className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
                                    onClick={() => window.history.back()}
                                >
                                    <ArrowLeft className="mr-2 h-4 w-4" />
                                    Voltar para o WhatsApp
                                </Button>
                            </>
                        ) : null}
                    </div>
                </form>
            </div>
        </main>
    )
}
