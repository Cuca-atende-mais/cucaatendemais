import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { exigirPermissao } from "@/lib/rbac/exigir-permissao-servidor"
import { EPM_FEEDBACK } from "@/lib/rbac/catalogo-empregabilidade-gestao"
import { ehStatusEditavel } from "@/lib/empregabilidade/status-candidatura"
import { telefoneDestino } from "@/lib/empregabilidade/feedback-solicitacao"
import { enviarPedidoFeedback, type EnviarTemplate } from "@/lib/empregabilidade/feedback-solicitacao-servico"

// S-EMP-GES-02 (AC2, AC3, AC7, AC11): "Solicitar feedback dos marcados" — cria 1 solicitação só com os
// candidatos marcados, envia o template aprovado com o link e grava a mensagem no Atendimento.
// Resposta honesta: só devolve sucesso quando a Meta aceitou e existe wamid.

const MAX_POR_PEDIDO = 500
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const enviarPeloWorker: EnviarTemplate = async (numero, template, componentes) => {
    const workerUrl = process.env.WORKER_URL || "http://127.0.0.1:8000"
    const token = process.env.WEBHOOK_INTERNAL_TOKEN
    if (!token) return { ok: false, erro: "Integração com o worker não configurada (WEBHOOK_INTERNAL_TOKEN)." }
    try {
        const res = await fetch(`${workerUrl}/send-message/${token}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ number: numero, template_name: template, components: componentes }),
        })
        const corpo = await res.json().catch(() => ({}))
        if (!res.ok) return { ok: false, erro: corpo?.error || `Worker respondeu ${res.status}.` }
        return { ok: true, wamid: corpo?.wamid ?? null, wa_id: corpo?.wa_id ?? null, origem_id: corpo?.origem_id ?? null }
    } catch (e) {
        console.error("[feedback/solicitacoes] Erro ao chamar o worker:", e)
        return { ok: false, erro: "Não foi possível falar com o worker." }
    }
}

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

    // Mesma regra de unidade da tela: só vaga e candidaturas que o usuário enxerga pela RLS.
    const { data: vaga, error: vErr } = await permissao.supabase
        .from("vagas")
        .select("id, tipo, titulo, empresa_id, nome_responsavel, telefone_responsavel, email_responsavel, empresas(nome, nome_fantasia, telefone, email, contato_responsavel)")
        .eq("id", vagaId)
        .maybeSingle()
    if (vErr) return NextResponse.json({ error: "Erro ao carregar a vaga." }, { status: 500 })
    if (!vaga) return NextResponse.json({ error: "Vaga não encontrada ou sem acesso." }, { status: 404 })
    if (vaga.tipo === "selecao_evento") {
        return NextResponse.json({ error: "Seleção não usa este pedido de feedback." }, { status: 400 })
    }

    const { data: cands, error: cErr } = await permissao.supabase
        .from("candidaturas")
        .select("id, status, email_enviado_em")
        .eq("vaga_id", vagaId)
        .in("id", unicos)
    if (cErr) return NextResponse.json({ error: "Erro ao conferir os candidatos." }, { status: 500 })
    const validos = new Set((cands ?? []).filter(c => c.email_enviado_em && ehStatusEditavel(c.status)).map(c => c.id as string))
    const invalidos = unicos.filter(id => !validos.has(id))
    if (invalidos.length > 0) {
        return NextResponse.json({ error: `${invalidos.length} candidato(s) marcado(s) não foram enviados à empresa nesta vaga ou não podem receber feedback.` }, { status: 400 })
    }

    const empresa = (Array.isArray(vaga.empresas) ? vaga.empresas[0] : vaga.empresas) as
        { nome: string | null; nome_fantasia: string | null; telefone: string | null; email: string | null; contato_responsavel: string | null } | null
    // Mesmo contato que a tela mostra: o da vaga e, na falta, o da empresa.
    const telefone = vaga.telefone_responsavel || empresa?.telefone || ""
    const numero = telefoneDestino(telefone)
    if (!numero) {
        return NextResponse.json({ error: "A vaga não tem um telefone de contato válido. Ajuste o contato antes de enviar." }, { status: 400 })
    }

    const urlBase = process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin
    try {
        const r = await enviarPedidoFeedback(createAdminClient(), {
            vagaId,
            empresaId: vaga.empresa_id,
            candidaturaIds: unicos,
            contato: {
                nome: vaga.nome_responsavel || empresa?.contato_responsavel || null,
                telefone,
                email: vaga.email_responsavel || empresa?.email || null,
            },
            numeroDestino: numero,
            nomeEmpresa: empresa?.nome_fantasia || empresa?.nome || "",
            tituloVaga: vaga.titulo || "",
            urlBase,
            criadoPor: permissao.user.id,
        }, enviarPeloWorker)
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

// S-EMP-GES-02 (AC4): acompanhamento dos pedidos da vaga, do mais novo ao mais antigo. Nunca devolve o token.
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
        .select("id, created_at, criado_por, status_envio, erro_envio, expires_at, respondido_em, conversa_id, feedback_solicitacao_itens(count)")
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
            conversa_id: s.conversa_id,
        }
    })
    return NextResponse.json({ solicitacoes })
}
