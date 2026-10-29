import type { SupabaseClient } from "@supabase/supabase-js"
import type { PosicaoProjeto, PosicaoSetor, ProjetoPauta } from "./pauta"
import { mensagemDeErro } from "./projeto-dados"

// S-PLA-06: leitura da pauta com o cliente do usuário (RLS: projetos dos seus setores; posições só com
// `pla_apresent_ver`) e gravação da ordem só pelas funções `pla_pauta_ordenar_*` do banco.

const TAMANHO_PAGINA = 1000

async function paginado<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>): Promise<T[]> {
    const linhas: T[] = []
    for (let de = 0; ; de += TAMANHO_PAGINA) {
        const { data, error } = await consulta(de, de + TAMANHO_PAGINA - 1)
        if (error) throw new Error(error.message)
        linhas.push(...((data ?? []) as T[]))
        if (!data || data.length < TAMANHO_PAGINA) break
    }
    return linhas
}

export type DadosPauta = { projetos: ProjetoPauta[]; posicoesSetores: PosicaoSetor[]; posicoesProjetos: PosicaoProjeto[] }

export async function carregarPauta(supabase: SupabaseClient, ano: number): Promise<DadosPauta> {
    const [projetos, posicoesSetores, posicoesProjetos] = await Promise.all([
        paginado<ProjetoPauta>((de, ate) => supabase.from("planejamento_projetos")
            .select("id, nome, setor_id, responsavel_nome, tipo, status, ficha, situacao_2026, created_at")
            .eq("ano", ano).is("excluido_em", null).order("id").range(de, ate)),
        paginado<PosicaoSetor>((de, ate) => supabase.from("planejamento_pauta_setores")
            .select("setor_id, posicao").eq("ano", ano).order("setor_id").range(de, ate)),
        // Sem filtro por id: a RLS já devolve só as posições dos projetos visíveis.
        paginado<PosicaoProjeto>((de, ate) => supabase.from("planejamento_pauta_projetos")
            .select("projeto_id, setor_id, posicao").order("projeto_id").range(de, ate)),
    ])
    return { projetos, posicoesSetores, posicoesProjetos }
}

export async function ordenarSetoresDaPauta(supabase: SupabaseClient, ano: number, setores: string[]): Promise<void> {
    const { error } = await supabase.rpc("pla_pauta_ordenar_setores", { p_ano: ano, p_setores: setores })
    if (error) throw new Error(mensagemDeErro(error.message))
}

export async function ordenarProjetosDaPauta(supabase: SupabaseClient, ano: number, setor: string, projetos: string[]): Promise<void> {
    const { error } = await supabase.rpc("pla_pauta_ordenar_projetos", { p_ano: ano, p_setor: setor, p_projetos: projetos })
    if (error) throw new Error(mensagemDeErro(error.message))
}
