import { Document, Packer, Paragraph, TextRun, HeadingLevel, BorderStyle } from "docx"
import type { CvDados, Experiencia } from "./curriculo-tipos"

// SQS-63 — espelha o conteúdo de curriculo-pdf.tsx (mesmas seções, mesma
// ordem), mas em formato editável (.docx). Layout mais simples que o PDF de
// propósito — o candidato pode reformatar à vontade no Word/Google Docs; o
// que importa aqui é o conteúdo estar completo e organizado.

function formatPeriodo(inicio: string, fim: string, atual: boolean): string {
    if (!inicio) return ""
    const fimStr = atual ? "Atual" : (fim || "")
    return fimStr ? `${inicio} – ${fimStr}` : inicio
}

function linhaContato(itens: { label: string; value: string }[]): string {
    return itens.filter(i => i.value).map(i => `${i.label}: ${i.value}`).join("   |   ")
}

function tituloSecao(texto: string): Paragraph {
    return new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 240, after: 120 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "1A4A7A" } },
        children: [new TextRun({ text: texto, bold: true, color: "1A2E5A" })],
    })
}

function paragrafoExperiencia(exp: Experiencia): Paragraph[] {
    const periodo = formatPeriodo(exp.data_inicio, exp.data_fim, exp.atual)
    const meta = [exp.empresa, periodo].filter(Boolean).join("   |   ")
    const paragrafos: Paragraph[] = [
        new Paragraph({
            spacing: { before: 160 },
            children: [new TextRun({ text: exp.cargo || "Cargo", bold: true, color: "1A4A7A", size: 22 })],
        }),
    ]
    if (meta) {
        paragrafos.push(new Paragraph({
            children: [new TextRun({ text: meta, color: "555555", size: 18 })],
        }))
    }
    for (const at of (exp.atividades || []).filter(a => a.descricao)) {
        paragrafos.push(new Paragraph({
            bullet: { level: 0 },
            children: [new TextRun({ text: at.descricao, size: 20 })],
        }))
    }
    return paragrafos
}

export async function gerarDocxCurriculo(dados: CvDados): Promise<Buffer> {
    const children: Paragraph[] = [
        new Paragraph({
            children: [new TextRun({ text: dados.nome || "", bold: true, size: 40, color: "1A2E5A" })],
        }),
    ]

    const contato1 = linhaContato([
        { label: "Endereço", value: dados.endereco || "" },
        { label: "Telefone", value: dados.telefone || "" },
    ])
    if (contato1) children.push(new Paragraph({ children: [new TextRun({ text: contato1, size: 18 })] }))

    const contato2 = linhaContato([
        { label: "E-mail", value: dados.email || "" },
        { label: "LinkedIn", value: dados.linkedin || "" },
        { label: dados.portfolio?.includes("github") ? "GitHub" : "Portfólio", value: dados.portfolio || "" },
    ])
    if (contato2) children.push(new Paragraph({ children: [new TextRun({ text: contato2, size: 18 })] }))

    if (dados.apresentacao) {
        children.push(new Paragraph({
            spacing: { before: 200 },
            children: [new TextRun({ text: dados.apresentacao, size: 19 })],
        }))
    }
    if (dados.objetivo) {
        children.push(new Paragraph({
            spacing: { before: 120 },
            children: [new TextRun({ text: `Objetivo Profissional: ${dados.objetivo}`, bold: true, color: "1A4A7A", size: 20 })],
        }))
    }

    if (dados.experiencias?.length > 0) {
        children.push(tituloSecao("Experiência Profissional"))
        for (const exp of dados.experiencias) children.push(...paragrafoExperiencia(exp))
    }

    if (dados.formacoes?.length > 0) {
        children.push(tituloSecao("Formação Acadêmica"))
        for (const f of dados.formacoes) {
            const partes = [f.escolaridade, f.instituicao, f.ano ? (f.status === "cursando" ? `Cursando, previsão ${f.ano}` : f.ano) : ""]
                .filter(Boolean).join(" — ")
            children.push(new Paragraph({ children: [new TextRun({ text: partes, size: 20 })] }))
        }
    }

    if (dados.cursos?.length > 0) {
        children.push(tituloSecao("Cursos e Certificações"))
        for (const c of dados.cursos) {
            const partes = [c.titulo, c.instituicao, c.ano].filter(Boolean).join(" — ")
            const texto = c.descricao ? `${partes} (${c.descricao})` : partes
            children.push(new Paragraph({ children: [new TextRun({ text: texto, size: 20 })] }))
        }
    }

    if (dados.habilidades?.length > 0) {
        children.push(tituloSecao("Habilidades Técnicas"))
        for (const h of dados.habilidades) {
            const texto = h.titulo && h.descricao ? `${h.titulo}: ${h.descricao}` : (h.titulo || h.descricao)
            children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: texto, size: 20 })] }))
        }
    }

    const doc = new Document({
        sections: [{ properties: {}, children }],
    })

    return Packer.toBuffer(doc)
}
