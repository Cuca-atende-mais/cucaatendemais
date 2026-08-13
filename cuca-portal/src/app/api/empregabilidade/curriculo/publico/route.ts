import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { Resend } from "resend"
import { parseLinkParams, verificarLinkParams } from "@/lib/empregabilidade/link-assinado"
import { gerarEArmazenarPdfCurriculo } from "@/lib/empregabilidade/curriculo-pdf-service"
import { gerarEArmazenarDocxCurriculo } from "@/lib/empregabilidade/curriculo-docx-service"
import {
    criarRespostaCurriculoPublico,
    criarDownloadToken,
    hashTelefone,
    normalizarCvDados,
} from "@/lib/empregabilidade/curriculo-publico"
import type { CvDados } from "@/lib/empregabilidade/curriculo-tipos"

// SQS-60: e-mail simples de confirmação com o PDF anexado, só quando o
// candidato marca o opt-in e só na 1ª vez que o currículo é salvo (controlado
// por talent_bank.email_enviado_em). Mesmo remetente/domínio verificado já
// usado em api/empregabilidade/enviar-cv/route.ts — não inventa um novo.
async function enviarEmailConfirmacao(params: {
    nome: string
    email: string
    pdfBuffer: Buffer
}): Promise<void> {
    const resend = new Resend(process.env.RESEND_API_KEY!)
    await resend.emails.send({
        from: "CUCA Empregabilidade <noreply@cucaatendemais.com.br>",
        to: params.email,
        subject: "Seu currículo foi salvo — Rede CUCA",
        attachments: [{ filename: "curriculo.pdf", content: params.pdfBuffer }],
        html: `
            <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; color: #333;">
                <div style="background: #0066cc; padding: 24px; border-radius: 8px 8px 0 0;">
                    <h1 style="color: white; margin: 0; font-size: 20px;">Currículo salvo com sucesso</h1>
                </div>
                <div style="background: #f9f9f9; padding: 24px; border-radius: 0 0 8px 8px; border: 1px solid #e0e0e0;">
                    <p>Olá, <strong>${params.nome}</strong>!</p>
                    <p>Seu currículo foi cadastrado no banco de talentos da Rede CUCA e já concorre às oportunidades compatíveis com o seu perfil. Em anexo está o PDF, para você guardar.</p>
                    <p style="color: #666; font-size: 13px;">Assim que surgir uma vaga compatível, nossa equipe entra em contato pelo WhatsApp.</p>
                </div>
            </div>
        `,
    })
}

