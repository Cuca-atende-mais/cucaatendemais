import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { PGR } from "@/lib/rbac/catalogo-divulgacao-rag-global"
import { lerDadosDocumentoGlobal } from "@/lib/rag-global/base-global"
import {
    BUCKET_RAG, carregarDocumentoGlobal, exigirOpcaoRagGlobal, naoEncontrado,
} from "@/lib/rag-global/acesso-server"

// S-PROG-16: editar documento da base global ("Editar documento"). Não mexe em `ativo`.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const acesso = await exigirOpcaoRagGlobal(PGR.editar)
        if ("resposta" in acesso) return acesso.resposta

        const doc = await carregarDocumentoGlobal(id)
        if (!doc) return naoEncontrado()

        const lido = lerDadosDocumentoGlobal(await req.json(), {
            tipoAtual: doc.tipo,
            temPdfAtual: !!doc.metadados?.pdf_path,
        })
        if ("erro" in lido) return NextResponse.json({ error: lido.erro }, { status: 400 })
        const { titulo, tipo, conteudo, pdf } = lido.dados

        const admin = createAdminClient()
        const alteracao: Record<string, unknown> = {
            titulo,
            tipo,
            metadados: { ...(doc.metadados ?? {}), source_type: "rede_cuca_global" },
        }
        if (pdf) {
            alteracao.metadados = { ...(alteracao.metadados as object), pdf_path: pdf.path, pdf_nome: pdf.nome }
            alteracao.conteudo = admin.storage.from(BUCKET_RAG).getPublicUrl(pdf.path).data.publicUrl
        } else if (conteudo !== null) {
            alteracao.conteudo = conteudo
        }

        const { error } = await admin.from("documentos_rag").update(alteracao).eq("id", id)
        if (error) throw new Error(error.message)
        return NextResponse.json({ ok: true })
    } catch (e) {
        console.error("[rag-global PATCH]", e)
        return NextResponse.json({ error: e instanceof Error ? e.message : "Erro interno" }, { status: 500 })
    }
}

// Excluir documento da base global ("Excluir documento"), com o PDF do storage.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const { id } = await params
        const acesso = await exigirOpcaoRagGlobal(PGR.excluir)
        if ("resposta" in acesso) return acesso.resposta

        const doc = await carregarDocumentoGlobal(id)
        if (!doc) return naoEncontrado()

        const admin = createAdminClient()
        const { error } = await admin.from("documentos_rag").delete().eq("id", id)
        if (error) throw new Error(error.message)

        const pdfPath = doc.metadados?.pdf_path
        if (typeof pdfPath === "string" && pdfPath.startsWith("global/")) {
            const { error: stErr } = await admin.storage.from(BUCKET_RAG).remove([pdfPath])
            if (stErr) console.error("[rag-global DELETE] PDF não removido do storage:", pdfPath, stErr.message)
        }
        return NextResponse.json({ ok: true })
    } catch (e) {
        console.error("[rag-global DELETE]", e)
        return NextResponse.json({ error: e instanceof Error ? e.message : "Erro interno" }, { status: 500 })
    }
}
