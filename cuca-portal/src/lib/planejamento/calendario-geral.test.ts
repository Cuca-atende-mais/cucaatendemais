import { describe, expect, it } from "vitest"
import {
    CABECALHO_GRADE, COLUNAS_GRADE, atividadesPorMes, colunaFimDeSemana, contarPorSetor, linhasLista, montarGradeAno,
    nomeArquivoCalendarioGeral, rotuloDatas, rotuloLocais, textoDoDia, textoFiltros, type ProjetoCalendarioGeral,
} from "./calendario-geral"
import { FILTROS_CALENDARIO_VAZIOS } from "./calendario"

// S-PLA-10: dados sintéticos (nenhum nome real).
function p(x: Partial<ProjetoCalendarioGeral> & { id: string }): ProjetoCalendarioGeral {
    return {
        nome: `Atividade ${x.id}`, setor_id: "esportes", status: "projeto_salvo", tipo: "evento_pontual",
        periodo_ano_todo: false, data_inicio: null, data_fim: null, responsavel_nome: "Pessoa Teste",
        locais_unidades: [], local_outro: false, local_outro_texto: null, dias_horarios: null, ...x,
    }
}
const ORDEM: Record<string, number> = { direitos: 1, cultura: 3, esportes: 6 }
const ordem = (id: string) => ORDEM[id] ?? 99
const NOMES: Record<string, string> = { direitos: "Direitos Humanos", cultura: "Cultura", esportes: "Esportes" }
const nomeSetor = (id: string) => NOMES[id] ?? id

describe("grade do ano", () => {
    it("tem 37 colunas, começa no domingo e marca sábado/domingo", () => {
        expect(COLUNAS_GRADE).toBe(37)
        expect(CABECALHO_GRADE.slice(0, 7)).toEqual(["D", "S", "T", "Q", "Q", "S", "S"])
        expect([0, 6, 7, 13, 34, 35].every(c => colunaFimDeSemana(c))).toBe(true)
        expect([1, 5, 8, 36].some(c => colunaFimDeSemana(c))).toBe(false)
    })

    it("alinha cada mês pelo dia da semana (2027)", () => {
        const g = montarGradeAno([])
        expect(g).toHaveLength(12)
        // 01/01/2027 é sexta (coluna 5); 01/05/2027 é sábado (coluna 6) e o dia 31 cai na última coluna.
        expect(g[0].celulas.findIndex(c => c?.dia === 1)).toBe(5)
        expect(g[4].celulas.findIndex(c => c?.dia === 1)).toBe(6)
        expect(g[4].celulas[36]?.dia).toBe(31)
        // Fevereiro de 2027 tem 28 dias.
        expect(g[1].celulas.filter(Boolean)).toHaveLength(28)
        expect(g.every(m => m.celulas.length === 37)).toBe(true)
        // 02/01/2027 é sábado.
        expect(g[0].celulas.find(c => c?.dia === 2)?.fimDeSemana).toBe(true)
    })

    it("pinta os dias de cada atividade, inclusive período que atravessa meses", () => {
        const g = montarGradeAno([p({ id: "a", data_inicio: "2027-01-30", data_fim: "2027-02-02" })], ordem)
        const dias = (m: number) => g[m - 1].celulas.filter(c => c && c.projetos.length).map(c => c!.dia)
        expect(dias(1)).toEqual([30, 31])
        expect(dias(2)).toEqual([1, 2])
        expect(dias(3)).toEqual([])
    })

    it("um dia só: data de início sem fim, fim sem início, e fim antes do início", () => {
        const g = montarGradeAno([
            p({ id: "a", data_inicio: "2027-03-06" }),
            p({ id: "b", data_fim: "2027-03-08" }),
            p({ id: "c", data_inicio: "2027-03-20", data_fim: "2027-03-10" }),
        ])
        const dias = g[2].celulas.filter(c => c && c.projetos.length).map(c => `${c!.dia}:${c!.projetos.map(x => x.id).join("")}`)
        expect(dias).toEqual(["6:a", "8:b", "20:c"])
    })

    it("deixa fora da grade o ano todo e o sem período", () => {
        const g = montarGradeAno([p({ id: "a", periodo_ano_todo: true }), p({ id: "b" })])
        expect(g.flatMap(m => m.celulas).some(c => c && c.projetos.length)).toBe(false)
    })

    it("dia com vários setores: setores sem repetição, na ordem dos setores", () => {
        const g = montarGradeAno([
            p({ id: "a", setor_id: "esportes", data_inicio: "2027-06-10", data_fim: "2027-06-10" }),
            p({ id: "b", setor_id: "cultura", data_inicio: "2027-06-01", data_fim: "2027-06-30" }),
            p({ id: "c", setor_id: "esportes", data_inicio: "2027-06-10" }),
        ], ordem)
        const c = g[5].celulas.find(x => x?.dia === 10)!
        expect(c.setores).toEqual(["cultura", "esportes"])
        expect(c.projetos.map(x => x.id)).toEqual(["b", "a", "c"])
        expect(textoDoDia(c, nomeSetor)).toBe("Atividade b (Cultura)\nAtividade a (Esportes)\nAtividade c (Esportes)")
    })
})

