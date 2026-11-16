import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { AVS } from "@/lib/rbac/catalogo-avisos"
import { exigirOpcaoRagGlobal } from "@/lib/rag-global/acesso-server"
import { carregarAviso } from "@/lib/rag-global/avisos-server"

// S-INST-QUAL-08: tirar o aviso do bot antes do fim ("Desativar aviso"). Para voltar, edita-se o
// aviso (a edição grava ativo, com fim de hoje em diante).
export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const acesso = await exigirOpcaoRagGlobal(AVS.desativar)
        if ("resposta" in acesso) return acesso.resposta

        const atual = await carregarAviso(id)
        if (!atual) return NextResponse.json({ error: "Aviso não encontrado" }, { status: 404 })
        if (!atual.ativo) return NextResponse.json({ ok: true })

        const admin = createAdminClient()
        const { error } = await admin.from("documentos_rag").update({ ativo: false }).eq("id", id)
        if (error) throw new Error(error.message)
        return NextResponse.json({ ok: true })
    } catch (e) {
        console.error("[rag-global/avisos/desativar]", e)
        return NextResponse.json({ error: e instanceof Error ? e.message : "Erro interno" }, { status: 500 })
    }
}
