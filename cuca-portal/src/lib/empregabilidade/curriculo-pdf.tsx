import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer"
import { differenceInMonths, parse } from "date-fns"
import type { CvDados, Experiencia } from "./curriculo-tipos"

// SQS-57 (T2) — espelha o layout de /empregabilidade/print/[id]/page.tsx (a tela
// de impressão continua sendo a prévia; este componente é o artefato oficial
// armazenado). Mudança de layout em um dos dois exige revisar o outro — não há
// import compartilhado de propósito, ver curriculo-tipos.ts.

function formatPeriodo(inicio: string, fim: string, atual: boolean): string {
    if (!inicio) return ""
    const fimStr = atual ? "Atual" : (fim || "")
    return fimStr ? `${inicio} – ${fimStr}` : inicio
}

function normalizarData(s: string): string {
    const digits = (s || "").replace(/\D/g, "")
    if (digits.length === 6) return `${digits.slice(0, 2)}/${digits.slice(2)}`
    return s
}

function calcPermanencia(inicio: string, fim: string, atual: boolean): string {
    if (!inicio) return ""
    try {
        const start = parse(`01/${normalizarData(inicio)}`, "dd/MM/yyyy", new Date())
        const end = atual ? new Date() : (fim ? parse(`01/${normalizarData(fim)}`, "dd/MM/yyyy", new Date()) : new Date())
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return ""
        const meses = differenceInMonths(end, start)
        if (meses <= 0) return ""
        const anos = Math.floor(meses / 12)
        const resto = meses % 12
        if (anos > 0 && resto > 0) return `${anos} ano${anos > 1 ? "s" : ""} e ${resto} mês${resto > 1 ? "es" : ""}`
        if (anos > 0) return `${anos} ano${anos > 1 ? "s" : ""}`
        return `${resto} mês${resto > 1 ? "es" : ""}`
    } catch { return "" }
}

const styles = StyleSheet.create({
    page: { paddingTop: 34, paddingBottom: 34, paddingHorizontal: 42, fontSize: 10.5, color: "#111", lineHeight: 1.5 },
    nome: { fontSize: 22, fontWeight: 700, color: "#1a2e5a", marginBottom: 4 },
    contatoLinha: { fontSize: 9, color: "#333", marginVertical: 1, flexDirection: "row", flexWrap: "wrap" },
    contatoLabel: { fontWeight: 700 },
    separador: { marginVertical: 2, color: "#aaa" },
    hr: { borderBottomWidth: 1.2, borderBottomColor: "#ccc", marginVertical: 8 },
    apresentacao: { fontSize: 9.5, textAlign: "justify", color: "#222", marginBottom: 8, lineHeight: 1.5 },
    objetivo: { fontSize: 10.5, fontWeight: 700, color: "#1a4a7a", textAlign: "center", marginBottom: 8 },
    sectionHeader: { borderBottomWidth: 1.5, borderBottomColor: "#1a4a7a", paddingBottom: 3, marginBottom: 8, marginTop: 14 },
    sectionTitle: { fontSize: 12.5, fontWeight: 700, color: "#1a2e5a" },
    expBlock: { marginBottom: 10 },
    expCargo: { color: "#1a4a7a", fontWeight: 700, fontSize: 11, marginBottom: 2 },
    expMeta: { color: "#555", fontSize: 9, marginBottom: 3 },
    atividade: { fontSize: 9, paddingLeft: 12, marginVertical: 1, color: "#333" },
    linhaSimples: { fontSize: 10, marginVertical: 4 },
    strong: { fontWeight: 700 },
    muted: { color: "#555" },
    habBlock: { marginTop: 3 },
    hab: { fontSize: 9.5, marginVertical: 3 },
})

function ContatoLinha({ itens }: { itens: { label: string; value: string }[] }) {
    const filtrados = itens.filter(i => i.value)
    if (filtrados.length === 0) return null
    return (
        <Text style={styles.contatoLinha}>
            {filtrados.map((item, idx) => (
                <Text key={item.label}>
                    {idx > 0 ? <Text style={styles.separador}> | </Text> : null}
                    <Text style={styles.contatoLabel}>{item.label}: </Text>
                    <Text>{item.value}</Text>
                </Text>
            ))}
        </Text>
    )
}

