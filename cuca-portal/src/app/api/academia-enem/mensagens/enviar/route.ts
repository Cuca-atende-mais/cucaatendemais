import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { enviarTexto, AuctaFluxError } from "@/lib/auctaflux/client"
import { janelaAberta } from "@/lib/auctaflux/janela"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Permissão server-side via função canônica has_permission (mesmo padrão de instancias/assumir).
async function checkAuth(recurso: string, acao: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: "Não autenticado", status: 401 as const }
    const { data: ok } = await supabase.rpc("has_permission", { p_recurso: recurso, p_acao: acao })
    if (!ok) return { error: "Sem permissão", status: 403 as const }
    return { error: null }
}

// POST { conversa_id, text } → envia texto livre (AC#3) pela instância da conversa e grava em ae_mensagens.
// Texto livre exige janela de 24h aberta (AC#4); fora da janela, 422 (cliente orienta usar template).
export async function POST(req: NextRequest) {
    try {
        const gate = await checkAuth("atendimentos_academia_enem", "create")
        if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status })

        const { conversa_id, text } = (await req.json()) as { conversa_id?: string; text?: string }
        const conteudo = (text ?? "").trim()
        if (!conversa_id || !conteudo) {
            return NextResponse.json({ error: "conversa_id e text são obrigatórios" }, { status: 400 })
        }

        const admin = createAdminClient()

        // Conversa + instância (workspace_id para o provider). FK ae_conversa → ae_instancia.
        const { data: conv, error: convErr } = await admin
            .from("ae_conversas")
            .select("id, wa_contact, ultima_entrada_em, ae_instancias!inner ( workspace_id )")
            .eq("id", conversa_id)
            .maybeSingle()
        if (convErr) throw convErr
        if (!conv) return NextResponse.json({ error: "Conversa não encontrada" }, { status: 404 })

        // Re-validação server-side da janela de 24h (guard de compliance Meta — AC#4).
        if (!janelaAberta(conv.ultima_entrada_em as string | null)) {
            return NextResponse.json(
                { error: "Janela de 24h fechada. Use um template aprovado para reabrir a conversa." },
                { status: 422 },
            )
        }

        const instancia = Array.isArray(conv.ae_instancias) ? conv.ae_instancias[0] : conv.ae_instancias
        const workspaceId = (instancia as { workspace_id?: string } | null)?.workspace_id
        if (!workspaceId) return NextResponse.json({ error: "Instância sem workspace_id" }, { status: 409 })

        // Envia pelo provider (texto livre). Número não pareado (pending_signup) → AuctaFlux falha → 502.
        const resultado = await enviarTexto(workspaceId, conv.wa_contact as string, conteudo)

        // Persiste a mensagem enviada. remetente='atendente' (enum ae_mensagens: lead|atendente|ia|sistema).
        const { data: salva, error: insErr } = await admin
            .from("ae_mensagens")
            .insert({
                ae_conversa_id: conversa_id,
                wa_message_id: resultado.wamid,
                remetente: "atendente",
                tipo: "text",
                conteudo,
                status: resultado.status,
                metadata: { passthrough_id: resultado.passthrough_id },
            })
            .select()
            .maybeSingle()
        if (insErr) throw insErr

        // Agregados: atualiza só ultima_mensagem_em/updated_at. NÃO mexe em ultima_entrada_em (base da
        // janela = só inbound, AC#4) nem em nao_lidas (outbound não conta como não lida).
        await admin
            .from("ae_conversas")
            .update({ ultima_mensagem_em: new Date().toISOString(), updated_at: new Date().toISOString() })
            .eq("id", conversa_id)

        return NextResponse.json({ ok: true, mensagem: salva })
    } catch (e) {
        if (e instanceof AuctaFluxError) {
            const msg = e.status === 401
                ? "Credencial da AuctaFlux inválida/expirada (verifique AUCTAFLUX_RESELLER_API_KEY)"
                : `AuctaFlux: ${e.message}`
            return NextResponse.json({ error: msg }, { status: 502 })
        }
        const msg = e instanceof Error ? e.message : "Erro interno"
        console.error("[academia-enem/mensagens/enviar POST]", e)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
