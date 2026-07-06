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
        .from("meta_phone_numbers")
        .select("*")
        .order("display_name", { ascending: true })

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
    const { phone_number_id, waba_id, display_name, agente_tipo, canal_tipo, unidade_cuca, ativo } = body

    if (!phone_number_id || !waba_id || !display_name) {
        return NextResponse.json(
            { error: "Campos obrigatórios: phone_number_id, waba_id, display_name" },
            { status: 400 }
        )
    }

    const admin = createAdminClient()

    const { data: existing } = await admin
        .from("meta_phone_numbers")
        .select("phone_number_id")
        .eq("phone_number_id", phone_number_id)
        .maybeSingle()

    if (existing) {
        return NextResponse.json({ error: "phone_number_id já cadastrado" }, { status: 409 })
    }

    const { data, error } = await admin
        .from("meta_phone_numbers")
        .insert({
            phone_number_id,
            waba_id,
            display_name,
            agente_tipo: agente_tipo ?? "Institucional",
            canal_tipo: canal_tipo ?? "Institucional",
            unidade_cuca: unidade_cuca ?? null,
            ativo: ativo ?? true,
        })
        .select()
        .single()

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data, { status: 201 })
}
