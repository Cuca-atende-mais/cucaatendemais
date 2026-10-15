/**
 * S-EMP-GES-04 (AC5–AC7): desenha o relatório Emprega+ descrito por `relatorio.ts` — títulos mesclados,
 * cabeçalho congelado, bordas finas, linhas zebradas, cor por aba, fórmulas, A4 paisagem ajustado à largura
 * de 1 página e rodapé "Página X de Y". Sem proteção de planilha (editável). Carregado sob demanda pela
 * tela (import dinâmico), só quando alguém baixa — mesmo padrão de `lib/programacao/gerar-xlsx-consolidado.ts`.
 */
import ExcelJS from "exceljs"
import type { AbaPlanilha, Celula, LinhaPlanilha } from "@/lib/empregabilidade/relatorio"

const BORDA_FINA: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: "FFBFBFBF" } },
    left: { style: "thin", color: { argb: "FFBFBFBF" } },
    bottom: { style: "thin", color: { argb: "FFBFBFBF" } },
    right: { style: "thin", color: { argb: "FFBFBFBF" } },
}

const preenchimento = (rgb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb: `FF${rgb}` } })

/** Clareia a cor da aba para o fundo do bloco de destaque. */
function clarear(rgb: string, fator = 0.82): string {
    const n = parseInt(rgb, 16)
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => Math.round(v + (255 - v) * fator))
    return c.map(v => v.toString(16).padStart(2, "0")).join("").toUpperCase()
}

const FORMATO_NUMERO: Record<string, string> = {
    inteiro: "#,##0",
    percentual: "0.0%",
}

function valorCelula(c: Celula): ExcelJS.CellValue {
    // Fórmula + valor já calculado: o Excel recalcula ao abrir; visualizadores que não calculam mostram o número.
    if (c.formula) return c.resultado === undefined ? { formula: c.formula } : { formula: c.formula, result: c.resultado }
    return c.valor ?? ""
}

function desenharLinha(ws: ExcelJS.Worksheet, aba: AbaPlanilha, linha: LinhaPlanilha, r: number, zebra: boolean) {
    const nColunas = aba.larguras.length
    const row = ws.getRow(r)
    linha.celulas.forEach((c, i) => {
        const cel = row.getCell(i + 1)
        cel.value = valorCelula(c)
        if (c.formato && FORMATO_NUMERO[c.formato]) cel.numFmt = FORMATO_NUMERO[c.formato]
    })
    if (linha.mesclar && nColunas > 1) ws.mergeCells(r, 1, r, nColunas)
    const cor = aba.cor
    const todas = (fn: (cel: ExcelJS.Cell, i: number) => void) => {
        const ate = linha.mesclar ? 1 : Math.max(linha.celulas.length, 1)
        for (let i = 1; i <= ate; i++) fn(row.getCell(i), i)
    }

    switch (linha.tipo) {
        case "titulo":
            row.height = 26
            todas(cel => {
                cel.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } }
                cel.fill = preenchimento(cor)
                cel.alignment = { vertical: "middle", horizontal: "center" }
            })
            break
        case "subtitulo":
            todas(cel => {
                cel.font = { italic: true, size: 10, color: { argb: "FF595959" } }
                cel.alignment = { horizontal: "center" }
            })
            break
        case "secao":
            todas(cel => {
                cel.font = { bold: true, size: 12, color: { argb: `FF${cor}` } }
            })
            break
        case "destaque_rotulo":
            todas(cel => {
                cel.font = { bold: true, size: 10, color: { argb: "FF404040" } }
                cel.fill = preenchimento(clarear(cor))
                cel.alignment = { horizontal: "center", wrapText: true }
                cel.border = BORDA_FINA
            })
            break
        case "destaque_valor":
            row.height = 28
            todas(cel => {
                cel.font = { bold: true, size: 16, color: { argb: `FF${cor}` } }
                cel.fill = preenchimento(clarear(cor))
                cel.alignment = { horizontal: "center", vertical: "middle" }
                cel.border = BORDA_FINA
            })
            break
        case "cabecalho":
            row.height = 30
            todas(cel => {
                cel.font = { bold: true, color: { argb: "FFFFFFFF" } }
                cel.fill = preenchimento(cor)
                cel.alignment = { vertical: "middle", horizontal: "center", wrapText: true }
                cel.border = BORDA_FINA
            })
            break
        case "dado":
        case "total":
        case "alerta":
            todas((cel, i) => {
                cel.border = BORDA_FINA
                if (linha.tipo === "total") cel.font = { bold: true }
                if (linha.tipo === "alerta") {
                    cel.fill = preenchimento("FFE699")
                    if (i === 7) cel.font = { bold: true, color: { argb: "FF9C5700" } }
                } else if (zebra) {
                    cel.fill = preenchimento("F2F2F2")
                }
                cel.alignment = { vertical: "top", wrapText: i <= 3 && aba.nome === "Detalhe" }
            })
            break
        case "nota":
            row.height = 30
            todas(cel => {
                cel.font = { size: 9, color: { argb: "FF595959" } }
                cel.alignment = { wrapText: true, vertical: "top" }
            })
            break
        default:
            break
    }
}

export async function gerarXlsxRelatorio(abas: AbaPlanilha[], autor: string): Promise<ArrayBuffer> {
    const wb = new ExcelJS.Workbook()
    wb.creator = autor || "Cuca Atende+"
    wb.created = new Date()
    wb.calcProperties.fullCalcOnLoad = true

    for (const aba of abas) {
        const ws = wb.addWorksheet(aba.nome, {
            properties: { tabColor: { argb: `FF${aba.cor}` } },
            views: [{ state: "frozen", ySplit: aba.congelarLinhas, xSplit: aba.congelarColunas }],
            pageSetup: {
                paperSize: 9, // A4
                orientation: "landscape",
                fitToPage: true,
                fitToWidth: 1,
                fitToHeight: 0,
                margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.6, header: 0.3, footer: 0.3 },
                printTitlesRow: `1:${aba.congelarLinhas}`,
            },
            headerFooter: { oddFooter: "&LRelatório Emprega+ — Rede Cuca&RPágina &P de &N" },
        })
        ws.columns = aba.larguras.map(w => ({ width: w }))

        let zebra = false
        aba.linhas.forEach((linha, i) => {
            if (linha.tipo === "cabecalho" || linha.tipo === "secao") zebra = false
            const ehDado = linha.tipo === "dado" || linha.tipo === "total" || linha.tipo === "alerta"
            desenharLinha(ws, aba, linha, i + 1, ehDado && zebra)
            if (ehDado) zebra = !zebra
        })
    }

    return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}
