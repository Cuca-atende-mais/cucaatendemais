import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export async function POST(request: NextRequest) {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    try {
        const { talent_id, vaga_id } = await request.json()

        if (!talent_id || !vaga_id) {
            return NextResponse.json({ error: "talent_id e vaga_id são obrigatórios." }, { status: 400 })
        }

        // 1. Buscar dados do talent
        const { data: talent, error: tErr } = await supabase
            .from("talent_bank")
            .select("*")
            .eq("id", talent_id)
            .single()

        if (tErr || !talent) {
            return NextResponse.json({ error: "Candidato não encontrado no banco de talentos." }, { status: 404 })
        }

        // 2. Buscar dados da vaga para preencher campos da candidatura
        const { data: vaga, error: vErr } = await supabase
            .from("vagas")
            .select("unidade_cuca")
            .eq("id", vaga_id)
            .single()

        if (vErr || !vaga) {
            return NextResponse.json({ error: "Vaga não encontrada." }, { status: 404 })
        }

        // 3. Verificar se já existe candidatura desse talent para essa vaga
        const { data: existente } = await supabase
            .from("candidaturas")
            .select("id")
            .eq("vaga_id", vaga_id)
            .eq("telefone", talent.telefone || "")
            .maybeSingle()

        if (existente) {
            return NextResponse.json({ error: "Este candidato já está inscrito nesta vaga." }, { status: 409 })
        }

        // 4. Criar candidatura com origem banco de talentos
        const skills = talent.skills_jsonb || {}
        const { data: nova, error: insErr } = await supabase
            .from("candidaturas")
            .insert({
                vaga_id,
                nome: talent.nome,
                telefone: talent.telefone || null,
                data_nascimento: talent.data_nascimento || null,
                arquivo_cv_url: talent.arquivo_cv_url || null,
                dados_ocr_json: skills,
                match_score: null,
                status: "pendente",
                area_interesse: talent.area_interesse || null,
                observacoes: `banco_talentos:${talent_id}`,
                unidade_cuca: vaga.unidade_cuca || null,
            })
            .select("id")
            .single()

        if (insErr) throw insErr

        // 5. Atualizar status do talent para arquivado
        await supabase
            .from("talent_bank")
            .update({ status: "arquivado", updated_at: new Date().toISOString() })
            .eq("id", talent_id)

        // 6. Disparar análise de IA em background se houver CV
        if (talent.arquivo_cv_url && nova.id) {
            const workerUrl = process.env.WORKER_URL
            if (workerUrl) {
                fetch(`${workerUrl}/process-cv`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        candidatura_id: nova.id,
                        cv_url: talent.arquivo_cv_url,
                        vaga_id,
                    }),
                }).catch(err => console.error("[talent-bank/convocar] Erro ao disparar análise IA:", err))
            }
        }

        return NextResponse.json({ ok: true, candidatura_id: nova.id })
    } catch (err: any) {
        console.error("[talent-bank/convocar] Erro:", err)
        return NextResponse.json({ error: err.message || "Erro interno." }, { status: 500 })
    }
}
