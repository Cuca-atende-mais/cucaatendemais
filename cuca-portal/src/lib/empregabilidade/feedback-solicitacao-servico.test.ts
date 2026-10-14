import { describe, expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { enviarPedidoFeedback, gerarToken, registrarNoAtendimento, type EntradaPedido, type EnviarTemplate } from "./feedback-solicitacao-servico"

// Banco em memória com só o que o serviço usa: select/insert/upsert/update/delete com eq/in, e as
// chaves únicas reais (leads.telefone e conversas(lead_id, origem_id)).
type Linha = Record<string, unknown>

function bancoFalso(inicial: Record<string, Linha[]> = {}, ganchos: { antesDeInserirLead?: (db: Record<string, Linha[]>) => void } = {}) {
    const db: Record<string, Linha[]> = { leads: [], conversas: [], mensagens: [], feedback_solicitacoes: [], feedback_solicitacao_itens: [], meta_templates: [], ...inicial }
    let seq = 0
    const novoId = () => `id-${++seq}`

    function consulta(tabela: string) {
        let op: "select" | "insert" | "upsert" | "update" | "delete" = "select"
        let dados: Linha | Linha[] = {}
        let opcoes: { onConflict?: string; ignoreDuplicates?: boolean } = {}
        let modo: "lista" | "um" | "talvez" = "lista"
        const filtros: ((l: Linha) => boolean)[] = []

        const executar = async () => {
            const linhas = db[tabela]
            const casa = (l: Linha) => filtros.every(f => f(l))
            if (op === "select") {
                const achadas = linhas.filter(casa)
                if (modo === "lista") return { data: achadas, error: null }
                return { data: achadas[0] ?? null, error: modo === "um" && !achadas[0] ? { message: "nenhuma" } : null }
            }
            if (op === "update") {
                for (const l of linhas.filter(casa)) Object.assign(l, dados)
                return { data: null, error: null }
            }
            if (op === "delete") {
                db[tabela] = linhas.filter(l => !casa(l))
                return { data: null, error: null }
            }
            const novas: Linha[] = (Array.isArray(dados) ? dados : [dados]).map(d => ({ id: novoId(), ...d }))
            if (tabela === "leads") ganchos.antesDeInserirLead?.(db)
            for (const n of novas) {
                if (tabela === "leads" && db.leads.some(l => l.telefone === n.telefone)) {
                    return { data: null, error: { code: "23505", message: "duplicado" } }
                }
                if (tabela === "conversas" && db.conversas.some(c => c.lead_id === n.lead_id && c.origem_id === n.origem_id)) {
                    if (op === "upsert" && opcoes.ignoreDuplicates) continue
                    return { data: null, error: { code: "23505", message: "duplicado" } }
                }
                db[tabela].push(n)
            }
            return { data: modo === "lista" ? novas : novas[0], error: null }
        }

        const q = {
            select: () => q,
            insert: (d: Linha | Linha[]) => { op = "insert"; dados = d; return q },
            upsert: (d: Linha, o: typeof opcoes) => { op = "upsert"; dados = d; opcoes = o; return q },
            update: (d: Linha) => { op = "update"; dados = d; return q },
            delete: () => { op = "delete"; return q },
            eq: (c: string, v: unknown) => { filtros.push(l => l[c] === v); return q },
            in: (c: string, v: unknown[]) => { filtros.push(l => v.includes(l[c])); return q },
            single: () => { modo = "um"; return executar() },
            maybeSingle: () => { modo = "talvez"; return executar() },
            then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => executar().then(ok, erro),
        }
        return q
    }
    return { db, cliente: { from: consulta } as unknown as SupabaseClient }
}

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
    const base = { origemId: "PNID_EMP", nome: "Ana", texto: "Olá", wamid: "wamid.9" }

    it("reutiliza lead e conversa existentes sem mexer em opt_in nem no status da conversa", async () => {
        const { db, cliente } = bancoFalso({
            leads: [{ id: "lead-1", telefone: "5585988887777", opt_in: true }],
            conversas: [{ id: "conv-1", lead_id: "lead-1", origem_id: "PNID_EMP", status: "awaiting_human" }],
        })
        const r = await registrarNoAtendimento(cliente, { ...base, waId: "5585988887777" })
        expect(r).toEqual({ leadId: "lead-1", conversaId: "conv-1" })
        expect(db.leads).toHaveLength(1)
        expect(db.leads[0].opt_in).toBe(true)
        expect(db.conversas).toEqual([{ id: "conv-1", lead_id: "lead-1", origem_id: "PNID_EMP", status: "awaiting_human" }])
        expect(db.mensagens[0]).toMatchObject({ conversa_id: "conv-1", lead_id: "lead-1", wamid: "wamid.9" })
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
