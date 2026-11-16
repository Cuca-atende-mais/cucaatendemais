import { createAdminClient } from "@/lib/supabase/admin"
import { TIPO_AVISO, type Aviso } from "./avisos"

// S-INST-QUAL-08: leitura dos avisos com a chave de serviço. Só `tipo = aviso` e sem unidade; qualquer
// outro documento responde como inexistente (as rotas genéricas da base global também não enxergam
// avisos, porque `aviso` não está em TIPOS_BASE_GLOBAL).
const CAMPOS = "id, titulo, conteudo, metadados, ativo, created_at"

export async function listarAvisos(): Promise<Aviso[]> {
    const admin = createAdminClient()
    const { data, error } = await admin
        .from("documentos_rag")
        .select(CAMPOS)
        .eq("tipo", TIPO_AVISO)
        .is("unidade_cuca", null)
        .order("created_at", { ascending: false })
    if (error) throw new Error(error.message)
    return (data ?? []) as Aviso[]
}

export async function carregarAviso(id: string): Promise<Aviso | null> {
    const admin = createAdminClient()
    const { data, error } = await admin
        .from("documentos_rag")
        .select(CAMPOS)
        .eq("id", id)
        .eq("tipo", TIPO_AVISO)
        .is("unidade_cuca", null)
        .maybeSingle()
    if (error) throw new Error(error.message)
    return (data as Aviso | null) ?? null
}
