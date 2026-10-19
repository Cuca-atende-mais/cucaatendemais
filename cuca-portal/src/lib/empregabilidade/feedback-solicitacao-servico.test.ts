import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"
import { bancoFalso } from "./banco-falso.test-util"
import { enviarPedidoFeedback, gerarToken, registrarNoAtendimento, type EntradaPedido, type EnviarTemplate } from "./feedback-solicitacao-servico"

const template = {
    nome: "empregabilidade_feedback_empresa_v1",
    ativo: true,
    status: "aprovado",
    variaveis: [{ posicao: 1, descricao: "nome_empresa" }, { posicao: 2, descricao: "titulo_vaga" }, { posicao: 3, descricao: "link_feedback" }],
    corpo_texto: "Olá, equipe de RH da {{1}}. Vaga {{2}}. Acesse: {{3}}",
    phone_number_ids: ["PNID_EMP"],
}

const entrada: EntradaPedido = {
    vagaId: "vaga-1",
    empresaId: "emp-1",
    candidaturaIds: ["cand-1", "cand-3"],
    contato: { nome: "Ana RH", telefone: "(85) 98888-7777", email: "rh@x.com" },
    numeroDestino: "5585988887777",
    nomeEmpresa: "Mercado X",
    tituloVaga: "Repositor",
    urlBase: "https://portal.cuca/",
    criadoPor: "user-1",
}

const agora = new Date("2026-10-14T12:00:00Z")

/** Cliente em que o UPDATE de `conversas` falha (o resto do banco falso segue normal). */
function comFalhaAoAtualizarConversa(cliente: SupabaseClient): SupabaseClient {
    return {
        from: (tabela: string) => {
            const q = cliente.from(tabela)
            if (tabela !== "conversas") return q
            return { ...q, update: () => ({ eq: async () => ({ data: null, error: { message: "falha simulada" } }) }) }
        },
    } as unknown as SupabaseClient
}

