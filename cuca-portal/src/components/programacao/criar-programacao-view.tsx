"use client"

// SQS-44 / S-PROG-01: página dedicada de criação guiada da Programação Mensal.
// Era um modal (Dialog) — o Junior apontou que ficava "tela dentro de tela", pequeno demais pra
// grade editável (chamou /frontend-design + /ui-ux-pro-max pra corrigir). Vira página de verdade
// em vez de um Dialog, seguindo o mesmo padrão já usado por /programacao/mensal/[id] (voltar com
// ArrowLeft, header de página, sem overlay). Coexiste com o upload de planilha — não substitui.

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Loader2, Plus } from "lucide-react"
import toast from "react-hot-toast"
import { cn } from "@/lib/utils"
import { unidadesCuca } from "@/lib/constants"
import { AtividadeForm } from "@/lib/programacao/tipos"
import { calcularProblemas, Problema } from "@/lib/programacao/revisao"
import { montarAtividadePayload } from "@/lib/programacao/payload"
import { atividadeFormDeLinhaExistente } from "@/lib/programacao/duplicar"
import { GradeAtividades } from "@/components/programacao/grade-atividades"
import { FichaAtividade } from "@/components/programacao/ficha-atividade"
import { SelecionarOrigem } from "@/components/programacao/selecionar-origem"

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

interface CriarProgramacaoViewProps {
    unidadeInicial?: string
    // S-PROG-09 (item 2): com `campanhaId`, o componente deixa de ser "criar do zero" e passa a
    // ser "abrir e continuar um rascunho já gravado" — carrega campanha + atividades do banco,
    // pula Cabeçalho e Origem (já decididos quando o rascunho nasceu) e grava por
    // `PATCH /api/programacao/rascunho` (preserva o id) em vez de `POST /api/programacao/importar`
    // (que apaga e recria — ver Dev Agent Record da story pro motivo).
    campanhaId?: string
    onCancel: () => void
    onSuccess: () => void
}

// Os antigos FormCursos/FormEsportes/FormDiaDia (1 formulário por atividade) e validarAtividade
// (bloqueava "Adicionar" na primeira falha) saíram na S-PROG-01, substituídos pela grade editável
// (`GradeAtividades`) + ficha lateral (`FichaAtividade`) + painel de revisão
// (`calcularProblemas`, lib/programacao/revisao) — o gargalo era a cardinalidade (Mondubim teve
// 126 atividades de ESPORTES num único mês), não o formulário em si. A grade permite editar
// várias linhas incompletas ao mesmo tempo; bloquear o envio é escopo da S-PROG-04 (fluxo de
// aprovação), fora desta story.
// `montarAtividadePayload` — S-PROG-03 (item 1) extraiu para lib/programacao/payload.ts (testável).

// ─── Componente principal ─────────────────────────────────────────────────────

