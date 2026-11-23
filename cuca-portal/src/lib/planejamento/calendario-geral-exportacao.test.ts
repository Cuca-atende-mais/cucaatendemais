import { mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createElement } from "react"
import { describe, expect, it } from "vitest"
import ExcelJS from "exceljs"
import { renderToBuffer } from "@react-pdf/renderer"
import { atividadesPorMes, contarPorSetor, linhasLista, montarGradeAno, type ProjetoCalendarioGeral } from "./calendario-geral"
import { ALTURA_DISPONIVEL, CalendarioGeralPdfDocument, alturaEstimadaMes } from "./calendario-geral-pdf"
import { gerarXlsxCalendarioGeral } from "./gerar-xlsx-calendario-geral"

// S-PLA-10: gera o PDF e a planilha de verdade com dados sintéticos e confere a estrutura.
// Com PLA_PDF_EXEMPLOS=<pasta>, grava os arquivos para conferência visual.

const LOGO = join(__dirname, "..", "..", "..", "public", "logo-rede-cuca.png")
const PASTA = process.env.PLA_PDF_EXEMPLOS

const SETORES = [
    { id: "direitos", nome: "Direitos Humanos", cor: "#7c3aed", ordem: 1 },
    { id: "cultura", nome: "Cultura", cor: "#db2777", ordem: 3 },
    { id: "esportes", nome: "Esportes", cor: "#16a34a", ordem: 6 },
]
const ordem = (id: string) => SETORES.find(s => s.id === id)?.ordem ?? 99
const nomeSetor = (id: string) => SETORES.find(s => s.id === id)?.nome ?? ""

let n = 0
function p(x: Partial<ProjetoCalendarioGeral>): ProjetoCalendarioGeral {
    n++
    return {
        id: `p${n}`, nome: `Atividade de teste ${n}`, setor_id: "esportes", status: "projeto_salvo", tipo: "evento_pontual",
        periodo_ano_todo: false, data_inicio: null, data_fim: null, responsavel_nome: "Pessoa Teste", locais_unidades: [],
        local_outro: false, local_outro_texto: null, dias_horarios: null, ...x,
    }
}

// Ano cheio: eventos de um dia, períodos longos, sobreposição de 3 setores, ano todo, sem período e nomes longos.
const PROJETOS: ProjetoCalendarioGeral[] = [
    p({ setor_id: "esportes", data_inicio: "2027-01-16", data_fim: "2027-01-16" }),
    p({ setor_id: "direitos", data_inicio: "2027-01-13", data_fim: "2027-01-18", nome: "Campanha de conscientização com um nome bem comprido que precisa quebrar linha sem ser cortado no PDF" }),
    p({ setor_id: "cultura", data_inicio: "2027-06-01", data_fim: "2027-10-03" }),
    p({ setor_id: "esportes", data_inicio: "2027-06-10", data_fim: "2027-06-12" }),
    p({ setor_id: "direitos", data_inicio: "2027-06-11", data_fim: "2027-06-11" }),
    p({ setor_id: "direitos", periodo_ano_todo: true }),
    p({ setor_id: "cultura" }),
    ...Array.from({ length: 14 }, (_, i) => p({ setor_id: i % 2 ? "cultura" : "esportes", data_inicio: `2027-05-${String(i + 1).padStart(2, "0")}`, data_fim: `2027-05-${String(i + 2).padStart(2, "0")}` })),
    ...Array.from({ length: 12 }, (_, i) => p({ setor_id: "esportes", data_inicio: `2027-${String(i + 1).padStart(2, "0")}-20` })),
]

function dados() {
    const grade = montarGradeAno(PROJETOS, ordem)
    const atividades = atividadesPorMes(PROJETOS, ordem)
    return { grade, atividades, contagem: contarPorSetor(PROJETOS) }
}

describe("Calendário Geral em PDF", () => {
    it("gera o PDF em A4 paisagem, com a grade na primeira página e as tabelas depois", async () => {
        const { grade, atividades, contagem } = dados()
        const buf = await renderToBuffer(createElement(CalendarioGeralPdfDocument, {
            grade, atividades, setores: SETORES, legenda: SETORES, contagem, geradoEm: "23/11/2026 10:00", filtrosTexto: "", logo: LOGO,
        }) as Parameters<typeof renderToBuffer>[0])
        const texto = buf.toString("latin1")
        const paginas = (texto.match(/\/Type \/Page\b/g) ?? []).length
        expect(paginas).toBeGreaterThanOrEqual(2)
        expect(texto).toMatch(/\/MediaBox\s*\[\s*0 0 841\.\d+ 595\.\d+\s*\]/)
        if (PASTA) {
            mkdirSync(PASTA, { recursive: true })
            writeFileSync(join(PASTA, "calendario-geral.pdf"), buf)
        }
    }, 30_000)
})

