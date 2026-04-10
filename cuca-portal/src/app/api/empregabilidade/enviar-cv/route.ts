import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { Resend } from "resend"

export async function POST(request: NextRequest) {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const resend = new Resend(process.env.RESEND_API_KEY!)

    try {
        const { candidatura_id, vaga_id } = await request.json()

        if (!candidatura_id || !vaga_id) {
            return NextResponse.json({ error: "Parâmetros ausentes." }, { status: 400 })
        }

        // Buscar candidatura
        const { data: candidatura, error: cErr } = await supabase
            .from("candidaturas")
            .select("nome, telefone, data_nascimento, dados_ocr_json, arquivo_cv_url")
            .eq("id", candidatura_id)
            .single()

        if (cErr || !candidatura) {
            return NextResponse.json({ error: "Candidatura não encontrada." }, { status: 404 })
        }

        // Buscar vaga com email da empresa
        const { data: vaga, error: vErr } = await supabase
            .from("vagas")
            .select("titulo, email_contato_empresa, unidade_cuca, numero_vaga")
            .eq("id", vaga_id)
            .single()

        if (vErr || !vaga) {
            return NextResponse.json({ error: "Vaga não encontrada." }, { status: 404 })
        }

        if (!vaga.email_contato_empresa) {
            return NextResponse.json({ error: "Email de contato da empresa não cadastrado na vaga." }, { status: 400 })
        }

        const ocr = candidatura.dados_ocr_json as any || {}
        const cvUrl = candidatura.arquivo_cv_url || null

        // S37A-03: Fetch do PDF para anexar ao e-mail
        let attachments: { filename: string; content: Buffer }[] = []
        if (cvUrl) {
            try {
                const fileRes = await fetch(cvUrl)
                if (!fileRes.ok) throw new Error(`HTTP ${fileRes.status}`)
                const arrayBuffer = await fileRes.arrayBuffer()
                const filename = cvUrl.split("/").pop() || "curriculo.pdf"
                attachments = [{ filename, content: Buffer.from(arrayBuffer) }]
            } catch (fetchErr: any) {
                console.warn("[enviar-cv] Não foi possível baixar o anexo do CV:", fetchErr.message)
            }
        }

        const escolaridade = ocr?.escolaridade || "Não informada"
        const expMeses = ocr?.experiencia_meses
        let expFormatada = "Não informada"
        if (expMeses && expMeses > 0) {
            const anos = Math.floor(expMeses / 12)
            const resto = expMeses % 12
            if (anos > 0 && resto > 0) expFormatada = `${anos} ano(s) e ${resto} mês(es)`
            else if (anos > 0) expFormatada = `${anos} ano(s)`
            else expFormatada = `${resto} mês(es)`
        }

        const habilidades: string[] = ocr?.habilidades || []
        const resumoExp: string[] = ocr?.resumo_experiencias || []
        const pontosFortesArr: string[] = ocr?.pontos_fortes || ocr?.analise_aderencia?.pontos_fortes || []
        const pontosAtencaoArr: string[] = ocr?.pontos_atencao || ocr?.analise_aderencia?.pontos_atencao || []
        const vereditoFinal: string = ocr?.veredito_final || ocr?.analise_aderencia?.veredito_final || ""
        // Campos padronizados SQS-41 Task 4 — string corrido para uniformidade no e-mail
        const habilidadesIdentificadas: string = ocr?.habilidades_identificadas || (habilidades.length > 0 ? habilidades.join(", ") : "")
        const experienciasAnteriores: string = ocr?.experiencias_anteriores || (resumoExp.length > 0 ? resumoExp.join("; ") : "")
        const score: number | null = ocr?.match_score ?? null

        const vagaLabel = vaga.numero_vaga ? `Vaga #${vaga.numero_vaga} — ${vaga.titulo}` : vaga.titulo

        const scoreColor = score !== null ? (score >= 70 ? "#16a34a" : score >= 50 ? "#d97706" : "#dc2626") : "#666"
        const scoreBg = score !== null ? (score >= 70 ? "#f0fdf4" : score >= 50 ? "#fffbeb" : "#fef2f2") : "#f9f9f9"

        const { error: emailErr } = await resend.emails.send({
            from: "CUCA Empregabilidade <noreply@cucaatendemais.com.br>",
            to: vaga.email_contato_empresa,
            subject: `Currículo: ${candidatura.nome} — ${vagaLabel}`,
            attachments: attachments.length > 0 ? attachments : undefined,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 620px; margin: 0 auto; color: #333;">
                    <div style="background: #0066cc; padding: 24px; border-radius: 8px 8px 0 0;">
                        <h1 style="color: white; margin: 0; font-size: 20px;">Candidato Pré-Avaliado — CUCA Empregabilidade</h1>
                        <p style="color: #cce0ff; margin: 4px 0 0 0; font-size: 14px;">${vaga.unidade_cuca ? `Unidade ${vaga.unidade_cuca}` : "CUCA Atende Mais"} · ${vagaLabel}</p>
                    </div>
                    <div style="background: #f9f9f9; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #e0e0e0;">
                        <h2 style="font-size: 18px; margin: 0 0 4px 0;">${candidatura.nome}</h2>
                        <p style="color: #666; font-size: 13px; margin: 0 0 16px 0;">Telefone: <strong>${candidatura.telefone || "Não informado"}</strong></p>

                        ${score !== null ? `
                        <div style="display:flex;align-items:center;gap:14px;background:${scoreBg};border:1px solid ${scoreColor}33;border-radius:8px;padding:12px 16px;margin-bottom:16px;">
                            <div style="width:54px;height:54px;border-radius:50%;border:3px solid ${scoreColor};display:flex;flex-direction:column;align-items:center;justify-content:center;flex-shrink:0;">
                                <span style="font-size:20px;font-weight:bold;color:${scoreColor};">${score}</span>
                                <span style="font-size:9px;color:#666;">match</span>
                            </div>
                            <div>
                                <p style="margin:0;font-weight:bold;color:${scoreColor};">Score de Compatibilidade: ${score}/100</p>
                                <p style="margin:2px 0 0;font-size:13px;color:#555;">${score >= 70 ? "Alta compatibilidade com os requisitos da vaga" : score >= 50 ? "Compatibilidade moderada" : "Perfil com divergências em relação aos requisitos"}</p>
                            </div>
                        </div>` : ""}

                        <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 16px;">
                            <tr style="background: #eef4ff;"><td style="padding: 8px 12px; font-weight: bold; width: 40%;">Escolaridade</td><td style="padding: 8px 12px;">${escolaridade}</td></tr>
                            <tr><td style="padding: 8px 12px; font-weight: bold;">Experiência</td><td style="padding: 8px 12px;">${expFormatada}</td></tr>
                            ${habilidadesIdentificadas ? `<tr style="background: #eef4ff;"><td style="padding: 8px 12px; font-weight: bold;">Habilidades</td><td style="padding: 8px 12px;">${habilidadesIdentificadas}</td></tr>` : ""}
                        </table>

                        ${experienciasAnteriores ? `<div style="margin-bottom:16px;"><p style="font-weight:bold;font-size:13px;text-transform:uppercase;color:#0066cc;margin-bottom:6px;">Experiências Anteriores</p><p style="font-size:13px;color:#333;margin:0;">${experienciasAnteriores}</p></div>` : ""}

                        ${pontosFortesArr.length > 0 ? `<div style="margin-bottom:16px;"><p style="font-weight:bold;font-size:13px;text-transform:uppercase;color:#16a34a;margin-bottom:6px;">✅ Pontos Fortes</p><ul style="margin:0;padding-left:18px;">${pontosFortesArr.map(p => `<li style="font-size:13px;color:#333;margin-bottom:4px;">${p}</li>`).join("")}</ul></div>` : ""}

                        ${pontosAtencaoArr.length > 0 ? `<div style="margin-bottom:16px;"><p style="font-weight:bold;font-size:13px;text-transform:uppercase;color:#d97706;margin-bottom:6px;">⚠️ Pontos de Atenção</p><ul style="margin:0;padding-left:18px;">${pontosAtencaoArr.map(p => `<li style="font-size:13px;color:#333;margin-bottom:4px;">${p}</li>`).join("")}</ul></div>` : ""}

                        ${vereditoFinal ? `<div style="background:#f0f4ff;border-left:4px solid #0066cc;padding:14px 16px;border-radius:0 8px 8px 0;margin-bottom:20px;"><p style="font-weight:bold;font-size:13px;text-transform:uppercase;color:#0066cc;margin-bottom:4px;">Veredito da IA</p><p style="font-size:14px;color:#111;margin:0;">${vereditoFinal}</p></div>` : ""}

                        ${cvUrl ? `<div style="text-align: center; margin: 20px 0;"><a href="${cvUrl}" style="background: #0066cc; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 14px;">📄 Visualizar Currículo Original</a></div>` : `<p style="color: #999; font-size: 13px; text-align: center;">Currículo em PDF não disponível para este candidato.</p>`}

                        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;" />
                        <p style="color: #999; font-size: 12px; text-align: center;">
                            Este e-mail foi enviado pelo sistema de empregabilidade do CUCA.<br />
                            Para dúvidas, entre em contato com a unidade CUCA responsável pela vaga.
                        </p>
                    </div>
                </div>
            `,
        })

        if (emailErr) throw emailErr

        // Registrar rastreabilidade do envio
        await supabase
            .from("candidaturas")
            .update({
                email_enviado_em: new Date().toISOString(),
                email_enviado_para: vaga.email_contato_empresa,
            })
            .eq("id", candidatura_id)

        return NextResponse.json({ ok: true })
    } catch (err: any) {
        console.error("[enviar-cv] Erro:", err)
        return NextResponse.json({ error: err.message || "Erro ao enviar email." }, { status: 500 })
    }
}
