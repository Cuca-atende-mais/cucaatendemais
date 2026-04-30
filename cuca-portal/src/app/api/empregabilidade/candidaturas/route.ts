import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export async function POST(request: NextRequest) {
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    try {
        const body = await request.json()
        const {
            vaga_id, nome, data_nascimento, telefone,
            arquivo_cv_url, status, requisitos_atendidos, observacoes,
            conversa_id, area_interesse, matching_score, dados_ocr_json,
            pcd_candidato, pcd_tipo_candidato,
            cargo_escolhido, // SQS-49: cargo específico em selecao_evento
        } = body

        if (!nome || !telefone) {
            return NextResponse.json({ error: "Campos obrigatórios ausentes." }, { status: 400 })
        }

        // Trava etária: se vaga exige "Maior de 18 anos", bloquear candidatos < 18
        if (vaga_id && data_nascimento) {
            const { data: vagaData } = await supabaseAdmin
                .from("vagas")
                .select("faixa_etaria")
                .eq("id", vaga_id)
                .single()
            if (vagaData?.faixa_etaria === "Maior de 18 anos") {
                const nasc = new Date(data_nascimento)
                const hoje = new Date()
                let idade = hoje.getFullYear() - nasc.getFullYear()
                const m = hoje.getMonth() - nasc.getMonth()
                if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--
                if (idade < 18) {
                    return NextResponse.json(
                        { error: "Esta vaga exige idade mínima de 18 anos." },
                        { status: 400 }
                    )
                }
            }
        }

        // HF37-07: Lógica de upsert inteligente para candidaturas por telefone + vaga_id
        const STATUS_ATIVOS = ["pendente", "selecionado", "contratado"]
        const candidaturaPayload = {
            vaga_id: vaga_id || null,
            nome,
            data_nascimento: data_nascimento || null,
            telefone,
            arquivo_cv_url: arquivo_cv_url || null,
            status: "pendente",
            requisitos_atendidos: "pendente",
            observacoes: observacoes || null,
            area_interesse: area_interesse || [],
            match_score: matching_score ?? null,
            dados_ocr_json: dados_ocr_json || null,
            pcd_candidato: pcd_candidato ?? false,
            pcd_tipo_candidato: pcd_candidato ? (pcd_tipo_candidato || null) : null,
            cargo_escolhido: cargo_escolhido || null, // SQS-49
        }

        let candidaturaId: string
        if (vaga_id && telefone) {
            // Usa .limit(1) em vez de .maybeSingle() para tolerar ghost data (múltiplas linhas)
            const { data: rows } = await supabaseAdmin
                .from("candidaturas")
                .select("id, status")
                .eq("vaga_id", vaga_id)
                .eq("telefone", telefone)
                .order("created_at", { ascending: false })
                .limit(1)

            const existing = rows && rows.length > 0 ? rows[0] : null

            if (existing) {
                // Candidatura ativa → bloquear (anti-spam)
                if (STATUS_ATIVOS.includes(existing.status)) {
                    return NextResponse.json(
                        { error: "Você já está inscrito nesta vaga." },
                        { status: 409 }
                    )
                }
                // Candidatura inativa → reciclar a linha existente com os novos dados
                const { error: updateError } = await supabaseAdmin
                    .from("candidaturas")
                    .update({ ...candidaturaPayload, updated_at: new Date().toISOString() })
                    .eq("id", existing.id)
                if (updateError) throw updateError
                candidaturaId = existing.id
            } else {
                // Sem registro anterior → insert normal
                const { data: inserted, error: insertError } = await supabaseAdmin
                    .from("candidaturas")
                    .insert(candidaturaPayload)
                    .select("id")
                    .single()
                if (insertError) throw insertError
                candidaturaId = inserted.id
            }
        } else {
            // Sem vaga_id (banco de talentos) → insert direto
            const { data: inserted, error: insertError } = await supabaseAdmin
                .from("candidaturas")
                .insert(candidaturaPayload)
                .select("id")
                .single()
            if (insertError) throw insertError
            candidaturaId = inserted.id
        }

        const codigo = candidaturaId.replace(/-/g, "").slice(-6).toUpperCase()
        const data = { id: candidaturaId }

        // Notificar worker via metadata da conversa de origem
        if (conversa_id) {
            try {
                const { data: convData } = await supabaseAdmin
                    .from("conversas")
                    .select("metadata")
                    .eq("id", conversa_id)
                    .single()
                if (convData) {
                    const metadata = convData.metadata || {}
                    metadata.empreg_fluxo = {
                        ...(metadata.empreg_fluxo || {}),
                        candidatura_criada_id: data.id,
                        candidatura_codigo: codigo,
                    }
                    await supabaseAdmin
                        .from("conversas")
                        .update({ metadata })
                        .eq("id", conversa_id)
                }
            } catch (e) {
                console.warn("[candidaturas/route] Erro ao notificar worker:", e)
            }
        }

        // Se for banco de talentos, upsert direto no talent_bank
        const ehBancoTalentos = (observacoes || "").toLowerCase().includes("banco_talentos")
        if (ehBancoTalentos) {
            const talentPayload = {
                nome,
                telefone,
                data_nascimento: data_nascimento || null,
                arquivo_cv_url: arquivo_cv_url || null,
                candidatura_origem_id: data.id,
                area_interesse: area_interesse?.length > 0 ? area_interesse : null,
                status: "disponivel",
                skills_jsonb: null,
                updated_at: new Date().toISOString(),
            }
            if (telefone) {
                const { data: existing } = await supabaseAdmin
                    .from("talent_bank")
                    .select("id")
                    .eq("telefone", telefone)
                    .maybeSingle()
                if (existing) {
                    await supabaseAdmin.from("talent_bank").update(talentPayload).eq("id", existing.id)
                } else {
                    await supabaseAdmin.from("talent_bank").insert(talentPayload)
                }
            } else {
                await supabaseAdmin.from("talent_bank").insert(talentPayload)
            }
        }

        return NextResponse.json({ id: data.id, codigo })
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Erro interno"
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
