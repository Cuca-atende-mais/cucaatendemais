import { describe, expect, it } from "vitest"
import {
    decidirStatus,
    diasSemResposta,
    estadoLink,
    lerResposta,
    podeReenviar,
    taxaRetorno,
    ultimaPorVaga,
} from "./feedback-retorno"

const agora = new Date("2026-10-14T12:00:00Z")
const base = { status_envio: "entregue", expires_at: "2026-10-15T12:00:00Z", respondido_em: null, situacao: null }

describe("link de uso único (AC5, AC7, AC11)", () => {
    it("ativo só sem resposta, sem situação e no prazo", () => {
        expect(estadoLink(base, agora)).toBe("ativo")
        expect(estadoLink({ ...base, respondido_em: "2026-10-14T10:00:00Z" }, agora)).toBe("respondido")
        expect(estadoLink({ ...base, situacao: "em_analise" }, agora)).toBe("em_analise")
        expect(estadoLink({ ...base, situacao: "substituida" }, agora)).toBe("substituida")
        expect(estadoLink({ ...base, expires_at: "2026-10-14T11:59:59Z" }, agora)).toBe("expirado")
        expect(estadoLink({ ...base, expires_at: null }, agora)).toBe("expirado")
    })
})

describe("resposta da empresa (AC1, AC2)", () => {
    it("exige escolha explícita: marcados ou \"Nenhum\"", () => {
        expect(lerResposta({ selecionados: [] }).ok).toBe(false)
        expect(lerResposta({}).ok).toBe(false)
        expect(lerResposta({ nenhum: true, selecionados: ["a"] }).ok).toBe(false)
        expect(lerResposta({ nenhum: true })).toEqual({ ok: true, resposta: { nenhum: true } })
        expect(lerResposta({ selecionados: ["a", "a", "b"] })).toEqual({ ok: true, resposta: { nenhum: false, selecionados: ["a", "b"] } })
        expect(lerResposta({ selecionados: [1] }).ok).toBe(false)
    })

    it("marcados → selecionado, demais do pedido → rejeitado", () => {
        const r = decidirStatus(["a", "b", "c"], { nenhum: false, selecionados: ["b"] })
        expect(r.ok && Object.fromEntries(r.decisao)).toEqual({ a: "rejeitado", b: "selecionado", c: "rejeitado" })
    })

    it("\"Nenhum\" → todos rejeitados", () => {
        const r = decidirStatus(["a", "b"], { nenhum: true })
        expect(r.ok && Object.fromEntries(r.decisao)).toEqual({ a: "rejeitado", b: "rejeitado" })
    })

    it("id fora do pedido recusa a resposta inteira", () => {
        expect(decidirStatus(["a"], { nenhum: false, selecionados: ["a", "x"] }).ok).toBe(false)
    })
})

describe("reenviar, selo e taxa (AC8-AC10)", () => {
    it("reenviar: sem resposta, expirado, falhou ou em análise; nunca respondido ou substituído", () => {
        expect(podeReenviar(base)).toBe(true)
        expect(podeReenviar({ ...base, status_envio: "falhou" })).toBe(true)
        expect(podeReenviar({ ...base, situacao: "em_analise" })).toBe(true)
        expect(podeReenviar({ ...base, respondido_em: "2026-10-14T10:00:00Z" })).toBe(false)
        expect(podeReenviar({ ...base, situacao: "substituida" })).toBe(false)
        expect(podeReenviar({ ...base, status_envio: "pendente" })).toBe(false)
    })

    it("selo só depois de 48h sem resposta, contando os dias", () => {
        expect(diasSemResposta({ ...base, created_at: "2026-10-13T00:00:00Z" }, agora)).toBeNull()
        expect(diasSemResposta({ ...base, created_at: "2026-10-12T11:00:00Z" }, agora)).toBe(2)
        expect(diasSemResposta({ ...base, created_at: "2026-10-04T12:00:00Z" }, agora)).toBe(10)
        expect(diasSemResposta({ ...base, created_at: "2026-10-04T12:00:00Z", respondido_em: "2026-10-05T00:00:00Z" }, agora)).toBeNull()
        expect(diasSemResposta({ ...base, created_at: "2026-10-04T12:00:00Z", status_envio: "falhou" }, agora)).toBeNull()
        expect(diasSemResposta(undefined, agora)).toBeNull()
    })

    it("selo olha só o pedido mais recente da vaga", () => {
        const ultima = ultimaPorVaga([
            { ...base, vaga_id: "v1", created_at: "2026-10-01T00:00:00Z" },
            { ...base, vaga_id: "v1", created_at: "2026-10-14T00:00:00Z" },
            { ...base, vaga_id: "v2", created_at: "2026-10-02T00:00:00Z" },
        ])
        expect(ultima.get("v1")?.created_at).toBe("2026-10-14T00:00:00Z")
        expect(diasSemResposta(ultima.get("v1"), agora)).toBeNull()
        expect(diasSemResposta(ultima.get("v2"), agora)).toBe(12)
    })

    it("taxa: respondidas ÷ enviadas com sucesso, sem contar falha nem pedido substituído", () => {
        expect(taxaRetorno([
            { ...base, respondido_em: "x" },
            { ...base },
            { ...base, situacao: "substituida" },
            { ...base, status_envio: "falhou" },
            { ...base, status_envio: "lido", respondido_em: "y" },
        ])).toEqual({ respondidas: 2, enviadas: 3, percentual: 67 })
        expect(taxaRetorno([])).toEqual({ respondidas: 0, enviadas: 0, percentual: null })
    })
})
