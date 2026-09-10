import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer"
import { AbaExportacao, CampanhaParaExportacao } from "./exportacao"

// S-PROG-05 (item 4): layout de leitura — uma seção por categoria, mesmas colunas do XLSX
// (reusa `montarAbasExportacao`, mesmos headers/linhas/"—"). Diferente do XLSX (formato rígido
// pra gráfica), aqui ementa/informações finalmente têm espaço pra quebrar linha — é o motivo de
// existir um segundo formato, não só o mesmo conteúdo em outra extensão.

const styles = StyleSheet.create({
    page: { paddingTop: 32, paddingBottom: 32, paddingHorizontal: 36, fontSize: 9.5, color: "#111", lineHeight: 1.4 },
    headerTitulo: { fontSize: 16, fontWeight: 700, color: "#1a2e5a", marginBottom: 2 },
    headerSub: { fontSize: 10, color: "#555", marginBottom: 14 },
    sectionHeader: { borderBottomWidth: 1.5, borderBottomColor: "#1a4a7a", paddingBottom: 3, marginBottom: 8, marginTop: 16 },
    sectionTitle: { fontSize: 12.5, fontWeight: 700, color: "#1a2e5a" },
    card: { borderWidth: 1, borderColor: "#ddd", borderRadius: 4, padding: 8, marginBottom: 6 },
    cardTitulo: { fontSize: 10.5, fontWeight: 700, color: "#1a4a7a", marginBottom: 3 },
    linha: { flexDirection: "row", marginVertical: 1 },
    label: { fontWeight: 700, color: "#333", width: 90 },
    valor: { flex: 1, color: "#222" },
    textoLongo: { marginTop: 3, color: "#333", textAlign: "justify" },
    vazio: { fontSize: 10, color: "#777", textAlign: "center", marginTop: 40 },
})

// Colunas que já têm espaço curto de sobra e ficam melhor num grid compacto; ementa/informações
// (texto longo) sempre vão em bloco próprio embaixo, com quebra de linha — nunca no grid.
const CAMPOS_TEXTO_LONGO = new Set(["Ementa", "Informações"])

function Campo({ label, valor }: { label: string; valor: string | number }) {
    return (
        <View style={styles.linha}>
            <Text style={styles.label}>{label}:</Text>
            <Text style={styles.valor}>{String(valor)}</Text>
        </View>
    )
}

function CardAtividade({ aba, linha }: { aba: AbaExportacao; linha: (string | number)[] }) {
    // linha[0] é sempre "#" (índice), o "nome" da atividade é a 2ª coluna em todas as categorias
    // exceto DIA A DIA/ESPECIAIS, onde a 2ª coluna é "Sessão" e o nome vem na coluna "Atividade".
    const idxNome = aba.chave === "DIA A DIA" || aba.chave === "ESPECIAIS"
        ? aba.headers.indexOf("Atividade")
        : 1
    const nome = String(linha[idxNome] ?? "")
    const camposCurtos = aba.headers
        .map((h, i) => ({ label: h, valor: linha[i] }))
        .filter(({ label }, i) => i !== 0 && i !== idxNome && !CAMPOS_TEXTO_LONGO.has(label))
    const camposLongos = aba.headers
        .map((h, i) => ({ label: h, valor: linha[i] }))
        .filter(({ label }) => CAMPOS_TEXTO_LONGO.has(label))

    return (
        <View style={styles.card} wrap={false}>
            <Text style={styles.cardTitulo}>{nome}</Text>
            {camposCurtos.map(({ label, valor }) => <Campo key={label} label={label} valor={valor} />)}
            {camposLongos.map(({ label, valor }) => (
                <View key={label}>
                    <Text style={{ ...styles.label, marginTop: 4 }}>{label}:</Text>
                    <Text style={styles.textoLongo}>{String(valor)}</Text>
                </View>
            ))}
        </View>
    )
}

export function ProgramacaoPdfDocument({ campanha, abas }: { campanha: CampanhaParaExportacao; abas: AbaExportacao[] }) {
    const nomeMes = ["", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto",
        "Setembro", "Outubro", "Novembro", "Dezembro"][campanha.mes] || String(campanha.mes)

    return (
        <Document>
            <Page size="A4" style={styles.page}>
                <Text style={styles.headerTitulo}>Programação Mensal — {campanha.unidade_cuca}</Text>
                <Text style={styles.headerSub}>{nomeMes} de {campanha.ano}</Text>

                {abas.length === 0 && <Text style={styles.vazio}>Nenhuma atividade nesta programação.</Text>}

                {abas.map(aba => (
                    <View key={aba.chave}>
                        <View style={styles.sectionHeader}>
                            <Text style={styles.sectionTitle}>{aba.chave === "DIA A DIA" ? "Dia a Dia" : aba.chave[0] + aba.chave.slice(1).toLowerCase()}</Text>
                        </View>
                        {aba.linhas.map((linha, i) => (
                            <CardAtividade key={i} aba={aba} linha={linha} />
                        ))}
                    </View>
                ))}
            </Page>
        </Document>
    )
}
