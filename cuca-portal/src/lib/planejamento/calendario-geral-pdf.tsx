import type { ReactNode } from "react"
import type { TextProps } from "@react-pdf/renderer"
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer"
import { MESES } from "./lista"
import { ANO_PLANEJAMENTO } from "./projeto"
import { corTextoSobre } from "./slides"
import {
    CABECALHO_GRADE, EXPLICACAO_MESES, colunaFimDeSemana, rotuloDatas, type AtividadesDoAno, type CelulaDia, type MesGrade,
    type ProjetoCalendarioGeral, type SetorCalendario,
} from "./calendario-geral"

// S-PLA-10: Calendário Geral em PDF, A4 paisagem. Página 1: a grade do ano (formato calendário escolar),
// a legenda e as atividades do ano todo. Páginas seguintes: as atividades de cada mês, dois meses lado a
// lado, como no calendário oficial (Data · Ação · Área/Setor · Responsável). Texto inteiro, sem corte.
// Importado sob demanda (só ao exportar).

const ESCURO = "#0f172a"
const TEXTO = "#334155"
const CINZA = "#64748b"
const BORDA = "#cbd5e1"
const FUNDO_FDS = "#e2e8f0"
const FUNDO_VAZIO = "#f8fafc"

const MARGEM = 26
const LARGURA_MES = 62
const ALTURA_LINHA = 22

const s = StyleSheet.create({
    pagina: { paddingTop: MARGEM, paddingBottom: 40, paddingHorizontal: MARGEM, fontFamily: "Helvetica", fontSize: 8.5, color: TEXTO },
    topo: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
    titulo: { fontFamily: "Helvetica-Bold", fontSize: 17, color: ESCURO },
    subtitulo: { fontSize: 8.5, color: CINZA, marginTop: 2 },
    linha: { flexDirection: "row" },
    celulaCab: { height: 14, alignItems: "center", justifyContent: "center", fontFamily: "Helvetica-Bold", fontSize: 7, color: CINZA },
    rotuloMes: { width: LARGURA_MES, height: ALTURA_LINHA, justifyContent: "center", paddingLeft: 4, fontFamily: "Helvetica-Bold", fontSize: 8.5, color: ESCURO, borderBottomWidth: 0.5, borderColor: BORDA },
    dia: { height: ALTURA_LINHA, borderRightWidth: 0.5, borderBottomWidth: 0.5, borderColor: "#ffffff", position: "relative" },
    numero: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
    bolinha: { width: 13, height: 13, borderRadius: 6.5, backgroundColor: "#ffffff", alignItems: "center", justifyContent: "center" },
    legenda: { flexDirection: "row", flexWrap: "wrap", marginTop: 10, alignItems: "center" },
    chip: { flexDirection: "row", alignItems: "center", marginRight: 12, marginBottom: 4 },
    quadrado: { width: 10, height: 10, borderRadius: 2, marginRight: 4 },
    secao: { fontFamily: "Helvetica-Bold", fontSize: 11, color: ESCURO, marginTop: 12, marginBottom: 6 },
    anoTodo: { flexDirection: "row", flexWrap: "wrap" },
    pilula: { paddingVertical: 3, paddingHorizontal: 6, borderRadius: 3, marginRight: 4, marginBottom: 4, fontSize: 8 },
    paresMeses: { flexDirection: "row", justifyContent: "space-between", marginBottom: 12 },
    blocoMes: { width: "49%" },
    cabMes: { backgroundColor: ESCURO, color: "#ffffff", fontFamily: "Helvetica-Bold", fontSize: 10, paddingVertical: 4, paddingHorizontal: 6, textAlign: "center" },
    cabTabela: { flexDirection: "row", backgroundColor: "#e2e8f0", fontFamily: "Helvetica-Bold", fontSize: 7.5, color: ESCURO },
    linhaTabela: { flexDirection: "row", borderBottomWidth: 0.5, borderColor: BORDA },
    celulaTabela: { paddingVertical: 3, paddingHorizontal: 4 },
    vazio: { paddingVertical: 6, paddingHorizontal: 6, color: CINZA, fontSize: 8 },
    rodape: { position: "absolute", bottom: 16, left: MARGEM, right: MARGEM, flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, color: CINZA },
})

// Larguras das colunas da tabela do mês (somam 100%).
const COL = { data: "17%", acao: "45%", setor: "19%", resp: "19%" } as const

// Altura estimada de um mês na tabela (em pontos), para decidir se o par de meses vai inteiro para a
// página seguinte em vez de partir no meio (sem cabeçalho na continuação). Conta as linhas que o texto
// ocupa em cada coluna (caracteres por linha medidos no PDF com a fonte 8,5).
export const ALTURA_DISPONIVEL = 595 - MARGEM - 40 - 30
export function alturaEstimadaMes(projetos: ProjetoCalendarioGeral[], nomeSetor: (id: string) => string): number {
    const linhas = (t: string, porLinha: number) => Math.max(1, Math.ceil(t.length / porLinha))
    const corpo = projetos.reduce((total, p) => total + 6 + 10.5 * Math.max(linhas(p.nome, 34), linhas(nomeSetor(p.setor_id), 15), linhas(p.responsavel_nome ?? "", 16)), 0)
    return 36 + Math.max(corpo, 20)
}

