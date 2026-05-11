import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { Resend } from 'resend'
import SetupPasswordEmail from '@/emails/SetupPasswordEmail'
import crypto from 'crypto'

export async function POST(request: Request) {
    try {
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
        }

        const { colaboradorId } = await request.json()
        if (!colaboradorId) {
            return NextResponse.json({ error: 'ID do colaborador ausente' }, { status: 400 })
        }

        const adminDb = createAdminClient()

        const { data: colab, error: fetchError } = await adminDb
            .from('colaboradores')
            .select('id, nome_completo, email, user_id')
            .eq('id', colaboradorId)
            .single()

        if (fetchError || !colab) {
            return NextResponse.json({ error: 'Colaborador não encontrado' }, { status: 404 })
        }

        // Gerar novo setup_token (invalida o anterior)
        const setupToken = crypto.randomUUID()
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString()

        const { error: updateError } = await adminDb
            .from('colaboradores')
            .update({ setup_token: setupToken, setup_token_expires_at: expiresAt })
            .eq('id', colaboradorId)

        if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 })
        }

        // Garantir que o usuário no Auth está desbloqueado (caso tenha sido banido antes)
        await adminDb.auth.admin.updateUserById(colab.user_id, { ban_duration: 'none' })

        const fallbackHost = request.headers.get('host') || 'localhost:3000'
        const fallbackProto = request.headers.get('x-forwarded-proto') || (fallbackHost.includes('localhost') ? 'http' : 'https')
        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || `${fallbackProto}://${fallbackHost}`
        const setupLink = `${baseUrl}/setup-senha?token=${setupToken}`

        const resend = new Resend(process.env.RESEND_API_KEY || 're_dummy')
        const { error: resendError } = await resend.emails.send({
            from: 'Cuca Portal <onboarding@cucaatendemais.com.br>',
            to: colab.email,
            subject: 'Cuca Portal: Redefinição de Acesso',
            react: SetupPasswordEmail({ nome: colab.nome_completo, setupLink }),
        })

        if (resendError) {
            console.error('Erro Resend:', resendError)
            return NextResponse.json(
                { message: 'Token renovado, mas falha no envio do e-mail. Use o link abaixo.', setupLink },
                { status: 200 }
            )
        }

        return NextResponse.json({ message: 'Convite reenviado com sucesso!' }, { status: 200 })

    } catch (error: any) {
        console.error('Erro fatal resend-invite:', error)
        return NextResponse.json({ error: 'Erro interno no servidor' }, { status: 500 })
    }
}
