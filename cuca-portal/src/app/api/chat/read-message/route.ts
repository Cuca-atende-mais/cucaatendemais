import { NextResponse } from "next/server"

// Rota removida — feature era exclusiva do UAZAPI (marcar mensagem como lida via socket).
// Meta Cloud API não tem equivalente direto. Mantida apenas para evitar 404 em caso de
// chamada residual, sinalizando obsolescência explícita (RFC 7231 §6.5.9).
export async function POST() {
    return NextResponse.json(
        { error: "Rota descontinuada. O canal Meta não suporta marcação de leitura via API." },
        { status: 410 }
    )
}
