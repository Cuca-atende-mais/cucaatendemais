import { NextRequest, NextResponse } from "next/server"

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

    const resp = await fetch(`${workerUrl}/send-message/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ number, text, instance }),
    })

    const data = await resp.text()
    return new NextResponse(data, { status: resp.status, headers: { "Content-Type": "application/json" } })
}
