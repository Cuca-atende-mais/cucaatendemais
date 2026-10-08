import { NextResponse } from "next/server"
import type { SupabaseClient, User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"

// O middleware libera /api/empregabilidade/* sem sessão; por isso cada rota confere sessão e permissão
// (mesma função `has_permission` das policies) antes de qualquer escrita.

export type PermissaoServidor =
    | { ok: true; supabase: SupabaseClient; user: User }
    | { ok: false; resposta: NextResponse }

export async function exigirPermissao(recurso: string, acao: "read" | "create" | "update" | "delete" = "read"): Promise<PermissaoServidor> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { ok: false, resposta: NextResponse.json({ error: "Não autenticado." }, { status: 401 }) }

    const { data: permitido, error } = await supabase.rpc("has_permission", { p_recurso: recurso, p_acao: acao })
    if (error || permitido !== true) {
        return { ok: false, resposta: NextResponse.json({ error: "Sem permissão para esta ação." }, { status: 403 }) }
    }
    return { ok: true, supabase, user }
}
