import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"
import { PGP } from "@/lib/rbac/catalogo-programacao-pontual"
import { opcaoLiberada } from "@/lib/programacao/permissoes-categoria"
import { carregarAcessoPgm } from "@/lib/programacao/permissoes-categoria-server"
import { lerDadosEventoPontual } from "@/lib/programacao/pontual"

// S-PROG-17: criar evento pontual pelo servidor. Exige a opção "Criar evento" e a unidade do evento ao
// alcance de quem pede. O evento sempre nasce `aguardando_aprovacao` (fora do RAG até ser autorizado).
export async function POST(req: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 })

        const acesso = await carregarAcessoPgm(user)
        if (!opcaoLiberada(acesso.checar, PGP.criar)) {
            return NextResponse.json({ error: "Sem permissão para criar evento pontual" }, { status: 403 })
        }

        const lido = lerDadosEventoPontual(await req.json())
        if ("erro" in lido) return NextResponse.json({ error: lido.erro }, { status: 400 })
        if (!acesso.alcancaUnidade(lido.dados.unidade_cuca)) {
            return NextResponse.json({ error: "Sem permissão para criar evento nesta unidade" }, { status: 403 })
        }

        const admin = createAdminClient()
        const { data: colaborador } = await admin.from("colaboradores").select("id").eq("user_id", user.id).maybeSingle()

        const { data, error } = await admin
            .from("eventos_pontuais")
            .insert({
                ...lido.dados,
                status: "aguardando_aprovacao",
                instancia_id: null,
                created_by: colaborador?.id ?? null,
            })
            .select("id")
            .single()
        if (error) throw new Error(error.message)

        return NextResponse.json({ ok: true, id: data.id })
    } catch (e) {
        console.error("[programacao/pontual POST]", e)
        return NextResponse.json({ error: e instanceof Error ? e.message : "Erro interno" }, { status: 500 })
    }
}
