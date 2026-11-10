import { describe, expect, it } from "vitest"
import {
    MAX_IDS_CONTADORES,
    montarMapaContadores,
    textoContadores,
    validarIdsContadores,
} from "./contadores-selecoes"

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`

describe("validarIdsContadores", () => {
    it("aceita lista de UUIDs e tira repetidos", () => {
        expect(validarIdsContadores({ ids: [ID(1), ID(2), ID(1)] })).toEqual({ ok: true, ids: [ID(1), ID(2)] })
        expect(validarIdsContadores({ ids: [] })).toEqual({ ok: true, ids: [] })
    })

    it("recusa corpo sem lista, id inválido e mais de 100 talentos", () => {
        expect(validarIdsContadores(null).ok).toBe(false)
        expect(validarIdsContadores({ ids: "x" }).ok).toBe(false)
        expect(validarIdsContadores({ ids: [ID(1), "1; drop table"] }).ok).toBe(false)
        const muitos = Array.from({ length: MAX_IDS_CONTADORES + 1 }, (_, i) => ID(i))
        expect(validarIdsContadores({ ids: muitos }).ok).toBe(false)
        expect(validarIdsContadores({ ids: muitos.slice(0, MAX_IDS_CONTADORES) }).ok).toBe(true)
    })
})

describe("montarMapaContadores", () => {
    it("devolve só os dois números por talento, com nulo virando zero", () => {
        expect(montarMapaContadores([
            { talent_id: ID(1), selecoes_ativas: 2, selecoes_participou: 5 },
            { talent_id: ID(2), selecoes_ativas: null, selecoes_participou: null },
        ])).toEqual({ [ID(1)]: { ativas: 2, participou: 5 }, [ID(2)]: { ativas: 0, participou: 0 } })
        expect(montarMapaContadores(null)).toEqual({})
    })
})

describe("textoContadores", () => {
    it("escreve por extenso, com singular e plural", () => {
        expect(textoContadores({ ativas: 2, participou: 5 })).toBe("Em 2 seleções ativas · Participou de 5")
        expect(textoContadores({ ativas: 1, participou: 0 })).toBe("Em 1 seleção ativa · Participou de 0")
        expect(textoContadores({ ativas: 0, participou: 1 })).toBe("Em 0 seleções ativas · Participou de 1")
    })

    it("sem dado mostra —", () => {
        expect(textoContadores(undefined)).toBe("—")
        expect(textoContadores(null)).toBe("—")
    })
})

describe("rotuloStatusTalento", () => {
    it("mostra os dois status por extenso e não esconde valor antigo", async () => {
        const { rotuloStatusTalento } = await import("./contadores-selecoes")
        expect(rotuloStatusTalento("disponivel")).toBe("Disponível")
        expect(rotuloStatusTalento("contratado")).toBe("Contratado")
        expect(rotuloStatusTalento("selecionado")).toBe("selecionado")
        expect(rotuloStatusTalento(null)).toBe("—")
    })
})

describe("talentosAprovadosNaVaga (selo Aprovado, AC3)", () => {
    it("pega só as candidaturas marcadas com o id do talento", async () => {
        const { talentosAprovadosNaVaga } = await import("./contadores-selecoes")
        const ids = talentosAprovadosNaVaga([
            { observacoes: `banco_talentos:${ID(1)}` },
            { observacoes: "banco_talentos: cadastro via WhatsApp" },
            { observacoes: "Incluído manualmente (outro canal)" },
            { observacoes: null },
            {},
        ])
        expect([...ids]).toEqual([ID(1)])
    })
})
