import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { isDeveloperEmail } from "@/lib/auth/developers"
import { PGM_GERAL } from "@/lib/rbac/catalogo-programacao-mensal"
import { opcaoLiberada } from "@/lib/programacao/permissoes-categoria"
import { carregarAcessoPgm } from "@/lib/programacao/permissoes-categoria-server"

// S-PROG-13: mensal exige a opção "Excluir programação inteira" (a confirmação nominal continua na
// tela) e a campanha precisa ser de unidade ao alcance de quem pede. Pontual segue só para as contas
// Developer, como antes.

export async function DELETE(req: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
        }

        const { searchParams } = new URL(req.url)
        const id = searchParams.get("id")
        const tipo = searchParams.get("tipo")

        if (!id || !tipo) {
            return NextResponse.json({ error: "ID e tipo são obrigatórios" }, { status: 400 })
        }

        if (tipo === 'mensal') {
            const acesso = await carregarAcessoPgm(user)
            if (!opcaoLiberada(acesso.checar, PGM_GERAL.excluirProgramacao)) {
                return NextResponse.json({ error: "Sem permissão para excluir a programação inteira." }, { status: 403 })
            }

            const admin = createAdminClient()
            const { data: campanha } = await admin
                .from("campanhas_mensais")
                .select("id, unidade_cuca")
                .eq("id", id)
                .maybeSingle()
            if (!campanha || !acesso.alcancaUnidade(campanha.unidade_cuca as string | null)) {
                return NextResponse.json({ error: "Programação não encontrada" }, { status: 404 })
            }

            // Primeiro deletar os eventos vinculados se não houver ON DELETE CASCADE
            await supabase.from("eventos_mensais").delete().eq("campanha_id", id)

            // Chave de serviço: a permissão já foi conferida acima (atividades e histórico saem
            // junto pelo ON DELETE CASCADE).
            const { error } = await admin.from("campanhas_mensais").delete().eq("id", id)
            if (error) throw error
        } else if (tipo === 'pontual') {
            if (!isDeveloperEmail(user.email)) {
                return NextResponse.json({ error: "Apenas developers/owners podem realizar esta ação." }, { status: 403 })
            }
            const { error } = await supabase.from("eventos_pontuais").delete().eq("id", id)
            if (error) throw error
        } else {
            return NextResponse.json({ error: "Tipo inválido" }, { status: 400 })
        }

        return NextResponse.json({ success: true, message: "Programação excluída com sucesso." })

    } catch (e: any) {
        console.error("[programacao/excluir]", e)
        return NextResponse.json({ error: e.message || "Erro ao excluir programação" }, { status: 500 })
    }
}
