import { NextRequest, NextResponse } from "next/server"

const WORKER_TIMEOUT_MS = 12000

// Proxy server-side: mantém WEBHOOK_INTERNAL_TOKEN fora do bundle do browser
export async function POST(req: NextRequest) {
    const workerUrl = process.env.WORKER_URL || process.env.NEXT_PUBLIC_WORKER_URL || ""
    const token = process.env.WEBHOOK_INTERNAL_TOKEN || ""

    if (!workerUrl || !token) {
        return NextResponse.json({ error: "Worker não configurado" }, { status: 500 })
    }

    const body = await req.json()
    const { number, text, instance } = body

    if (!number || !text || !instance) {
        return NextResponse.json({ error: "number, text e instance são obrigatórios" }, { status: 400 })
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS)

    try {
        const resp = await fetch(`${workerUrl}/send-message/${token}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ number, text, instance }),
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
