import { describe, expect, it } from "vitest"
import {
    FILTROS_VAZIOS, alternarOrdenacao, alternarStatus, aplicarFiltros, contarPorStatus, etiquetaSetores, filtrosDaUrl,
    filtrosParaUrl, lerVisualizacao, mesDentroDoPeriodo, mesesDoPeriodo, mostrarFiltroSetor, normalizarBusca, ordenar,
    rotuloPeriodo, temFiltroAtivo, aplicarResumo, type Filtros, type ProjetoLista,
} from "./lista"

const periodo = (data_inicio: string | null, data_fim: string | null, periodo_ano_todo = false) => ({ periodo_ano_todo, data_inicio, data_fim })

function projeto(p: Partial<ProjetoLista> & { id: string }): ProjetoLista {
    return {
        nome: p.id, setor_id: "esportes", tipo: "projeto", status: "em_construcao", ficha: "parcial", situacao_2026: null,
        participantes_estimados: null, orcamento_total: 0, updated_at: "2026-10-28T10:00:00Z",
        periodo_ano_todo: false, data_inicio: null, data_fim: null, correcoes_abertas: 0, validado: false, ...p,
    }
}

describe("mês dentro do período", () => {
    it("período que cruza meses aparece em todos eles", () => {
        const p = periodo("2027-06-10", "2027-08-05")
        expect(mesesDoPeriodo(p)).toEqual({ tipo: "meses", meses: [6, 7, 8] })
        expect([5, 6, 7, 8, 9].map(m => mesDentroDoPeriodo(p, m))).toEqual([false, true, true, true, false])
    })
    it("início e fim no mesmo mês", () => {
        expect(mesesDoPeriodo(periodo("2027-03-01", "2027-03-31"))).toEqual({ tipo: "meses", meses: [3] })
    })
    it("só uma data: o mês dela", () => {
        expect(mesesDoPeriodo(periodo("2027-04-15", null))).toEqual({ tipo: "meses", meses: [4] })
        expect(mesesDoPeriodo(periodo(null, "2027-11-02"))).toEqual({ tipo: "meses", meses: [11] })
    })
    it("\"Ano todo\" fica numa faixa própria: casa só com a opção \"Ano todo\"", () => {
        const p = periodo(null, null, true)
        expect(mesesDoPeriodo(p)).toEqual({ tipo: "ano_todo" })
        expect(mesDentroDoPeriodo(p, "ano_todo")).toBe(true)
        expect(mesDentroDoPeriodo(p, 6)).toBe(false)
        expect(mesDentroDoPeriodo(periodo("2027-01-01", "2027-12-31"), "ano_todo")).toBe(false)
    })
    it("sem período não aparece em mês nenhum", () => {
        const p = periodo(null, null)
        expect(mesesDoPeriodo(p)).toEqual({ tipo: "sem_periodo" })
        expect(mesDentroDoPeriodo(p, 1)).toBe(false)
        expect(mesDentroDoPeriodo(p, "ano_todo")).toBe(false)
    })
    it("data de outro ano é ignorada; fim antes do início fica no mês do início", () => {
        expect(mesesDoPeriodo(periodo("2026-12-01", null))).toEqual({ tipo: "sem_periodo" })
        expect(mesesDoPeriodo(periodo("2027-09-01", "2027-02-01"))).toEqual({ tipo: "meses", meses: [9] })
    })
})

describe("rótulo do período no card", () => {
    it("formata intervalo, mês único, ano todo e vazio", () => {
        expect(rotuloPeriodo(periodo("2027-06-01", "2027-08-31"))).toBe("Jun–Ago/2027")
        expect(rotuloPeriodo(periodo("2027-03-05", "2027-03-06"))).toBe("Mar/2027")
        expect(rotuloPeriodo(periodo(null, null, true))).toBe("Ano todo")
        expect(rotuloPeriodo(periodo(null, null))).toBe("")
    })
})

