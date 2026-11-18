import { describe, expect, it } from "vitest"
import { alturaTexto, cortarPorAltura, larguraTexto, quebrarLinhas, type Fonte } from "./medida"

// S-PLA-09: medida do texto (linhas e altura) usada para decidir o que cabe em cada slide.

const F: Fonte = { tamanho: 10, altura: 1.5 }
const linhasDe = (t: string, largura: number) => quebrarLinhas(t, largura, F).map(l => t.slice(l.inicio, l.fim).trim())

describe("largura", () => {
    it("maiúscula é mais larga que minúscula; negrito mais largo que normal; acento conta como a letra", () => {
        expect(larguraTexto("MMMM", 10)).toBeGreaterThan(larguraTexto("iiii", 10))
        expect(larguraTexto("abc", 10, true)).toBeGreaterThan(larguraTexto("abc", 10))
        expect(larguraTexto("ção", 10)).toBeCloseTo(larguraTexto("cao", 10))
        expect(larguraTexto("abc", 20)).toBeCloseTo(2 * larguraTexto("abc", 10))
    })
})

describe("quebra de linhas", () => {
    it("quebra por palavra, sem perder nem trocar texto", () => {
        const t = "um dois tres quatro cinco seis sete oito nove dez"
        const linhas = linhasDe(t, larguraTexto("um dois tres", 10) + 1)
        expect(linhas.length).toBeGreaterThan(2)
        expect(linhas.join(" ")).toBe(t)
        for (const l of linhas) expect(larguraTexto(l, 10)).toBeLessThanOrEqual(larguraTexto("um dois tres", 10) + 1)
    })
    it("cada \\n começa linha nova, e linha em branco conta", () => {
        expect(linhasDe("a\n\nb", 500)).toEqual(["a", "", "b"])
        expect(alturaTexto("a\n\nb", 500, F)).toBeCloseTo(3 * 10 * 1.5)
    })
    it("palavra maior que a linha é partida", () => {
        const linhas = linhasDe("x".repeat(100), larguraTexto("x".repeat(30), 10))
        expect(linhas.length).toBeGreaterThanOrEqual(4)
        expect(linhas.join("")).toBe("x".repeat(100))
    })
    it("texto vazio não ocupa altura", () => {
        expect(alturaTexto("", 100, F)).toBe(0)
    })
})

describe("corte por altura", () => {
    const linha = F.tamanho * F.altura
    it("cabe inteiro: não corta", () => {
        expect(cortarPorAltura("curto", 500, F, linha)).toEqual(["curto", ""])
    })
    it("prefere o fim do parágrafo; nada se perde", () => {
        const p1 = "Primeiro parágrafo com algumas palavras para ocupar a linha toda."
        const p2 = "Segundo parágrafo começa aqui e continua bastante, com muitas palavras a mais para passar do limite."
        const t = `${p1}\n${p2}`
        const largura = larguraTexto(p1, 10) + 2
        const [parte, resto] = cortarPorAltura(t, largura, F, 2 * linha)
        expect(parte).toBe(p1)
        expect(resto).toBe(p2)
    })
    it("sem parágrafo, prefere o fim da frase", () => {
        const t = "Uma frase bem curta. Frase dois bem maior que continua por várias palavras até passar da altura disponível no slide."
        const [parte, resto] = cortarPorAltura(t, larguraTexto("Uma frase bem curta. Frase dois", 10), F, linha)
        expect(parte).toBe("Uma frase bem curta.")
        expect(`${parte} ${resto}`).toBe(t)
    })
    it("nunca deixa menos de 4 palavras no slide de origem: vai tudo para a continuação", () => {
        const t = "Promover a maior virada cultural esportiva e de cidadania da cidade de Fortaleza com programação gratuita"
        expect(cortarPorAltura(t, larguraTexto("Promover a", 10), F, linha)).toEqual(["", t])
    })
    it("altura menor que uma linha: nada fica", () => {
        expect(cortarPorAltura("um texto qualquer", 500, F, linha - 1)).toEqual(["", "um texto qualquer"])
    })
})
