import type { ReactNode } from "react"
import type { TextProps } from "@react-pdf/renderer"
import { Circle, Document, G, Image, Page, Path, Polygon, StyleSheet, Svg, Text, View } from "@react-pdf/renderer"
import {
    ALTURA_SLIDE, CAPA, CORPO, LARGURA_SLIDE, LAYOUT, MESES_CURTOS, angulosDasFatias, caminhoRosca, larguraColunaItem, larguraTabelaComResumo,
    separadoresRosca, tamanhoValorCartao,
    type Apresentacao, type LinhaOrcamento, type Slide,
} from "./slides"

// S-PLA-05 (AC7) / S-PLA-09: PDF dos slides, um por página, em 960 × 540 pontos (16:9). Só desenha: o
// conteúdo vem de `montarSlides`, que já mediu o que cabe em cada slide. Fonte padrão do PDF
// (Helvetica): o texto do módulo não usa setas nem "✔"; setas, checks e faixas são desenhados com formas.
// Importado sob demanda (só ao exportar), junto com o @react-pdf/renderer.
// A página não usa `wrap={false}`: no @react-pdf 4, isso com um <Svg> na página quebra a geração
// ("unsupported number: Infinity"). O corpo do slide é uma caixa de posição fixa (a área de conteúdo):
// o que cabe nela é decidido pela medida de `montarSlides`, e a conferência de que nada passa da caixa
// é feita pela posição real dos textos no PDF gerado (ver `slides-pdf.test.ts`).

const ESCURO = "#0f172a"
const TEXTO = "#334155"
const CINZA = "#64748b"
const BORDA = "#e2e8f0"
const FUNDO = "#f8fafc"

const s = StyleSheet.create({
    pagina: { width: LARGURA_SLIDE, height: ALTURA_SLIDE, backgroundColor: "#ffffff", fontFamily: "Helvetica", color: TEXTO, position: "relative" },
    corpo: { position: "absolute", left: CORPO.esquerda, top: CORPO.topo, width: CORPO.largura, height: CORPO.altura },
    titulo: { position: "absolute", left: 56, top: 40, fontFamily: "Helvetica-Bold", fontSize: 22, color: ESCURO, letterSpacing: 0.5 },
    rodape: { position: "absolute", left: 56, bottom: 26, fontSize: 10, color: CINZA },
    rotulo: { fontFamily: "Helvetica-Bold", fontSize: LAYOUT.rotulo.tamanho, lineHeight: 1.25, letterSpacing: 1, color: CINZA, marginBottom: LAYOUT.rotulo.espaco },
    texto: { fontSize: 14, lineHeight: LAYOUT.alturaLinha, color: TEXTO },
})

// Sem hifenização (a padrão é do inglês e parte palavras em português no lugar errado). Vale só aqui.
const semHifen = (palavra: string) => [palavra]
type EstiloTexto = TextProps["style"]
const T = ({ style, children }: { style?: EstiloTexto; children: ReactNode }) => (
    <Text style={style} hyphenationCallback={semHifen}>{children}</Text>
)

type Ctx = { a: Apresentacao; logo: string; numero: number; total: number }

function Moldura({ ctx, titulo, children }: { ctx: Ctx; titulo: string; children: ReactNode }) {
    return (
        <Page size={{ width: LARGURA_SLIDE, height: ALTURA_SLIDE }} style={s.pagina}>
            <T style={s.titulo}>{titulo.toUpperCase()}</T>
            <View style={{ position: "absolute", left: 56, top: 74, width: 40, height: 4, borderRadius: 2, backgroundColor: ctx.a.cor }} />
            {/* eslint-disable-next-line jsx-a11y/alt-text -- Image do PDF (react-pdf) não tem alt */}
            <Image src={ctx.logo} style={{ position: "absolute", right: 48, top: 30, width: 46, height: 46 }} />
            <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 6, backgroundColor: ctx.a.cor }} />
            <T style={s.rodape}>{ctx.a.rodape}</T>
            <T style={{ ...s.rodape, left: undefined, right: 56 }}>{`${ctx.numero} / ${ctx.total}`}</T>
            <View style={s.corpo}>{children}</View>
        </Page>
    )
}

