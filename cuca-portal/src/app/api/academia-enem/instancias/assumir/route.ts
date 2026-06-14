import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { setForwardUrl, rotateSecret, statusConexao, AuctaFluxError } from "@/lib/auctaflux/client"

async function checkAuth(recurso: string, acao: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: "Não autenticado", status: 401 as const }
    const { data: ok } = await supabase.rpc("has_permission", { p_recurso: recurso, p_acao: acao })
    if (!ok) return { error: "Sem permissão", status: 403 as const }
    return { error: null }
}

const NOSSO_WEBHOOK = process.env.APP_URL
    ? `${process.env.APP_URL.replace(/\/$/, "")}/api/academia-enem/webhook/auctaflux`
    : null

// POST { workspace_id } → ASSUME (toma posse) de uma instância da AuctaFlux para o módulo.
// Ordem segura (rotate-secret é irreversível e invalida o segredo anterior):
//   1) rotate-secret → 2) persistir forward_secret → 3) GET connection + persistir campos
//   → 4) PATCH forward_to_url (aponta o webhook para nós) por ÚLTIMO → 5) ativa=true.
// É idempotente/re-executável: re-assumir = novo rotate + re-persistência.
export async function POST(req: NextRequest) {
    try {
        const gate = await checkAuth("ae_instancia", "create")
        if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status })

        if (!NOSSO_WEBHOOK) {
            return NextResponse.json(
                { error: "APP_URL não configurada — não é possível definir o webhook (forward_to_url)." },
                { status: 500 },
            )
        }

        const { workspace_id } = await req.json() as { workspace_id?: string }
        if (!workspace_id) return NextResponse.json({ error: "workspace_id obrigatório" }, { status: 400 })

        const admin = createAdminClient()

        // 1) Gira o segredo HMAC (irrecuperável depois — guardar imediatamente).
        const { forward_secret } = await rotateSecret(workspace_id)

        // 2) Persiste o segredo já (antes de apontar o webhook para nós).
        const baseRow = {
            workspace_id,
            forward_secret,
            updated_at: new Date().toISOString(),
        }
        {
            const { error } = await admin
                .from("ae_instancias")
                .upsert(baseRow, { onConflict: "workspace_id" })
            if (error) throw error
        }

        // 3) Lê o status de conexão e persiste os campos do número.
        const conexao = await statusConexao(workspace_id)
        {
            const { error } = await admin
                .from("ae_instancias")
                .update({
                    display_name: conexao.display_name,
                    phone_number: conexao.phone_number,
                    phone_number_id: conexao.phone_number_id,
                    waba_id: conexao.waba_id,
                    status: conexao.status,
                    quality_rating: conexao.quality_rating,
                    messaging_limit_tier: conexao.messaging_limit_tier,
                    pending_reason: conexao.pending_reason,
                    updated_at: new Date().toISOString(),
                })
                .eq("workspace_id", workspace_id)
            if (error) throw error
        }

        // 4) Só agora aponta o webhook para nós (forward_to_url).
        await setForwardUrl(workspace_id, NOSSO_WEBHOOK)

        // 5) Marca como ativa no módulo.
        {
            const { error } = await admin
                .from("ae_instancias")
                .update({ ativa: true, updated_at: new Date().toISOString() })
                .eq("workspace_id", workspace_id)
            if (error) throw error
        }

        return NextResponse.json({ ok: true, workspace_id, status: conexao.status })
    } catch (e) {
        if (e instanceof AuctaFluxError) {
            const msg = e.status === 401
                ? "Credencial da AuctaFlux inválida/expirada (verifique AUCTAFLUX_RESELLER_API_KEY)"
                : `AuctaFlux: ${e.message}`
            return NextResponse.json({ error: msg }, { status: 502 })
        }
        const msg = e instanceof Error ? e.message : "Erro interno"
        console.error("[academia-enem/instancias/assumir POST]", e)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
