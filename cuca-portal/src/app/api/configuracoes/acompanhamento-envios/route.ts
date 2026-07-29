import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import {
    avaliarAcesso,
    PermissaoAcompanhamentoEnvios,
    ResultadoAutorizacao,
    validarFiltros,
} from "@/app/api/configuracoes/acompanhamento-envios/logic"

const DEVELOPER_EMAILS = [
    "valmir@cucateste.com",
    "dev.cucaatendemais@gmail.com",
    "admin@cucadev.com.br",
]

async function autorizar(
    supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<ResultadoAutorizacao> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return avaliarAcesso(null, [], "can_read", DEVELOPER_EMAILS)
    if (DEVELOPER_EMAILS.includes(user.email ?? "")) return avaliarAcesso(user, [], "can_read", DEVELOPER_EMAILS)

    const { data: colab } = await supabase
        .from("colaboradores")
        .select("sys_roles(sys_permissions(module, can_read))")
        .eq("user_id", user.id)
        .single()

    const role = colab?.sys_roles as { sys_permissions?: PermissaoAcompanhamentoEnvios[] } | null
    return avaliarAcesso(user, role?.sys_permissions ?? [], "can_read", DEVELOPER_EMAILS)
}

export async function GET(req: NextRequest) {
    try {
        const supabase = await createClient()
        const acesso = await autorizar(supabase)
        if (!acesso.autorizado) {
            return NextResponse.json({ error: acesso.error }, { status: acesso.status })
        }

        const { searchParams } = new URL(req.url)
        const filtros = validarFiltros({
            motor: searchParams.get("motor"),
            desde: searchParams.get("desde"),
            ate: searchParams.get("ate"),
        })
        if ("erro" in filtros) {
            return NextResponse.json({ error: filtros.erro }, { status: 400 })
        }

        const admin = createAdminClient()
        const { data, error } = await admin.rpc("listar_disparos_acompanhamento", {
            p_motor: filtros.motor,
            p_desde: filtros.desde,
            p_ate: filtros.ate,
            p_limit: 50,
        })

        if (error) throw error
        return NextResponse.json({ disparos: data ?? [] })
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Erro interno"
        console.error("[configuracoes/acompanhamento-envios]", error)
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
