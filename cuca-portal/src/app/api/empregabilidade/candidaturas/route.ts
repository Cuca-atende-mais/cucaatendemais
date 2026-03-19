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
            conversa_id, area_interesse,
        } = body

        if (!nome || !telefone) {
            return NextResponse.json({ error: "Campos obrigatórios ausentes." }, { status: 400 })
        }

        const { data, error } = await supabaseAdmin
            .from("candidaturas")
            .insert({
                vaga_id: vaga_id || null,
                nome,
                data_nascimento: data_nascimento || null,
                telefone,
                arquivo_cv_url: arquivo_cv_url || null,
                status: status || "pendente",
                requisitos_atendidos: requisitos_atendidos || "pendente",
                observacoes: observacoes || null,
                area_interesse: area_interesse || [],
            })
            .select("id")
            .single()

        if (error) throw error

        const codigo = data.id.replace(/-/g, "").slice(-6).toUpperCase()

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
