import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

const BUCKET = "anexos-conversas"
const TTL_SEGUNDOS = 60 // signed URL de curta duração — gerada on-demand a cada abertura,
// nunca persistida no client. S-WM-68: bucket privado, sem URL pública crua.

// GET /api/chat/anexo?path=image/2026/08/27/uuid.jpg
// Gera uma signed URL de curta duração para o anexo (imagem/PDF) de uma
// mensagem de WhatsApp. Requer colaborador autenticado — o mesmo nível de
// acesso já necessário pra ver a conversa em si no painel.
export async function GET(req: NextRequest) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
        return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
    }

    const path = req.nextUrl.searchParams.get("path")
    if (!path) {
        return NextResponse.json({ error: "Parâmetro 'path' é obrigatório" }, { status: 400 })
    }

    try {
        const admin = createAdminClient()
        const { data, error } = await admin.storage
            .from(BUCKET)
            .createSignedUrl(path, TTL_SEGUNDOS)

        if (error || !data?.signedUrl) {
            // AC4/AC5: anexo pode já ter expirado (job de 15 dias) — não é erro
            // de servidor, é "não existe mais".
            return NextResponse.json({ error: "Anexo indisponível (pode ter expirado)." }, { status: 404 })
        }

        return NextResponse.json({ url: data.signedUrl })
    } catch (err: unknown) {
        console.error("[chat/anexo] Erro ao gerar signed URL:", err)
        return NextResponse.json({ error: "Erro ao gerar link do anexo." }, { status: 500 })
    }
}
