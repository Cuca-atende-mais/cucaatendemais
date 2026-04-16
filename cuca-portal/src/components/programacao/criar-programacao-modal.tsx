"use client"

// SQS-44: Modal de criação interna guiada da Programação Mensal
// Coexiste com o upload de planilha — não substitui nem altera o fluxo existente.

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Loader2, Plus, Trash2, Pencil } from "lucide-react"
import toast from "react-hot-toast"
import { unidadesCuca } from "@/lib/constants"
import { useRouter } from "next/navigation"

// ─── Constantes ───────────────────────────────────────────────────────────────

const MESES_LISTA = [
    { value: 1, label: "Janeiro" }, { value: 2, label: "Fevereiro" },
    { value: 3, label: "Março" }, { value: 4, label: "Abril" },
    { value: 5, label: "Maio" }, { value: 6, label: "Junho" },
    { value: 7, label: "Julho" }, { value: 8, label: "Agosto" },
    { value: 9, label: "Setembro" }, { value: 10, label: "Outubro" },
    { value: 11, label: "Novembro" }, { value: 12, label: "Dezembro" },
]

const DIAS_SEMANA = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"]

const DIAS_SEMANA_ABREV: Record<string, string> = {
    "Segunda": "Seg", "Terça": "Ter", "Quarta": "Qua",
    "Quinta": "Qui", "Sexta": "Sex", "Sábado": "Sáb", "Domingo": "Dom",
}

const NOMES_DIA_SEMANA = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"]

// ─── Tipos internos ────────────────────────────────────────────────────────────

type Categoria = "CURSOS" | "ESPORTES" | "DIA A DIA" | "ESPECIAIS"

interface AtividadeInterna {
    _tempId: string
    categoria: Categoria
    titulo: string
    descricao: string | null
    local: string | null
    data_atividade: string | null
    hora_inicio: string | null
    hora_fim: string | null
    metadata: Record<string, any>
}

interface CriarProgramacaoModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    unidadeInicial?: string
    onSuccess: () => void
}

// ─── Formulários por categoria (sub-componentes inline) ───────────────────────

interface FormCursosProps {
    value: Partial<AtividadeInterna>
    onChange: (v: Partial<AtividadeInterna>) => void
}

