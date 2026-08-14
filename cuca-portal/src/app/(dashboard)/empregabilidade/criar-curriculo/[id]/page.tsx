"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { useForm, useFieldArray, Controller } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import {
    ChevronDown, ChevronUp, Plus, Trash2, Save,
    ArrowLeft, Loader2, User, Briefcase, GraduationCap,
    BookOpen, Wrench, Link2, Search, FileText, Sparkles,
} from "lucide-react"
import toast from "react-hot-toast"
import { differenceInMonths, parse } from "date-fns"

// ─── Types ────────────────────────────────────────────────────────────────────

interface Atividade { descricao: string }
interface Experiencia {
    empresa: string
    cargo: string
    data_inicio: string
    data_fim: string
    atual: boolean
    atividades: Atividade[]
}
interface Formacao {
    escolaridade: string
    instituicao: string
    curso: string
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
interface CvForm {
    nome: string
    endereco: string
    telefone: string
    email: string
    linkedin: string
    portfolio: string
    apresentacao: string
    objetivo: string
    experiencias: Experiencia[]
    formacoes: Formacao[]
    cursos: Curso[]
    habilidades: Habilidade[]
}

function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback
}

interface VagaRow {
    id: string
    titulo: string
    unidade_cuca: string | null
    empresas: { nome: string } | null
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function calcPermanencia(inicio: string, fim: string, atual: boolean): string {
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
    } catch { return "" }
}

// Máscara automática MM/AAAA pros campos de período de experiência (achado do
// Junior, 2026-08-13, aplicado nos dois formulários — este e o público em
// /empregabilidade/curriculo). Só dígitos são aceitos; a barra é inserida
// sozinha depois do 2º dígito, limitado a 6 dígitos (MMAAAA).
function formatMesAno(valor: string): string {
    const digitos = valor.replace(/\D/g, "").slice(0, 6)
    if (digitos.length <= 2) return digitos
    return `${digitos.slice(0, 2)}/${digitos.slice(2)}`
}

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

// ─── Section wrapper ──────────────────────────────────────────────────────────

