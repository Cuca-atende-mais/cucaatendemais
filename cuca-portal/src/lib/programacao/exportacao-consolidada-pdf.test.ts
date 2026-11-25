import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createElement } from "react"
import { describe, expect, it } from "vitest"
import ExcelJS from "exceljs"
import { renderToBuffer } from "@react-pdf/renderer"
// Entrada interna: o index do pdf-parse 1.x tenta ler um arquivo de exemplo quando não tem `module.parent`
// (mesmo import da rota developer/batch-triage).
// @ts-expect-error -- a entrada interna não tem declaração de tipos
import pdfParse from "pdf-parse/lib/pdf-parse.js"
import { ETIQUETA_RASCUNHO, etiquetaDoStatus, montarAbasConsolidadas, nomeArquivoConsolidado, type AtividadeConsolidada } from "./exportacao-consolidada"
import { gerarXlsxConsolidado } from "./gerar-xlsx-consolidado"
import { LARGURA_UTIL, ProgramacaoConsolidadaPdfDocument, largurasColunas, textoCategoriaVazia } from "./gerar-pdf-consolidado"

// S-PROG-20: PDF A4 paisagem da programação consolidada, 4 categorias sempre (inclusive vazias) e
// etiqueta "RASCUNHO" na categoria em rascunho, no PDF e no .xlsx.
// Com PROG_PDF_EXEMPLOS=<pasta>, grava os arquivos para conferência visual.

const PASTA = process.env.PROG_PDF_EXEMPLOS
const LOGO = join(__dirname, "..", "..", "..", "public", "logo-rede-cuca.png")
// Gerar PDF de várias páginas leva alguns segundos; na suíte completa, o tempo padrão estoura.
const TEMPO_PDF = 60_000

const EMENTA_LONGA = "Introdução às técnicas de produção audiovisual, roteiro, captação de imagem e som, edição e finalização. ".repeat(6).trim()

/** Volume real (José Walter, novembro/2026): ~110 linhas de ESPORTES; CURSOS com ementa de ~600 caracteres. */
function atividadesVolumeReal(): AtividadeConsolidada[] {
    const esportes: AtividadeConsolidada[] = Array.from({ length: 110 }, (_, i) => ({
        titulo: `Modalidade ${String(Math.floor(i / 4) + 1).padStart(2, "0")}`,
        categoria: "ESPORTES",
        hora_inicio: `${String(7 + (i % 10)).padStart(2, "0")}:00:00`,
        hora_fim: `${String(8 + (i % 10)).padStart(2, "0")}:00:00`,
        metadata: { professor: "Professor Exemplo", turma: `Turma ${(i % 4) + 1}`, faixa_etaria: "15 a 29 anos", sexo: "Misto", vagas: "20", dias_semana: "Seg, Qua e Sex" },
    }))
    const cursos: AtividadeConsolidada[] = Array.from({ length: 15 }, (_, i) => ({
        titulo: `Curso de Produção Audiovisual ${i + 1}`,
        categoria: "CURSOS",
        data_inicio: "2026-11-03",
        data_fim: "2026-11-28",
        hora_inicio: "09:00:00",
        hora_fim: "12:00:00",
        metadata: { educador: "Educadora Exemplo", vagas: "25", carga_horaria: "40h", dias_semana: "Ter e Qui", requisitos: "15 a 29 anos, ensino fundamental completo", ementa: EMENTA_LONGA },
    }))
    const diaADia: AtividadeConsolidada[] = Array.from({ length: 12 }, (_, i) => ({
        titulo: "Programa Biblioteca Viva",
        categoria: "DIA A DIA",
        data_inicio: `2026-11-${String(i + 2).padStart(2, "0")}`,
        hora_inicio: "14:00:00",
        hora_fim: "17:00:00",
        local: "Biblioteca",
        metadata: { sessao: "Biblioteca", atividade: "Roda de leitura", dia_semana: "Segunda-feira", informacoes: "Aberto ao público. ".repeat(20).trim() },
    }))
    return [...esportes, ...cursos, ...diaADia]
}

const STATUS = { ESPORTES: "autorizada", CURSOS: "rascunho", "DIA A DIA": "aguardando_autorizacao", ESPECIAIS: null } as const

