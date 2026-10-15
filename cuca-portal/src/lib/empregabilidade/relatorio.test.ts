import { describe, expect, it } from "vitest"
import {
    agruparLinhas,
    letraColuna,
    lerPeriodo,
    mesAtualFortaleza,
    montarAbaDetalhe,
    montarAbaIndicadores,
    montarCartoes,
    montarPlanilha,
    nomeArquivoRelatorio,
    normalizarUnidade,
    periodoAnterior,
    periodoDoAtalho,
    resolverEscopo,
    rotuloPeriodo,
    type ContextoPlanilha,
    type LinhaRpc,
    type Unidade,
} from "./relatorio"

const PICI = "2a1f2bee-f89a-4d2b-b1bd-175c7c9e18d4"
const BARRA = "ecbc8153-a94f-4d9b-9e61-7b0e0cd68740"
const UNIDADES: Unidade[] = [{ id: BARRA, nome: "CUCA Barra" }, { id: PICI, nome: "CUCA Pici" }]

describe("período (AC2, AC3)", () => {
    it("mês corrente no fuso de Fortaleza, não UTC", () => {
        // 01/10 02:00 UTC = 30/09 23:00 em Fortaleza.
        expect(mesAtualFortaleza(new Date("2026-10-01T02:00:00Z"))).toBe("2026-09")
        expect(mesAtualFortaleza(new Date("2026-10-01T03:00:00Z"))).toBe("2026-10")
    })

    it("atalhos a partir do mês de Fortaleza", () => {
        const agora = new Date("2026-10-14T15:00:00Z")
        expect(periodoDoAtalho("mes_passado", agora)).toEqual({ inicio: "2026-09", fim: "2026-09" })
        expect(periodoDoAtalho("ultimos_3", agora)).toEqual({ inicio: "2026-07", fim: "2026-09" })
        expect(periodoDoAtalho("ano_atual", agora)).toEqual({ inicio: "2026-01", fim: "2026-10" })
        expect(periodoDoAtalho("mes_passado", new Date("2026-01-10T12:00:00Z"))).toEqual({ inicio: "2025-12", fim: "2025-12" })
    })

    it("valida o período e calcula o anterior de mesmo tamanho", () => {
        expect(lerPeriodo("2026-09", "2026-11")).toEqual({ ok: true, inicio: "2026-09", fim: "2026-11", meses: ["2026-09", "2026-10", "2026-11"] })
        expect(lerPeriodo("2026-11", "2026-09").ok).toBe(false)
        expect(lerPeriodo("2026-9", "2026-09").ok).toBe(false)
        expect(lerPeriodo("2024-01", "2026-01").ok).toBe(false) // 25 meses
        expect(periodoAnterior("2026-09", "2026-09")).toEqual({ inicio: "2026-08", fim: "2026-08" })
        expect(periodoAnterior("2026-01", "2026-03")).toEqual({ inicio: "2025-10", fim: "2025-12" })
        expect(rotuloPeriodo("2026-09", "2026-11")).toBe("SET/26 a NOV/26")
    })
})

describe("escopo de unidade (AC13)", () => {
    it("normaliza nome (sem diferenciar maiúsculas) ou UUID; \"Geral\" não é unidade", () => {
        expect(normalizarUnidade("Cuca Pici", UNIDADES)?.id).toBe(PICI)
        expect(normalizarUnidade(PICI, UNIDADES)?.id).toBe(PICI)
        expect(normalizarUnidade("Geral", UNIDADES)).toBeNull()
        expect(normalizarUnidade(null, UNIDADES)).toBeNull()
    })

    it("com a rede: todas, uma unidade ou a rede global; unidade estranha é recusada", () => {
        expect(resolverEscopo({ temRede: true, unidadePedida: "todas", unidadeDoColaborador: null, unidades: UNIDADES }))
            .toEqual({ ok: true, rede: true, chaves: [BARRA, PICI, "rede"], selecionada: "todas" })
        expect(resolverEscopo({ temRede: true, unidadePedida: "rede", unidadeDoColaborador: null, unidades: UNIDADES }))
            .toEqual({ ok: true, rede: true, chaves: ["rede"], selecionada: "rede" })
        expect(resolverEscopo({ temRede: true, unidadePedida: "xyz", unidadeDoColaborador: null, unidades: UNIDADES }).ok).toBe(false)
    })

    it("sem a rede: sempre a unidade do colaborador, mesmo pedindo outra", () => {
        expect(resolverEscopo({ temRede: false, unidadePedida: BARRA, unidadeDoColaborador: "Cuca Pici", unidades: UNIDADES }))
            .toEqual({ ok: true, rede: false, chaves: [PICI], selecionada: PICI })
        expect(resolverEscopo({ temRede: false, unidadePedida: "todas", unidadeDoColaborador: "Geral", unidades: UNIDADES }).ok).toBe(false)
    })
})

