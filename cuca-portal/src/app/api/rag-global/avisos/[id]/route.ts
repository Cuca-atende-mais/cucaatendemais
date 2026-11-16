import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { AVS } from "@/lib/rbac/catalogo-avisos"
import { exigirOpcaoRagGlobal } from "@/lib/rag-global/acesso-server"
import { conferirTotal, hojeFortaleza, lerDadosAviso, metadadosDoAviso } from "@/lib/rag-global/avisos"
import { carregarAviso, listarAvisos } from "@/lib/rag-global/avisos-server"

// S-INST-QUAL-08: editar aviso ("Editar aviso"). Qualquer aviso, inclusive vencido ou desativado
// (Junior, 16/11). O fim tem de ser de hoje em diante e o aviso é gravado ativo: volta a valer no
// período informado.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const acesso = await exigirOpcaoRagGlobal(AVS.editar)
        if ("resposta" in acesso) return acesso.resposta

        const atual = await carregarAviso(id)
        if (!atual) return NextResponse.json({ error: "Aviso não encontrado" }, { status: 404 })
        const hoje = hojeFortaleza()

        const lido = lerDadosAviso(await req.json(), hoje)
        if ("erro" in lido) return NextResponse.json({ error: lido.erro }, { status: 400 })
        const erroTotal = conferirTotal(await listarAvisos(), lido.dados, hoje, id)
        if (erroTotal) return NextResponse.json({ error: erroTotal }, { status: 400 })

        const admin = createAdminClient()
        const { error } = await admin
            .from("documentos_rag")
            .update({ titulo: lido.dados.titulo, conteudo: lido.dados.conteudo, ativo: true, metadados: metadadosDoAviso(lido.dados, atual.metadados) })
            .eq("id", id)
        if (error) throw new Error(error.message)
        return NextResponse.json({ ok: true })
    } catch (e) {
        console.error("[rag-global/avisos PATCH]", e)
        return NextResponse.json({ error: e instanceof Error ? e.message : "Erro interno" }, { status: 500 })
    }
}
