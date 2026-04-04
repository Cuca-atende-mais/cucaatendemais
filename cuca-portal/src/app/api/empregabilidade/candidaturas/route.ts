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
        } = body

        if (!nome || !telefone) {
            return NextResponse.json({ error: "Campos obrigatórios ausentes." }, { status: 400 })
        }

        // HF37-03/06: Anti-spam — bloquear duplicidade por telefone + vaga_id
        // Ignora todos os status negativos/inativos para não gerar falso positivo em soft delete
        if (vaga_id && telefone) {
            const STATUS_INATIVOS = ["rejeitado", "cancelado", "excluido", "inativo"]
            const { data: existing } = await supabaseAdmin
                .from("candidaturas")
                .select("id")
                .eq("vaga_id", vaga_id)
                .eq("telefone", telefone)
                .not("status", "in", `(${STATUS_INATIVOS.join(",")})`)
                .maybeSingle()
            if (existing) {
                return NextResponse.json(
                    { error: "Você já está inscrito nesta vaga." },
                    { status: 409 }
                )
            }
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
                match_score: matching_score ?? null,
                dados_ocr_json: dados_ocr_json || null,
                pcd_candidato: pcd_candidato ?? false,
                pcd_tipo_candidato: pcd_candidato ? (pcd_tipo_candidato || null) : null,
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
