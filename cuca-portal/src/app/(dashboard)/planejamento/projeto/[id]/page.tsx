"use client"

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useParams, useRouter } from "next/navigation"
import { AlertTriangle, ArrowLeft, FileDown, Loader2, Lock, Pencil, Presentation } from "lucide-react"
import Link from "next/link"
import toast from "react-hot-toast"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/lib/auth/user-provider"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Aviso } from "@/components/planejamento/projeto-form"
import { ExcluirProjeto } from "@/components/planejamento/excluir-projeto"
import { SeletorStatus } from "@/components/planejamento/seletor-status"
import { FaixaCorrecoes, SecaoAcompanhamento, ValidacaoTopo } from "@/components/planejamento/acompanhamento"
import { exportarFichaPdf } from "@/components/planejamento/exportar-pdf"
import { PLA_ACOMP, PLA_APRES, PLA_PROJ } from "@/lib/rbac/catalogo-planejamento"
import { carregarAcompanhamento, type Acompanhamento } from "@/lib/planejamento/acompanhamento-dados"
import {
    SECOES, bloco2026Visivel, camposDaSituacao, formatarReais, mostrarSeloFichaEmConstrucao, rotuloCategoria,
    rotuloFrequencia, rotuloSituacao, rotuloTipo, secoesVisiveis, totalOrcamento, numeroParaTextoBR,
    type IdSecao, type LinhaOrcamento, type StatusProjeto,
} from "@/lib/planejamento/projeto"
import {
    carregarProjeto, carregarSetores, carregarUnidades, dataCurta, dataHoraFortaleza,
    type ProjetoCarregado, type Setor, type Unidade,
} from "@/lib/planejamento/projeto-dados"

// S-PLA-02 (AC12): página do projeto, só leitura. Fora do escopo do setor, inexistente ou excluído
// (S-PLA-03): "Projeto não encontrado", sem revelar que existe (a RLS não devolve a linha).
// S-PLA-03: seletor de status no topo (AC11 a AC13) e botão Excluir (AC9).
// S-PLA-04: com `pla_acomp_ver`, faixa de correções e validação no topo e a seção Acompanhamento
// abaixo da ficha. Sem ela, a página fica como na S-PLA-02/03.
// S-PLA-05: "Ver slides" (`pla_slides_ver`; com a ficha parcial a página dos slides mostra o alerta)
// e "Exportar ficha (PDF)" (`pla_ficha_pdf`, sai com a ficha parcial ou final).

type Estado = { fase: "carregando" } | { fase: "nao_encontrado" } | { fase: "erro"; mensagem: string } | { fase: "pronto"; projeto: ProjetoCarregado }

