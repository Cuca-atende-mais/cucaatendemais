import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
    try {
        const { candidatura_id, cv_url, vaga_id } = await request.json()

        if (!candidatura_id || !cv_url || !vaga_id) {
            return NextResponse.json({ error: "Parâmetros ausentes." }, { status: 400 })
        }

        const workerUrl = process.env.WORKER_URL
        if (!workerUrl) {
            return NextResponse.json({ error: "WORKER_URL não configurado." }, { status: 500 })
        }

        const res = await fetch(`${workerUrl}/process-cv`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ candidatura_id, cv_url, vaga_id }),
        })

        if (!res.ok) {
            return NextResponse.json({ error: "Erro ao disparar análise de IA no worker." }, { status: 502 })
        }

        return NextResponse.json({ ok: true })
    } catch (err: any) {
        console.error("[disparar-ia] Erro:", err)
        return NextResponse.json({ error: err.message || "Erro interno." }, { status: 500 })
    }
}
