import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import {
    avaliarAcesso,
    PermissaoAcompanhamentoEnvios,
    ResultadoAutorizacao,
} from "@/app/api/configuracoes/acompanhamento-envios/logic"
import { validarCorpoAtualizacaoLimite, validarNovoDailyLimit } from "@/app/api/configuracoes/acompanhamento-envios/limite-diario/logic"

const DEVELOPER_EMAILS = [
    "valmir@cucateste.com",
    "dev.cucaatendemais@gmail.com",
    "admin@cucadev.com.br",
]

async function autorizar(
    supabase: Awaited<ReturnType<typeof createClient>>,
    acao: "can_read" | "can_update",
): Promise<ResultadoAutorizacao> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return avaliarAcesso(null, [], acao, DEVELOPER_EMAILS)
    if (DEVELOPER_EMAILS.includes(user.email ?? "")) return avaliarAcesso(user, [], acao, DEVELOPER_EMAILS)

    const { data: colab } = await supabase
        .from("colaboradores")
        .select("sys_roles(sys_permissions(module, can_read, can_update))")
        .eq("user_id", user.id)
        .single()

    const role = colab?.sys_roles as { sys_permissions?: PermissaoAcompanhamentoEnvios[] } | null
    return avaliarAcesso(user, role?.sys_permissions ?? [], acao, DEVELOPER_EMAILS)
}

// GET: lista números Meta ativos com daily_limit/messaging_limit_tier/quality_rating —
// mesmo gate de leitura (can_read) da listagem de disparos, mesma seção.
export async function GET() {
    try {
        const supabase = await createClient()
        const acesso = await autorizar(supabase, "can_read")
        if (!acesso.autorizado) {
            return NextResponse.json({ error: acesso.error }, { status: acesso.status })
        }

        const admin = createAdminClient()
        const { data, error } = await admin
            .from("meta_phone_numbers")
            .select("phone_number_id, display_name, canal_tipo, daily_limit, messaging_limit_tier, messaging_limit_tier_confirmado_em, quality_rating")
            .eq("ativo", true)
            .order("display_name", { ascending: true })

        if (error) throw error
        return NextResponse.json({ numeros: data ?? [] })
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Erro interno"
        console.error("[acompanhamento-envios/limite-diario:get]", error)
        return NextResponse.json({ error: message }, { status: 500 })
    }
}

// PATCH: atualiza daily_limit de UM número — ESCRITA (can_update). Nunca confia no valor
// máximo que o frontend já validou: revalida contra messaging_limit_tier aqui de novo,
// lendo o valor atual do banco (não o que o cliente mandou).
export async function PATCH(req: NextRequest) {
    try {
        const supabase = await createClient()
        const acesso = await autorizar(supabase, "can_update")
        if (!acesso.autorizado) {
            return NextResponse.json({ error: acesso.error }, { status: acesso.status })
        }

        const body = await req.json().catch(() => null)
        const validadoCorpo = validarCorpoAtualizacaoLimite(body)
        if ("erro" in validadoCorpo) {
            return NextResponse.json({ error: validadoCorpo.erro }, { status: 400 })
        }

        const admin = createAdminClient()
        const { data: numero, error: erroBusca } = await admin
            .from("meta_phone_numbers")
            .select("phone_number_id, messaging_limit_tier")
            .eq("phone_number_id", validadoCorpo.phone_number_id)
            .maybeSingle()

        if (erroBusca) throw erroBusca
        if (!numero) {
            return NextResponse.json({ error: "Número não encontrado" }, { status: 404 })
        }

        const validadoLimite = validarNovoDailyLimit(validadoCorpo.daily_limit, numero.messaging_limit_tier)
        if (!validadoLimite.valido) {
            return NextResponse.json({ error: validadoLimite.erro }, { status: 422 })
        }

        const { data, error: erroUpdate } = await admin
            .from("meta_phone_numbers")
            .update({ daily_limit: validadoLimite.valor })
            .eq("phone_number_id", validadoCorpo.phone_number_id)
            .select("phone_number_id, daily_limit")
            .single()

        if (erroUpdate) throw erroUpdate
        return NextResponse.json(data)
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Erro interno"
        console.error("[acompanhamento-envios/limite-diario:patch]", error)
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
