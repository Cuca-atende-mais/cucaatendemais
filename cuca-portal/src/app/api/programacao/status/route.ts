import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// SQS-44: PATCH /api/programacao/status — altera status de uma campanha mensal
// Status permitidos: rascunho ↔ pendente (aprovado é gerenciado pela rota de aprovação existente)
const STATUS_PERMITIDOS = ["rascunho", "pendente"] as const

export async function PATCH(req: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authErr } = await supabase.auth.getUser()

        if (authErr || !user) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
        }

        const { data: permOk } = await supabase
            .rpc("has_permission", { p_recurso: "programacao_mensal", p_acao: "update" })

        if (!permOk) {
            return NextResponse.json({ error: "Sem permissão para alterar status da programação" }, { status: 403 })
        }

        const body = await req.json()
        const { campanha_id, status } = body as { campanha_id: string; status: string }

        if (!campanha_id || !status) {
            return NextResponse.json({ error: "campanha_id e status são obrigatórios" }, { status: 400 })
        }

        if (!STATUS_PERMITIDOS.includes(status as any)) {
            return NextResponse.json({ error: `Status inválido. Permitidos: ${STATUS_PERMITIDOS.join(", ")}` }, { status: 400 })
        }

        const { error: updateErr } = await supabase
            .from("campanhas_mensais")
            .update({ status })
            .eq("id", campanha_id)

        if (updateErr) throw new Error(updateErr.message)

        return NextResponse.json({ ok: true })

    } catch (e: any) {
        console.error("[programacao/status]", e)
        return NextResponse.json({ error: e.message || "Erro interno" }, { status: 500 })
    }
}
