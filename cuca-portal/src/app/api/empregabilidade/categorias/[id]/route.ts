import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

function getAdmin() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
}

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const body = await request.json()
    const { nome, icone, ordem, ativo } = body

    if (!nome?.trim()) {
        return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 })
    }

    const supabase = getAdmin()
    const { data, error } = await supabase
        .from("categorias_interesse")
        .update({
            nome: nome.trim(),
            icone: icone?.trim() || null,
            ...(typeof ordem === "number" ? { ordem } : {}),
            ativo: ativo !== false,
        })
        .eq("id", id)
        .select()
        .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
}

export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const supabase = getAdmin()

    // Verifica se há filhos (modalidades vinculadas a este eixo)
    const { count } = await supabase
        .from("categorias_interesse")
        .select("id", { count: "exact", head: true })
        .eq("pai_id", id)

    if ((count ?? 0) > 0) {
        return NextResponse.json(
            { error: `Este eixo possui ${count} modalidade(s). Remova-as antes de excluir o eixo.` },
            { status: 409 }
        )
    }

    const { error } = await supabase
        .from("categorias_interesse")
        .delete()
        .eq("id", id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
}
