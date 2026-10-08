-- S-EMP-GES-01: tela Feedback, mudança de status (individual e em lote) e devolução ao Banco de Talentos.
-- Idempotente e aditiva: coluna nullable + funções novas. Nada existente é alterado.

-- 1. Nome do responsável pelo contato da vaga (cartão de contato da tela Feedback).
ALTER TABLE public.vagas ADD COLUMN IF NOT EXISTS nome_responsavel text;

-- 2. Chave de telefone para casar a mesma pessoa em formatos diferentes:
--    só dígitos, sem o 55 do Brasil, e DDD + últimos 8 dígitos (casa números com e sem o 9 extra).
--    Mesma regra de lib/empregabilidade/status-candidatura.ts (chaveTelefone) e da limpeza de 08/10.
CREATE OR REPLACE FUNCTION public.emp_chave_telefone(p_tel text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public', 'pg_temp'
AS $$
    SELECT CASE
        WHEN d2 = '' THEN NULL
        WHEN length(d2) IN (10, 11) THEN left(d2, 2) || right(d2, 8)
        ELSE d2
    END
    FROM (
        SELECT CASE WHEN length(d) IN (12, 13) AND d LIKE '55%' THEN substr(d, 3) ELSE d END AS d2
        FROM (SELECT regexp_replace(coalesce(p_tel, ''), '\D', '', 'g') AS d) a
    ) b
$$;

-- 3. Todos os cadastros do Banco de Talentos da pessoa (inclusive duplicados).
CREATE OR REPLACE FUNCTION public.emp_talent_bank_por_chave(p_chave text)
RETURNS SETOF public.talent_bank
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $$
    SELECT t.*
    FROM public.talent_bank t
    WHERE p_chave IS NOT NULL
      AND public.emp_chave_telefone(t.telefone) = p_chave
$$;

-- 4. A pessoa ainda está em processo em outra vaga? (decisão D4 da S-EMP-GES-01)
--    Candidatura não rejeitada em vaga aberta/pré-cadastro, ou já avançada em qualquer vaga.
CREATE OR REPLACE FUNCTION public.emp_pessoa_tem_processo_ativo(p_chave text, p_excluir_candidatura uuid)
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
          AND public.emp_chave_telefone(c.telefone) = p_chave
          AND (
              (v.status IN ('aberta', 'pre_cadastro') AND c.status <> 'rejeitado')
              OR c.status IN ('selecionado', 'contratado', 'aprovado_empresa', 'convite_enviado', 'entrevista_confirmada')
          )
    )
$$;

-- As funções de leitura de talent_bank/candidaturas só são chamadas pelas rotas do portal com service_role.
REVOKE ALL ON FUNCTION public.emp_talent_bank_por_chave(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.emp_pessoa_tem_processo_ativo(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emp_talent_bank_por_chave(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.emp_pessoa_tem_processo_ativo(text, uuid) TO service_role;
