import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { exigirPermissao } from "@/lib/rbac/exigir-permissao-servidor"
import { EPM_FEEDBACK } from "@/lib/rbac/catalogo-empregabilidade-gestao"
import { enviarPedidoFeedback } from "@/lib/empregabilidade/feedback-solicitacao-servico"
import { montarEntradaPedido } from "@/lib/empregabilidade/feedback-pedido-entrada"
import { enviarPeloWorker } from "@/lib/empregabilidade/enviar-template-worker"

// S-EMP-GES-02 (AC2, AC3, AC7, AC11): "Solicitar feedback dos marcados" — cria 1 solicitação só com os
// candidatos marcados, envia o template aprovado com o link e grava a mensagem no Atendimento.
// Resposta honesta: só devolve sucesso quando a Meta aceitou e existe wamid.

const MAX_POR_PEDIDO = 500
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
    const permissao = await exigirPermissao(EPM_FEEDBACK.solicitar)
    if (!permissao.ok) return permissao.resposta

    const body = await request.json().catch(() => ({}))
    const vagaId: unknown = body?.vaga_id
    const ids: unknown = body?.candidatura_ids
    if (typeof vagaId !== "string" || !UUID_RE.test(vagaId)) {
        return NextResponse.json({ error: "Vaga inválida." }, { status: 400 })
    }
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every(i => typeof i === "string" && UUID_RE.test(i))) {
        return NextResponse.json({ error: "Marque ao menos um candidato." }, { status: 400 })
    }
    const unicos = Array.from(new Set(ids as string[]))
    if (unicos.length > MAX_POR_PEDIDO) {
        return NextResponse.json({ error: `Máximo de ${MAX_POR_PEDIDO} candidatos por pedido.` }, { status: 400 })
    }

    const preparado = await montarEntradaPedido(permissao.supabase, {
        vagaId,
        candidaturaIds: unicos,
        criadoPor: permissao.user.id,
        urlBase: process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin,
    })
    if (!preparado.ok) return NextResponse.json({ error: preparado.erro }, { status: preparado.status })

    try {
        const r = await enviarPedidoFeedback(createAdminClient(), preparado.entrada, enviarPeloWorker)
        if (!r.ok) return NextResponse.json({ error: r.erro, solicitacao_id: r.solicitacaoId ?? null }, { status: r.status })
        return NextResponse.json({
            ok: true,
            solicitacao_id: r.solicitacaoId,
            conversa_id: r.conversaId,
            aviso: r.avisoAtendimento ?? null,
        })
    } catch (e) {
        console.error("[feedback/solicitacoes] Erro:", e)
        return NextResponse.json({ error: "Erro ao criar a solicitação de feedback." }, { status: 500 })
    }
}

// S-EMP-GES-02 (AC4) + GES-03 (respondido, em análise, substituído): acompanhamento dos pedidos da vaga, do mais novo ao mais antigo. Nunca devolve o token.
export async function GET(request: NextRequest) {
    const permissao = await exigirPermissao(EPM_FEEDBACK.ver)
    if (!permissao.ok) return permissao.resposta

    const vagaId = request.nextUrl.searchParams.get("vaga")
    if (!vagaId || !UUID_RE.test(vagaId)) return NextResponse.json({ error: "Vaga inválida." }, { status: 400 })

    const { data: vaga, error: vErr } = await permissao.supabase.from("vagas").select("id").eq("id", vagaId).maybeSingle()
    if (vErr) return NextResponse.json({ error: "Erro ao carregar a vaga." }, { status: 500 })
    if (!vaga) return NextResponse.json({ error: "Vaga não encontrada ou sem acesso." }, { status: 404 })

    const admin = createAdminClient()
    const { data, error } = await admin
        .from("feedback_solicitacoes")
        .select("id, created_at, criado_por, status_envio, erro_envio, expires_at, respondido_em, situacao, situacao_em, conversa_id, feedback_solicitacao_itens(count)")
        .eq("vaga_id", vagaId)
        .order("created_at", { ascending: false })
        .limit(100)
    if (error) return NextResponse.json({ error: "Erro ao carregar o acompanhamento." }, { status: 500 })

    const autores = Array.from(new Set((data ?? []).map(s => s.criado_por).filter((x): x is string => !!x)))
    const nomes = new Map<string, string>()
    if (autores.length > 0) {
        const { data: cols } = await admin.from("colaboradores").select("user_id, nome_completo").in("user_id", autores)
        for (const c of cols ?? []) if (c.user_id && c.nome_completo) nomes.set(c.user_id, c.nome_completo)
    }

    const solicitacoes = (data ?? []).map(s => {
        const itens = s.feedback_solicitacao_itens as unknown as { count: number }[] | null
        return {
            id: s.id,
            created_at: s.created_at,
            enviado_por: (s.criado_por && nomes.get(s.criado_por)) || null,
            candidatos: itens?.[0]?.count ?? 0,
            status_envio: s.status_envio,
            erro_envio: s.erro_envio,
            expires_at: s.expires_at,
            respondido_em: s.respondido_em,
            situacao: s.situacao,
            situacao_em: s.situacao_em,
            conversa_id: s.conversa_id,
        }
    })
    return NextResponse.json({ solicitacoes })
}
