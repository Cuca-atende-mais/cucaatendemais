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
import { separarLinhasParaDuplicar, type ChecarPermissao } from "@/lib/programacao/permissoes-categoria"

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
    // S-PROG-08 (item 2): antes, campanha com categoria fora da lista fechada (AC2) era
    // simplesmente omitida da grade — o mês desaparecia sem explicação. O protótipo prevê um
    // 3º estado do card (`.mo.off`, desabilitado, com selo "Importação com falha —
    // indisponível") em vez de sumir; mais claro pra quem está escolhendo a origem.
    indisponivel: boolean
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
    // S-PROG-13: `foraDoPerfil` = linhas da origem de categorias em que a pessoa não pode criar.
    onEscolherDuplicar: (atividades: AtividadeForm[], foraDoPerfil: number) => void
    podeComecarDoZero?: boolean
    podeDuplicar?: boolean
    checar?: ChecarPermissao
}

export function SelecionarOrigem({
    unidade, onEscolherZero, onEscolherDuplicar, podeComecarDoZero = true, podeDuplicar = true, checar = () => true,
}: SelecionarOrigemProps) {
    const [carregando, setCarregando] = useState(true)
    const [campanhas, setCampanhas] = useState<CampanhaOrigem[]>([])
    const [selecionada, setSelecionada] = useState<string | null>(null)

    useEffect(() => {
        let cancelado = false
        const supabase = createClient()

        async function carregar() {
            setCarregando(true)
            // Achado do @qa (S-PROG-08, 2026-09-11): trocar de unidade sem resetar `selecionada`
            // deixava "Duplicar e continuar" habilitado apontando pra um id de outra unidade, que
            // não existe na lista recarregada — clique virava no-op silencioso. A seleção só faz
            // sentido dentro da mesma unidade que a gerou.
            setSelecionada(null)
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

            const resultados = await Promise.all(base.map(async (c): Promise<CampanhaOrigem> => {
                const { data: linhas } = await supabase
                    .from("atividades_mensais")
                    .select("categoria, titulo, descricao, local, metadata")
                    .eq("campanha_id", c.id)

                const todasLinhas = (linhas || []) as LinhaOrigemDuplicacao[]
                // AC2/AC5: campanha com QUALQUER categoria fora da lista fechada (ex.: "ESPORTE",
                // singular — achado real do Jangurussu/jun-2026) ou sem nenhuma atividade não pode
                // ser escolhida como origem — mas aparece desabilitada, não some da grade
                // (S-PROG-08 item 2, ver comentário de `indisponivel` acima).
                const indisponivel = todasLinhas.length === 0 || todasLinhas.some(l => !categoriaValida(l.categoria))

                const contagem = todasLinhas.reduce<Record<string, number>>((acc, l) => {
                    acc[l.categoria] = (acc[l.categoria] || 0) + 1
                    return acc
                }, {})

                return {
                    id: c.id, mes: c.mes, ano: c.ano, contagem, indisponivel,
                    selo: calcularSeloQualidade(todasLinhas), linhas: todasLinhas,
                }
            }))

            if (!cancelado) {
                setCampanhas(resultados)
                setCarregando(false)
            }
        }

        carregar()
        return () => { cancelado = true }
    }, [unidade])

    const handleDuplicar = () => {
        const origem = campanhas.find(c => c.id === selecionada)
        if (!origem || origem.indisponivel || !podeDuplicar) return
        const { copiadas, foraDoPerfil } = separarLinhasParaDuplicar(origem.linhas, checar)
        const formularios = copiadas
            .map(l => atividadeFormDeLinhaExistente(l, novoTempId()))
            .filter((a): a is AtividadeForm => a !== null)
        onEscolherDuplicar(formularios, foraDoPerfil)
    }

    return (
        <div className="space-y-4 max-w-3xl">
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

            {/* Grade de meses anteriores (S-PROG-08 item 2) — fiel ao protótipo
                (`.grid3`/`.mo`): `repeat(auto-fit, minmax(210px, 1fr))`. */}
            {!carregando && campanhas.length > 0 && (
                <div className="grid grid-cols-[repeat(auto-fit,minmax(210px,1fr))] gap-3">
                    {campanhas.map(c => {
                        const ativa = selecionada === c.id
                        return (
                            // `role="button"` em vez de `<button>` real — o card contém o ícone de
                            // ajuda do selo (também interativo), e `<button>` dentro de `<button>`
                            // é HTML inválido (achado de acessibilidade, corrigido antes do PASS).
                            // Card indisponível (AC5): sem role/tabIndex/onClick — não é alvo de
                            // navegação por teclado nem de clique, mesmo estilo `.mo.off` do protótipo.
                            <div
                                key={c.id}
                                role={c.indisponivel ? undefined : "button"}
                                tabIndex={c.indisponivel ? undefined : 0}
                                onClick={c.indisponivel ? undefined : () => setSelecionada(c.id)}
                                onKeyDown={c.indisponivel ? undefined : (e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSelecionada(c.id) } })}
                                className={cn(
                                    "text-left p-3.5 rounded-[var(--radius)] border-2 transition-colors space-y-2",
                                    c.indisponivel
                                        ? "opacity-50 pointer-events-none bg-muted border-border"
                                        : cn(
                                            "cursor-pointer",
                                            ativa
                                                ? "border-primary shadow-[0_0_0_3px_color-mix(in_oklch,var(--primary)_18%,transparent)]"
                                                : "border-border hover:border-primary/60",
                                        ),
                                )}
                            >
                                <div className="flex items-center justify-between gap-2">
                                    <p className="font-bold text-[15px]">{NOMES_MES[c.mes - 1]} {c.ano}</p>
                                    {!c.indisponivel && (
                                        <span onClick={e => e.stopPropagation()}>
                                            <AjudaCampo campo="selo_qualidade" />
                                        </span>
                                    )}
                                </div>
                                <p className="text-[11.5px] text-muted-foreground leading-relaxed">
                                    {c.indisponivel
                                        ? "Importação com dado fora do padrão — não pode ser usado como origem."
                                        : Object.entries(c.contagem).map(([cat, qtd]) => `${qtd} ${cat.toLowerCase()}`).join(" · ")}
                                </p>
                                <Badge variant="outline" className={cn(
                                    "text-[11px] font-bold gap-1",
                                    c.indisponivel ? "border-border bg-muted text-muted-foreground" : corSelo(c.selo.percentualProblemas),
                                )}>
                                    {c.indisponivel ? null : c.selo.percentualProblemas === 0
                                        ? <CheckCircle2 className="h-3 w-3" />
                                        : <AlertCircle className="h-3 w-3" />}
                                    {c.indisponivel
                                        ? "Importação com falha — indisponível"
                                        : c.selo.percentualProblemas === 0 ? "Dados conferidos" : `${c.selo.percentualProblemas}% precisam revisão`}
                                </Badge>
                            </div>
                        )
                    })}
                </div>
            )}

            {/* Legenda fixa abaixo da grade — texto literal do protótipo (S-PROG-08 item 2). */}
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl border border-border bg-muted/30 text-xs text-muted-foreground">
                <AjudaCampo campo="duplicar_origem" />
                <span>
                    Vem copiado: modalidade, professor, turma, faixa etária, pré-requisitos, dias, local e ementa.{" "}
                    <strong className="text-foreground">Vem em branco: data, horário e vagas.</strong>{" "}
                    Textos de exemplo detectados na origem (ex.: &quot;Nome Sobrenome&quot;) também não são copiados.
                </span>
            </div>

            {/* Rodapé — "Começar do zero" (secundária, à esquerda) · "Duplicar e continuar"
                (primária, à direita, desabilitada até escolher um mês), como no protótipo. */}
            <div className="flex items-center justify-between gap-2 pt-1">
                {podeComecarDoZero ? (
                    <Button type="button" variant="outline" size="lg" className="gap-1.5" onClick={onEscolherZero}>
                        <Sparkles className="h-4 w-4" /> Começar do zero
                    </Button>
                ) : <span />}
                {podeDuplicar && (
                    <Button size="lg" className="gap-1.5" disabled={!selecionada} onClick={handleDuplicar}>
                        <Copy className="h-4 w-4" /> Duplicar e continuar
                    </Button>
                )}
            </div>
        </div>
    )
}
