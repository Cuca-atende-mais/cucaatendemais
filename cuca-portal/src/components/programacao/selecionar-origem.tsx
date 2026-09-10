"use client"

// S-PROG-02 (item 1): seletor de mês de origem, com selo de qualidade calculado na hora — passo
// novo entre Cabeçalho e Atividades. "Começar do zero" sempre disponível; duplicar um mês exige
// escolher um card. Medição em produção (atividades_mensais, 2.250 registros): modalidades de
// ESPORTES que reaparecem em 2+ meses são 89%-100% por unidade — redigitar é ~95% trabalho
// redundante, por isso a junta técnica preferia a planilha antes desta story.

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AlertCircle, CheckCircle2, Copy, Loader2, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"
import { AtividadeForm } from "@/lib/programacao/tipos"
import { atividadeFormDeLinhaExistente, calcularSeloQualidade, categoriaValida, LinhaOrigemDuplicacao, SeloQualidade } from "@/lib/programacao/duplicar"
import { AjudaCampo } from "@/components/programacao/ajuda-campo"

const NOMES_MES = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
]

interface CampanhaOrigem {
    id: string
    mes: number
    ano: number
    contagem: Record<string, number>
    selo: SeloQualidade
    linhas: LinhaOrigemDuplicacao[]
}

function novoTempId(): string {
    return Math.random().toString(36).slice(2)
}

function corSelo(pct: number): string {
    if (pct === 0) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-500"
    if (pct <= 30) return "border-amber-500/40 bg-amber-500/10 text-amber-500"
    return "border-red-500/40 bg-red-500/10 text-red-500"
}

interface SelecionarOrigemProps {
    unidade: string
    onEscolherZero: () => void
    onEscolherDuplicar: (atividades: AtividadeForm[]) => void
}

