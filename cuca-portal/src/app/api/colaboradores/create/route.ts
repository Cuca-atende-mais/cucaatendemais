import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { Resend } from 'resend'
import SetupPasswordEmail from '@/emails/SetupPasswordEmail'
import crypto from 'crypto'

export async function POST(request: Request) {
    try {
        const resend = new Resend(process.env.RESEND_API_KEY || 're_dummy')

        // 1. Check if user is authenticated (Basic protection)
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
        const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        const supabase = await createClient()

        const { data: { session } } = await supabase.auth.getSession()
        if (!session) {
            return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
        }

        const body = await request.json()
        const { email, nome, unidadeCuca, roleId } = body

        if (!email || !nome || !roleId) {
            return NextResponse.json({ error: 'Dados incompletos' }, { status: 400 })
        }

        const adminAuth = createAdminClient().auth
        const adminDb = createAdminClient() // Usamos o adminClient para contornar RLS na inserção se necessário

        // 2. Criar o usuário no Supabase Auth "Silenciosamente"
        const tempPassword = crypto.randomBytes(16).toString('hex') + 'A1!'

        const { data: authData, error: authError } = await adminAuth.admin.createUser({
            email,
            password: tempPassword,
            email_confirm: true, // Isso desliga o envio de email automático do Supabase
            user_metadata: {
                name: nome
            }
        })

        if (authError) {
            console.error("Erro Auth Supabase:", authError)
            return NextResponse.json({ error: authError.message }, { status: 400 })
        }

        const userId = authData.user.id

        // 3. Cadastrar na tabela de colaboradores com Tenant e Permissão
        const setupToken = crypto.randomUUID()
        const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() // 48h

        const { error: colabError } = await adminDb
            .from('colaboradores')
            .insert({
                user_id: userId,
                nome_completo: nome,
                email,
                unidade_cuca: unidadeCuca || null,
                role_id: roleId,
                setup_token: setupToken,
                setup_token_expires_at: expiresAt
            })

        if (colabError) {
            // Rollback em caso de falha
            await adminAuth.admin.deleteUser(userId)
            console.error("Erro Tabela Colaboradores:", colabError)
            return NextResponse.json({ error: colabError.message }, { status: 500 })
        }

        // 4. Disparar E-mail usando Resend
        const fallbackHost = request.headers.get('host') || 'localhost:3000'
        const fallbackProto = request.headers.get('x-forwarded-proto') || (fallbackHost.includes('localhost') ? 'http' : 'https')
        const dynamicBaseUrl = `${fallbackProto}://${fallbackHost}`

        const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || dynamicBaseUrl
        const setupLink = `${baseUrl}/setup-senha?token=${setupToken}`

        try {
            const { error: resendError } = await resend.emails.send({
                from: 'Cuca Portal <onboarding@cucaatendemais.com.br>',
                to: email, // Atenção: No plano Free do Resend, sem o domínio verificado, isso só chega pro dono da conta Resend
                subject: 'Acesso ao Cuca Portal: Crie sua senha',
                react: SetupPasswordEmail({ nome, setupLink }),
            })

            if (resendError) {
                console.error("Erro Resend:", resendError)
                // Não damos rollback pq o usuário foi criado, apenas o e-mail falhou. Pode-se reenviar dps.
                return NextResponse.json({ message: 'Colaborador criado, mas houve erro no envio de e-mail', setupLink }, { status: 201 })
            }

        } catch (mailErr) {
            console.error("Erro Resend Exceção:", mailErr)
            return NextResponse.json({ message: 'Colaborador criado, exceção no e-mail', setupLink }, { status: 201 })
        }

        return NextResponse.json({ message: 'Colaborador criado e convite enviado com sucesso!' }, { status: 201 })

    } catch (error: any) {
        console.error("Erro fatal:", error)
        return NextResponse.json({ error: 'Erro interno no servidor' }, { status: 500 })
    }
}
