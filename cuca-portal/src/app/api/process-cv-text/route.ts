import { NextResponse } from 'next/server'
import { createClient } from "@supabase/supabase-js"
import { vagaBloqueiaColetaCurriculo, MSG_BLOQUEIO_COLETA_CURRICULO } from "@/lib/empregabilidade/coleta-curriculo-guard"

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { candidatura_id, cv_text, vaga_id } = body

        if (!candidatura_id || !cv_text || !vaga_id) {
            return NextResponse.json({ error: 'Faltam parâmetros obrigatórios' }, { status: 400 })
        }

        // SQS-56 (AC15): análise de CV pela IA fica desativada para seleções
        // sem coleta de currículo — bloqueio no servidor, não só na UI.
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        )
        if (await vagaBloqueiaColetaCurriculo(supabaseAdmin, vaga_id)) {
            return NextResponse.json({ error: MSG_BLOQUEIO_COLETA_CURRICULO }, { status: 403 })
        }

        const workerUrl = process.env.WORKER_URL || 'http://127.0.0.1:8000'

        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 120_000) // 2 min máximo para análise LLM
        let response: Response
        try {
            response = await fetch(`${workerUrl}/process-cv-text`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ candidatura_id, cv_text, vaga_id }),
                signal: controller.signal,
            })
        } finally {
            clearTimeout(timeout)
        }

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`Worker retornou erro: ${response.status} - ${errorText}`)
        }

        const data = await response.json()
        return NextResponse.json(data)

    } catch (error: any) {
        console.error('[process-cv-text] Erro:', error)
        return NextResponse.json({ error: error.message || 'Erro interno' }, { status: 500 })
    }
}
