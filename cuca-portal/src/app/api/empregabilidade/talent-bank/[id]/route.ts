import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { deleteFromR2 } from "@/lib/r2"

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    try {
        const { id } = await params

        // Buscar o registro para obter a URL do arquivo
        const { data: talent, error: fetchErr } = await supabase
            .from("talent_bank")
            .select("id, arquivo_cv_url")
            .eq("id", id)
            .single()

        if (fetchErr || !talent) {
            return NextResponse.json({ error: "Candidato não encontrado." }, { status: 404 })
        }

        // Deletar PDF do R2 se existir
        if (talent.arquivo_cv_url) {
            try {
                await deleteFromR2(talent.arquivo_cv_url)
            } catch (r2Err) {
                console.warn("[talent-bank/delete] Falha ao deletar R2, continuando:", r2Err)
            }
        }

        // Deletar registro do Supabase
        const { error: deleteErr } = await supabase
            .from("talent_bank")
            .delete()
            .eq("id", id)

        if (deleteErr) throw deleteErr

        return NextResponse.json({ ok: true })
    } catch (err: any) {
        console.error("[talent-bank/delete] Erro:", err)
        return NextResponse.json({ error: err.message || "Erro ao deletar candidato." }, { status: 500 })
    }
}
