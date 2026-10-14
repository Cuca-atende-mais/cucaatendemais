import { NextRequest, NextResponse } from "next/server"
import { createAdminClient as createClient } from "@/lib/supabase/admin"
import { responderPedido, sinalizarEmAnalise } from "@/lib/empregabilidade/feedback-retorno-servico"
import { lerResposta } from "@/lib/empregabilidade/feedback-retorno"

/**
 * TASK 2.5.5: Submissão do Formulário de Feedback
 * POST /api/empregabilidade/vagas/feedback-submit
 * S-EMP-GES-03: token de pedido (feedback_solicitacoes) → { token, isBypass } ou { token, nenhum } ou
 * { token, selecionados: [...] }. Token antigo (vagas_feedback_tokens) segue o caminho de antes.
 */
export async function POST(request: NextRequest) {
    const supabaseAdmin = createClient()

    try {
        const body = await request.json()
        const { token, isBypass, evaluations } = body

        if (!token || typeof token !== "string") {
            return NextResponse.json({ error: "Token ausente." }, { status: 400 })
        }

        if (isBypass === true) {
            const r = await sinalizarEmAnalise(supabaseAdmin, token)
            if (r) return r.ok ? NextResponse.json({ success: true, ...r.dados }) : NextResponse.json({ error: r.erro }, { status: r.status })
        } else {
            const lida = lerResposta(body)
            const r = lida.ok ? await responderPedido(supabaseAdmin, token, lida.resposta) : await sinalizarSeForPedido(supabaseAdmin, token, lida.erro)
            if (r) return r.ok ? NextResponse.json({ success: true, ...r.dados }) : NextResponse.json({ error: r.erro }, { status: r.status })
        }

        // 1. Validar e buscar vaga_id do token
        const { data: tokenData, error: tokenErr } = await supabaseAdmin
            .from("vagas_feedback_tokens")
            .select("vaga_id, used, expires_at")
            .eq("token", token)
            .single()

        if (tokenErr || !tokenData) {
            return NextResponse.json({ error: "Token inválido." }, { status: 404 })
        }

        if (tokenData.used) {
            return NextResponse.json({ error: "Este link já foi utilizado." }, { status: 400 })
        }

        if (new Date(tokenData.expires_at) < new Date()) {
            return NextResponse.json({ error: "Este link expirou." }, { status: 400 })
        }

        // 2. Processar Lógica de Bypass vs Avaliação
        if (!isBypass && evaluations && Array.isArray(evaluations)) {
            // Atualizar candidatos em lote (usando Promise.all para simplicidade aqui)
            const updates = evaluations.map(async (evalItem: any) => {
                if (!evalItem.id || evalItem.status === 'pendente') return

                const updateData: any = {
                    status: evalItem.status, // 'aprovado_empresa' ou 'rejeitado'
                }

                if (evalItem.status === 'aprovado_empresa') {
                    updateData.data_entrevista = evalItem.data_entrevista || null
                    updateData.hora_entrevista = evalItem.hora_entrevista || null
                    updateData.local_entrevista = evalItem.local_entrevista || null
                }

                return supabaseAdmin
                    .from("candidaturas")
                    .update(updateData)
                    .eq("id", evalItem.id)
                    .eq("vaga_id", tokenData.vaga_id) // Segurança extra
            })

            await Promise.all(updates)
        }

        // 3. Invalida o token (Marca como usado)
        const { error: updateTokenErr } = await supabaseAdmin
            .from("vagas_feedback_tokens")
            .update({ used: true })
            .eq("token", token)

        if (updateTokenErr) throw updateTokenErr

        // S-EMP-GES-03 (AC6): a confirmação por template saiu — mandava parâmetros que não batiam com o
        // corpo do template aprovado. Depois do envio nada é mandado à empresa.

        return NextResponse.json({ success: true })
    } catch (err: any) {
        console.error("[feedback-submit] Erro:", err)
        return NextResponse.json({ error: err.message || "Erro interno" }, { status: 500 })
    }
}

// Corpo inválido: se o token é de um pedido, responde o erro de validação; se é antigo, segue o caminho de antes.
async function sinalizarSeForPedido(admin: ReturnType<typeof createClient>, token: string, erro: string) {
    const { data } = await admin.from("feedback_solicitacoes").select("id").eq("token", token).maybeSingle()
    return data ? { ok: false as const, status: 400, erro } : null
}
