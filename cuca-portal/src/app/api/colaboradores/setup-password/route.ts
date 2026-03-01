import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { token, password } = body

        if (!token || !password) {
            return NextResponse.json({ error: 'Token ou senha ausentes' }, { status: 400 })
        }

        const adminDb = createAdminClient()
        const adminAuth = createAdminClient().auth

        // 1. Procurar o token no banco de dados
        const { data: colab, error: fetchError } = await adminDb
            .from('colaboradores')
            .select('user_id, setup_token_expires_at')
            .eq('setup_token', token)
            .single()

        if (fetchError || !colab) {
            return NextResponse.json({ error: 'Token de setup inválido ou expirado' }, { status: 400 })
        }

        // 2. Verificar expiração do token
        const expiresAt = new Date(colab.setup_token_expires_at)
        if (expiresAt < new Date()) {
            return NextResponse.json({ error: 'O link de setup expirou. Solicite um novo à administração.' }, { status: 400 })
        }

        // 3. Atualizar a senha no Supabase Auth
        const { error: updateAuthError } = await adminAuth.admin.updateUserById(
            colab.user_id,
            { password: password }
        )

        if (updateAuthError) {
            console.error("Erro ao atualizar senha auth:", updateAuthError)
            return NextResponse.json({ error: 'Falha ao atualizar a senha' }, { status: 500 })
        }

        // 4. Inutilizar o Token no banco para não ser usado de novo
        await adminDb
            .from('colaboradores')
            .update({
                setup_token: null,
                setup_token_expires_at: null
            })
            .eq('user_id', colab.user_id)

        return NextResponse.json({ message: 'Senha registrada com sucesso!' }, { status: 200 })

    } catch (error: any) {
        console.error("Erro fatal Setup Password:", error)
        return NextResponse.json({ error: 'Erro interno no servidor' }, { status: 500 })
    }
}
