import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/admin"
import crypto from "crypto"

/**
 * TASK 2: API de Solicitação de Feedback (Backend Portal)
 * POST /api/empregabilidade/vagas/[id]/solicitar-feedback
 */
export async function POST(
    request: NextRequest,
    { params }: { params: { id: string } }
) {
    const vagaId = params.id
    const supabaseAdmin = createClient()

    try {
        // 1. Validar existência da vaga e obter dados da empresa
        const { data: vaga, error: vagaErr } = await supabaseAdmin
            .from("vagas")
            .select(`
                id,
                titulo,
                unidade_cuca,
                empresa_id,
                empresas (
                    telefone,
                    nome
                )
            `)
            .eq("id", vagaId)
            .single()

        if (vagaErr || !vaga) {
            return NextResponse.json({ error: "Vaga não encontrada." }, { status: 404 })
        }

        const empresa = (vaga.empresas as any)
        const telefoneRH = empresa?.telefone

        if (!telefoneRH) {
            return NextResponse.json({ error: "Empresa não possui telefone de contato cadastrado." }, { status: 400 })
        }

        // 2. Gerar token único (UUID v4)
        const token = crypto.randomUUID()
        const expiresAt = new Date()
        expiresAt.setHours(expiresAt.getHours() + 48) // Expira em 48h

        // 3. Salvar no banco
        const { error: tokenErr } = await supabaseAdmin
            .from("vagas_feedback_tokens")
            .insert({
                vaga_id: vagaId,
                token,
                expires_at: expiresAt.toISOString(),
                used: false
            })

        if (tokenErr) throw tokenErr

        // 4. Buscar instância de WhatsApp da unidade (Preferencialmente 'Empregabilidade')
        const { data: instancias } = await supabaseAdmin
            .from("instancias_uazapi")
            .select("token")
            .eq("unidade_cuca", vaga.unidade_cuca)
            .eq("ativa", true)
            .order("canal_tipo", { ascending: true }) // Empregabilidade (E) vem antes de Institucional (I)? Não, melhor explicitamente
            .limit(10)

        // Priorizar Empregabilidade
        const instancia = instancias?.find(i => (i as any).canal_tipo === "Empregabilidade") || instancias?.[0]

        if (!instancia) {
            // Se não houver da unidade, tenta uma global do tipo Empregabilidade
            const { data: instGlobal } = await supabaseAdmin
                .from("instancias_uazapi")
                .select("token")
                .eq("canal_tipo", "Empregabilidade")
                .eq("ativa", true)
                .limit(1)
                .single()
            
            if (!instGlobal) {
               // Silenciosamente falha ou avisa no log, mas não mata a requisição se o token foi gerado
               console.error("Nenhuma instância WhatsApp encontrada para enviar o link.")
            }
        }

        const uazapiToken = instancia?.token || (instancias?.[0] as any)?.token

        // 5. Enviar mensagem via UAZAPI (Worker)
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "http://localhost:3000"
        const feedbackLink = `${appUrl}/feedback-empresa/${token}`
        const mensagem = `Olá, equipe de RH da *${empresa.nome}*! 👋\n\nGostaríamos de solicitar o seu feedback sobre os candidatos encaminhados para a vaga de *${vaga.titulo}*.\n\nPor favor, acesse o link seguro abaixo para avaliar os candidatos:\n🔗 ${feedbackLink}\n\nO link expira em 48h. Agradecemos a parceria! 🚀`

        if (uazapiToken) {
            const workerUrl = process.env.WORKER_URL || "http://127.0.0.1:8000"
            const telLimpo = telefoneRH.replace(/\D/g, "")
            const phone = telLimpo.startsWith("55") ? telLimpo : `55${telLimpo}`

            await fetch(`${workerUrl}/send-message/${uazapiToken}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phone, message: mensagem }),
            })
        }

        return NextResponse.json({ success: true, token, expires_at: expiresAt })
    } catch (err: any) {
        console.error("[solicitar-feedback] Erro:", err)
        return NextResponse.json({ error: err.message || "Erro interno" }, { status: 500 })
    }
}
