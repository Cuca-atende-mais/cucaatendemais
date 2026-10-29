import type { CSSProperties, ReactNode } from "react"
import {
    ALTURA_SLIDE, LARGURA_SLIDE, MESES_CURTOS, angulosDasFatias, caminhoRosca, separadoresRosca, tamanhoTexto, respiroCapa, tamanhoTituloCapa, tamanhoValorCartao, topoCapa,
    type Apresentacao, type Slide,
} from "@/lib/planejamento/slides"

// S-PLA-05: um slide desenhado na tela. Mesma estrutura do PDF (`lib/planejamento/slides-pdf.tsx`), na
// mesma grade 960 × 540: cada medida é convertida para uma fração da largura do slide (`cqw`), então o
// mesmo componente serve para o slide grande, as miniaturas e o modo apresentar. O conteúdo vem pronto
// de `montarSlides(..., "tela")` (texto longo já cortado com reticências).

const ESCURO = "#0f172a"
const TEXTO = "#334155"
const CINZA = "#64748b"
const BORDA = "#e2e8f0"
const FUNDO = "#f8fafc"

// n unidades da grade → CSS proporcional à largura do slide.
const u = (n: number) => `calc(${n} * 100cqw / ${LARGURA_SLIDE})`

const rotulo = (cor = CINZA): CSSProperties => ({ fontWeight: 700, fontSize: u(10), letterSpacing: u(1), color: cor, marginBottom: u(6), textTransform: "uppercase" })
const corrido = (tamanho: number): CSSProperties => ({ fontSize: u(tamanho), lineHeight: 1.45, color: TEXTO, whiteSpace: "pre-wrap", overflowWrap: "anywhere" })

type Props = { slide: Slide; a: Apresentacao; numero: number; total: number; logo?: string }

export function SlideTela({ slide, a, numero, total, logo = "/logo-rede-cuca.png" }: Props) {
    return (
        <div className="relative w-full overflow-hidden bg-white" style={{ containerType: "inline-size", aspectRatio: `${LARGURA_SLIDE} / ${ALTURA_SLIDE}`, color: TEXTO }}>
            <Conteudo slide={slide} a={a} numero={numero} total={total} logo={logo} />
        </div>
    )
}

function Moldura({ a, titulo, numero, total, logo, children }: { a: Apresentacao; titulo: string; numero: number; total: number; logo: string; children: ReactNode }) {
    return (
        <>
            <h2 className="absolute m-0" style={{ left: u(56), top: u(40), right: u(120), fontWeight: 700, fontSize: u(22), color: ESCURO, letterSpacing: u(0.5), textTransform: "uppercase", lineHeight: 1.2 }}>{titulo}</h2>
            <div className="absolute" style={{ left: u(56), top: u(74), width: u(40), height: u(4), borderRadius: u(2), background: a.cor }} />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo} alt="Rede Cuca" className="absolute" style={{ right: u(48), top: u(30), width: u(46), height: u(46) }} />
            <div className="absolute overflow-hidden" style={{ left: u(56), right: u(56), top: u(108), bottom: u(64) }}>{children}</div>
            <div className="absolute inset-x-0 bottom-0" style={{ height: u(6), background: a.cor }} />
            <span className="absolute" style={{ left: u(56), bottom: u(26), fontSize: u(10), color: CINZA }}>{a.rodape}</span>
            <span className="absolute" style={{ right: u(56), bottom: u(26), fontSize: u(10), color: CINZA }}>{numero} / {total}</span>
        </>
    )
}

function Faixa({ cor }: { cor: string }) {
    return (
        <svg className="absolute right-0 top-0" style={{ width: u(420), height: "100%" }} viewBox={`0 0 420 ${ALTURA_SLIDE}`} preserveAspectRatio="none" aria-hidden>
            <polygon points={`170,0 420,0 420,${ALTURA_SLIDE} 20,${ALTURA_SLIDE}`} fill={cor} />
            <polygon points={`250,0 420,0 420,${ALTURA_SLIDE} 150,${ALTURA_SLIDE}`} fill="#ffffff" fillOpacity={0.12} />
            <polygon points="108,40 150,16 192,40 192,88 150,112 108,88" fill="none" stroke="#ffffff" strokeWidth={3} strokeOpacity={0.75} />
            {Array.from({ length: 4 }, (_, l) => Array.from({ length: 5 }, (__, c) => (
                <circle key={`${l}-${c}`} cx={300 + c * 18} cy={440 + l * 18} r={2.2} fill="#ffffff" fillOpacity={0.7} />
            )))}
        </svg>
    )
}

