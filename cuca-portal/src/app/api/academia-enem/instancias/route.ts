import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { listarWorkspaces, statusConexao, AuctaFluxError } from "@/lib/auctaflux/client"

async function checkAuth(recurso: string, acao: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: "Não autenticado", status: 401 as const }
    const { data: ok } = await supabase.rpc("has_permission", { p_recurso: recurso, p_acao: acao })
    if (!ok) return { error: "Sem permissão", status: 403 as const }
    return { error: null }
}

// GET → lista as instâncias (workspaces) existentes na AuctaFlux com o status de conexão de cada uma,
// já cruzando com ae_instancias para indicar qual está assumida/ativa localmente.
// Nunca expõe forward_secret ao client.
// URL do nosso webhook (forward_to_url apontado ao assumir). Centralizada para a fatia 2 reusar.
const NOSSO_WEBHOOK = process.env.APP_URL
    ? `${process.env.APP_URL.replace(/\/$/, "")}/api/academia-enem/webhook/auctaflux`
    : null

export async function GET() {
    try {
        const gate = await checkAuth("ae_instancia", "read")
        if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status })

        const workspaces = await listarWorkspaces()

        // Estado local (sem segredo): quais workspaces já foram assumidos.
        const admin = createAdminClient()
        const { data: locais } = await admin
            .from("ae_instancias")
            .select("workspace_id, ativa, instancia_nome")
        const localByWs = new Map((locais ?? []).map(l => [l.workspace_id as string, l]))

        // Busca o status de cada workspace em paralelo (degrada graciosamente por item).
        const instancias = await Promise.all(
            workspaces.map(async (ws) => {
                let conexao = null
                let conexaoErro: string | null = null
                try {
                    conexao = await statusConexao(ws.id)
                } catch (e) {
                    conexaoErro = e instanceof Error ? e.message : "erro ao obter status"
                }
                const local = localByWs.get(ws.id)
                return {
                    workspace_id: ws.id,
                    name: ws.name,
                    slug: ws.slug,
                    mode: ws.mode,
                    forward_to_url: ws.forward_to_url,
                    // Só consideramos "assumida por nós" se o forward aponta para o NOSSO webhook
                    // (um forward_to_url qualquer pode ser de terceiros).
                    assumida_por_nos: !!ws.forward_to_url && !!NOSSO_WEBHOOK && ws.forward_to_url === NOSSO_WEBHOOK,
                    forward_configurado: !!ws.forward_to_url, // há algum forward setado (não necessariamente nosso)
                    ativa_local: !!local?.ativa,
                    conexao,
                    conexaoErro,
                }
            }),
        )

        return NextResponse.json({ instancias })
    } catch (e) {
        if (e instanceof AuctaFluxError) {
            const msg = e.status === 401
                ? "Credencial da AuctaFlux inválida/expirada (verifique AUCTAFLUX_RESELLER_API_KEY)"
                : `AuctaFlux: ${e.message}`
            return NextResponse.json({ error: msg }, { status: 502 })
        }
        const msg = e instanceof Error ? e.message : "Erro interno"
        console.error("[academia-enem/instancias GET]", e)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
