import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { Resend } from "resend"

/**
 * SQS-41 Task 3 - Ação 3.1: Envio de currículos em lote com agrupamento por unidade
 * POST /api/empregabilidade/enviar-cv-lote
 *
 * Para vagas com unidade_destino == 'global': agrupa candidatos por unidade_atendimento_id
 * e dispara 1 e-mail separado por unidade. A empresa recebe até 5 e-mails.
 *
 * Para vagas de unidade específica: envia um único e-mail com todos os candidatos.
 */
export async function POST(request: NextRequest) {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const resend = new Resend(process.env.RESEND_API_KEY!)

    try {
        const { vaga_id, candidatura_ids } = await request.json()

        if (!vaga_id || !Array.isArray(candidatura_ids) || candidatura_ids.length === 0) {
            return NextResponse.json({ error: "Parâmetros ausentes." }, { status: 400 })
        }

        // Buscar vaga
        const { data: vaga, error: vErr } = await supabase
            .from("vagas")
            .select("titulo, email_contato_empresa, unidade_cuca, numero_vaga, unidade_destino")
            .eq("id", vaga_id)
            .single()

        if (vErr || !vaga) {
            return NextResponse.json({ error: "Vaga não encontrada." }, { status: 404 })
        }

        if (!vaga.email_contato_empresa) {
            return NextResponse.json({ error: "Email de contato da empresa não cadastrado na vaga." }, { status: 400 })
        }

        // Buscar candidaturas
        const { data: candidaturas, error: cErr } = await supabase
            .from("candidaturas")
            .select("id, nome, telefone, dados_ocr_json, arquivo_cv_url, unidade_atendimento_id")
            .in("id", candidatura_ids)

        if (cErr || !candidaturas || candidaturas.length === 0) {
            return NextResponse.json({ error: "Candidaturas não encontradas." }, { status: 404 })
        }

        const isGlobal = vaga.unidade_destino === "global"

        // Agrupar por unidade se vaga global, senão grupo único "sem_unidade"
        const grupos: Record<string, typeof candidaturas> = {}
        for (const c of candidaturas) {
            const chave = isGlobal ? (c.unidade_atendimento_id || "sem_unidade") : "__unico__"
            if (!grupos[chave]) grupos[chave] = []
            grupos[chave].push(c)
        }

        const vagaLabel = vaga.numero_vaga ? `Vaga #${vaga.numero_vaga} — ${vaga.titulo}` : vaga.titulo
        const emailsEnviados: string[] = []
        const erros: string[] = []

        for (const [unidadeId, grupo] of Object.entries(grupos)) {
            const nomeUnidade = unidadeId === "__unico__"
                ? (vaga.unidade_cuca ? `CUCA ${vaga.unidade_cuca}` : "CUCA Atende Mais")
                : unidadeId === "sem_unidade"
                    ? "Candidatos sem unidade definida"
                    : `CUCA ${unidadeId}`

            // Baixar CVs para anexar (máx 5 por grupo para não ultrapassar limite do Resend ~40MB)
            const attachments: { filename: string; content: Buffer }[] = []
            for (const c of grupo.slice(0, 5)) {
                const cvUrl = c.arquivo_cv_url || null
                if (cvUrl) {
                    try {
                        const fileRes = await fetch(cvUrl)
                        if (fileRes.ok) {
                            const ext = cvUrl.split(".").pop()?.split("?")[0] || "pdf"
                            const nomeSanitizado = (c.nome || "candidato").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)
                            attachments.push({
                                filename: `curriculo_${nomeSanitizado}.${ext}`,
                                content: Buffer.from(await fileRes.arrayBuffer()),
                            })
                        }
                    } catch {
                        // ignora falha de download individual — e-mail segue sem aquele anexo
                    }
                }
            }

            const candidatosHtml = await Promise.all(grupo.map(async (c) => {
                const ocr = (c.dados_ocr_json as any) || {}
                const cvUrl = c.arquivo_cv_url || null

                const habilidades: string[] = ocr?.habilidades || []
                const vereditoFinal: string = ocr?.veredito_final || ocr?.analise_aderencia?.veredito_final || ""
                const habilidadesStr: string = ocr?.habilidades_identificadas || (habilidades.length > 0 ? habilidades.join(", ") : "")
                const experienciasStr: string = ocr?.experiencias_anteriores || ""
                const analiseStr: string = typeof ocr?.analise_aderencia === "string" ? ocr.analise_aderencia : vereditoFinal
                const score: number | null = ocr?.match_score ?? null

                const scoreColor = score !== null ? (score >= 70 ? "#16a34a" : score >= 50 ? "#d97706" : "#dc2626") : "#666"
                const scoreBg = score !== null ? (score >= 70 ? "#f0fdf4" : score >= 50 ? "#fffbeb" : "#fef2f2") : "#f9f9f9"

                return `
                <div style="border:1px solid #e0e0e0;border-radius:8px;padding:16px;margin-bottom:16px;background:#fff;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                        <h3 style="margin:0;font-size:16px;color:#111;">${c.nome}</h3>
                        ${score !== null ? `
                        <div style="display:flex;align-items:center;gap:8px;">
                            <div style="width:40px;height:40px;border-radius:50%;border:2px solid ${scoreColor};background:${scoreBg};display:flex;flex-direction:column;align-items:center;justify-content:center;">
                                <span style="font-size:13px;font-weight:bold;color:${scoreColor};">${score}</span>
                            </div>
                        </div>` : ""}
                    </div>
                    <p style="margin:0 0 6px;font-size:13px;color:#555;">Telefone: <strong>${c.telefone || "Não informado"}</strong></p>
                    ${habilidadesStr ? `<p style="margin:0 0 6px;font-size:13px;color:#555;">Habilidades: ${habilidadesStr}</p>` : ""}
                    ${experienciasStr ? `<p style="margin:0 0 6px;font-size:13px;color:#555;">Experiências: ${experienciasStr}</p>` : ""}
                    ${analiseStr ? `<p style="margin:0;font-size:13px;color:#0066cc;font-style:italic;">${analiseStr}</p>` : ""}
                    ${cvUrl ? `<div style="margin-top:10px;"><a href="${cvUrl}" style="background:#0066cc;color:white;padding:8px 16px;border-radius:4px;text-decoration:none;font-size:13px;font-weight:bold;">📄 Ver Currículo</a></div>` : ""}
                </div>`
            }))

            const assunto = isGlobal
                ? `[${nomeUnidade}] Currículos Encaminhados — ${vagaLabel}`
                : `Currículos Encaminhados — ${vagaLabel}`

            const html = `
                <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#333;">
                    <div style="background:#0066cc;padding:24px;border-radius:8px 8px 0 0;">
                        <h1 style="color:white;margin:0;font-size:20px;">Candidatos Pré-Avaliados — CUCA Empregabilidade</h1>
                        <p style="color:#cce0ff;margin:6px 0 0;font-size:14px;">${vagaLabel}</p>
                        ${isGlobal ? `<p style="color:#ffffff;background:rgba(255,255,255,0.15);display:inline-block;padding:4px 10px;border-radius:4px;font-size:13px;margin:8px 0 0;">📍 Enviado por: <strong>${nomeUnidade}</strong></p>` : ""}
                    </div>
                    <div style="background:#f9f9f9;padding:24px;border-radius:0 0 8px 8px;border:1px solid #e0e0e0;">
                        <p style="margin:0 0 16px;font-size:14px;color:#444;">
                            ${isGlobal
                                ? `A <strong>${nomeUnidade}</strong> encaminhou <strong>${grupo.length}</strong> candidato(s) para esta vaga de alcance global.`
                                : `Seguem abaixo os <strong>${grupo.length}</strong> candidato(s) pré-avaliados pelo CUCA para a vaga em questão.`}
                        </p>
                        ${candidatosHtml.join("")}
                        <hr style="border:none;border-top:1px solid #e0e0e0;margin:20px 0;" />
                        <p style="color:#999;font-size:12px;text-align:center;">
                            Este e-mail foi enviado pelo sistema de empregabilidade do CUCA.<br />
                            Para dúvidas, entre em contato com a unidade CUCA responsável.
                        </p>
                    </div>
                </div>`

            const { error: emailErr } = await resend.emails.send({
                from: "CUCA Empregabilidade <noreply@cucaatendemais.com.br>",
                to: vaga.email_contato_empresa,
                subject: assunto,
                html,
                ...(attachments.length > 0 && { attachments }),
            })

            if (emailErr) {
                erros.push(`Falha ao enviar e-mail da unidade '${nomeUnidade}': ${emailErr.message}`)
            } else {
                emailsEnviados.push(nomeUnidade)

                // Registrar rastreabilidade
                const ids = grupo.map(c => c.id)
                await supabase
                    .from("candidaturas")
                    .update({
                        email_enviado_em: new Date().toISOString(),
                        email_enviado_para: vaga.email_contato_empresa,
                    })
                    .in("id", ids)
            }
        }

        if (erros.length > 0 && emailsEnviados.length === 0) {
            return NextResponse.json({ error: erros.join("; ") }, { status: 500 })
        }

        return NextResponse.json({
            ok: true,
            emails_enviados: emailsEnviados,
            ...(erros.length > 0 ? { avisos: erros } : {}),
        })
    } catch (err: any) {
        console.error("[enviar-cv-lote] Erro:", err)
        return NextResponse.json({ error: err.message || "Erro ao enviar emails." }, { status: 500 })
    }
}
