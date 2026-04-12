import { NextRequest, NextResponse } from "next/server"
import { createAdminClient as createClient } from "@/lib/supabase/admin"

/**
 * GET /api/empregabilidade/vagas/feedback-token/[token]
 * Valida token de feedback e retorna dados da vaga + candidatos usando admin client.
 * Público (sem auth), mas protegido pelo UUID do token.
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ token: string }> }
) {
    const { token } = await params
    const supabase = createClient()

    try {
        // 1. Validar token
        const { data: tokenData, error: tokenErr } = await supabase
            .from("vagas_feedback_tokens")
            .select(`
                vaga_id,
                expires_at,
                used,
                cuca_unit_id,
                vagas (
                    id,
                    titulo,
                    empresas (nome)
                )
            `)
            .eq("token", token)
            .single()

        if (tokenErr || !tokenData) {
            return NextResponse.json({ error: "Link inválido ou expirado." }, { status: 404 })
        }

        if (tokenData.used) {
            return NextResponse.json({ error: "Este link já foi utilizado." }, { status: 410 })
        }

        if (new Date(tokenData.expires_at) < new Date()) {
            return NextResponse.json({ error: "Este link expirou. Por favor, solicite um novo." }, { status: 410 })
        }

        const vacancy = tokenData.vagas as any
        const unitId = tokenData.cuca_unit_id || null

        // 2. Buscar candidatos da vaga (todos pendentes/selecionados — unidade é exibida no header apenas)
        const { data: candData, error: candErr } = await supabase
            .from("candidaturas")
            .select("id, nome, status")
            .eq("vaga_id", vacancy.id)
            .in("status", ["pendente", "selecionado"])
        if (candErr) throw candErr

        return NextResponse.json({
            vaga: vacancy,
            candidates: candData || [],
            cuca_unit_id: unitId,
        })
    } catch (err: any) {
        console.error("[feedback-token] Erro:", err)
        return NextResponse.json({ error: err.message || "Erro interno" }, { status: 500 })
    }
}