function Check({ cor, tamanho }: { cor: string; tamanho: number }) {
    return (
        <svg style={{ width: u(tamanho), height: u(tamanho), flexShrink: 0, marginTop: u(2) }} viewBox="0 0 20 20" aria-hidden>
            <circle cx={10} cy={10} r={10} fill={cor} />
            <path d="M5.5 10.5 L8.6 13.4 L14.5 7" stroke="#ffffff" strokeWidth={2.2} fill="none" />
        </svg>
    )
}

function Seta({ cor }: { cor: string }) {
    return (
        <svg style={{ width: u(14), height: u(9), margin: `${u(2)} 0`, display: "block" }} viewBox="0 0 14 10" aria-hidden>
            <path d="M7 0 L7 7 M3 4 L7 8.5 L11 4" stroke={cor} strokeWidth={1.8} fill="none" />
        </svg>
    )
}

function BlocoTexto({ rotulo: r, texto, cor, tamanho = 14 }: { rotulo: string; texto: string; cor: string; tamanho?: number }) {
    return (
        <div style={{ marginBottom: u(16) }}>
            <div style={rotulo(cor)}>{r}</div>
            <div style={corrido(tamanho)}>{texto}</div>
        </div>
    )
}

function Conteudo({ slide, a, numero, total, logo }: Props & { logo: string }) {
    const { cor, corTexto } = a
    const m = { a, numero, total, logo, titulo: slide.titulo }
    switch (slide.tipo) {
        case "capa":
        case "encerramento": {
            const capa = slide.tipo === "capa"
            return (
                <>
                    <Faixa cor={cor} />
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={logo} alt="Rede Cuca" className="absolute" style={{ left: u(56), top: u(40), width: u(64), height: u(64) }} />
                    <div className="absolute" style={{ left: u(56), top: u(capa ? topoCapa(slide.nome) : 140), width: u(470) }}>
                        <div style={{ ...rotulo(cor), fontSize: u(12) }}>{capa && a.setor ? `Planejamento 2027 · ${a.setor}` : "Planejamento 2027"}</div>
                        {capa ? (
                            <div style={{ fontWeight: 700, fontSize: u(tamanhoTituloCapa(slide.nome)), color: ESCURO, lineHeight: 1.1, marginTop: u(6), overflowWrap: "anywhere" }}>{slide.nome}</div>
                        ) : (
                            <>
                                <div style={{ fontWeight: 700, fontSize: u(60), color: ESCURO, marginTop: u(6), lineHeight: 1.1 }}>Obrigado</div>
                                <div style={{ fontSize: u(18), color: CINZA, marginTop: u(4) }}>pela atenção</div>
                            </>
                        )}
                        <div style={{ width: u(56), height: u(5), borderRadius: u(3), background: cor, margin: `${u(capa ? respiroCapa(slide.nome) : 22)} 0` }} />
                        {capa && (
                            <div className="flex flex-wrap" style={{ gap: u(10) }}>
                                {a.setor && <span style={{ background: cor, color: corTexto, borderRadius: u(12), padding: `${u(6)} ${u(12)}`, fontSize: u(12), fontWeight: 700 }}>{a.setor}</span>}
                                <span style={{ border: `1px solid ${BORDA}`, borderRadius: u(12), padding: `${u(6)} ${u(12)}`, fontSize: u(12) }}>{slide.tipoProjeto}</span>
                            </div>
                        )}
                        {(capa ? slide.responsavel : slide.responsavel || slide.contato) && (
                            <div style={{ marginTop: u(capa ? respiroCapa(slide.nome) + 4 : 26) }}>
                                <div style={rotulo()}>Responsável</div>
                                {slide.responsavel && <div style={{ fontSize: u(16), color: ESCURO, fontWeight: 700 }}>{slide.responsavel}</div>}
                                {slide.tipo === "encerramento" && slide.contato && <div style={{ fontSize: u(14), marginTop: u(4) }}>{slide.contato}</div>}
                            </div>
                        )}
                    </div>
                    <span className="absolute" style={{ left: u(56), bottom: u(26), fontSize: u(10), color: CINZA }}>{a.rodape}</span>
                </>
            )
        }
        case "numeros":
            return (
                <Moldura {...m}>
                    <div className="flex" style={{ gap: u(20), marginTop: u(40) }}>
                        {slide.cartoes.map(c => (
                            <div key={c.rotulo} className="flex flex-1 flex-col items-center text-center" style={{ border: `1px solid ${BORDA}`, borderRadius: u(14), padding: `${u(36)} ${u(18)}` }}>
                                <div style={{ width: u(34), height: u(4), borderRadius: u(2), background: cor, marginBottom: u(22) }} />
                                <div style={{ fontWeight: 700, fontSize: u(tamanhoValorCartao(c.valor)), color: cor, lineHeight: 1.15 }}>{c.valor}</div>
                                <div style={{ fontSize: u(12), color: CINZA, marginTop: u(10) }}>{c.rotulo}</div>
                            </div>
                        ))}
                    </div>
                </Moldura>
            )
        case "porque": {
            const tamanho = tamanhoTexto(slide.blocos.reduce((t, x) => t + x.texto.length, 0))
            return (
                <Moldura {...m}>
                    <div className="flex" style={{ gap: u(40) }}>
                        <div style={{ width: u(280), paddingTop: u(10), flexShrink: 0 }}>
                            <div style={rotulo()}>Situação em relação a 2026</div>
                            <div className="inline-block" style={{ background: cor, color: corTexto, borderRadius: u(14), padding: `${u(18)} ${u(22)}`, fontWeight: 700, fontSize: u(slide.selo.length > 10 ? 22 : 30), letterSpacing: u(1), lineHeight: 1.15 }}>{slide.selo}</div>
                        </div>
                        <div className="flex-1" style={{ paddingTop: u(10) }}>
                            {slide.blocos.map(b => <BlocoTexto key={b.rotulo} rotulo={b.rotulo} texto={b.texto} cor={cor} tamanho={tamanho} />)}
                        </div>
                    </div>
                </Moldura>
            )
        }
        case "objetivos":
            return (
                <Moldura {...m}>
                    {slide.objetivoGeral && (
                        <div style={{ borderLeft: `${u(4)} solid ${cor}`, paddingLeft: u(16), marginBottom: u(18) }}>
                            <div style={rotulo()}>Objetivo geral</div>
                            <div style={{ fontSize: u(17), lineHeight: 1.35, color: ESCURO }}>{slide.objetivoGeral}</div>
                        </div>
                    )}
                    <div className="flex" style={{ gap: u(30) }}>
                        {slide.especificos.length > 0 && (
                            <div className="flex-1">
                                <div style={rotulo()}>Objetivos específicos</div>
                                {slide.especificos.map((o, i) => (
                                    <div key={i} className="flex items-start" style={{ gap: u(10), marginBottom: u(7) }}>
                                        <Check cor={cor} tamanho={14} />
                                        <span style={corrido(12.5)}>{o}</span>
                                    </div>
                                ))}
                                {slide.maisEspecificos > 0 && <div style={{ fontSize: u(11.5), color: CINZA }}>… e mais {slide.maisEspecificos}</div>}
                            </div>
                        )}
                        {(slide.publico || slide.faixa) && (
                            <div className="self-start" style={{ width: u(250), background: FUNDO, borderRadius: u(12), padding: u(16), flexShrink: 0 }}>
                                {slide.publico && <BlocoTexto rotulo="Público-alvo" texto={slide.publico} cor={cor} tamanho={12.5} />}
                                {slide.faixa && (
                                    <div>
                                        <div style={rotulo(cor)}>Faixa etária</div>
                                        <div style={{ fontWeight: 700, fontSize: u(20), color: ESCURO }}>{slide.faixa}</div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </Moldura>
            )
        case "execucao":
            return (
                <Moldura {...m}>
                    {slide.linhaDoTempo && (
                        <div style={{ marginBottom: u(20) }}>
                            <div className="flex" style={{ gap: u(4) }}>
                                {MESES_CURTOS.map((mes, i) => {
                                    const ativo = slide.linhaDoTempo!.anoTodo || slide.linhaDoTempo!.meses.includes(i + 1)
                                    return (
                                        <div key={mes} className="flex flex-1 flex-col items-center">
                                            <div className="w-full" style={{ height: u(14), borderRadius: u(4), background: ativo ? cor : BORDA }} />
                                            <span style={{ fontSize: u(9.5), marginTop: u(5), color: ativo ? ESCURO : CINZA, fontWeight: ativo ? 700 : 400 }}>{mes}</span>
                                        </div>
                                    )
                                })}
                            </div>
                            {slide.periodo && <div style={{ fontWeight: 700, fontSize: u(15), color: ESCURO, marginTop: u(10) }}>{slide.periodo}</div>}
                        </div>
                    )}
                    <div className="flex" style={{ gap: u(30) }}>
                        {slide.itens.length > 0 && (
                            <div style={{ width: u(300), flexShrink: 0 }}>
                                {slide.itens.map(i => <BlocoTexto key={i.rotulo} rotulo={i.rotulo} texto={i.texto} cor={cor} tamanho={12.5} />)}
                            </div>
                        )}
                        {slide.como && (
                            <div className="flex-1 self-start" style={{ background: FUNDO, borderRadius: u(12), padding: u(16) }}>
                                <BlocoTexto rotulo="Como será realizado" texto={slide.como} cor={cor} tamanho={12.5} />
                            </div>
                        )}
                    </div>
                </Moldura>
            )
        case "orcamento": {
            const angulos = angulosDasFatias(slide.fatias)
            return (
                <Moldura {...m}>
                    <div className="flex" style={{ gap: u(28) }}>
                        <div className="flex justify-center" style={{ width: u(210), flexShrink: 0 }}>
                            <svg style={{ width: u(200), height: u(200) }} viewBox="0 0 200 200" role="img" aria-label="Orçamento por categoria">
                                {slide.fatias.map((x, i) => (
                                    <path key={x.chave} d={caminhoRosca(100, 100, 96, 58, angulos[i].inicio, angulos[i].fim)} fill={x.cor} />
                                ))}
                                {separadoresRosca(100, 100, 96, 58, angulos).map((d, i) => <path key={`sep-${i}`} d={d} stroke="#ffffff" strokeWidth={2} />)}
                            </svg>
                        </div>
                        <div style={{ width: u(210), paddingTop: u(6), flexShrink: 0 }}>
                            {slide.fatias.slice(0, 7).map(x => (
                                <div key={x.chave} className="flex items-center" style={{ gap: u(8), marginBottom: u(8) }}>
                                    <span style={{ width: u(11), height: u(11), borderRadius: u(2), background: x.cor, flexShrink: 0 }} />
                                    <span className="flex-1" style={{ fontSize: u(11.5), color: ESCURO }}>{x.rotulo}</span>
                                    <span style={{ fontSize: u(11.5), color: CINZA }}>{String(x.percentual).replace(".", ",")}%</span>
                                </div>
                            ))}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div style={{ background: cor, color: corTexto, borderRadius: u(12), padding: `${u(14)} ${u(18)}`, marginBottom: u(14) }}>
                                <div style={{ fontSize: u(10.5), letterSpacing: u(1) }}>TOTAL ESTIMADO</div>
                                <div style={{ fontWeight: 700, fontSize: u(slide.total.length > 16 ? 20 : 26), marginTop: u(4) }}>{slide.total}</div>
                            </div>
                            <div style={rotulo()}>Maiores itens</div>
                            {slide.maiores.map((x, i) => (
                                <div key={i} className="flex justify-between" style={{ gap: u(8), borderBottom: `1px solid ${BORDA}`, padding: `${u(5)} 0` }}>
                                    <span className="min-w-0 flex-1 truncate" style={{ fontSize: u(11) }}>{x.rotulo}</span>
                                    <span style={{ fontSize: u(11), color: ESCURO, fontWeight: 700 }}>{x.valor}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </Moldura>
            )
        }
        case "metas":
            return (
                <Moldura {...m}>
                    <div className="flex flex-wrap" style={{ gap: u(16), marginTop: u(-6) }}>
                        {slide.metas.map((meta, i) => {
                            const n = slide.inicio + i
                            const partes = [
                                meta.meta ? { r: "Meta", t: meta.meta, forte: true } : null,
                                meta.indicador ? { r: "Como será medido", t: meta.indicador, forte: false } : null,
                                meta.esperado ? { r: "Esperado", t: meta.esperado, forte: true } : null,
                            ].filter((x): x is { r: string; t: string; forte: boolean } => x !== null)
                            return (
                                <div key={i} className="flex overflow-hidden" style={{ width: u(slide.layout === "grade" ? 416 : 848), height: u(176), border: `1px solid ${BORDA}`, borderRadius: u(12), padding: u(14), gap: u(12) }}>
                                    <span className="flex shrink-0 items-center justify-center" style={{ width: u(26), height: u(26), borderRadius: "50%", background: cor, color: corTexto, fontWeight: 700, fontSize: u(12) }}>{n}</span>
                                    <div className="min-w-0 flex-1">
                                        {partes.map((x, j) => (
                                            <div key={x.r}>
                                                {j > 0 && <Seta cor={cor} />}
                                                <div style={{ fontWeight: 700, fontSize: u(8.5), letterSpacing: u(1), color: CINZA, textTransform: "uppercase" }}>{x.r}</div>
                                                <div style={{ fontSize: u(11.5), lineHeight: 1.3, color: x.forte ? ESCURO : TEXTO, fontWeight: x.forte ? 700 : 400, overflowWrap: "anywhere" }}>{x.t}</div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </Moldura>
            )
        case "aprendizados":
            return (
                <Moldura {...m}>
                    <div className="flex" style={{ gap: u(34) }}>
                        {slide.barras.length > 0 && (
                            <div style={{ width: u(300), paddingTop: u(6), flexShrink: 0 }}>
                                <div style={rotulo()}>Participantes</div>
                                {slide.barras.map((b, i) => (
                                    <div key={b.rotulo} style={{ marginBottom: u(18) }}>
                                        <div style={{ fontSize: u(11.5), color: CINZA, marginBottom: u(5) }}>{b.rotulo}</div>
                                        <div className="flex items-center" style={{ gap: u(10) }}>
                                            <div style={{ width: u(Math.max(8, 210 * b.proporcao)), height: u(30), borderRadius: u(6), background: i === 0 ? "#94a3b8" : cor }} />
                                            <span style={{ fontWeight: 700, fontSize: u(18), color: ESCURO }}>{b.valorTexto}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="min-w-0 flex-1">
                            {slide.blocos.map(b => <BlocoTexto key={b.rotulo} rotulo={b.rotulo} texto={b.texto} cor={cor} tamanho={12} />)}
                        </div>
                    </div>
                </Moldura>
            )
        case "observacoes":
            return (
                <Moldura {...m}>
                    <div style={{ borderLeft: `${u(4)} solid ${cor}`, paddingLeft: u(18) }}>
                        <div style={corrido(tamanhoTexto(slide.texto.length))}>{slide.texto}</div>
                    </div>
                </Moldura>
            )
        case "continuacao":
            return (
                <Moldura {...m}>
                    {slide.blocos.map((b, i) => <BlocoTexto key={i} rotulo={b.rotulo} texto={b.texto} cor={cor} tamanho={13.5} />)}
                </Moldura>
            )
    }
}
