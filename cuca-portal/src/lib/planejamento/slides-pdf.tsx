import type { ReactNode } from "react"
import type { TextProps } from "@react-pdf/renderer"
import { Circle, Document, G, Image, Page, Path, Polygon, StyleSheet, Svg, Text, View } from "@react-pdf/renderer"
import {
    ALTURA_SLIDE, LARGURA_SLIDE, MESES_CURTOS, angulosDasFatias, caminhoRosca, separadoresRosca, tamanhoTexto, respiroCapa, tamanhoTituloCapa, tamanhoValorCartao, topoCapa,
    type Apresentacao, type Slide,
} from "./slides"

// S-PLA-05 (AC7): PDF dos slides, um por página, em 960 × 540 pontos (16:9). Só desenha: o conteúdo
// vem de `montarSlides(..., "pdf")`. Fonte padrão do PDF (Helvetica): o texto do módulo não usa setas
// nem "✔"; setas, checks e faixas são desenhados com formas.
// Importado sob demanda (só ao exportar), junto com o @react-pdf/renderer.
// A página não usa `wrap={false}`: no @react-pdf 4, isso com um <Svg> na página quebra a geração
// ("unsupported number: Infinity"). Quem garante "um slide = uma página" são os limites de texto do
// módulo, conferidos em teste (slides-pdf.test.ts conta as páginas).

const ESCURO = "#0f172a"
const TEXTO = "#334155"
const CINZA = "#64748b"
const BORDA = "#e2e8f0"
const FUNDO = "#f8fafc"

const s = StyleSheet.create({
    pagina: { width: LARGURA_SLIDE, height: ALTURA_SLIDE, backgroundColor: "#ffffff", fontFamily: "Helvetica", color: TEXTO, position: "relative" },
    corpo: { position: "absolute", left: 56, right: 56, top: 108, bottom: 64 },
    titulo: { position: "absolute", left: 56, top: 40, fontFamily: "Helvetica-Bold", fontSize: 22, color: ESCURO, letterSpacing: 0.5 },
    rodape: { position: "absolute", left: 56, bottom: 26, fontSize: 10, color: CINZA },
    rotulo: { fontFamily: "Helvetica-Bold", fontSize: 10, letterSpacing: 1, color: CINZA, marginBottom: 6 },
    texto: { fontSize: 14, lineHeight: 1.45, color: TEXTO },
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
            <View style={s.corpo}>{children}</View>
            <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 6, backgroundColor: ctx.a.cor }} />
            <T style={s.rodape}>{ctx.a.rodape}</T>
            <T style={{ ...s.rodape, left: undefined, right: 56 }}>{`${ctx.numero} / ${ctx.total}`}</T>
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
        <Svg style={{ width: tamanho, height: tamanho }} viewBox="0 0 20 20">
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
            <T style={{ fontFamily: "Helvetica-Bold", fontSize: tamanho, color: corTexto, letterSpacing: 1 }}>{texto}</T>
        </View>
    )
}

function BlocoTexto({ rotulo, texto, cor, tamanho = 14 }: { rotulo: string; texto: string; cor: string; tamanho?: number }) {
    return (
        <View style={{ marginBottom: 16 }}>
            <T style={{ ...s.rotulo, color: cor }}>{rotulo.toUpperCase()}</T>
            <T style={{ ...s.texto, fontSize: tamanho }}>{texto}</T>
        </View>
    )
}

