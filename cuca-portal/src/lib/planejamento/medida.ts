// S-PLA-09: medida do texto nos slides, sem React e sem navegador. Estima quantas linhas um texto
// ocupa numa largura, com a largura real de cada letra da Helvetica (a fonte do PDF), e corta um texto
// para caber numa altura. É o que garante que nada estoure o slide: os limites antigos, em número de
// caracteres, não viam as quebras de linha (texto com muitas linhas curtas cabia na conta e estourava).
//
// A tela usa a fonte do portal, um pouco mais larga. Por isso toda largura é multiplicada por
// `FATOR_SEGURANCA`: a mesma conta vale para a tela e para o PDF, e os dois têm os mesmos slides.

// Largura de cada caractere em milésimos do tamanho da fonte (métricas AFM da Helvetica).
const NORMAL: Record<string, number> = {
    " ": 278, "!": 278, '"': 355, "#": 556, $: 556, "%": 889, "&": 667, "'": 191, "(": 333, ")": 333, "*": 389, "+": 584,
    ",": 278, "-": 333, ".": 278, "/": 278, ":": 278, ";": 278, "<": 584, "=": 584, ">": 584, "?": 556, "@": 1015,
    "[": 278, "\\": 278, "]": 278, "^": 469, _: 556, "`": 333, "{": 334, "|": 260, "}": 334, "~": 584,
    A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833, N: 722, O: 778,
    P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
    a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833, n: 556, o: 556,
    p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
    "•": 350, "–": 556, "—": 1000, "…": 1000, "ª": 370, "º": 365, "°": 400, "·": 278, "“": 333, "”": 333, "‘": 222, "’": 222,
}
const NEGRITO: Record<string, number> = {
    ...NORMAL,
    "!": 333, '"': 474, "'": 238, "(": 333, ")": 333, ":": 333, ";": 333, "?": 611,
    A: 722, B: 722, J: 556, K: 722, L: 611,
    a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278, k: 556, l: 278, m: 889, n: 611, o: 611,
    p: 611, q: 611, r: 389, s: 556, t: 333, u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
}
for (let d = 0; d <= 9; d++) { NORMAL[String(d)] = 556; NEGRITO[String(d)] = 556 }

// Folga para a fonte do portal (tela), mais larga que a Helvetica, e para o arredondamento da quebra.
export const FATOR_SEGURANCA = 1.1

const larguraChar = (c: string, negrito: boolean): number => {
    const tabela = negrito ? NEGRITO : NORMAL
    if (c in tabela) return tabela[c]
    const base = c.normalize("NFD").replace(/[̀-ͯ]/g, "")
    if (base && base !== c && base[0] in tabela) return tabela[base[0]]
    return /\p{Lu}/u.test(c) ? 778 : 611
}

// Largura, em pontos, de um texto sem quebra.
export function larguraTexto(texto: string, tamanho: number, negrito = false): number {
    let soma = 0
    for (const c of texto) soma += larguraChar(c, negrito)
    return (soma / 1000) * tamanho * FATOR_SEGURANCA
}

export type Fonte = { tamanho: number; altura: number; negrito?: boolean }
export type Linha = { inicio: number; fim: number }

// Quebra o texto em linhas como o navegador e o react-pdf fazem: palavra inteira enquanto couber;
// palavra maior que a linha é partida. Cada "\n" começa linha nova (linha em branco conta).
// Devolve o início e o fim de cada linha no texto original.
export function quebrarLinhas(texto: string, largura: number, fonte: Fonte): Linha[] {
    const linhas: Linha[] = []
    let pos = 0
    for (const paragrafo of texto.split("\n")) {
        const fimPar = pos + paragrafo.length
        if (paragrafo.trim() === "") {
            linhas.push({ inicio: pos, fim: fimPar })
        } else {
            let inicio = pos
            let usado = 0
            const tokens = paragrafo.match(/\S+\s*/g) ?? []
            let i = pos + (paragrafo.length - paragrafo.trimStart().length)
            inicio = i
            for (const token of tokens) {
                const palavra = token.trimEnd()
                const wPalavra = larguraTexto(palavra, fonte.tamanho, fonte.negrito)
                const wToken = larguraTexto(token, fonte.tamanho, fonte.negrito)
                if (usado > 0 && usado + wPalavra > largura) {
                    linhas.push({ inicio, fim: i })
                    inicio = i
                    usado = 0
                }
                if (wPalavra > largura) {
                    // Palavra maior que a linha: parte por caractere.
                    let j = 0
                    for (const c of palavra) {
                        const w = larguraTexto(c, fonte.tamanho, fonte.negrito)
                        if (usado > 0 && usado + w > largura) {
                            linhas.push({ inicio, fim: i + j })
                            inicio = i + j
                            usado = 0
                        }
                        usado += w
                        j += c.length
                    }
                    usado += wToken - wPalavra
                } else {
                    usado += wToken
                }
                i += token.length
            }
            linhas.push({ inicio, fim: fimPar })
        }
        pos = fimPar + 1
    }
    return linhas
}

export function alturaTexto(texto: string, largura: number, fonte: Fonte): number {
    if (!texto) return 0
    return quebrarLinhas(texto, largura, fonte).length * fonte.tamanho * fonte.altura
}

// Menos que isto no slide de origem não vale a pena: o texto vai inteiro para a continuação
// (evita o "Promover…" sozinho num slide e o resto no outro).
const PALAVRAS_MINIMAS = 4

// Corta o texto para caber na altura. A preferência do ponto de corte é: fim de parágrafo, fim de
// frase, fim de palavra (fim de linha), desde que o pedaço que fica mantenha pelo menos metade do que
// caberia. Devolve [o que fica, o que vai para a continuação].
export function cortarPorAltura(texto: string, largura: number, fonte: Fonte, alturaMax: number): [string, string] {
    if (!texto) return ["", ""]
    const linhas = quebrarLinhas(texto, largura, fonte)
    const cabem = Math.floor((alturaMax + 0.01) / (fonte.tamanho * fonte.altura))
    if (cabem >= linhas.length) return [texto, ""]
    if (cabem <= 0) return ["", texto]
    let corte = linhas[cabem - 1].fim
    const minimo = corte * 0.5
    const janela = texto.slice(0, corte)
    const paragrafo = janela.lastIndexOf("\n")
    if (paragrafo >= minimo && paragrafo > 0) {
        corte = paragrafo
    } else {
        let frase = -1
        for (const m of janela.matchAll(/[.!?;:](?=\s)/g)) frase = (m.index ?? -1) + 1
        if (frase >= minimo && frase > 0) corte = frase
    }
    const parte = texto.slice(0, corte).trimEnd()
    const resto = texto.slice(corte).replace(/^\s+/, "")
    if (!resto) return [parte, ""]
    if ((parte.match(/\S+/g) ?? []).length < PALAVRAS_MINIMAS) return ["", texto]
    return [parte, resto]
}
