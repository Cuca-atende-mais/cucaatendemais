// S-INST-QUAL-12 — Teste de componente sem navegador: renderiza para HTML estático
// (react-dom/server) e confere o que aparece. Os efeitos (consultas ao banco) não rodam assim.
import { describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { SinoAlertasBotao } from "./sino-alertas-botao"
import { AlertasLista } from "./alertas-lista"
import type { AlertaItem } from "@/lib/alertas/alertas"

const usuario = vi.hoisted(() => ({ isDeveloper: false, loading: false }))
vi.mock("@/lib/auth/user-provider", () => ({ useUser: () => usuario }))
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc: vi.fn() }) }))

import { CentralAlertas } from "./central-alertas"

function alerta(i: number, extra: Partial<AlertaItem> = {}): AlertaItem {
    return {
        id: `id-${i}`,
        origem: "rag_saude",
        tipo: "busca_vazia_com_unidade",
        severidade: "atencao",
        titulo: `Alerta ${i}`,
        detalhe: `Detalhe ${i}`,
        acao_sugerida: `Ação ${i}`,
        criado_em: "2026-11-03T15:45:00Z",
        resolvido_em: null,
        email_enviado_em: "2026-11-03T15:45:05Z",
        email_erro: null,
        lido: false,
        total: 12,
        ...extra,
    }
}

const noop = () => {}

function contar(html: string, trecho: string): number {
    return html.split(trecho).length - 1
}

describe("SinoAlertasBotao", () => {
    it("sem não lidos: nenhum indicador", () => {
        const html = renderToStaticMarkup(<SinoAlertasBotao naoLidos={0} />)
        expect(html).not.toContain("contador-alertas")
        expect(html).toContain("nenhum não lido")
    })
    it("com não lidos: mostra a quantidade", () => {
        const html = renderToStaticMarkup(<SinoAlertasBotao naoLidos={3} />)
        expect(html).toContain('data-testid="contador-alertas"')
        expect(html).toContain(">3<")
    })
    it("acima de 99: 99+", () => {
        expect(renderToStaticMarkup(<SinoAlertasBotao naoLidos={150} />)).toContain(">99+<")
    })
})

describe("AlertasLista (AC4)", () => {
    const pagina1 = Array.from({ length: 10 }, (_, i) => alerta(i + 1))

    it("mostra os 10 itens da página e a paginação", () => {
        const html = renderToStaticMarkup(
            <AlertasLista itens={pagina1} pagina={1} totalPaginas={2} naoLidos={12}
                onPagina={noop} onMarcarLido={noop} onMarcarTodos={noop} />,
        )
        expect(contar(html, 'data-testid="alerta-item"')).toBe(10)
        expect(html).toContain("Página 1 de 2")
        expect(html).toContain("12 não lidos")
    })

    it("cada item tem título, detalhe, ação sugerida, data, situação e e-mail", () => {
        const html = renderToStaticMarkup(
            <AlertasLista itens={[alerta(1)]} pagina={1} totalPaginas={1} naoLidos={1}
                onPagina={noop} onMarcarLido={noop} onMarcarTodos={noop} />,
        )
        expect(html).toContain("Alerta 1")
        expect(html).toContain("Detalhe 1")
        expect(html).toContain("O que fazer: </span>Ação 1")
        expect(html).toContain("Aberto em 03/11/2026, 12:45")
        expect(html).toContain(">Aberto<")
        expect(html).toContain("E-mail enviado em 03/11/2026, 12:45")
        expect(html).toContain("Marcar como lido")
        expect(html).toContain("Marcar todos como lidos")
    })

    it("resolvido, lido e e-mail com erro", () => {
        const html = renderToStaticMarkup(
            <AlertasLista
                itens={[alerta(1, { resolvido_em: "2026-11-04T10:00:00Z", lido: true, email_enviado_em: null, email_erro: "HTTP 403" })]}
                pagina={1} totalPaginas={1} naoLidos={0}
                onPagina={noop} onMarcarLido={noop} onMarcarTodos={noop} />,
        )
        expect(html).toContain(">Resolvido<")
        expect(html).toContain("Resolvido em 04/11/2026, 07:00")
        expect(html).toContain("E-mail não enviado: HTTP 403")
        expect(html).toContain('data-lido="sim"')
        expect(html).not.toContain("Marcar como lido<")
        expect(html).toContain("Tudo lido")
    })

    it("lista vazia", () => {
        const html = renderToStaticMarkup(
            <AlertasLista itens={[]} pagina={1} totalPaginas={1} naoLidos={0}
                onPagina={noop} onMarcarLido={noop} onMarcarTodos={noop} />,
        )
        expect(html).toContain("Nenhum alerta até agora.")
    })
})

describe("CentralAlertas (AC3): sino só para as contas Developer", () => {
    it("quem não é Developer não vê o sino", () => {
        usuario.isDeveloper = false
        expect(renderToStaticMarkup(<CentralAlertas />)).toBe("")
    })
    it("enquanto carrega o usuário, nada aparece", () => {
        usuario.isDeveloper = true
        usuario.loading = true
        expect(renderToStaticMarkup(<CentralAlertas />)).toBe("")
        usuario.loading = false
    })
    it("Developer vê o sino, sem indicador antes da primeira contagem", () => {
        usuario.isDeveloper = true
        const html = renderToStaticMarkup(<CentralAlertas />)
        expect(html).toContain("Alertas: nenhum não lido")
        expect(html).not.toContain("contador-alertas")
    })
})
