import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { exigirPermissao } from "@/lib/rbac/exigir-permissao-servidor"
import { EPM_FEEDBACK } from "@/lib/rbac/catalogo-empregabilidade-gestao"
import { validarContato } from "@/lib/empregabilidade/contato"

// S-EMP-GES-01 (AC3, AC13): grava o contato na vaga. Não toca em `email_contato_empresa`
// (destino do envio de currículo por e-mail).
export async function PATCH(request: NextRequest) {
    const permissao = await exigirPermissao(EPM_FEEDBACK.contatoEditar)
    if (!permissao.ok) return permissao.resposta

    const body = await request.json().catch(() => ({}))
    if (typeof body?.vaga_id !== "string" || !body.vaga_id) {
        return NextResponse.json({ error: "Vaga inválida." }, { status: 400 })
    }

    const validacao = validarContato(body, { obrigatorio: false })
    if (!validacao.ok) return NextResponse.json({ error: validacao.erros.join(" ") }, { status: 400 })

    const { data: vaga } = await permissao.supabase.from("vagas").select("id").eq("id", body.vaga_id).maybeSingle()
    if (!vaga) return NextResponse.json({ error: "Vaga não encontrada." }, { status: 404 })

    const { contato } = validacao
    const { error } = await createAdminClient()
        .from("vagas")
        .update({
            nome_responsavel: contato.nome,
            telefone_responsavel: contato.telefone,
            email_responsavel: contato.email,
            updated_at: new Date().toISOString(),
        })
        .eq("id", body.vaga_id)
    if (error) {
        console.error("[feedback/contato] Erro:", error)
        return NextResponse.json({ error: "Erro ao salvar o contato." }, { status: 500 })
    }
    return NextResponse.json({ ok: true, contato })
}
