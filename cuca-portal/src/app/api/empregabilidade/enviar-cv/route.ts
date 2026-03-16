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
            .select("nome, telefone, data_nascimento, dados_ocr_json")
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
        const cvUrl = ocr?.arquivo_cv_url || null

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
        const vagaLabel = vaga.numero_vaga ? `Vaga #${vaga.numero_vaga} — ${vaga.titulo}` : vaga.titulo

        const { error: emailErr } = await resend.emails.send({
            from: "CUCA Empregabilidade <noreply@cuca.ce.gov.br>",
            to: vaga.email_contato_empresa,
            subject: `Currículo: ${candidatura.nome} — ${vagaLabel}`,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #333;">
                    <div style="background: #0066cc; padding: 24px; border-radius: 8px 8px 0 0;">
                        <h1 style="color: white; margin: 0; font-size: 20px;">Currículo de Candidato</h1>
                        <p style="color: #cce0ff; margin: 4px 0 0 0; font-size: 14px;">CUCA Empregabilidade — ${vaga.unidade_cuca ? `Unidade ${vaga.unidade_cuca}` : "CUCA Atende Mais"}</p>
                    </div>
                    <div style="background: #f9f9f9; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #e0e0e0;">
                        <h2 style="font-size: 16px; margin-bottom: 4px;">${candidatura.nome}</h2>
                        <p style="color: #666; font-size: 13px; margin: 0 0 16px 0;">Candidato para: <strong>${vagaLabel}</strong></p>

                        <table style="width: 100%; border-collapse: collapse; font-size: 14px; margin-bottom: 16px;">
                            <tr style="background: #eef4ff;">
                                <td style="padding: 8px 12px; font-weight: bold; width: 40%;">Telefone</td>
                                <td style="padding: 8px 12px;">${candidatura.telefone || "Não informado"}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 12px; font-weight: bold;">Escolaridade</td>
                                <td style="padding: 8px 12px;">${escolaridade}</td>
                            </tr>
                            <tr style="background: #eef4ff;">
                                <td style="padding: 8px 12px; font-weight: bold;">Experiência</td>
                                <td style="padding: 8px 12px;">${expFormatada}</td>
                            </tr>
                            ${habilidades.length > 0 ? `
                            <tr>
                                <td style="padding: 8px 12px; font-weight: bold;">Habilidades</td>
                                <td style="padding: 8px 12px;">${habilidades.join(", ")}</td>
                            </tr>` : ""}
                        </table>

                        ${cvUrl ? `
                        <div style="text-align: center; margin: 20px 0;">
                            <a href="${cvUrl}" style="background: #0066cc; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 14px;">
                                📄 Visualizar Currículo Completo
                            </a>
                        </div>` : `
                        <p style="color: #999; font-size: 13px; text-align: center;">Currículo em PDF não disponível para este candidato.</p>`}

                        <hr style="border: none; border-top: 1px solid #e0e0e0; margin: 20px 0;" />
                        <p style="color: #999; font-size: 12px; text-align: center;">
                            Este email foi enviado pelo sistema de empregabilidade do CUCA.<br />
                            Para dúvidas, entre em contato com a unidade CUCA responsável pela vaga.
                        </p>
                    </div>
                </div>
            `,
        })

        if (emailErr) throw emailErr

        return NextResponse.json({ ok: true })
    } catch (err: any) {
        console.error("[enviar-cv] Erro:", err)
        return NextResponse.json({ error: err.message || "Erro ao enviar email." }, { status: 500 })
    }
}
