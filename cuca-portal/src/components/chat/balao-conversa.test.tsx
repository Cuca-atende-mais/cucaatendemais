// S-RESP-01 (AC3) — Teste de componente sem navegador (react-dom/server, ambiente node).
// O ambiente de teste não calcula layout: aqui se confere a regra de quebra (classe no balão e
// min-w-0 na coluna da conversa). A prova de que nada é cortado é a conferência visual.
import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { TextoMensagem } from "./texto-mensagem"
import { ChatMasterDetail } from "./chat-master-detail"

const LINK_120 = "https://www.exemplo.com.br/" + "a".repeat(120 - "https://www.exemplo.com.br/".length)

/** Classes do elemento que envolve o marcador (a tag <div> aberta logo antes dele). */
function classesAntesDe(html: string, marcador: string): string {
    const pos = html.indexOf(marcador)
    expect(pos).toBeGreaterThan(-1)
    const abertura = html.lastIndexOf("<div", pos - 1)
    const tag = html.slice(abertura, html.indexOf(">", abertura))
    return /class="([^"]*)"/.exec(tag)?.[1] ?? ""
}

describe("TextoMensagem — balão quebra sequência longa sem espaço", () => {
    it("o link de 120 caracteres sem espaço é mantido inteiro no texto", () => {
        expect(LINK_120).toHaveLength(120)
        expect(LINK_120).not.toContain(" ")
        expect(renderToStaticMarkup(<TextoMensagem conteudo={LINK_120} />)).toContain(LINK_120)
    })

    it("usa overflow-wrap:anywhere e mantém whitespace-pre-wrap", () => {
        const html = renderToStaticMarkup(<TextoMensagem conteudo={LINK_120} />)
        const classes = /class="([^"]*)"/.exec(html)?.[1] ?? ""
        expect(classes.split(" ")).toContain("[overflow-wrap:anywhere]")
        expect(classes.split(" ")).toContain("whitespace-pre-wrap")
        // break-words não quebra link sem espaço dentro do limite do balão
        expect(classes.split(" ")).not.toContain("break-words")
    })

    it("conteúdo vazio não quebra a renderização", () => {
        expect(renderToStaticMarkup(<TextoMensagem conteudo={null} />)).toContain("<p")
    })
})

describe("ChatMasterDetail — coluna da conversa pode encolher", () => {
    it("com conversa aberta, a coluna da conversa tem min-w-0", () => {
        const html = renderToStaticMarkup(
            <ChatMasterDetail
                activeConversationId="c1"
                sidebar={<div data-x="lista" />}
                chat={<div data-x="conversa" />}
            />
        )
        const classes = classesAntesDe(html, '<div data-x="conversa"').split(" ")
        expect(classes).toContain("min-w-0")
        expect(classes).toContain("flex-1")
    })

    it("o contêiner das duas colunas também pode encolher", () => {
        const html = renderToStaticMarkup(
            <ChatMasterDetail activeConversationId={null} sidebar={<div />} chat={<div />} />
        )
        const raiz = (/class="([^"]*)"/.exec(html)?.[1] ?? "").split(" ")
        expect(raiz).toContain("min-w-0")
        expect(raiz).toContain("min-h-0")
    })
})
