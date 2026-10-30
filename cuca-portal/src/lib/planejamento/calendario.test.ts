import { describe, expect, it } from "vitest"
import {
    FILTROS_CALENDARIO_VAZIOS, alternarSetor, aplicarFiltrosCalendario, diaDaSemana, diasDoProjetoNoMes, diasNoMes, distribuirAno,
    filtrosCalendarioDaUrl, filtrosCalendarioParaUrl, linhasDoMes, mesAnterior, mesSeguinte, posicaoNaFaixa, type ProjetoCalendario,
} from "./calendario"

function p(id: string, data_inicio: string | null, data_fim: string | null, extra: Partial<ProjetoCalendario> = {}): ProjetoCalendario {
    return { id, nome: id, setor_id: "esportes", status: "projeto_salvo", tipo: "projeto", periodo_ano_todo: false, data_inicio, data_fim, ...extra }
}
const ids = (l: { projeto: ProjetoCalendario }[] | ProjetoCalendario[]) => l.map(x => ("projeto" in x ? x.projeto.id : x.id))

describe("distribuição pelos meses (ano)", () => {
    const cruza = p("cruza", "2027-06-10", "2027-08-05")
    const mesmoMes = p("mesmo", "2027-03-01", "2027-03-31")
    const anoTodo = p("ano", null, null, { periodo_ano_todo: true })
    const sem = p("sem", null, null)
    const soInicio = p("inicio", "2027-04-15", null)
    const soFim = p("fim", null, "2027-11-02")
    const r = distribuirAno([cruza, mesmoMes, anoTodo, sem, soInicio, soFim])

    it("período que cruza meses aparece em todos eles, com início, meio e fim", () => {
        expect([5, 6, 7, 8, 9].map(m => r.meses[m].some(i => i.projeto.id === "cruza"))).toEqual([false, true, true, true, false])
        expect([6, 7, 8].map(m => r.meses[m].find(i => i.projeto.id === "cruza")?.posicao)).toEqual(["inicio", "meio", "fim"])
    })
    it("início e fim no mesmo mês: um mês só, faixa única", () => {
        expect(r.meses[3]).toEqual([{ projeto: mesmoMes, posicao: "unico" }])
    })
    it("\"Ano todo\" fica fora da grade, na faixa do topo", () => {
        expect(ids(r.anoTodo)).toEqual(["ano"])
        expect(Object.values(r.meses).flat().some(i => i.projeto.id === "ano")).toBe(false)
    })
    it("sem período vai para a lista \"Sem período definido\"", () => {
        expect(ids(r.semPeriodo)).toEqual(["sem"])
    })
    it("só uma data: o mês dela", () => {
        expect(ids(r.meses[4])).toEqual(["inicio"])
        expect(ids(r.meses[11])).toEqual(["fim"])
    })
    it("dentro do mês: pela ordem do setor, depois pelo início", () => {
        const a = p("a", "2027-05-20", "2027-05-25", { setor_id: "cultura" })
        const b = p("b", "2027-05-01", "2027-05-02", { setor_id: "esportes" })
        const c = p("c", "2027-05-03", "2027-05-04", { setor_id: "cultura" })
        const ordem = (s: string) => ({ cultura: 3, esportes: 6 }[s] ?? 99)
        expect(ids(distribuirAno([a, b, c], ordem).meses[5])).toEqual(["c", "a", "b"])
    })
    it("posição da faixa", () => {
        expect(posicaoNaFaixa([4], 4)).toBe("unico")
        expect([2, 3, 4].map(m => posicaoNaFaixa([2, 3, 4], m))).toEqual(["inicio", "meio", "fim"])
    })
})

