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

const CAMPOS_PERMITIDOS = [
    "agente_tipo", "canal_tipo", "ativo", "display_name", "unidade_cuca",
    "phone_number_id", "waba_id",
] as const
type CampoPermitido = typeof CAMPOS_PERMITIDOS[number]

// Formato real de phone_number_id/waba_id na Meta Graph API: string numérica, 15-17 dígitos
const META_ID_REGEX = /^\d{15,17}$/

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

    for (const campo of ["phone_number_id", "waba_id"] as const) {
        if (campo in update && !META_ID_REGEX.test(String(update[campo]))) {
            return NextResponse.json(
                { error: `${campo} inválido — deve ser numérico com 15 a 17 dígitos` },
                { status: 400 }
            )
        }
    }

    const admin = createAdminClient()

    if (typeof update.phone_number_id === "string" && update.phone_number_id !== phone_number_id) {
        const { data: existing } = await admin
            .from("meta_phone_numbers")
            .select("phone_number_id")
            .eq("phone_number_id", update.phone_number_id)
            .maybeSingle()

        if (existing) {
            return NextResponse.json({ error: "Já existe um registro com este phone_number_id" }, { status: 409 })
        }
    }

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

export async function DELETE(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const email = await assertDeveloper()
    if (!email) {
        return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    }

    const { id: phone_number_id } = await params
    const admin = createAdminClient()

    const { data, error } = await admin
        .from("meta_phone_numbers")
        .update({ ativo: false })
        .eq("phone_number_id", phone_number_id)
        .select("phone_number_id, display_name")
        .single()

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    if (!data) {
        return NextResponse.json({ error: "Registro não encontrado" }, { status: 404 })
    }

    return NextResponse.json({ ok: true, desativado: data.display_name })
}
