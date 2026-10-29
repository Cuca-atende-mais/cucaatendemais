import type { ReactNode } from "react"
import type { TextProps } from "@react-pdf/renderer"
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer"
import {
    SECOES, bloco2026Visivel, camposDaSituacao, rotuloCategoria, rotuloFrequencia, rotuloSituacao, rotuloStatus, rotuloTipo,
    secoesVisiveis, type FilhasProjeto, type IdSecao, type LinhaProjeto,
} from "./projeto"
import { dataCurta, dataHoraFortaleza } from "./projeto-dados"
import { inteiroBR, reais, type SetorSlides } from "./slides"

// S-PLA-05 (AC8): ficha completa do projeto em PDF, A4 retrato, com a marca Rede Cuca. Segue a mesma
// leitura da página do projeto (S-PLA-02): só as seções que a situação mostra, campo vazio não aparece,
// seção sem nada mostra "Não preenchido". Sai com a ficha parcial ou final (não depende do D7).
// Importado sob demanda (só ao exportar).

const ESCURO = "#0f172a"
const TEXTO = "#334155"
const CINZA = "#64748b"
const BORDA = "#e2e8f0"

const s = StyleSheet.create({
    pagina: { paddingTop: 40, paddingBottom: 56, paddingHorizontal: 44, fontFamily: "Helvetica", fontSize: 10.5, color: TEXTO, lineHeight: 1.4 },
    secao: { marginTop: 16 },
    tituloSecao: { fontFamily: "Helvetica-Bold", fontSize: 12.5, color: ESCURO, paddingBottom: 4, marginBottom: 8, borderBottomWidth: 1.5 },
    rotulo: { fontFamily: "Helvetica-Bold", fontSize: 8, letterSpacing: 0.8, color: CINZA, marginBottom: 1 },
    item: { marginBottom: 7 },
    celula: { paddingVertical: 4, paddingRight: 6, fontSize: 9.5 },
    rodape: { position: "absolute", bottom: 24, left: 44, right: 44, flexDirection: "row", justifyContent: "space-between", fontSize: 8.5, color: CINZA },
})

const semHifen = (palavra: string) => [palavra]
type EstiloTexto = TextProps["style"]
const T = ({ style, children, ...resto }: { style?: EstiloTexto; children?: ReactNode; render?: (p: { pageNumber: number; totalPages: number }) => string; fixed?: boolean }) => (
    <Text style={style} hyphenationCallback={semHifen} {...resto}>{children}</Text>
)

type Item = { rotulo: string; valor: string } | { rotulo: string; lista: string[] }

const valor = (rotulo: string, v: string | number | null | undefined): Item | null =>
    v === null || v === undefined || String(v).trim() === "" ? null : { rotulo, valor: String(v) }

const numero = (v: number | string | null | undefined) => {
    const n = v === null || v === undefined || v === "" ? null : Number(v)
    return n !== null && Number.isFinite(n) ? n : null
}

