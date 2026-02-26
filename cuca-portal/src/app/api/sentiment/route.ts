import { NextResponse } from 'next/server'

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { registro_id, texto } = body

        if (!registro_id || !texto) {
            return NextResponse.json({ error: 'Faltam parâmetros obrigatórios' }, { status: 400 })
        }

        const workerUrl = process.env.WORKER_URL || 'http://127.0.0.1:8000'

        const response = await fetch(`${workerUrl}/analyse-sentiment`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                registro_id,
                texto
            })
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`Worker retornou erro: ${response.status} - ${errorText}`)
        }

        const data = await response.json()
        return NextResponse.json(data)

    } catch (error: any) {
        console.error("Erro na API de Sentimento:", error)
        return NextResponse.json({ error: error.message || 'Erro interno ao processar sentimento' }, { status: 500 })
    }
}
