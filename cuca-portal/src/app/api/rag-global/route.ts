import { NextRequest, NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { PGR } from "@/lib/rbac/catalogo-divulgacao-rag-global"
import { opcaoLiberada } from "@/lib/programacao/permissoes-categoria"
import { TIPOS_BASE_GLOBAL, documentoDaBaseGlobal, lerDadosDocumentoGlobal } from "@/lib/rag-global/base-global"
import { BUCKET_RAG, exigirOpcaoRagGlobal, type DocumentoGlobal } from "@/lib/rag-global/acesso-server"

// S-PROG-16: lista só documentos da base global ("Ver base global") e devolve as opções de quem pede,
// para a tela mostrar só os botões liberados.
export async function GET() {
    try {
        const acesso = await exigirOpcaoRagGlobal(PGR.ver)
        if ("resposta" in acesso) return acesso.resposta

        const admin = createAdminClient()
        const { data, error } = await admin
            .from("documentos_rag")
            .select("id, titulo, tipo, conteudo, metadados, unidade_cuca, ativo, created_at")
            .is("unidade_cuca", null)
            .in("tipo", TIPOS_BASE_GLOBAL as string[])
            .order("created_at", { ascending: false })
        if (error) throw new Error(error.message)

        const opcoes = Object.fromEntries(
            Object.entries(PGR).map(([chave, modulo]) => [chave, opcaoLiberada(acesso.checar, modulo)]),
        )
        return NextResponse.json({
            documentos: (data as DocumentoGlobal[] ?? []).filter(documentoDaBaseGlobal),
            opcoes,
        })
    } catch (e) {
        console.error("[rag-global GET]", e)
        return NextResponse.json({ error: e instanceof Error ? e.message : "Erro interno" }, { status: 500 })
    }
}

// Cadastrar documento ("Cadastrar documento"). Nasce ativo só para quem também pode ativar/desativar;
// sem essa opção, fica inativo até alguém com a opção colocar no assistente.
export async function POST(req: NextRequest) {
    try {
        const acesso = await exigirOpcaoRagGlobal(PGR.cadastrar)
        if ("resposta" in acesso) return acesso.resposta

        const lido = lerDadosDocumentoGlobal(await req.json())
        if ("erro" in lido) return NextResponse.json({ error: lido.erro }, { status: 400 })
        const { titulo, tipo, conteudo, pdf } = lido.dados

        const admin = createAdminClient()
        const metadados: Record<string, unknown> = { source_type: "rede_cuca_global" }
        let conteudoFinal = conteudo ?? ""
        if (pdf) {
            metadados.pdf_path = pdf.path
            metadados.pdf_nome = pdf.nome
            conteudoFinal = admin.storage.from(BUCKET_RAG).getPublicUrl(pdf.path).data.publicUrl
        }

        const { data, error } = await admin
            .from("documentos_rag")
            .insert({
                titulo,
                tipo,
                conteudo: conteudoFinal,
                unidade_cuca: null,
                ativo: opcaoLiberada(acesso.checar, PGR.ativar),
                metadados,
            })
            .select("id, ativo")
            .single()
        if (error) throw new Error(error.message)

        return NextResponse.json({ ok: true, id: data.id, ativo: data.ativo })
    } catch (e) {
        console.error("[rag-global POST]", e)
        return NextResponse.json({ error: e instanceof Error ? e.message : "Erro interno" }, { status: 500 })
    }
}
