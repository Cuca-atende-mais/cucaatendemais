/**
 * S-PLA-10: Calendário Geral em Excel. Aba "Calendário": a grade do ano no formato calendário escolar
 * (dias alinhados pela semana), com uma linha por setor dentro de cada mês: cada dia fica na cor do setor
 * que tem atividade nele, e a nota da célula lista essas atividades. Aba "Atividades": uma linha por
 * atividade, como no calendário oficial (com filtro). Só valores, sem fórmula. Carregado sob demanda.
 */
import ExcelJS from "exceljs"
import { ANO_PLANEJAMENTO } from "@/lib/planejamento/projeto"
import { corTextoSobre } from "@/lib/planejamento/slides"
import {
    CABECALHO_GRADE, COLUNAS_LISTA, EXPLICACAO_MESES, colunaFimDeSemana,
    type LinhaLista, type MesGrade, type ProjetoCalendarioGeral, type SetorCalendario,
} from "@/lib/planejamento/calendario-geral"

const BORDA_FINA: Partial<ExcelJS.Borders> = {
    top: { style: "thin", color: { argb: "FFBFBFBF" } },
    left: { style: "thin", color: { argb: "FFBFBFBF" } },
    bottom: { style: "thin", color: { argb: "FFBFBFBF" } },
    right: { style: "thin", color: { argb: "FFBFBFBF" } },
}
const argb = (hex: string) => `FF${hex.replace("#", "").toUpperCase()}`
const cheio = (hex: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb: argb(hex) } })
const CABECALHO = cheio("#DCE6F1")
const FDS = cheio("#E2E8F0")
const VAZIO = cheio("#F8FAFC")
const TITULO_MES = cheio("#0F172A")
const CINZA_TEXTO = "FF94A3B8"

// Colunas da aba Calendário: 1 = mês, 2 = setor, 3 em diante = as 37 colunas da grade.
const PRIMEIRA_COLUNA_DIA = 3

export type DadosXlsxCalendarioGeral = {
    grade: MesGrade[]
    linhas: LinhaLista[]
    anoTodo: ProjetoCalendarioGeral[]
    setores: SetorCalendario[] // todos (para nome e cor de cada projeto)
    legenda: SetorCalendario[] // os ligados na tela (para a legenda)
    contagem: Map<string, number>
    geradoEm: string
    filtrosTexto: string
}