describe("filtros na URL", () => {
    const params = (q: string) => new URLSearchParams(q)
    it("ida e volta mantém os filtros", () => {
        const f: Filtros = {
            busca: "olimpíadas", setor: "esportes", status: "aprovado", situacao: "novo", tipo: "projeto", mes: 6,
            correcao: "", validacao: "",
        }
        expect(filtrosDaUrl(params(filtrosParaUrl(f)), ["esportes", "cultura"])).toEqual(f)
        const g: Filtros = { ...f, correcao: "abertas", validacao: "nao_validados" }
        expect(filtrosDaUrl(params(filtrosParaUrl(g)), ["esportes", "cultura"], true)).toEqual(g)
        expect(filtrosDaUrl(params(filtrosParaUrl({ ...FILTROS_VAZIOS, mes: "ano_todo" })))).toEqual({ ...FILTROS_VAZIOS, mes: "ano_todo" })
    })
    it("sem filtro gera URL vazia; ordem dos parâmetros é fixa", () => {
        expect(filtrosParaUrl(FILTROS_VAZIOS)).toBe("")
        expect(filtrosParaUrl({ ...FILTROS_VAZIOS, mes: 3, setor: "cultura" })).toBe("setor=cultura&mes=3")
        expect(temFiltroAtivo(FILTROS_VAZIOS)).toBe(false)
        expect(temFiltroAtivo({ ...FILTROS_VAZIOS, busca: "  " })).toBe(false)
    })
    it("valor desconhecido vira \"sem filtro\"", () => {
        expect(filtrosDaUrl(params("status=xpto&tipo=1&situacao=&mes=13&setor=inexistente"), ["esportes"])).toEqual(FILTROS_VAZIOS)
        expect(filtrosDaUrl(params("mes=0")).mes).toBe("")
    })
    it("S-PLA-04: correção e validação só valem com acompanhamento; valor desconhecido é ignorado", () => {
        const q = params("correcao=abertas&validacao=validados")
        expect(filtrosDaUrl(q, [], false)).toEqual(FILTROS_VAZIOS)
        expect(temFiltroAtivo(filtrosDaUrl(q, [], false))).toBe(false)
        expect(filtrosDaUrl(q, [], true)).toEqual({ ...FILTROS_VAZIOS, correcao: "abertas", validacao: "validados" })
        expect(filtrosDaUrl(params("correcao=sim&validacao=talvez"), [], true)).toEqual(FILTROS_VAZIOS)
        expect(filtrosParaUrl({ ...FILTROS_VAZIOS, mes: 3, correcao: "abertas", validacao: "validados" })).toBe("mes=3&correcao=abertas&validacao=validados")
    })
    it("busca vem aparada e com no máximo 200 caracteres", () => {
        expect(filtrosDaUrl(params("busca=%20%20sarau%20")).busca).toBe("sarau")
        expect(filtrosDaUrl(params(`busca=${"a".repeat(250)}`)).busca).toHaveLength(200)
    })
})

describe("aplicar filtros", () => {
    const lista = [
        projeto({ id: "a", nome: "Olimpíadas da Juventude", status: "aprovado", situacao_2026: "novo", tipo: "evento_pontual", ...periodo("2027-06-01", "2027-07-31") }),
        projeto({ id: "b", nome: "Sarau", setor_id: "cultura", status: "aprovado", ...periodo(null, null, true) }),
        projeto({ id: "c", nome: "Oficina", status: "em_construcao", situacao_2026: "mantem" }),
    ]
    const ids = (f: Partial<Filtros>) => aplicarFiltros(lista, { ...FILTROS_VAZIOS, ...f }).map(p => p.id)

    it("busca sem acento e sem maiúscula", () => {
        expect(normalizarBusca("  OlÍmPiAdAs ")).toBe("olimpiadas")
        expect(ids({ busca: "olimpiadas" })).toEqual(["a"])
    })
    it("cada filtro e a combinação", () => {
        expect(ids({ setor: "cultura" })).toEqual(["b"])
        expect(ids({ status: "aprovado" })).toEqual(["a", "b"])
        expect(ids({ situacao: "mantem" })).toEqual(["c"])
        expect(ids({ tipo: "evento_pontual" })).toEqual(["a"])
        expect(ids({ mes: 7 })).toEqual(["a"])
        expect(ids({ mes: "ano_todo" })).toEqual(["b"])
        expect(ids({ status: "aprovado", setor: "esportes" })).toEqual(["a"])
    })
    it("contadores ignoram o próprio filtro de status e respeitam os outros", () => {
        const c = contarPorStatus(lista, { ...FILTROS_VAZIOS, status: "aprovado", setor: "esportes" })
        expect(c.total).toBe(2)
        expect(c.aprovado).toBe(1)
        expect(c.em_construcao).toBe(1)
        expect(c.reprovado).toBe(0)
    })
    it("clicar no contador ativo desfaz", () => {
        const f = alternarStatus(FILTROS_VAZIOS, "aprovado")
        expect(f.status).toBe("aprovado")
        expect(alternarStatus(f, "aprovado").status).toBe("")
        expect(alternarStatus(f, "reprovado").status).toBe("reprovado")
    })
})

