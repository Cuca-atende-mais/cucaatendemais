import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { responderPedido, sinalizarEmAnalise } from "@/lib/empregabilidade/feedback-retorno-servico"
import { lerResposta } from "@/lib/empregabilidade/feedback-retorno"

/**
 * POST /api/empregabilidade/vagas/feedback-submit
 * Público (sem login), pelo token do pedido de feedback (S-EMP-GES-03). Corpo:
 * { token, isBypass: true } ("Ainda em análise"), { token, nenhum: true } ou { token, selecionados: [...] }.
 * Depois do envio nada é mandado à empresa.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => null)
        const token = body?.token
        if (!token || typeof token !== "string") {
            return NextResponse.json({ error: "Token ausente." }, { status: 400 })
        }

        const admin = createAdminClient()
        let r
        if (body.isBypass === true) {
            r = await sinalizarEmAnalise(admin, token)
        } else {
            const lida = lerResposta(body)
            if (!lida.ok) return NextResponse.json({ error: lida.erro }, { status: 400 })
            r = await responderPedido(admin, token, lida.resposta)
        }
        if (!r) return NextResponse.json({ error: "Link inválido." }, { status: 404 })
        return r.ok ? NextResponse.json({ success: true, ...r.dados }) : NextResponse.json({ error: r.erro }, { status: r.status })
    } catch (err) {
        console.error("[feedback-submit] Erro:", err)
        return NextResponse.json({ error: "Erro interno." }, { status: 500 })
    }
}
