import { NextResponse } from 'next/server'

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { candidatura_id, cv_url, vaga_id } = body

        if (!candidatura_id || !cv_url || !vaga_id) {
            return NextResponse.json({ error: 'Faltam parâmetros obrigatórios' }, { status: 400 })
        }

        // Envia para o Worker em localhost na porta 8000 (Onde o FastAPI roda)
        // Isso previne que o Frontend React tente acessar a porta 8000 (CORS/Exposição)
        const workerUrl = process.env.WORKER_URL || 'http://127.0.0.1:8000'

        const response = await fetch(`${workerUrl}/process-cv`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                candidatura_id,
                cv_url,
                vaga_id
            })
        })

        if (!response.ok) {
            const errorText = await response.text()
            throw new Error(`Worker retornou erro: ${response.status} - ${errorText}`)
        }

        const data = await response.json()
        return NextResponse.json(data)

    } catch (error: any) {
        console.error("Erro na API roteadora de CV:", error)
        return NextResponse.json({ error: error.message || 'Erro interno ao repassar OCR' }, { status: 500 })
    }
}
