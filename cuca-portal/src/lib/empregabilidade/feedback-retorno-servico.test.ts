import { beforeEach, describe, expect, it, vi } from "vitest"
import { bancoFalso, type Linha } from "./banco-falso.test-util"

// A regra de status (e o Banco de Talentos) é a da tela interna: aqui só se confere que a página pública
// chama exatamente ela, com o status certo, para cada candidato. A regra tem os próprios testes.
const aplicados: { id: string; status: string }[] = []
vi.mock("./aplicar-status-candidatura", () => ({
    aplicarStatusCandidatura: async (_admin: unknown, id: string, status: string) => {
        aplicados.push({ id, status })
        return { candidaturaId: id, ok: true }
    },
}))

const { carregarPedidoPublico, responderPedido, sinalizarEmAnalise } = await import("./feedback-retorno-servico")

const agora = new Date("2026-10-14T12:00:00Z")

function cenario(pedido: Partial<Linha> = {}) {
    return bancoFalso({
        vagas: [{ id: "v1", titulo: "Repositor", empresas: { nome: "Mercado X", nome_fantasia: null } }],
        feedback_solicitacoes: [{
            id: "s1", vaga_id: "v1", tipo: "vaga", token: "tok", status_envio: "entregue",
            expires_at: "2026-10-15T12:00:00Z", respondido_em: null, situacao: null, ...pedido,
        }],
        feedback_solicitacao_itens: [
            { id: "i1", solicitacao_id: "s1", candidatura_id: "c1", resposta_status: null },
            { id: "i2", solicitacao_id: "s1", candidatura_id: "c2", resposta_status: null },
            { id: "i3", solicitacao_id: "s1", candidatura_id: "c3", resposta_status: null },
        ],
        candidaturas: [
            { id: "c1", vaga_id: "v1", nome: "Ana", status: "pendente", telefone: "5585900000001" },
            { id: "c2", vaga_id: "v1", nome: "Bruno", status: "selecionado", telefone: "5585900000002" },
            // Já contratado pela equipe: a empresa não mexe mais.
            { id: "c3", vaga_id: "v1", nome: "Carla", status: "contratado", telefone: "5585900000003" },
            // Da mesma vaga, mas fora do pedido.
            { id: "c4", vaga_id: "v1", nome: "Davi", status: "pendente", telefone: "5585900000004" },
        ],
    })
}

beforeEach(() => { aplicados.length = 0 })

describe("página pública com token do pedido (AC1, AC11)", () => {
    it("mostra só os candidatos do pedido que ainda aguardam, e só o nome", async () => {
        const { cliente } = cenario()
        const r = await carregarPedidoPublico(cliente, "tok")
        expect(r).toEqual({
            ok: true,
            dados: { vaga: { titulo: "Repositor", empresa: "Mercado X" }, candidatos: [{ id: "c1", nome: "Ana" }, { id: "c2", nome: "Bruno" }] },
        })
    })

    it("token que não é de pedido → null (segue o link antigo)", async () => {
        const { cliente } = cenario()
        expect(await carregarPedidoPublico(cliente, "outro")).toBeNull()
    })

    it.each([
        ["vencido", { expires_at: "2026-10-01T00:00:00Z" }],
        ["já usado", { respondido_em: "2026-10-14T10:00:00Z" }],
        ["em análise", { situacao: "em_analise" }],
        ["substituído", { situacao: "substituida" }],
    ])("link %s → 410", async (_nome, campos) => {
        const { cliente } = cenario(campos)
        const r = await carregarPedidoPublico(cliente, "tok")
        expect(r && !r.ok && r.status).toBe(410)
    })
})

describe("resposta da empresa (AC2, AC3, AC5)", () => {
    it("marcados → selecionado, demais do pedido → rejeitado; fora do pedido e contratado não mudam", async () => {
        const { db, cliente } = cenario()
        const fetchSpy = vi.spyOn(globalThis, "fetch")
        const r = await responderPedido(cliente, "tok", { nenhum: false, selecionados: ["c2"] }, agora)

        expect(r).toEqual({ ok: true, dados: { selecionados: 1, rejeitados: 1, falhas: 0 } })
        expect(aplicados).toEqual([{ id: "c1", status: "rejeitado" }, { id: "c2", status: "selecionado" }])
        expect(db.feedback_solicitacoes[0].respondido_em).toBe(agora.toISOString())
        expect(Object.fromEntries(db.feedback_solicitacao_itens.map(i => [i.candidatura_id, i.resposta_status])))
            .toEqual({ c1: "rejeitado", c2: "selecionado", c3: null })
        // Nada é enviado à empresa depois do envio (AC5/AC6).
        expect(fetchSpy).not.toHaveBeenCalled()
        fetchSpy.mockRestore()
    })

    it("\"Nenhum\" → todos os candidatos do pedido ficam rejeitados", async () => {
        const { cliente } = cenario()
        await responderPedido(cliente, "tok", { nenhum: true }, agora)
        expect(aplicados).toEqual([{ id: "c1", status: "rejeitado" }, { id: "c2", status: "rejeitado" }])
    })

    it("id fora do pedido no corpo → 400 e nada gravado", async () => {
        const { db, cliente } = cenario()
        const r = await responderPedido(cliente, "tok", { nenhum: false, selecionados: ["c4"] }, agora)
        expect(r && !r.ok && r.status).toBe(400)
        expect(aplicados).toEqual([])
        expect(db.feedback_solicitacoes[0].respondido_em).toBeNull()
    })

    it("uso único: a segunda resposta é recusada", async () => {
        const { cliente } = cenario()
        await responderPedido(cliente, "tok", { nenhum: true }, agora)
        aplicados.length = 0
        const r = await responderPedido(cliente, "tok", { nenhum: false, selecionados: ["c1"] }, agora)
        expect(r && !r.ok && r.status).toBe(410)
        expect(aplicados).toEqual([])
    })

    it("link vencido não grava nada", async () => {
        const { db, cliente } = cenario({ expires_at: "2026-10-14T11:00:00Z" })
        const r = await responderPedido(cliente, "tok", { nenhum: true }, agora)
        expect(r && !r.ok && r.status).toBe(410)
        expect(aplicados).toEqual([])
        expect(db.feedback_solicitacoes[0].respondido_em).toBeNull()
    })
})

describe("\"Ainda em análise\" (AC7)", () => {
    it("não muda candidato e encerra o link", async () => {
        const { db, cliente } = cenario()
        const r = await sinalizarEmAnalise(cliente, "tok", agora)
        expect(r).toEqual({ ok: true, dados: { situacao: "em_analise" } })
        expect(aplicados).toEqual([])
        expect(db.feedback_solicitacoes[0]).toMatchObject({ situacao: "em_analise", situacao_em: agora.toISOString(), respondido_em: null })
        const depois = await carregarPedidoPublico(cliente, "tok")
        expect(depois && !depois.ok && depois.status).toBe(410)
    })
})