describe("visão de um mês", () => {
    it("dias e dia da semana de 2027", () => {
        expect(diasNoMes(2)).toBe(28)
        expect(diasNoMes(6)).toBe(30)
        expect(diasNoMes(12)).toBe(31)
        expect(diaDaSemana(1, 1)).toBe(5) // 01/01/2027 é sexta
        expect(diaDaSemana(7, 9)).toBe(2) // 07/09/2027 é terça
    })
    it("dias ocupados: início, fim e o intervalo, cortados nas bordas do mês", () => {
        const x = p("x", "2027-06-10", "2027-08-05")
        expect(diasDoProjetoNoMes(x, 6)).toEqual({ de: 10, ate: 30 })
        expect(diasDoProjetoNoMes(x, 7)).toEqual({ de: 1, ate: 31 })
        expect(diasDoProjetoNoMes(x, 8)).toEqual({ de: 1, ate: 5 })
        expect(diasDoProjetoNoMes(x, 9)).toBeNull()
    })
    it("início e fim no mesmo mês; uma data só; ano todo", () => {
        expect(diasDoProjetoNoMes(p("m", "2027-03-05", "2027-03-07"), 3)).toEqual({ de: 5, ate: 7 })
        expect(diasDoProjetoNoMes(p("i", "2027-04-15", null), 4)).toEqual({ de: 15, ate: 15 })
        expect(diasDoProjetoNoMes(p("f", null, "2027-11-02"), 11)).toEqual({ de: 2, ate: 2 })
        expect(diasDoProjetoNoMes(p("a", null, null, { periodo_ano_todo: true }), 2)).toEqual({ de: 1, ate: 28 })
        expect(diasDoProjetoNoMes(p("s", null, null), 2)).toBeNull()
    })
    it("fim antes do início: só o dia do início (mesma regra de meses da lista)", () => {
        expect(diasDoProjetoNoMes(p("inv", "2027-09-10", "2027-02-01"), 9)).toEqual({ de: 10, ate: 10 })
        expect(diasDoProjetoNoMes(p("inv", "2027-09-10", "2027-02-01"), 2)).toBeNull()
    })
    it("linhas do mês: marca quando continua de antes ou depois; ano todo separado", () => {
        const x = p("x", "2027-06-10", "2027-08-05")
        const y = p("y", "2027-07-03", "2027-07-04")
        const a = p("a", null, null, { periodo_ano_todo: true })
        const r = linhasDoMes([x, y, a], 7)
        expect(ids(r.anoTodo)).toEqual(["a"])
        expect(r.linhas.map(l => [l.projeto.id, l.de, l.ate, l.continuaAntes, l.continuaDepois])).toEqual([
            ["x", 1, 31, true, true],
            ["y", 3, 4, false, false],
        ])
    })
    it("anterior e seguinte param em janeiro e dezembro", () => {
        expect([mesAnterior(1), mesAnterior(6), mesSeguinte(6), mesSeguinte(12)]).toEqual([null, 5, 7, null])
    })
})

describe("filtros e legenda (na URL)", () => {
    const params = (q: string) => new URLSearchParams(q)
    it("ida e volta", () => {
        const f = { mes: 6, ocultos: ["cultura", "esportes"], status: "aprovado" as const, tipo: "projeto" as const }
        expect(filtrosCalendarioParaUrl(f)).toBe("mes=6&ocultos=cultura%2Cesportes&status=aprovado&tipo=projeto")
        expect(filtrosCalendarioDaUrl(params(filtrosCalendarioParaUrl(f)), ["cultura", "esportes"])).toEqual(f)
        expect(filtrosCalendarioParaUrl(FILTROS_CALENDARIO_VAZIOS)).toBe("")
    })
    it("valor desconhecido vira \"sem filtro\"", () => {
        expect(filtrosCalendarioDaUrl(params("mes=13&status=xpto&tipo=1&ocultos=inexistente"), ["esportes"])).toEqual(FILTROS_CALENDARIO_VAZIOS)
        expect(filtrosCalendarioDaUrl(params("mes=0")).mes).toBeNull()
    })
    it("legenda liga e desliga o setor", () => {
        const f = alternarSetor(FILTROS_CALENDARIO_VAZIOS, "esportes")
        expect(f.ocultos).toEqual(["esportes"])
        expect(alternarSetor(f, "esportes").ocultos).toEqual([])
    })
    it("aplica setor desligado, status e tipo", () => {
        const lista = [
            p("a", null, null, { setor_id: "cultura" }),
            p("b", null, null, { status: "aprovado" }),
            p("c", null, null, { tipo: "evento_pontual", status: "aprovado" }),
        ]
        expect(ids(aplicarFiltrosCalendario(lista, { ...FILTROS_CALENDARIO_VAZIOS, ocultos: ["cultura"] }))).toEqual(["b", "c"])
        expect(ids(aplicarFiltrosCalendario(lista, { ...FILTROS_CALENDARIO_VAZIOS, status: "aprovado", tipo: "projeto" }))).toEqual(["b"])
    })
})