export async function POST(request: NextRequest) {
    const secret = process.env.EMPREGABILIDADE_LINK_SECRET || ""
    if (!secret) {
        return NextResponse.json({ error: "Link inválido ou expirado." }, { status: 403 })
    }

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    try {
        const body = await request.json()
        const linkParamsRaw = body.link_params
        const linkParams = parseLinkParams(linkParamsRaw)
        const talentId = linkParams?.get("talent_id") || ""
        const conversaId = linkParams?.get("conversa_id") || ""
        const origemTel = linkParams?.get("origem_tel") || ""

        const linkOk = verificarLinkParams(linkParamsRaw, {
            talent_id: talentId,
            conversa_id: conversaId,
        })
        if (!linkOk.valido || !talentId || !origemTel) {
            return NextResponse.json({ error: "Link inválido ou expirado." }, { status: 403 })
        }

        const values = normalizarCvDados((body.dados || {}) as Partial<CvDados>, {
            nome: linkParams?.get("nome") || "",
            telefone: origemTel,
        })

        if (!values.nome || !values.telefone) {
            return NextResponse.json({ error: "Nome e telefone são obrigatórios." }, { status: 400 })
        }

        // SQS-60: opt-in de envio por email — só exige/valida o campo quando
        // o candidato marca o checkbox (AC1/AC2). Desmarcado, email continua
        // opcional como sempre foi.
        const receberEmail = body.receber_email === true
        const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
        if (receberEmail && !EMAIL_REGEX.test(values.email || "")) {
            return NextResponse.json({ error: "Informe um e-mail válido para receber o currículo." }, { status: 400 })
        }

        // Telefone do formulário NÃO precisa bater com o telefone de origem do
        // link — o candidato pode montar o currículo a partir de um WhatsApp
        // diferente do número que deve constar no currículo (decisão do Junior,
        // 2026-08-12). origem_tel só serve de valor padrão (normalizarCvDados).

        const { data: permitido, error: limiteErr } = await supabase.rpc(
            "registrar_limite_curriculo_publico",
            { p_phone_hash: hashTelefone(values.telefone), p_limit: 5 }
        )
        if (limiteErr) throw limiteErr
        if (permitido !== true) {
            return NextResponse.json(
                { error: "Muitas tentativas para este telefone. Tente novamente mais tarde." },
                { status: 429 }
            )
        }

        const { data: talent, error: talentErr } = await supabase
            .from("talent_bank")
            .select("id, email_enviado_em")
            .eq("id", talentId)
            .single()

        if (talentErr || !talent) {
            return NextResponse.json({ error: "Link inválido ou expirado." }, { status: 403 })
        }

        const now = new Date().toISOString()
        const { data: curriculoAtual } = await supabase
            .from("curriculos")
            .select("id")
            .eq("talent_id", talentId)
            .is("deleted_at", null)
            .order("updated_at", { ascending: false })
            .limit(1)
            .maybeSingle()

        const curriculoPayload = {
            talent_id: talentId,
            dados: values,
            updated_at: now,
        }

        const { data: curriculo, error: curriculoErr } = curriculoAtual?.id
            ? await supabase
                .from("curriculos")
                .update(curriculoPayload)
                .eq("id", curriculoAtual.id)
                .select("id")
                .single()
            : await supabase
                .from("curriculos")
                .insert(curriculoPayload)
                .select("id")
                .single()

        if (curriculoErr || !curriculo) throw curriculoErr || new Error("Erro ao salvar currículo.")

        const { error: talentUpdateErr } = await supabase
            .from("talent_bank")
            .update({
                nome: values.nome,
                telefone: values.telefone,
                curriculo_estruturado: values,
                status: "disponivel",
                updated_at: now,
            })
            .eq("id", talentId)

        if (talentUpdateErr) throw talentUpdateErr

        const pdfResultado = await gerarEArmazenarPdfCurriculo(supabase, talentId, values)
        const download = criarDownloadToken(talentId, secret)

        // SQS-63: DOCX gerado junto no salvamento (decisão do Junior — não
        // sob demanda). Best-effort (AC5): se falhar, loga e segue sem
        // token/URL de DOCX — o candidato simplesmente não vê o botão em vez
        // de ver um botão quebrado (Risco #3 da story).
        let downloadDocx: ReturnType<typeof criarDownloadToken> | null = null
        try {
            await gerarEArmazenarDocxCurriculo(supabase, talentId, values)
            downloadDocx = criarDownloadToken(talentId, secret)
            const { error: tokenDocxErr } = await supabase
                .from("empregabilidade_curriculo_download_tokens")
                .insert({
                    token_hash: downloadDocx.tokenHash,
                    talent_id: talentId,
                    expires_at: downloadDocx.expiresAt,
                    tipo: "docx",
                })
            if (tokenDocxErr) throw tokenDocxErr
        } catch (docxErr) {
            console.warn("[curriculo/publico] Falha ao gerar/armazenar DOCX:", docxErr)
            downloadDocx = null
        }

        // SQS-60 (AC3/AC4): só dispara na 1ª vez (talent.email_enviado_em ainda
        // null) — edições seguintes com o checkbox marcado não reenviam.
        // Best-effort: falha no email nunca derruba o salvamento do currículo
        // (AC5), mesmo princípio de resiliência do PDF.
        if (receberEmail && !talent.email_enviado_em) {
            try {
                const pdfRes = await fetch(pdfResultado.url)
                if (!pdfRes.ok) throw new Error(`HTTP ${pdfRes.status}`)
                const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer())
                await enviarEmailConfirmacao({ nome: values.nome, email: values.email, pdfBuffer })
                await supabase
                    .from("talent_bank")
                    .update({ email_enviado_em: now })
                    .eq("id", talentId)
            } catch (emailErr) {
                console.warn("[curriculo/publico] Falha ao enviar email de confirmação:", emailErr)
            }
        }

        const { error: tokenErr } = await supabase
            .from("empregabilidade_curriculo_download_tokens")
            .insert({
                token_hash: download.tokenHash,
                talent_id: talentId,
                expires_at: download.expiresAt,
                tipo: "pdf",
            })

        if (tokenErr) throw tokenErr

        if (conversaId) {
            try {
                const { data: convData } = await supabase
                    .from("conversas")
                    .select("metadata")
                    .eq("id", conversaId)
                    .single()
                const metadata = convData?.metadata || {}
                metadata.empreg_fluxo = {
                    ...(metadata.empreg_fluxo || {}),
                    curriculo_publico_salvo: true,
                    talent_id: talentId,
                    curriculo_id: curriculo.id,
                }
                await supabase.from("conversas").update({ metadata }).eq("id", conversaId)
            } catch (err) {
                console.warn("[curriculo/publico] Falha ao notificar worker:", err)
            }
        }

        return NextResponse.json(criarRespostaCurriculoPublico({
            curriculoId: curriculo.id,
            talentId,
            downloadUrl: download.url,
            docxDownloadUrl: downloadDocx?.url,
        }))
    } catch (err: unknown) {
        console.error("[curriculo/publico] Erro:", err)
        const message = err instanceof Error ? err.message : "Erro interno ao salvar currículo."
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
