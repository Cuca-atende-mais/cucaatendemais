"use client"

// SQS-44: Modal de criação interna guiada da Programação Mensal
// Coexiste com o upload de planilha — não substitui nem altera o fluxo existente.

import { useState } from "react"
import { AVISO_VAGAS } from "@/lib/programacao/rag"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { AlertCircle, CheckCircle2, ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react"
import toast from "react-hot-toast"
import { cn } from "@/lib/utils"
import { unidadesCuca } from "@/lib/constants"
import { AtividadeForm, DIAS_SEMANA_ABREV } from "@/lib/programacao/tipos"
import { calcularProblemas, Problema } from "@/lib/programacao/revisao"
import { GradeAtividades } from "@/components/programacao/grade-atividades"
import { FichaAtividade } from "@/components/programacao/ficha-atividade"

// ─── Constantes ───────────────────────────────────────────────────────────────

const MESES_LISTA = [
    { value: 1, label: "Janeiro" }, { value: 2, label: "Fevereiro" },
    { value: 3, label: "Março" }, { value: 4, label: "Abril" },
    { value: 5, label: "Maio" }, { value: 6, label: "Junho" },
    { value: 7, label: "Julho" }, { value: 8, label: "Agosto" },
    { value: 9, label: "Setembro" }, { value: 10, label: "Outubro" },
    { value: 11, label: "Novembro" }, { value: 12, label: "Dezembro" },
]

// AtividadeInterna, Categoria, DIAS_SEMANA_ABREV: S-PROG-01 moveu para
// lib/programacao/tipos.ts — compartilhado com a grade, a ficha e o painel de revisão, em vez
// de redeclarado aqui como antes.
type AtividadeInterna = AtividadeForm

interface CriarProgramacaoModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    unidadeInicial?: string
    onSuccess: () => void
}

// Os antigos FormCursos/FormEsportes/FormDiaDia (1 formulário por atividade) e validarAtividade
// (bloqueava "Adicionar" na primeira falha) saíram na S-PROG-01, substituídos pela grade editável
// (`GradeAtividades`) + ficha lateral (`FichaAtividade`) + painel de revisão
// (`calcularProblemas`, lib/programacao/revisao) — o gargalo era a cardinalidade (Mondubim teve
// 126 atividades de ESPORTES num único mês), não o formulário em si. A grade permite editar
// várias linhas incompletas ao mesmo tempo; bloquear o envio é escopo da S-PROG-04 (fluxo de
// aprovação), fora desta story.

