import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { PGR } from "@/lib/rbac/catalogo-divulgacao-rag-global"
import { carregarDocumentoGlobal, exigirOpcaoRagGlobal, naoEncontrado } from "@/lib/rag-global/acesso-server"

// S-PROG-16: colocar ou tirar documento da base global do assistente ("Ativar/desativar documento").
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const acesso = await exigirOpcaoRagGlobal(PGR.ativar)
        if ("resposta" in acesso) return acesso.resposta

        const body = await req.json()
        if (typeof body?.ativo !== "boolean") {
            return NextResponse.json({ error: "ativo (true/false) é obrigatório" }, { status: 400 })
        }

        const doc = await carregarDocumentoGlobal(id)
        if (!doc) return naoEncontrado()

        const admin = createAdminClient()
        const { error } = await admin.from("documentos_rag").update({ ativo: body.ativo }).eq("id", id)
        if (error) throw new Error(error.message)
        return NextResponse.json({ ok: true, ativo: body.ativo })
    } catch (e) {
        console.error("[rag-global/ativo]", e)
        return NextResponse.json({ error: e instanceof Error ? e.message : "Erro interno" }, { status: 500 })
    }
}