const semHifen = (palavra: string) => [palavra]
type EstiloTexto = TextProps["style"]
const T = ({ style, children, ...resto }: { style?: EstiloTexto; children?: ReactNode; render?: (p: { pageNumber: number; totalPages: number }) => string; fixed?: boolean }) => (
    <Text style={style} hyphenationCallback={semHifen} {...resto}>{children}</Text>
)

export type DadosCalendarioGeralPdf = {
    grade: MesGrade[]
    atividades: AtividadesDoAno
    setores: SetorCalendario[] // todos (para nome e cor de cada projeto)
    legenda: SetorCalendario[] // os ligados na tela (para a legenda)
    contagem: Map<string, number>
    geradoEm: string
    filtrosTexto: string // "" = sem filtro
    logo: string
}

export function CalendarioGeralPdfDocument(d: DadosCalendarioGeralPdf) {
    const setorPorId = new Map(d.setores.map(x => [x.id, x]))
    const cor = (id: string) => setorPorId.get(id)?.cor ?? CINZA
    const nome = (id: string) => setorPorId.get(id)?.nome ?? ""
    const pares: number[][] = Array.from({ length: 6 }, (_, i) => [i * 2 + 1, i * 2 + 2])

    return (
        <Document title={`Calendário Geral ${ANO_PLANEJAMENTO}`} author="Rede Cuca">
            <Page size="A4" orientation="landscape" style={s.pagina}>
                <View style={s.topo}>
                    {/* eslint-disable-next-line jsx-a11y/alt-text -- Image do PDF (react-pdf) não tem alt */}
                    <Image src={d.logo} style={{ height: 30, marginRight: 12 }} />
                    <View style={{ flex: 1 }}>
                        <T style={s.titulo}>Calendário Geral {ANO_PLANEJAMENTO}</T>
                        <T style={s.subtitulo}>Atividades do Planejamento {ANO_PLANEJAMENTO} por dia, na cor do setor{d.filtrosTexto ? ` · ${d.filtrosTexto}` : ""}</T>
                    </View>
                </View>

                {/* Grade do ano */}
                <View style={s.linha}>
                    <View style={{ width: LARGURA_MES }} />
                    {CABECALHO_GRADE.map((l, i) => (
                        <View key={i} style={[s.celulaCab, { flex: 1, backgroundColor: colunaFimDeSemana(i) ? FUNDO_FDS : undefined }]}><T>{l}</T></View>
                    ))}
                </View>
                {d.grade.map(m => (
                    <View key={m.mes} style={s.linha} wrap={false}>
                        <View style={s.rotuloMes}><T>{m.nome}</T></View>
                        {m.celulas.map((c, i) => <DiaPdf key={i} celula={c} coluna={i} cor={cor} />)}
                    </View>
                ))}

                <Legenda setores={d.legenda} contagem={d.contagem} />

                {d.atividades.anoTodo.length > 0 && (
                    <View wrap={false}>
                        <T style={s.secao}>Durante o ano todo</T>
                        <View style={s.anoTodo}>
                            {d.atividades.anoTodo.map(p => (
                                <T key={p.id} style={[s.pilula, { backgroundColor: cor(p.setor_id), color: corTextoSobre(cor(p.setor_id)) }]}>{p.nome} · {nome(p.setor_id)}</T>
                            ))}
                        </View>
                    </View>
                )}
                <Rodape geradoEm={d.geradoEm} />
            </Page>

            <Page size="A4" orientation="landscape" style={s.pagina}>
                <T style={[s.titulo, { fontSize: 14 }]}>Atividades por mês</T>
                <T style={[s.subtitulo, { marginBottom: 8 }]}>{EXPLICACAO_MESES}</T>
                {pares.map(par => {
                    const altura = Math.max(...par.map(m => alturaEstimadaMes(d.atividades.meses[m], nome)))
                    // Cabe numa página: vai inteiro (não parte no meio). Não cabe: parte, porque não há outra saída.
                    return (
                    <View key={par[0]} style={s.paresMeses} wrap={altura > ALTURA_DISPONIVEL}>
                        {par.map(mes => <TabelaMes key={mes} mes={mes} projetos={d.atividades.meses[mes]} cor={cor} nome={nome} />)}
                    </View>
                    )
                })}
                {d.atividades.semPeriodo.length > 0 && (
                    <View>
                        <T style={s.secao}>Sem período definido</T>
                        {d.atividades.semPeriodo.map(p => (
                            <View key={p.id} style={s.linhaTabela} wrap={false}>
                                <View style={[s.quadrado, { backgroundColor: cor(p.setor_id), marginTop: 4 }]} />
                                <T style={[s.celulaTabela, { flex: 1 }]}>{p.nome} · {nome(p.setor_id)}{p.responsavel_nome ? ` · ${p.responsavel_nome}` : ""}</T>
                            </View>
                        ))}
                    </View>
                )}
                <Rodape geradoEm={d.geradoEm} />
            </Page>
        </Document>
    )
}