// ─── Helpers de validação e montagem do payload ────────────────────────────────

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
        const periodoStr = `${fmtDate(meta.data_inicio_raw)} ${fmtDate(meta.data_fim_raw)} ${diasStr}`
        const horarioStr = `${hi} às ${hf}`
        // Descricao no mesmo formato que o trigger trigger_indexar_campanha_mensal usa para montar o RAG
        const descricao = `Curso: ${a.titulo}. Educador: ${meta.educador}. Carga Horária: ${meta.carga_horaria}h. Período: ${periodoStr}. Horário: ${horarioStr}. Requisitos: ${meta.requisitos}. Ementa: ${meta.ementa}. ${AVISO_VAGAS}`
        return {
            titulo: a.titulo,
            categoria: "CURSOS",
            descricao: descricao.substring(0, 1500),
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
                periodo: periodoStr,
                horario: horarioStr,
                dias_semana: diasStr,
                // S-PROG-01 (item 4): Meta e Diretoria — chaves aditivas, não vão ao RAG nem à
                // exportação nesta story (contrato de gravação não muda, isso é S-PROG-03/05).
                meta: meta.meta || null,
                diretoria: meta.diretoria || null,
            },
        }
    }

    if (a.categoria === "ESPORTES") {
        const diasStr = (meta.dias_raw || []).map((d: string) => DIAS_SEMANA_ABREV[d]).join(" e ")
        const turmaStr = meta.turma?.startsWith("Turma") ? meta.turma : `Turma ${meta.turma}`
        // S-PROG-01 (item 2): idade máxima é opcional — sem ela, "a partir de X anos".
        const faixaStr = meta.faixa_ate ? `${meta.faixa_de} a ${meta.faixa_ate} anos` : `a partir de ${meta.faixa_de} anos`
        const horarioStr = `${hi} às ${hf}`
        // Descricao no mesmo formato que o trigger usa para montar o RAG
        const descricao = `Esporte Modalidade: ${a.titulo} - ${turmaStr}. Professor: ${meta.professor}. Público: ${meta.sexo} (Idade: ${faixaStr}). Dias: ${diasStr}. Horário: ${horarioStr}. ${AVISO_VAGAS}`
        return {
            titulo: a.titulo,
            categoria: "ESPORTES",
            descricao: descricao.substring(0, 1500),
            local: null,
            data_atividade: null,
            hora_inicio: hi,
            hora_fim: hf,
            unidade_cuca: unidade,
            metadata: {
                professor: meta.professor,
                turma: turmaStr,
                faixa_etaria: faixaStr,
                sexo: meta.sexo,
                vagas: String(meta.vagas),
                dias_semana: diasStr,
                horario: horarioStr,
                meta: meta.meta || null,
                diretoria: meta.diretoria || null,
            },
        }
    }

    // DIA A DIA / ESPECIAIS
    const categoriaLabel = a.categoria as string
    // Descricao no mesmo formato que o trigger usa para montar o RAG
    const descricaoDiaDia = `Programa (${categoriaLabel}): ${a.titulo}. Atividade: ${meta.atividade}. Data: ${meta.data_real} (${meta.dia_semana}). Horário: ${hi} às ${hf}. Local: ${a.local}. Informações: ${meta.informacoes || ""}. Sessão: ${meta.sessao}.`
    return {
        titulo: a.titulo,
        categoria: a.categoria,
        descricao: descricaoDiaDia.substring(0, 1500),
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
            meta: meta.meta || null,
            diretoria: meta.diretoria || null,
        },
    }
}

// ─── Componente principal ─────────────────────────────────────────────────────

