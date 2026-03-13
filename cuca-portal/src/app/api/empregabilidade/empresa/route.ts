import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export async function GET(request: NextRequest) {
    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    const id = request.nextUrl.searchParams.get("id")
    if (!id) {
        return NextResponse.json({ error: "id obrigatório" }, { status: 400 })
    }

    const { data, error } = await supabaseAdmin
        .from("empresas")
        .select("id, nome")
        .eq("id", id)
        .eq("ativa", true)
        .single()

    if (error || !data) {
        return NextResponse.json({ error: "Empresa não encontrada" }, { status: 404 })
    }

    return NextResponse.json(data)
}