// Faixa geométrica da capa e do encerramento (lado direito).
function Faixa({ cor }: { cor: string }) {
    return (
        <Svg style={{ position: "absolute", right: 0, top: 0, width: 420, height: ALTURA_SLIDE }} viewBox={`0 0 420 ${ALTURA_SLIDE}`}>
            <Polygon points={`170,0 420,0 420,${ALTURA_SLIDE} 20,${ALTURA_SLIDE}`} fill={cor} />
            <Polygon points={`250,0 420,0 420,${ALTURA_SLIDE} 150,${ALTURA_SLIDE}`} fill="#ffffff" fillOpacity={0.12} />
            <Polygon points="108,40 150,16 192,40 192,88 150,112 108,88" fill="none" stroke="#ffffff" strokeWidth={3} strokeOpacity={0.75} />
            <G>
                {Array.from({ length: 4 }, (_, l) => Array.from({ length: 5 }, (__, c) => (
                    <Circle key={`${l}-${c}`} cx={300 + c * 18} cy={440 + l * 18} r={2.2} fill="#ffffff" fillOpacity={0.7} />
                )))}
            </G>
        </Svg>
    )
}

function Check({ cor, tamanho = 18 }: { cor: string; tamanho?: number }) {
    return (
        <Svg style={{ width: tamanho, height: tamanho, marginTop: 2 }} viewBox="0 0 20 20">
            <Circle cx={10} cy={10} r={10} fill={cor} />
            <Path d="M5.5 10.5 L8.6 13.4 L14.5 7" stroke="#ffffff" strokeWidth={2.2} fill="none" />
        </Svg>
    )
}

function Seta({ cor }: { cor: string }) {
    return (
        <Svg style={{ width: 14, height: 9, marginVertical: 2 }} viewBox="0 0 14 10">
            <Path d="M7 0 L7 7 M3 4 L7 8.5 L11 4" stroke={cor} strokeWidth={1.8} fill="none" />
        </Svg>
    )
}

function Selo({ cor, corTexto, texto, tamanho = 30 }: { cor: string; corTexto: string; texto: string; tamanho?: number }) {
    return (
        <View style={{ backgroundColor: cor, borderRadius: 14, paddingVertical: 18, paddingHorizontal: 22, alignSelf: "flex-start" }}>
            <T style={{ fontFamily: "Helvetica-Bold", fontSize: tamanho, color: corTexto, letterSpacing: 1, lineHeight: 1.15 }}>{texto}</T>
        </View>
    )
}

function BlocoTexto({ rotulo, texto, cor, tamanho = 14 }: { rotulo: string; texto: string; cor: string; tamanho?: number }) {
    return (
        <View style={{ marginBottom: LAYOUT.margemBloco }}>
            <T style={{ ...s.rotulo, color: cor }}>{rotulo.toUpperCase()}</T>
            <T style={{ ...s.texto, fontSize: tamanho }}>{texto}</T>
        </View>
    )
}

const O = LAYOUT.orcamento
const celula = { fontSize: O.fonte, lineHeight: O.alturaFonte, color: TEXTO }

