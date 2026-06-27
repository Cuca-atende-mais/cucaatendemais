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

const CAMPOS_PERMITIDOS = ["agente_tipo", "canal_tipo", "ativo", "display_name", "unidade_cuca"] as const
type CampoPermitido = typeof CAMPOS_PERMITIDOS[number]

export async function PATCH(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const email = await assertDeveloper()
    if (!email) {
        return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    }

    const { id: phone_number_id } = await params
    const body = await req.json()

    const update: Partial<Record<CampoPermitido, unknown>> = {}
    for (const campo of CAMPOS_PERMITIDOS) {
        if (campo in body) {
            update[campo] = body[campo]
        }
    }

    if (Object.keys(update).length === 0) {
        return NextResponse.json(
            { error: "Nenhum campo editável fornecido" },
            { status: 400 }
        )
    }

    const admin = createAdminClient()
    const { data, error } = await admin
        .from("meta_phone_numbers")
        .update(update)
        .eq("phone_number_id", phone_number_id)
        .select()
        .single()

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data) {
        return NextResponse.json({ error: "Registro não encontrado" }, { status: 404 })
    }

    return NextResponse.json(data)
}
