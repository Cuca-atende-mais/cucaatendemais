import type { SupabaseClient } from "@supabase/supabase-js"
import type { ProjetoCalendario } from "./calendario"

// S-PLA-07: só leitura. A RLS da S-PLA-02 já devolve só os projetos dos setores do usuário (e esconde os
// excluídos); o filtro de excluído aqui é redundância de propósito.
const TAMANHO_PAGINA = 1000

export async function carregarCalendario(supabase: SupabaseClient, ano: number): Promise<ProjetoCalendario[]> {
    const linhas: ProjetoCalendario[] = []
    for (let de = 0; ; de += TAMANHO_PAGINA) {
        const { data, error } = await supabase.from("planejamento_projetos")
            .select("id, nome, setor_id, status, tipo, periodo_ano_todo, data_inicio, data_fim")
            .eq("ano", ano).is("excluido_em", null).order("id").range(de, de + TAMANHO_PAGINA - 1)
        if (error) throw new Error(error.message)
        linhas.push(...((data ?? []) as ProjetoCalendario[]))
        if (!data || data.length < TAMANHO_PAGINA) break
    }
    return linhas
}