function Rodape({ geradoEm }: { geradoEm: string }) {
    return (
        <View style={s.rodape} fixed>
            <T>Calendário Geral {ANO_PLANEJAMENTO} · Planejamento Rede Cuca · gerado em {geradoEm}</T>
            <T render={({ pageNumber, totalPages }) => `página ${pageNumber} de ${totalPages}`} />
        </View>
    )
}

function DiaPdf({ celula: c, coluna, cor }: { celula: CelulaDia | null; coluna: number; cor: (id: string) => string }) {
    if (!c) return <View style={[s.dia, { flex: 1, backgroundColor: FUNDO_VAZIO }]} />
    const fundo = c.fimDeSemana ? FUNDO_FDS : "#ffffff"
    if (c.setores.length === 0) {
        return (
            <View style={[s.dia, { flex: 1, backgroundColor: fundo }]}>
                <View style={s.numero}><T style={{ fontSize: 7.5, color: colunaFimDeSemana(coluna) ? CINZA : TEXTO }}>{c.dia}</T></View>
            </View>
        )
    }
    // Um setor: célula cheia na cor dele. Vários: faixas verticais, uma por setor, e o número numa bolinha branca.
    const um = c.setores.length === 1
    return (
        <View style={[s.dia, { flex: 1, flexDirection: "row" }]}>
            {c.setores.map(id => <View key={id} style={{ flex: 1, backgroundColor: cor(id) }} />)}
            <View style={s.numero}>
                {um ? (
                    <T style={{ fontSize: 7.5, fontFamily: "Helvetica-Bold", color: corTextoSobre(cor(c.setores[0])) }}>{c.dia}</T>
                ) : (
                    <View style={s.bolinha}><T style={{ fontSize: 6.5, fontFamily: "Helvetica-Bold", color: ESCURO }}>{c.dia}</T></View>
                )}
            </View>
        </View>
    )
}

function Legenda({ setores, contagem }: { setores: SetorCalendario[]; contagem: Map<string, number> }) {
    return (
        <View style={s.legenda}>
            <T style={{ fontFamily: "Helvetica-Bold", marginRight: 8, marginBottom: 4 }}>Legenda:</T>
            {setores.map(x => (
                <View key={x.id} style={s.chip}>
                    <View style={[s.quadrado, { backgroundColor: x.cor }]} />
                    <T>{x.nome} ({contagem.get(x.id) ?? 0})</T>
                </View>
            ))}
            <View style={s.chip}>
                <View style={[s.quadrado, { flexDirection: "row", overflow: "hidden" }]}>
                    {setores.slice(0, 3).map(x => <View key={x.id} style={{ flex: 1, backgroundColor: x.cor }} />)}
                </View>
                <T>Mais de um setor no dia</T>
            </View>
            <View style={s.chip}>
                <View style={[s.quadrado, { backgroundColor: FUNDO_FDS }]} />
                <T>Fim de semana</T>
            </View>
        </View>
    )
}

function TabelaMes({ mes, projetos, cor, nome }: { mes: number; projetos: ProjetoCalendarioGeral[]; cor: (id: string) => string; nome: (id: string) => string }) {
    return (
        <View style={s.blocoMes}>
            <View wrap={false}>
                <T style={s.cabMes}>{MESES[mes - 1].toUpperCase()}</T>
                <View style={s.cabTabela}>
                    <T style={[s.celulaTabela, { width: COL.data }]}>Data</T>
                    <T style={[s.celulaTabela, { width: COL.acao }]}>Ação</T>
                    <T style={[s.celulaTabela, { width: COL.setor }]}>Área/Setor</T>
                    <T style={[s.celulaTabela, { width: COL.resp }]}>Responsável</T>
                </View>
            </View>
            {projetos.length === 0 ? (
                <T style={s.vazio}>Nenhuma atividade começa neste mês.</T>
            ) : projetos.map(p => {
                const c = cor(p.setor_id)
                return (
                    <View key={p.id} style={s.linhaTabela} wrap={false}>
                        <T style={[s.celulaTabela, { width: COL.data, backgroundColor: c, color: corTextoSobre(c), fontFamily: "Helvetica-Bold" }]}>{rotuloDatas(p)}</T>
                        <T style={[s.celulaTabela, { width: COL.acao, color: ESCURO }]}>{p.nome}</T>
                        <T style={[s.celulaTabela, { width: COL.setor }]}>{nome(p.setor_id)}</T>
                        <T style={[s.celulaTabela, { width: COL.resp }]}>{p.responsavel_nome ?? ""}</T>
                    </View>
                )
            })}
        </View>
    )
}