function TabelaOrcamento({ itens, largura }: { itens: LinhaOrcamento[]; largura: number }) {
    const c = O.colunas
    const colunas = [
        { chave: "item", titulo: "ITEM", largura: larguraColunaItem(largura), direita: false },
        { chave: "categoria", titulo: "CATEGORIA", largura: c.categoria, direita: false },
        { chave: "quantidade", titulo: "QTD", largura: c.qtd, direita: true },
        { chave: "unitario", titulo: "VALOR UNIT.", largura: c.unitario, direita: true },
        { chave: "total", titulo: "TOTAL", largura: c.total, direita: true },
    ] as const
    return (
        <View style={{ width: largura }}>
            <View style={{ flexDirection: "row", gap: O.vaoColuna, height: O.cabecalho, alignItems: "center", borderBottomWidth: 1, borderBottomColor: BORDA }}>
                {colunas.map(col => <T key={col.chave} style={{ width: col.largura, fontFamily: "Helvetica-Bold", fontSize: 8.5, lineHeight: 1.25, letterSpacing: 0.8, color: CINZA, textAlign: col.direita ? "right" : "left" }}>{col.titulo}</T>)}
            </View>
            {itens.map((l, i) => (
                <View key={i} style={{ flexDirection: "row", gap: O.vaoColuna, paddingVertical: O.paddingLinha, borderBottomWidth: 1, borderBottomColor: BORDA }}>
                    {colunas.map(col => (
                        <T key={col.chave} style={{ ...celula, width: col.largura, textAlign: col.direita ? "right" : "left", color: col.chave === "total" ? ESCURO : TEXTO, fontFamily: col.chave === "total" ? "Helvetica-Bold" : "Helvetica" }}>{l[col.chave]}</T>
                    ))}
                </View>
            ))}
        </View>
    )
}

