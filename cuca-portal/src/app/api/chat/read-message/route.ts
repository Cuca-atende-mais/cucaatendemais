import { NextRequest, NextResponse } from "next/server"

const WORKER_TIMEOUT_MS = 5000

export async function POST(req: NextRequest) {
    const workerUrl = process.env.WORKER_URL || process.env.NEXT_PUBLIC_WORKER_URL || ""
    const token = process.env.WEBHOOK_INTERNAL_TOKEN || ""

    if (!workerUrl || !token) return NextResponse.json({ ok: false }, { status: 500 })

    const body = await req.json()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), WORKER_TIMEOUT_MS)

    try {
        await fetch(`${workerUrl}/read-message/${token}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
        })
    } catch {
        // silencia — marcar como lido não é crítico
    } finally {
        clearTimeout(timeout)
    }

    return NextResponse.json({ ok: true })
}
