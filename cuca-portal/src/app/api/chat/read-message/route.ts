import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
    const workerUrl = process.env.WORKER_URL || process.env.NEXT_PUBLIC_WORKER_URL || ""
    const token = process.env.WEBHOOK_INTERNAL_TOKEN || ""

    if (!workerUrl || !token) return NextResponse.json({ ok: false }, { status: 500 })

    const body = await req.json()

    try {
        await fetch(`${workerUrl}/read-message/${token}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        })
    } catch {
        // silencia — marcar como lido não é crítico
    }

    return NextResponse.json({ ok: true })
}
