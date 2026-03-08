import { NextResponse } from "next/server"

// Fire-and-forget: processa CV de candidatura espontânea via worker
// O worker usa GPT-4o Vision para extrair skills e atualiza talent_bank.skills_jsonb
export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { nome, telefone, cv_url } = body

        if (!cv_url || !telefone) {
            return NextResponse.json({ error: "Faltam parâmetros" }, { status: 400 })
        }

        const workerUrl = process.env.WORKER_URL || "http://127.0.0.1:8000"

        // Dispara para o worker sem aguardar resultado (edge timeout)
        fetch(`${workerUrl}/process-cv-espontaneo`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nome, telefone, cv_url }),
        }).catch(() => null)

        return NextResponse.json({ ok: true })
    } catch (error: any) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }
}
