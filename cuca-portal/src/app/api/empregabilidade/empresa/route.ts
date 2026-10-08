import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { exigirPermissao } from "@/lib/rbac/exigir-permissao-servidor"
import { validarContato } from "@/lib/empregabilidade/contato"

export async function GET(request: NextRequest) {
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const id = request.nextUrl.searchParams.get("id")
    if (!id) {
        return NextResponse.json({ error: "id obrigatório" }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
        .from("empresas")
        .select("id, nome")
        .eq("id", id)
        .eq("ativa", true)
        .single()

    if (error || !data) {
        return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 })
    }

    return NextResponse.json(data)
}

// S-EMP-GES-01 (AC15 / D7): cadastro manual de empresa nova pela tela Empresas. Nome, telefone e e-mail
// do contato são obrigatórios aqui (não no banco: automação e importação por planilha seguem iguais).
export async function POST(request: NextRequest) {
    const permissao = await exigirPermissao("empreg_empresas", "create")
    if (!permissao.ok) return permissao.resposta

    const body = await request.json().catch(() => ({}))
    const nome = typeof body?.nome === "string" ? body.nome.trim() : ""
    if (!nome) return NextResponse.json({ error: "Informe o nome da empresa." }, { status: 400 })

    const validacao = validarContato(
        { nome: body?.contato_responsavel, telefone: body?.telefone, email: body?.email },
        { obrigatorio: true },
    )
    if (!validacao.ok) return NextResponse.json({ error: validacao.erros.join(" ") }, { status: 400 })

    const texto = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null)
    const { contato } = validacao
    const { data, error } = await permissao.supabase
        .from("empresas")
        .insert({
            nome,
            cnpj: texto(body?.cnpj),
            endereco: texto(body?.endereco),
            setor: texto(body?.setor),
            porte: texto(body?.porte),
            ativa: body?.ativa !== false,
            contato_responsavel: contato.nome,
            telefone: contato.telefone,
            email: contato.email,
        })
        .select("id")
        .single()

    if (error) {
        console.error("[empresa POST] Erro:", error)
        const duplicado = error.code === "23505"
        return NextResponse.json(
            { error: duplicado ? "Já existe uma empresa com este CNPJ." : "Erro ao criar a empresa." },
            { status: duplicado ? 409 : 500 },
        )
    }
    return NextResponse.json({ ok: true, id: data.id }, { status: 201 })
}