// Conteúdo da área do corpo (slides com título). Separado da moldura para o teste medir o corpo sozinho.
function Corpo({ slide, ctx }: { slide: Slide; ctx: Ctx }): ReactNode {
    const { cor, corTexto } = ctx.a
    switch (slide.tipo) {
        case "capa":
        case "encerramento":
            return null
        case "numeros":
            return (
                <>
                    <View style={{ flexDirection: "row", gap: 20, marginTop: 40 }}>
                        {slide.cartoes.map(c => (
                            <View key={c.rotulo} style={{ flex: 1, borderWidth: 1, borderColor: BORDA, borderRadius: 14, paddingVertical: 36, paddingHorizontal: 18, alignItems: "center", backgroundColor: "#ffffff" }}>
                                <View style={{ width: 34, height: 4, borderRadius: 2, backgroundColor: cor, marginBottom: 22 }} />
                                <T style={{ fontFamily: "Helvetica-Bold", fontSize: tamanhoValorCartao(c.valor, slide.cartoes.length), lineHeight: 1.15, color: cor, textAlign: "center" }}>{c.valor}</T>
                                <T style={{ fontSize: 12, color: CINZA, marginTop: 10, textAlign: "center" }}>{c.rotulo}</T>
                            </View>
                        ))}
                    </View>
                </>
            )
        case "porque": {
            const P = LAYOUT.porque
            if (slide.blocos.length === 0) {
                // Sem texto (ex.: "Mantém"): o selo no centro do slide, em destaque.
                return (
                    <>
                        <View style={{ height: "100%", alignItems: "center", justifyContent: "center" }}>
                            <T style={{ ...s.rotulo, fontSize: 12, marginBottom: 14 }}>SITUAÇÃO EM RELAÇÃO A 2026</T>
                            <View style={{ backgroundColor: cor, borderRadius: 18, paddingVertical: 26, paddingHorizontal: 44 }}>
                                <T style={{ fontFamily: "Helvetica-Bold", fontSize: slide.selo.length > 10 ? 36 : 48, lineHeight: 1.15, color: corTexto, letterSpacing: 2 }}>{slide.selo}</T>
                            </View>
                        </View>
                    </>
                )
            }
            return (
                <>
                    <View style={{ flexDirection: "row", gap: P.vao }}>
                        <View style={{ width: P.colunaSelo, paddingTop: P.topo }}>
                            <T style={s.rotulo}>SITUAÇÃO EM RELAÇÃO A 2026</T>
                            <Selo cor={cor} corTexto={corTexto} texto={slide.selo} tamanho={slide.selo.length > 10 ? 22 : 30} />
                        </View>
                        <View style={{ flex: 1, paddingTop: P.topo }}>
                            {slide.blocos.map(b => <BlocoTexto key={b.rotulo} rotulo={b.rotulo} texto={b.texto} cor={cor} tamanho={slide.tamanho} />)}
                        </View>
                    </View>
                </>
            )
        }
        case "objetivos": {
            const L = LAYOUT.objetivos
            return (
                <>
                    {slide.objetivoGeral ? (
                        <View style={{ borderLeftWidth: 4, borderLeftColor: cor, paddingLeft: L.borda - 4, marginBottom: L.margemGeral }}>
                            <T style={s.rotulo}>OBJETIVO GERAL</T>
                            <T style={{ fontSize: L.geral, lineHeight: L.alturaGeral, color: ESCURO }}>{slide.objetivoGeral}</T>
                        </View>
                    ) : null}
                    <View style={{ flexDirection: "row", gap: L.vao }}>
                        {slide.especificos.length > 0 ? (
                            <View style={{ flex: 1 }}>
                                <T style={s.rotulo}>OBJETIVOS ESPECÍFICOS</T>
                                {slide.especificos.map((o, i) => (
                                    <View key={i} style={{ flexDirection: "row", gap: L.check - 14, marginBottom: L.margemItem, alignItems: "flex-start" }}>
                                        <Check cor={cor} tamanho={14} />
                                        <T style={{ ...s.texto, fontSize: L.item, flex: 1 }}>{o}</T>
                                    </View>
                                ))}
                            </View>
                        ) : null}
                        {slide.publico || slide.faixa ? (
                            <View style={{ width: L.caixa, backgroundColor: FUNDO, borderRadius: 12, padding: L.caixaPadding, alignSelf: "flex-start", marginLeft: slide.especificos.length > 0 ? 0 : "auto" }}>
                                {slide.publico ? <BlocoTexto rotulo="Público-alvo" texto={slide.publico} cor={cor} tamanho={L.item} /> : null}
                                {slide.faixa ? (
                                    <View>
                                        <T style={{ ...s.rotulo, color: cor }}>FAIXA ETÁRIA</T>
                                        <T style={{ fontFamily: "Helvetica-Bold", fontSize: 20, lineHeight: 1.25, color: ESCURO }}>{slide.faixa}</T>
                                    </View>
                                ) : null}
                            </View>
                        ) : null}
                    </View>
                </>
            )
        }
        case "execucao": {
            const E = LAYOUT.execucao
            return (
                <>
                    {slide.linhaDoTempo ? (
                        <View style={{ marginBottom: 20 }}>
                            <View style={{ flexDirection: "row", gap: 4 }}>
                                {MESES_CURTOS.map((m, i) => {
                                    const ativo = slide.linhaDoTempo!.anoTodo || slide.linhaDoTempo!.meses.includes(i + 1)
                                    return (
                                        <View key={m} style={{ flex: 1, alignItems: "center" }}>
                                            <View style={{ width: "100%", height: 14, borderRadius: 4, backgroundColor: ativo ? cor : BORDA }} />
                                            <T style={{ fontSize: 9.5, lineHeight: 1.25, marginTop: 5, color: ativo ? ESCURO : CINZA, fontFamily: ativo ? "Helvetica-Bold" : "Helvetica" }}>{m}</T>
                                        </View>
                                    )
                                })}
                            </View>
                            {slide.periodo ? <T style={{ fontFamily: "Helvetica-Bold", fontSize: 15, lineHeight: 1.25, color: ESCURO, marginTop: 10 }}>{slide.periodo}</T> : null}
                        </View>
                    ) : null}
                    <View style={{ flexDirection: "row", gap: E.vao }}>
                        {slide.itens.length > 0 ? (
                            <View style={{ width: E.colunaItens }}>
                                {slide.itens.map(i => <BlocoTexto key={i.rotulo} rotulo={i.rotulo} texto={i.texto} cor={cor} tamanho={E.item} />)}
                            </View>
                        ) : null}
                        {slide.como ? (
                            <View style={{ flex: 1, backgroundColor: FUNDO, borderRadius: 12, padding: E.caixaPadding, alignSelf: "flex-start" }}>
                                <BlocoTexto rotulo="Como será realizado" texto={slide.como} cor={cor} tamanho={E.item} />
                            </View>
                        ) : null}
                    </View>
                </>
            )
        }
        case "orcamento": {
            const resumo = slide.resumo
            if (!resumo) return <><TabelaOrcamento itens={slide.itens} largura={CORPO.largura} /></>
            const angulos = angulosDasFatias(resumo.fatias)
            const r = O.rosca / 2
            return (
                <>
                    <View style={{ flexDirection: "row", gap: O.vao }}>
                        <View style={{ width: O.colunaResumo }}>
                            <View style={{ backgroundColor: cor, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 18, marginBottom: 14 }}>
                                <T style={{ fontSize: 10.5, lineHeight: 1.25, color: corTexto, letterSpacing: 1 }}>TOTAL ESTIMADO</T>
                                <T style={{ fontFamily: "Helvetica-Bold", fontSize: resumo.total.length > 16 ? 20 : 26, lineHeight: 1.2, color: corTexto, marginTop: 4 }}>{resumo.total}</T>
                            </View>
                            <View style={{ flexDirection: "row", gap: 12, alignItems: "flex-start" }}>
                                <Svg style={{ width: O.rosca, height: O.rosca }} viewBox={`0 0 ${O.rosca} ${O.rosca}`}>
                                    {resumo.fatias.map((x, i) => (
                                        <Path key={x.chave} d={caminhoRosca(r, r, r - 2, r * 0.6, angulos[i].inicio, angulos[i].fim)} fill={x.cor} />
                                    ))}
                                    {separadoresRosca(r, r, r - 2, r * 0.6, angulos).map((d, i) => <Path key={`sep-${i}`} d={d} stroke="#ffffff" strokeWidth={2} />)}
                                </Svg>
                                <View style={{ flex: 1 }}>
                                    {resumo.fatias.map(x => (
                                        <View key={x.chave} style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 }}>
                                            <View style={{ width: 9, height: 9, borderRadius: 2, backgroundColor: x.cor }} />
                                            <T style={{ fontSize: 9.5, lineHeight: 1.25, color: ESCURO, flex: 1 }}>{x.rotulo}</T>
                                            <T style={{ fontSize: 9.5, lineHeight: 1.25, color: CINZA }}>{`${String(x.percentual).replace(".", ",")}%`}</T>
                                        </View>
                                    ))}
                                </View>
                            </View>
                        </View>
                        <TabelaOrcamento itens={slide.itens} largura={larguraTabelaComResumo} />
                    </View>
                </>
            )
        }
        case "metas": {
            const M = LAYOUT.metas
            return (
                <>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: M.vao, marginTop: -6 }}>
                        {slide.metas.map((m, i) => {
                            const n = slide.inicio + i
                            const partes = [
                                m.meta ? { r: "META", t: m.meta, forte: true } : null,
                                m.indicador ? { r: "COMO SERÁ MEDIDO", t: m.indicador, forte: false } : null,
                                m.esperado ? { r: "ESPERADO", t: m.esperado, forte: true } : null,
                            ].filter((x): x is { r: string; t: string; forte: boolean } => x !== null)
                            return (
                                <View key={i} style={{ width: slide.layout === "grade" ? M.grade : M.lista, height: slide.layout === "grade" ? M.alturaGrade : undefined, borderWidth: 1, borderColor: BORDA, borderRadius: 12, padding: M.padding, flexDirection: "row", gap: M.vaoNumero }}>
                                    <View style={{ width: M.numero, height: M.numero, borderRadius: M.numero / 2, backgroundColor: cor, alignItems: "center", justifyContent: "center" }}>
                                        <T style={{ fontFamily: "Helvetica-Bold", fontSize: 12, color: corTexto }}>{String(n)}</T>
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        {partes.map((x, j) => (
                                            <View key={x.r}>
                                                {j > 0 ? <Seta cor={cor} /> : null}
                                                <T style={{ fontFamily: "Helvetica-Bold", fontSize: M.rotulo, lineHeight: 1.25, letterSpacing: 1, color: CINZA }}>{x.r}</T>
                                                <T style={{ fontSize: M.texto, lineHeight: M.alturaTexto, color: x.forte ? ESCURO : TEXTO, fontFamily: x.forte ? "Helvetica-Bold" : "Helvetica" }}>{x.t}</T>
                                            </View>
                                        ))}
                                    </View>
                                </View>
                            )
                        })}
                    </View>
                </>
            )
        }
        case "aprendizados": {
            const A = LAYOUT.aprendizados
            return (
                <>
                    <View style={{ flexDirection: "row", gap: A.vao }}>
                        {slide.barras.length > 0 ? (
                            <View style={{ width: A.colunaBarras, paddingTop: 6 }}>
                                <T style={s.rotulo}>PARTICIPANTES</T>
                                {slide.barras.map((b, i) => (
                                    <View key={b.rotulo} style={{ marginBottom: 18 }}>
                                        <T style={{ fontSize: 11.5, color: CINZA, marginBottom: 5 }}>{b.rotulo}</T>
                                        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                                            <View style={{ width: Math.max(8, 210 * b.proporcao), height: 30, borderRadius: 6, backgroundColor: i === 0 ? "#94a3b8" : cor }} />
                                            <T style={{ fontFamily: "Helvetica-Bold", fontSize: 18, color: ESCURO }}>{b.valorTexto}</T>
                                        </View>
                                    </View>
                                ))}
                            </View>
                        ) : null}
                        <View style={{ flex: 1 }}>
                            {slide.blocos.map(b => <BlocoTexto key={b.rotulo} rotulo={b.rotulo} texto={b.texto} cor={cor} tamanho={A.texto} />)}
                        </View>
                    </View>
                </>
            )
        }
        case "observacoes":
            return (
                <>
                    <View style={{ borderLeftWidth: 4, borderLeftColor: cor, paddingLeft: LAYOUT.observacoes.recuo - 4 }}>
                        <T style={{ ...s.texto, fontSize: slide.tamanho }}>{slide.texto}</T>
                    </View>
                </>
            )
        case "continuacao":
            return (
                <>
                    {slide.blocos.map((b, i) => <BlocoTexto key={i} rotulo={b.rotulo} texto={b.texto} cor={cor} tamanho={LAYOUT.continuacao} />)}
                </>
            )
    }
}

