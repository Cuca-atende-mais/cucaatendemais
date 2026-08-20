import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"

const WORKER_TIMEOUT_MS = 12000

// S-AE-03: a Academia Enem usa um serviço/worker PRÓPRIO (cuca-academia-enem), com
// credenciais Meta isoladas da conta "Ivida" que atende os demais canais — mandar a
// mensagem pelo WORKER_URL padrão enviaria pelo número/credencial errados. Resolve o
// worker de destino pelo agente_tipo da própria conversa (conversas.agente_tipo, já
// existente), sem precisar que o client informe o canal.
async function resolverWorkerUrl(conversaId: string): Promise<string> {
    try {
        const admin = createAdminClient()
        const { data } = await admin
            .from("conversas")
            .select("agente_tipo")
            .eq("id", conversaId)
            .maybeSingle()
        if (data?.agente_tipo === "academia_enem") {
            const url = process.env.WORKER_URL_ACADEMIA_ENEM || ""
            if (url) return url
            // Sem a env específica configurada ainda (serviço novo, credenciais pendentes) —
            // cai no worker padrão só para não quebrar com erro genérico; o envio real vai
            // falhar no lado do worker (sem o número certo), não silenciosamente.
        }
    } catch {
        // Fail-safe: erro na resolução não deve impedir o envio dos demais canais —
        // cai no worker padrão, mesmo comportamento de sempre.
    }
    return process.env.WORKER_URL || process.env.NEXT_PUBLIC_WORKER_URL || ""
}

// Proxy server-side: mantém WEBHOOK_INTERNAL_TOKEN fora do bundle do browser
export async function POST(req: NextRequest) {
    const token = process.env.WEBHOOK_INTERNAL_TOKEN || ""

    const body = await req.json()
    const { number, text, conversa_id } = body

    if (!number || !text || !conversa_id) {
        return NextResponse.json({ error: "number, text e conversa_id são obrigatórios" }, { status: 400 })
    }

    const workerUrl = await resolverWorkerUrl(conversa_id)

    if (!workerUrl || !token) {
        return NextResponse.json({ error: "Worker não configurado" }, { status: 500 })
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS)

    try {
        const resp = await fetch(`${workerUrl}/send-message/${token}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ number, text, conversa_id }),
            signal: controller.signal,
        })

        const data = await resp.text()
        return new NextResponse(data, { status: resp.status, headers: { "Content-Type": "application/json" } })
    } catch (error: unknown) {
        if (error instanceof Error && error.name === "AbortError") {
            return NextResponse.json({ error: "Timeout ao enviar mensagem pelo worker" }, { status: 504 })
        }
        const message = error instanceof Error ? error.message : "Erro ao conectar ao worker"
        return NextResponse.json({ error: message }, { status: 502 })
    } finally {
        clearTimeout(timeout)
    }
}
