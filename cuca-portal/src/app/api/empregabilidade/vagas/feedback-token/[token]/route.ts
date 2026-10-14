import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { carregarPedidoPublico } from "@/lib/empregabilidade/feedback-retorno-servico"

/**
 * GET /api/empregabilidade/vagas/feedback-token/[token]
 * Público (sem login): o token do pedido de feedback é a única credencial.
 * S-EMP-GES-03: só tokens de pedido (feedback_solicitacoes); devolve a vaga e os candidatos do pedido, só com o nome.
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ token: string }> }
) {
    const { token } = await params
    try {
        const pedido = await carregarPedidoPublico(createAdminClient(), token)
        if (!pedido) return NextResponse.json({ error: "Link inválido." }, { status: 404 })
        if (!pedido.ok) return NextResponse.json({ error: pedido.erro }, { status: pedido.status })
        return NextResponse.json({ vaga: pedido.dados.vaga, candidates: pedido.dados.candidatos })
    } catch (err) {
        console.error("[feedback-token] Erro:", err)
        return NextResponse.json({ error: "Erro interno." }, { status: 500 })
    }
}
