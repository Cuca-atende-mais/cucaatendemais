import type { ReactNode } from "react"
import type { TextProps } from "@react-pdf/renderer"
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer"
import type { AbaConsolidada } from "@/lib/programacao/exportacao-consolidada"

// S-PROG-20: programação consolidada da unidade em PDF, A4 paisagem. Só desenha as abas que
// `montarAbasConsolidadas` entrega (as mesmas da tela e do .xlsx): as 4 categorias sempre, cada uma
// começando em página nova, inclusive vazias (decisão do Junior). Categoria em rascunho leva a etiqueta
// "RASCUNHO" ao lado do nome. Topo e cabeçalho da tabela se repetem em toda página da categoria; a
// linha que não cabe vai inteira para a página seguinte; texto inteiro, sem corte.
// Importado sob demanda (só ao exportar), como o Calendário Geral (S-PLA-10).

const ESCURO = "#0f172a"
const TEXTO = "#1e293b"
const CINZA = "#64748b"
const BORDA = "#94a3b8"
const VERMELHO = "#b91c1c"

const MARGEM = 26
/** Largura útil da página em paisagem (842 pt menos as margens). */
export const LARGURA_UTIL = 842 - MARGEM * 2

const s = StyleSheet.create({
    pagina: { paddingTop: MARGEM, paddingBottom: 38, paddingHorizontal: MARGEM, fontFamily: "Helvetica", fontSize: 7, color: TEXTO },
    topo: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
    titulo: { fontFamily: "Helvetica-Bold", fontSize: 12, color: ESCURO },
    linhaCategoria: { flexDirection: "row", alignItems: "center", marginTop: 3 },
    categoria: { fontFamily: "Helvetica-Bold", fontSize: 15, color: ESCURO },
    etiqueta: {
        marginLeft: 10, paddingVertical: 2, paddingHorizontal: 8, borderWidth: 1.5, borderColor: VERMELHO, borderRadius: 3,
        color: VERMELHO, fontFamily: "Helvetica-Bold", fontSize: 10, letterSpacing: 1,
    },
    // Borda na linha (esquerda/baixo) e só a direita em cada célula: borda nos 4 lados de cada célula
    // deixava a geração 2–3× mais lenta no react-pdf (medido com 110 linhas).
    linha: { flexDirection: "row", borderLeftWidth: 0.5, borderBottomWidth: 0.5, borderColor: BORDA },
    linhaCab: { borderTopWidth: 0.5 },
    celulaCab: { paddingVertical: 4, paddingHorizontal: 3, fontFamily: "Helvetica-Bold", fontSize: 7, color: "#000000", borderRightWidth: 0.5, borderColor: BORDA },
    celula: { paddingVertical: 3, paddingHorizontal: 3, borderRightWidth: 0.5, borderColor: BORDA },
    vazio: { marginTop: 18, fontSize: 10, color: CINZA },
    rodape: { position: "absolute", bottom: 16, left: MARGEM, right: MARGEM, flexDirection: "row", justifyContent: "space-between", fontSize: 7, color: CINZA },
})

/** Larguras em pontos, proporcionais ao campo `largura` das colunas, somando a largura útil. */
export function largurasColunas(aba: AbaConsolidada): number[] {
    const total = aba.colunas.reduce((soma, c) => soma + c.largura, 0) || 1
    return aba.colunas.map(c => (c.largura / total) * LARGURA_UTIL)
}

/** Frase da categoria sem atividade. */
export function textoCategoriaVazia(categoria: string): string {
    return `Nenhuma atividade de ${categoria} neste mês.`
}

const semHifen = (palavra: string) => [palavra]
type EstiloTexto = TextProps["style"]
const T = ({ style, children, ...resto }: { style?: EstiloTexto; children?: ReactNode; render?: TextProps["render"]; fixed?: boolean }) => (
    <Text style={style} hyphenationCallback={semHifen} {...resto}>{children}</Text>
)

export type DadosPdfConsolidado = {
    abas: AbaConsolidada[]
    /** "dd/mm/aaaa hh:mm" */
    geradoEm: string
    /** URL (navegador) ou caminho (teste) do logo; ausente = sem logo. */
    logo?: string
}

export function ProgramacaoConsolidadaPdfDocument({ abas, geradoEm, logo }: DadosPdfConsolidado) {
    return (
        <Document title={abas[0]?.titulo.replace(/ - RASCUNHO$/, "") ?? "Programação"} author="Rede Cuca">
            {abas.map(aba => <PaginaCategoria key={aba.categoria} aba={aba} geradoEm={geradoEm} logo={logo} />)}
        </Document>
    )
}

function PaginaCategoria({ aba, geradoEm, logo }: { aba: AbaConsolidada; geradoEm: string; logo?: string }) {
    const larguras = largurasColunas(aba)
    const fundoCab = `#${aba.cores.cabecalho}`
    const fundoLinha = aba.cores.linhas ? `#${aba.cores.linhas}` : undefined
    return (
        <Page size="A4" orientation="landscape" style={s.pagina}>
            {/* Topo: repete em toda página desta categoria. */}
            <View style={s.topo} fixed>
                {/* eslint-disable-next-line jsx-a11y/alt-text -- Image do PDF (react-pdf) não tem alt */}
                {logo && <Image src={logo} style={{ height: 28, marginRight: 12 }} />}
                <View style={{ flex: 1 }}>
                    <T style={s.titulo}>{aba.titulo}</T>
                    <View style={s.linhaCategoria}>
                        <T style={s.categoria}>{aba.categoria}</T>
                        {aba.etiqueta && <T style={s.etiqueta}>{aba.etiqueta}</T>}
                    </View>
                </View>
            </View>

            {aba.linhas.length === 0 ? (
                <T style={s.vazio}>{textoCategoriaVazia(aba.categoria)}</T>
            ) : (
                <>
                    {/* Cabeçalho da tabela: repete em toda página de continuação. */}
                    <View style={[s.linha, s.linhaCab, { backgroundColor: fundoCab }]} fixed>
                        {aba.colunas.map((c, i) => (
                            <T key={c.titulo} style={[s.celulaCab, { width: larguras[i] }]}>{c.titulo}</T>
                        ))}
                    </View>
                    {aba.linhas.map((valores, r) => (
                        <View key={r} style={fundoLinha ? [s.linha, { backgroundColor: fundoLinha }] : s.linha} wrap={false}>
                            {aba.colunas.map((c, i) => (
                                <T key={c.titulo} style={[s.celula, { width: larguras[i] }]}>{valores[i] ?? ""}</T>
                            ))}
                        </View>
                    ))}
                </>
            )}

            <View style={s.rodape} fixed>
                <T>Gerado em {geradoEm}</T>
                <T render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`} />
            </View>
        </Page>
    )
}
