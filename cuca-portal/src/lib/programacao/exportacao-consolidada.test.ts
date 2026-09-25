import { describe, expect, it } from "vitest"
import ExcelJS from "exceljs"
import {
    ORDEM_ABAS_CONSOLIDADA, formatarData, limparTurma, formatarHora, montarAbasConsolidadas, nomeArquivoConsolidado,
    nomeCurtoUnidade, resolverUnidade, type AtividadeConsolidada,
} from "./exportacao-consolidada"
import { gerarXlsxConsolidado } from "./gerar-xlsx-consolidado"
import { menuItems } from "@/lib/constants"
import { PGM_EXPORTACAO_CONSOLIDADA } from "@/lib/rbac/catalogo-programacao-mensal"

const esporte = (titulo: string, meta: Record<string, unknown>, hi = "07:00:00", hf = "08:00:00"): AtividadeConsolidada => ({
    titulo, categoria: "ESPORTES", hora_inicio: hi, hora_fim: hf, metadata: meta,
})

const ATIVIDADES: AtividadeConsolidada[] = [
    esporte("Natação", { professor: "Wilson", turma: "Turma 2", faixa_etaria: "15 a 29 anos", sexo: "Misto", vagas: "20", dias_semana: "Ter e Qui" }, "08:00:00", "09:00:00"),
    esporte("Natação", { professor: "Wilson", turma: "Turma 1", faixa_etaria: "Natação", sexo: "Misto", vagas: "20", dias_semana: "Ter e Qui" }),
    // Grafia antiga "ESPORTE" conta como ESPORTES.
    { titulo: "Basquete", categoria: "ESPORTE", hora_inicio: null, hora_fim: null, metadata: { professor: "Ana" } },
    {
        titulo: "Fotografia de rua", categoria: "CURSOS", data_atividade: "2026-10-06", hora_inicio: "09:00:00", hora_fim: "12:00:00",
        metadata: { educador: "Thiago", vagas: "20", carga_horaria: "21", periodo: "06/10/2026 a 27/10/2026", dias_semana: "Qua e Sex", requisitos: "15 a 29 anos", ementa: "Técnicas de fotografia" },
    },
    {
        // Importação antiga: período ilegível — início cai na data_atividade, término fica vazio.
        titulo: "Libras", categoria: "CURSOS", data_atividade: "2026-10-07", hora_inicio: "14:00:00", hora_fim: null,
        metadata: { educador: "Daniel", periodo: "a combinar" },
    },
    {
        titulo: "Hora Pintada", categoria: "DIA A DIA", data_atividade: "2026-10-09", hora_inicio: "14:00:00", hora_fim: "17:00:00", local: "Biblioteca",
        metadata: { sessao: "Biblioteca", atividade: "Pintura livre", dia_semana: "Sexta-feira", informacoes: "Aberto ao público" },
    },
    {
        titulo: "Venha Jogar", categoria: "DIA A DIA", data_atividade: "2026-10-03", hora_inicio: "09:00:00", hora_fim: "12:00:00", local: null,
        metadata: { sessao: "Biblioteca", atividade: "Jogos", dia_semana: "Sábado", local: "Sala 2" },
    },
]