function FormCursos({ value, onChange }: FormCursosProps) {
    const meta = value.metadata || {}
    const set = (key: string, val: any) => onChange({ ...value, metadata: { ...meta, [key]: val } })
    const setRoot = (key: keyof AtividadeInterna, val: any) => onChange({ ...value, [key]: val })
    const diasSel: string[] = meta.dias_raw || []
    const toggleDia = (d: string) => {
        const next = diasSel.includes(d) ? diasSel.filter(x => x !== d) : [...diasSel, d]
        set("dias_raw", next)
        set("dias_semana", next.map(x => DIAS_SEMANA_ABREV[x]).join(" e "))
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2 space-y-1.5">
                    <Label>Título do Curso *</Label>
                    <Input maxLength={100} value={value.titulo || ""} onChange={e => setRoot("titulo", e.target.value)} placeholder="Ex: Fotografia Digital" />
                </div>
                <div className="space-y-1.5">
                    <Label>Educador *</Label>
                    <Input value={meta.educador || ""} onChange={e => set("educador", e.target.value)} placeholder="Nome do educador" />
                </div>
                <div className="space-y-1.5">
                    <Label>Vagas *</Label>
                    <Input type="number" min={1} value={meta.vagas || ""} onChange={e => set("vagas", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                    <Label>Carga Horária (horas) *</Label>
                    <Input type="number" min={1} value={meta.carga_horaria || ""} onChange={e => set("carga_horaria", e.target.value)} placeholder="Ex: 40" />
                </div>
                <div className="space-y-1.5">
                    <Label>Requisitos *</Label>
                    <Input value={meta.requisitos || ""} onChange={e => set("requisitos", e.target.value)} placeholder="Ex: 15 a 29 anos" />
                </div>
                <div className="space-y-1.5">
                    <Label>Data de Início *</Label>
                    <Input type="date" value={meta.data_inicio_raw || ""} onChange={e => set("data_inicio_raw", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                    <Label>Data de Fim *</Label>
                    <Input type="date" min={meta.data_inicio_raw || ""} value={meta.data_fim_raw || ""} onChange={e => set("data_fim_raw", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                    <Label>Horário Início *</Label>
                    <Input type="time" value={value.hora_inicio || ""} onChange={e => setRoot("hora_inicio", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                    <Label>Horário Fim *</Label>
                    <Input type="time" value={value.hora_fim || ""} onChange={e => setRoot("hora_fim", e.target.value)} />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                    <Label>Dias da Semana *</Label>
                    <div className="flex gap-1.5 flex-wrap">
                        {DIAS_SEMANA.map(d => (
                            <button key={d} type="button"
                                onClick={() => toggleDia(d)}
                                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${diasSel.includes(d) ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border hover:bg-muted/70"}`}>
                                {DIAS_SEMANA_ABREV[d]}
                            </button>
                        ))}
                    </div>
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                    <Label>Ementa *</Label>
                    <Textarea rows={3} value={meta.ementa || ""} onChange={e => set("ementa", e.target.value)} placeholder="Descrição do conteúdo do curso" />
                </div>
            </div>
        </div>
    )
}

interface FormEsportesProps {
    value: Partial<AtividadeInterna>
    onChange: (v: Partial<AtividadeInterna>) => void
}

function FormEsportes({ value, onChange }: FormEsportesProps) {
    const meta = value.metadata || {}
    const set = (key: string, val: any) => onChange({ ...value, metadata: { ...meta, [key]: val } })
    const setRoot = (key: keyof AtividadeInterna, val: any) => onChange({ ...value, [key]: val })
    const diasSel: string[] = meta.dias_raw || []
    const toggleDia = (d: string) => {
        const next = diasSel.includes(d) ? diasSel.filter(x => x !== d) : [...diasSel, d]
        set("dias_raw", next)
        set("dias_semana", next.map(x => DIAS_SEMANA_ABREV[x]).join(" e "))
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2 space-y-1.5">
                    <Label>Modalidade *</Label>
                    <Input maxLength={100} value={value.titulo || ""} onChange={e => setRoot("titulo", e.target.value)} placeholder="Ex: Natação, Futsal" />
                </div>
                <div className="space-y-1.5">
                    <Label>Professor *</Label>
                    <Input value={meta.professor || ""} onChange={e => set("professor", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                    <Label>Turma *</Label>
                    <Input value={meta.turma || ""} onChange={e => set("turma", e.target.value)} placeholder="Ex: Turma 01" />
                </div>
                <div className="space-y-1.5">
                    <Label>Vagas *</Label>
                    <Input type="number" min={1} value={meta.vagas || ""} onChange={e => set("vagas", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                    <Label>Sexo *</Label>
                    <Select value={meta.sexo || ""} onValueChange={v => set("sexo", v)}>
                        <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                        <SelectContent>
                            <SelectItem value="Misto">Misto</SelectItem>
                            <SelectItem value="Masculino">Masculino</SelectItem>
                            <SelectItem value="Feminino">Feminino</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-1.5">
                    <Label>Faixa Etária De *</Label>
                    <Input type="number" min={0} max={100} value={meta.faixa_de || ""} onChange={e => set("faixa_de", e.target.value)} placeholder="Ex: 15" />
                </div>
                <div className="space-y-1.5">
                    <Label>Faixa Etária Até *</Label>
                    <Input type="number" min={meta.faixa_de || 0} max={100} value={meta.faixa_ate || ""} onChange={e => set("faixa_ate", e.target.value)} placeholder="Ex: 29" />
                </div>
                <div className="space-y-1.5">
                    <Label>Horário Início *</Label>
                    <Input type="time" value={value.hora_inicio || ""} onChange={e => setRoot("hora_inicio", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                    <Label>Horário Fim *</Label>
                    <Input type="time" value={value.hora_fim || ""} onChange={e => setRoot("hora_fim", e.target.value)} />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                    <Label>Dias da Semana *</Label>
                    <div className="flex gap-1.5 flex-wrap">
                        {DIAS_SEMANA.map(d => (
                            <button key={d} type="button"
                                onClick={() => toggleDia(d)}
                                className={`px-2.5 py-1 rounded-md text-xs font-medium border transition-colors ${diasSel.includes(d) ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border hover:bg-muted/70"}`}>
                                {DIAS_SEMANA_ABREV[d]}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
}

interface FormDiaDiaProps {
    value: Partial<AtividadeInterna>
    onChange: (v: Partial<AtividadeInterna>) => void
    categoria: "DIA A DIA" | "ESPECIAIS"
}

function FormDiaDia({ value, onChange, categoria }: FormDiaDiaProps) {
    const meta = value.metadata || {}
    const set = (key: string, val: any) => onChange({ ...value, metadata: { ...meta, [key]: val } })
    const setRoot = (key: keyof AtividadeInterna, val: any) => onChange({ ...value, [key]: val })

    const handleDataChange = (dataISO: string) => {
        setRoot("data_atividade", dataISO)
        if (dataISO) {
            // Dia da semana calculado a partir da data — sem timezone issues
            const [y, m, d] = dataISO.split("-").map(Number)
            const dt = new Date(y, m - 1, d)
            const diaNome = NOMES_DIA_SEMANA[dt.getDay()]
            const [, md] = dataISO.split("-")
            const dataFormatada = `${d.toString().padStart(2, "0")}/${md}`
            set("dia_semana", diaNome)
            set("data_real", dataFormatada)
        }
    }

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="sm:col-span-2 space-y-1.5">
                    <Label>Título da Atividade *</Label>
                    <Input maxLength={100} value={value.titulo || ""} onChange={e => setRoot("titulo", e.target.value)} placeholder="Nome da atividade" />
                </div>
                <div className="space-y-1.5">
                    <Label>Sessão / Eixo *</Label>
                    <Input value={meta.sessao || ""} onChange={e => set("sessao", e.target.value)} placeholder="Ex: DPDH, Empregabilidade" />
                </div>
                <div className="space-y-1.5">
                    <Label>Data do Evento *</Label>
                    <Input type="date" value={value.data_atividade || ""} onChange={e => handleDataChange(e.target.value)} />
                </div>
                {meta.dia_semana && (
                    <div className="space-y-1.5">
                        <Label>Dia da Semana</Label>
                        <p className="text-sm font-medium h-10 flex items-center px-3 bg-muted/40 rounded-md border border-border text-muted-foreground">{meta.dia_semana}</p>
                    </div>
                )}
                <div className="space-y-1.5">
                    <Label>Horário Início *</Label>
                    <Input type="time" value={value.hora_inicio || ""} onChange={e => setRoot("hora_inicio", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                    <Label>Horário Fim *</Label>
                    <Input type="time" value={value.hora_fim || ""} onChange={e => setRoot("hora_fim", e.target.value)} />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                    <Label>Local *</Label>
                    <Input value={value.local || ""} onChange={e => setRoot("local", e.target.value)} placeholder="Local do evento (nunca use este campo para horário)" />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                    <Label>Descrição da Atividade *</Label>
                    <Input value={meta.atividade || ""} onChange={e => set("atividade", e.target.value)} placeholder="Breve descrição" />
                </div>
                <div className="sm:col-span-2 space-y-1.5">
                    <Label>Informações / Objetivo</Label>
                    <Textarea rows={2} value={meta.informacoes || ""} onChange={e => set("informacoes", e.target.value)} placeholder="Opcional" />
                </div>
            </div>
        </div>
    )
}

// ─── Helpers de validação e montagem do payload ────────────────────────────────

function validarAtividade(a: Partial<AtividadeInterna>): string | null {
    const meta = a.metadata || {}
    if (!a.titulo?.trim()) return "Título é obrigatório"
    if (!a.hora_inicio || !a.hora_fim) return "Horário de início e fim são obrigatórios"

    if (a.categoria === "CURSOS") {
        if (!meta.educador?.trim()) return "Educador é obrigatório"
        if (!meta.vagas) return "Vagas são obrigatórias"
        if (!meta.carga_horaria) return "Carga horária é obrigatória"
        if (!meta.requisitos?.trim()) return "Requisitos são obrigatórios"
        if (!meta.data_inicio_raw || !meta.data_fim_raw) return "Período (início e fim) é obrigatório"
        if (!meta.ementa?.trim()) return "Ementa é obrigatória"
        if (!meta.dias_raw?.length) return "Selecione pelo menos um dia da semana"
    }

    if (a.categoria === "ESPORTES") {
        if (!meta.professor?.trim()) return "Professor é obrigatório"
        if (!meta.turma?.trim()) return "Turma é obrigatória"
        if (!meta.vagas) return "Vagas são obrigatórias"
        if (!meta.sexo) return "Sexo é obrigatório"
        if (!meta.faixa_de || !meta.faixa_ate) return "Faixa etária é obrigatória"
        if (!meta.dias_raw?.length) return "Selecione pelo menos um dia da semana"
    }

    if (a.categoria === "DIA A DIA" || a.categoria === "ESPECIAIS") {
        if (!a.data_atividade) return "Data do evento é obrigatória"
        if (!a.local?.trim()) return "Local é obrigatório"
        if (!meta.sessao?.trim()) return "Sessão / Eixo é obrigatório"
        if (!meta.atividade?.trim()) return "Descrição da atividade é obrigatória"
    }

    return null
}

function montarAtividadePayload(a: Partial<AtividadeInterna>, unidade: string): any {
    const meta = { ...a.metadata }
    const fmtTime = (t: string) => t?.substring(0, 5) || ""
    const hi = fmtTime(a.hora_inicio || "")
    const hf = fmtTime(a.hora_fim || "")

    if (a.categoria === "CURSOS") {
        const fmtDate = (iso: string) => {
            if (!iso) return ""
            const [y, m, d] = iso.split("-")
            return `${d}/${m}/${y}`
        }
        const diasStr = (meta.dias_raw || []).map((d: string) => DIAS_SEMANA_ABREV[d]).join(" e ")
        return {
            titulo: a.titulo,
            categoria: "CURSOS",
            descricao: meta.ementa || null,
            local: null,
            data_atividade: meta.data_inicio_raw || null,
            hora_inicio: hi,
            hora_fim: hf,
            unidade_cuca: unidade,
            metadata: {
                ementa: meta.ementa,
                educador: meta.educador,
                vagas: String(meta.vagas),
                carga_horaria: String(meta.carga_horaria),
                requisitos: meta.requisitos,
                periodo: `${fmtDate(meta.data_inicio_raw)} ${fmtDate(meta.data_fim_raw)} ${diasStr}`,
                horario: `${hi} às ${hf}`,
                dias_semana: diasStr,
            },
        }
    }

    if (a.categoria === "ESPORTES") {
        const diasStr = (meta.dias_raw || []).map((d: string) => DIAS_SEMANA_ABREV[d]).join(" e ")
        return {
            titulo: a.titulo,
            categoria: "ESPORTES",
            descricao: null,
            local: null,
            data_atividade: null,
            hora_inicio: hi,
            hora_fim: hf,
            unidade_cuca: unidade,
            metadata: {
                professor: meta.professor,
                turma: meta.turma?.startsWith("Turma") ? meta.turma : `Turma ${meta.turma}`,
                faixa_etaria: `${meta.faixa_de} a ${meta.faixa_ate} anos`,
                sexo: meta.sexo,
                vagas: String(meta.vagas),
                dias_semana: diasStr,
                horario: `${hi} às ${hf}`,
            },
        }
    }

    // DIA A DIA / ESPECIAIS
    return {
        titulo: a.titulo,
        categoria: a.categoria,
        descricao: meta.atividade || null,
        local: a.local || null,
        data_atividade: a.data_atividade || null,
        hora_inicio: hi,
        hora_fim: hf,
        unidade_cuca: unidade,
        metadata: {
            sessao: meta.sessao,
            data_real: meta.data_real,
            dia_semana: meta.dia_semana,
            atividade: meta.atividade,
            hora_inicio: hi,
            hora_fim: hf,
            local: a.local,
            informacoes: meta.informacoes || null,
        },
    }
}

function resumoAtividade(a: Partial<AtividadeInterna>): string {
    const meta = a.metadata || {}
    const hi = a.hora_inicio?.substring(0, 5) || "?"
    const hf = a.hora_fim?.substring(0, 5) || "?"
    if (a.categoria === "CURSOS") return `${hi}–${hf} · ${meta.educador || "—"}`
    if (a.categoria === "ESPORTES") return `${hi}–${hf} · ${meta.turma || "—"} · ${meta.sexo || "—"}`
    return `${meta.data_real || "—"} · ${hi}–${hf}`
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function CriarProgramacaoModal({
    open,
    onOpenChange,
    unidadeInicial = "",
    onSuccess,
}: CriarProgramacaoModalProps) {
    const supabase = createClient()
    const router = useRouter()

    // Step: 1 = Cabeçalho, 2 = Atividades, 3 = Revisão
    const [step, setStep] = useState(1)

    // Cabeçalho (Step 1)
    const anoCorrente = new Date().getFullYear()
    const mesCorrente = new Date().getMonth() + 1
    const [mesSel, setMesSel] = useState<number>(mesCorrente)
    const [anoSel, setAnoSel] = useState<number>(anoCorrente)
    const [unidadeSel, setUnidadeSel] = useState<string>(unidadeInicial)
    const [verificandoDup, setVerificandoDup] = useState(false)
    const [campanhaExistente, setCampanhaExistente] = useState<any>(null)

    // Atividades (Step 2)
    const [atividades, setAtividades] = useState<Partial<AtividadeInterna>[]>([])
    const [categoriaSel, setCategoriaSel] = useState<Categoria>("CURSOS")
    const [formAtual, setFormAtual] = useState<Partial<AtividadeInterna>>({ categoria: "CURSOS", metadata: {} })
    const [editandoIdx, setEditandoIdx] = useState<number | null>(null)
    const [erroForm, setErroForm] = useState<string | null>(null)

    // Submit
    const [salvando, setSalvando] = useState(false)

    const nomeMes = MESES_LISTA.find(m => m.value === mesSel)?.label || ""

    const resetForm = () => {
        setFormAtual({ categoria: categoriaSel, metadata: {} })
        setEditandoIdx(null)
        setErroForm(null)
    }

    const handleClose = () => {
        setStep(1)
        setMesSel(mesCorrente)
        setAnoSel(anoCorrente)
        setUnidadeSel(unidadeInicial)
        setCampanhaExistente(null)
        setAtividades([])
        resetForm()
        onOpenChange(false)
    }

    // ── Step 1: verificar duplicata e avançar ──────────────────────────────────
    const handleAvancarStep1 = async () => {
        if (!unidadeSel || !mesSel || !anoSel) {
            toast.error("Selecione unidade, mês e ano.")
            return
        }

        setVerificandoDup(true)
        try {
            const { data: existente } = await supabase
                .from("campanhas_mensais")
                .select("id, status, titulo")
                .eq("unidade_cuca", unidadeSel)
                .eq("mes", mesSel)
                .eq("ano", anoSel)
                .maybeSingle()

            setCampanhaExistente(existente || null)
        } finally {
            setVerificandoDup(false)
        }

        setStep(2)
    }

    // ── Step 2: gerenciar atividades ───────────────────────────────────────────
    const handleMudarCategoria = (cat: Categoria) => {
        setCategoriaSel(cat)
        setFormAtual({ categoria: cat, metadata: {} })
        setEditandoIdx(null)
        setErroForm(null)
    }

    const handleAdicionarAtividade = () => {
        const erro = validarAtividade({ ...formAtual, categoria: categoriaSel })
        if (erro) { setErroForm(erro); return }

        const nova: Partial<AtividadeInterna> = {
            ...formAtual,
            categoria: categoriaSel,
            _tempId: Math.random().toString(36).slice(2),
        }

        if (editandoIdx !== null) {
            const updated = [...atividades]
            updated[editandoIdx] = nova
            setAtividades(updated)
        } else {
            setAtividades(prev => [...prev, nova])
        }
        resetForm()
    }

    const handleEditarAtividade = (idx: number) => {
        const a = atividades[idx]
        setCategoriaSel(a.categoria as Categoria)
        setFormAtual({ ...a })
        setEditandoIdx(idx)
        setErroForm(null)
    }

    const handleRemoverAtividade = (idx: number) => {
        if (!confirm("Remover esta atividade?")) return
        setAtividades(prev => prev.filter((_, i) => i !== idx))
    }

    // ── Submit: salvar como rascunho ───────────────────────────────────────────
    const handleSalvarRascunho = async () => {
        if (atividades.length === 0) {
            toast.error("Adicione pelo menos uma atividade antes de salvar.")
            return
        }
        setSalvando(true)
        try {
            const titulo = `Programação ${unidadeSel} — ${nomeMes} ${anoSel}`

            const campanhaPayload = {
                titulo,
                unidade_cuca: unidadeSel,
                mes: mesSel,
                ano: anoSel,
                total_atividades: atividades.length,
                status: "rascunho",
            }

            const atividadesPayload = atividades.map(a =>
                montarAtividadePayload(a, unidadeSel)
            )

            const res = await fetch("/api/programacao/importar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ campanha: campanhaPayload, atividades: atividadesPayload }),
            })

            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Erro ao salvar")

            toast.success("Programação salva como rascunho!")
            onSuccess()
            handleClose()
            if (data.campanha_id) {
                router.push(`/programacao/mensal/${data.campanha_id}`)
            }
        } catch (e: any) {
            toast.error(e.message || "Erro ao salvar")
        } finally {
            setSalvando(false)
        }
    }

    // ── Contagem por categoria ──────────────────────────────────────────────────
    const contagem = atividades.reduce<Record<string, number>>((acc, a) => {
        const cat = a.categoria || "Outros"
        acc[cat] = (acc[cat] || 0) + 1
        return acc
    }, {})

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
                <DialogHeader className="shrink-0">
                    <DialogTitle className="flex items-center gap-2">
                        <Plus className="h-5 w-5 text-primary" />
                        Criar Programação Mensal
                        {step >= 2 && nomeMes && (
                            <Badge variant="outline" className="ml-2 font-semibold text-primary border-primary/40">
                                {nomeMes} {anoSel} · {unidadeSel.replace("Cuca ", "")}
                            </Badge>
                        )}
                    </DialogTitle>
                    <DialogDescription className="flex items-center gap-4">
                        {[
                            { n: 1, label: "Cabeçalho" },
                            { n: 2, label: "Atividades" },
                            { n: 3, label: "Revisão" },
                        ].map(({ n, label }) => (
                            <span key={n} className={`flex items-center gap-1.5 text-xs font-medium ${step === n ? "text-primary" : step > n ? "text-green-500" : "text-muted-foreground"}`}>
                                <span className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold border ${step === n ? "border-primary bg-primary/10 text-primary" : step > n ? "border-green-500 bg-green-500/10 text-green-500" : "border-border"}`}>
                                    {step > n ? "✓" : n}
                                </span>
                                {label}
                            </span>
                        ))}
                    </DialogDescription>
                </DialogHeader>

                <div className="flex-1 overflow-y-auto px-0.5 py-2">

                    {/* ── STEP 1: Cabeçalho ── */}
                    {step === 1 && (
                        <div className="space-y-6">
                            {/* Destaque visual: Mês e Ano são a identidade */}
                            <div className="p-4 rounded-xl border-2 border-primary/40 bg-primary/5">
                                <p className="text-xs font-semibold text-primary mb-3 uppercase tracking-wide">
                                    Identidade da Programação — Mês de Referência
                                </p>
                                <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                        <Label className="font-semibold">Mês *</Label>
                                        <Select value={String(mesSel)} onValueChange={v => setMesSel(Number(v))}>
                                            <SelectTrigger className="border-primary/40 focus:ring-primary">
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {MESES_LISTA.map(m => (
                                                    <SelectItem key={m.value} value={String(m.value)}>{m.label}</SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="space-y-1.5">
                                        <Label className="font-semibold">Ano *</Label>
                                        <Input
                                            type="number"
                                            min={2024}
                                            max={2030}
                                            value={anoSel}
                                            onChange={e => setAnoSel(Number(e.target.value))}
                                            className="border-primary/40 focus-visible:ring-primary"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <Label>Unidade CUCA *</Label>
                                <Select value={unidadeSel} onValueChange={setUnidadeSel}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecione a unidade" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {unidadesCuca.map(u => (
                                            <SelectItem key={u} value={u}>{u}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {unidadeSel && mesSel && anoSel && (
                                <p className="text-xs text-muted-foreground bg-muted/50 rounded-lg p-3 border">
                                    Título gerado automaticamente: <strong>"Programação {unidadeSel} — {nomeMes} {anoSel}"</strong>
                                </p>
                            )}
                        </div>
                    )}

                    {/* ── STEP 2: Atividades ── */}
                    {step === 2 && (
                        <div className="space-y-4">
                            {/* Alerta de campanha existente (AC-8) */}
                            {campanhaExistente && (
                                <div className="flex items-start gap-2 p-3 rounded-lg border border-amber-500/40 bg-amber-500/10 text-amber-600 text-sm">
                                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                                    <span>
                                        Já existe programação para <strong>{unidadeSel}</strong> em <strong>{nomeMes}/{anoSel}</strong> (status: <em>{campanhaExistente.status}</em>).
                                        Salvar criará uma nova versão — a existente será substituída ao confirmar.
                                    </span>
                                </div>
                            )}

                            {/* Seletor de categoria */}
                            <div className="flex gap-1.5 flex-wrap">
                                {(["CURSOS", "ESPORTES", "DIA A DIA", "ESPECIAIS"] as Categoria[]).map(cat => (
                                    <button key={cat} type="button"
                                        onClick={() => handleMudarCategoria(cat)}
                                        className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors border ${categoriaSel === cat ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border hover:bg-muted/70"}`}>
                                        {cat}
                                        {contagem[cat] ? <span className="ml-1.5 opacity-70">({contagem[cat]})</span> : null}
                                    </button>
                                ))}
                            </div>

                            {/* Formulário da categoria */}
                            <div className="border border-border rounded-xl p-4 bg-muted/20">
                                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                                    {editandoIdx !== null ? "Editando atividade" : "Nova atividade"} — {categoriaSel}
                                </p>

                                {categoriaSel === "CURSOS" && (
                                    <FormCursos value={formAtual} onChange={setFormAtual} />
                                )}
                                {categoriaSel === "ESPORTES" && (
                                    <FormEsportes value={formAtual} onChange={setFormAtual} />
                                )}
                                {(categoriaSel === "DIA A DIA" || categoriaSel === "ESPECIAIS") && (
                                    <FormDiaDia value={formAtual} onChange={setFormAtual} categoria={categoriaSel} />
                                )}

                                {erroForm && (
                                    <p className="mt-2 text-xs text-red-500 flex items-center gap-1">
                                        <AlertCircle className="h-3.5 w-3.5" /> {erroForm}
                                    </p>
                                )}

                                <div className="flex gap-2 mt-4">
                                    <Button size="sm" onClick={handleAdicionarAtividade} className="gap-1.5">
                                        {editandoIdx !== null ? <><Pencil className="h-3.5 w-3.5" /> Salvar edição</> : <><Plus className="h-3.5 w-3.5" /> Adicionar</>}
                                    </Button>
                                    {editandoIdx !== null && (
                                        <Button size="sm" variant="ghost" onClick={resetForm}>Cancelar</Button>
                                    )}
                                </div>
                            </div>

                            {/* Lista de atividades adicionadas */}
                            {atividades.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                        {atividades.length} {atividades.length === 1 ? "atividade" : "atividades"} adicionadas
                                    </p>
                                    {atividades.map((a, idx) => (
                                        <div key={a._tempId || idx} className="flex items-center justify-between gap-2 p-3 rounded-lg border border-border bg-background hover:bg-muted/30 transition-colors">
                                            <div className="flex items-center gap-2.5 min-w-0">
                                                <Badge variant="outline" className="text-[10px] shrink-0">{a.categoria}</Badge>
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium truncate">{a.titulo}</p>
                                                    <p className="text-xs text-muted-foreground">{resumoAtividade(a)}</p>
                                                </div>
                                            </div>
                                            <div className="flex gap-1 shrink-0">
                                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-blue-500 hover:bg-blue-500/10" onClick={() => handleEditarAtividade(idx)}>
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </Button>
                                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-red-500 hover:bg-red-500/10" onClick={() => handleRemoverAtividade(idx)}>
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ── STEP 3: Revisão ── */}
                    {step === 3 && (
                        <div className="space-y-4">
                            <div className="p-4 rounded-xl border border-border bg-muted/20">
                                <p className="text-sm font-semibold mb-1">Resumo da Programação</p>
                                <p className="text-xs text-muted-foreground">
                                    <strong>{unidadeSel}</strong> · {nomeMes} {anoSel} · {atividades.length} atividades
                                </p>
                            </div>

                            <div className="space-y-2">
                                {Object.entries(contagem).map(([cat, qtd]) => (
                                    <div key={cat} className="flex items-center justify-between p-3 rounded-lg border border-border bg-background">
                                        <div className="flex items-center gap-2">
                                            <CheckCircle2 className="h-4 w-4 text-green-500" />
                                            <span className="text-sm font-medium">{cat}</span>
                                        </div>
                                        <Badge variant="secondary">{qtd} {qtd === 1 ? "atividade" : "atividades"}</Badge>
                                    </div>
                                ))}
                            </div>

                            {atividades.length === 0 && (
                                <p className="text-sm text-center text-muted-foreground py-4">
                                    Nenhuma atividade adicionada. Volte ao passo anterior.
                                </p>
                            )}
                        </div>
                    )}
                </div>

                {/* ── Footer de navegação ── */}
                <div className="shrink-0 border-t border-border pt-4 flex justify-between gap-2">
                    <Button variant="ghost" onClick={step === 1 ? handleClose : () => setStep(s => s - 1)} className="gap-1">
                        {step === 1 ? "Cancelar" : <><ChevronLeft className="h-4 w-4" /> Voltar</>}
                    </Button>

                    <div className="flex gap-2">
                        {step < 3 && (
                            <Button
                                onClick={step === 1 ? handleAvancarStep1 : () => setStep(3)}
                                disabled={verificandoDup}
                                className="gap-1"
                            >
                                {verificandoDup ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                {step === 2 && atividades.length === 0 ? "Revisar" : "Próximo"}
                                {!verificandoDup && <ChevronRight className="h-4 w-4" />}
                            </Button>
                        )}
                        {step === 3 && (
                            <Button
                                onClick={handleSalvarRascunho}
                                disabled={salvando || atividades.length === 0}
                                className="bg-primary text-primary-foreground gap-1"
                            >
                                {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                Salvar como Rascunho
                            </Button>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    )
}
