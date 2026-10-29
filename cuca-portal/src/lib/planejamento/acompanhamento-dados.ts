import type { SupabaseClient } from "@supabase/supabase-js"
import type { Comentario, Correcao, EventoProjeto, Pendencia, Validacao } from "./acompanhamento"
import type { ResumoAcompanhamento } from "./lista"
import { mensagemDeErro } from "./projeto-dados"

// S-PLA-04: leitura com o cliente do usuário (RLS: `pla_acomp_ver` + projeto visível) e escrita só
// pelas funções `pla_*` do banco, que conferem permissão, `pla_acomp_ver`, setor e autoria.

const TAMANHO_PAGINA = 1000

export type Acompanhamento = {
    correcoes: Correcao[]
    comentarios: Comentario[]
    pendencias: Pendencia[]
    validacao: Validacao | null
}

export async function carregarAcompanhamento(supabase: SupabaseClient, projetoId: string): Promise<Acompanhamento> {
    const [correcoes, comentarios, pendencias, validacao] = await Promise.all([
        supabase.from("planejamento_projeto_correcoes")
            .select("id, secao, texto, pedido_por_nome, created_at, resolvida_em, resolvida_por_nome, resolucao_obs")
            .eq("projeto_id", projetoId).order("created_at").order("id"),
        supabase.from("planejamento_projeto_comentarios")
            .select("id, texto, autor_id, autor_nome, created_at, editado_em")
            .eq("projeto_id", projetoId).order("created_at").order("id"),
        supabase.from("planejamento_projeto_pendencias")
            .select("id, texto, responsavel, feito, feito_por_nome, criado_por_nome, created_at")
            .eq("projeto_id", projetoId).order("created_at").order("id"),
        supabase.from("planejamento_projeto_validacoes")
            .select("validado_por_nome, validado_em").eq("projeto_id", projetoId).maybeSingle(),
    ])
    const erro = correcoes.error ?? comentarios.error ?? pendencias.error ?? validacao.error
    if (erro) throw new Error(erro.message)
    return {
        correcoes: (correcoes.data ?? []) as Correcao[],
        comentarios: (comentarios.data ?? []) as Comentario[],
        pendencias: (pendencias.data ?? []) as Pendencia[],
        validacao: (validacao.data as Validacao | null) ?? null,
    }
}

// Correções em aberto, para os destaques do formulário de edição.
export async function carregarCorrecoesAbertas(supabase: SupabaseClient, projetoId: string): Promise<Correcao[]> {
    const { data, error } = await supabase.from("planejamento_projeto_correcoes")
        .select("id, secao, texto, pedido_por_nome, created_at, resolvida_em, resolvida_por_nome, resolucao_obs")
        .eq("projeto_id", projetoId).is("resolvida_em", null).order("created_at").order("id")
    if (error) throw new Error(error.message)
    return (data ?? []) as Correcao[]
}

// Histórico (AC6): primeiro os `limite` mais recentes e o total; com `limite` null, todos (em páginas
// de 1.000, o limite de linhas por consulta do Supabase).
export async function carregarHistorico(
    supabase: SupabaseClient, projetoId: string, limite: number | null,
): Promise<{ eventos: EventoProjeto[]; total: number }> {
    const consulta = () => supabase.from("planejamento_projeto_eventos")
        .select("id, tipo, detalhe, autor_nome, created_at", { count: "exact" })
        .eq("projeto_id", projetoId).order("created_at", { ascending: false }).order("id", { ascending: false })
    if (limite !== null) {
        const { data, error, count } = await consulta().range(0, limite - 1)
        if (error) throw new Error(error.message)
        return { eventos: (data ?? []) as EventoProjeto[], total: count ?? (data?.length ?? 0) }
    }
    const eventos: EventoProjeto[] = []
    for (let de = 0; ; de += TAMANHO_PAGINA) {
        const { data, error } = await consulta().range(de, de + TAMANHO_PAGINA - 1)
        if (error) throw new Error(error.message)
        eventos.push(...((data ?? []) as EventoProjeto[]))
        if (!data || data.length < TAMANHO_PAGINA) break
    }
    return { eventos, total: eventos.length }
}

// Selos da lista (AC7): contagem feita no banco, uma chamada só.
export async function carregarResumoAcompanhamento(supabase: SupabaseClient, ano: number): Promise<ResumoAcompanhamento> {
    const { data, error } = await supabase.rpc("pla_resumo_acompanhamento", { p_ano: ano })
    if (error) throw new Error(error.message)
    return (data ?? {}) as ResumoAcompanhamento
}

async function chamar(supabase: SupabaseClient, funcao: string, args: Record<string, unknown>): Promise<void> {
    const { error } = await supabase.rpc(funcao, args)
    if (error) throw new Error(mensagemDeErro(error.message))
}

export const pedirCorrecao = (s: SupabaseClient, projetoId: string, texto: string, secao: number | null) =>
    chamar(s, "pla_correcao_pedir", { p_projeto: projetoId, p_texto: texto, p_secao: secao })
export const resolverCorrecao = (s: SupabaseClient, id: string, observacao: string) =>
    chamar(s, "pla_correcao_resolver", { p_id: id, p_observacao: observacao.trim() || null })

export const criarComentario = (s: SupabaseClient, projetoId: string, texto: string) =>
    chamar(s, "pla_comentario_criar", { p_projeto: projetoId, p_texto: texto })
export const editarComentario = (s: SupabaseClient, id: string, texto: string) =>
    chamar(s, "pla_comentario_editar", { p_id: id, p_texto: texto })
export const excluirComentario = (s: SupabaseClient, id: string) =>
    chamar(s, "pla_comentario_excluir", { p_id: id })

export const validarProjeto = (s: SupabaseClient, projetoId: string) =>
    chamar(s, "pla_validar_projeto", { p_projeto: projetoId })
export const retirarValidacao = (s: SupabaseClient, projetoId: string) =>
    chamar(s, "pla_retirar_validacao", { p_projeto: projetoId })

export const criarPendencia = (s: SupabaseClient, projetoId: string, texto: string, responsavel: string) =>
    chamar(s, "pla_pendencia_criar", { p_projeto: projetoId, p_texto: texto, p_responsavel: responsavel.trim() || null })
export const editarPendencia = (s: SupabaseClient, id: string, texto: string, responsavel: string) =>
    chamar(s, "pla_pendencia_editar", { p_id: id, p_texto: texto, p_responsavel: responsavel.trim() || null })
export const excluirPendencia = (s: SupabaseClient, id: string) =>
    chamar(s, "pla_pendencia_excluir", { p_id: id })
export const marcarPendencia = (s: SupabaseClient, id: string, feito: boolean) =>
    chamar(s, "pla_pendencia_marcar", { p_id: id, p_feito: feito })
