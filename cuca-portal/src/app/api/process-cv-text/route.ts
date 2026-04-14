import { NextResponse } from 'next/server'

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { candidatura_id, cv_text, vaga_id } = body

        if (!candidatura_id || !cv_text || !vaga_id) {
            return NextResponse.json({ error: 'Faltam parâmetros obrigatórios' }, { status: 400 })
        }

        const workerUrl = process.env.WORKER_URL || 'http://127.0.0.1:8000'

        const response = await fetch(`${workerUrl}/process-cv-text`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ candidatura_id, cv_text, vaga_id }),
        })

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
