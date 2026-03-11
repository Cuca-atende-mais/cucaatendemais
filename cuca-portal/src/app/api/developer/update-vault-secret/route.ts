import { createClient } from "@supabase/supabase-js"
import { NextRequest, NextResponse } from "next/server"

export async function POST(req: NextRequest) {
    const { secret_name, secret_value } = await req.json()

    if (!secret_name || !secret_value) {
        return NextResponse.json({ error: "Campos obrigatórios ausentes" }, { status: 400 })
    }

    const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { error } = await supabase.rpc("update_vault_secret", {
        p_name: secret_name,
        p_value: secret_value,
    })

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true })
}