describe("enviarPedidoFeedback", () => {
    it("cria 1 solicitação só com os marcados, envia o template com o link e grava wamid e mensagem", async () => {
        const { db, cliente } = bancoFalso({ meta_templates: [template] })
        const enviar = vi.fn<EnviarTemplate>(async () => ({ ok: true, wamid: "wamid.1", wa_id: "558588887777", origem_id: "PNID_EMP" }))

        const r = await enviarPedidoFeedback(cliente, entrada, enviar, agora)

        expect(r.ok).toBe(true)
        expect(db.feedback_solicitacoes).toHaveLength(1)
        const sol = db.feedback_solicitacoes[0]
        expect(sol).toMatchObject({ vaga_id: "vaga-1", tipo: "vaga", empresa_id: "emp-1", status_envio: "enviado", wamid: "wamid.1", criado_por: "user-1" })
        expect(sol.expires_at).toBe("2026-10-16T12:00:00.000Z")
        expect(db.feedback_solicitacao_itens.map(i => i.candidatura_id)).toEqual(["cand-1", "cand-3"])
        expect(db.feedback_solicitacao_itens.every(i => i.solicitacao_id === sol.id)).toBe(true)

        const [numero, nomeTemplate, componentes] = enviar.mock.calls[0]
        expect(numero).toBe("5585988887777")
        expect(nomeTemplate).toBe("empregabilidade_feedback_empresa_v1")
        const params = (componentes[0] as { parameters: { parameter_name: string; text: string }[] }).parameters
        expect(params.map(p => p.parameter_name)).toEqual(["nome_empresa", "titulo_vaga", "link_feedback"])
        expect(params[2].text).toBe(`https://portal.cuca/feedback-empresa/${sol.token}`)

        // AC7: lead criado pelo wa_id normalizado, fora do disparo, e mensagem de saída na conversa.
        expect(db.leads).toEqual([expect.objectContaining({ telefone: "5585988887777", opt_in: false })])
        expect(db.conversas).toEqual([expect.objectContaining({ origem_id: "PNID_EMP", agente_tipo: "Empregabilidade", canal_ativo: "meta" })])
        expect(db.mensagens).toEqual([expect.objectContaining({
            remetente: "agente", tipo: "text", wamid: "wamid.1",
            conteudo: `Olá, equipe de RH da Mercado X. Vaga Repositor. Acesse: https://portal.cuca/feedback-empresa/${sol.token}`,
        })])
        expect(sol.conversa_id).toBe(db.conversas[0].id)
        // Decisão de 19/10: IA pausada já no envio e selo valendo até o fim do link.
        expect(db.conversas[0]).toMatchObject({ status: "awaiting_human", feedback_pedido_ate: "2026-10-16T12:00:00.000Z" })
        expect(r.ok && r.avisoAtendimento).toBeFalsy()
    })

    it("enviado, mas a IA não foi pausada: segue como enviado e avisa para assumir a conversa", async () => {
        const { db, cliente } = bancoFalso({ meta_templates: [template] })
        const enviar: EnviarTemplate = async () => ({ ok: true, wamid: "wamid.3", wa_id: "558588887777", origem_id: "PNID_EMP" })
        const r = await enviarPedidoFeedback(comFalhaAoAtualizarConversa(cliente), entrada, enviar, agora)
        expect(r).toMatchObject({ ok: true, conversaId: db.conversas[0].id })
        expect(r.ok && r.avisoAtendimento).toContain("Assumir Atendimento")
        expect(db.feedback_solicitacoes[0]).toMatchObject({ status_envio: "enviado", conversa_id: db.conversas[0].id })
        expect(db.mensagens).toHaveLength(1)
    })

    it("AC3: falha da Meta deixa a solicitação como falhou, com o motivo, e não grava no Atendimento", async () => {
        const { db, cliente } = bancoFalso({ meta_templates: [template] })
        const r = await enviarPedidoFeedback(cliente, entrada, async () => ({ ok: false, erro: "131026: não é WhatsApp" }), agora)

        expect(r).toMatchObject({ ok: false, status: 502, erro: "131026: não é WhatsApp" })
        expect(db.feedback_solicitacoes[0]).toMatchObject({ status_envio: "falhou", erro_envio: "131026: não é WhatsApp" })
        expect(db.mensagens).toEqual([])
        expect(db.leads).toEqual([])
    })

    it("AC3: sem wamid não conta como enviado", async () => {
        const { db, cliente } = bancoFalso({ meta_templates: [template] })
        const r = await enviarPedidoFeedback(cliente, entrada, async () => ({ ok: true, wamid: null, wa_id: "5585988887777" }), agora)
        expect(r.ok).toBe(false)
        expect(db.feedback_solicitacoes[0].status_envio).toBe("falhou")
    })

    it("sem o template aprovado não cria nada nem envia", async () => {
        const { db, cliente } = bancoFalso({ meta_templates: [{ ...template, status: "pendente" }] })
        const enviar = vi.fn<EnviarTemplate>()
        const r = await enviarPedidoFeedback(cliente, entrada, enviar, agora)
        expect(r.ok).toBe(false)
        expect(enviar).not.toHaveBeenCalled()
        expect(db.feedback_solicitacoes).toEqual([])
    })

    it("enviado, mas falha ao gravar no Atendimento: segue como enviado e avisa", async () => {
        const { db, cliente } = bancoFalso({ meta_templates: [template] })
        const r = await enviarPedidoFeedback(cliente, entrada, async () => ({ ok: true, wamid: "wamid.2", wa_id: null }), agora)
        expect(r).toMatchObject({ ok: true, conversaId: null })
        expect(r.ok && r.avisoAtendimento).toBeTruthy()
        expect(db.feedback_solicitacoes[0].status_envio).toBe("enviado")
    })
})

