import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

// OCR pode demorar até 5 min para lotes maiores
export const maxDuration = 300

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { id: vagaId } = await params
    const body = await request.json().catch(() => ({}))
    const quantidade: number = Math.max(1, Math.min(Number(body.quantidade) || 5, 50))

    try {
        const { data: vaga, error: vagaErr } = await supabase
            .from("vagas")
            .select("titulo, descricao, requisitos, escolaridade_minima, tipo_contrato, setor")
            .eq("id", vagaId)
            .single()

        if (vagaErr || !vaga) {
            return NextResponse.json({ error: "Vaga não encontrada." }, { status: 404 })
        }

        const workerUrl = process.env.WORKER_URL || "http://127.0.0.1:8000"
        // OCR por PDF demora ~15-30s cada — timeout de 5 min para cobrir até 10 currículos
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000)
        const res = await fetch(`${workerUrl}/triar-banco-talentos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                vaga_id: vagaId,
                quantidade,
                setor_vaga: (vaga as any).setor || [],
            }),
            signal: controller.signal,
        })
        clearTimeout(timeoutId)

        if (!res.ok) {
            const err = await res.text()
            throw new Error(`Worker retornou erro: ${err}`)
        }

        const data = await res.json()
        return NextResponse.json({ candidatos: data.candidatos || [] })
    } catch (err: any) {
        console.error("[triar-banco-talentos] Erro:", err)
        return NextResponse.json({ error: err.message || "Erro interno." }, { status: 500 })
    }
}
