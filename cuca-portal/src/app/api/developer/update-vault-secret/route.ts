import { createClient as createServiceClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { NextRequest, NextResponse } from "next/server"

// Emails autorizados — deve espelhar user-provider.tsx
const DEVELOPER_EMAILS = ['valmir@cucateste.com', 'dev.cucaatendemais@gmail.com']

export async function POST(req: NextRequest) {
    // SOL-02: autenticação real + lista de autorização de emails developer
    const supabaseAuth = await createClient()
    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser()

    if (authError || !user || !user.email) {
        return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    }

    if (!DEVELOPER_EMAILS.includes(user.email)) {
        return NextResponse.json({ error: "Acesso restrito a desenvolvedores" }, { status: 403 })
    }

    const { secret_name, secret_value } = await req.json()

    if (!secret_name || !secret_value) {
        return NextResponse.json({ error: "Campos obrigatórios ausentes" }, { status: 400 })
    }

    const supabase = createServiceClient(
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
