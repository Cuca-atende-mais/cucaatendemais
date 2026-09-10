"use client"

// SQS-44 / S-PROG-01: página dedicada de criação guiada da Programação Mensal.
// Era um modal (Dialog) — o Junior apontou que ficava "tela dentro de tela", pequeno demais pra
// grade editável (chamou /frontend-design + /ui-ux-pro-max pra corrigir). Vira página de verdade
// em vez de um Dialog, seguindo o mesmo padrão já usado por /programacao/mensal/[id] (voltar com
// ArrowLeft, header de página, sem overlay). Coexiste com o upload de planilha — não substitui.

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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

export function CriarProgramacaoView({ unidadeInicial = "", onCancel, onSuccess }: CriarProgramacaoViewProps) {
    const supabase = createClient()

    // Step: 1 = Cabeçalho, 2 = Origem (S-PROG-02), 3 = Atividades, 4 = Revisão
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

    // Submit — AC4 da S-PROG-02: nunca sobrescreve campanha existente sem confirmação explícita
    // (antes disso, `/api/programacao/importar` apagava sem avisar; corrigido junto nesta story,
    // ver também o próprio endpoint).
    const [salvando, setSalvando] = useState(false)
    const [confirmarSubstituicaoAberto, setConfirmarSubstituicaoAberto] = useState(false)

    const nomeMes = MESES_LISTA.find(m => m.value === mesSel)?.label || ""

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

    // ── Step 2: origem (S-PROG-02) — zero ou duplicar mês anterior ─────────────
    const handleEscolherZero = () => {
        setAtividades([])
        setStep(3)
    }

    const handleEscolherDuplicar = (duplicadas: AtividadeInterna[]) => {
        setAtividades(duplicadas)
        toast.success(`${duplicadas.length} atividade(s) copiada(s) — revise data, horário e vagas antes de salvar.`)
        setStep(3)
    }

    // ── Submit: salvar como rascunho ───────────────────────────────────────────
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
                toast.success("Programação salva como rascunho! Clique em 'Ver Atividades' para abrir.")
                onSuccess()
            }, 1500)
        } catch (e: any) {
            toast.error(e.message || "Erro ao salvar")
        } finally {
            setSalvando(false)
        }
    }

    const handleSalvarRascunhoClick = () => {
        if (atividades.length === 0) {
            toast.error("Adicione pelo menos uma atividade antes de salvar.")
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

    return (
        <div className="flex flex-col">
            {/* ── Header de página: mesmo padrão de /programacao/mensal/[id] (voltar com ArrowLeft) ── */}
            <div className="flex items-start gap-3.5 pb-5 border-b border-border">
                <Button variant="ghost" size="icon" onClick={onCancel} className="mt-0.5 shrink-0">
                    <ArrowLeft className="h-5 w-5" />
                </Button>
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/15 ring-1 ring-primary/30 shadow-[0_0_24px_-6px_var(--primary)]">
                    <Plus className="h-6 w-6 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                    <h1 className="text-xl font-bold tracking-tight">Criar Programação Mensal</h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        {step >= 2 && nomeMes ? (
                            <Badge variant="outline" className="font-semibold text-primary border-primary/40 bg-primary/5">
                                {nomeMes} {anoSel} · {unidadeSel.replace("Cuca ", "")}
                            </Badge>
                        ) : "Grade editável por categoria — sem formulário por atividade."}
                    </p>
                </div>
            </div>

            {/* Stepper com linha de progresso conectando as etapas */}
            <div className="flex items-center py-5 max-w-md">
                {[
                    { n: 1, label: "Cabeçalho" },
                    { n: 2, label: "Origem" },
                    { n: 3, label: "Atividades" },
                    { n: 4, label: "Revisão" },
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

                {/* ── STEP 1: Cabeçalho ── */}
                {step === 1 && (
                    <div className="space-y-6 max-w-xl">
                        {/* Destaque visual: Mês e Ano são a identidade */}
                        <div className="p-5 rounded-2xl border-2 border-primary/40 bg-primary/5">
                            <p className="text-xs font-bold text-primary mb-4 uppercase tracking-wide">
                                Identidade da Programação — Mês de Referência
                            </p>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="space-y-1.5">
                                    <Label className="font-semibold">Mês *</Label>
                                    <Select value={String(mesSel)} onValueChange={v => setMesSel(Number(v))}>
                                        <SelectTrigger className="border-primary/40 focus:ring-primary h-11 text-sm w-full">
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
                                        className="border-primary/40 focus-visible:ring-primary h-11 text-sm"
                                    />
                                </div>
                            </div>
                        </div>

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

                        {unidadeSel && mesSel && anoSel && (
                            <p className="text-sm text-muted-foreground bg-muted/50 rounded-xl p-4 border">
                                Título gerado automaticamente: <strong className="text-foreground">&quot;Programação {unidadeSel} — {nomeMes} {anoSel}&quot;</strong>
                            </p>
                        )}
                    </div>
                )}

                {/* ── STEP 2: Origem (S-PROG-02) — zero ou duplicar mês anterior ── */}
                {step === 2 && (
                    <SelecionarOrigem
                        unidade={unidadeSel}
                        onEscolherZero={handleEscolherZero}
                        onEscolherDuplicar={handleEscolherDuplicar}
                    />
                )}

                {/* ── STEP 3: Atividades (S-PROG-01: grade editável + ficha) ── */}
                {step === 3 && (
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

                        <GradeAtividades atividades={atividades} onChange={setAtividades} onAbrirFicha={handleAbrirFicha} />
                    </div>
                )}

                {/* ── STEP 4: Revisão ── */}
                {step === 4 && (
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
                <Button variant="ghost" size="lg" onClick={step === 1 ? onCancel : () => setStep(s => s - 1)} className="gap-1.5">
                    {step === 1 ? "Cancelar" : <><ChevronLeft className="h-4 w-4" /> Voltar</>}
                </Button>

                <div className="flex gap-2">
                    {step === 1 && (
                        <Button size="lg" onClick={handleAvancarStep1} disabled={verificandoDup} className="gap-1.5">
                            {verificandoDup ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                            Próximo
                            {!verificandoDup && <ChevronRight className="h-4 w-4" />}
                        </Button>
                    )}
                    {/* Step 2 (Origem) não tem botão "Próximo" aqui — escolher um card ou
                        "Começar do zero" já avança sozinho (ver SelecionarOrigem). */}
                    {step === 3 && (
                        <Button size="lg" onClick={() => setStep(4)} className="gap-1.5">
                            {atividades.length === 0 ? "Revisar" : "Próximo"}
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    )}
                    {step === 4 && (
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
        </div>
    )
}