describe("quebra de página das tabelas do mês", () => {
    it("mês comum cabe numa página (vai inteiro); mês com muitas atividades longas não cabe (pode partir)", () => {
        const poucos = Array.from({ length: 12 }, (_, i) => p({ data_inicio: `2027-03-${String(i + 1).padStart(2, "0")}` }))
        const muitos = Array.from({ length: 40 }, (_, i) => p({ nome: "Nome bem comprido de atividade que ocupa duas linhas na tabela do mês", data_inicio: `2027-03-${String((i % 28) + 1).padStart(2, "0")}` }))
        expect(alturaEstimadaMes(poucos, nomeSetor)).toBeLessThan(ALTURA_DISPONIVEL)
        expect(alturaEstimadaMes(muitos, nomeSetor)).toBeGreaterThan(ALTURA_DISPONIVEL)
    })

    it("um mês maior que a página gera o PDF sem erro (a tabela continua na página seguinte)", async () => {
        const muitos = Array.from({ length: 45 }, (_, i) => p({ nome: `Atividade longa número ${i} com um nome que ocupa mais de uma linha na tabela`, data_inicio: `2027-03-${String((i % 28) + 1).padStart(2, "0")}` }))
        const buf = await renderToBuffer(createElement(CalendarioGeralPdfDocument, {
            grade: montarGradeAno(muitos, ordem), atividades: atividadesPorMes(muitos, ordem), setores: SETORES, legenda: SETORES, contagem: contarPorSetor(muitos),
            geradoEm: "23/11/2026 10:00", filtrosTexto: "", logo: LOGO,
        }) as Parameters<typeof renderToBuffer>[0])
        expect((buf.toString("latin1").match(/\/Type \/Page\b/g) ?? []).length).toBeGreaterThanOrEqual(3)
    }, 30_000)
})

describe("Calendário Geral em Excel", () => {
    it("tem a grade pintada pela cor do setor e a lista com uma linha por atividade", async () => {
        const { grade, atividades, contagem } = dados()
        const linhas = linhasLista(atividades, nomeSetor, () => undefined)
        const buffer = await gerarXlsxCalendarioGeral({ grade, linhas, anoTodo: atividades.anoTodo, setores: SETORES, legenda: SETORES.slice(0, 2), contagem, geradoEm: "23/11/2026 10:00", filtrosTexto: "" })
        if (PASTA) {
            mkdirSync(PASTA, { recursive: true })
            writeFileSync(join(PASTA, "calendario-geral.xlsx"), Buffer.from(buffer))
        }
        const wb = new ExcelJS.Workbook()
        await wb.xlsx.load(buffer)
        expect(wb.worksheets.map(w => w.name)).toEqual(["Calendário", "Atividades"])

        const ws = wb.getWorksheet("Calendário")!
        const nota = (c: ExcelJS.Cell) => (c.note ? (typeof c.note === "string" ? c.note : c.note.texts?.map(t => t.text).join("") ?? "") : "")
        const cor = (c: ExcelJS.Cell) => (c.fill as ExcelJS.FillPattern | undefined)?.fgColor?.argb
        // Janeiro tem Direitos Humanos (13 a 18) e Esportes (16 e 20): duas linhas, mês mesclado.
        expect(ws.getCell(4, 1).value).toBe("Janeiro")
        expect([ws.getCell(4, 2).value, ws.getCell(5, 2).value]).toEqual(["Direitos Humanos", "Esportes"])
        expect(ws.getCell(5, 1).isMerged).toBe(true)
        // 01/01/2027 é sexta (coluna 5 da grade); a grade começa na coluna 3 da planilha.
        const col = (dia: number, inicio: number) => 3 + inicio + dia - 1
        expect(ws.getCell(4, col(16, 5)).value).toBe(16)
        expect(cor(ws.getCell(4, col(16, 5)))).toBe("FF7C3AED")
        expect(cor(ws.getCell(5, col(16, 5)))).toBe("FF16A34A")
        expect(cor(ws.getCell(4, col(20, 5)))).toBeUndefined()
        expect(cor(ws.getCell(5, col(20, 5)))).toBe("FF16A34A")
        expect(nota(ws.getCell(5, col(16, 5)))).toBe("Atividade de teste 1")
        // Toda célula colorida da grade tem a cor do setor da sua linha (nunca uma cor misturada).
        const corPorNome = new Map(SETORES.map(x => [x.nome, `FF${x.cor.slice(1).toUpperCase()}`]))
        let coloridas = 0
        ws.eachRow((linha, n) => {
            if (n < 4) return
            const corLinha = corPorNome.get(String(linha.getCell(2).value ?? ""))
            if (!corLinha) return
            for (let c = 3; c < 40; c++) {
                const cel = linha.getCell(c)
                if (nota(cel)) {
                    coloridas++
                    expect(cor(cel)).toBe(corLinha)
                }
            }
        })
        expect(coloridas).toBeGreaterThan(30)
        // Legenda só com os setores ligados.
        const textos: string[] = []
        ws.eachRow(l => textos.push(String(l.getCell(4).value ?? "")))
        expect(textos.some(t => t.startsWith("Direitos Humanos ("))).toBe(true)
        expect(textos.some(t => t.startsWith("Esportes ("))).toBe(false)

        const wl = wb.getWorksheet("Atividades")!
        expect(wl.rowCount).toBe(linhas.length + 3)
        expect(wl.getCell(2, 1).value).toMatch(/mês em que começa/)
        expect(wl.getCell(4, 1).value).toBe("Ano todo")
        expect(wl.getCell(linhas.length + 3, 1).value).toBe("Sem período")
        // Setor fora da legenda continua com nome e cor na lista (a busca usa todos os setores).
        const linhaEsportes = linhas.findIndex(l => l.setorId === "esportes") + 4
        expect(wl.getCell(linhaEsportes, 4).value).toBe("Esportes")
        expect(cor(wl.getCell(linhaEsportes, 4))).toBe("FF16A34A")
    })
})
