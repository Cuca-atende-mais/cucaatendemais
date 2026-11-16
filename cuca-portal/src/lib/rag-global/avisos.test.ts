import { describe, expect, it } from "vitest"
import {
    conferirTotal, dataValida, estadoAviso, hojeFortaleza, lerDadosAviso, LIMITE_TEXTO_AVISO,
    LIMITE_TOTAL_AVISOS, metadadosDoAviso, totalNoPeriodo, voltaAValerAoSalvar, type Aviso, type DadosAviso,
} from "./avisos"

const HOJE = "2026-11-16"
const aviso = (metadados: Record<string, unknown>, extra: Partial<Aviso> = {}): Aviso =>
    ({ id: "a1", titulo: "Recesso", conteudo: "Fechado", metadados, ativo: true, created_at: "2026-11-01T00:00:00Z", ...extra })
const dados = (extra: Partial<DadosAviso> = {}): DadosAviso =>
    ({ titulo: "Novo", conteudo: "x", valido_de: HOJE, valido_ate: "2026-11-30", categoria: "geral", ...extra })

describe("hoje em Fortaleza", () => {
    it("22h em Fortaleza ainda é o mesmo dia, com o UTC no dia seguinte", () => {
        expect(hojeFortaleza(new Date("2026-11-17T01:00:00Z"))).toBe("2026-11-16")
        expect(hojeFortaleza(new Date("2026-11-17T03:00:00Z"))).toBe("2026-11-17")
    })

    it("data válida só para dia que existe", () => {
        expect(dataValida("2026-11-30")).toBe(true)
        for (const v of ["2026-02-31", "30/11/2026", "2026-11-3", "", null, 20261130]) expect(dataValida(v)).toBe(false)
    })
})

describe("AC1: o formulário não salva aviso sem fim, com fim antes do início ou grande demais", () => {
    it("aceita o aviso completo; início vazio vira hoje; categoria padrão geral", () => {
        expect(lerDadosAviso({ titulo: " Recesso ", conteudo: " Fechado ", valido_ate: "2026-12-31" }, HOJE))
            .toEqual({ dados: { titulo: "Recesso", conteudo: "Fechado", valido_de: HOJE, valido_ate: "2026-12-31", categoria: "geral" } })
        expect(lerDadosAviso({ titulo: "a", conteudo: "b", valido_de: "2026-12-01", valido_ate: "2026-12-31", categoria: "matricula" }, HOJE))
            .toHaveProperty("dados.categoria", "matricula")
    })

    it("sem data de fim, fim inválido, fim antes do início ou fim já passado: erro", () => {
        expect(lerDadosAviso({ titulo: "a", conteudo: "b" }, HOJE)).toEqual({ erro: "Data de fim obrigatória" })
        expect(lerDadosAviso({ titulo: "a", conteudo: "b", valido_ate: "31/12/2026" }, HOJE)).toEqual({ erro: "Data de fim inválida" })
        expect(lerDadosAviso({ titulo: "a", conteudo: "b", valido_de: "2026-12-10", valido_ate: "2026-12-01" }, HOJE))
            .toEqual({ erro: "A data de fim não pode ser antes da data de início" })
        expect(lerDadosAviso({ titulo: "a", conteudo: "b", valido_de: "2026-11-01", valido_ate: "2026-11-15" }, HOJE)).toEqual({ erro: "A data de fim já passou" })
        expect(lerDadosAviso({ titulo: "a", conteudo: "b", valido_de: "x", valido_ate: "2026-12-01" }, HOJE)).toEqual({ erro: "Data de início inválida" })
    })

    it("texto acima de 500 caracteres, título ou texto vazios e categoria desconhecida: erro", () => {
        expect(lerDadosAviso({ titulo: "a", conteudo: "x".repeat(LIMITE_TEXTO_AVISO), valido_ate: "2026-12-01" }, HOJE)).toHaveProperty("dados")
        expect(lerDadosAviso({ titulo: "a", conteudo: "x".repeat(LIMITE_TEXTO_AVISO + 1), valido_ate: "2026-12-01" }, HOJE)).toHaveProperty("erro")
        expect(lerDadosAviso({ titulo: "a".repeat(101), conteudo: "b", valido_ate: "2026-12-01" }, HOJE)).toHaveProperty("erro")
        expect(lerDadosAviso({ conteudo: "b", valido_ate: "2026-12-01" }, HOJE)).toEqual({ erro: "Título obrigatório" })
        expect(lerDadosAviso({ titulo: "a", conteudo: "  ", valido_ate: "2026-12-01" }, HOJE)).toEqual({ erro: "Texto do aviso obrigatório" })
        expect(lerDadosAviso({ titulo: "a", conteudo: "b", valido_ate: "2026-12-01", categoria: "outra" }, HOJE)).toEqual({ erro: "Categoria inválida" })
    })
})

