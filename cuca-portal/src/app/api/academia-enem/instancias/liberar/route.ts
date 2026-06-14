import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

async function checkAuth(recurso: string, acao: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: "Não autenticado", status: 401 as const }
    const { data: ok } = await supabase.rpc("has_permission", { p_recurso: recurso, p_acao: acao })
    if (!ok) return { error: "Sem permissão", status: 403 as const }
    return { error: null }
}

// POST { workspace_id } → LIBERA (para de usar) localmente: ativa=false.
// NÃO chama DELETE /connection (isso desconectaria o número na Meta) — gestão do número é da AuctaFlux.
// O forward_to_url permanece apontado para nós; apenas paramos de processar localmente.
export async function POST(req: NextRequest) {
    try {
        const gate = await checkAuth("ae_instancia", "update")
        if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status })

        const { workspace_id } = await req.json() as { workspace_id?: string }
        if (!workspace_id) return NextResponse.json({ error: "workspace_id obrigatório" }, { status: 400 })

        const admin = createAdminClient()
        const { error } = await admin
            .from("ae_instancias")
            .update({ ativa: false, updated_at: new Date().toISOString() })
            .eq("workspace_id", workspace_id)
        if (error) throw error

        return NextResponse.json({ ok: true, workspace_id, ativa: false })
    } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro interno"
        console.error("[academia-enem/instancias/liberar POST]", e)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