function SectionHeader({ children }: { children: string }) {
    return (
        <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{children}</Text>
        </View>
    )
}

function ExperienciaBloco({ exp }: { exp: Experiencia }) {
    const periodo = formatPeriodo(exp.data_inicio, exp.data_fim, exp.atual)
    const permanencia = calcPermanencia(exp.data_inicio, exp.data_fim, exp.atual)
    const meta = [exp.empresa, periodo, permanencia ? `(${permanencia})` : ""].filter(Boolean).join(" | ")
    const atividades = (exp.atividades || []).filter(a => a.descricao)
    return (
        <View style={styles.expBlock} wrap={false}>
            <Text style={styles.expCargo}>{exp.cargo || "Cargo"}</Text>
            {meta ? <Text style={styles.expMeta}>{meta}</Text> : null}
            {atividades.map((at, j) => (
                <Text key={j} style={styles.atividade}>• {at.descricao}</Text>
            ))}
        </View>
    )
}

export function CurriculoPdfDocument({ dados }: { dados: CvDados }) {
    return (
        <Document>
            <Page size="A4" style={styles.page}>
                <Text style={styles.nome}>{dados.nome}</Text>
                <ContatoLinha itens={[
                    { label: "Endereço", value: dados.endereco || "" },
                    { label: "Telefone", value: dados.telefone || "" },
                ]} />
                <ContatoLinha itens={[
                    { label: "E-mail", value: dados.email || "" },
                    { label: "LinkedIn", value: dados.linkedin || "" },
                    { label: dados.portfolio?.includes("github") ? "GitHub" : "Portfólio", value: dados.portfolio || "" },
                ]} />

                <View style={styles.hr} />

                {dados.apresentacao ? <Text style={styles.apresentacao}>{dados.apresentacao}</Text> : null}
                {dados.objetivo ? <Text style={styles.objetivo}>Objetivo Profissional: {dados.objetivo}</Text> : null}
                {(dados.apresentacao || dados.objetivo) ? <View style={styles.hr} /> : null}

                {dados.experiencias?.length > 0 && (
                    <View>
                        <SectionHeader>Experiência Profissional</SectionHeader>
                        {dados.experiencias.map((exp, i) => <ExperienciaBloco key={i} exp={exp} />)}
                    </View>
                )}

                {dados.formacoes?.length > 0 && (
                    <View>
                        <SectionHeader>Formação Acadêmica</SectionHeader>
                        {dados.formacoes.map((f, i) => (
                            <Text key={i} style={styles.linhaSimples}>
                                <Text style={styles.strong}>{f.escolaridade}</Text>
                                {f.instituicao ? <Text> — {f.instituicao}</Text> : null}
                                {f.ano ? <Text> — {f.status === "cursando" ? `Cursando, previsão ${f.ano}` : f.ano}</Text> : null}
                            </Text>
                        ))}
                    </View>
                )}

                {dados.cursos?.length > 0 && (
                    <View>
                        <SectionHeader>Cursos e Certificações</SectionHeader>
                        {dados.cursos.map((c, i) => (
                            <Text key={i} style={styles.linhaSimples}>
                                <Text style={styles.strong}>{c.titulo}</Text>
                                {c.instituicao ? <Text> — {c.instituicao}</Text> : null}
                                {c.ano ? <Text> — {c.ano}</Text> : null}
                                {c.descricao ? <Text style={styles.muted}> ({c.descricao})</Text> : null}
                            </Text>
                        ))}
                    </View>
                )}

                {dados.habilidades?.length > 0 && (
                    <View>
                        <SectionHeader>Habilidades Técnicas</SectionHeader>
                        <View style={styles.habBlock}>
                            {dados.habilidades.map((h, i) => (
                                <Text key={i} style={styles.hab}>
                                    • <Text style={styles.strong}>{h.titulo}{h.titulo && h.descricao ? ":" : ""}</Text>
                                    {h.descricao ? <Text style={styles.muted}> {h.descricao}</Text> : null}
                                </Text>
                            ))}
                        </View>
                    </View>
                )}
            </Page>
        </Document>
    )
}
