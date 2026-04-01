import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { id: candidaturaId } = await params

    try {
        // 1. Buscar dados completos da candidatura
        const { data: candidatura, error: cErr } = await supabase
            .from("candidaturas")
            .select("*")
            .eq("id", candidaturaId)
            .single()

        if (cErr || !candidatura) {
            return NextResponse.json({ error: "Candidatura não encontrada." }, { status: 404 })
        }

        // 2. Atualizar status para rejeitado
        const { error: updateErr } = await supabase
            .from("candidaturas")
            .update({ status: "rejeitado", updated_at: new Date().toISOString() })
            .eq("id", candidaturaId)

        if (updateErr) throw updateErr

        // 3. Upsert no talent_bank
        const ocr = candidatura.dados_ocr_json || {}
        const expMeses = ocr?.experiencia_meses ?? null
        const talentPayload = {
            nome: candidatura.nome,
            telefone: candidatura.telefone || null,
            data_nascimento: candidatura.data_nascimento || null,
            arquivo_cv_url: ocr?.arquivo_cv_url || candidatura.arquivo_cv_url || null,
            candidatura_origem_id: candidaturaId,
            vaga_origem_id: candidatura.vaga_id || null,
            skills_jsonb: ocr && Object.keys(ocr).length > 0 ? ocr : null,
            area_interesse: candidatura.area_interesse || null,
            status: "disponivel",
            data_curriculo: candidatura.created_at || null,
            primeiro_emprego: expMeses !== null ? expMeses === 0 : false,
            pcd_candidato: candidatura.pcd_candidato ?? false,
            pcd_tipo_candidato: candidatura.pcd_tipo_candidato || null,
            updated_at: new Date().toISOString(),
        }

        // Tenta upsert por telefone, se disponível
        if (candidatura.telefone) {
            const { data: existing } = await supabase
                .from("talent_bank")
                .select("id")
                .eq("telefone", candidatura.telefone)
                .maybeSingle()

            if (existing) {
                await supabase.from("talent_bank").update(talentPayload).eq("id", existing.id)
            } else {
                await supabase.from("talent_bank").insert(talentPayload)
            }
        } else {
            await supabase.from("talent_bank").insert(talentPayload)
        }

        return NextResponse.json({ ok: true })
    } catch (err: any) {
        console.error("[rejeitar-candidatura] Erro:", err)
        return NextResponse.json({ error: err.message || "Erro interno." }, { status: 500 })
    }
}
