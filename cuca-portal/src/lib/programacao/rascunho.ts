/**
 * S-PROG-09 (item 1): mapeia o erro devolvido pela função `programacao_salvar_rascunho`
 * (Postgres, ver `supabase/migrations/20260910180000_s_prog_09_salvar_rascunho.sql`) pro status
 * HTTP certo. Extraído da rota pra ser testável sem subir Next.js/Supabase — mesmo padrão de
 * `aprovacao.ts`/`payload.ts`: a decisão fica numa função pura, a rota só chama.
 *
 * A função Postgres usa `RAISE EXCEPTION ... USING ERRCODE = 'P0001'/'P0002'` (códigos de erro
 * definidos pela própria função, não códigos padrão do Postgres) — o cliente Supabase devolve
 * esse código em `error.code` e a mensagem em `error.message`.
 *
 * `42501` (`insufficient_privilege`, código PADRÃO do Postgres) foi adicionado na correção do
 * achado crítico do @qa (2026-09-10): a função passou a checar `has_permission` internamente
 * (defesa contra chamada direta via REST, que contorna a checagem da própria rota). Na rota, esse
 * código nunca deveria aparecer de fato (a rota já checa permissão ANTES de chamar a função) —
 * mas se checar aqui e cair no 500 genérico, uma corrida de permissão revogada entre o check da
 * rota e a chamada da função viraria erro 500 em vez do 403 que é.
 */
export interface ErroSalvarRascunho {
    status: number
    error: string
}

const CAMPANHA_NAO_ENCONTRADA = "P0002"
const STATUS_INVALIDO = "P0001"
const SEM_PERMISSAO = "42501"

export function mapearErroSalvarRascunho(erro: { code?: string; message?: string } | null | undefined): ErroSalvarRascunho {
    const code = erro?.code
    const mensagem = erro?.message || "Erro ao salvar rascunho"

    if (code === CAMPANHA_NAO_ENCONTRADA) {
        return { status: 404, error: "Programação não encontrada" }
    }
    if (code === STATUS_INVALIDO) {
        // A função já monta a mensagem em português com o status atual — repassar como está.
        return { status: 409, error: mensagem }
    }
    if (code === SEM_PERMISSAO) {
        return { status: 403, error: "Sem permissão para editar programação" }
    }
    return { status: 500, error: mensagem }
}
