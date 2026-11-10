-- S-EMP-GES-10 (parte aditiva): índices por telefone e funções de contagem de seleções.
-- Não muda o comportamento de ninguém: só acrescenta índices e funções novas.
-- Idempotente (IF NOT EXISTS / CREATE OR REPLACE / REVOKE e GRANT repetíveis).
-- A função antiga emp_pessoa_tem_processo_ativo continua no banco (expand/contract).

-- 1. Índices de expressão pela chave do telefone (AC8). emp_chave_telefone é IMMUTABLE.
--    Tabelas pequenas (~3.400 e ~1.500 linhas): índice comum, sem CONCURRENTLY.
CREATE INDEX IF NOT EXISTS idx_candidaturas_chave_telefone
    ON public.candidaturas (public.emp_chave_telefone(telefone));

CREATE INDEX IF NOT EXISTS idx_talent_bank_chave_telefone
    ON public.talent_bank (public.emp_chave_telefone(telefone));

-- 2. A pessoa está contratada em outra vaga? (AC4: sair de "contratado" só libera se não estiver)
--    Seleção por evento fica de fora, como na trava (GES-07: seleção não tem Banco de Talentos).
CREATE OR REPLACE FUNCTION public.emp_pessoa_contratada_em_outra_vaga(p_chave text, p_excluir_candidatura uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.candidaturas c
        JOIN public.vagas v ON v.id = c.vaga_id
        WHERE p_chave IS NOT NULL
          AND c.id <> p_excluir_candidatura
          AND c.status = 'contratado'
          AND v.tipo IS DISTINCT FROM 'selecao_evento'
          AND public.emp_chave_telefone(c.telefone) = p_chave
    )
$$;

-- 3. Contadores de seleções por talento (AC9).
--    Pessoa = chave do telefone, somando os cadastros duplicados. Uma candidatura também é da
--    pessoa quando observacoes = 'banco_talentos:<id>' de qualquer cadastro dela (cobre quem não
--    tem telefone). Só candidaturas com vaga (vaga normal e seleção por evento). Cada uma conta 1x.
--    Ativa = vaga aberta/pré-cadastro e candidatura sem desfecho. "selecionado" conta como ativa
--    (sugestão do levantamento; pergunta P1 da story ainda aguardando o Junior).
CREATE OR REPLACE FUNCTION public.emp_contadores_selecoes(p_talent_ids uuid[])
RETURNS TABLE (talent_id uuid, selecoes_ativas integer, selecoes_participou integer)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
    WITH alvo AS (
        SELECT t.id, public.emp_chave_telefone(t.telefone) AS chave
        FROM public.talent_bank t
        WHERE t.id = ANY (p_talent_ids)
    ),
    cadastros AS (
        SELECT a.id AS talent_id, a.id AS cadastro_id FROM alvo a
        UNION
        SELECT a.id, t2.id
        FROM alvo a
        JOIN public.talent_bank t2
          ON a.chave IS NOT NULL AND public.emp_chave_telefone(t2.telefone) = a.chave
    ),
    cands AS (
        SELECT a.id AS talent_id, c.id AS cand_id, c.status, v.status AS vaga_status
        FROM alvo a
        JOIN public.candidaturas c
          ON a.chave IS NOT NULL AND public.emp_chave_telefone(c.telefone) = a.chave
        JOIN public.vagas v ON v.id = c.vaga_id
        UNION
        SELECT cd.talent_id, c.id, c.status, v.status
        FROM cadastros cd
        JOIN public.candidaturas c ON c.observacoes = 'banco_talentos:' || cd.cadastro_id::text
        JOIN public.vagas v ON v.id = c.vaga_id
    ),
    classificadas AS (
        SELECT talent_id, cand_id,
               (coalesce(vaga_status, '') IN ('aberta', 'pre_cadastro')
                AND coalesce(status, '') NOT IN ('rejeitado', 'contratado', 'entrevista_recusada')) AS ativa
        FROM cands
    )
    SELECT a.id,
           (count(DISTINCT k.cand_id) FILTER (WHERE k.ativa))::integer,
           (count(DISTINCT k.cand_id) FILTER (WHERE NOT k.ativa))::integer
    FROM alvo a
    LEFT JOIN classificadas k ON k.talent_id = a.id
    GROUP BY a.id
$$;

REVOKE ALL ON FUNCTION public.emp_pessoa_contratada_em_outra_vaga(text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.emp_contadores_selecoes(uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emp_pessoa_contratada_em_outra_vaga(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.emp_contadores_selecoes(uuid[]) TO service_role;
