import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { Resend } from 'resend'
import SetupPasswordEmail from '@/emails/SetupPasswordEmail'
import crypto from 'crypto'

export async function POST(request: Request) {
    try {
        const resend = new Resend(process.env.RESEND_API_KEY || 're_dummy')

        // 1. Validação real no servidor — getUser() verifica o JWT com o Supabase Auth server-side
        const supabase = await createClient()
        const { data: { user }, error: authError } = await supabase.auth.getUser()
        if (authError || !user) {
            return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
        }

        const body = await request.json()
        const { email, nome, unidadeCuca, roleId } = body

        if (!email || !nome || !roleId) {
            return NextResponse.json({ error: 'Dados incompletos' }, { status: 400 })
        }

        const adminAuth = createAdminClient().auth
        const adminDb = createAdminClient()

        // 2. Verificar se e-mail já existe na tabela colaboradores
        const { data: existingColab } = await adminDb
            .from('colaboradores')
            .select('id')
            .eq('email', email)
            .maybeSingle()

        if (existingColab) {
            return NextResponse.json({ error: 'Já existe um colaborador cadastrado com este e-mail.' }, { status: 409 })
        }

        // 3. Criar usuário no Supabase Auth
        // Se e-mail já existe no Auth (mas não em colaboradores), buscamos por paginação filtrada
        let userId = ""
        let createdNewAuthUser = false

        const tempPassword = crypto.randomBytes(20).toString('hex')
        const { data: authData, error: createUserError } = await adminAuth.admin.createUser({
            email,
            password: tempPassword,
            email_confirm: true,
            user_metadata: { name: nome }
        })

        if (createUserError) {
            // Se o erro é de e-mail duplicado no Auth, buscar o user_id existente
            const isAlreadyRegistered = createUserError.message.toLowerCase().includes('already registered')
                || createUserError.message.toLowerCase().includes('already been registered')
            if (!isAlreadyRegistered) {
                console.error("Erro Auth Supabase:", createUserError)
                return NextResponse.json({ error: createUserError.message }, { status: 400 })
            }
            // Buscar usuário existente no Auth por e-mail (paginação — aceitável pois sabemos que existe)
            let found = false
            let page = 1
            while (!found) {
                const { data: listData } = await adminAuth.admin.listUsers({ page, perPage: 50 })
                const match = listData?.users?.find(u => u.email === email)
                if (match) { userId = match.id; found = true; break }
                if (!listData?.users?.length || listData.users.length < 50) break
                page++
            }
            if (!found) {
                return NextResponse.json({ error: 'Usuário existe no Auth mas não foi localizado.' }, { status: 500 })
            }
        } else {
            userId = authData.user.id
            createdNewAuthUser = true
        }

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
            if (createdNewAuthUser) await adminAuth.admin.deleteUser(userId)
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