describe("montarAbasConsolidadas (S-PROG-18)", () => {
    const abas = montarAbasConsolidadas("Cuca Pici", 10, 2026, ATIVIDADES)
    const aba = (nome: string) => abas.find(a => a.categoria === nome)!

    it("sempre as 4 abas, na ordem pedida, com nome sem '/' e até 31 caracteres", () => {
        expect(abas.map(a => a.categoria)).toEqual(["ESPORTES", "CURSOS", "DIA A DIA", "ESPECIAIS"])
        expect(ORDEM_ABAS_CONSOLIDADA).toEqual(["ESPORTES", "CURSOS", "DIA A DIA", "ESPECIAIS"])
        expect(abas.map(a => a.nomeAba)).toEqual([
            "ESPORTES - OUTUBRO 26", "CURSOS - OUTUBRO 26", "DIA A DIA - OUTUBRO 26", "ESPECIAIS - OUTUBRO 26",
        ])
        for (let mes = 1; mes <= 12; mes++) {
            for (const a of montarAbasConsolidadas("Cuca José Walter", mes, 2026, [])) {
                expect(a.nomeAba.length).toBeLessThanOrEqual(31)
                expect(a.nomeAba).not.toMatch(/[\\/?*[\]:]/)
            }
        }
    })

    it("título da linha 1 no formato da PICI", () => {
        expect(abas[0].titulo).toBe("OUTUBRO 2026 - REDE CUCA PICI")
        expect(nomeCurtoUnidade("CUCA José Walter")).toBe("JOSÉ WALTER")
    })

    it("ESPORTES: campos do portal, ordenado por modalidade/turma/horário, faixa etária igual ao título sai vazia", () => {
        const e = aba("ESPORTES")
        expect(e.colunas.map(c => c.titulo)).toEqual(["Modalidade", "Professor", "Turma", "Idade", "Sexo", "Vagas", "Dias", "Horário início", "Horário fim"])
        expect(e.linhas).toEqual([
            ["Basquete", "Ana", "", "", "", "", "", "", ""],
            ["Natação", "Wilson", "Turma 1", "", "Misto", "20", "Ter e Qui", "07:00", "08:00"],
            ["Natação", "Wilson", "Turma 2", "15 a 29 anos", "Misto", "20", "Ter e Qui", "08:00", "09:00"],
        ])
    })

    it("CURSOS: início/término do período; sem período legível, início = data e término vazio", () => {
        const c = aba("CURSOS")
        expect(c.colunas.map(x => x.titulo)).toEqual([
            "Curso", "Educador", "Vagas", "Carga horária", "Início", "Término", "Dias", "Horário início", "Horário fim", "Pré-requisitos", "Ementa",
        ])
        expect(c.linhas[0]).toEqual(["Fotografia de rua", "Thiago", "20", "21", "06/10/2026", "27/10/2026", "Qua e Sex", "09:00", "12:00", "15 a 29 anos", "Técnicas de fotografia"])
        expect(c.linhas[1]).toEqual(["Libras", "Daniel", "", "", "07/10/2026", "", "", "14:00", "", "", ""])
    })

    it("DIA A DIA: ordenado por data e horário; local cai no metadata quando a coluna está vazia", () => {
        const d = aba("DIA A DIA")
        // S-PROG-19: "Data" virou "Data início · Data fim". Linha sem a coluna nova: data fim vazia.
        expect(d.colunas.map(x => x.titulo)).toEqual(["Sessão", "Programa", "Atividade", "Data início", "Data fim", "Dia da semana", "Horário início", "Horário fim", "Local", "Informações"])
        expect(d.linhas).toEqual([
            ["Biblioteca", "Venha Jogar", "Jogos", "03/10/2026", "", "Sábado", "09:00", "12:00", "Sala 2", ""],
            ["Biblioteca", "Hora Pintada", "Pintura livre", "09/10/2026", "", "Sexta-feira", "14:00", "17:00", "Biblioteca", "Aberto ao público"],
        ])
    })

    it("categoria sem atividade sai vazia (só título e cabeçalho), com as cores da PICI", () => {
        const esp = aba("ESPECIAIS")
        expect(esp.linhas).toEqual([])
        expect(esp.colunas.length).toBe(10)
        expect(esp.cores).toEqual({ cabecalho: "FFD966", linhas: "FFF2CC" })
        expect(aba("CURSOS").cores).toEqual({ cabecalho: "F1C232", linhas: "FFD966" })
        expect(aba("ESPORTES").cores).toEqual({ cabecalho: "FF00FF" })
        expect(aba("DIA A DIA").cores).toEqual({ cabecalho: "6D9EEB" })
    })

    it("formatadores e nome do arquivo", () => {
        expect(limparTurma("Turma TURMA 1")).toBe("TURMA 1")
        expect(limparTurma("Turma 2")).toBe("Turma 2")
        expect(limparTurma("Turmalina")).toBe("Turmalina")
        expect(formatarHora("07:30:00")).toBe("07:30")
        expect(formatarHora(null)).toBe("")
        expect(formatarData("2026-10-07")).toBe("07/10/2026")
        expect(formatarData(undefined)).toBe("")
        expect(nomeArquivoConsolidado("Cuca José Walter", 10, 2026)).toBe("Programacao_Consolidada_Cuca_José_Walter_Outubro_2026.xlsx")
    })
})