function CapaOuEncerramento({ slide, ctx }: { slide: Extract<Slide, { tipo: "capa" | "encerramento" }>; ctx: Ctx }) {
    const { cor, corTexto } = ctx.a
    switch (slide.tipo) {
        case "capa":
        case "encerramento": {
            const capa = slide.tipo === "capa"
            const respiro = capa ? slide.layout.respiro : 22
            return (
                <Page size={{ width: LARGURA_SLIDE, height: ALTURA_SLIDE }} style={s.pagina}>
                    <Faixa cor={cor} />
                    {/* eslint-disable-next-line jsx-a11y/alt-text -- Image do PDF (react-pdf) não tem alt */}
                    <Image src={ctx.logo} style={{ position: "absolute", left: 56, top: 40, width: 64, height: 64 }} />
                    <View style={{ position: "absolute", left: 56, top: capa ? slide.layout.topo : 140, width: CAPA.largura }}>
                        <T style={{ ...s.rotulo, color: cor, fontSize: 12 }}>{capa && ctx.a.setor ? `PLANEJAMENTO 2027 · ${ctx.a.setor.toUpperCase()}` : "PLANEJAMENTO 2027"}</T>
                        {capa ? (
                            <T style={{ fontFamily: "Helvetica-Bold", fontSize: slide.layout.tamanho, color: ESCURO, lineHeight: CAPA.alturaTitulo, marginTop: 6 }}>{slide.nome}</T>
                        ) : (
                            <>
                                <T style={{ fontFamily: "Helvetica-Bold", fontSize: 60, color: ESCURO, marginTop: 6 }}>Obrigado</T>
                                <T style={{ fontSize: 18, color: CINZA, marginTop: 4 }}>pela atenção</T>
                            </>
                        )}
                        <View style={{ width: 56, height: 5, borderRadius: 3, backgroundColor: cor, marginTop: respiro, marginBottom: respiro }} />
                        {capa ? (
                            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                                {ctx.a.setor ? <View style={{ backgroundColor: cor, borderRadius: 12, paddingVertical: 6, paddingHorizontal: 12 }}><T style={{ fontFamily: "Helvetica-Bold", fontSize: 12, color: corTexto }}>{ctx.a.setor}</T></View> : null}
                                <View style={{ borderWidth: 1, borderColor: BORDA, borderRadius: 12, paddingVertical: 6, paddingHorizontal: 12 }}><T style={{ fontSize: 12, color: TEXTO }}>{slide.tipoProjeto}</T></View>
                            </View>
                        ) : null}
                        {(capa ? slide.responsavel : slide.responsavel || slide.contato) ? (
                            <View style={{ marginTop: capa ? respiro + 4 : 26 }}>
                                <T style={s.rotulo}>RESPONSÁVEL</T>
                                {slide.responsavel ? <T style={{ fontSize: 16, lineHeight: 1.25, color: ESCURO, fontFamily: "Helvetica-Bold" }}>{slide.responsavel}</T> : null}
                                {slide.tipo === "encerramento" && slide.contato ? <T style={{ fontSize: 14, lineHeight: 1.25, color: TEXTO, marginTop: 4 }}>{slide.contato}</T> : null}
                            </View>
                        ) : null}
                    </View>
                    <T style={{ ...s.rodape }}>{ctx.a.rodape}</T>
                </Page>
            )
        }
    }
}

