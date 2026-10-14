import { randomBytes } from "crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import {
    TEMPLATE_FEEDBACK_EMPRESA,
    VALIDADE_LINK_HORAS,
    montarComponentesTemplate,
    normalizarWaId,
    renderizarCorpo,
    type ValoresPedido,
    type VariavelTemplate,
} from "./feedback-solicitacao"

// S-EMP-GES-02: cria o pedido de feedback (só os candidatos marcados), envia o template aprovado pelo
// worker e grava a mensagem na conversa de Empregabilidade do Atendimento. Recebe o cliente admin
// (service_role) — quem chama já checou sessão, permissão e se o usuário enxerga a vaga e os candidatos.

export interface RespostaWorker {
    ok: boolean
    wamid?: string | null
    wa_id?: string | null
    origem_id?: string | null
    erro?: string
}

/** Chamada ao worker, injetada para os testes não dependerem de rede. */
export type EnviarTemplate = (numero: string, template: string, componentes: unknown[]) => Promise<RespostaWorker>

export interface EntradaPedido {
    vagaId: string
    empresaId: string | null
    candidaturaIds: string[]
    contato: { nome: string | null; telefone: string; email: string | null }
    numeroDestino: string
    nomeEmpresa: string
    tituloVaga: string
    urlBase: string
    criadoPor: string
}

export type ResultadoPedido =
    | { ok: true; solicitacaoId: string; wamid: string | null; conversaId: string | null; avisoAtendimento?: string }
    | { ok: false; solicitacaoId?: string; erro: string; status: number }

export function gerarToken(): string {
    return randomBytes(32).toString("base64url")
}

interface TemplateAprovado {
    variaveis: VariavelTemplate[]
    corpo_texto: string
    phone_number_ids: string[] | null
}

async function carregarTemplate(admin: SupabaseClient): Promise<TemplateAprovado | null> {
    const { data, error } = await admin
        .from("meta_templates")
        .select("variaveis, corpo_texto, phone_number_ids")
        .eq("nome", TEMPLATE_FEEDBACK_EMPRESA)
        .eq("ativo", true)
        .eq("status", "aprovado")
        .maybeSingle<TemplateAprovado>()
    if (error) throw error
    return data
}

/**
 * Acha (ou cria) o lead e a conversa de Empregabilidade do número que a Meta devolveu e grava a mensagem.
 * O lead é buscado por igualdade com o `wa_id` normalizado — o mesmo valor que o webhook de entrada usa
 * quando a empresa responde —, então a resposta cai nesta mesma conversa.
 */
export async function registrarNoAtendimento(
    admin: SupabaseClient,
    p: { waId: string; origemId: string; nome: string | null; texto: string; wamid: string | null },
): Promise<{ leadId: string; conversaId: string }> {
    const telefone = normalizarWaId(p.waId)

    const buscarLead = async () => {
        const { data, error } = await admin.from("leads").select("id").eq("telefone", telefone).maybeSingle<{ id: string }>()
        if (error) throw error
        return data
    }
    let lead = await buscarLead()
    if (!lead) {
        // opt_in = false: lead da Empregabilidade nunca entra no público de disparo (decisão de 13/10).
        const { data, error } = await admin
            .from("leads")
            .insert({ telefone, nome: p.nome, opt_in: false })
            .select("id")
            .single<{ id: string }>()
        if (error) {
            // Corrida com o webhook de entrada (mesmo telefone): reaproveita o lead que ganhou.
            if (error.code !== "23505") throw error
            lead = await buscarLead()
            if (!lead) throw error
        } else {
            lead = data
        }
    }

    // Conflito em (lead_id, origem_id) não sobrescreve nada da conversa existente (status, estado).
    const { error: upErr } = await admin.from("conversas").upsert(
        { lead_id: lead.id, origem_id: p.origemId, canal_ativo: "meta", agente_tipo: "Empregabilidade" },
        { onConflict: "lead_id,origem_id", ignoreDuplicates: true },
    )
    if (upErr) throw upErr
    const { data: conversa, error: cErr } = await admin
        .from("conversas")
        .select("id")
        .eq("lead_id", lead.id)
        .eq("origem_id", p.origemId)
        .maybeSingle<{ id: string }>()
    if (cErr) throw cErr
    if (!conversa) throw new Error("Conversa não encontrada depois de criada.")

    const { error: mErr } = await admin.from("mensagens").insert({
        conversa_id: conversa.id,
        lead_id: lead.id,
        remetente: "agente",
        tipo: "text",
        conteudo: p.texto,
        wamid: p.wamid,
    })
    if (mErr) throw mErr

    // A lista do Atendimento ordena por conversas.updated_at e escuta mudanças em `conversas` (não em
    // `mensagens`): sem isto, numa conversa antiga a mensagem fica gravada mas a conversa não sobe na
    // lista. Só a data muda — status e estado da conversa ficam como estão. Falha aqui não desfaz o envio.
    const { error: dErr } = await admin.from("conversas").update({ updated_at: new Date().toISOString() }).eq("id", conversa.id)
    if (dErr) console.error("[feedback-solicitacao] Mensagem gravada, mas falhou ao atualizar a data da conversa:", dErr)
    return { leadId: lead.id, conversaId: conversa.id }
}

