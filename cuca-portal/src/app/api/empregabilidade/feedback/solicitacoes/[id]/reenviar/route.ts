import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { exigirPermissao } from "@/lib/rbac/exigir-permissao-servidor"
import { EPM_FEEDBACK } from "@/lib/rbac/catalogo-empregabilidade-gestao"
import { enviarPedidoFeedback } from "@/lib/empregabilidade/feedback-solicitacao-servico"
import { montarEntradaPedido } from "@/lib/empregabilidade/feedback-pedido-entrada"
import { enviarPeloWorker } from "@/lib/empregabilidade/enviar-template-worker"
import { avaliavelPelaEmpresa, podeReenviar } from "@/lib/empregabilidade/feedback-retorno"

// S-EMP-GES-03 (AC8, AC12): reenviar um pedido sem resposta, expirado, com falha ou "em análise".
// Gera um pedido novo com os mesmos candidatos (os que ainda aguardam retorno) e marca o antigo como
// substituído — o link antigo deixa de valer.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const permissao = await exigirPermissao(EPM_FEEDBACK.reenviar)
    if (!permissao.ok) return permissao.resposta

    const { id } = await params
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 })

    const admin = createAdminClient()
    const { data: antigo, error } = await admin
        .from("feedback_solicitacoes")
        .select("id, vaga_id, tipo, status_envio, expires_at, respondido_em, situacao, situacao_em")
        .eq("id", id)
        .maybeSingle()
    if (error) return NextResponse.json({ error: "Erro ao carregar o pedido." }, { status: 500 })
    if (!antigo || antigo.tipo !== "vaga") return NextResponse.json({ error: "Pedido não encontrado." }, { status: 404 })
    if (!podeReenviar(antigo)) return NextResponse.json({ error: "Este pedido já foi respondido ou substituído." }, { status: 409 })

    const { data: itens, error: iErr } = await admin
        .from("feedback_solicitacao_itens")
        .select("candidatura_id")
        .eq("solicitacao_id", id)
    if (iErr) return NextResponse.json({ error: "Erro ao carregar os candidatos do pedido." }, { status: 500 })

    // Unidade: só candidatos que o usuário enxerga; e só quem ainda aguarda o retorno da empresa.
    const { data: cands, error: cErr } = await permissao.supabase
        .from("candidaturas")
        .select("id, status")
        .eq("vaga_id", antigo.vaga_id)
        .in("id", (itens ?? []).map(i => i.candidatura_id as string))
    if (cErr) return NextResponse.json({ error: "Erro ao conferir os candidatos." }, { status: 500 })
    const candidaturaIds = (cands ?? []).filter(c => avaliavelPelaEmpresa(c.status)).map(c => c.id as string)
    if (candidaturaIds.length === 0) {
        return NextResponse.json({ error: "Nenhum candidato deste pedido ainda aguarda o retorno da empresa." }, { status: 400 })
    }

    const preparado = await montarEntradaPedido(permissao.supabase, {
        vagaId: antigo.vaga_id,
        candidaturaIds,
        criadoPor: permissao.user.id,
        urlBase: process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin,
    })
    if (!preparado.ok) return NextResponse.json({ error: preparado.erro }, { status: preparado.status })

    // Reserva o antigo antes de enviar: dois cliques ao mesmo tempo não geram dois pedidos novos.
    const agora = new Date().toISOString()
    const { data: reservado, error: rErr } = await admin
        .from("feedback_solicitacoes")
        .update({ situacao: "substituida", situacao_em: agora })
        .eq("id", id)
        .is("respondido_em", null)
        .or("situacao.is.null,situacao.eq.em_analise")
        .select("id")
    if (rErr) return NextResponse.json({ error: "Erro ao reenviar." }, { status: 500 })
    if ((reservado ?? []).length !== 1) return NextResponse.json({ error: "Este pedido já foi respondido ou substituído." }, { status: 409 })

    const desfazer = () => admin
        .from("feedback_solicitacoes")
        .update({ situacao: antigo.situacao, situacao_em: antigo.situacao_em })
        .eq("id", id)

    try {
        const r = await enviarPedidoFeedback(admin, preparado.entrada, enviarPeloWorker)
        if (!r.solicitacaoId) {
            await desfazer()
            return NextResponse.json({ error: r.ok ? "Erro ao reenviar." : r.erro }, { status: r.ok ? 500 : r.status })
        }
        await admin.from("feedback_solicitacoes").update({ substituida_por: r.solicitacaoId }).eq("id", id)
        if (!r.ok) return NextResponse.json({ error: r.erro, solicitacao_id: r.solicitacaoId }, { status: r.status })
        return NextResponse.json({ ok: true, solicitacao_id: r.solicitacaoId, conversa_id: r.conversaId, aviso: r.avisoAtendimento ?? null })
    } catch (e) {
        console.error("[feedback/reenviar] Erro:", e)
        await desfazer()
        return NextResponse.json({ error: "Erro ao reenviar." }, { status: 500 })
    }
}