function Conteudo({ slide, ctx }: { slide: Slide; ctx: Ctx }) {
    if (slide.tipo === "capa" || slide.tipo === "encerramento") return <CapaOuEncerramento slide={slide} ctx={ctx} />
    return <Moldura ctx={ctx} titulo={slide.titulo}><Corpo slide={slide} ctx={ctx} /></Moldura>
}

export function SlidesPdfDocument({ apresentacao, logo, titulo }: { apresentacao: Apresentacao; logo: string; titulo: string }) {
    const total = apresentacao.slides.length
    return (
        <Document title={titulo} author="Rede Cuca" creator="Cuca Atende+">
            {apresentacao.slides.map((slide, i) => (
                <Conteudo key={slide.id} slide={slide} ctx={{ a: apresentacao, logo, numero: i + 1, total }} />
            ))}
        </Document>
    )
}

// Só para teste: o corpo de cada slide com título numa página do tamanho exato da área de conteúdo.
// Se algum corpo passar da área, essa página quebra em duas (o teste compara a contagem).
export function CorposPdfDocument({ apresentacao, logo }: { apresentacao: Apresentacao; logo: string }) {
    const comCorpo = apresentacao.slides.filter(sl => sl.tipo !== "capa" && sl.tipo !== "encerramento")
    return (
        <Document>
            {comCorpo.map((slide, i) => (
                <Page key={slide.id} size={{ width: CORPO.largura, height: CORPO.altura }} style={{ fontFamily: "Helvetica", color: TEXTO }}>
                    <Corpo slide={slide} ctx={{ a: apresentacao, logo, numero: i + 1, total: comCorpo.length }} />
                </Page>
            ))}
        </Document>
    )
}
