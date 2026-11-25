import { describe, expect, it } from "vitest"
import { apagarLarguras, deveGravarLarguras, lerLarguras, salvarLarguras, sanearLarguras } from "./larguras-colunas"

function armazenamentoFalso(inicial: Record<string, string> = {}) {
    const dados = new Map(Object.entries(inicial))
    return {
        dados,
        getItem: (k: string) => dados.get(k) ?? null,
        setItem: (k: string, v: string) => { dados.set(k, v) },
        removeItem: (k: string) => { dados.delete(k) },
    }
}

const LIMITES = {
    id: { minimo: 60, maximo: 160 },
    cargo: { minimo: 120, maximo: 600 },
}
const CHAVE = "cuca:grade:teste:v1"

describe("larguras das colunas (S-EMP-GES-13, AC18)", () => {
    it("grava e lê de volta", () => {
        const a = armazenamentoFalso()
        salvarLarguras(CHAVE, { id: 90, cargo: 300 }, a)
        expect(lerLarguras(CHAVE, LIMITES, a)).toEqual({ id: 90, cargo: 300 })
    })

    it("sem nada gravado devolve vazio (tamanho padrão)", () => {
        expect(lerLarguras(CHAVE, LIMITES, armazenamentoFalso())).toEqual({})
    })

    it("JSON quebrado volta ao padrão", () => {
        expect(lerLarguras(CHAVE, LIMITES, armazenamentoFalso({ [CHAVE]: "{nao é json" }))).toEqual({})
    })

    it("versão diferente volta ao padrão", () => {
        const a = armazenamentoFalso({ [CHAVE]: JSON.stringify({ v: 99, larguras: { id: 90 } }) })
        expect(lerLarguras(CHAVE, LIMITES, a)).toEqual({})
    })

    it("descarta coluna desconhecida, texto e número inválido; limita aos extremos", () => {
        expect(sanearLarguras({ id: 10, cargo: 9999, sumiu: 100, empresa: "200" }, LIMITES)).toEqual({ id: 60, cargo: 600 })
        expect(sanearLarguras({ id: Number.NaN, cargo: Infinity }, LIMITES)).toEqual({})
        expect(sanearLarguras([1, 2], LIMITES)).toEqual({})
        expect(sanearLarguras(null, LIMITES)).toEqual({})
    })

    it("arredonda para pixels inteiros", () => {
        expect(sanearLarguras({ cargo: 200.6 }, LIMITES)).toEqual({ cargo: 201 })
    })

    it("salvar vazio e apagar removem a chave", () => {
        const a = armazenamentoFalso()
        salvarLarguras(CHAVE, { id: 90 }, a)
        salvarLarguras(CHAVE, {}, a)
        expect(a.dados.has(CHAVE)).toBe(false)
        salvarLarguras(CHAVE, { id: 90 }, a)
        apagarLarguras(CHAVE, a)
        expect(a.dados.has(CHAVE)).toBe(false)
    })

    it("armazenamento que lança erro não derruba a tela", () => {
        const quebrado = {
            getItem: () => { throw new Error("bloqueado") },
            setItem: () => { throw new Error("cota") },
            removeItem: () => { throw new Error("bloqueado") },
        }
        expect(lerLarguras(CHAVE, LIMITES, quebrado)).toEqual({})
        expect(() => salvarLarguras(CHAVE, { id: 90 }, quebrado)).not.toThrow()
        expect(() => apagarLarguras(CHAVE, quebrado)).not.toThrow()
    })

    it("sem armazenamento (servidor) não faz nada", () => {
        expect(lerLarguras(CHAVE, LIMITES, null)).toEqual({})
        expect(() => salvarLarguras(CHAVE, { id: 90 }, null)).not.toThrow()
    })

    describe("quando gravar (correção O1 do QA)", () => {
        it("não grava na montagem nem no meio do arraste; grava quando o usuário termina a mudança", () => {
            expect(deveGravarLarguras({ alteradoPeloUsuario: false, redimensionando: false })).toBe(false)
            expect(deveGravarLarguras({ alteradoPeloUsuario: true, redimensionando: true })).toBe(false)
            expect(deveGravarLarguras({ alteradoPeloUsuario: true, redimensionando: false })).toBe(true)
        })

        it("montagem dupla (StrictMode) não apaga a largura salva", () => {
            const a = armazenamentoFalso({ [CHAVE]: JSON.stringify({ v: 1, larguras: { id: 90 } }) })
            // 1ª montagem: lê; o efeito de gravação roda com o estado ainda vazio e sem mudança do usuário.
            expect(lerLarguras(CHAVE, LIMITES, a)).toEqual({ id: 90 })
            if (deveGravarLarguras({ alteradoPeloUsuario: false, redimensionando: false })) salvarLarguras(CHAVE, {}, a)
            // 2ª montagem: a chave continua lá.
            expect(lerLarguras(CHAVE, LIMITES, a)).toEqual({ id: 90 })
        })
    })
})