export async function enviarPedidoFeedback(
    admin: SupabaseClient,
    entrada: EntradaPedido,
    enviar: EnviarTemplate,
    agora: Date = new Date(),
): Promise<ResultadoPedido> {
    const template = await carregarTemplate(admin)
    if (!template) return { ok: false, status: 500, erro: "O template de feedback aprovado não está cadastrado." }

    const token = gerarToken()
    const valores: ValoresPedido = {
        nome_empresa: entrada.nomeEmpresa,
        titulo_vaga: entrada.tituloVaga,
        link_feedback: `${entrada.urlBase.replace(/\/+$/, "")}/feedback-empresa/${token}`,
    }
    let componentes: unknown[]
    try {
        componentes = montarComponentesTemplate(template.variaveis, valores)
    } catch (e) {
        return { ok: false, status: 400, erro: e instanceof Error ? e.message : "Dados do pedido incompletos." }
    }

    const expira = new Date(agora.getTime() + VALIDADE_LINK_HORAS * 3600_000)
    const { data: sol, error: sErr } = await admin
        .from("feedback_solicitacoes")
        .insert({
            vaga_id: entrada.vagaId,
            tipo: "vaga",
            empresa_id: entrada.empresaId,
            contato_nome: entrada.contato.nome,
            contato_telefone: entrada.contato.telefone,
            contato_email: entrada.contato.email,
            token,
            expires_at: expira.toISOString(),
            criado_por: entrada.criadoPor,
            status_envio: "pendente",
        })
        .select("id")
        .single<{ id: string }>()
    if (sErr || !sol) throw sErr ?? new Error("Falha ao criar a solicitação.")

    const { error: iErr } = await admin
        .from("feedback_solicitacao_itens")
        .insert(entrada.candidaturaIds.map(id => ({ solicitacao_id: sol.id, candidatura_id: id })))
    if (iErr) {
        await admin.from("feedback_solicitacoes").delete().eq("id", sol.id)
        throw iErr
    }

    const r = await enviar(entrada.numeroDestino, TEMPLATE_FEEDBACK_EMPRESA, componentes)
    if (!r.ok || !r.wamid) {
        const erro = r.ok ? "A Meta aceitou o envio mas não devolveu o identificador da mensagem." : (r.erro || "Falha no envio.")
        await admin.from("feedback_solicitacoes").update({ status_envio: "falhou", erro_envio: erro }).eq("id", sol.id)
        return { ok: false, status: 502, solicitacaoId: sol.id, erro }
    }

    // Antes deste update o webhook de status não acha a linha (casa por wamid), então ela ainda está 'pendente'.
    const { error: wErr } = await admin.from("feedback_solicitacoes").update({ wamid: r.wamid, status_envio: "enviado" }).eq("id", sol.id)
    if (wErr) console.error("[feedback-solicitacao] Enviado, mas falhou ao gravar o wamid:", wErr)

    const origemId = r.origem_id || template.phone_number_ids?.[0]
    if (!r.wa_id || !origemId) {
        return { ok: true, solicitacaoId: sol.id, wamid: r.wamid, conversaId: null, avisoAtendimento: "Enviado, mas a Meta não devolveu o número para registrar no Atendimento." }
    }
    try {
        const { conversaId } = await registrarNoAtendimento(admin, {
            waId: r.wa_id,
            origemId,
            nome: entrada.contato.nome || entrada.nomeEmpresa,
            texto: renderizarCorpo(template.corpo_texto, template.variaveis, valores),
            wamid: r.wamid,
        })
        await admin.from("feedback_solicitacoes").update({ conversa_id: conversaId }).eq("id", sol.id)
        return { ok: true, solicitacaoId: sol.id, wamid: r.wamid, conversaId }
    } catch (e) {
        console.error("[feedback-solicitacao] Enviado, mas falhou ao registrar no Atendimento:", e)
        return { ok: true, solicitacaoId: sol.id, wamid: r.wamid, conversaId: null, avisoAtendimento: "Enviado, mas não foi possível registrar a mensagem no Atendimento." }
    }
}