describe("registrarNoAtendimento (AC7)", () => {
    const base = { origemId: "PNID_EMP", nome: "Ana", texto: "Olá", wamid: "wamid.9", linkValidoAte: "2026-10-16T12:00:00.000Z" }

    it("reutiliza lead e conversa existentes sem mexer em opt_in; conversa já pausada continua pausada", async () => {
        const { db, cliente } = bancoFalso({
            leads: [{ id: "lead-1", telefone: "5585988887777", opt_in: true }],
            conversas: [{ id: "conv-1", lead_id: "lead-1", origem_id: "PNID_EMP", status: "awaiting_human" }],
        })
        const r = await registrarNoAtendimento(cliente, { ...base, waId: "5585988887777" })
        expect(r).toEqual({ leadId: "lead-1", conversaId: "conv-1", iaPausada: true })
        expect(db.leads).toHaveLength(1)
        expect(db.leads[0].opt_in).toBe(true)
        expect(db.conversas).toEqual([{
            id: "conv-1", lead_id: "lead-1", origem_id: "PNID_EMP", status: "awaiting_human",
            updated_at: expect.any(String), feedback_pedido_ate: "2026-10-16T12:00:00.000Z",
        }])
        expect(db.mensagens[0]).toMatchObject({ conversa_id: "conv-1", lead_id: "lead-1", wamid: "wamid.9" })
    })

    it("conversa antiga com a IA ativa sobe na lista e fica pausada: updated_at passa a ser o momento do envio", async () => {
        const { db, cliente } = bancoFalso({
            leads: [{ id: "lead-1", telefone: "558591733321", opt_in: false }],
            conversas: [{ id: "conv-1", lead_id: "lead-1", origem_id: "PNID_EMP", status: "ativa", updated_at: "2026-09-28T19:52:59Z" }],
        })
        const antes = Date.now()
        await registrarNoAtendimento(cliente, { ...base, waId: "558591733321" })
        const atualizada = new Date(db.conversas[0].updated_at as string).getTime()
        expect(atualizada).toBeGreaterThanOrEqual(antes - 1000)
        expect(db.conversas[0]).toMatchObject({ status: "awaiting_human", lead_id: "lead-1", origem_id: "PNID_EMP" })
    })

    it("wa_id de 12 dígitos casa com o lead gravado com o 9 (como o webhook de entrada grava)", async () => {
        const { db, cliente } = bancoFalso({ leads: [{ id: "lead-1", telefone: "5585988887777", opt_in: false }] })
        const r = await registrarNoAtendimento(cliente, { ...base, waId: "558588887777" })
        expect(r.leadId).toBe("lead-1")
        expect(db.leads).toHaveLength(1)
    })

    it("conversa de outro número (Institucional) não é reaproveitada: cria a de Empregabilidade", async () => {
        const { db, cliente } = bancoFalso({
            leads: [{ id: "lead-1", telefone: "5585988887777" }],
            conversas: [{ id: "conv-inst", lead_id: "lead-1", origem_id: "PNID_INST" }],
        })
        const r = await registrarNoAtendimento(cliente, { ...base, waId: "5585988887777" })
        expect(r.conversaId).not.toBe("conv-inst")
        expect(db.conversas).toHaveLength(2)
        // Só a conversa de Empregabilidade é pausada; a do Institucional fica como estava.
        expect(db.conversas.find(c => c.id === "conv-inst")).toEqual({ id: "conv-inst", lead_id: "lead-1", origem_id: "PNID_INST" })
    })

    it("corrida com o webhook de entrada: lead criado no meio reaproveitado", async () => {
        const { db, cliente } = bancoFalso({}, {
            antesDeInserirLead: d => { if (!d.leads.length) d.leads.push({ id: "lead-webhook", telefone: "5585988887777" }) },
        })
        const r = await registrarNoAtendimento(cliente, { ...base, waId: "5585988887777" })
        expect(r.leadId).toBe("lead-webhook")
        expect(db.leads).toHaveLength(1)
    })
})

describe("token", () => {
    it("é longo e não se repete", () => {
        const a = gerarToken()
        expect(a.length).toBeGreaterThanOrEqual(43)
        expect(a).not.toBe(gerarToken())
    })
})
