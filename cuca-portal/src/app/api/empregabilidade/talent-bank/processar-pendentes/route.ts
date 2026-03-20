import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}))
        const lote = body.lote ?? 20

        const workerUrl = process.env.WORKER_URL || "http://127.0.0.1:8000"
        const res = await fetch(`${workerUrl}/processar-cvs-pendentes`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lote }),
        })

        if (!res.ok) {
            const err = await res.text()
            throw new Error(`Worker retornou erro: ${err}`)
        }

        const data = await res.json()
        return NextResponse.json(data)
    } catch (err: any) {
        return NextResponse.json({ error: err.message || "Erro interno." }, { status: 500 })
    }
}
