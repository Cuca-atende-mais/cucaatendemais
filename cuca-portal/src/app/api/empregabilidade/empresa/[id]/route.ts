import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { deleteFromR2 } from "@/lib/r2"

export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    try {
        const { id } = await params

        const { data: empresa, error: empresaErr } = await supabase
            .from("empresas")
            .select("id, nome")
            .eq("id", id)
            .single()

        if (empresaErr || !empresa) {
            return NextResponse.json({ error: "Empresa não encontrada." }, { status: 404 })
        }

        // Buscar todas as vagas da empresa
        const { data: vagas } = await supabase
            .from("vagas")
            .select("id")
            .eq("empresa_id", id)

        const vagaIds = (vagas || []).map((v) => v.id)

        if (vagaIds.length > 0) {
            // Buscar CVs das candidaturas para limpar no R2
            const { data: candidaturas } = await supabase
                .from("candidaturas")
                .select("id, arquivo_cv_url")
                .in("vaga_id", vagaIds)

            for (const candidatura of candidaturas || []) {
                if (candidatura.arquivo_cv_url) {
                    try {
                        await deleteFromR2(candidatura.arquivo_cv_url)
                    } catch {
                        console.warn("[empresa/delete] Falha ao deletar CV do R2:", candidatura.id)
                    }
                }
            }

            // Deletar candidaturas das vagas
            const { error: candErr } = await supabase
                .from("candidaturas")
                .delete()
                .in("vaga_id", vagaIds)

            if (candErr) throw candErr

            // Deletar entradas do talent_bank vinculadas às vagas
            await supabase
                .from("talent_bank")
                .delete()
                .in("vaga_origem_id", vagaIds)

            // Deletar vagas
            const { error: vagasErr } = await supabase
                .from("vagas")
                .delete()
                .eq("empresa_id", id)

            if (vagasErr) throw vagasErr
        }

        // Deletar empresa
        const { error: deleteErr } = await supabase
            .from("empresas")
            .delete()
            .eq("id", id)

        if (deleteErr) throw deleteErr

        return NextResponse.json({
            ok: true,
            vagasRemovidas: vagaIds.length,
        })
    } catch (err: any) {
        console.error("[empresa/delete] Erro:", err)
        return NextResponse.json({ error: err.message || "Erro ao excluir empresa." }, { status: 500 })
    }
}
