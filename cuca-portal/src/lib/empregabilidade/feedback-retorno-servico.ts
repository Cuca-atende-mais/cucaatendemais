import type { SupabaseClient } from "@supabase/supabase-js"
import { aplicarStatusCandidatura } from "./aplicar-status-candidatura"
import {
    MENSAGEM_LINK_INATIVO,
    avaliavelPelaEmpresa,
    decidirStatus,
    estadoLink,
    type RespostaEmpresa,
} from "./feedback-retorno"

// S-EMP-GES-03: a página pública da empresa com o token do pedido (feedback_solicitacoes). Recebe o
// cliente admin (service_role): a página não tem login, o token é a única credencial. Toda leitura e
// escrita é filtrada pelo pedido do token — nunca por um id vindo do corpo sem essa checagem (AC11).

interface PedidoToken {
    id: string
    vaga_id: string
    tipo: string
    status_envio: string
    expires_at: string | null
    respondido_em: string | null
    situacao: string | null
}

export type ResultadoPublico<T> = { ok: true; dados: T } | { ok: false; status: number; erro: string }

async function pedidoDoToken(admin: SupabaseClient, token: string): Promise<PedidoToken | null> {
    const { data, error } = await admin
        .from("feedback_solicitacoes")
        .select("id, vaga_id, tipo, status_envio, expires_at, respondido_em, situacao")
        .eq("token", token)
        .maybeSingle<PedidoToken>()
    if (error) throw error
    return data && data.tipo === "vaga" ? data : null
}

/** Itens do pedido que a empresa ainda pode avaliar, só com id e nome (AC1, AC11). */
async function candidatosAvaliaveis(admin: SupabaseClient, pedido: PedidoToken): Promise<{ id: string; nome: string }[]> {
    const { data: itens, error } = await admin
        .from("feedback_solicitacao_itens")
        .select("candidatura_id")
        .eq("solicitacao_id", pedido.id)
    if (error) throw error
    const ids = (itens ?? []).map(i => i.candidatura_id as string)
    if (ids.length === 0) return []
    const { data: cands, error: cErr } = await admin
        .from("candidaturas")
        .select("id, nome, status")
        .eq("vaga_id", pedido.vaga_id)
        .in("id", ids)
    if (cErr) throw cErr
    return (cands ?? [])
        .filter(c => avaliavelPelaEmpresa(c.status))
        .map(c => ({ id: c.id as string, nome: (c.nome as string | null) || "Sem nome" }))
        .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"))
}

function linkInativo(pedido: PedidoToken): ResultadoPublico<never> | null {
    const estado = estadoLink(pedido)
    return estado === "ativo" ? null : { ok: false, status: 410, erro: MENSAGEM_LINK_INATIVO[estado] }
}

/** `null` quando o token não é de nenhum pedido (link inválido). */
export async function carregarPedidoPublico(
    admin: SupabaseClient,
    token: string,
): Promise<ResultadoPublico<{ vaga: { titulo: string | null; empresa: string | null }; candidatos: { id: string; nome: string }[] }> | null> {
    const pedido = await pedidoDoToken(admin, token)
    if (!pedido) return null
    const inativo = linkInativo(pedido)
    if (inativo) return inativo

    const { data: vaga, error } = await admin
        .from("vagas")
        .select("titulo, empresas(nome, nome_fantasia)")
        .eq("id", pedido.vaga_id)
        .maybeSingle()
    if (error) throw error
    const emp = (Array.isArray(vaga?.empresas) ? vaga?.empresas[0] : vaga?.empresas) as { nome: string | null; nome_fantasia: string | null } | null
    return {
        ok: true,
        dados: {
            vaga: { titulo: (vaga?.titulo as string | null) ?? null, empresa: emp?.nome_fantasia || emp?.nome || null },
            candidatos: await candidatosAvaliaveis(admin, pedido),
        },
    }
}

/**
 * Encerra o link uma vez só: a atualização só pega se o pedido ainda estiver sem resposta, sem
 * situação e no prazo. Dois envios ao mesmo tempo → só o primeiro passa.
 */
async function reservarPedido(admin: SupabaseClient, pedido: PedidoToken, campos: Record<string, unknown>, agora: Date): Promise<boolean> {
    const { data, error } = await admin
        .from("feedback_solicitacoes")
        .update(campos)
        .eq("id", pedido.id)
        .is("respondido_em", null)
        .is("situacao", null)
        .gt("expires_at", agora.toISOString())
        .select("id")
    if (error) throw error
    return (data ?? []).length === 1
}

/** "Ainda em análise" (AC7): não muda candidato nenhum e encerra o link. */
export async function sinalizarEmAnalise(admin: SupabaseClient, token: string, agora: Date = new Date()): Promise<ResultadoPublico<{ situacao: "em_analise" }> | null> {
    const pedido = await pedidoDoToken(admin, token)
    if (!pedido) return null
    const inativo = linkInativo(pedido)
    if (inativo) return inativo
    const ok = await reservarPedido(admin, pedido, { situacao: "em_analise", situacao_em: agora.toISOString() }, agora)
    if (!ok) return { ok: false, status: 410, erro: MENSAGEM_LINK_INATIVO.respondido }
    return { ok: true, dados: { situacao: "em_analise" } }
}

/**
 * Resposta da empresa (AC2, AC3, AC5): marcados → selecionado, demais do pedido → rejeitado (com o Banco
 * de Talentos pela regra da tela interna). Nenhuma mensagem é enviada à empresa.
 */
export async function responderPedido(
    admin: SupabaseClient,
    token: string,
    resposta: RespostaEmpresa,
    agora: Date = new Date(),
): Promise<ResultadoPublico<{ selecionados: number; rejeitados: number; falhas: number }> | null> {
    const pedido = await pedidoDoToken(admin, token)
    if (!pedido) return null
    const inativo = linkInativo(pedido)
    if (inativo) return inativo

    const candidatos = await candidatosAvaliaveis(admin, pedido)
    const decisao = decidirStatus(candidatos.map(c => c.id), resposta)
    if (!decisao.ok) return { ok: false, status: 400, erro: decisao.erro }

    if (!(await reservarPedido(admin, pedido, { respondido_em: agora.toISOString() }, agora))) {
        return { ok: false, status: 410, erro: MENSAGEM_LINK_INATIVO.respondido }
    }

    // A resposta da empresa é gravada antes de aplicar o status: se a aplicação falhar num candidato,
    // a decisão dela não se perde (fica a diferença visível entre resposta_status e o status atual).
    for (const [candidaturaId, status] of decisao.decisao) {
        const { error } = await admin
            .from("feedback_solicitacao_itens")
            .update({ resposta_status: status })
            .eq("solicitacao_id", pedido.id)
            .eq("candidatura_id", candidaturaId)
        if (error) console.error(`[feedback-retorno] Falha ao registrar a resposta de ${candidaturaId}:`, error)
    }

    let selecionados = 0
    let rejeitados = 0
    let falhas = 0
    for (const [candidaturaId, status] of decisao.decisao) {
        const r = await aplicarStatusCandidatura(admin, candidaturaId, status)
        if (!r.ok) {
            falhas += 1
            console.error(`[feedback-retorno] Falha ao aplicar ${status} em ${candidaturaId}: ${r.erro}`)
            continue
        }
        if (status === "selecionado") selecionados += 1
        else rejeitados += 1
    }
    return { ok: true, dados: { selecionados, rejeitados, falhas } }
}
