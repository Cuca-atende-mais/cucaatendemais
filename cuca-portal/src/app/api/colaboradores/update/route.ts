import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { autorizarOperacaoColaborador } from '@/lib/auth/colaboradores-acesso-server'

export async function POST(request: Request) {
    try {
        const body = await request.json()
        const { id, nome_completo, telefone, role_id, unidade_cuca, ativo } = body

        if (!id) {
            return NextResponse.json({ error: 'ID do colaborador ausente' }, { status: 400 })
        }
        if (typeof ativo !== 'boolean') {
            return NextResponse.json({ error: 'Campo ativo inválido' }, { status: 400 })
        }

        const adminDb = createAdminClient()
        const adminAuth = adminDb.auth

        // user_id e perfil atual vêm do banco, nunca do corpo da requisição.
        const { data: alvo, error: alvoError } = await adminDb
            .from('colaboradores')
            .select('id, user_id, email, role_id')
            .eq('id', id)
            .single()

        if (alvoError || !alvo) {
            return NextResponse.json({ error: 'Colaborador não encontrado' }, { status: 404 })
        }

        const acesso = await autorizarOperacaoColaborador({
            operacao: 'update',
            emailAlvo: alvo.email,
            roleIdNovo: role_id !== alvo.role_id ? role_id : undefined,
        })
        if (!acesso.ok) return acesso.resposta

        const user_id = alvo.user_id

        // 1. Atualizar a tabela de colaboradores
        const { error: updateError } = await adminDb
            .from('colaboradores')
            .update({
                nome_completo,
                telefone,
                ...(role_id !== undefined ? { role_id: role_id || null } : {}),
                unidade_cuca,
                ativo
            })
            .eq('id', id)

        if (updateError) {
            return NextResponse.json({ error: updateError.message }, { status: 500 })
        }

        // 2. Bloquear ou Desbloquear o login no Supabase Auth
        // Se inativo, banir por 10 anos (87600h). Se ativo, remover o ban (none).
        const banDuration = ativo ? "none" : "87600h"

        const { error: authError } = await adminAuth.admin.updateUserById(user_id, {
            ban_duration: banDuration,
            user_metadata: {
                name: nome_completo,
                ativo: ativo
            }
        })

        if (authError) {
            console.error("Erro ao banir/desbanir no auth:", authError)
            return NextResponse.json({ error: authError.message }, { status: 500 })
        }

        return NextResponse.json({ message: 'Colaborador atualizado com sucesso!' }, { status: 200 })

    } catch (error: any) {
        console.error("Erro fatal update auth:", error)
        return NextResponse.json({ error: 'Erro interno no servidor' }, { status: 500 })
    }
}
