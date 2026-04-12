import { NextRequest, NextResponse } from "next/server"
import { createAdminClient as createClient } from "@/lib/supabase/admin"
import { createClient as createServerClient } from "@/lib/supabase/server"
import crypto from "crypto"

/**
 * TASK 2: API de Solicitação de Feedback (Backend Portal)
 * POST /api/empregabilidade/vagas/[id]/solicitar-feedback
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    // SEC-09: exige usuário autenticado para disparar link de feedback
    const supabaseAuth = await createServerClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    }

    const { id: vagaId } = await params
    const supabaseAdmin = createClient()

    // Ler unidade do operador logado enviada pelo cliente
    let cuca_unit_id: string | null = null
    try {
        const body = await request.json()
        cuca_unit_id = body?.cuca_unit_id || null
    } catch {
        // body vazio é aceitável — token sem filtro de unidade
    }

    try {
        // 1. Validar existência da vaga e obter dados da empresa
        const { data: vaga, error: vagaErr } = await supabaseAdmin
            .from("vagas")
            .select(`
                id,
                titulo,
                unidade_cuca,
                empresa_id,
                telefone_responsavel,
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
        // Prioriza telefone do responsável da vaga; fallback para telefone geral da empresa
        const telefoneRH = (vaga as any).telefone_responsavel || empresa?.telefone

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
                used: false,
                ...(cuca_unit_id ? { cuca_unit_id } : {})
            })

        if (tokenErr) throw tokenErr

        // 4. Buscar instância de WhatsApp da unidade (Empregabilidade > Institucional > qualquer ativa)
        const { data: instancias } = await supabaseAdmin
            .from("instancias_uazapi")
            .select("nome, token, canal_tipo")
            .eq("unidade_cuca", vaga.unidade_cuca)
            .eq("ativa", true)
            .limit(10)

        let instancia = instancias?.find(i => i.canal_tipo === "Empregabilidade")
            || instancias?.find(i => i.canal_tipo === "Institucional")
            || instancias?.[0]

        if (!instancia) {
            // Fallback: qualquer instância Empregabilidade ativa na rede
            const { data: instGlobal } = await supabaseAdmin
                .from("instancias_uazapi")
                .select("nome, token, canal_tipo")
                .eq("canal_tipo", "Empregabilidade")
                .eq("ativa", true)
                .limit(1)
                .single()
            if (instGlobal) instancia = instGlobal
        }

        if (!instancia) {
            return NextResponse.json({ error: "Nenhuma instância WhatsApp ativa encontrada para enviar o feedback." }, { status: 500 })
        }

        // 5. Enviar mensagem via Worker -> UAZAPI (mesmo padrão de /vagas/convocar)
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "http://localhost:3000"
        const feedbackLink = `${appUrl}/feedback-empresa/${token}`
        const mensagem = `Olá, equipe de RH da *${empresa.nome}*! 👋\n\nGostaríamos de solicitar o seu feedback sobre os candidatos encaminhados para a vaga de *${vaga.titulo}*.\n\nPor favor, acesse o link seguro abaixo para avaliar os candidatos:\n🔗 ${feedbackLink}\n\nO link expira em 48h. Agradecemos a parceria! 🚀`

        const workerUrl = process.env.WORKER_URL || "http://127.0.0.1:8000"
        const internalToken = process.env.WEBHOOK_INTERNAL_TOKEN

        if (!internalToken) {
            console.error("[solicitar-feedback] WEBHOOK_INTERNAL_TOKEN não configurado nas variáveis de ambiente do portal")
            return NextResponse.json({ error: "Configuração de integração ausente: WEBHOOK_INTERNAL_TOKEN não definido no portal." }, { status: 500 })
        }

        const telLimpo = telefoneRH.replace(/\D/g, "")
        const number = telLimpo.startsWith("55") ? telLimpo : `55${telLimpo}`

        console.info(`[solicitar-feedback] Enviando para ${number} via instância '${instancia.nome}' — worker: ${workerUrl}`)

        let sendWarning: string | null = null
        try {
            const sendRes = await fetch(`${workerUrl}/send-message/${internalToken}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ number, text: mensagem, instance: instancia.nome }),
            })
            if (!sendRes.ok) {
                const errLog = await sendRes.text()
                console.error(`[solicitar-feedback] Worker retornou ${sendRes.status}: ${errLog}`)
                sendWarning = `Mensagem pode não ter sido enviada (worker ${sendRes.status}). Token criado.`
            }
        } catch (sendErr: any) {
            console.error(`[solicitar-feedback] Erro ao chamar worker:`, sendErr)
            sendWarning = "Erro ao contatar worker. Token criado, mas mensagem pode não ter sido enviada."
        }

        return NextResponse.json({ success: true, token, expires_at: expiresAt, warning: sendWarning })
    } catch (err: any) {
        console.error("[solicitar-feedback] Erro:", err)
        return NextResponse.json({ error: err.message || "Erro interno" }, { status: 500 })
    }
}