async function paginasDoPdf(buffer: Buffer): Promise<string[]> {
    const paginas: string[] = []
    await pdfParse(buffer, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pagerender: async (pagina: any) => {
            const conteudo = await pagina.getTextContent()
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const texto = conteudo.items.map((item: any) => item.str).join(" ").replace(/\s+/g, " ")
            paginas[pagina.pageIndex] = texto
            return texto
        },
    })
    return paginas
}

describe("etiqueta RASCUNHO (S-PROG-20)", () => {
    it("só o rascunho leva etiqueta; o título termina em ' - RASCUNHO' e o nome da aba não muda", () => {
        const abas = montarAbasConsolidadas("Cuca Pici", 11, 2026, [], STATUS)
        const porNome = Object.fromEntries(abas.map(a => [a.categoria, a]))
        expect(porNome.CURSOS.etiqueta).toBe(ETIQUETA_RASCUNHO)
        expect(porNome.CURSOS.titulo).toBe("NOVEMBRO 2026 - REDE CUCA PICI - RASCUNHO")
        expect(porNome.CURSOS.nomeAba).toBe("CURSOS - NOVEMBRO 26")
        for (const nome of ["ESPORTES", "DIA A DIA", "ESPECIAIS"]) {
            expect(porNome[nome].etiqueta).toBeNull()
            expect(porNome[nome].titulo).toBe("NOVEMBRO 2026 - REDE CUCA PICI")
        }
        expect(etiquetaDoStatus(undefined)).toBeNull()
    })

    it("sem o status, a montagem é a mesma da S-PROG-18 (nenhuma etiqueta)", () => {
        const atividades = atividadesVolumeReal()
        const sem = montarAbasConsolidadas("Cuca Pici", 11, 2026, atividades)
        const comNulo = montarAbasConsolidadas("Cuca Pici", 11, 2026, atividades, null)
        expect(sem.every(a => a.etiqueta === null && a.titulo === "NOVEMBRO 2026 - REDE CUCA PICI")).toBe(true)
        expect(comNulo).toEqual(sem)
    })

    it("nome do arquivo: .pdf quando pedido; .xlsx continua o padrão", () => {
        expect(nomeArquivoConsolidado("Cuca José Walter", 11, 2026, "pdf")).toBe("Programacao_Consolidada_Cuca_José_Walter_Novembro_2026.pdf")
        expect(nomeArquivoConsolidado("Cuca José Walter", 11, 2026)).toBe("Programacao_Consolidada_Cuca_José_Walter_Novembro_2026.xlsx")
    })
})

describe("planilha com etiqueta e com 0 atividades (S-PROG-20)", () => {
    it("aba em rascunho tem a etiqueta no título da linha 1; nomes das abas iguais", async () => {
        const abas = montarAbasConsolidadas("Cuca Pici", 11, 2026, atividadesVolumeReal(), STATUS)
        const wb = new ExcelJS.Workbook()
        await wb.xlsx.load(await gerarXlsxConsolidado(abas))
        expect(wb.worksheets.map(w => w.name)).toEqual(["ESPORTES - NOVEMBRO 26", "CURSOS - NOVEMBRO 26", "DIA A DIA - NOVEMBRO 26", "ESPECIAIS - NOVEMBRO 26"])
        expect(wb.getWorksheet("CURSOS - NOVEMBRO 26")!.getCell("A1").value).toBe("NOVEMBRO 2026 - REDE CUCA PICI - RASCUNHO")
        expect(wb.getWorksheet("ESPORTES - NOVEMBRO 26")!.getCell("A1").value).toBe("NOVEMBRO 2026 - REDE CUCA PICI")
        expect(wb.getWorksheet("DIA A DIA - NOVEMBRO 26")!.getCell("A1").value).toBe("NOVEMBRO 2026 - REDE CUCA PICI")
    })

    it("0 atividades: as 4 abas saem, só com título e cabeçalho", async () => {
        const abas = montarAbasConsolidadas("Cuca Barra", 12, 2026, [], { ESPORTES: "rascunho" })
        const wb = new ExcelJS.Workbook()
        await wb.xlsx.load(await gerarXlsxConsolidado(abas))
        expect(wb.worksheets).toHaveLength(4)
        for (const ws of wb.worksheets) {
            expect(ws.getCell("A2").value).not.toBeNull()
            expect(ws.getCell("A3").value).toBeNull()
        }
        expect(wb.worksheets[0].getCell("A1").value).toBe("DEZEMBRO 2026 - REDE CUCA BARRA - RASCUNHO")
    })
})