function Conteudo({ slide, ctx }: { slide: Slide; ctx: Ctx }) {
    const { cor, corTexto } = ctx.a
    switch (slide.tipo) {
        case "capa":
        case "encerramento": {
            const capa = slide.tipo === "capa"
            return (
                <Page size={{ width: LARGURA_SLIDE, height: ALTURA_SLIDE }} style={s.pagina}>
                    <Faixa cor={cor} />
                    {/* eslint-disable-next-line jsx-a11y/alt-text -- Image do PDF (react-pdf) não tem alt */}
                    <Image src={ctx.logo} style={{ position: "absolute", left: 56, top: 40, width: 64, height: 64 }} />
                    <View style={{ position: "absolute", left: 56, top: capa ? topoCapa(slide.nome) : 140, width: 470 }}>
                        <T style={{ ...s.rotulo, color: cor, fontSize: 12 }}>{capa ? `PLANEJAMENTO 2027 · ${ctx.a.setor.toUpperCase()}` : "PLANEJAMENTO 2027"}</T>
                        {capa ? (
                            <T style={{ fontFamily: "Helvetica-Bold", fontSize: tamanhoTituloCapa(slide.nome), color: ESCURO, lineHeight: 1.1, marginTop: 6 }}>{slide.nome}</T>
                        ) : (
                            <>
                                <T style={{ fontFamily: "Helvetica-Bold", fontSize: 60, color: ESCURO, marginTop: 6 }}>Obrigado</T>
                                <T style={{ fontSize: 18, color: CINZA, marginTop: 4 }}>pela atenção</T>
                            </>
                        )}
                        <View style={{ width: 56, height: 5, borderRadius: 3, backgroundColor: cor, marginTop: capa ? respiroCapa(slide.nome) : 22, marginBottom: capa ? respiroCapa(slide.nome) : 22 }} />
                        {capa ? (
                            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                                {ctx.a.setor ? <View style={{ backgroundColor: cor, borderRadius: 12, paddingVertical: 6, paddingHorizontal: 12 }}><T style={{ fontFamily: "Helvetica-Bold", fontSize: 12, color: corTexto }}>{ctx.a.setor}</T></View> : null}
                                <View style={{ borderWidth: 1, borderColor: BORDA, borderRadius: 12, paddingVertical: 6, paddingHorizontal: 12 }}><T style={{ fontSize: 12, color: TEXTO }}>{slide.tipoProjeto}</T></View>
                            </View>
                        ) : null}
                        {(capa ? slide.responsavel : slide.responsavel || slide.contato) ? (
                            <View style={{ marginTop: capa ? respiroCapa(slide.nome) + 4 : 26 }}>
                                <T style={s.rotulo}>RESPONSÁVEL</T>
                                {slide.responsavel ? <T style={{ fontSize: 16, color: ESCURO, fontFamily: "Helvetica-Bold" }}>{slide.responsavel}</T> : null}
                                {slide.tipo === "encerramento" && slide.contato ? <T style={{ fontSize: 14, color: TEXTO, marginTop: 4 }}>{slide.contato}</T> : null}
                            </View>
                        ) : null}
                    </View>
                    <T style={{ ...s.rodape }}>{ctx.a.rodape}</T>
                </Page>
            )
        }
        case "numeros":
            return (
                <Moldura ctx={ctx} titulo={slide.titulo}>
                    <View style={{ flexDirection: "row", gap: 20, marginTop: 40 }}>
                        {slide.cartoes.map(c => (
                            <View key={c.rotulo} style={{ flex: 1, borderWidth: 1, borderColor: BORDA, borderRadius: 14, paddingVertical: 36, paddingHorizontal: 18, alignItems: "center", backgroundColor: "#ffffff" }}>
                                <View style={{ width: 34, height: 4, borderRadius: 2, backgroundColor: cor, marginBottom: 22 }} />
                                <T style={{ fontFamily: "Helvetica-Bold", fontSize: tamanhoValorCartao(c.valor), color: cor, textAlign: "center" }}>{c.valor}</T>
                                <T style={{ fontSize: 12, color: CINZA, marginTop: 10, textAlign: "center" }}>{c.rotulo}</T>
                            </View>
                        ))}
                    </View>
                </Moldura>
            )
        case "porque":
            return (
                <Moldura ctx={ctx} titulo={slide.titulo}>
                    <View style={{ flexDirection: "row", gap: 40 }}>
                        <View style={{ width: 280, paddingTop: 10 }}>
                            <T style={s.rotulo}>SITUAÇÃO EM RELAÇÃO A 2026</T>
                            <Selo cor={cor} corTexto={corTexto} texto={slide.selo} tamanho={slide.selo.length > 10 ? 22 : 30} />
                        </View>
                        <View style={{ flex: 1, paddingTop: 10 }}>
                            {slide.blocos.map(b => <BlocoTexto key={b.rotulo} rotulo={b.rotulo} texto={b.texto} cor={cor} tamanho={tamanhoTexto(slide.blocos.reduce((t, x) => t + x.texto.length, 0))} />)}
                        </View>
                    </View>
                </Moldura>
            )
        case "objetivos":
            return (
                <Moldura ctx={ctx} titulo={slide.titulo}>
                    {slide.objetivoGeral ? (
                        <View style={{ borderLeftWidth: 4, borderLeftColor: cor, paddingLeft: 16, marginBottom: 18 }}>
                            <T style={s.rotulo}>OBJETIVO GERAL</T>
                            <T style={{ fontSize: 17, lineHeight: 1.35, color: ESCURO }}>{slide.objetivoGeral}</T>
                        </View>
                    ) : null}
                    <View style={{ flexDirection: "row", gap: 30 }}>
                        {slide.especificos.length > 0 ? (
                            <View style={{ flex: 1 }}>
                                <T style={s.rotulo}>OBJETIVOS ESPECÍFICOS</T>
                                {slide.especificos.map((o, i) => (
                                    <View key={i} style={{ flexDirection: "row", gap: 10, marginBottom: 7, alignItems: "flex-start" }}>
                                        <Check cor={cor} tamanho={14} />
                                        <T style={{ ...s.texto, fontSize: 12.5, flex: 1 }}>{o}</T>
                                    </View>
                                ))}
                            </View>
                        ) : null}
                        {slide.publico || slide.faixa ? (
                            <View style={{ width: 250, backgroundColor: FUNDO, borderRadius: 12, padding: 16, alignSelf: "flex-start" }}>
                                {slide.publico ? <BlocoTexto rotulo="Público-alvo" texto={slide.publico} cor={cor} tamanho={12.5} /> : null}
                                {slide.faixa ? (
                                    <View>
                                        <T style={{ ...s.rotulo, color: cor }}>FAIXA ETÁRIA</T>
                                        <T style={{ fontFamily: "Helvetica-Bold", fontSize: 20, color: ESCURO }}>{slide.faixa}</T>
                                    </View>
                                ) : null}
                            </View>
                        ) : null}
                    </View>
                </Moldura>
            )
        case "execucao":
            return (
                <Moldura ctx={ctx} titulo={slide.titulo}>
                    {slide.linhaDoTempo ? (
                        <View style={{ marginBottom: 20 }}>
                            <View style={{ flexDirection: "row", gap: 4 }}>
                                {MESES_CURTOS.map((m, i) => {
                                    const ativo = slide.linhaDoTempo!.anoTodo || slide.linhaDoTempo!.meses.includes(i + 1)
                                    return (
                                        <View key={m} style={{ flex: 1, alignItems: "center" }}>
                                            <View style={{ width: "100%", height: 14, borderRadius: 4, backgroundColor: ativo ? cor : BORDA }} />
                                            <T style={{ fontSize: 9.5, marginTop: 5, color: ativo ? ESCURO : CINZA, fontFamily: ativo ? "Helvetica-Bold" : "Helvetica" }}>{m}</T>
                                        </View>
                                    )
                                })}
                            </View>
                            {slide.periodo ? <T style={{ fontFamily: "Helvetica-Bold", fontSize: 15, color: ESCURO, marginTop: 10 }}>{slide.periodo}</T> : null}
                        </View>
                    ) : null}
                    <View style={{ flexDirection: "row", gap: 30 }}>
                        {slide.itens.length > 0 ? (
                            <View style={{ width: 300 }}>
                                {slide.itens.map(i => <BlocoTexto key={i.rotulo} rotulo={i.rotulo} texto={i.texto} cor={cor} tamanho={12.5} />)}
                            </View>
                        ) : null}
                        {slide.como ? (
                            <View style={{ flex: 1, backgroundColor: FUNDO, borderRadius: 12, padding: 16, alignSelf: "flex-start" }}>
                                <BlocoTexto rotulo="Como será realizado" texto={slide.como} cor={cor} tamanho={12.5} />
                            </View>
                        ) : null}
                    </View>
                </Moldura>
            )
        case "orcamento": {
            const angulos = angulosDasFatias(slide.fatias)
            return (
                <Moldura ctx={ctx} titulo={slide.titulo}>
                    <View style={{ flexDirection: "row", gap: 28 }}>
                        <View style={{ width: 210, alignItems: "center" }}>
                            <Svg style={{ width: 200, height: 200 }} viewBox="0 0 200 200">
                                {slide.fatias.map((x, i) => (
                                    <Path key={x.chave} d={caminhoRosca(100, 100, 96, 58, angulos[i].inicio, angulos[i].fim)} fill={x.cor} />
                                ))}
                                {separadoresRosca(100, 100, 96, 58, angulos).map((d, i) => <Path key={`sep-${i}`} d={d} stroke="#ffffff" strokeWidth={2} />)}
                            </Svg>
                        </View>
                        <View style={{ width: 210, paddingTop: 6 }}>
                            {slide.fatias.slice(0, 7).map(x => (
                                <View key={x.chave} style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                                    <View style={{ width: 11, height: 11, borderRadius: 2, backgroundColor: x.cor }} />
                                    <T style={{ fontSize: 11.5, color: ESCURO, flex: 1 }}>{x.rotulo}</T>
                                    <T style={{ fontSize: 11.5, color: CINZA }}>{`${String(x.percentual).replace(".", ",")}%`}</T>
                                </View>
                            ))}
                        </View>
                        <View style={{ flex: 1 }}>
                            <View style={{ backgroundColor: cor, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 18, marginBottom: 14 }}>
                                <T style={{ fontSize: 10.5, color: corTexto, letterSpacing: 1 }}>TOTAL ESTIMADO</T>
                                <T style={{ fontFamily: "Helvetica-Bold", fontSize: slide.total.length > 16 ? 20 : 26, color: corTexto, marginTop: 4 }}>{slide.total}</T>
                            </View>
                            <T style={s.rotulo}>MAIORES ITENS</T>
                            {slide.maiores.map((m, i) => (
                                <View key={i} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, borderBottomWidth: 1, borderBottomColor: BORDA, paddingVertical: 5 }}>
                                    <T style={{ fontSize: 11, color: TEXTO, flex: 1 }}>{m.rotulo}</T>
                                    <T style={{ fontSize: 11, color: ESCURO, fontFamily: "Helvetica-Bold" }}>{m.valor}</T>
                                </View>
                            ))}
                        </View>
                    </View>
                </Moldura>
            )
        }
        case "metas":
            return (
                <Moldura ctx={ctx} titulo={slide.titulo}>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 16, marginTop: -6 }}>
                        {slide.metas.map((m, i) => {
                            const n = slide.inicio + i
                            const partes = [
                                m.meta ? { r: "META", t: m.meta, forte: true } : null,
                                m.indicador ? { r: "COMO SERÁ MEDIDO", t: m.indicador, forte: false } : null,
                                m.esperado ? { r: "ESPERADO", t: m.esperado, forte: true } : null,
                            ].filter((x): x is { r: string; t: string; forte: boolean } => x !== null)
                            return (
                                <View key={i} style={{ width: slide.layout === "grade" ? 416 : 848, height: 176, borderWidth: 1, borderColor: BORDA, borderRadius: 12, padding: 14, flexDirection: "row", gap: 12 }}>
                                    <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: cor, alignItems: "center", justifyContent: "center" }}>
                                        <T style={{ fontFamily: "Helvetica-Bold", fontSize: 12, color: corTexto }}>{String(n)}</T>
                                    </View>
                                    <View style={{ flex: 1 }}>
                                        {partes.map((x, j) => (
                                            <View key={x.r}>
                                                {j > 0 ? <Seta cor={cor} /> : null}
                                                <T style={{ fontFamily: "Helvetica-Bold", fontSize: 8.5, letterSpacing: 1, color: CINZA }}>{x.r}</T>
                                                <T style={{ fontSize: 11.5, lineHeight: 1.3, color: x.forte ? ESCURO : TEXTO, fontFamily: x.forte ? "Helvetica-Bold" : "Helvetica" }}>{x.t}</T>
                                            </View>
                                        ))}
                                    </View>
                                </View>
                            )
                        })}
                    </View>
                </Moldura>
            )
        case "aprendizados":
            return (
                <Moldura ctx={ctx} titulo={slide.titulo}>
                    <View style={{ flexDirection: "row", gap: 34 }}>
                        {slide.barras.length > 0 ? (
                            <View style={{ width: 300, paddingTop: 6 }}>
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
                            {slide.blocos.map(b => <BlocoTexto key={b.rotulo} rotulo={b.rotulo} texto={b.texto} cor={cor} tamanho={12} />)}
                        </View>
                    </View>
                </Moldura>
            )
        case "observacoes":
            return (
                <Moldura ctx={ctx} titulo={slide.titulo}>
                    <View style={{ borderLeftWidth: 4, borderLeftColor: cor, paddingLeft: 18 }}>
                        <T style={{ ...s.texto, fontSize: tamanhoTexto(slide.texto.length) }}>{slide.texto}</T>
                    </View>
                </Moldura>
            )
        case "continuacao":
            return (
                <Moldura ctx={ctx} titulo={slide.titulo}>
                    {slide.blocos.map((b, i) => <BlocoTexto key={i} rotulo={b.rotulo} texto={b.texto} cor={cor} tamanho={13.5} />)}
                </Moldura>
            )
    }
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
