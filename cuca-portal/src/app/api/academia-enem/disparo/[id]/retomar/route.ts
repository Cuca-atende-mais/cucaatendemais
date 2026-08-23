import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

// A-3 (achado QA, 2026-08-23) — "Reenviar pendentes" pra disparo pausado por teto diário/erro.
// Ação de escrita real (dispara envio de WhatsApp) — can_update, não can_read, mesmo raciocínio
// já usado em acompanhamento-envios/reenviar/route.ts (S-WM-59).
async function checkAuth(recurso: string, acao: string) {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { error: "Não autenticado", status: 401 as const }
    const { data: ok } = await supabase.rpc("has_permission", { p_recurso: recurso, p_acao: acao })
    if (!ok) return { error: "Sem permissão", status: 403 as const }
    return { error: null }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const gate = await checkAuth("ae_disparo", "update")
        if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status })

        const { id } = await params
        if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 })

        const internalToken = process.env.WEBHOOK_INTERNAL_TOKEN
        if (!internalToken) {
            console.error("[academia-enem/disparo/retomar] WEBHOOK_INTERNAL_TOKEN não configurado no portal")
            return NextResponse.json({ error: "Integração com o worker não configurada." }, { status: 500 })
        }

        // CRÍTICO: sempre WORKER_URL_ACADEMIA_ENEM, nunca WORKER_URL — só o serviço isolado
        // (cuca-academia-enem) tem o META_SYSTEM_USER_TOKEN certo pro número da Academia Enem
        // (mesma env já usada por chat/send-message/route.ts pra este mesmo propósito).
        const workerUrl = (process.env.WORKER_URL_ACADEMIA_ENEM || "").replace(/\/$/, "")
        if (!workerUrl) {
            return NextResponse.json({ error: "WORKER_URL_ACADEMIA_ENEM não configurado." }, { status: 500 })
        }

        const resp = await fetch(`${workerUrl}/academia-enem/disparo/${encodeURIComponent(id)}/retomar`, {
            method: "POST",
            headers: { "x-internal-token": internalToken },
        })

        const texto = await resp.text()
        if (!resp.ok) {
            return NextResponse.json({ error: texto || "Falha ao acionar a retomada" }, { status: resp.status })
        }

        return NextResponse.json({ ok: true, worker: texto })
    } catch (e) {
        const msg = e instanceof Error ? e.message : "Erro interno"
        console.error("[academia-enem/disparo/retomar]", e)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
