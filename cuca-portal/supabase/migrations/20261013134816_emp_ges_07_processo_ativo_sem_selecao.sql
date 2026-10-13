-- S-EMP-GES-07 (AC6): inscrição em seleção por evento não conta como "processo ativo".
-- Seleção só coleta nome e telefone e não tem Banco de Talentos (decisão do Junior, 2026-10-13).
-- Mesma assinatura, search_path e permissões da versão da S-EMP-GES-01; só o filtro por tipo é novo.
-- Idempotente (CREATE OR REPLACE + REVOKE/GRANT repetíveis).

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
          AND v.tipo IS DISTINCT FROM 'selecao_evento'
          AND public.emp_chave_telefone(c.telefone) = p_chave
          AND (
              (v.status IN ('aberta', 'pre_cadastro') AND c.status <> 'rejeitado')
              OR c.status IN ('selecionado', 'contratado', 'aprovado_empresa', 'convite_enviado', 'entrevista_confirmada')
          )
    )
$$;

REVOKE ALL ON FUNCTION public.emp_pessoa_tem_processo_ativo(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emp_pessoa_tem_processo_ativo(text, uuid) TO service_role;
