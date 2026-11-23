import type { SupabaseClient } from "@supabase/supabase-js"
import type { ProjetoCalendarioGeral } from "./calendario-geral"

// S-PLA-10: só leitura, mesma RLS de setor da S-PLA-02 (o usuário vê só os projetos dos seus setores;
// sem setor = todos). Leitor próprio, para não mudar o do Calendário 2027 (S-PLA-07).
const TAMANHO_PAGINA = 1000

export async function carregarCalendarioGeral(supabase: SupabaseClient, ano: number): Promise<ProjetoCalendarioGeral[]> {
    const linhas: ProjetoCalendarioGeral[] = []
    for (let de = 0; ; de += TAMANHO_PAGINA) {
        const { data, error } = await supabase.from("planejamento_projetos")
            .select("id, nome, setor_id, status, tipo, periodo_ano_todo, data_inicio, data_fim, responsavel_nome, locais_unidades, local_outro, local_outro_texto, dias_horarios")
            .eq("ano", ano).is("excluido_em", null).order("id").range(de, de + TAMANHO_PAGINA - 1)
        if (error) throw new Error(error.message)
        linhas.push(...((data ?? []) as ProjetoCalendarioGeral[]))
        if (!data || data.length < TAMANHO_PAGINA) break
    }
    return linhas
}