export default function ProjetoPage() {
    const params = useParams()
    const id = params.id as string
    const router = useRouter()
    const supabase = useMemo(() => createClient(), [])
    const { loading: carregandoUsuario, hasPermission } = useUser()
    const podeVer = hasPermission(PLA_PROJ.ver, "read")
    const podeEditar = hasPermission(PLA_PROJ.editar, "read")
    const podeExcluir = hasPermission(PLA_PROJ.excluir, "read")
    const podeAcompanhar = hasPermission(PLA_ACOMP.ver, "read")
    const podeVerSlides = hasPermission(PLA_APRES.slidesVer, "read")
    const podeFichaPdf = hasPermission(PLA_APRES.fichaPdf, "read")
    const [exportandoFicha, setExportandoFicha] = useState(false)

    const [estado, setEstado] = useState<Estado>({ fase: "carregando" })
    const [setores, setSetores] = useState<Setor[]>([])
    const [unidades, setUnidades] = useState<Unidade[]>([])
    const [acomp, setAcomp] = useState<Acompanhamento | null>(null)
    const [erroAcomp, setErroAcomp] = useState<string | null>(null)
    const [versaoHistorico, setVersaoHistorico] = useState(0)

    useEffect(() => {
        if (carregandoUsuario || !podeVer) return
        let cancelado = false
        ;(async () => {
            try {
                const [p, s, u] = await Promise.all([carregarProjeto(supabase, id), carregarSetores(supabase), carregarUnidades(supabase)])
                if (cancelado) return
                setSetores(s)
                setUnidades(u)
                setEstado(p ? { fase: "pronto", projeto: p } : { fase: "nao_encontrado" })
            } catch (e) {
                if (!cancelado) setEstado({ fase: "erro", mensagem: e instanceof Error ? e.message : String(e) })
            }
        })()
        return () => { cancelado = true }
    }, [carregandoUsuario, podeVer, id, supabase])

    // Acompanhamento (S-PLA-04): carregado à parte, depois que o projeto abriu, só com `pla_acomp_ver`.
    const projetoPronto = estado.fase === "pronto"
    const recarregarAcomp = useCallback(async () => {
        try {
            setAcomp(await carregarAcompanhamento(supabase, id))
            setErroAcomp(null)
        } catch (e) {
            setErroAcomp(e instanceof Error ? e.message : String(e))
        }
        setVersaoHistorico(v => v + 1)
    }, [supabase, id])
    useEffect(() => {
        if (!projetoPronto || !podeAcompanhar) return
        let cancelado = false
        carregarAcompanhamento(supabase, id)
            .then(a => { if (!cancelado) { setAcomp(a); setErroAcomp(null) } })
            .catch(e => { if (!cancelado) setErroAcomp(e instanceof Error ? e.message : String(e)) })
        return () => { cancelado = true }
    }, [projetoPronto, podeAcompanhar, supabase, id])

    const voltar = <Button variant="outline" onClick={() => router.push("/planejamento")}><ArrowLeft className="mr-1 h-4 w-4" /> Voltar para Projetos</Button>

    if (carregandoUsuario) return <Skeleton className="h-96 w-full" />
    if (!podeVer) {
        return <Aviso icone={<Lock className="h-8 w-8 text-muted-foreground" />} titulo="Você não tem acesso aos projetos do Planejamento." texto="Peça a liberação no seu perfil de acesso." />
    }
    if (estado.fase === "carregando") return <Skeleton className="h-96 w-full" />
    if (estado.fase === "nao_encontrado") return <Aviso titulo="Projeto não encontrado" acao={voltar} />
    if (estado.fase === "erro") return <Aviso icone={<AlertTriangle className="h-8 w-8 text-rose-600" />} titulo="Não foi possível abrir o projeto." texto={estado.mensagem} acao={voltar} />

    const { linha: p, filhas } = estado.projeto
    const aoAlterarStatus = (novo: StatusProjeto) => {
        setEstado(e => e.fase === "pronto"
            ? { fase: "pronto", projeto: { ...e.projeto, linha: { ...e.projeto.linha, status: novo } } }
            : e)
        setVersaoHistorico(v => v + 1)
    }
    const setor = setores.find(s => s.id === p.setor_id)
    const exportarFicha = async () => {
        setExportandoFicha(true)
        try {
            const nome = await exportarFichaPdf({ projeto: p, filhas, setor: setor ? { id: setor.id, nome: setor.nome, cor: setor.cor } : null, unidades })
            toast.success(`Arquivo ${nome} gerado`)
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro ao gerar o PDF.")
        } finally {
            setExportandoFicha(false)
        }
    }
    const situacao = p.situacao_2026 ?? ""
    const visiveis = secoesVisiveis(situacao)
    const sit = camposDaSituacao(situacao)
    const nomesUnidades = (p.locais_unidades ?? []).map(uid => unidades.find(u => u.id === uid)?.nome).filter(Boolean) as string[]
    const local = [...nomesUnidades, ...(p.local_outro && p.local_outro_texto ? [p.local_outro_texto] : [])]
    const periodo = p.periodo_ano_todo ? "Ano todo" : [p.data_inicio && dataCurta(p.data_inicio), p.data_fim && dataCurta(p.data_fim)].filter(Boolean).join(" a ")
    const faixa = p.faixa_etaria_min !== null || p.faixa_etaria_max !== null
        ? `${p.faixa_etaria_min ?? "?"} a ${p.faixa_etaria_max ?? "?"} anos` : null
    const frequencia = p.frequencia === "outra" ? (p.frequencia_outra || "Outra") : rotuloFrequencia(p.frequencia)
    const orcamento: LinhaOrcamento[] = filhas.orcamento.map(o => ({
        item: o.item ?? "", categoria: o.categoria ?? "",
        quantidade: numeroParaTextoBR(o.quantidade), valor_unitario: numeroParaTextoBR(o.valor_unitario, 2),
    }))

    const conteudo: Record<IdSecao, ReactNode[]> = {
        1: [
            item("Responsável pelo projeto", p.responsavel_nome),
            item("Contato do responsável", p.responsavel_contato),
        ],
        2: [
            item("Situação", rotuloSituacao(p.situacao_2026)),
            sit.mudancas ? item("O que muda em relação a 2026", p.mudancas_2026) : null,
            sit.justificativa ? item(sit.rotuloJustificativa, p.justificativa_2026) : null,
        ],
        3: [
            item("Objetivo geral", p.objetivo_geral),
            filhas.objetivos.length > 0 ? (
                <Item key="obj" rotulo="Objetivos específicos">
                    <ul className="list-disc pl-5">{filhas.objetivos.map(o => <li key={o.ordem}>{o.texto}</li>)}</ul>
                </Item>
            ) : null,
            item("Público-alvo", p.publico_alvo),
            item("Faixa etária", faixa),
            item("Nº estimado de participantes", p.participantes_estimados),
        ],
        4: [
            item("Período", periodo),
            item("Duração total", p.duracao),
            item("Frequência", frequencia),
            item("Dias e horários", p.dias_horarios),
            item("Local", local.join(", ")),
            item("Como será realizado", p.como_sera_realizado),
        ],
        5: filhas.orcamento.length > 0 ? [
            <div key="orc" className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                    <thead>
                        <tr className="border-b text-left text-muted-foreground">
                            <th className="py-2 pr-2 font-medium">Item</th><th className="py-2 pr-2 font-medium">Categoria</th>
                            <th className="py-2 pr-2 text-right font-medium">Quantidade</th><th className="py-2 pr-2 text-right font-medium">Valor unitário</th>
                            <th className="py-2 text-right font-medium">Valor total</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filhas.orcamento.map(o => (
                            <tr key={o.ordem} className="border-b">
                                <td className="py-2 pr-2">{o.item}</td>
                                <td className="py-2 pr-2">{rotuloCategoria(o.categoria)}</td>
                                <td className="py-2 pr-2 text-right tabular-nums">{numeroParaTextoBR(o.quantidade)}</td>
                                <td className="py-2 pr-2 text-right tabular-nums">{o.valor_unitario !== null ? formatarReais(Number(o.valor_unitario)) : ""}</td>
                                <td className="py-2 text-right tabular-nums">{formatarReais(Number(o.quantidade ?? 0) * Number(o.valor_unitario ?? 0))}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <p className="mt-3 text-right text-lg font-semibold tabular-nums">Total geral: {formatarReais(totalOrcamento(orcamento))}</p>
            </div>,
        ] : [],
        6: filhas.metas.length > 0 ? [
            <div key="metas" className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                    <thead>
                        <tr className="border-b text-left text-muted-foreground">
                            <th className="py-2 pr-2 font-medium">Meta</th><th className="py-2 pr-2 font-medium">Indicador</th><th className="py-2 font-medium">Resultado esperado</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filhas.metas.map(m => (
                            <tr key={m.ordem} className="border-b align-top">
                                <td className="py-2 pr-2">{m.meta}</td><td className="py-2 pr-2">{m.indicador}</td><td className="py-2">{m.resultado_esperado}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>,
        ] : [],
        7: [
            ...(bloco2026Visivel(situacao) ? [
                item("Participantes atendidos em 2026", p.resultados_2026_participantes),
                item("Principais resultados", p.resultados_2026_principais),
                item("O que funcionou bem", p.resultados_2026_funcionou),
                item("O que precisa melhorar", p.resultados_2026_melhorar),
            ] : []),
            item("Observações", p.observacoes),
        ],
    }

    return (
        <div className="mx-auto max-w-5xl space-y-6">
            {/* Topo */}
            <div className="space-y-3">
                <div className="flex flex-wrap items-start gap-3">
                    <h1 className="flex-1 text-2xl font-semibold tracking-tight">{p.nome}</h1>
                    <Button variant="outline" onClick={() => router.push("/planejamento")}><ArrowLeft className="mr-1 h-4 w-4" /> Voltar para Projetos</Button>
                    {podeVerSlides && (
                        <Button variant="outline" asChild><Link href={`/planejamento/projeto/${p.id}/apresentacao`}><Presentation className="mr-1 h-4 w-4" /> Ver slides</Link></Button>
                    )}
                    {podeFichaPdf && (
                        <Button variant="outline" onClick={exportarFicha} disabled={exportandoFicha}>
                            {exportandoFicha ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileDown className="mr-1 h-4 w-4" />} Exportar ficha (PDF)
                        </Button>
                    )}
                    {podeExcluir && <ExcluirProjeto supabase={supabase} projetoId={p.id} />}
                    {podeEditar && <Button onClick={() => router.push(`/planejamento/projeto/${p.id}/editar`)}><Pencil className="mr-1 h-4 w-4" /> Editar</Button>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {setor && <Badge className="text-white" style={{ backgroundColor: setor.cor }}>{setor.nome}</Badge>}
                    <Badge variant="outline">{rotuloTipo(p.tipo)}</Badge>
                    {p.situacao_2026 && <Badge variant="secondary">2026: {rotuloSituacao(p.situacao_2026)}</Badge>}
                    {mostrarSeloFichaEmConstrucao(p.status, p.ficha) && (
                        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">Ficha em construção — slides indisponíveis</Badge>
                    )}
                    {podeAcompanhar && acomp && (
                        <ValidacaoTopo supabase={supabase} projetoId={p.id} validacao={acomp.validacao} fichaAtualizadaEm={p.updated_at} recarregar={recarregarAcomp} />
                    )}
                </div>
                <p className="text-sm text-muted-foreground">
                    Criado por {p.criado_por_nome ?? "—"} em {dataHoraFortaleza(p.created_at)}
                    {" · "}Atualizado por {p.atualizado_por_nome ?? "—"} em {dataHoraFortaleza(p.updated_at)}
                </p>
            </div>

            {/* Correções em aberto (S-PLA-04, AC2): leva ao bloco do Acompanhamento */}
            {podeAcompanhar && acomp && <FaixaCorrecoes correcoes={acomp.correcoes} />}

            {/* Status no topo, bem visível (S-PLA-03) */}
            <SeletorStatus supabase={supabase} projetoId={p.id} status={p.status} ficha={p.ficha} onAlterado={aoAlterarStatus} />

            {/* Corpo: a ficha nas seções que se aplicam */}
            {SECOES.filter(s => visiveis.includes(s.id)).map(s => {
                const itens = conteudo[s.id].filter(Boolean)
                return (
                    <Card key={s.id}>
                        <CardContent className="space-y-3 pt-6">
                            <h2 className="text-lg font-semibold">{s.id}. {s.titulo}</h2>
                            {itens.length > 0 ? itens : <p className="text-sm text-muted-foreground">Não preenchido</p>}
                        </CardContent>
                    </Card>
                )
            })}

            {/* Acompanhamento (S-PLA-04, AC1): na mesma página, abaixo da ficha */}
            {podeAcompanhar && (erroAcomp && !acomp ? (
                <Aviso icone={<AlertTriangle className="h-8 w-8 text-rose-600" />} titulo="Não foi possível carregar o acompanhamento." texto={erroAcomp} />
            ) : acomp ? (
                <SecaoAcompanhamento supabase={supabase} projetoId={p.id} dados={acomp} versaoHistorico={versaoHistorico} recarregar={recarregarAcomp} />
            ) : (
                <Skeleton className="h-48 w-full" />
            ))}
        </div>
    )
}

// Campo vazio não aparece (AC12): devolve null para a lista filtrar.
function item(rotulo: string, valor: string | number | null | undefined): ReactNode {
    if (valor === null || valor === undefined || String(valor).trim() === "") return null
    return <Item key={rotulo} rotulo={rotulo}><span className="whitespace-pre-wrap">{String(valor)}</span></Item>
}

function Item({ rotulo, children }: { rotulo: string; children: ReactNode }) {
    return (
        <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{rotulo}</p>
            <div className="text-sm">{children}</div>
        </div>
    )
}
