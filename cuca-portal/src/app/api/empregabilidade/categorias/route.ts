import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

function getAdmin() {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
}

export async function GET() {
    const supabase = getAdmin()
    const { data, error } = await supabase
        .from("categorias_interesse")
        .select("id, nome, icone, ordem, ativo, pai_id, created_at")
        .order("ordem", { ascending: true })

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
}

export async function POST(request: NextRequest) {
    const body = await request.json()
    const { nome, icone, ordem, ativo, pai_id } = body

    if (!nome?.trim()) {
        return NextResponse.json({ error: "Nome é obrigatório" }, { status: 400 })
    }

    const supabase = getAdmin()

    // Calcula ordem automática se não fornecida
    let ordemFinal = typeof ordem === "number" ? ordem : null
    if (ordemFinal === null) {
        const { data: ultimo } = await supabase
            .from("categorias_interesse")
            .select("ordem")
            .is("pai_id", pai_id ?? null)
            .order("ordem", { ascending: false })
            .limit(1)
            .maybeSingle()
        ordemFinal = (ultimo?.ordem ?? 0) + 1
    }

    const { data, error } = await supabase
        .from("categorias_interesse")
        .insert({
            nome: nome.trim(),
            icone: icone?.trim() || null,
            ordem: ordemFinal,
            ativo: ativo !== false,
            pai_id: pai_id ?? null,
        })
        .select()
        .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data, { status: 201 })
}