describe("S-PROG-19 — colunas data_inicio/data_fim na exportação", () => {
    it("evento de vários dias sai com início e fim; CURSOS usa as colunas antes do texto do período", () => {
        const abas = montarAbasConsolidadas("Cuca Pici", 10, 2026, [
            { titulo: "Feira", categoria: "ESPECIAIS", data_atividade: "2026-10-26", data_inicio: "2026-10-26", data_fim: "2026-10-27",
              hora_inicio: "08:00:00", hora_fim: "17:00:00", local: "Anfiteatro", metadata: { sessao: "Cultura", atividade: "Feira das Profissões", dia_semana: "Segunda-feira" } },
            { titulo: "Violão", categoria: "CURSOS", data_atividade: "2026-08-31", data_inicio: "2026-10-06", data_fim: "2026-10-29",
              hora_inicio: "09:00:00", hora_fim: "12:00:00", metadata: { periodo: "01/10/2026 a 02/10/2026" } },
            { titulo: "Teatro", categoria: "CURSOS", data_atividade: "2026-10-02", data_inicio: "2026-10-02", data_fim: null,
              hora_inicio: "09:00:00", hora_fim: "12:00:00", metadata: { periodo: "02/10/2026 a 30/10/2020" } },
        ])
        const esp = abas.find(a => a.categoria === "ESPECIAIS")!
        expect(esp.linhas[0].slice(3, 5)).toEqual(["26/10/2026", "27/10/2026"])
        const cursos = abas.find(a => a.categoria === "CURSOS")!
        expect(cursos.linhas.find(l => l[0] === "Violão")!.slice(4, 6)).toEqual(["06/10/2026", "29/10/2026"])
        // Término sem data válida gravada fica vazio (não volta a ler o ano errado do texto).
        expect(cursos.linhas.find(l => l[0] === "Teatro")!.slice(4, 6)).toEqual(["02/10/2026", ""])
    })
})

describe("resolverUnidade (S-PROG-18, AC 8)", () => {
    const campanhas = [
        { id: "p1", unidade_cuca: "Cuca Pici" },
        { id: "b1", unidade_cuca: "Cuca Barra" },
        { id: "p2", unidade_cuca: "Cuca Pici" },
        { id: "x", unidade_cuca: null },
    ]
    const todas = () => true
    const soPici = (u: string) => u === "Cuca Pici"

    it("sem unidade fixa: lista todas, usa a pedida e junta as campanhas dela", () => {
        expect(resolverUnidade(campanhas, todas, "Cuca Pici")).toEqual({ unidades: ["Cuca Barra", "Cuca Pici"], unidade: "Cuca Pici", campanhaIds: ["p1", "p2"] })
        expect(resolverUnidade(campanhas, todas, null).unidade).toBe("Cuca Barra")
    })

    it("com unidade fixa: pedir outra unidade não troca de unidade", () => {
        const r = resolverUnidade(campanhas, soPici, "Cuca Barra")
        expect(r).toEqual({ unidades: ["Cuca Pici"], unidade: "Cuca Pici", campanhaIds: ["p1", "p2"] })
    })

    it("sem programação ao alcance: unidade nula e nenhuma campanha", () => {
        expect(resolverUnidade(campanhas, () => false, "Cuca Pici")).toEqual({ unidades: [], unidade: null, campanhaIds: [] })
        expect(resolverUnidade([], todas, null)).toEqual({ unidades: [], unidade: null, campanhaIds: [] })
    })
})

describe("gerarXlsxConsolidado (S-PROG-18)", () => {
    it("grava 4 abas com título mesclado, cabeçalho, dados e cores", async () => {
        const abas = montarAbasConsolidadas("Cuca Pici", 10, 2026, ATIVIDADES)
        const buffer = await gerarXlsxConsolidado(abas)

        const wb = new ExcelJS.Workbook()
        await wb.xlsx.load(buffer)
        expect(wb.worksheets.map(w => w.name)).toEqual(abas.map(a => a.nomeAba))

        const cursos = wb.getWorksheet("CURSOS - OUTUBRO 26")!
        expect(cursos.getCell("A1").value).toBe("OUTUBRO 2026 - REDE CUCA PICI")
        expect(cursos.getCell("K1").isMerged).toBe(true)
        expect(cursos.getCell("A2").value).toBe("Curso")
        expect(cursos.getCell("A2").font?.bold).toBe(true)
        expect((cursos.getCell("A2").fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFF1C232")
        expect(cursos.getCell("A3").value).toBe("Fotografia de rua")
        expect((cursos.getCell("A3").fill as ExcelJS.FillPattern).fgColor?.argb).toBe("FFFFD966")
        expect(cursos.getCell("K3").alignment?.wrapText).toBe(true)

        const especiais = wb.getWorksheet("ESPECIAIS - OUTUBRO 26")!
        expect(especiais.getCell("A2").value).toBe("Sessão")
        expect(especiais.getCell("A3").value).toBeNull()
    })
})

describe("menu (S-PROG-18)", () => {
    it("o subitem usa a opção exata da tela de Perfis", () => {
        const programacao = menuItems.find(m => m.url === "/programacao")
        const item = programacao?.items?.find(i => i.url === "/programacao/exportar") as { permission?: { recurso: string } } | undefined
        expect(item?.permission?.recurso).toBe(PGM_EXPORTACAO_CONSOLIDADA.ver)
    })
})