const LINHAS: LinhaRpc[] = [
    { mes: "2026-09", unidade: PICI, indicador: "encaminhamentos", valor: 10 },
    { mes: "2026-10", unidade: PICI, indicador: "encaminhamentos", valor: "5" },
    { mes: "2026-09", unidade: BARRA, indicador: "encaminhamentos", valor: 7 },
    { mes: "2026-09", unidade: PICI, indicador: "vagas_normais", valor: 3 },
    { mes: "2026-09", unidade: PICI, indicador: "selecoes", valor: 1 },
    { mes: "2026-09", unidade: PICI, indicador: "postos", valor: 150 },
    { mes: "2026-09", unidade: "rede", indicador: "vagas_normais", valor: 2 },
    { mes: "2026-09", unidade: "sem_unidade", indicador: "curriculos", valor: 64 },
    { mes: "2026-09", unidade: "sem_unidade", indicador: "empresas", valor: 25 },
]

describe("agregação", () => {
    it("só as chaves do escopo; currículos/empresas só com a rede e \"todas\"", () => {
        const todas = agruparLinhas(LINHAS, { rede: true, chaves: [BARRA, PICI, "rede"], selecionada: "todas" })
        expect(todas.sem_unidade?.curriculos?.["2026-09"]).toBe(64)
        expect(todas[PICI]?.encaminhamentos).toEqual({ "2026-09": 10, "2026-10": 5 })
        const soPici = agruparLinhas(LINHAS, { rede: false, chaves: [PICI], selecionada: PICI })
        expect(Object.keys(soPici)).toEqual([PICI])
    })

    it("cartões: totais e variação sobre o período anterior", () => {
        const escopo = { rede: true, chaves: [BARRA, PICI, "rede"], selecionada: "todas" }
        const serie = agruparLinhas(LINHAS, escopo)
        const anterior = agruparLinhas([{ mes: "2026-08", unidade: PICI, indicador: "encaminhamentos", valor: 34 }], escopo)
        const cartoes = montarCartoes({ serie, anterior, chaves: escopo.chaves, meses: ["2026-09"], mesesAnteriores: ["2026-08"], rede: true })
        const enc = cartoes.find(c => c.titulo === "Encaminhamentos")
        expect(enc).toMatchObject({ total: 17, anterior: 34, variacao: -0.5 })
        expect(cartoes.find(c => c.titulo === "Vagas cadastradas")).toMatchObject({ total: 6, variacao: null })
        expect(cartoes.find(c => c.titulo === "Currículos criados")?.total).toBe(64)
    })
})

function ctx(): ContextoPlanilha {
    const escopo = { rede: true, chaves: [BARRA, PICI, "rede"], selecionada: "todas" }
    return {
        inicio: "2026-09", fim: "2026-10", meses: ["2026-09", "2026-10"], mesesAnteriores: ["2026-07", "2026-08"],
        serie: agruparLinhas(LINHAS, escopo),
        anterior: agruparLinhas([{ mes: "2026-08", unidade: PICI, indicador: "encaminhamentos", valor: 30 }], escopo),
        geradoEm: new Date("2026-10-14T15:30:00Z"), geradoPor: "Ana",
    }
}

