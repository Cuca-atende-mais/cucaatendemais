import { describe, expect, it } from "vitest"
import { corpoSetoresPlanejamento, decidirVinculoSetores } from "./vinculo-setores"

const VALIDOS = ["direitos_humanos", "empregabilidade", "cultura", "artes_biblioteca", "educacao_tecnologia", "esportes"]

describe("decidirVinculoSetores (S-PLA-01, AC3)", () => {
    it("campo ausente: mantém o vínculo atual", () => {
        expect(decidirVinculoSetores(undefined, VALIDOS)).toEqual({ tipo: "manter" })
    })

    it("substitui pelo conjunto recebido, sem repetição", () => {
        expect(decidirVinculoSetores(["cultura", "esportes", "cultura"], VALIDOS))
            .toEqual({ tipo: "substituir", setores: ["cultura", "esportes"] })
    })

    it("lista vazia remove todos os setores (colaborador passa a atuar em todos)", () => {
        expect(decidirVinculoSetores([], VALIDOS)).toEqual({ tipo: "substituir", setores: [] })
    })

    it("formato inválido ou setor desconhecido: 400", () => {
        for (const campo of [null, "cultura", [1], [{}]]) {
            expect(decidirVinculoSetores(campo, VALIDOS)).toMatchObject({ tipo: "erro", status: 400 })
        }
        expect(decidirVinculoSetores(["DPDH"], VALIDOS)).toMatchObject({ tipo: "erro", status: 400 })
    })
})

describe("corpoSetoresPlanejamento (S-PLA-01, observação A do QA)", () => {
    it("sem a lista de setores carregada: não envia o campo (não troca o vínculo)", () => {
        expect(corpoSetoresPlanejamento(0, [])).toEqual({})
        expect(corpoSetoresPlanejamento(0, ["cultura"])).toEqual({})
    })

    it("com a lista carregada: envia o conjunto marcado, inclusive vazio", () => {
        expect(corpoSetoresPlanejamento(6, ["cultura"])).toEqual({ setores_planejamento: ["cultura"] })
        expect(corpoSetoresPlanejamento(6, [])).toEqual({ setores_planejamento: [] })
    })
})
