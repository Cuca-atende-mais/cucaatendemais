/**
 * S-PROG-18: desenha a planilha consolidada no formato visual da planilha da PICI — título mesclado
 * na linha 1, cabeçalho na linha 2, cores por aba, larguras e quebra de linha nos textos longos.
 * Usa `exceljs` porque a versão gratuita do `xlsx` (SheetJS) já usada no portal não grava cor nem
 * negrito. Carregado sob demanda pela tela (import dinâmico), só quando alguém baixa.
 */
import ExcelJS from "exceljs"
import type { AbaConsolidada } from "@/lib/programacao/exportacao-consolidada"

const BORDA_FINA: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: "FF999999" } },
    left: { style: "thin", color: { argb: "FF999999" } },
    bottom: { style: "thin", color: { argb: "FF999999" } },
    right: { style: "thin", color: { argb: "FF999999" } },
}

const preenchimento = (rgb: string): ExcelJS.Fill => ({
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: `FF${rgb}` },
})

export async function gerarXlsxConsolidado(abas: AbaConsolidada[]): Promise<ArrayBuffer> {
    const wb = new ExcelJS.Workbook()
    wb.creator = "Cuca Atende+"
    wb.created = new Date()

    for (const aba of abas) {
        const ws = wb.addWorksheet(aba.nomeAba, { views: [{ state: "frozen", ySplit: 2 }] })
        const total = aba.colunas.length
        ws.columns = aba.colunas.map(c => ({ width: c.largura }))

        // Linha 1 — título mesclado sobre todas as colunas.
        const linhaTitulo = ws.getRow(1)
        linhaTitulo.getCell(1).value = aba.titulo
        ws.mergeCells(1, 1, 1, total)
        linhaTitulo.height = 24
        const celTitulo = linhaTitulo.getCell(1)
        celTitulo.font = { bold: true, size: 14 }
        celTitulo.alignment = { vertical: "middle", horizontal: "center" }
        celTitulo.fill = preenchimento(aba.cores.cabecalho)

        // Linha 2 — cabeçalho.
        const linhaCab = ws.getRow(2)
        aba.colunas.forEach((c, i) => {
            const cel = linhaCab.getCell(i + 1)
            cel.value = c.titulo
            cel.font = { bold: true }
            cel.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
            cel.fill = preenchimento(aba.cores.cabecalho)
            cel.border = BORDA_FINA
        })
        linhaCab.height = 20

        // Linha 3+ — dados.
        aba.linhas.forEach((valores, r) => {
            const linha = ws.getRow(r + 3)
            aba.colunas.forEach((c, i) => {
                const cel = linha.getCell(i + 1)
                cel.value = valores[i] ?? ""
                cel.alignment = { vertical: "top", wrapText: c.textoLongo === true }
                cel.border = BORDA_FINA
                if (aba.cores.linhas) cel.fill = preenchimento(aba.cores.linhas)
            })
        })
    }

    return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}
