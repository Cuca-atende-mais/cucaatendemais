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
        const linha = Array.isArray(consumed) ? consumed[0] : null
        if (linha?.talent_id !== talentId) {
            return NextResponse.json({ error: "Link inválido ou expirado." }, { status: 403 })
        }

        // SQS-63: cada token já sabe, desde que foi emitido, se autoriza o
        // PDF ou o DOCX (coluna `tipo`) — o candidato pode ter os dois links
        // na tela ao mesmo tempo, cada um de uso único e válido só pro seu
        // próprio arquivo.
        const tipo = linha?.tipo === "docx" ? "docx" : "pdf"
        const coluna = tipo === "docx" ? "arquivo_docx_url" : "arquivo_cv_url"

        const { data: talent, error: talentErr } = await supabase
            .from("talent_bank")
            .select(coluna)
            .eq("id", talentId)
            .single()

        const arquivoUrl = (talent as Record<string, string | null> | null)?.[coluna] || null
        if (talentErr || !arquivoUrl) {
            return NextResponse.json({ error: "Currículo não encontrado." }, { status: 404 })
        }

        const arquivoRes = await fetch(arquivoUrl)
        if (!arquivoRes.ok || !arquivoRes.body) {
            return NextResponse.json({ error: "Não foi possível carregar o arquivo." }, { status: 502 })
        }

        const contentType = tipo === "docx"
            ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            : "application/pdf"
        const filename = tipo === "docx" ? `curriculo-${talentId}.docx` : `curriculo-${talentId}.pdf`

        return new NextResponse(arquivoRes.body, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Content-Disposition": `attachment; filename="${filename}"`,
                "Cache-Control": "no-store",
            },
        })
    } catch (err: unknown) {
        console.error("[curriculo/download] Erro:", err)
        return NextResponse.json({ error: "Erro ao baixar currículo." }, { status: 500 })
    }
}
