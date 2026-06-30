import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"

const DEVELOPER_EMAILS = [
    "valmir@cucateste.com",
    "dev.cucaatendemais@gmail.com",
    "admin@cucadev.com.br",
]

async function assertDeveloper(): Promise<string | null> {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) return null
    if (!DEVELOPER_EMAILS.includes(user.email ?? "")) return null
    return user.email!
}

export async function GET() {
    const email = await assertDeveloper()
    if (!email) {
        return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    }

    const admin = createAdminClient()
    const { data, error } = await admin
        .from("meta_templates")
        .select("*")
        .order("nome", { ascending: true })

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
    const email = await assertDeveloper()
    if (!email) {
        return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    }

    const body = await req.json()
    const { nome, categoria, status, variaveis, automacoes, waba_ids, phone_number_ids, observacoes, ativo, corpo_texto } = body

    if (!nome?.trim()) {
        return NextResponse.json({ error: "Campo obrigatório: nome" }, { status: 400 })
    }

    const admin = createAdminClient()

    const { data: existing } = await admin
        .from("meta_templates")
        .select("id")
        .eq("nome", nome.trim())
        .maybeSingle()

    if (existing) {
        return NextResponse.json({ error: "Template com este nome já cadastrado" }, { status: 409 })
    }

    const { data, error } = await admin
        .from("meta_templates")
        .insert({
            nome: nome.trim(),
            categoria: categoria ?? null,
            status: status ?? "pendente",
            variaveis: variaveis ?? [],
            automacoes: automacoes ?? [],
            waba_ids: waba_ids ?? [],
            phone_number_ids: phone_number_ids ?? [],
            observacoes: observacoes ?? null,
            ativo: ativo ?? true,
            corpo_texto: corpo_texto ?? null,
        })
        .select()
        .single()

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data, { status: 201 })
}
