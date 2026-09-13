import type { User } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { opcaoLiberada, type ChecarPermissao } from "@/lib/programacao/permissoes-categoria"
import { carregarAcessoPgm } from "@/lib/programacao/permissoes-categoria-server"
import { documentoDaBaseGlobal } from "./base-global"

export const BUCKET_RAG = "rag-documentos"

export type DocumentoGlobal = {
    id: string
    titulo: string
    tipo: string
    conteudo: string
    metadados: Record<string, unknown> | null
    unidade_cuca: string | null
    ativo: boolean
    created_at: string
}

// S-PROG-16: rotas da Base de Conhecimento Global gravam com a chave de serviço; cada uma confere a
// opção exata (`pgr_*`, sem passe livre do Super Admin) e que o documento é da base global.
export async function exigirOpcaoRagGlobal(
    opcao: string,
): Promise<{ user: User; checar: ChecarPermissao } | { resposta: NextResponse }> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return { resposta: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) }
    const { checar } = await carregarAcessoPgm(user)
    if (!opcaoLiberada(checar, opcao)) {
        return { resposta: NextResponse.json({ error: "Sem permissão para esta ação na base global" }, { status: 403 }) }
    }
    return { user, checar }
}

/** Documento da base global pelo id; outro tipo de documento responde 404, como se não existisse. */
export async function carregarDocumentoGlobal(id: string): Promise<DocumentoGlobal | null> {
    const admin = createAdminClient()
    const { data, error } = await admin
        .from("documentos_rag")
        .select("id, titulo, tipo, conteudo, metadados, unidade_cuca, ativo, created_at")
        .eq("id", id)
        .maybeSingle()
    if (error) throw new Error(error.message)
    if (!data || !documentoDaBaseGlobal(data as DocumentoGlobal)) return null
    return data as DocumentoGlobal
}

export const naoEncontrado = () => NextResponse.json({ error: "Documento não encontrado" }, { status: 404 })