export function CriarProgramacaoView({ unidadeInicial = "", campanhaId, onCancel, onSuccess }: CriarProgramacaoViewProps) {
    const supabase = createClient()
    const modoEdicao = !!campanhaId

    // Step: 1 = Origem (S-PROG-08: Cabeçalho fundido em Origem — unidade/mês de destino vivem
    // aqui, junto da grade de meses anteriores), 2 = Atividades, 3 = Enviar p/ aprovação (Revisão).
    // Em modo edição (campanhaId) começa direto em 2 — Origem já foi decidida quando o rascunho
    // nasceu (S-PROG-09 item 2).
    const [step, setStep] = useState(modoEdicao ? 2 : 1)
    const [carregandoRascunho, setCarregandoRascunho] = useState(modoEdicao)

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

    // Submit — AC4 da S-PROG-02: nunca sobrescreve campanha existente sem confirmação explícita
    // (antes disso, `/api/programacao/importar` apagava sem avisar; corrigido junto nesta story,
    // ver também o próprio endpoint).
    const [salvando, setSalvando] = useState(false)
    const [confirmarSubstituicaoAberto, setConfirmarSubstituicaoAberto] = useState(false)

    // S-PROG-09 (item 4): indicador de alterações não salvas — só faz sentido em modo edição,
    // porque só ali o dado já está gravado no banco antes de abrir a tela ("Nada é gravado até
    // salvar", a frase do protótipo pra criação do zero, deixa de ser verdade aqui). `snapshot`
    // é o JSON das atividades no momento em que a tela abriu (ou da última gravação bem-sucedida)
    // — comparar contra o estado atual é o jeito mais simples de detectar mudança sem replicar
    // um diff campo a campo por atividade.
    const [snapshotAtividades, setSnapshotAtividades] = useState<string>("[]")
    const [confirmarSairAberto, setConfirmarSairAberto] = useState(false)

    const nomeMes = MESES_LISTA.find(m => m.value === mesSel)?.label || ""
    // Em modo edição a tela nasce direto em 2 (Atividades) — "Voltar" a partir dali sai da
    // página, não existe Origem pra revisitar (S-PROG-09 item 2).
    const primeiroStep = modoEdicao ? 2 : 1

    // ── Modo edição (S-PROG-09 item 2): carrega campanha + atividades já gravadas ─────────────
    // Efeito roda uma vez (campanhaId não muda depois de montado — é sempre a mesma página).
    // `supabase`/`onCancel` de propósito fora do array: `supabase` é estável (criado 1x por
    // render, mesmo padrão de todo o resto do componente); incluir `onCancel` re-executaria o
    // fetch a cada render do componente pai (a prop é recriada como closure nova ali).
    useEffect(() => {
        if (!campanhaId) return

        let cancelado = false
        ;(async () => {
            const { data: camp, error: campErr } = await supabase
                .from("campanhas_mensais")
                .select("id, titulo, unidade_cuca, mes, ano, status")
                .eq("id", campanhaId)
                .single()

            if (cancelado) return

            if (campErr || !camp) {
                toast.error("Não foi possível carregar esta programação.")
                onCancel()
                return
            }
            if (camp.status !== "rascunho") {
                // AC5 da S-PROG-09: só rascunho é editável por esta rota — reforça no cliente o
                // que a função `programacao_salvar_rascunho` já recusa no servidor.
                toast.error(`Esta programação não está mais em rascunho (status: ${camp.status}) — não pode ser editada por aqui.`)
                onCancel()
                return
            }

            const { data: linhas, error: atvErr } = await supabase
                .from("atividades_mensais")
                .select("id, categoria, titulo, descricao, local, data_atividade, hora_inicio, hora_fim, metadata")
                .eq("campanha_id", campanhaId)
                .order("categoria", { ascending: true })

            if (cancelado) return

            if (atvErr) {
                toast.error("Não foi possível carregar as atividades desta programação.")
                onCancel()
                return
            }

            setMesSel(camp.mes)
            setAnoSel(camp.ano)
            setUnidadeSel(camp.unidade_cuca)

            const convertidas = (linhas || [])
                .map(l => atividadeFormDeLinhaExistente(l, l.id, { zerar: false }))
                .filter((a): a is AtividadeForm => a !== null)

            if (convertidas.length < (linhas || []).length) {
                toast.error(`${(linhas || []).length - convertidas.length} atividade(s) com categoria inválida não pôde(puderam) ser carregada(s).`)
            }

            setAtividades(convertidas)
            setSnapshotAtividades(JSON.stringify(convertidas))
            setCarregandoRascunho(false)
        })()

        return () => { cancelado = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [campanhaId])

    // "Sujo" só é um conceito de modo edição — na criação do zero, nada gravado ainda existe pra
    // comparar (é sempre a mesma situação que a mensagem "Nada é gravado até salvar" já cobre).
    const alteracoesNaoSalvas = modoEdicao && JSON.stringify(atividades) !== snapshotAtividades

    // Aviso do navegador ao fechar a aba/atualizar com alteração pendente (AC6).
    useEffect(() => {
        if (!alteracoesNaoSalvas) return
        const avisar = (e: BeforeUnloadEvent) => {
            e.preventDefault()
            e.returnValue = ""
        }
        window.addEventListener("beforeunload", avisar)
        return () => window.removeEventListener("beforeunload", avisar)
    }, [alteracoesNaoSalvas])

    // Navegação interna (ArrowLeft do header, "Cancelar"/"Voltar" do primeiro passo): pede
    // confirmação em vez de sair direto quando há alteração pendente (AC6).
    const handleTentarSair = () => {
        if (alteracoesNaoSalvas) {
            setConfirmarSairAberto(true)
            return
        }
        onCancel()
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

    // ── Step 1 (Origem): checa campanha já existente pro par unidade+mês+ano ──────────────────
    // S-PROG-08 (AC3, achado @po): refaz a checagem a cada mudança de unidade OU mês/ano de
    // destino, não só ao avançar de etapa — Origem deixou de ser uma etapa própria (Cabeçalho),
    // então não existe mais um botão "Próximo" pra disparar isso manualmente.
    useEffect(() => {
        if (modoEdicao || step !== 1 || !unidadeSel || !mesSel || !anoSel) return

        let cancelado = false
        setVerificandoDup(true)
        supabase
            .from("campanhas_mensais")
            .select("id, status, titulo")
            .eq("unidade_cuca", unidadeSel)
            .eq("mes", mesSel)
            .eq("ano", anoSel)
            .maybeSingle()
            .then(({ data: existente }) => {
                if (cancelado) return
                setCampanhaExistente(existente || null)
                setVerificandoDup(false)
            })

        return () => { cancelado = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [unidadeSel, mesSel, anoSel, step, modoEdicao])

    // ── Step 1 (Origem, S-PROG-02/08) — zero ou duplicar mês anterior ──────────────────────────
    const handleEscolherZero = () => {
        setAtividades([])
        setStep(2)
    }

    const handleEscolherDuplicar = (duplicadas: AtividadeInterna[]) => {
        setAtividades(duplicadas)
        toast.success(`${duplicadas.length} atividade(s) copiada(s) — revise data, horário e vagas antes de salvar.`)
        setStep(2)
    }

    // ── Submit: grava rascunho já existente, sem apagar a campanha (S-PROG-09 item 2) ──────────
    // Único caminho quando `campanhaId` está presente. Nunca passa por `/api/programacao/importar`
    // (que apaga e recria) — sempre `PATCH /api/programacao/rascunho`, que preserva o id.
    const executarSalvamentoEdicao = async () => {
        setSalvando(true)
        try {
            const titulo = `Programação ${unidadeSel} — ${nomeMes} ${anoSel}`
            const atividadesPayload = atividades.map(a => montarAtividadePayload(a, unidadeSel))

            const res = await fetch("/api/programacao/rascunho", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ campanha_id: campanhaId, titulo, atividades: atividadesPayload }),
            })

            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Erro ao salvar")

            setSnapshotAtividades(JSON.stringify(atividades))
            toast.success("Alterações salvas.")
            onSuccess()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro ao salvar")
        } finally {
            setSalvando(false)
        }
    }

    // ── Submit: salvar como rascunho (criação nova) ────────────────────────────
    // `confirmarSubstituicao` só é `true` depois que o usuário confirma explicitamente no
    // AlertDialog (AC4 da S-PROG-02) — sem isso, o endpoint recusa apagar a campanha existente.
    const executarSalvamento = async (confirmarSubstituicao: boolean) => {
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
                body: JSON.stringify({ campanha: campanhaPayload, atividades: atividadesPayload, confirmarSubstituicao }),
            })

            const data = await res.json()
            if (res.status === 409 && data.conflito) {
                // Servidor detectou campanha existente que o cliente não sabia (corrida entre
                // duas pessoas editando ao mesmo tempo) — mesmo tratamento do AlertDialog local.
                setCampanhaExistente(data.conflito)
                setConfirmarSubstituicaoAberto(true)
                return
            }
            if (!res.ok) throw new Error(data.error || "Erro ao salvar")

            // Aguarda 1.5s para a replicação do Supabase antes de voltar e atualizar
            // (mesmo padrão do import-planilha-modal que usa 3s de delay pelo mesmo motivo)
            setTimeout(() => {
                toast.success("Programação salva como rascunho! Clique em 'Continuar edição' na lista para abrir.")
                onSuccess()
            }, 1500)
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro ao salvar")
        } finally {
            setSalvando(false)
        }
    }

    const handleSalvarRascunhoClick = () => {
        if (atividades.length === 0) {
            toast.error("Adicione pelo menos uma atividade antes de salvar.")
            return
        }
        if (modoEdicao) {
            executarSalvamentoEdicao()
            return
        }
        if (campanhaExistente) {
            setConfirmarSubstituicaoAberto(true)
            return
        }
        executarSalvamento(false)
    }

    // ── Contagem por categoria + painel de revisão (item 5) ────────────────────
    const contagem = atividades.reduce<Record<string, number>>((acc, a) => {
        const cat = a.categoria || "Outros"
        acc[cat] = (acc[cat] || 0) + 1
        return acc
    }, {})
    const problemas: Problema[] = calcularProblemas(atividades)
    const [painelRevisaoAberto, setPainelRevisaoAberto] = useState(false)

    // S-PROG-11 (item 3): painel "Texto enviado ao RAG" (modo desenvolvedor) — desligado por
    // padrão (AC7). `atividadeSelecionadaGrade` vem do callback novo de `GradeAtividades`; não
    // existe estado próprio de seleção aqui, a grade continua dona disso.
    const [modoDesenvolvedor, setModoDesenvolvedor] = useState(false)
    const [atividadeSelecionadaGrade, setAtividadeSelecionadaGrade] = useState<AtividadeInterna | null>(null)
    const payloadRagSelecionado = atividadeSelecionadaGrade
        ? montarAtividadePayload(atividadeSelecionadaGrade, unidadeSel)
        : null

    // S-PROG-09 (item 2): enquanto carrega campanha + atividades do rascunho, não renderiza a
    // tela — evita mostrar o stepper/grade vazios por um instante antes do fetch terminar.
    if (carregandoRascunho) {
        return (
            <div className="flex items-center justify-center py-24">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    return (
        <div className="flex flex-col">
            {/* ── Header de página: mesmo padrão de /programacao/mensal/[id] (voltar com ArrowLeft) ── */}
            <div className="flex items-start gap-3.5 pb-5 border-b border-border">
                <Button variant="ghost" size="icon" onClick={handleTentarSair} className="mt-0.5 shrink-0">
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/30 shadow-[0_0_24px_-6px_var(--primary)]">
                    <Plus className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                    <h1 className="text-xl font-bold tracking-tight">Criar Programação Mensal</h1>
                    <p className="text-sm text-muted-foreground mt-0.5 flex items-center gap-2 flex-wrap">
                        {step >= 2 && nomeMes ? (
                            <Badge variant="outline" className="font-semibold text-primary border-primary/40 bg-primary/5">
                                {nomeMes} {anoSel} · {unidadeSel.replace("Cuca ", "")}
                            </Badge>
                        ) : "Grade editável por categoria — sem formulário por atividade."}
                        {/* S-PROG-09 (item 4): só em modo edição — na criação do zero nada está
                            gravado ainda, "Nada é gravado até salvar" já cobre o caso. */}
                        {modoEdicao && (
                            alteracoesNaoSalvas ? (
                                <Badge className="bg-amber-500/10 text-amber-500 border-amber-500/40 font-semibold">
                                    Alterações não salvas
                                </Badge>
                            ) : (
                                <Badge className="bg-emerald-500/10 text-emerald-500 border-emerald-500/40 font-semibold">
                                    Tudo salvo
                                </Badge>
                            )
                        )}
                    </p>
                </div>
            </div>

            {/* Stepper com linha de progresso conectando as etapas — S-PROG-08 (item 3): 3 passos
                do protótipo, Cabeçalho deixou de existir como etapa própria (fundido em Origem). */}
            <div className="flex items-center py-5 max-w-md">
                {[
                    { n: 1, label: "Origem" },
                    { n: 2, label: "Editar" },
                    { n: 3, label: "Enviar p/ aprovação" },
                ].map(({ n, label }, i, arr) => (
                    <div key={n} className="flex items-center flex-1 last:flex-none">
                        <div className="flex items-center gap-2">
                            <span className={cn(
                                "h-7 w-7 shrink-0 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors",
                                step === n ? "border-primary bg-primary text-primary-foreground" :
                                step > n ? "border-emerald-500 bg-emerald-500 text-white" :
                                "border-border text-muted-foreground"
                            )}>
                                {step > n ? "✓" : n}
                            </span>
                            <span className={cn(
                                "text-sm font-semibold whitespace-nowrap",
                                step === n ? "text-foreground" : step > n ? "text-emerald-500" : "text-muted-foreground"
                            )}>{label}</span>
                        </div>
                        {i < arr.length - 1 && (
                            <div className={cn("h-0.5 flex-1 mx-3 rounded-full transition-colors", step > n ? "bg-emerald-500" : "bg-border")} />
                        )}
                    </div>
                ))}
            </div>

            <div className="pb-8">

                {/* ── STEP 1: Origem — Cabeçalho (unidade/mês de destino) fundido com a grade de
                    meses anteriores (S-PROG-08, item 2), num único passo, como no protótipo. ── */}
                {step === 1 && (
                    <div className="space-y-6 max-w-3xl">
                        <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr_2fr] gap-4 p-4 rounded-xl border border-border bg-muted/20">
                            <div className="space-y-1.5">
                                <Label className="font-semibold">Unidade CUCA *</Label>
                                <Select value={unidadeSel} onValueChange={setUnidadeSel}>
                                    <SelectTrigger className="h-11 text-sm w-full">
                                        <SelectValue placeholder="Selecione a unidade" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {unidadesCuca.map(u => (
                                            <SelectItem key={u} value={u}>{u}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label className="font-semibold">Mês *</Label>
                                <Select value={String(mesSel)} onValueChange={v => setMesSel(Number(v))}>
                                    <SelectTrigger className="h-11 text-sm w-full">
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
                                    className="h-11 text-sm"
                                />
                            </div>
                        </div>

                        {/* Mudar unidade ou mês/ano de destino refaz a checagem de duplicata em
                            tempo real (AC3, achado @po) — não é preciso avançar de etapa pra ver. */}
                        {verificandoDup && (
                            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                                <Loader2 className="h-3 w-3 animate-spin" /> Checando se já existe programação para este mês…
                            </p>
                        )}
                        {!verificandoDup && campanhaExistente && (
                            <div className="flex items-start gap-2.5 p-3.5 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-500 text-sm">
                                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                                <span>
                                    Já existe programação para <strong>{unidadeSel}</strong> em <strong>{nomeMes}/{anoSel}</strong> (status: <em>{campanhaExistente.status}</em>).
                                    Salvar mais adiante criará uma nova versão — a existente será substituída ao confirmar.
                                </span>
                            </div>
                        )}

                        {unidadeSel ? (
                            <SelecionarOrigem
                                unidade={unidadeSel}
                                onEscolherZero={handleEscolherZero}
                                onEscolherDuplicar={handleEscolherDuplicar}
                            />
                        ) : (
                            <p className="text-sm text-muted-foreground text-center py-6 border border-dashed border-border rounded-xl">
                                Selecione a unidade para ver os meses aprovados disponíveis para duplicar.
                            </p>
                        )}
                    </div>
                )}

                {/* ── STEP 2: Atividades (S-PROG-01: grade editável + ficha) ── */}
                {step === 2 && (
                    <div className="space-y-4">
                        {/* Alerta de campanha existente (AC-8) */}
                        {campanhaExistente && (
                            <div className="flex items-start gap-2.5 p-3.5 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-500 text-sm">
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
                                    "w-full text-left text-sm font-semibold px-4 py-3 rounded-xl border flex items-center justify-between transition-colors",
                                    problemas.length > 0
                                        ? "bg-amber-500/10 border-amber-500/40 text-amber-500 hover:bg-amber-500/15"
                                        : "bg-emerald-500/10 border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/15"
                                )}
                            >
                                <span className="flex items-center gap-2">
                                    <AlertCircle className="h-4 w-4" />
                                    {problemas.length > 0 ? `${problemas.length} ponto(s) a revisar` : "Tudo certo para revisar"}
                                </span>
                                <span className="text-xs opacity-70 font-medium">{painelRevisaoAberto ? "ocultar ▲" : "ver ▼"}</span>
                            </button>
                        )}
                        {painelRevisaoAberto && problemas.length > 0 && (
                            <div className="space-y-1 max-h-40 overflow-y-auto border border-amber-500/30 rounded-xl p-3 bg-amber-500/5">
                                {problemas.map((p, i) => (
                                    <p key={i} className="text-xs text-amber-500 flex items-start gap-1.5">
                                        <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" /> {p.mensagem}
                                    </p>
                                ))}
                            </div>
                        )}

                        <GradeAtividades
                            atividades={atividades}
                            onChange={setAtividades}
                            onAbrirFicha={handleAbrirFicha}
                            onLinhaAtivaChange={setAtividadeSelecionadaGrade}
                        />

                        {/* S-PROG-11 (item 3): modo desenvolvedor — desligado por padrão (AC7).
                            Não é enfeite: única forma de conferir, sem abrir o banco, se a grade
                            produz o mesmo texto que a planilha produzia (é o que a S-PROG-10
                            depende). Alimentado por `montarAtividadePayload`, já pronto. */}
                        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/60">
                            <label htmlFor="modo-dev-rag" className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                                <Switch id="modo-dev-rag" checked={modoDesenvolvedor} onCheckedChange={setModoDesenvolvedor} />
                                Modo desenvolvedor — texto enviado ao RAG
                            </label>
                        </div>

                        {modoDesenvolvedor && (
                            <div className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
                                {!payloadRagSelecionado ? (
                                    <p className="text-xs text-muted-foreground">
                                        Selecione uma linha na grade pra ver o texto que ela envia ao RAG.
                                    </p>
                                ) : (
                                    <>
                                        <div className="space-y-1.5">
                                            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Texto enviado ao RAG (descrição)</p>
                                            <pre className="text-[11px] font-mono whitespace-pre-wrap break-words bg-background border border-border rounded-lg p-3 max-h-48 overflow-y-auto">
                                                {payloadRagSelecionado.descricao}
                                            </pre>
                                        </div>
                                        <div className="space-y-1.5">
                                            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Registro gravado (metadata)</p>
                                            <pre className="text-[11px] font-mono whitespace-pre-wrap break-words bg-background border border-border rounded-lg p-3 max-h-48 overflow-y-auto">
                                                {JSON.stringify(payloadRagSelecionado.metadata, null, 2)}
                                            </pre>
                                        </div>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* ── STEP 3: Enviar p/ aprovação (Revisão) ── */}
                {step === 3 && (
                    <div className="space-y-5 max-w-2xl">
                        <div className="p-5 rounded-xl border border-border bg-card/60">
                            <p className="text-base font-bold mb-1">Resumo da Programação</p>
                            <p className="text-sm text-muted-foreground">
                                <strong className="text-foreground">{unidadeSel}</strong> · {nomeMes} {anoSel} · {atividades.length} atividades
                            </p>
                        </div>

                        <div className="space-y-2">
                            {Object.entries(contagem).map(([cat, qtd]) => (
                                <div key={cat} className="flex items-center justify-between p-3.5 rounded-xl border border-border bg-background">
                                    <div className="flex items-center gap-2.5">
                                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                        <span className="text-sm font-semibold">{cat}</span>
                                    </div>
                                    <Badge variant="secondary">{qtd} {qtd === 1 ? "atividade" : "atividades"}</Badge>
                                </div>
                            ))}
                        </div>

                        {problemas.length > 0 && (
                            <div className="space-y-1.5">
                                <p className="text-sm font-semibold text-amber-500 flex items-center gap-1.5">
                                    <AlertCircle className="h-4 w-4" /> {problemas.length} ponto(s) a revisar — pode salvar como rascunho e corrigir depois
                                </p>
                                <div className="space-y-1 max-h-40 overflow-y-auto border border-amber-500/30 rounded-xl p-3 bg-amber-500/5">
                                    {problemas.map((p, i) => (
                                        <p key={i} className="text-xs text-amber-500">{p.mensagem}</p>
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

            {/* ── Footer de navegação: fixo no rodapé da tela — não exige rolar a página inteira
                pra achar o botão, mesmo com 126 linhas na grade ── */}
            <div className="sticky bottom-0 -mx-6 px-6 py-4 border-t border-border bg-background/95 backdrop-blur-sm flex justify-between gap-2">
                <Button variant="ghost" size="lg" onClick={step === primeiroStep ? handleTentarSair : () => setStep(s => s - 1)} className="gap-1.5">
                    {step === primeiroStep ? "Cancelar" : <><ChevronLeft className="h-4 w-4" /> Voltar</>}
                </Button>

                <div className="flex gap-2">
                    {/* Step 1 (Origem) não tem botão "Próximo" aqui — escolher um card ou
                        "Começar do zero" já avança sozinho (ver SelecionarOrigem). */}
                    {step === 2 && (
                        <Button size="lg" onClick={() => setStep(3)} className="gap-1.5">
                            {atividades.length === 0 ? "Revisar" : "Próximo"}
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    )}
                    {step === 3 && (
                        <Button
                            size="lg"
                            onClick={handleSalvarRascunhoClick}
                            disabled={salvando || atividades.length === 0}
                            className="bg-primary text-primary-foreground gap-1.5"
                        >
                            {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            Salvar como Rascunho
                        </Button>
                    )}
                </div>
            </div>

            {/* AC4 da S-PROG-02: confirmação explícita antes de substituir campanha existente —
                nunca apaga sem esse passo (endpoint também recusa sem `confirmarSubstituicao`). */}
            <AlertDialog open={confirmarSubstituicaoAberto} onOpenChange={setConfirmarSubstituicaoAberto}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Substituir programação existente?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Já existe uma programação para <strong>{unidadeSel}</strong> em <strong>{nomeMes}/{anoSel}</strong> (status:{" "}
                            <em>{campanhaExistente?.status}</em>). Salvar agora vai <strong>apagar a existente</strong> e gravar esta como nova versão
                            (rascunho). Essa ação não pode ser desfeita.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => { setConfirmarSubstituicaoAberto(false); executarSalvamento(true) }}>
                            Sim, substituir
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            {/* S-PROG-09 (item 4, AC6): sair com alteração pendente pede confirmação — o dado já
                está gravado no banco (é um rascunho reaberto), diferente da criação do zero. */}
            <AlertDialog open={confirmarSairAberto} onOpenChange={setConfirmarSairAberto}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Sair sem salvar as alterações?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Você fez alterações nesta programação que ainda não foram salvas. Saindo agora, elas se perdem —
                            o que está gravado no banco continua como estava antes de abrir esta tela.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Continuar editando</AlertDialogCancel>
                        <AlertDialogAction onClick={() => { setConfirmarSairAberto(false); onCancel() }}>
                            Sair sem salvar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
