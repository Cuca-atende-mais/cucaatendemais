import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"

export async function POST(req: Request) {
    try {
        const supabase = await createClient()

        // 1. Validar Autenticação no Supabase Auth
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user || !user.email) {
            return NextResponse.json({ error: "Não autorizado." }, { status: 401 })
        }

        // 2. Verificar permissão de Desenvolvedor Restrito
        const allowedEmails = ["valmir@cucateste.com", "dev.cucaatendemais@gmail.com"]
        if (!allowedEmails.includes(user.email)) {
            return NextResponse.json({ error: "Permissão negada. Apenas desenvolvedores podem excluir instâncias permanentemente." }, { status: 403 })
        }

        // 3. Obter nome da Instância a ser deletada
        const body = await req.json()
        const { nome } = body

        if (!nome) {
            return NextResponse.json({ error: "Nome da instância é obrigatório." }, { status: 400 })
        }

        // 4. Repassar requisição para o Worker Python
        const workerUrl = process.env.NEXT_PUBLIC_WORKER_URL || "https://api.cucaatendemais.com.br"

        const workerRes = await fetch(`${workerUrl}/api/instancias/${encodeURIComponent(nome)}/excluir`, {
            method: "DELETE",
        })

        if (!workerRes.ok) {
            const errData = await workerRes.json().catch(() => null)
            return NextResponse.json(
                { error: errData?.detail || `Erro no Worker HTTP ${workerRes.status}` },
                { status: workerRes.status }
            )
        }

        const data = await workerRes.json()
        return NextResponse.json(data)

    } catch (error: any) {
        console.error("Erro rota /api/instancias/excluir:", error)
        return NextResponse.json(
            { error: "Falha interna no servidor ao excluir instância." },
            { status: 500 }
        )
    }
}