export async function gerarXlsxCalendarioGeral(d: DadosXlsxCalendarioGeral): Promise<ArrayBuffer> {
    const setorPorId = new Map(d.setores.map(s => [s.id, s]))
    const nomeSetor = (id: string) => setorPorId.get(id)?.nome ?? ""
    const corSetor = (id: string) => setorPorId.get(id)?.cor ?? "#64748B"
    const ordemSetor = (id: string) => setorPorId.get(id)?.ordem ?? 99

    const wb = new ExcelJS.Workbook()
    wb.creator = "Cuca Atende+"
    wb.created = new Date()

    // ── Aba 1: grade do ano ──────────────────────────────────────────────────────────────────
    const ws = wb.addWorksheet("Calendário", {
        views: [{ state: "frozen", xSplit: 2, ySplit: 3 }],
        pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    })
    const total = CABECALHO_GRADE.length + PRIMEIRA_COLUNA_DIA - 1
    ws.columns = [{ width: 12 }, { width: 20 }, ...CABECALHO_GRADE.map(() => ({ width: 4.2 }))]

    ws.getCell(1, 1).value = `Calendário Geral ${ANO_PLANEJAMENTO}`
    ws.mergeCells(1, 1, 1, total)
    ws.getCell(1, 1).font = { bold: true, size: 15 }
    ws.getRow(1).height = 26
    ws.getCell(2, 1).value = `Planejamento ${ANO_PLANEJAMENTO} · gerado em ${d.geradoEm}${d.filtrosTexto ? ` · ${d.filtrosTexto}` : ""} · uma linha por setor em cada mês; passe o mouse no dia colorido para ver as atividades`
    ws.mergeCells(2, 1, 2, total)
    ws.getCell(2, 1).font = { size: 9, color: { argb: "FF64748B" } }

    const cab = ws.getRow(3)
    cab.getCell(1).value = "Mês"
    cab.getCell(2).value = "Setor"
    CABECALHO_GRADE.forEach((l, i) => { cab.getCell(i + PRIMEIRA_COLUNA_DIA).value = l })
    for (let c = 1; c <= total; c++) {
        const cel = cab.getCell(c)
        cel.font = { bold: true }
        cel.alignment = { horizontal: "center", vertical: "middle" }
        cel.fill = c >= PRIMEIRA_COLUNA_DIA && colunaFimDeSemana(c - PRIMEIRA_COLUNA_DIA) ? FDS : CABECALHO
        cel.border = BORDA_FINA
    }

    let r = 4
    for (const m of d.grade) {
        // Setores com atividade no mês (na ordem dos setores). Mês sem atividade: uma linha só, sem setor.
        const setoresMes = [...new Set(m.celulas.flatMap(c => c?.setores ?? []))].sort((a, b) => ordemSetor(a) - ordemSetor(b))
        const sublinhas: (string | null)[] = setoresMes.length ? setoresMes : [null]
        const inicio = r
        for (const setor of sublinhas) {
            const linha = ws.getRow(r)
            linha.height = 20
            const celSetor = linha.getCell(2)
            celSetor.value = setor ? nomeSetor(setor) : ""
            celSetor.font = { size: 9, bold: true, color: { argb: setor ? argb(corSetor(setor)) : "FF000000" } }
            celSetor.alignment = { vertical: "middle" }
            celSetor.border = BORDA_FINA
            m.celulas.forEach((c, i) => {
                const cel = linha.getCell(i + PRIMEIRA_COLUNA_DIA)
                cel.border = BORDA_FINA
                cel.alignment = { horizontal: "center", vertical: "middle" }
                if (!c) { cel.fill = VAZIO; return }
                cel.value = c.dia
                const doSetor = setor ? c.projetos.filter(p => p.setor_id === setor) : []
                if (doSetor.length === 0) {
                    cel.font = { color: { argb: CINZA_TEXTO } }
                    if (c.fimDeSemana) cel.fill = FDS
                    return
                }
                const cor = corSetor(setor as string)
                cel.fill = cheio(cor)
                cel.font = { bold: true, color: { argb: argb(corTextoSobre(cor)) } }
                cel.note = doSetor.map(p => p.nome).join("\n")
            })
            r++
        }
        ws.mergeCells(inicio, 1, r - 1, 1)
        const rotulo = ws.getCell(inicio, 1)
        rotulo.value = m.nome
        rotulo.font = { bold: true, color: { argb: "FFFFFFFF" } }
        rotulo.fill = TITULO_MES
        rotulo.alignment = { vertical: "middle", horizontal: "center" }
        rotulo.border = BORDA_FINA
    }

    // Legenda
    r++
    ws.getCell(r, 1).value = "Legenda"
    ws.getCell(r, 1).font = { bold: true }
    const itemLegenda = (fill: ExcelJS.Fill, texto: string) => {
        r++
        ws.getCell(r, PRIMEIRA_COLUNA_DIA).fill = fill
        ws.getCell(r, PRIMEIRA_COLUNA_DIA).border = BORDA_FINA
        ws.getCell(r, PRIMEIRA_COLUNA_DIA + 1).value = texto
    }
    for (const s of d.legenda) itemLegenda(cheio(s.cor), `${s.nome} (${d.contagem.get(s.id) ?? 0})`)
    itemLegenda(FDS, "Fim de semana")

    if (d.anoTodo.length > 0) {
        r += 2
        ws.getCell(r, 1).value = "Durante o ano todo"
        ws.getCell(r, 1).font = { bold: true }
        for (const p of d.anoTodo) {
            r++
            ws.getCell(r, PRIMEIRA_COLUNA_DIA).fill = cheio(corSetor(p.setor_id))
            ws.getCell(r, PRIMEIRA_COLUNA_DIA).border = BORDA_FINA
            ws.getCell(r, PRIMEIRA_COLUNA_DIA + 1).value = `${p.nome} · ${nomeSetor(p.setor_id)}${p.responsavel_nome ? ` · ${p.responsavel_nome}` : ""}`
        }
    }

    // ── Aba 2: atividades ────────────────────────────────────────────────────────────────────
    const wl = wb.addWorksheet("Atividades", {
        views: [{ state: "frozen", ySplit: 3 }],
        pageSetup: { orientation: "landscape", paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    })
    const larguras = [12, 15, 50, 20, 24, 18, 16, 36, 36]
    wl.columns = larguras.map(width => ({ width }))
    wl.getCell(1, 1).value = `Calendário Geral ${ANO_PLANEJAMENTO} · Atividades`
    wl.mergeCells(1, 1, 1, COLUNAS_LISTA.length)
    wl.getCell(1, 1).font = { bold: true, size: 13 }
    wl.getRow(1).height = 24
    wl.getCell(2, 1).value = EXPLICACAO_MESES
    wl.mergeCells(2, 1, 2, COLUNAS_LISTA.length)
    wl.getCell(2, 1).font = { size: 9, color: { argb: "FF64748B" } }
    const cabL = wl.getRow(3)
    COLUNAS_LISTA.forEach((t, i) => {
        const cel = cabL.getCell(i + 1)
        cel.value = t
        cel.font = { bold: true }
        cel.alignment = { horizontal: "center", vertical: "middle", wrapText: true }
        cel.fill = CABECALHO
        cel.border = BORDA_FINA
    })
    d.linhas.forEach((l, i) => {
        const linha = wl.getRow(i + 4)
        l.valores.forEach((v, c) => {
            const cel = linha.getCell(c + 1)
            cel.value = v
            cel.border = BORDA_FINA
            cel.alignment = { vertical: "top", wrapText: true }
        })
        // Coluna Mês com o fundo escuro do cabeçalho do mês; Área/Setor na cor do setor (como no oficial).
        const mes = linha.getCell(1)
        mes.fill = TITULO_MES
        mes.font = { bold: true, color: { argb: "FFFFFFFF" } }
        const setor = linha.getCell(4)
        const cor = corSetor(l.setorId)
        setor.fill = cheio(cor)
        setor.font = { bold: true, color: { argb: argb(corTextoSobre(cor)) } }
    })
    if (d.linhas.length > 0) wl.autoFilter = { from: { row: 3, column: 1 }, to: { row: d.linhas.length + 3, column: COLUNAS_LISTA.length } }

    return (await wb.xlsx.writeBuffer()) as ArrayBuffer
}