export function SelecionarOrigem({ unidade, onEscolherZero, onEscolherDuplicar }: SelecionarOrigemProps) {
    const [carregando, setCarregando] = useState(true)
    const [campanhas, setCampanhas] = useState<CampanhaOrigem[]>([])
    const [selecionada, setSelecionada] = useState<string | null>(null)

    useEffect(() => {
        let cancelado = false
        const supabase = createClient()

        async function carregar() {
            setCarregando(true)
            // Só campanhas aprovadas fazem sentido como origem — rascunho é trabalho em
            // andamento, não uma referência "que já funcionou" pra copiar.
            const { data: base } = await supabase
                .from("campanhas_mensais")
                .select("id, mes, ano")
                .eq("unidade_cuca", unidade)
                .eq("status", "aprovado")
                .order("ano", { ascending: false })
                .order("mes", { ascending: false })
                .limit(6)

            if (!base || base.length === 0) {
                if (!cancelado) { setCampanhas([]); setCarregando(false) }
                return
            }

            const resultados = await Promise.all(base.map(async (c): Promise<CampanhaOrigem | null> => {
                const { data: linhas } = await supabase
                    .from("atividades_mensais")
                    .select("categoria, titulo, descricao, local, metadata")
                    .eq("campanha_id", c.id)

                const todasLinhas = (linhas || []) as LinhaOrigemDuplicacao[]
                // AC2: campanha com QUALQUER categoria fora da lista (ex.: "ESPORTE", singular —
                // achado real do Jangurussu/jun-2026) não pode aparecer como origem.
                if (todasLinhas.some(l => !categoriaValida(l.categoria))) return null

                const contagem = todasLinhas.reduce<Record<string, number>>((acc, l) => {
                    acc[l.categoria] = (acc[l.categoria] || 0) + 1
                    return acc
                }, {})

                return { id: c.id, mes: c.mes, ano: c.ano, contagem, selo: calcularSeloQualidade(todasLinhas), linhas: todasLinhas }
            }))

            if (!cancelado) {
                setCampanhas(resultados.filter((c): c is CampanhaOrigem => c !== null))
                setCarregando(false)
            }
        }

        carregar()
        return () => { cancelado = true }
    }, [unidade])

    const handleDuplicar = () => {
        const origem = campanhas.find(c => c.id === selecionada)
        if (!origem) return
        const formularios = origem.linhas
            .map(l => atividadeFormDeLinhaExistente(l, novoTempId()))
            .filter((a): a is AtividadeForm => a !== null)
        onEscolherDuplicar(formularios)
    }

    return (
        <div className="space-y-5 max-w-3xl">
            <div className="flex items-start gap-2.5 p-4 rounded-xl border border-border bg-muted/30 text-sm text-muted-foreground">
                <AjudaCampo campo="duplicar_origem" />
                <span>
                    Escolha o mês que serve de base. Vem copiado tudo que se repete (modalidade, professor, turma,
                    faixa etária, pré-requisitos, ementa, local); <strong className="text-foreground">data, horário e vagas voltam em branco</strong> para
                    você preencher. Textos de exemplo detectados na origem (ex.: &quot;Nome Sobrenome&quot;) também
                    não são copiados.
                </span>
            </div>

            <button
                type="button"
                onClick={onEscolherZero}
                className="w-full flex items-center gap-3 p-4 rounded-xl border-2 border-dashed border-border hover:border-primary/50 hover:bg-primary/5 transition-colors text-left"
            >
                <Sparkles className="h-5 w-5 text-primary shrink-0" />
                <div>
                    <p className="font-semibold text-sm">Começar do zero</p>
                    <p className="text-xs text-muted-foreground">Sem nenhuma atividade pré-preenchida.</p>
                </div>
            </button>

            {carregando && (
                <div className="flex items-center gap-2 justify-center py-10 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Carregando meses anteriores…
                </div>
            )}

            {!carregando && campanhas.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6 border border-dashed border-border rounded-xl">
                    Nenhum mês aprovado ainda para {unidade} — comece do zero.
                </p>
            )}

            {!carregando && campanhas.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {campanhas.map(c => {
                        const ativa = selecionada === c.id
                        return (
                            // `role="button"` em vez de `<button>` real — o card contém o ícone de
                            // ajuda do selo (também interativo), e `<button>` dentro de `<button>`
                            // é HTML inválido (achado de acessibilidade, corrigido antes do PASS).
                            <div
                                key={c.id}
                                role="button"
                                tabIndex={0}
                                onClick={() => setSelecionada(c.id)}
                                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelecionada(c.id) } }}
                                className={cn(
                                    "text-left p-4 rounded-xl border-2 transition-colors space-y-2.5 cursor-pointer",
                                    ativa ? "border-primary bg-primary/5 shadow-[0_0_0_3px_var(--primary)]/10" : "border-border hover:border-primary/40"
                                )}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <p className="font-bold text-sm">{NOMES_MES[c.mes - 1]} {c.ano}</p>
                                    <span className="flex items-center gap-1 shrink-0">
                                        <Badge variant="outline" className={cn("text-[11px] font-bold gap-1", corSelo(c.selo.percentualProblemas))}>
                                            {c.selo.percentualProblemas === 0
                                                ? <CheckCircle2 className="h-3 w-3" />
                                                : <AlertCircle className="h-3 w-3" />}
                                            {c.selo.percentualProblemas === 0 ? "Dados conferidos" : `${c.selo.percentualProblemas}% precisam revisão`}
                                        </Badge>
                                        <span onClick={e => e.stopPropagation()}>
                                            <AjudaCampo campo="selo_qualidade" />
                                        </span>
                                    </span>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    {Object.entries(c.contagem).map(([cat, qtd]) => `${qtd} ${cat.toLowerCase()}`).join(" · ")}
                                </p>
                            </div>
                        )
                    })}
                </div>
            )}

            <div className="flex justify-end">
                <Button size="lg" className="gap-1.5" disabled={!selecionada} onClick={handleDuplicar}>
                    <Copy className="h-4 w-4" /> Duplicar e continuar
                </Button>
            </div>
        </div>
    )
}
