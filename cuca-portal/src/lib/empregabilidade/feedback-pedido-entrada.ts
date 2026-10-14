import type { SupabaseClient } from "@supabase/supabase-js"
import { ehStatusEditavel } from "./status-candidatura"
import { telefoneDestino } from "./feedback-solicitacao"
import type { EntradaPedido } from "./feedback-solicitacao-servico"

// S-EMP-GES-02/03: monta o pedido de feedback com o cliente do USUÁRIO (RLS) — só vaga e candidaturas
// que ele enxerga, mesma regra de unidade da tela. Usado no envio (GES-02) e no reenviar (GES-03).

export type EntradaPreparada = { ok: true; entrada: EntradaPedido } | { ok: false; status: number; erro: string }

export async function montarEntradaPedido(
    supabase: SupabaseClient,
    p: { vagaId: string; candidaturaIds: string[]; criadoPor: string; urlBase: string },
): Promise<EntradaPreparada> {
    const { data: vaga, error: vErr } = await supabase
        .from("vagas")
        .select("id, tipo, titulo, empresa_id, nome_responsavel, telefone_responsavel, email_responsavel, empresas(nome, nome_fantasia, telefone, email, contato_responsavel)")
        .eq("id", p.vagaId)
        .maybeSingle()
    if (vErr) return { ok: false, status: 500, erro: "Erro ao carregar a vaga." }
    if (!vaga) return { ok: false, status: 404, erro: "Vaga não encontrada ou sem acesso." }
    if (vaga.tipo === "selecao_evento") return { ok: false, status: 400, erro: "Seleção não usa este pedido de feedback." }

    const { data: cands, error: cErr } = await supabase
        .from("candidaturas")
        .select("id, status, email_enviado_em")
        .eq("vaga_id", p.vagaId)
        .in("id", p.candidaturaIds)
    if (cErr) return { ok: false, status: 500, erro: "Erro ao conferir os candidatos." }
    const validos = new Set((cands ?? []).filter(c => c.email_enviado_em && ehStatusEditavel(c.status)).map(c => c.id as string))
    const invalidos = p.candidaturaIds.filter(id => !validos.has(id))
    if (invalidos.length > 0) {
        return { ok: false, status: 400, erro: `${invalidos.length} candidato(s) marcado(s) não foram enviados à empresa nesta vaga ou não podem receber feedback.` }
    }

    const empresa = (Array.isArray(vaga.empresas) ? vaga.empresas[0] : vaga.empresas) as
        { nome: string | null; nome_fantasia: string | null; telefone: string | null; email: string | null; contato_responsavel: string | null } | null
    // Mesmo contato que a tela mostra: o da vaga e, na falta, o da empresa.
    const telefone = vaga.telefone_responsavel || empresa?.telefone || ""
    const numero = telefoneDestino(telefone)
    if (!numero) {
        return { ok: false, status: 400, erro: "A vaga não tem um telefone de contato válido. Ajuste o contato antes de enviar." }
    }

    return {
        ok: true,
        entrada: {
            vagaId: p.vagaId,
            empresaId: vaga.empresa_id,
            candidaturaIds: p.candidaturaIds,
            contato: {
                nome: vaga.nome_responsavel || empresa?.contato_responsavel || null,
                telefone,
                email: vaga.email_responsavel || empresa?.email || null,
            },
            numeroDestino: numero,
            nomeEmpresa: empresa?.nome_fantasia || empresa?.nome || "",
            tituloVaga: vaga.titulo || "",
            urlBase: p.urlBase,
            criadoPor: p.criadoPor,
        },
    }
}
