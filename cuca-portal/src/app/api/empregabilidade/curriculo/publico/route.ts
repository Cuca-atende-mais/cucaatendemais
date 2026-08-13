import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { parseLinkParams, verificarLinkParams } from "@/lib/empregabilidade/link-assinado"
import { gerarEArmazenarPdfCurriculo } from "@/lib/empregabilidade/curriculo-pdf-service"
import {
    criarRespostaCurriculoPublico,
    criarDownloadToken,
    hashTelefone,
    normalizarCvDados,
} from "@/lib/empregabilidade/curriculo-publico"
import type { CvDados } from "@/lib/empregabilidade/curriculo-tipos"

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
            .select("id")
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

        await gerarEArmazenarPdfCurriculo(supabase, talentId, values)
        const download = criarDownloadToken(talentId, secret)

        const { error: tokenErr } = await supabase
            .from("empregabilidade_curriculo_download_tokens")
            .insert({
                token_hash: download.tokenHash,
                talent_id: talentId,
                expires_at: download.expiresAt,
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
        }))
    } catch (err: unknown) {
        console.error("[curriculo/publico] Erro:", err)
        const message = err instanceof Error ? err.message : "Erro interno ao salvar currículo."
        return NextResponse.json({ error: message }, { status: 500 })
    }
}