export function CriarProgramacaoModal({
    open,
    onOpenChange,
    unidadeInicial = "",
    onSuccess,
}: CriarProgramacaoModalProps) {
    const supabase = createClient()

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

    // Atividades (Step 2) — S-PROG-01: grade editável, sem formulário-por-atividade
    const [atividades, setAtividades] = useState<AtividadeInterna[]>([])

    // Ficha da atividade (item 3) — painel lateral, aberto a partir da grade
    const [fichaTempId, setFichaTempId] = useState<string | null>(null)
    const [fichaFocoCampo, setFichaFocoCampo] = useState<string | undefined>(undefined)

    // Submit
    const [salvando, setSalvando] = useState(false)

    const nomeMes = MESES_LISTA.find(m => m.value === mesSel)?.label || ""

    const handleClose = () => {
        setStep(1)
        setMesSel(mesCorrente)
        setAnoSel(anoCorrente)
        setUnidadeSel(unidadeInicial)
        setCampanhaExistente(null)
        setAtividades([])
        setFichaTempId(null)
        setFichaFocoCampo(undefined)
        onOpenChange(false)
    }

    // ── Ficha da atividade: abrir/fechar/navegar entre linhas da MESMA categoria ──────────────
    const atividadeDaFicha = atividades.find(a => a._tempId === fichaTempId) || null
    const irmasDaFicha = atividadeDaFicha ? atividades.filter(a => a.categoria === atividadeDaFicha.categoria) : []
    const indiceNaFicha = atividadeDaFicha ? irmasDaFicha.findIndex(a => a._tempId === atividadeDaFicha._tempId) : -1

    const handleAbrirFicha = (tempId: string, focoCampo?: string) => {
        setFichaTempId(tempId)
        setFichaFocoCampo(focoCampo)
    }

    const handleFecharFicha = () => {
        setFichaTempId(null)
        setFichaFocoCampo(undefined)
    }

    const handleNavegarFicha = (delta: 1 | -1) => {
        if (indiceNaFicha < 0 || irmasDaFicha.length === 0) return
        const proximoIndice = (indiceNaFicha + delta + irmasDaFicha.length) % irmasDaFicha.length
        setFichaTempId(irmasDaFicha[proximoIndice]._tempId)
        setFichaFocoCampo(undefined)
    }

    const handleMudarAtividadeDaFicha = (nova: AtividadeInterna) => {
        setAtividades(prev => prev.map(a => a._tempId === nova._tempId ? nova : a))
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

            // Aguarda 1.5s para a replicação do Supabase antes de fechar e atualizar
            // (mesmo padrão do import-planilha-modal que usa 3s de delay pelo mesmo motivo)
            setTimeout(() => {
                toast.success("Programação salva como rascunho! Clique em 'Ver Atividades' para abrir.")
                onSuccess()
                handleClose()
            }, 1500)
        } catch (e: any) {
            toast.error(e.message || "Erro ao salvar")
        } finally {
            setSalvando(false)
        }
    }

    // ── Contagem por categoria + painel de revisão (item 5) ────────────────────
    const contagem = atividades.reduce<Record<string, number>>((acc, a) => {
        const cat = a.categoria || "Outros"
        acc[cat] = (acc[cat] || 0) + 1
        return acc
    }, {})
    const problemas: Problema[] = calcularProblemas(atividades)
    const [painelRevisaoAberto, setPainelRevisaoAberto] = useState(false)

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className={cn("max-h-[90vh] flex flex-col overflow-hidden", step === 2 ? "sm:max-w-[1080px]" : "max-w-2xl")}>
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

                    {/* ── STEP 2: Atividades (S-PROG-01: grade editável + ficha) ── */}
                    {step === 2 && (
                        <div className="space-y-3">
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

                            {/* Item 5: painel de revisão — contador no topo, lista em linguagem comum */}
                            {atividades.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setPainelRevisaoAberto(v => !v)}
                                    className={cn(
                                        "w-full text-left text-xs font-semibold px-3 py-2 rounded-lg border flex items-center justify-between",
                                        problemas.length > 0
                                            ? "bg-amber-500/10 border-amber-500/40 text-amber-700"
                                            : "bg-green-500/10 border-green-500/40 text-green-700"
                                    )}
                                >
                                    <span>{problemas.length > 0 ? `${problemas.length} ponto(s) a revisar` : "Tudo certo para revisar"}</span>
                                    <span className="opacity-70">{painelRevisaoAberto ? "ocultar" : "ver"}</span>
                                </button>
                            )}
                            {painelRevisaoAberto && problemas.length > 0 && (
                                <div className="space-y-1 max-h-40 overflow-y-auto border border-amber-500/30 rounded-lg p-2 bg-amber-500/5">
                                    {problemas.map((p, i) => (
                                        <p key={i} className="text-xs text-amber-700 flex items-start gap-1.5">
                                            <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" /> {p.mensagem}
                                        </p>
                                    ))}
                                </div>
                            )}

                            <GradeAtividades atividades={atividades} onChange={setAtividades} onAbrirFicha={handleAbrirFicha} />
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

                            {problemas.length > 0 && (
                                <div className="space-y-1.5">
                                    <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5">
                                        <AlertCircle className="h-3.5 w-3.5" /> {problemas.length} ponto(s) a revisar — pode salvar como rascunho e corrigir depois
                                    </p>
                                    <div className="space-y-1 max-h-40 overflow-y-auto border border-amber-500/30 rounded-lg p-2 bg-amber-500/5">
                                        {problemas.map((p, i) => (
                                            <p key={i} className="text-xs text-amber-700">{p.mensagem}</p>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {atividades.length === 0 && (
                                <p className="text-sm text-center text-muted-foreground py-4">
                                    Nenhuma atividade adicionada. Volte ao passo anterior.
                                </p>
                            )}
                        </div>
                    )}
                </div>

                <FichaAtividade
                    aberta={!!fichaTempId}
                    atividade={atividadeDaFicha}
                    indice={Math.max(indiceNaFicha, 0)}
                    total={irmasDaFicha.length}
                    focoCampo={fichaFocoCampo}
                    onChange={handleMudarAtividadeDaFicha}
                    onFechar={handleFecharFicha}
                    onNavegar={handleNavegarFicha}
                />

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
