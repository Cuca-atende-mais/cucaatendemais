"use client"

import { Suspense, useEffect, useState } from "react"
import type { ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { Controller, useFieldArray, useForm } from "react-hook-form"
import toast from "react-hot-toast"
import {
    AlertTriangle,
    BookOpen,
    Briefcase,
    CheckCircle2,
    Download,
    FileText,
    GraduationCap,
    Loader2,
    Plus,
    Save,
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

    // Nome já vem preenchido (coletado no WhatsApp antes do link ser emitido).
    // Telefone e os demais campos ficam em branco: quem abre o link pode estar
    // usando um celular diferente do número que deve constar no currículo —
    // decisão do Junior, 2026-08-12.
    const { control, handleSubmit, register, reset, watch } = useForm<CvDados>({
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
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                            <p className="text-sm font-medium text-cuca-blue">Banco de Talentos CUCA</p>
                            <h1 className="text-2xl font-bold tracking-tight text-slate-950">Criar currículo</h1>
                            <p className="mt-1 text-sm text-slate-600">
                                Preencha seus dados. Ao salvar, você receberá seu currículo em PDF.
                            </p>
                        </div>
                        {downloadUrl ? (
                            <Button asChild className="bg-cuca-blue text-white hover:bg-sky-800">
                                <a href={downloadUrl}>
                                    <Download className="mr-2 h-4 w-4" />
                                    Baixar PDF
                                </a>
                            </Button>
                        ) : null}
                    </div>
                </div>

                {downloadUrl ? (
                    <div className="mb-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
                        <div className="flex items-start gap-2">
                            <CheckCircle2 className="mt-0.5 h-4 w-4" />
                            <p>Currículo salvo. O botão de download funciona uma única vez e expira em alguns minutos.</p>
                        </div>
                    </div>
                ) : null}

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pb-24">
                    <Section icon={<User className="h-4 w-4" />} title="Dados Pessoais">
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            <div className="space-y-1.5 md:col-span-2">
                                <Label>Nome Completo</Label>
                                <Input {...register("nome")} placeholder="Seu nome completo" />
                            </div>
                            <div className="space-y-1.5 md:col-span-2">
                                <Label>Endereço</Label>
                                <Input {...register("endereco")} placeholder="Rua, número, bairro, cidade" />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Telefone</Label>
                                <Input {...register("telefone")} placeholder="(85) 99999-9999" />
                            </div>
                            <div className="space-y-1.5">
                                <Label>E-mail</Label>
                                <Input {...register("email")} type="email" placeholder="email@exemplo.com" />
                            </div>
                            <div className="space-y-1.5">
                                <Label>LinkedIn</Label>
                                <Input {...register("linkedin")} placeholder="linkedin.com/in/seu-nome" />
                            </div>
                            <div className="space-y-1.5">
                                <Label>GitHub / Portfólio</Label>
                                <Input {...register("portfolio")} placeholder="github.com/nome ou behance.net/nome" />
                            </div>
                        </div>
                    </Section>

                    <Section icon={<FileText className="h-4 w-4" />} title="Apresentação Profissional">
                        <div className="space-y-1.5">
                            <Label>Texto de Apresentação</Label>
                            <Textarea {...register("apresentacao")} rows={5} placeholder="Conte um pouco sobre sua experiência, interesses e pontos fortes." />
                        </div>
                    </Section>

                    <Section icon={<Briefcase className="h-4 w-4" />} title="Objetivo Profissional">
                        <div className="space-y-1.5">
                            <Label>Cargo / Área desejada</Label>
                            <Input {...register("objetivo")} placeholder="Ex: Auxiliar Administrativo | Atendente de Loja" />
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
                                        </div>
                                        <div className="space-y-1">
                                            <Label>Empresa</Label>
                                            <Input {...register(`experiencias.${i}.empresa`)} placeholder="Nome da empresa" />
                                        </div>
                                        <div className="space-y-1">
                                            <Label>Início (MM/AAAA)</Label>
                                            <Input {...register(`experiencias.${i}.data_inicio`)} placeholder="01/2023" />
                                        </div>
                                        <div className="space-y-1">
                                            <Label>Fim (MM/AAAA)</Label>
                                            <Input {...register(`experiencias.${i}.data_fim`)} placeholder="01/2024" disabled={atual} />
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
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Instituição</Label>
                                        <Input {...register(`formacoes.${i}.instituicao`)} placeholder="Nome da escola ou faculdade" />
                                    </div>
                                    <div className="space-y-1 md:col-span-2">
                                        <Label>Curso / Graduação</Label>
                                        <Input {...register(`formacoes.${i}.curso`)} placeholder="Ex: Administração" />
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
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Ano</Label>
                                        <Input {...register(`formacoes.${i}.ano`)} placeholder="2024" maxLength={4} />
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
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Instituição</Label>
                                        <Input {...register(`cursos.${i}.instituicao`)} placeholder="Ex: SENAC, SEBRAE" />
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Ano</Label>
                                        <Input {...register(`cursos.${i}.ano`)} placeholder="2023" maxLength={4} />
                                    </div>
                                    <div className="space-y-1">
                                        <Label>Descrição</Label>
                                        <Input {...register(`cursos.${i}.descricao`)} placeholder="Breve descrição ou carga horária" />
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
                                <Input {...register(`habilidades.${i}.titulo`)} placeholder="Ex: Excel" className="w-36 shrink-0 md:w-48" />
                                <Input {...register(`habilidades.${i}.descricao`)} placeholder="Nível ou detalhe" />
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

                    <div className="sticky bottom-0 -mx-4 border-t bg-white/95 px-4 py-3 backdrop-blur md:rounded-lg md:border md:shadow-sm">
                        <Button type="submit" className="w-full bg-cuca-blue text-white hover:bg-sky-800" disabled={saving}>
                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Salvar currículo e gerar PDF
                        </Button>
                    </div>
                </form>
            </div>
        </main>
    )
}
