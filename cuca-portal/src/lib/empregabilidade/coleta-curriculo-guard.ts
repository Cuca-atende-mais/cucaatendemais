import type { SupabaseClient } from "@supabase/supabase-js"

// SQS-56 (AC15) — bloqueio server-side dos recursos desativados para seleções
// sem coleta de currículo: análise de CV pela IA, convite de entrevista,
// envio de currículo e triagem do banco de talentos. Não é só UI — cada rota
// que executa uma dessas ações chama este guard antes de agir.
//
// Ressalva registrada na story: o encaminhamento manual do Banco de Talentos
// (`criar-curriculo/[id]/page.tsx` → handleVincular) insere direto em
// `candidaturas` pelo client, sem passar por rota — esse INSERT em si não é
// bloqueado aqui. O que este guard impede é a análise/convite/envio
// disparados a partir dele, onde quer que sejam acionados.
export async function vagaBloqueiaColetaCurriculo(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- service-role client, schema não tipado ponta a ponta neste módulo
    supabase: SupabaseClient<any>,
    vagaId: string | null | undefined
): Promise<boolean> {
    if (!vagaId) return false
    const { data } = await supabase
        .from("vagas")
        .select("coleta_curriculo")
        .eq("id", vagaId)
        .maybeSingle()
    return data?.coleta_curriculo === false
}

export const MSG_BLOQUEIO_COLETA_CURRICULO =
    "Esta seleção não coleta currículo — análise de IA, convite de entrevista e envio de currículo estão desativados para ela."
