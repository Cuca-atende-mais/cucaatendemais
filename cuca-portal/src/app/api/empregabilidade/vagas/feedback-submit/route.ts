import { NextRequest, NextResponse } from "next/server"
import { createAdminClient as createClient } from "@/lib/supabase/admin"

/**
 * TASK 2.5.5: Submissão do Formulário de Feedback
 * POST /api/empregabilidade/vagas/feedback-submit
 */
export async function POST(request: NextRequest) {
    const supabaseAdmin = createClient()

    try {
        const body = await request.json()
        const { token, isBypass, evaluations } = body

        if (!token) {
            return NextResponse.json({ error: "Token ausente." }, { status: 400 })
        }

        // 1. Validar e buscar vaga_id do token
        const { data: tokenData, error: tokenErr } = await supabaseAdmin
            .from("vagas_feedback_tokens")
            .select("vaga_id, used, expires_at")
            .eq("token", token)
            .single()

        if (tokenErr || !tokenData) {
            return NextResponse.json({ error: "Token inválido." }, { status: 404 })
        }

        if (tokenData.used) {
            return NextResponse.json({ error: "Este link já foi utilizado." }, { status: 400 })
        }

        if (new Date(tokenData.expires_at) < new Date()) {
            return NextResponse.json({ error: "Este link expirou." }, { status: 400 })
        }

        // 2. Processar Lógica de Bypass vs Avaliação
        if (!isBypass && evaluations && Array.isArray(evaluations)) {
            // Atualizar candidatos em lote (usando Promise.all para simplicidade aqui)
            const updates = evaluations.map(async (evalItem: any) => {
                if (!evalItem.id || evalItem.status === 'pendente') return

                const updateData: any = {
                    status: evalItem.status, // 'aprovado_empresa' ou 'rejeitado'
                }

                if (evalItem.status === 'aprovado_empresa') {
                    updateData.data_entrevista = evalItem.data_entrevista || null
                    updateData.hora_entrevista = evalItem.hora_entrevista || null
                    updateData.local_entrevista = evalItem.local_entrevista || null
                }

                return supabaseAdmin
                    .from("candidaturas")
                    .update(updateData)
                    .eq("id", evalItem.id)
                    .eq("vaga_id", tokenData.vaga_id) // Segurança extra
            })

            await Promise.all(updates)
        }

        // 3. Invalida o token (Marca como usado)
        const { error: updateTokenErr } = await supabaseAdmin
            .from("vagas_feedback_tokens")
            .update({ used: true })
            .eq("token", token)

        if (updateTokenErr) throw updateTokenErr

        // 4. Enviar confirmação WhatsApp para a empresa
        if (!isBypass) {
            try {
                const { data: vaga } = await supabaseAdmin
                    .from("vagas")
                    .select("titulo, unidade_cuca, empresas(telefone, nome)")
                    .eq("id", tokenData.vaga_id)
                    .single()

                const empresa = (vaga as any)?.empresas
                const telefoneRH = empresa?.telefone

                if (vaga && telefoneRH) {
                    const { data: phoneNumber } = await supabaseAdmin
                        .from("meta_phone_numbers")
                        .select("phone_number_id")
                        .eq("canal_tipo", "Empregabilidade")
                        .eq("ativo", true)
                        .limit(1)
                        .maybeSingle()

                    if (phoneNumber) {
                        const metaToken = process.env.META_SYSTEM_USER_TOKEN
                        const templatesAprovados = process.env.META_TEMPLATES_APROVADOS === "true"
                        const telLimpo = telefoneRH.replace(/\D/g, "")
                        const number = telLimpo.startsWith("55") ? telLimpo : `55${telLimpo}`
                        if (!templatesAprovados) {
                            console.info(`[feedback-submit] notificaria ${number} mas META_TEMPLATES_APROVADOS=false`)
                        } else if (metaToken) {
                            const aprovados = (evaluations || []).filter((e: any) => e.status === "aprovado_empresa").length
                            await fetch(`https://graph.facebook.com/v23.0/${phoneNumber.phone_number_id}/messages`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${metaToken}` },
                                body: JSON.stringify({
                                    messaging_product: "whatsapp",
                                    to: number,
                                    type: "template",
                                    template: {
                                        name: "cuca_feedback_vaga",
                                        language: { code: "pt_BR" },
                                        components: [{ type: "body", parameters: [
                                            { type: "text", text: (vaga as any).titulo || "" },
                                            { type: "text", text: empresa.nome || "" },
                                            { type: "text", text: String(aprovados) },
                                        ]}],
                                    },
                                }),
                            }).catch(e => console.error("[feedback-submit] Falha ao enviar confirmação Meta:", e))
                        }
                    }
                }
            } catch (wErr) {
                console.error("[feedback-submit] Erro ao enviar confirmação WhatsApp (não crítico):", wErr)
            }
        }

        return NextResponse.json({ success: true })
    } catch (err: any) {
        console.error("[feedback-submit] Erro:", err)
        return NextResponse.json({ error: err.message || "Erro interno" }, { status: 500 })
    }
}
