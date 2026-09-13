import { NextRequest, NextResponse } from "next/server"
import { PGR } from "@/lib/rbac/catalogo-divulgacao-rag-global"
import { carregarDocumentoGlobal, exigirOpcaoRagGlobal, naoEncontrado } from "@/lib/rag-global/acesso-server"

// S-PROG-16: reindexar documento da base global ("Reindexar documento"). A chamada à Edge Function
// `processar-documento` sai do servidor, só para documentos da base global.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const acesso = await exigirOpcaoRagGlobal(PGR.reindexar)
        if ("resposta" in acesso) return acesso.resposta

        const doc = await carregarDocumentoGlobal(id)
        if (!doc) return naoEncontrado()

        const pdfPath = typeof doc.metadados?.pdf_path === "string" ? doc.metadados.pdf_path : null
        const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/processar-documento`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({
                documento_id: doc.id,
                source_type: "rede_cuca_global",
                cuca_unit_id: null,
                ...(pdfPath && { pdf_path: pdfPath }),
            }),
        })
        const resultado = await res.json().catch(() => ({}))
        if (!res.ok) {
            return NextResponse.json({ error: resultado.error ?? "Falha ao indexar" }, { status: 502 })
        }
        return NextResponse.json({ ok: true, total_chunks: resultado.total_chunks ?? null })
    } catch (e) {
        console.error("[rag-global/reindexar]", e)
        return NextResponse.json({ error: e instanceof Error ? e.message : "Erro interno" }, { status: 500 })
    }
}
