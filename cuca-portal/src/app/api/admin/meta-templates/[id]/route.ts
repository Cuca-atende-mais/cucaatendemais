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

const CAMPOS_EDITAVEIS = [
    "nome", "categoria", "status", "variaveis", "automacoes",
    "waba_ids", "phone_number_ids", "observacoes", "ativo",
] as const
type CampoEditavel = typeof CAMPOS_EDITAVEIS[number]

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const email = await assertDeveloper()
    if (!email) {
        return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    }

    const { id } = await params
    const body = await req.json()

    const update: Partial<Record<CampoEditavel, unknown>> = {}
    for (const campo of CAMPOS_EDITAVEIS) {
        if (campo in body) {
            update[campo] = body[campo]
        }
    }

    if (Object.keys(update).length === 0) {
        return NextResponse.json({ error: "Nenhum campo editável fornecido" }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data, error } = await admin
        .from("meta_templates")
        .update(update)
        .eq("id", id)
        .select()
        .single()

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data) {
        return NextResponse.json({ error: "Template não encontrado" }, { status: 404 })
    }

    return NextResponse.json(data)
}

export async function DELETE(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const email = await assertDeveloper()
    if (!email) {
        return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    }

    const { id } = await params
    const admin = createAdminClient()

    const { data, error } = await admin
        .from("meta_templates")
        .update({ ativo: false })
        .eq("id", id)
        .select("id, nome")
        .single()

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data) {
        return NextResponse.json({ error: "Template não encontrado" }, { status: 404 })
    }

    return NextResponse.json({ ok: true, desativado: data.nome })
}
