import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { autorizarOperacaoColaborador } from '@/lib/auth/colaboradores-acesso-server'

export async function POST(request: Request) {
    try {
        const { colaboradorId } = await request.json()
        if (!colaboradorId) {
            return NextResponse.json({ error: 'ID do colaborador ausente' }, { status: 400 })
        }

        const adminDb = createAdminClient()

        const { data: colab, error: fetchError } = await adminDb
            .from('colaboradores')
            .select('id, user_id, email')
            .eq('id', colaboradorId)
            .single()

        if (fetchError || !colab) {
            return NextResponse.json({ error: 'Colaborador não encontrado' }, { status: 404 })
        }

        const acesso = await autorizarOperacaoColaborador({ operacao: 'delete', emailAlvo: colab.email })
        if (!acesso.ok) return acesso.resposta

        // Remover da tabela colaboradores primeiro
        const { error: deleteError } = await adminDb
            .from('colaboradores')
            .delete()
            .eq('id', colaboradorId)

        if (deleteError) {
            return NextResponse.json({ error: deleteError.message }, { status: 500 })
        }

        // Remover do Supabase Auth (melhor esforço — não bloqueia se falhar)
        const { error: authDeleteError } = await adminDb.auth.admin.deleteUser(colab.user_id)
        if (authDeleteError) {
            console.error('Aviso: colaborador removido da tabela, mas erro ao remover do Auth:', authDeleteError.message)
        }

        return NextResponse.json({ message: 'Colaborador removido com sucesso!' }, { status: 200 })

    } catch (error: any) {
        console.error('Erro fatal delete colaborador:', error)
        return NextResponse.json({ error: 'Erro interno no servidor' }, { status: 500 })
    }
}
