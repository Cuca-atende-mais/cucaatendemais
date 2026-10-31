/**
 * S-PLA-08 (AC9): desenha a planilha dos indicadores. Mesmo visual de `lib/programacao/gerar-xlsx-consolidado.ts`
 * (título mesclado na linha 1, cabeçalho na linha 2, bordas finas). Só valores, sem fórmula: a planilha abre
 * com os números em qualquer prévia, sem precisar recalcular. Carregado sob demanda pela tela (import dinâmico).
 */
import ExcelJS from "exceljs"
import type { AbaIndicadores } from "@/lib/planejamento/indicadores"

const BORDA_FINA: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: "FF999999" } },
    left: { style: "thin", color: { argb: "FF999999" } },
    bottom: { style: "thin", color: { argb: "FF999999" } },
    right: { style: "thin", color: { argb: "FF999999" } },
}
const CABECALHO: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDCE6F1" } }
const TOTAL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F2F2" } }
const FORMATO = { moeda: '"R$" #,##0.00', inteiro: "0" } as const

export async function gerarXlsxIndicadores(abas: AbaIndicadores[]): Promise<ArrayBuffer> {
    const wb = new ExcelJS.Workbook()
    wb.creator = "Cuca Atende+"
    wb.created = new Date()

    for (const aba of abas) {
        const ws = wb.addWorksheet(aba.nomeAba, { views: [{ state: "frozen", ySplit: 2 }] })
        const total = aba.colunas.length
        ws.columns = aba.colunas.map(c => ({ width: c.largura }))

        const linhaTitulo = ws.getRow(1)
        linhaTitulo.getCell(1).value = aba.titulo
        ws.mergeCells(1, 1, 1, total)
        linhaTitulo.height = 24
        const celTitulo = linhaTitulo.getCell(1)
        celTitulo.font = { bold: true, size: 13 }
        celTitulo.alignment = { vertical: "middle", horizontal: "left" }

        const linhaCab = ws.getRow(2)
        aba.colunas.forEach((c, i) => {
            const cel = linhaCab.getCell(i + 1)
            cel.value = c.titulo
            cel.font = { bold: true }
            cel.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
            cel.fill = CABECALHO
            cel.border = BORDA_FINA
        })
        linhaCab.height = 32

        aba.linhas.forEach((valores, r) => {
            const linha = ws.getRow(r + 3)
            const ehTotal = aba.temTotal && r === aba.linhas.length - 1
            aba.colunas.forEach((c, i) => {
                const cel = linha.getCell(i + 1)
                cel.value = valores[i] ?? ""
                cel.alignment = { vertical: "top", wrapText: i === 1 }
                cel.border = BORDA_FINA
                if (c.formato && typeof valores[i] === "number") cel.numFmt = FORMATO[c.formato]
                if (ehTotal) {
                    cel.font = { bold: true }
                    cel.fill = TOTAL
                }
            })
        })
    }

    return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}
