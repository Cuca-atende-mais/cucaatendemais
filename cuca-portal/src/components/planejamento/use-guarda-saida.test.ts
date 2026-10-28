import { describe, expect, it } from "vitest"
import { destinoInterno } from "./use-guarda-saida"

const ORIGEM = "https://portal.cuca.test"

function ancora(href: string | null, extra: { target?: string; download?: boolean } = {}) {
    return {
        target: extra.target ?? "",
        getAttribute: (n: string) => (n === "href" ? href : null),
        hasAttribute: (n: string) => n === "download" && !!extra.download,
    } as unknown as HTMLAnchorElement
}

describe("destinoInterno (caixa ao sair, AC8)", () => {
    const aqui = "/planejamento/novo"

    it("link interno do menu ou da página vira destino interceptado", () => {
        expect(destinoInterno(ancora("/empregabilidade"), ORIGEM, aqui)).toBe("/empregabilidade")
        expect(destinoInterno(ancora(`${ORIGEM}/planejamento?x=1`), ORIGEM, aqui)).toBe("/planejamento?x=1")
    })

    it("não intercepta link externo, nova aba, download, âncora da própria página ou a mesma página", () => {
        expect(destinoInterno(ancora("https://outro.site/x"), ORIGEM, aqui)).toBeNull()
        expect(destinoInterno(ancora("/empregabilidade", { target: "_blank" }), ORIGEM, aqui)).toBeNull()
        expect(destinoInterno(ancora("/arquivo.pdf", { download: true }), ORIGEM, aqui)).toBeNull()
        expect(destinoInterno(ancora("#secao-3"), ORIGEM, aqui)).toBeNull()
        expect(destinoInterno(ancora(aqui), ORIGEM, aqui)).toBeNull()
        expect(destinoInterno(ancora("mailto:a@b.c"), ORIGEM, aqui)).toBeNull()
        expect(destinoInterno(ancora(null), ORIGEM, aqui)).toBeNull()
    })
})