export function FichaPdfDocument({ projeto: p, filhas, setor, unidades, logo }: {
    projeto: LinhaProjeto; filhas: FilhasProjeto; setor: SetorSlides | null; unidades: { id: string; nome: string }[]; logo: string
}) {
    const cor = setor?.cor || "#1e3a8a"
    const situacao = p.situacao_2026 ?? ""
    const sit = camposDaSituacao(situacao)
    const ordenar = <X extends { ordem: number }>(l: X[]) => [...l].sort((a, b) => a.ordem - b.ordem)
    const nomesUnidades = (p.locais_unidades ?? []).map(id => unidades.find(u => u.id === id)?.nome).filter((n): n is string => !!n)
    const local = [...nomesUnidades, ...(p.local_outro && p.local_outro_texto ? [p.local_outro_texto] : [])].join(", ")
    const periodo = p.periodo_ano_todo ? "Ano todo" : [p.data_inicio && dataCurta(p.data_inicio), p.data_fim && dataCurta(p.data_fim)].filter(Boolean).join(" a ")
    const faixa = p.faixa_etaria_min !== null || p.faixa_etaria_max !== null ? `${p.faixa_etaria_min ?? "?"} a ${p.faixa_etaria_max ?? "?"} anos` : null
    const frequencia = p.frequencia === "outra" ? (p.frequencia_outra || "Outra") : rotuloFrequencia(p.frequencia)
    const objetivos = ordenar(filhas.objetivos).map(o => o.texto).filter(t => t.trim() !== "")
    const orcamento = ordenar(filhas.orcamento).map(o => {
        const q = numero(o.quantidade)
        const v = numero(o.valor_unitario)
        return { item: o.item ?? "", categoria: rotuloCategoria(o.categoria), q, v, total: Math.round((q ?? 0) * (v ?? 0) * 100) / 100 }
    })
    const totalGeral = Math.round(orcamento.reduce((t, o) => t + o.total, 0) * 100) / 100
    const metas = ordenar(filhas.metas).filter(m => [m.meta, m.indicador, m.resultado_esperado].some(x => x && x.trim() !== ""))

    const conteudo: Record<IdSecao, (Item | ReactNode | null)[]> = {
        1: [valor("Responsável pelo projeto", p.responsavel_nome), valor("Contato do responsável", p.responsavel_contato)],
        2: [
            valor("Situação", rotuloSituacao(p.situacao_2026)),
            sit.mudancas ? valor("O que muda em relação a 2026", p.mudancas_2026) : null,
            sit.justificativa ? valor(sit.rotuloJustificativa, p.justificativa_2026) : null,
        ],
        3: [
            valor("Objetivo geral", p.objetivo_geral),
            objetivos.length ? { rotulo: "Objetivos específicos", lista: objetivos } : null,
            valor("Público-alvo", p.publico_alvo),
            valor("Faixa etária", faixa),
            valor("Nº estimado de participantes", p.participantes_estimados !== null ? inteiroBR(p.participantes_estimados) : null),
        ],
        4: [
            valor("Período", periodo), valor("Duração total", p.duracao), valor("Frequência", frequencia),
            valor("Dias e horários", p.dias_horarios), valor("Local", local), valor("Como será realizado", p.como_sera_realizado),
        ],
        5: orcamento.length ? [
            <View key="orc">
                <Linha cabecalho celulas={["Item", "Categoria", "Quantidade", "Valor unitário", "Valor total"]} />
                {orcamento.map((o, i) => (
                    <Linha key={i} celulas={[o.item, o.categoria, o.q !== null ? o.q.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "", o.v !== null ? reais(o.v) : "", reais(o.total)]} />
                ))}
                <T style={{ fontFamily: "Helvetica-Bold", fontSize: 12, color: ESCURO, textAlign: "right", marginTop: 8 }}>{`Total geral: ${reais(totalGeral)}`}</T>
            </View>,
        ] : [],
        6: metas.length ? [
            <View key="metas">
                <Linha cabecalho larguras={[34, 33, 33]} celulas={["Meta", "Indicador", "Resultado esperado"]} />
                {metas.map((m, i) => <Linha key={i} larguras={[34, 33, 33]} celulas={[m.meta ?? "", m.indicador ?? "", m.resultado_esperado ?? ""]} />)}
            </View>,
        ] : [],
        7: [
            ...(bloco2026Visivel(situacao) ? [
                valor("Participantes atendidos em 2026", p.resultados_2026_participantes !== null ? inteiroBR(p.resultados_2026_participantes) : null),
                valor("Principais resultados", p.resultados_2026_principais),
                valor("O que funcionou bem", p.resultados_2026_funcionou),
                valor("O que precisa melhorar", p.resultados_2026_melhorar),
            ] : []),
            valor("Observações", p.observacoes),
        ],
    }

    return (
        <Document title={`Ficha — ${p.nome}`} author="Rede Cuca" creator="Cuca Atende+">
            <Page size="A4" orientation="portrait" style={s.pagina}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 14 }}>
                    {/* eslint-disable-next-line jsx-a11y/alt-text -- Image do PDF (react-pdf) não tem alt */}
                    <Image src={logo} style={{ width: 52, height: 52 }} />
                    <View style={{ flex: 1 }}>
                        <T style={{ fontFamily: "Helvetica-Bold", fontSize: 9, letterSpacing: 1, color: cor }}>{`PLANEJAMENTO ${p.ano} · FICHA DO PROJETO`}</T>
                        <T style={{ fontFamily: "Helvetica-Bold", fontSize: 18, color: ESCURO, lineHeight: 1.2, marginTop: 2 }}>{p.nome}</T>
                    </View>
                </View>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
                    {setor ? <Etiqueta fundo={cor} texto={setor.nome} branco /> : null}
                    <Etiqueta texto={rotuloTipo(p.tipo)} />
                    {p.situacao_2026 ? <Etiqueta texto={`2026: ${rotuloSituacao(p.situacao_2026)}`} /> : null}
                    <Etiqueta texto={`Status: ${rotuloStatus(p.status)}`} />
                    <Etiqueta texto={p.ficha === "final" ? "Ficha final" : "Ficha parcial (em construção)"} />
                </View>
                <T style={{ fontSize: 8.5, color: CINZA, marginBottom: 4 }}>
                    {`Criado por ${p.criado_por_nome ?? "—"} em ${dataHoraFortaleza(p.created_at)} · Atualizado por ${p.atualizado_por_nome ?? "—"} em ${dataHoraFortaleza(p.updated_at)}`}
                </T>

                {SECOES.filter(sec => secoesVisiveis(situacao).includes(sec.id)).map(sec => {
                    const itens = conteudo[sec.id].filter(x => x !== null)
                    return (
                        <View key={sec.id} style={s.secao}>
                            {/* O título não fica sozinho no pé da página. */}
                            <View minPresenceAhead={60}>
                                <T style={{ ...s.tituloSecao, borderBottomColor: cor }}>{`${sec.id}. ${sec.titulo}`}</T>
                            </View>
                            {itens.length === 0 ? <T style={{ color: CINZA }}>Não preenchido</T> : itens.map((it, i) => <ItemFicha key={i} item={it} />)}
                        </View>
                    )
                })}

                <View style={s.rodape} fixed>
                    <T>{`Rede Cuca · Planejamento ${p.ano}${setor ? ` · ${setor.nome}` : ""}`}</T>
                    <T render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
                </View>
            </Page>
        </Document>
    )
}

