import { createClient as createServiceClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { isDeveloperEmail } from "@/lib/auth/developers"

export async function POST() {
    const sessao = await createClient()
    const { data: { user }, error: authError } = await sessao.auth.getUser()
    if (authError || !user) {
        return NextResponse.json({ error: "Não autorizado" }, { status: 401 })
    }
    if (!isDeveloperEmail(user.email)) {
        return NextResponse.json({ error: "Acesso restrito a Developer" }, { status: 403 })
    }

    const supabase = createServiceClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const { data, error } = await supabase.rpc("reset_automation_memory")

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json(data)
}
