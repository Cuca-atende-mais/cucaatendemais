import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function DELETE(req: NextRequest) {
    try {
        const supabase = await createClient()
        const { data: { user } } = await supabase.auth.getUser()

        if (!user) {
            return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
        }

        const DEVELOPER_EMAILS = ['valmir@cucateste.com', 'dev.cucaatendemais@gmail.com']

        if (!user.email || !DEVELOPER_EMAILS.includes(user.email)) {
            return NextResponse.json({ error: "Apenas developers/owners podem realizar esta ação." }, { status: 403 })
        }

        const { searchParams } = new URL(req.url)
        const id = searchParams.get("id")
        const tipo = searchParams.get("tipo")

        if (!id || !tipo) {
            return NextResponse.json({ error: "ID e tipo são obrigatórios" }, { status: 400 })
        }

        if (tipo === 'mensal') {
            // Primeiro deletar os eventos vinculados se não houver ON DELETE CASCADE
            await supabase.from("eventos_mensais").delete().eq("campanha_id", id)

            const { error } = await supabase.from("campanhas_mensais").delete().eq("id", id)
            if (error) throw error
        } else if (tipo === 'pontual') {
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
