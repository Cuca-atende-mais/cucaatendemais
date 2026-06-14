import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

// ⚠️ MODO CAPTURA (TEMPORÁRIO) — S-AE-02 sub-fatia diagnóstica.
// Objetivo: descobrir o ESQUEMA HMAC (header + algoritmo + encoding + o que é assinado) e o SHAPE
// do payload da AuctaFlux, que NÃO estão na doc/console. Aqui NÃO validamos assinatura nem
// persistimos em ae_conversas/ae_mensagens — apenas gravamos headers + corpo CRU em
// ae_webhook_capturas para análise via MCP. SUBSTITUIR por validação HMAC real + persistência
// antes de ir a produção (não deixar este accept-all público ativo no go-live).

export const dynamic = "force-dynamic"

async function capturar(req: NextRequest, metodo: string) {
    // Corpo CRU é essencial: o HMAC é calculado sobre os bytes crus, não sobre o JSON reparseado.
    let corpo = ""
    try {
        corpo = await req.text()
    } catch {
        corpo = ""
    }
    const headers = Object.fromEntries(req.headers.entries())
    const url = req.nextUrl.pathname + (req.nextUrl.search || "")

    // Log também no stdout (caso haja acesso aos logs do serviço).
    console.log(`[AE webhook CAPTURA] ${metodo} ${url}`, JSON.stringify({ headers, corpoLen: corpo.length }))

    try {
        const admin = createAdminClient()
        await admin.from("ae_webhook_capturas").insert({ metodo, url, headers, corpo })
    } catch (e) {
        console.error("[AE webhook CAPTURA] falha ao gravar captura:", e)
    }
}

// Alguns provedores fazem um GET de verificação ao salvar a URL — respondemos 200 e capturamos.
export async function GET(req: NextRequest) {
    await capturar(req, "GET")
    // Eco de hub.challenge se vier (padrão Meta de verificação) — inofensivo caso não venha.
    const challenge = req.nextUrl.searchParams.get("hub.challenge")
    if (challenge) return new NextResponse(challenge, { status: 200 })
    return NextResponse.json({ ok: true, mode: "capture" })
}

export async function POST(req: NextRequest) {
    await capturar(req, "POST")
    // 200 para a AuctaFlux considerar o evento entregue (não reenfileirar).
    return NextResponse.json({ ok: true, mode: "capture" })
}