describe("AC1: limite de 3 mil caracteres no total dos avisos que valem juntos", () => {
    const grande = (id: string, de: string, ate: string, n: number) =>
        aviso({ valido_de: de, valido_ate: ate, categoria: "geral" }, { id, titulo: "", conteudo: "x".repeat(n) })

    it("soma só os gerais, ativos, não vencidos e que cruzam o período; o editado não conta duas vezes", () => {
        const outros = [
            grande("cruza", "2026-11-20", "2026-12-05", 1000),
            grande("nao-cruza", "2026-12-10", "2026-12-20", 1000),
            grande("vencido", "2026-11-01", "2026-11-15", 1000),
            { ...grande("inativo", "2026-11-16", "2026-11-30", 1000), ativo: false },
            aviso({ valido_ate: "2026-11-30", categoria: "matricula" }, { id: "matricula", titulo: "", conteudo: "x".repeat(1000) }),
        ]
        const novo = dados({ titulo: "", conteudo: "x".repeat(100) })
        expect(totalNoPeriodo(outros, novo, HOJE)).toBe(1100)
        expect(totalNoPeriodo(outros, novo, HOJE, "cruza")).toBe(100)
        expect(totalNoPeriodo(outros, { ...novo, categoria: "matricula" }, HOJE)).toBe(0)
    })

    it("passa do limite: mensagem; no limite: cabe", () => {
        const outros = [grande("b", "2026-11-16", "2026-11-30", LIMITE_TOTAL_AVISOS - 100)]
        expect(conferirTotal(outros, dados({ titulo: "", conteudo: "x".repeat(100) }), HOJE)).toBeNull()
        expect(conferirTotal(outros, dados({ titulo: "", conteudo: "x".repeat(101) }), HOJE)).toMatch(/limite é 3000/)
    })
})

describe("estado na tela", () => {
    it("programado, válido, vencido (mesmo ainda ativo) e desativado", () => {
        expect(estadoAviso(aviso({ valido_de: "2026-11-17", valido_ate: "2026-11-30" }), HOJE)).toBe("programado")
        expect(estadoAviso(aviso({ valido_de: "2026-11-16", valido_ate: "2026-11-16" }), HOJE)).toBe("valido")
        expect(estadoAviso(aviso({ valido_ate: "2026-11-15" }), HOJE)).toBe("vencido")
        expect(estadoAviso(aviso({ valido_ate: "2026-11-30" }, { ativo: false }), HOJE)).toBe("desativado")
        expect(estadoAviso(aviso({}), HOJE)).toBe("vencido")
    })

    it("vencido e desativado voltam a valer ao salvar; válido e programado só mudam", () => {
        expect(voltaAValerAoSalvar(aviso({ valido_ate: "2026-11-30" }), HOJE)).toBe(false)
        expect(voltaAValerAoSalvar(aviso({ valido_de: "2026-11-20", valido_ate: "2026-11-30" }), HOJE)).toBe(false)
        expect(voltaAValerAoSalvar(aviso({ valido_ate: "2026-11-15" }), HOJE)).toBe(true)
        expect(voltaAValerAoSalvar(aviso({ valido_ate: "2026-11-30" }, { ativo: false }), HOJE)).toBe(true)
    })

    it("editar um vencido mantendo o fim antigo é recusado; com fim novo, passa", () => {
        const vencido = { titulo: "Recesso", conteudo: "Fechado", valido_de: "2026-11-01", valido_ate: "2026-11-15" }
        expect(lerDadosAviso(vencido, HOJE)).toEqual({ erro: "A data de fim já passou" })
        expect(lerDadosAviso({ ...vencido, valido_ate: "2026-11-20" }, HOJE)).toHaveProperty("dados.valido_ate", "2026-11-20")
    })

    it("metadados guardam origem, período e categoria, mantendo o que já existia", () => {
        expect(metadadosDoAviso(dados(), { criado_por: "u1" })).toEqual({
            criado_por: "u1", source_type: "rede_cuca_global", valido_de: HOJE, valido_ate: "2026-11-30", categoria: "geral",
        })
    })
})