describe("datas como no calendário oficial", () => {
    it("um dia, período, ano todo, sem período, só uma data, fim antes do início e outro ano", () => {
        expect(rotuloDatas(p({ id: "a", data_inicio: "2027-01-16", data_fim: "2027-01-16" }))).toBe("16/01")
        expect(rotuloDatas(p({ id: "a", data_inicio: "2027-01-13", data_fim: "2027-01-18" }))).toBe("13/01 a 18/01")
        expect(rotuloDatas(p({ id: "a", periodo_ano_todo: true }))).toBe("Ano todo")
        expect(rotuloDatas(p({ id: "a" }))).toBe("")
        expect(rotuloDatas(p({ id: "a", data_fim: "2027-02-24" }))).toBe("24/02")
        expect(rotuloDatas(p({ id: "a", data_inicio: "2027-03-20", data_fim: "2027-03-10" }))).toBe("20/03 a 10/03")
        expect(rotuloDatas(p({ id: "a", data_inicio: "2027-12-20", data_fim: "2028-01-05" }))).toBe("20/12 a 05/01/2028")
    })
})

describe("atividades por mês", () => {
    const lista = [
        p({ id: "longo", setor_id: "cultura", data_inicio: "2027-06-01", data_fim: "2027-10-03" }),
        p({ id: "dia", setor_id: "esportes", data_inicio: "2027-06-01", data_fim: "2027-06-01" }),
        p({ id: "antes", setor_id: "esportes", data_inicio: "2027-05-30", data_fim: "2027-06-02" }),
        p({ id: "todo", setor_id: "direitos", periodo_ano_todo: true }),
        p({ id: "sem", setor_id: "cultura" }),
    ]

    it("aparece uma vez só, no mês em que começa, ordenada pela data e depois pelo setor", () => {
        const a = atividadesPorMes(lista, ordem)
        expect(a.meses[5].map(x => x.id)).toEqual(["antes"])
        expect(a.meses[6].map(x => x.id)).toEqual(["longo", "dia"])
        expect(a.meses[7]).toEqual([])
        expect(a.anoTodo.map(x => x.id)).toEqual(["todo"])
        expect(a.semPeriodo.map(x => x.id)).toEqual(["sem"])
        const total = Object.values(a.meses).flat().length + a.anoTodo.length + a.semPeriodo.length
        expect(total).toBe(lista.length)
    })

    it("conta por setor", () => {
        expect(Object.fromEntries(contarPorSetor(lista))).toEqual({ cultura: 2, esportes: 2, direitos: 1 })
    })

    it("planilha: uma linha por atividade, ano todo primeiro e sem período no fim, texto como foi digitado", () => {
        const a = atividadesPorMes([...lista, p({ id: "x", nome: "  NOME   Como Digitado ", setor_id: "cultura", data_inicio: "2027-01-02", responsavel_nome: null, dias_horarios: "sábados às 18h", locais_unidades: ["u1", "u9"], local_outro: true, local_outro_texto: "Praça" })], ordem)
        const linhas = linhasLista(a, nomeSetor, id => ({ u1: "Unidade Um" } as Record<string, string>)[id])
        expect(linhas.map(l => l.valores[0])).toEqual(["Ano todo", "Janeiro", "Maio", "Junho", "Junho", "Sem período"])
        expect(linhas[1].valores).toEqual(["Janeiro", "02/01", "  NOME   Como Digitado ", "Cultura", "", "Evento pontual", "Projeto salvo", "Unidade Um, Praça", "sábados às 18h"])
        expect(linhas[1].setorId).toBe("cultura")
    })
})

describe("apoio", () => {
    it("locais: só unidades conhecidas e o outro local quando marcado", () => {
        const nome = (id: string) => (id === "u1" ? "Unidade Um" : undefined)
        expect(rotuloLocais(p({ id: "a", locais_unidades: ["u1", "u2"] }), nome)).toBe("Unidade Um")
        expect(rotuloLocais(p({ id: "a", locais_unidades: null, local_outro: true, local_outro_texto: "Ginásio" }), nome)).toBe("Ginásio")
        expect(rotuloLocais(p({ id: "a", local_outro: false, local_outro_texto: "Ginásio" }), nome)).toBe("")
    })

    it("texto dos filtros e nome dos arquivos", () => {
        expect(textoFiltros(FILTROS_CALENDARIO_VAZIOS, nomeSetor)).toBe("")
        expect(textoFiltros({ mes: null, ocultos: ["cultura"], status: "aprovado", tipo: "projeto" }, nomeSetor))
            .toBe("Filtros: status: Aprovado; tipo: Projeto; setores fora: Cultura")
        expect(nomeArquivoCalendarioGeral("pdf")).toBe("calendario-geral-2027.pdf")
        expect(nomeArquivoCalendarioGeral("xlsx")).toBe("calendario-geral-2027.xlsx")
    })
})
