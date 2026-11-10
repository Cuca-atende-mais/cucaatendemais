import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { exigirPermissao } from "@/lib/rbac/exigir-permissao-servidor"
import { montarMapaContadores, validarIdsContadores } from "@/lib/empregabilidade/contadores-selecoes"

// S-EMP-GES-10 (AC10): POST /api/empregabilidade/talent-bank/contadores  { ids: uuid[] }
// - exige sessão e a permissão que abre o Banco de Talentos (empreg_banco_cv / read; decisão D8);
// - no máximo 100 talentos por pedido;
// - só lê; devolve só "seleções ativas" e "seleções de que já participou" de cada id.

export async function POST(request: NextRequest) {
    const permissao = await exigirPermissao("empreg_banco_cv", "read")
    if (!permissao.ok) return permissao.resposta

    let corpo: unknown
    try {
        corpo = await request.json()
    } catch {
        return NextResponse.json({ error: "Corpo inválido." }, { status: 400 })
    }

    const validacao = validarIdsContadores(corpo)
    if (!validacao.ok) return NextResponse.json({ error: validacao.erro }, { status: 400 })
    if (validacao.ids.length === 0) return NextResponse.json({ contadores: {} })

    try {
        // A função só é executável por service_role; a chamada vem depois da checagem acima.
        const admin = createAdminClient()
        const { data, error } = await admin.rpc("emp_contadores_selecoes", { p_talent_ids: validacao.ids })
        if (error) throw error
        return NextResponse.json({ contadores: montarMapaContadores(data) })
    } catch (err) {
        console.error("[talent-bank/contadores] Erro:", err)
        return NextResponse.json({ error: "Erro ao contar as seleções." }, { status: 500 })
    }
}
