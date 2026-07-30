import { NextRequest, NextResponse } from "next/server"
import { verificarLinkParams } from "@/lib/empregabilidade/link-assinado"

export async function POST(request: NextRequest) {
    const body = await request.json().catch(() => ({}))
    const resultado = verificarLinkParams(body.link_params)
    if (!resultado.valido) {
        return NextResponse.json(
            { valido: false, motivo: resultado.motivo || "link inválido" },
            { status: 403 },
        )
    }
    return NextResponse.json({ valido: true })
}