describe("PDF consolidado (S-PROG-20)", () => {
    it("larguras proporcionais somam a largura útil da página", () => {
        for (const aba of montarAbasConsolidadas("Cuca Pici", 11, 2026, [])) {
            const soma = largurasColunas(aba).reduce((x, y) => x + y, 0)
            expect(soma).toBeCloseTo(LARGURA_UTIL, 5)
        }
    })

    it("A4 paisagem, 4 categorias em páginas próprias, cabeçalho repetido, etiqueta e categoria vazia", async () => {
        const abas = montarAbasConsolidadas("Cuca José Walter", 11, 2026, atividadesVolumeReal(), STATUS)
        const inicio = Date.now()
        const buf = await renderToBuffer(createElement(ProgramacaoConsolidadaPdfDocument, { abas, geradoEm: "25/11/2026 10:00", logo: LOGO }) as Parameters<typeof renderToBuffer>[0])
        const ms = Date.now() - inicio
        if (PASTA) {
            mkdirSync(PASTA, { recursive: true })
            writeFileSync(join(PASTA, "programacao-consolidada.pdf"), buf)
        }
        console.log(`[S-PROG-20] PDF de volume real gerado em ${ms} ms, ${buf.length} bytes`)

        expect(buf.subarray(0, 4).toString("latin1")).toBe("%PDF")
        expect(buf.toString("latin1")).toMatch(/\/MediaBox\s*\[\s*0 0 841\.\d+ 595\.\d+\s*\]/)
        expect(buf.toString("latin1")).not.toMatch(/\/MediaBox\s*\[\s*0 0 595\.\d+ 841\.\d+\s*\]/)

        const paginas = await paginasDoPdf(buf)
        expect(paginas.length).toBeGreaterThan(4)
        const comecos = ["ESPORTES", "CURSOS", "DIA A DIA", "ESPECIAIS"].map(cat => paginas.findIndex(p => new RegExp(`\\b${cat}\\b`).test(p)))
        // Ordem fixa e cada categoria em página nova.
        expect(comecos.every(i => i >= 0)).toBe(true)
        expect([...comecos].sort((a, b) => a - b)).toEqual(comecos)
        expect(new Set(comecos).size).toBe(4)

        // ESPORTES ocupa mais de uma página, e toda página dele repete o cabeçalho da tabela.
        const paginasEsportes = paginas.slice(comecos[0], comecos[1])
        expect(paginasEsportes.length).toBeGreaterThan(1)
        for (const p of paginasEsportes) {
            expect(p).toContain("Modalidade")
            expect(p).toContain("Horário início")
            expect(p).not.toContain(ETIQUETA_RASCUNHO)
        }
        // As 110 linhas aparecem (nenhuma perdida na quebra de página).
        expect(paginasEsportes.join(" ").match(/Professor Exemplo/g)).toHaveLength(110)

        // CURSOS em rascunho: etiqueta em toda página da categoria; ementa inteira, sem reticências.
        const paginasCursos = paginas.slice(comecos[1], comecos[2])
        for (const p of paginasCursos) expect(p).toContain(ETIQUETA_RASCUNHO)
        const textoCursos = paginasCursos.join(" ").replace(/\s+/g, " ")
        expect(textoCursos).toContain("edição e finalização.")
        expect(textoCursos).not.toContain("…")

        // ESPECIAIS vazia: página própria com a frase.
        expect(paginas[comecos[3]]).toContain(textoCategoriaVazia("ESPECIAIS"))

        // Rodapé em todas as páginas.
        paginas.forEach((p, i) => {
            expect(p).toContain("Gerado em 25/11/2026 10:00")
            expect(p).toContain(`Página ${i + 1} de ${paginas.length}`)
        })
    }, TEMPO_PDF)

    it("0 atividades: 4 páginas, uma por categoria, cada uma com a frase de vazio", async () => {
        const abas = montarAbasConsolidadas("Cuca Barra", 12, 2026, [])
        const buf = await renderToBuffer(createElement(ProgramacaoConsolidadaPdfDocument, { abas, geradoEm: "25/11/2026 10:00" }) as Parameters<typeof renderToBuffer>[0])
        const paginas = await paginasDoPdf(buf)
        expect(paginas).toHaveLength(4)
        for (const [i, cat] of ["ESPORTES", "CURSOS", "DIA A DIA", "ESPECIAIS"].entries()) {
            expect(paginas[i]).toContain(textoCategoriaVazia(cat))
        }
    }, TEMPO_PDF)
})