function ItemFicha({ item }: { item: Item | ReactNode }) {
    if (item && typeof item === "object" && "rotulo" in (item as object)) {
        const it = item as Item
        return (
            <View style={s.item} wrap={("valor" in it ? it.valor.length : 0) < 1500}>
                <T style={s.rotulo}>{it.rotulo.toUpperCase()}</T>
                {"lista" in it
                    ? it.lista.map((l, i) => <T key={i}>{`• ${l}`}</T>)
                    : <T>{it.valor}</T>}
            </View>
        )
    }
    return <>{item as ReactNode}</>
}

function Etiqueta({ texto, fundo, branco }: { texto: string; fundo?: string; branco?: boolean }) {
    return (
        <View style={{ borderWidth: 1, borderColor: fundo ?? BORDA, backgroundColor: fundo ?? "#ffffff", borderRadius: 8, paddingVertical: 2, paddingHorizontal: 7 }}>
            <T style={{ fontSize: 8.5, color: branco ? "#ffffff" : TEXTO }}>{texto}</T>
        </View>
    )
}

const LARGURAS_ORC = [32, 18, 14, 18, 18]
function Linha({ celulas, cabecalho, larguras = LARGURAS_ORC }: { celulas: string[]; cabecalho?: boolean; larguras?: number[] }) {
    return (
        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderBottomColor: BORDA }} wrap={false}>
            {celulas.map((c, i) => (
                <T key={i} style={{
                    ...s.celula, width: `${larguras[i]}%`,
                    textAlign: larguras === LARGURAS_ORC && i >= 2 ? "right" : "left",
                    ...(cabecalho ? { fontFamily: "Helvetica-Bold", color: CINZA, fontSize: 8.5 } : {}),
                }}>{c}</T>
            ))}
        </View>
    )
}