function Section({ icon, title, children, defaultOpen = true }: {
    icon: React.ReactNode
    title: string
    children: React.ReactNode
    defaultOpen?: boolean
}) {
    const [open, setOpen] = useState(defaultOpen)
    return (
        <Card>
            <CardHeader className="cursor-pointer select-none py-4" onClick={() => setOpen(o => !o)}>
                <CardTitle className="flex items-center justify-between text-base">
                    <span className="flex items-center gap-2">{icon} {title}</span>
                    {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </CardTitle>
            </CardHeader>
            {open && <CardContent className="pt-0 space-y-4">{children}</CardContent>}
        </Card>
    )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CriarCurriculoEditorPage() {
    const params = useParams()
    const router = useRouter()
    const talentId = params.id as string
    const supabase = createClient()

    const [talentNome, setTalentNome] = useState("")
    const [curriculoId, setCurriculoId] = useState<string | null>(null)
    const [loadingInit, setLoadingInit] = useState(true)
    const [saving, setSaving] = useState(false)

    // Dialog: Verificar Vagas
    const [vagasOpen, setVagasOpen] = useState(false)
    const [vagas, setVagas] = useState<VagaRow[]>([])
    const [vagaSearch, setVagaSearch] = useState("")
    const [vagaLoading, setVagaLoading] = useState(false)
    const [vinculando, setVinculando] = useState<string | null>(null)

    // SQS-62: mesmo botão de IA do formulário público, pra agilizar quando a
    // equipe do CUCA digita o currículo por alguém.
    const [habilidadesIA, setHabilidadesIA] = useState(["", "", ""])
    const [gerandoApresentacao, setGerandoApresentacao] = useState(false)

    const { register, control, handleSubmit, reset, watch, setValue, getValues } = useForm<CvForm>({
        defaultValues: {
            nome: "", endereco: "", telefone: "", email: "", linkedin: "", portfolio: "",
            apresentacao: "", objetivo: "",
            experiencias: [], formacoes: [], cursos: [], habilidades: [],
        },
    })

    const expFields = useFieldArray({ control, name: "experiencias" })
    const formFields = useFieldArray({ control, name: "formacoes" })
    const cursoFields = useFieldArray({ control, name: "cursos" })
    const habFields = useFieldArray({ control, name: "habilidades" })

    // ── Carregar dados ────────────────────────────────────────────────────────

    useEffect(() => {
        // SQS-51 (A2): try/catch/finally garante que setLoadingInit(false)
        // sempre execute — antes, falhas de rede/RLS deixavam spinner infinito.
        const init = async () => {
            try {
                const { data: talent, error: talentErr } = await supabase
                    .from("talent_bank")
                    .select("nome, telefone, curriculo_estruturado")
                    .eq("id", talentId)
                    .single()

                if (talentErr) throw talentErr
                if (!talent) {
                    toast.error("Candidato não encontrado.")
                    router.push("/empregabilidade/criar-curriculo")
                    return
                }
                setTalentNome(talent.nome)

                const { data: cur, error: curErr } = await supabase
                    .from("curriculos")
                    .select("*")
                    .eq("talent_id", talentId)
                    .is("deleted_at", null)
                    .order("updated_at", { ascending: false })
                    .limit(1)
                    .maybeSingle()

                if (curErr) throw curErr

                if (cur) {
                    setCurriculoId(cur.id)
                    reset({ nome: talent.nome, telefone: talent.telefone || "", ...cur.dados } as CvForm)
                } else if (talent.curriculo_estruturado && Object.keys(talent.curriculo_estruturado).length > 0) {
                    reset({ nome: talent.nome, telefone: talent.telefone || "", ...talent.curriculo_estruturado } as CvForm)
                } else {
                    reset({ nome: talent.nome, telefone: talent.telefone || "" } as unknown as CvForm)
                }
            } catch (err: unknown) {
                console.error("[criar-curriculo/init]", err)
                toast.error(getErrorMessage(err, "Falha ao carregar candidato."))
            } finally {
                setLoadingInit(false)
            }
        }
        init()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [talentId])

    // SQS-62: gera o texto de apresentação a partir de até 3 habilidades.
    // Sessão autenticada cobre a autorização — sem link assinado nem
    // rate-limit adicional aqui (rota diferencia pela ausência de
    // `link_params` no body).
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
                body: JSON.stringify({ habilidades: habilidadesPreenchidas }),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)
            setValue("apresentacao", data.apresentacao, { shouldDirty: true })
            toast.success("Texto gerado! Você pode editar à vontade antes de salvar.")
        } catch (err: unknown) {
            const message = getErrorMessage(err, "Não foi possível gerar o texto agora.")
            toast.error(message)
        } finally {
            setGerandoApresentacao(false)
        }
    }

    // ── Salvar currículo + upsert talent_bank (RN1) ──────────────────────────

    const onSubmit = async (values: CvForm): Promise<string | null> => {
        setSaving(true)
        try {
            const { data: savedId, error } = await supabase.rpc(
                "salvar_curriculo_estruturado",
                {
                    p_talent_id: talentId,
                    p_curriculo_id: curriculoId,
                    p_dados: values as unknown,
                }
            )

            if (error || !savedId) {
                throw error || new Error("Erro ao salvar currículo.")
            }

            setCurriculoId(savedId)
            setTalentNome(values.nome || talentNome)
            toast.success("Currículo salvo e Banco de Talentos atualizado!")

            // SQS-57 (AC1/T5): gera o PDF real e popula skills_jsonb logo após salvar.
            // Aguardado (não fire-and-forget) de propósito: "Verificar Vagas em
            // Aberto" (handleVincular) lê talent_bank.arquivo_cv_url logo em seguida
            // para copiar no encaminhamento (AC7) — sem esperar, essa leitura corria
            // na frente da geração e o candidato seria encaminhado sem anexo.
            // Não desfaz o salvamento se falhar — o currículo já está salvo; a
            // equipe pode tentar de novo pelo botão manual no Banco de Talentos (AC8).
            try {
                const res = await fetch("/api/empregabilidade/curriculo/gerar-pdf", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ talent_id: talentId }),
                })
                if (!res.ok) {
                    const body = await res.json().catch(() => null)
                    throw new Error(body?.error || `HTTP ${res.status}`)
                }
            } catch (err: unknown) {
                console.error("[criar-curriculo/gerar-pdf]", err)
                toast.error("Currículo salvo, mas houve falha ao gerar o PDF. Tente novamente pelo Banco de Talentos.")
            }

            return savedId
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, "Erro ao salvar."))
            return null
        } finally {
            setSaving(false)
        }
    }

    // ── Salvar e voltar para a lista (2026-08-14) ─────────────────────────────
    // Antes, "Salvar e Imprimir" abria uma aba em branco e navegava ela via
    // script depois do `await` de salvar. As duas correções anteriores (ver
    // DIAGNOSTICO-travamento-salvar-imprimir-curriculo-2026-08-05.md) resolveram
    // os bugs de então, mas o padrão em si (window.open + redirecionar via JS
    // sem novo gesto do usuário) caiu na mira da mitigação de "bounce tracking"
    // do Chrome (aviso no console: "websites without prior user interaction...
    // Chrome will delete their state") — o navegador passou a tratar isso como
    // comportamento suspeito e trava/descarta a aba. Solução: eliminar o
    // window.open() daqui. Salvar aqui só volta pra lista, destacando o
    // currículo recém-criado; a impressão em si já usa router.push síncrono
    // (sem gap) no ícone da lista — padrão que nunca teve esse problema.
    const handleSalvar = handleSubmit(async (values) => {
        const savedId = await onSubmit(values)
        if (savedId) {
            router.push(`/empregabilidade/criar-curriculo?destaque=${savedId}`)
        }
    })

    // ── Vincular a vaga (RN2) ─────────────────────────────────────────────────

    const openVagasDialog = async () => {
        setVagasOpen(true)
        setVagaSearch("")
        setVagaLoading(true)
        const { data } = await supabase
            .from("vagas")
            .select("id, titulo, unidade_cuca, empresas(nome)")
            .eq("status", "aberta")
            .order("created_at", { ascending: false })
            .limit(200)
        setVagas((data || []) as unknown as VagaRow[])
        setVagaLoading(false)
    }

    const handleVincular = async (vaga: VagaRow) => {
        setVinculando(vaga.id)

        // Salvar currículo primeiro se ainda não foi salvo
        const values = watch()
        const savedId = await onSubmit(values)
        if (!savedId) {
            setVinculando(null)
            return
        }

        const { data: existing } = await supabase
            .from("candidaturas")
            .select("id")
            .eq("vaga_id", vaga.id)
            .ilike("observacoes", `%banco_talentos:${talentId}%`)
            .maybeSingle()

        if (existing) {
            toast.error("Este candidato já está encaminhado para esta vaga.")
            setVinculando(null)
            return
        }

        const { data: talent } = await supabase
            .from("talent_bank")
            .select("nome, data_nascimento, telefone, arquivo_cv_url, area_interesse")
            .eq("id", talentId)
            .single()

        if (!talent) { toast.error("Candidato não encontrado."); setVinculando(null); return }

        const { data: novaCandidatura, error } = await supabase.from("candidaturas").insert({
            vaga_id: vaga.id,
            nome: talent.nome,
            data_nascimento: talent.data_nascimento || "2000-01-01",
            telefone: talent.telefone || "",
            arquivo_cv_url: talent.arquivo_cv_url || null,
            area_interesse: talent.area_interesse || null,
            observacoes: `banco_talentos:${talentId}`,
            status: "pendente",
            requisitos_atendidos: "Encaminhado via Criar Currículo",
            unidade_cuca: vaga.unidade_cuca || null,
        }).select("id").single()

        if (error) { toast.error("Erro ao encaminhar candidato."); console.error(error) }
        else {
            toast.success(`Candidato encaminhado para "${vaga.titulo}"!`)
            setVagasOpen(false)

            // Disparar análise de IA
            if (novaCandidatura?.id) {
                if (talent.arquivo_cv_url) {
                    // Candidato tem PDF — usa OCR normal
                    fetch("/api/process-cv", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            candidatura_id: novaCandidatura.id,
                            cv_url: talent.arquivo_cv_url,
                            vaga_id: vaga.id,
                        }),
                    }).catch(err => console.warn("[handleVincular] Erro ao disparar OCR:", err))
                } else {
                    // Sem arquivo — usa currículo estruturado do formulário
                    ;(async () => {
                        try {
                            const { data: cur } = await supabase
                                .from("curriculos")
                                .select("dados")
                                .eq("talent_id", talentId)
                                .is("deleted_at", null)
                                .order("updated_at", { ascending: false })
                                .limit(1)
                                .maybeSingle()
                            if (!cur?.dados) return
                            const d = cur.dados as Partial<CvForm>
                            const linhas: string[] = []
                            if (d.nome) linhas.push(`Nome: ${d.nome}`)
                            if (d.telefone) linhas.push(`Telefone: ${d.telefone}`)
                            if (d.email) linhas.push(`Email: ${d.email}`)
                            if (d.endereco) linhas.push(`Endereço: ${d.endereco}`)
                            if (d.apresentacao) linhas.push(`\nApresentação:\n${d.apresentacao}`)
                            if (d.objetivo) linhas.push(`\nObjetivo:\n${d.objetivo}`)
                            if (d.formacoes?.length) {
                                linhas.push("\nFormação:")
                                d.formacoes.forEach((f) => {
                                    linhas.push(`- ${f.escolaridade} em ${f.curso || ''} (${f.instituicao || ''}, ${f.status || ''}, ${f.ano || ''})`)
                                })
                            }
                            if (d.experiencias?.length) {
                                linhas.push("\nExperiências:")
                                d.experiencias.forEach((e) => {
                                    const periodo = `${e.data_inicio || ''}${e.atual ? ' - atual' : e.data_fim ? ` - ${e.data_fim}` : ''}`
                                    linhas.push(`- ${e.cargo || ''} em ${e.empresa || ''} (${periodo})`)
                                    e.atividades?.forEach((a) => linhas.push(`  • ${a.descricao}`))
                                })
                            }
                            if (d.cursos?.length) {
                                linhas.push("\nCursos:")
                                d.cursos.forEach((c) => linhas.push(`- ${c.titulo} (${c.instituicao || ''}, ${c.ano || ''})`))
                            }
                            if (d.habilidades?.length) {
                                linhas.push("\nHabilidades:")
                                d.habilidades.forEach((h) => linhas.push(`- ${h.titulo}: ${h.descricao}`))
                            }
                            const cvText = linhas.join("\n")
                            await fetch("/api/process-cv-text", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                    candidatura_id: novaCandidatura.id,
                                    cv_text: cvText,
                                    vaga_id: vaga.id,
                                }),
                            })
                        } catch (err) {
                            console.warn("[handleVincular] Erro ao disparar análise textual:", err)
                        }
                    })()
                }
            }
        }
        setVinculando(null)
    }

    const vagasFiltradas = vagas.filter(v =>
        !vagaSearch ||
        v.titulo.toLowerCase().includes(vagaSearch.toLowerCase()) ||
        (v.empresas?.nome || "").toLowerCase().includes(vagaSearch.toLowerCase()) ||
        (v.unidade_cuca || "").toLowerCase().includes(vagaSearch.toLowerCase())
    )

    if (loadingInit) return (
        <div className="flex items-center justify-center min-h-[60vh]">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
    )

    return (
        <div className="space-y-6 pb-20">

            {/* ── Barra superior ────────────────────────────────────────────── */}
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" size="icon" onClick={() => router.back()}>
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight">Criar Currículo</h1>
                        <p className="text-muted-foreground text-sm">{talentNome}</p>
                    </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                    <Button variant="outline" onClick={openVagasDialog}>
                        <Link2 className="h-4 w-4 mr-2 text-cuca-blue" /> Verificar Vagas em Aberto
                    </Button>
                    <Button
                        className="bg-cuca-blue hover:bg-sky-800 text-white"
                        onClick={handleSalvar}
                        disabled={saving}
                    >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                        Salvar
                    </Button>
                </div>
            </div>

            <form onSubmit={handleSalvar} className="space-y-4">

                {/* ── Dados Pessoais ─────────────────────────────────────────── */}
                <Section icon={<User className="h-4 w-4" />} title="Dados Pessoais">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-1.5 md:col-span-2">
                            <Label>Nome Completo</Label>
                            <Input {...register("nome")} placeholder="Nome completo do candidato" />
                        </div>
                        <div className="space-y-1.5 md:col-span-2">
                            <Label>Endereço</Label>
                            <Input {...register("endereco")} placeholder="Rua, nº, bairro — Cidade, CE" />
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
                            <Input {...register("linkedin")} placeholder="linkedin.com/in/nome" />
                        </div>
                        <div className="space-y-1.5">
                            <Label>GitHub / Portfólio</Label>
                            <Input {...register("portfolio")} placeholder="github.com/nome ou behance.net/nome" />
                        </div>
                    </div>
                </Section>

                {/* ── Apresentação Profissional ──────────────────────────────── */}
                <Section icon={<FileText className="h-4 w-4" />} title="Apresentação Profissional">
                    <div className="space-y-1.5">
                        <Label>Texto de Apresentação</Label>
                        <Textarea
                            {...register("apresentacao")}
                            placeholder="Descreva o perfil do candidato: experiência, diferenciais e características pessoais relevantes para o mercado de trabalho..."
                            rows={5}
                        />
                        <p className="text-xs text-muted-foreground">
                            Este texto aparece no topo do currículo, antes do objetivo. Seja específico e objetivo.
                        </p>
                    </div>

                    {/* SQS-62: mesmo botão de IA do formulário público — agiliza quando o
                        candidato dita as habilidades e a equipe monta o texto na hora. */}
                    <div className="rounded-lg border border-dashed border-primary/40 bg-muted/30 p-3 space-y-2">
                        <Label className="text-sm">Gerar com IA a partir de habilidades</Label>
                        <p className="text-xs text-muted-foreground">
                            Digite até 3 habilidades do candidato e a IA monta um rascunho do texto de
                            apresentação. Depois é só ajustar.
                        </p>
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
                            disabled={gerandoApresentacao}
                            onClick={gerarApresentacaoComIA}
                        >
                            {gerandoApresentacao ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
                            Gerar com IA
                        </Button>
                    </div>
                </Section>

                {/* ── Objetivo Profissional ──────────────────────────────────── */}
                <Section icon={<Briefcase className="h-4 w-4" />} title="Objetivo Profissional">
                    <div className="space-y-1.5">
                        <Label>Cargo / Área desejada</Label>
                        <Input
                            {...register("objetivo")}
                            placeholder="Ex: Auxiliar Administrativo | Atendente de Loja | Estoquista"
                        />
                        <p className="text-xs text-muted-foreground">
                            Aparece como destaque no currículo. Use cargo(s) separados por &quot; | &quot;.
                        </p>
                    </div>
                </Section>

                {/* ── Experiências ──────────────────────────────────────────── */}
                <Section icon={<Briefcase className="h-4 w-4" />} title="Experiência Profissional">
                    {expFields.fields.map((field, i) => {
                        const inicio = watch(`experiencias.${i}.data_inicio`)
                        const fim = watch(`experiencias.${i}.data_fim`)
                        const atual = watch(`experiencias.${i}.atual`)
                        const permanencia = calcPermanencia(inicio, fim, atual)
                        return (
                            <div key={field.id} className="border rounded-lg p-4 space-y-3 relative">
                                <Button
                                    type="button" variant="ghost" size="icon"
                                    className="absolute top-2 right-2 text-destructive"
                                    onClick={() => expFields.remove(i)}
                                >
                                    <Trash2 className="h-4 w-4" />
                                </Button>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                                    {permanencia && <span className="text-xs text-muted-foreground ml-2">({permanencia})</span>}
                                </div>
                                <div className="space-y-1">
                                    <Label>Atividades realizadas</Label>
                                    <Controller
                                        control={control}
                                        name={`experiencias.${i}.atividades`}
                                        render={({ field: f }) => (
                                            <div className="space-y-2">
                                                {(f.value || []).map((at: Atividade, j: number) => (
                                                    <div key={j} className="flex gap-2">
                                                        <Input
                                                            value={at.descricao}
                                                            onChange={e => {
                                                                const updated = [...f.value]
                                                                updated[j] = { descricao: e.target.value }
                                                                f.onChange(updated)
                                                            }}
                                                            placeholder={`Atividade ${j + 1}`}
                                                        />
                                                        <Button
                                                            type="button" variant="ghost" size="icon"
                                                            onClick={() => f.onChange(f.value.filter((_: Atividade, k: number) => k !== j))}
                                                        >
                                                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                                        </Button>
                                                    </div>
                                                ))}
                                                <Button
                                                    type="button" variant="outline" size="sm"
                                                    onClick={() => f.onChange([...(f.value || []), { descricao: "" }])}
                                                >
                                                    <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar atividade
                                                </Button>
                                            </div>
                                        )}
                                    />
                                </div>
                            </div>
                        )
                    })}
                    <Button
                        type="button" variant="outline"
                        onClick={() => expFields.append({ empresa: "", cargo: "", data_inicio: "", data_fim: "", atual: false, atividades: [] })}
                    >
                        <Plus className="h-4 w-4 mr-2" /> Adicionar Experiência
                    </Button>
                </Section>

                {/* ── Formação ──────────────────────────────────────────────── */}
                <Section icon={<GraduationCap className="h-4 w-4" />} title="Formação Acadêmica">
                    {formFields.fields.map((field, i) => (
                        <div key={field.id} className="border rounded-lg p-4 space-y-3 relative">
                            <Button
                                type="button" variant="ghost" size="icon"
                                className="absolute top-2 right-2 text-destructive"
                                onClick={() => formFields.remove(i)}
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                <div className="space-y-1">
                                    <Label>Nível de Escolaridade</Label>
                                    <Controller
                                        control={control}
                                        name={`formacoes.${i}.escolaridade`}
                                        render={({ field: f }) => (
                                            <Select value={f.value} onValueChange={f.onChange}>
                                                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                                                <SelectContent>
                                                    {ESCOLARIDADES.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        )}
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label>Instituição</Label>
                                    <Input {...register(`formacoes.${i}.instituicao`)} placeholder="Nome da escola / faculdade" />
                                </div>
                                <div className="space-y-1 md:col-span-2">
                                    <Label>Curso / Graduação <span className="text-muted-foreground text-xs">(opcional)</span></Label>
                                    <Input {...register(`formacoes.${i}.curso`)} placeholder="Ex: Administração, Engenharia de Software..." />
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
                                    <Label>
                                        {watch(`formacoes.${i}.status`) === "cursando"
                                            ? "Previsão de Conclusão"
                                            : "Ano de Conclusão"}
                                    </Label>
                                    <Input {...register(`formacoes.${i}.ano`)} placeholder="2024" maxLength={4} />
                                </div>
                            </div>
                        </div>
                    ))}
                    <Button
                        type="button" variant="outline"
                        onClick={() => formFields.append({ escolaridade: "", instituicao: "", curso: "", status: "concluido", ano: "" })}
                    >
                        <Plus className="h-4 w-4 mr-2" /> Adicionar Formação
                    </Button>
                </Section>

                {/* ── Cursos ────────────────────────────────────────────────── */}
                <Section icon={<BookOpen className="h-4 w-4" />} title="Cursos e Certificações" defaultOpen={false}>
                    {cursoFields.fields.map((field, i) => (
                        <div key={field.id} className="border rounded-lg p-4 space-y-3 relative">
                            <Button
                                type="button" variant="ghost" size="icon"
                                className="absolute top-2 right-2 text-destructive"
                                onClick={() => cursoFields.remove(i)}
                            >
                                <Trash2 className="h-4 w-4" />
                            </Button>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
                                    <Label>Descrição (opcional)</Label>
                                    <Input {...register(`cursos.${i}.descricao`)} placeholder="Breve descrição ou carga horária" />
                                </div>
                            </div>
                        </div>
                    ))}
                    <Button
                        type="button" variant="outline"
                        onClick={() => cursoFields.append({ titulo: "", instituicao: "", ano: "", descricao: "" })}
                    >
                        <Plus className="h-4 w-4 mr-2" /> Adicionar Curso
                    </Button>
                </Section>

                {/* ── Habilidades ───────────────────────────────────────────── */}
                <Section icon={<Wrench className="h-4 w-4" />} title="Habilidades Técnicas" defaultOpen={false}>
                    {habFields.fields.map((field, i) => (
                        <div key={field.id} className="flex gap-2 items-start">
                            <Input {...register(`habilidades.${i}.titulo`)} placeholder="Ex: Excel" className="w-40 flex-shrink-0" />
                            <Input {...register(`habilidades.${i}.descricao`)} placeholder="Nível ou detalhe (opcional)" className="flex-1" />
                            <Button type="button" variant="ghost" size="icon" onClick={() => habFields.remove(i)}>
                                <Trash2 className="h-4 w-4 text-destructive" />
                            </Button>
                        </div>
                    ))}
                    <Button
                        type="button" variant="outline"
                        onClick={() => habFields.append({ titulo: "", descricao: "" })}
                    >
                        <Plus className="h-4 w-4 mr-2" /> Adicionar Habilidade
                    </Button>
                </Section>

                {/* ── Salvar (rodapé) — mesma ação do botão do topo, pra não obrigar
                     rolar a página inteira de volta pra cima num formulário longo. ── */}
                <div className="flex justify-end">
                    <Button
                        type="submit"
                        className="bg-cuca-blue hover:bg-sky-800 text-white"
                        disabled={saving}
                    >
                        {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                        Salvar
                    </Button>
                </div>

            </form>

            {/* ── Dialog: Verificar Vagas em Aberto (RN2) ─────────────────── */}
            <Dialog open={vagasOpen} onOpenChange={o => { if (!o) setVagasOpen(false) }}>
                <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Vagas em Aberto</DialogTitle>
                        <DialogDescription>
                            Candidato: <strong>{talentNome}</strong> — selecione uma vaga para encaminhar.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="relative mb-3">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar por título, empresa ou unidade..."
                            className="pl-10"
                            value={vagaSearch}
                            onChange={e => setVagaSearch(e.target.value)}
                        />
                    </div>
                    <div className="overflow-y-auto flex-1 divide-y divide-border border rounded-lg">
                        {vagaLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        ) : vagasFiltradas.length === 0 ? (
                            <p className="text-center py-8 text-muted-foreground text-sm">
                                Nenhuma vaga em aberto encontrada.
                            </p>
                        ) : vagasFiltradas.map(v => (
                            <div key={v.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-sm truncate">{v.titulo}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {v.empresas?.nome || "Empresa"} · {v.unidade_cuca || "Todas as unidades"}
                                    </p>
                                </div>
                                <Button
                                    size="sm"
                                    disabled={vinculando === v.id}
                                    onClick={() => handleVincular(v)}
                                >
                                    {vinculando === v.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Encaminhar"}
                                </Button>
                            </div>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
