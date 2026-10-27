import { describe, expect, it } from "vitest"
import {
    filtrarLista,
    normalizarBusca,
    ordenarPorUltimoEnvio,
    ultimoPedidoPorVaga,
    urlFeedback,
    type LinhaFeedback,
    type PedidoDaLista,
} from "./feedback-lista"

const AGORA = new Date("2026-10-27T12:00:00Z")

function pedido(p: Partial<PedidoDaLista> & { id: string; vaga_id: string; created_at: string }): PedidoDaLista {
    return {
        enviado_por: null,
        candidatos: 1,
        status_envio: "entregue",
        erro_envio: null,
        expires_at: "2026-10-28T12:00:00Z",
        respondido_em: null,
        situacao: null,
        ...p,
    }
}

function linha(l: Partial<LinhaFeedback> & { vaga_id: string; ultimo: PedidoDaLista }): LinhaFeedback {
    return {
        empresa_id: "e1",
        empresa_nome: "Empresa",
        numero_vaga: 1,
        titulo: "Vaga",
        tipo: "vaga_normal",
        pedidos: 1,
        ...l,
    }
}

describe("ultimoPedidoPorVaga", () => {
    it("lista vazia não gera linha", () => {
        expect(ultimoPedidoPorVaga([]).size).toBe(0)
    })

    it("uma linha por vaga, com o pedido mais novo e o total de pedidos", () => {
        const mapa = ultimoPedidoPorVaga([
            pedido({ id: "a1", vaga_id: "A", created_at: "2026-10-20T10:00:00Z" }),
            pedido({ id: "b1", vaga_id: "B", created_at: "2026-10-21T10:00:00Z" }),
            pedido({ id: "a2", vaga_id: "A", created_at: "2026-10-25T10:00:00Z" }),
            pedido({ id: "a0", vaga_id: "A", created_at: "2026-10-01T10:00:00Z" }),
        ])
        expect(mapa.size).toBe(2)
        expect(mapa.get("A")).toMatchObject({ total: 3, ultimo: { id: "a2" } })
        expect(mapa.get("B")).toMatchObject({ total: 1, ultimo: { id: "b1" } })
    })

    it("empate de data escolhe o mesmo pedido em qualquer ordem de chegada", () => {
        const x = pedido({ id: "x", vaga_id: "A", created_at: "2026-10-20T10:00:00Z" })
        const y = pedido({ id: "y", vaga_id: "A", created_at: "2026-10-20T10:00:00Z" })
        expect(ultimoPedidoPorVaga([x, y]).get("A")?.ultimo.id).toBe("y")
        expect(ultimoPedidoPorVaga([y, x]).get("A")?.ultimo.id).toBe("y")
    })
})

describe("ordenarPorUltimoEnvio", () => {
    it("mais novo primeiro, sem alterar a lista original", () => {
        const velha = linha({ vaga_id: "A", ultimo: pedido({ id: "1", vaga_id: "A", created_at: "2026-10-01T00:00:00Z" }) })
        const nova = linha({ vaga_id: "B", ultimo: pedido({ id: "2", vaga_id: "B", created_at: "2026-10-26T00:00:00Z" }) })
        const original = [velha, nova]
        expect(ordenarPorUltimoEnvio(original).map(l => l.vaga_id)).toEqual(["B", "A"])
        expect(original.map(l => l.vaga_id)).toEqual(["A", "B"])
    })
})

describe("normalizarBusca", () => {
    it("ignora acento, maiúscula e espaço nas pontas", () => {
        expect(normalizarBusca("  Padaria São JOÃO ")).toBe("padaria sao joao")
        expect(normalizarBusca(null)).toBe("")
    })
})

describe("filtrarLista", () => {
    const respondida = linha({
        vaga_id: "A",
        empresa_id: "e1",
        empresa_nome: "Padaria São João",
        numero_vaga: 12,
        titulo: "Atendente",
        ultimo: pedido({ id: "1", vaga_id: "A", created_at: "2026-10-20T00:00:00Z", respondido_em: "2026-10-21T00:00:00Z" }),
    })
    const aguardando = linha({
        vaga_id: "B",
        empresa_id: "e2",
        empresa_nome: "Mercadinho Ceará",
        numero_vaga: 30,
        titulo: "Repositor",
        ultimo: pedido({ id: "2", vaga_id: "B", created_at: "2026-10-26T00:00:00Z" }),
    })
    const falhou = linha({
        vaga_id: "C",
        empresa_id: "e2",
        empresa_nome: "Mercadinho Ceará",
        numero_vaga: 31,
        titulo: "Caixa",
        ultimo: pedido({ id: "3", vaga_id: "C", created_at: "2026-10-26T00:00:00Z", status_envio: "falhou" }),
    })
    const todas = [respondida, aguardando, falhou]

    it("sem filtro devolve tudo, inclusive o pedido que falhou", () => {
        expect(filtrarLista(todas, {}, AGORA)).toHaveLength(3)
        expect(filtrarLista(todas, { status: "todos" }, AGORA)).toHaveLength(3)
    })

    it("busca pela empresa sem acento e sem maiúscula", () => {
        expect(filtrarLista(todas, { busca: "sao joao" }, AGORA).map(l => l.vaga_id)).toEqual(["A"])
        expect(filtrarLista(todas, { busca: "CEARA" }, AGORA).map(l => l.vaga_id)).toEqual(["B", "C"])
    })

    it("busca pela vaga (título e número)", () => {
        expect(filtrarLista(todas, { busca: "repositor" }, AGORA).map(l => l.vaga_id)).toEqual(["B"])
        expect(filtrarLista(todas, { busca: "#31" }, AGORA).map(l => l.vaga_id)).toEqual(["C"])
    })

    it("filtra pelo status do feedback do último pedido", () => {
        expect(filtrarLista(todas, { status: "respondido" }, AGORA).map(l => l.vaga_id)).toEqual(["A"])
        expect(filtrarLista(todas, { status: "aguardando" }, AGORA).map(l => l.vaga_id)).toEqual(["B"])
        expect(filtrarLista(todas, { status: "nao_enviado" }, AGORA).map(l => l.vaga_id)).toEqual(["C"])
    })

    it("filtra pela empresa", () => {
        expect(filtrarLista(todas, { empresaId: "e2" }, AGORA).map(l => l.vaga_id)).toEqual(["B", "C"])
    })

    it("combina empresa, status e busca", () => {
        expect(filtrarLista(todas, { empresaId: "e2", status: "aguardando", busca: "mercadinho" }, AGORA).map(l => l.vaga_id)).toEqual(["B"])
        expect(filtrarLista(todas, { empresaId: "e1", busca: "mercadinho" }, AGORA)).toHaveLength(0)
    })
})

describe("urlFeedback", () => {
    it("sem parâmetros é a lista completa", () => {
        expect(urlFeedback()).toBe("/empregabilidade/feedback")
        expect(urlFeedback({ empresa: "", vaga: null })).toBe("/empregabilidade/feedback")
    })

    it("lista filtrada pela empresa", () => {
        expect(urlFeedback({ empresa: "e1" })).toBe("/empregabilidade/feedback?empresa=e1")
    })

    it("detalhe guarda o filtro de empresa para o Voltar", () => {
        expect(urlFeedback({ vaga: "v1" })).toBe("/empregabilidade/feedback?vaga=v1")
        expect(urlFeedback({ empresa: "e1", vaga: "v1" })).toBe("/empregabilidade/feedback?empresa=e1&vaga=v1")
    })
})
