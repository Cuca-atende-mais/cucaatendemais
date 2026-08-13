import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import {
    hashDownloadToken,
    verificarAssinaturaDownload,
} from "@/lib/empregabilidade/curriculo-publico"

export async function GET(request: NextRequest) {
    const secret = process.env.EMPREGABILIDADE_LINK_SECRET || ""
    const params = request.nextUrl.searchParams
    const talentId = params.get("talent_id") || ""
    const token = params.get("token") || ""

    const assinaturaOk = verificarAssinaturaDownload({
        talentId,
        token,
        exp: params.get("exp"),
        sig: params.get("sig"),
        secret,
    })

    if (!talentId || !token || !assinaturaOk) {
        return NextResponse.json({ error: "Link inválido ou expirado." }, { status: 403 })
    }

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    try {
        const { data: consumed, error: consumeErr } = await supabase.rpc(
            "consumir_curriculo_download_token",
            { p_token_hash: hashDownloadToken(token) }
        )

        if (consumeErr) throw consumeErr
        const consumedTalentId = Array.isArray(consumed) ? consumed[0]?.talent_id : null
        if (consumedTalentId !== talentId) {
            return NextResponse.json({ error: "Link inválido ou expirado." }, { status: 403 })
        }

        const { data: talent, error: talentErr } = await supabase
            .from("talent_bank")
            .select("arquivo_cv_url")
            .eq("id", talentId)
            .single()

        if (talentErr || !talent?.arquivo_cv_url) {
            return NextResponse.json({ error: "Currículo não encontrado." }, { status: 404 })
        }

        const pdfRes = await fetch(talent.arquivo_cv_url)
        if (!pdfRes.ok || !pdfRes.body) {
            return NextResponse.json({ error: "Não foi possível carregar o PDF." }, { status: 502 })
        }

        return new NextResponse(pdfRes.body, {
            status: 200,
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `attachment; filename="curriculo-${talentId}.pdf"`,
                "Cache-Control": "no-store",
            },
        })
    } catch (err: unknown) {
        console.error("[curriculo/download] Erro:", err)
        return NextResponse.json({ error: "Erro ao baixar currículo." }, { status: 500 })
    }
}