describe("ordenação da tabela", () => {
    const lista = [
        projeto({ id: "1", nome: "Banda", setor_id: "cultura", status: "reprovado", orcamento_total: 500, updated_at: "2026-10-01T00:00:00Z" }),
        projeto({ id: "2", nome: "árvore", setor_id: "esportes", status: "aprovado", orcamento_total: 1500, updated_at: "2026-10-03T00:00:00Z" }),
        projeto({ id: "3", nome: "Coral", setor_id: "cultura", status: "em_construcao", orcamento_total: 0, updated_at: "2026-10-02T00:00:00Z" }),
    ]
    const nomes = { cultura: "Cultura", esportes: "Esportes" } as Record<string, string>
    const ordem = (coluna: Parameters<typeof ordenar>[1]["coluna"], direcao: "asc" | "desc") => ordenar(lista, { coluna, direcao }, id => nomes[id]).map(p => p.id)

    it("por nome (sem acento atrapalhar), setor, status, orçamento e atualização", () => {
        expect(ordem("nome", "asc")).toEqual(["2", "1", "3"])
        expect(ordem("setor", "asc")).toEqual(["1", "3", "2"])
        expect(ordem("status", "asc")).toEqual(["3", "2", "1"])
        expect(ordem("orcamento", "desc")).toEqual(["2", "1", "3"])
        expect(ordem("atualizado", "desc")).toEqual(["2", "3", "1"])
    })
    it("mesma coluna inverte; coluna nova começa crescente (atualização, da mais recente)", () => {
        expect(alternarOrdenacao({ coluna: "nome", direcao: "asc" }, "nome")).toEqual({ coluna: "nome", direcao: "desc" })
        expect(alternarOrdenacao({ coluna: "nome", direcao: "desc" }, "orcamento")).toEqual({ coluna: "orcamento", direcao: "asc" })
        expect(alternarOrdenacao({ coluna: "nome", direcao: "asc" }, "atualizado")).toEqual({ coluna: "atualizado", direcao: "desc" })
    })
})

describe("setores do cabeçalho, filtro de setor e visualização", () => {
    it("todos os setores quando pode atuar em todos", () => {
        expect(etiquetaSetores(6, 6)).toBe("todos")
        expect(etiquetaSetores(2, 6)).toBe("lista")
        expect(etiquetaSetores(0, 0)).toBe("lista")
    })
    it("filtro de setor só com mais de um setor", () => {
        expect(mostrarFiltroSetor(1)).toBe(false)
        expect(mostrarFiltroSetor(2)).toBe(true)
    })
    it("visualização guardada: só \"tabela\" muda o padrão", () => {
        expect(lerVisualizacao("tabela")).toBe("tabela")
        expect(lerVisualizacao("cards")).toBe("cards")
        expect(lerVisualizacao(null)).toBe("cards")
        expect(lerVisualizacao("lixo")).toBe("cards")
    })
})

describe("S-PLA-04: selos e filtros do acompanhamento", () => {
    const base = [projeto({ id: "a" }), projeto({ id: "b" }), projeto({ id: "c", status: "aprovado" })]
    const resumo = { a: { correcoes: 2, validado: false }, c: { correcoes: 0, validado: true }, fora: { correcoes: 5, validado: true } }
    const lista = aplicarResumo(base, resumo)

    it("junta o resumo do banco; projeto fora dele fica sem selo", () => {
        expect(lista.map(p => [p.id, p.correcoes_abertas, p.validado])).toEqual([["a", 2, false], ["b", 0, false], ["c", 0, true]])
    })
    it("filtra por correção em aberto e por validação", () => {
        const ids = (f: Partial<Filtros>) => aplicarFiltros(lista, { ...FILTROS_VAZIOS, ...f }).map(p => p.id)
        expect(ids({ correcao: "abertas" })).toEqual(["a"])
        expect(ids({ validacao: "validados" })).toEqual(["c"])
        expect(ids({ validacao: "nao_validados" })).toEqual(["a", "b"])
        expect(ids({ correcao: "abertas", validacao: "validados" })).toEqual([])
    })
    it("os contadores respeitam os filtros novos", () => {
        const c = contarPorStatus(lista, { ...FILTROS_VAZIOS, validacao: "validados" })
        expect(c.total).toBe(1)
        expect(c.aprovado).toBe(1)
    })
})