describe("planilha (AC5, AC6, AC12)", () => {
    it("letras de coluna", () => {
        expect(letraColuna(1)).toBe("A")
        expect(letraColuna(26)).toBe("Z")
        expect(letraColuna(27)).toBe("AA")
    })

    it("consolidado: valores por mês, Total = SUM, Variação = fórmula, destaque referencia os totais", () => {
        const aba = montarAbaIndicadores({ nome: "Consolidado", cor: "1F4E79", tituloUnidade: "REDE CUCA", chaves: [BARRA, PICI, "rede"], comIndicadoresDaRede: true, ctx: ctx() })
        expect(aba.linhas[0].celulas[0].valor).toBe("RELATÓRIO EMPREGA+ — SET/26 a OUT/26 — REDE CUCA")
        expect(aba.linhas[1].celulas[0].valor).toBe("Gerado em 14/10/2026 12:30 por Ana")
        // Cabeçalho na linha 7: Indicador | SET/26 | OUT/26 | Total (D) | Período anterior (E) | Variação % (F)
        expect(aba.congelarLinhas).toBe(7)
        expect(aba.linhas[6].celulas.map(c => c.valor)).toEqual(["Indicador", "SET/26", "OUT/26", "Total", "Período anterior (JUL/26 a AGO/26)", "Variação %"])
        // Encaminhamentos na linha 9.
        const enc = aba.linhas[8].celulas
        expect(enc[0].valor).toBe("Encaminhamentos")
        expect([enc[1].valor, enc[2].valor]).toEqual([17, 5])
        expect(enc[3]).toMatchObject({ formula: "SUM(B9:C9)", resultado: 22 })
        expect(enc[4].valor).toBe(30)
        expect(enc[5].formula).toBe('IF(E9=0,"",(D9-E9)/E9)')
        expect(enc[5].resultado).toBeCloseTo(-8 / 30)
        // Sem base de comparação, a variação calculada é vazia, como a fórmula.
        expect(aba.linhas[7].celulas[5].resultado).toBe("")
        // Vagas cadastradas (linha 11) = vagas normais (12) + seleções (13), por fórmula.
        expect(aba.linhas[10].celulas[1]).toMatchObject({ formula: "B12+B13", resultado: 6 })
        expect(aba.linhas[11].celulas[1].valor).toBe(5) // 3 Pici + 2 rede
        // Destaque (linha 5) aponta para a coluna Total.
        expect(aba.linhas[4].celulas.map(c => c.formula)).toEqual(["D8", "D9", "D10", "D11", "D14"])
        expect(aba.linhas[4].celulas.map(c => c.resultado)).toEqual([64, 22, 25, 6, 150])
        expect(aba.linhas.some(l => l.tipo === "nota")).toBe(true)
    })

    it("aba de unidade: currículos e empresas como indicador da rede, sem valor", () => {
        const aba = montarAbaIndicadores({ nome: "Pici", cor: "0070C0", tituloUnidade: "CUCA PICI", chaves: [PICI], comIndicadoresDaRede: false, ctx: ctx() })
        expect(aba.linhas[7].celulas.map(c => c.valor)).toEqual(["Currículos criados", "— (indicador da rede, sem unidade)"])
        expect(aba.linhas[8].celulas[1].valor).toBe(10)
        expect(aba.linhas[4].celulas.map(c => c.formula)).toEqual(["D9", "D11", "D14"])
    })

    it("todas as abas com a rede: consolidado, uma por unidade, rede, matriz e detalhe", () => {
        const abas = montarPlanilha({ escopo: { rede: true, chaves: [BARRA, PICI, "rede"], selecionada: "todas" }, unidades: UNIDADES, vagas: [], ctx: ctx() })
        expect(abas.map(a => a.nome)).toEqual(["Consolidado", "Barra", "Pici", "Rede (global)", "Unidade x Mês", "Detalhe"])
        const so = montarPlanilha({ escopo: { rede: false, chaves: [PICI], selecionada: PICI }, unidades: UNIDADES, vagas: [], ctx: ctx() })
        expect(so.map(a => a.nome)).toEqual(["Pici", "Detalhe"])
    })

    it("detalhe: origem da unidade, destaque acima de 100 postos e totais por fórmula", () => {
        const aba = montarAbaDetalhe({
            unidades: UNIDADES, ctx: ctx(),
            vagas: [
                { numero_vaga: 12, titulo: "Repositor", empresa: "Mercado", tipo: "vaga_normal", unidade: PICI, origem: "destino", postos: 150, encaminhados: 8, criada_em: "2026-09-03T12:00:00Z" },
                { numero_vaga: 13, titulo: "Seleção", empresa: "Loja", tipo: "selecao_evento", unidade: "rede", origem: "rede", postos: 20, encaminhados: 0, criada_em: "2026-09-04T12:00:00Z" },
            ],
        })
        expect(aba.linhas[3].tipo).toBe("alerta")
        expect(aba.linhas[3].celulas.map(c => c.valor).slice(3, 6)).toEqual(["Vaga", "Pici", "Unidade de destino"])
        expect(aba.linhas[4].celulas.map(c => c.valor).slice(3, 6)).toEqual(["Seleção", "Rede Cuca (todas as unidades)", "Rede Cuca"])
        expect(aba.linhas[5].celulas[6]).toMatchObject({ formula: "SUM(G4:G5)", resultado: 170 })
    })

    it("nome do arquivo", () => {
        expect(nomeArquivoRelatorio("2026-09", "2026-09", "todas", UNIDADES)).toBe("relatorio-emprega-mais_2026-09_a_2026-09_todas.xlsx")
        expect(nomeArquivoRelatorio("2026-07", "2026-09", PICI, UNIDADES)).toBe("relatorio-emprega-mais_2026-07_a_2026-09_pici.xlsx")
        expect(nomeArquivoRelatorio("2026-07", "2026-09", "rede", UNIDADES)).toBe("relatorio-emprega-mais_2026-07_a_2026-09_rede.xlsx")
    })
})
