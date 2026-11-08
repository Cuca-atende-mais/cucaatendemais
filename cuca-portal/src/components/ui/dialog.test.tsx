// S-RESP-02 (AC2) — Modal com altura máxima e rolagem própria. Teste sem navegador
// (react-dom/server, ambiente node): o portal do Radix precisa de `document`, então as peças do
// Radix viram elementos simples aqui. O teste confere a regra (altura máxima e rolagem no modal,
// cabeçalho e rodapé grudados nas bordas). A prova de que tudo é alcançável é a conferência visual.
import { describe, expect, it, vi } from "vitest"
import * as React from "react"
import { renderToStaticMarkup } from "react-dom/server"

vi.mock("radix-ui", () => {
    const simples = (tag: string) =>
        function Peca({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) {
            delete props.asChild // prop do Radix, não vai para o HTML
            return React.createElement(tag, props, children as React.ReactNode)
        }
    return {
        Dialog: {
            Root: simples("div"),
            Trigger: simples("button"),
            Portal: ({ children }: React.PropsWithChildren) => <>{children}</>,
            Overlay: simples("div"),
            Content: simples("div"),
            Close: simples("button"),
            Title: simples("h2"),
            Description: simples("p"),
        },
    }
})

import { DialogContent, DialogFooter, DialogHeader, DialogTitle } from "./dialog"

/** Classes da tag que tem o data-slot pedido. */
function classesDoSlot(html: string, slot: string): string[] {
    const tag = new RegExp(`<[a-z0-9]+[^>]*data-slot="${slot}"[^>]*>`).exec(html)?.[0]
    expect(tag, `data-slot="${slot}" não encontrado`).toBeTruthy()
    return (/class="([^"]*)"/.exec(tag!)?.[1] ?? "").split(" ")
}

function modalComprido(classeConteudo?: string) {
    return renderToStaticMarkup(
        <DialogContent className={classeConteudo}>
            <DialogHeader><DialogTitle>Cadastro</DialogTitle></DialogHeader>
            {Array.from({ length: 30 }, (_, i) => <input key={i} aria-label={`campo ${i}`} />)}
            <DialogFooter><button>Salvar</button></DialogFooter>
        </DialogContent>
    )
}

describe("DialogContent — altura máxima da tela com rolagem por dentro", () => {
    it("limita a altura à tela (com margem) e rola por dentro", () => {
        const classes = classesDoSlot(modalComprido(), "dialog-content")
        expect(classes).toContain("max-h-[calc(100svh-2rem)]")
        expect(classes).toContain("overflow-y-auto")
    })

    it("quem já controla a própria rolagem continua sobrescrevendo", () => {
        const classes = classesDoSlot(modalComprido("max-h-[90vh] flex flex-col p-0 overflow-hidden"), "dialog-content")
        expect(classes).toContain("max-h-[90vh]")
        expect(classes).toContain("overflow-hidden")
        expect(classes).not.toContain("max-h-[calc(100svh-2rem)]")
        expect(classes).not.toContain("overflow-y-auto")
    })

    it("o botão de fechar fica por cima do cabeçalho fixo", () => {
        expect(classesDoSlot(modalComprido(), "dialog-close")).toContain("z-20")
    })
})

describe("DialogHeader / DialogFooter — fora da rolagem (grudados nas bordas)", () => {
    it("cabeçalho gruda no topo, com fundo do modal e cobrindo a faixa do espaçamento", () => {
        const classes = classesDoSlot(modalComprido(), "dialog-header")
        expect(classes).toEqual(expect.arrayContaining(["sticky", "top-0", "z-10", "bg-popover", "shadow-[0_-0.75rem_0_0.75rem_var(--popover)]"]))
    })

    it("rodapé (botão de salvar) gruda embaixo, com fundo do modal e cobrindo a faixa do espaçamento", () => {
        const classes = classesDoSlot(modalComprido(), "dialog-footer")
        expect(classes).toEqual(expect.arrayContaining(["sticky", "bottom-0", "z-10", "bg-popover", "shadow-[0_0.75rem_0_0.75rem_var(--popover)]"]))
    })

    it("a classe passada pelo modal continua valendo", () => {
        const html = renderToStaticMarkup(<DialogFooter className="gap-2 border-t" />)
        expect(classesDoSlot(html, "dialog-footer")).toEqual(expect.arrayContaining(["gap-2", "border-t", "sticky"]))
    })
})
