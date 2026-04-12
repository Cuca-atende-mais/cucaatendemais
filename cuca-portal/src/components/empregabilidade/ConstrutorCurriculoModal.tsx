"use client"

import { useEffect, useState } from "react"
import { useForm, useFieldArray, Controller } from "react-hook-form"
import { createClient } from "@/lib/supabase/client"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Loader2, Plus, Trash2, Info } from "lucide-react"
import toast from "react-hot-toast"
import { NIVEIS_ESCOLARIDADE } from "@/constants/empregabilidade"
import { differenceInMonths, parse } from "date-fns"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Experiencia {
    empresa: string
    cargo: string
    data_inicio: string   // "MM/YYYY"
    data_fim: string      // "MM/YYYY" ou ""
    atual: boolean
    atividades: { descricao: string }[]
}

interface Formacao {
    escolaridade: string
    instituicao: string
    status: "concluido" | "cursando"
    ano: string
}

interface Curso {
    instituicao: string
    titulo: string
    ano: string
    descricao: string
}

interface Habilidade {
    titulo: string
    descricao: string
}

interface CurriculoForm {
    nome: string
    endereco: string
    telefone: string
    email: string
    linkedin: string
    portfolio: string
    objetivo: string
    experiencias: Experiencia[]
    formacoes: Formacao[]
    cursos: Curso[]
    habilidades: Habilidade[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function calcularPermanencia(inicio: string, fim: string | "", atual: boolean): string {
    if (!inicio) return ""
    try {
        const start = parse(`01/${inicio}`, "dd/MM/yyyy", new Date())
        const end = atual ? new Date() : (fim ? parse(`01/${fim}`, "dd/MM/yyyy", new Date()) : new Date())
        const meses = differenceInMonths(end, start)
        if (meses <= 0) return ""
        const anos = Math.floor(meses / 12)
        const resto = meses % 12
        if (anos > 0 && resto > 0) return `${anos} ano${anos > 1 ? "s" : ""} e ${resto} mês${resto > 1 ? "es" : ""}`
        if (anos > 0) return `${anos} ano${anos > 1 ? "s" : ""}`
        return `${resto} mês${resto > 1 ? "es" : ""}`
    } catch {
        return ""
    }
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <div className="flex items-center gap-2 py-2 border-b border-border mb-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>
        </div>
    )
}

function HelpText({ children }: { children: React.ReactNode }) {
    return (
        <p className="text-xs text-muted-foreground flex items-start gap-1 mt-1">
            <Info className="h-3 w-3 mt-0.5 flex-shrink-0 text-cuca-blue" />
            {children}
        </p>
    )
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
    open: boolean
    onOpenChange: (v: boolean) => void
    talentId: string
    talentNome: string
    initialData?: Partial<CurriculoForm>
    onSaved?: () => void
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ConstrutorCurriculoModal({ open, onOpenChange, talentId, talentNome, initialData, onSaved }: Props) {
    const supabase = createClient()
    const [saving, setSaving] = useState(false)
    const [vagasAbertas, setVagasAbertas] = useState<{ id: string; titulo: string; numero_vaga: number | null }[]>([])
    const [vagaEscolhida, setVagaEscolhida] = useState("none")

    const { register, control, handleSubmit, watch, reset, formState: { errors } } = useForm<CurriculoForm>({
        defaultValues: {
            nome: talentNome,
            endereco: "",
            telefone: "",
            email: "",
            linkedin: "",
            portfolio: "",
            objetivo: "",
            experiencias: [],
            formacoes: [],
            cursos: [],
            habilidades: [],
            ...initialData,
        },
    })

    const expArr = useFieldArray({ control, name: "experiencias" })
    const formArr = useFieldArray({ control, name: "formacoes" })
    const cursoArr = useFieldArray({ control, name: "cursos" })
    const habilArr = useFieldArray({ control, name: "habilidades" })

    // Nested field arrays for atividades inside each experiência
    // We handle atividades as simple watch + manual append on the item level
    const watchExps = watch("experiencias")

    // Load vagas abertas da unidade para o select de vinculação
    useEffect(() => {
        if (!open) return
        supabase
            .from("vagas")
            .select("id, titulo, numero_vaga")
            .eq("status", "aberta")
            .order("created_at", { ascending: false })
            .limit(50)
            .then(({ data }) => setVagasAbertas(data || []))
    }, [open])

    // Pré-preenche com dados do talent quando abre
    useEffect(() => {
        if (open && initialData) {
            reset({ nome: talentNome, endereco: "", telefone: "", email: "", linkedin: "", portfolio: "", objetivo: "", experiencias: [], formacoes: [], cursos: [], habilidades: [], ...initialData })
        }
    }, [open, talentId])

    const onSubmit = async (data: CurriculoForm) => {
        setSaving(true)
        try {
            // 1. Salvar curriculo_estruturado no talent_bank
            const { error: updErr } = await supabase
                .from("talent_bank")
                .update({ curriculo_estruturado: data, updated_at: new Date().toISOString() })
                .eq("id", talentId)
            if (updErr) throw updErr

            // 2. Se uma vaga foi escolhida, criar candidatura
            if (vagaEscolhida && vagaEscolhida !== "none") {
                const { data: existente } = await supabase
                    .from("candidaturas")
                    .select("id")
                    .eq("vaga_id", vagaEscolhida)
                    .eq("telefone", data.telefone || "")
                    .maybeSingle()

                if (!existente) {
                    await supabase.from("candidaturas").insert({
                        vaga_id: vagaEscolhida,
                        nome: data.nome,
                        telefone: data.telefone || null,
                        dados_ocr_json: { curriculo_estruturado: true, habilidades: data.habilidades.map(h => h.titulo) },
                        status: "pendente",
                        observacoes: `banco_talentos:${talentId}`,
                    })
                }
            }

            toast.success("Currículo salvo com sucesso!")
            onSaved?.()
            onOpenChange(false)
        } catch (err: any) {
            toast.error(err.message || "Erro ao salvar currículo.")
        } finally {
            setSaving(false)
        }
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-4xl max-h-[92vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Construtor de Currículo — {talentNome}</DialogTitle>
                    <DialogDescription>
                        Preencha os campos abaixo junto com o candidato para gerar um currículo profissional.
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleSubmit(onSubmit)} className="space-y-8 pt-2">

                    {/* ── SEÇÃO 1: Dados Pessoais ─────────────────────────────── */}
                    <div>
                        <SectionTitle>1. Dados Pessoais</SectionTitle>
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <Label>Nome Completo *</Label>
                                <Input {...register("nome", { required: true })} placeholder="Nome como aparecerá no currículo" />
                            </div>
                        </div>
                    </div>

                    {/* ── SEÇÃO 2: Contatos e Redes ────────────────────────────── */}
                    <div>
                        <SectionTitle>2. Contatos e Redes</SectionTitle>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            <div className="space-y-1.5 md:col-span-2">
                                <Label>Endereço Completo</Label>
                                <Input {...register("endereco")} placeholder="Rua, número, bairro — Cidade/CE" />
                            </div>
                            <div className="space-y-1.5">
                                <Label>Telefone / WhatsApp</Label>
                                <Input {...register("telefone")} placeholder="(85) 99999-9999" type="tel" />
                            </div>
                            <div className="space-y-1.5">
                                <Label>E-mail</Label>
                                <Input {...register("email")} placeholder="nome@email.com" type="email" />
                            </div>
                            <div className="space-y-1.5">
                                <Label>LinkedIn</Label>
                                <Input {...register("linkedin")} placeholder="linkedin.com/in/nome" />
                            </div>
                            <div className="space-y-1.5">
                                <Label>GitHub / Portfólio</Label>
                                <Input {...register("portfolio")} placeholder="github.com/nome ou site pessoal" />
                            </div>
                        </div>
                    </div>

                    {/* ── SEÇÃO 3: Objetivo Profissional ──────────────────────── */}
                    <div>
                        <SectionTitle>3. Objetivo Profissional</SectionTitle>
                        <div className="space-y-1.5">
                            <Label>Objetivo</Label>
                            <Textarea {...register("objetivo")} placeholder="Ex: Busco oportunidades nas áreas de atendimento ao cliente e administração..." className="h-24 resize-none" />
                            <HelpText>Pergunte ao jovem quais áreas ou cargos ele tem mais interesse. Escreva em primeira pessoa.</HelpText>
                        </div>
                    </div>

                    {/* ── SEÇÃO 4: Experiências Profissionais ─────────────────── */}
                    <div>
                        <SectionTitle>4. Experiências Profissionais</SectionTitle>
                        <HelpText>Liste todas as experiências, incluindo trabalhos informais, estágios e aprendizados.</HelpText>
                        <div className="space-y-6 mt-3">
                            {expArr.fields.map((field, idx) => {
                                const exp = watchExps?.[idx]
                                const permanencia = calcularPermanencia(exp?.data_inicio || "", exp?.data_fim || "", exp?.atual || false)
                                return (
                                    <div key={field.id} className="border border-border rounded-xl p-4 space-y-3 relative">
                                        <button type="button" onClick={() => expArr.remove(idx)} className="absolute top-3 right-3 text-muted-foreground hover:text-destructive transition-colors">
                                            <Trash2 className="h-4 w-4" />
                                        </button>
                                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Experiência {idx + 1}</p>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div className="space-y-1.5">
                                                <Label>Empresa</Label>
                                                <Input {...register(`experiencias.${idx}.empresa`)} placeholder="Nome da empresa" />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label>Cargo / Função</Label>
                                                <Input {...register(`experiencias.${idx}.cargo`)} placeholder="Ex: Auxiliar Administrativo" />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label>Data de Início (MM/AAAA)</Label>
                                                <Input {...register(`experiencias.${idx}.data_inicio`)} placeholder="03/2022" maxLength={7} />
                                            </div>
                                            <div className="space-y-1.5">
                                                <Label>Data de Fim (MM/AAAA)</Label>
                                                <div className="space-y-2">
                                                    <Input
                                                        {...register(`experiencias.${idx}.data_fim`)}
                                                        placeholder="06/2023"
                                                        maxLength={7}
                                                        disabled={exp?.atual}
                                                    />
                                                    <div className="flex items-center gap-2">
                                                        <Controller
                                                            control={control}
                                                            name={`experiencias.${idx}.atual`}
                                                            render={({ field: f }) => (
                                                                <Checkbox id={`atual-${idx}`} checked={f.value} onCheckedChange={f.onChange} />
                                                            )}
                                                        />
                                                        <Label htmlFor={`atual-${idx}`} className="text-sm cursor-pointer font-normal">Trabalhando no momento</Label>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                        {permanencia && (
                                            <p className="text-xs text-cuca-blue font-medium">⏱ Permanência: {permanencia}</p>
                                        )}
                                        {/* Atividades */}
                                        <div className="space-y-2">
                                            <Label className="text-sm">Funções / Atividades Exercidas</Label>
                                            <HelpText>Liste em tópicos curtos o que ele fazia na prática. Cada campo vira um bullet point no currículo.</HelpText>
                                            <Controller
                                                control={control}
                                                name={`experiencias.${idx}.atividades`}
                                                defaultValue={[]}
                                                render={({ field: f }) => (
                                                    <div className="space-y-2">
                                                        {(f.value || []).map((at: { descricao: string }, aIdx: number) => (
                                                            <div key={aIdx} className="flex gap-2">
                                                                <Input
                                                                    value={at.descricao}
                                                                    onChange={e => {
                                                                        const arr = [...(f.value || [])]
                                                                        arr[aIdx] = { descricao: e.target.value }
                                                                        f.onChange(arr)
                                                                    }}
                                                                    placeholder={`Atividade ${aIdx + 1}`}
                                                                    className="text-sm"
                                                                />
                                                                <Button type="button" variant="ghost" size="icon" className="flex-shrink-0 text-muted-foreground hover:text-destructive"
                                                                    onClick={() => {
                                                                        const arr = [...(f.value || [])]
                                                                        arr.splice(aIdx, 1)
                                                                        f.onChange(arr)
                                                                    }}>
                                                                    <Trash2 className="h-3.5 w-3.5" />
                                                                </Button>
                                                            </div>
                                                        ))}
                                                        <Button type="button" variant="outline" size="sm" className="text-xs"
                                                            onClick={() => f.onChange([...(f.value || []), { descricao: "" }])}>
                                                            <Plus className="h-3 w-3 mr-1" /> Adicionar Atividade
                                                        </Button>
                                                    </div>
                                                )}
                                            />
                                        </div>
                                    </div>
                                )
                            })}
                            <Button type="button" variant="outline" size="sm"
                                onClick={() => expArr.append({ empresa: "", cargo: "", data_inicio: "", data_fim: "", atual: false, atividades: [] })}>
                                <Plus className="h-4 w-4 mr-1.5" /> Adicionar Experiência
                            </Button>
                        </div>
                    </div>

                    {/* ── SEÇÃO 5: Formação Acadêmica ─────────────────────────── */}
                    <div>
                        <SectionTitle>5. Formação Acadêmica</SectionTitle>
                        <div className="space-y-4">
                            {formArr.fields.map((field, idx) => (
                                <div key={field.id} className="border border-border rounded-xl p-4 space-y-3 relative">
                                    <button type="button" onClick={() => formArr.remove(idx)} className="absolute top-3 right-3 text-muted-foreground hover:text-destructive transition-colors">
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Formação {idx + 1}</p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div className="space-y-1.5">
                                            <Label>Nível de Escolaridade</Label>
                                            <Controller
                                                control={control}
                                                name={`formacoes.${idx}.escolaridade`}
                                                render={({ field: f }) => (
                                                    <Select value={f.value} onValueChange={f.onChange}>
                                                        <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                                        <SelectContent>
                                                            {NIVEIS_ESCOLARIDADE.map(n => <SelectItem key={n} value={n}>{n}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                )}
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label>Instituição</Label>
                                            <Input {...register(`formacoes.${idx}.instituicao`)} placeholder="Nome da escola/faculdade" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label>Status</Label>
                                            <Controller
                                                control={control}
                                                name={`formacoes.${idx}.status`}
                                                render={({ field: f }) => (
                                                    <Select value={f.value} onValueChange={f.onChange}>
                                                        <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="concluido">Concluído</SelectItem>
                                                            <SelectItem value="cursando">Cursando</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                )}
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label>Ano de Conclusão / Previsão</Label>
                                            <Input {...register(`formacoes.${idx}.ano`)} placeholder="2024" maxLength={4} />
                                        </div>
                                    </div>
                                </div>
                            ))}
                            <Button type="button" variant="outline" size="sm"
                                onClick={() => formArr.append({ escolaridade: "", instituicao: "", status: "concluido", ano: "" })}>
                                <Plus className="h-4 w-4 mr-1.5" /> Adicionar Formação
                            </Button>
                        </div>
                    </div>

                    {/* ── SEÇÃO 6: Cursos Extracurriculares ───────────────────── */}
                    <div>
                        <SectionTitle>6. Cursos Extracurriculares</SectionTitle>
                        <div className="space-y-4">
                            {cursoArr.fields.map((field, idx) => (
                                <div key={field.id} className="border border-border rounded-xl p-4 space-y-3 relative">
                                    <button type="button" onClick={() => cursoArr.remove(idx)} className="absolute top-3 right-3 text-muted-foreground hover:text-destructive transition-colors">
                                        <Trash2 className="h-4 w-4" />
                                    </button>
                                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Curso {idx + 1}</p>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div className="space-y-1.5">
                                            <Label>Instituição</Label>
                                            <Input {...register(`cursos.${idx}.instituicao`)} placeholder="SENAI, SEBRAE, Coursera..." />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label>Título do Curso</Label>
                                            <Input {...register(`cursos.${idx}.titulo`)} placeholder="Ex: Auxiliar Administrativo" />
                                        </div>
                                        <div className="space-y-1.5">
                                            <Label>Ano de Conclusão</Label>
                                            <Input {...register(`cursos.${idx}.ano`)} placeholder="2023" maxLength={4} />
                                        </div>
                                        <div className="space-y-1.5 md:col-span-2">
                                            <Label>Descrição do Curso</Label>
                                            <Textarea {...register(`cursos.${idx}.descricao`)} placeholder="Descreva brevemente o conteúdo do curso..." className="h-16 resize-none text-sm" />
                                        </div>
                                    </div>
                                </div>
                            ))}
                            <Button type="button" variant="outline" size="sm"
                                onClick={() => cursoArr.append({ instituicao: "", titulo: "", ano: "", descricao: "" })}>
                                <Plus className="h-4 w-4 mr-1.5" /> Adicionar Curso
                            </Button>
                        </div>
                    </div>

                    {/* ── SEÇÃO 7: Habilidades Técnicas ───────────────────────── */}
                    <div>
                        <SectionTitle>7. Habilidades Técnicas</SectionTitle>
                        <HelpText>Ferramentas, softwares, idiomas, competências. Seja específico — "Excel avançado" é melhor que "Informática".</HelpText>
                        <div className="space-y-3 mt-3">
                            {habilArr.fields.map((field, idx) => (
                                <div key={field.id} className="flex gap-3 items-start">
                                    <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2">
                                        <div className="space-y-1">
                                            <Input {...register(`habilidades.${idx}.titulo`)} placeholder="Ex: Excel" className="text-sm" />
                                        </div>
                                        <div className="md:col-span-2 space-y-1">
                                            <Input {...register(`habilidades.${idx}.descricao`)} placeholder="Descrição completa, nível, uso prático..." className="text-sm" />
                                        </div>
                                    </div>
                                    <Button type="button" variant="ghost" size="icon" className="text-muted-foreground hover:text-destructive mt-0.5 flex-shrink-0"
                                        onClick={() => habilArr.remove(idx)}>
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            ))}
                            <Button type="button" variant="outline" size="sm"
                                onClick={() => habilArr.append({ titulo: "", descricao: "" })}>
                                <Plus className="h-4 w-4 mr-1.5" /> Adicionar Habilidade
                            </Button>
                        </div>
                    </div>

                    {/* ── TASK 3: Vinculação a vaga + Salvar ──────────────────── */}
                    <div className="border-t pt-4 space-y-4">
                        <div className="space-y-1.5">
                            <Label>Vincular a uma vaga aberta? (opcional)</Label>
                            <Select value={vagaEscolhida} onValueChange={setVagaEscolhida}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione uma vaga..." />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">Não vincular a nenhuma vaga</SelectItem>
                                    {vagasAbertas.map(v => (
                                        <SelectItem key={v.id} value={v.id}>
                                            {v.numero_vaga ? `#${v.numero_vaga} — ` : ""}{v.titulo}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            {vagaEscolhida && vagaEscolhida !== "none" && (
                                <p className="text-xs text-cuca-blue">Uma candidatura será criada automaticamente para essa vaga.</p>
                            )}
                        </div>

                        <div className="flex justify-end gap-3">
                            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                                Cancelar
                            </Button>
                            <Button type="submit" className="bg-cuca-blue hover:bg-sky-800 text-white min-w-32" disabled={saving}>
                                {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Salvando...</> : "Salvar Currículo"}
                            </Button>
                        </div>
                    </div>

                </form>
            </DialogContent>
        </Dialog>
    )
}
