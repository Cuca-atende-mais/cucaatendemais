-- CONCERN-2 do gate de QA (docs/qa/gates/GATE-fase2-passo1-rag-estrutural-2026-09-11.md).
--
-- `reativar_monthly_program_mais_recente` nasceu com o default do Postgres/Supabase: EXECUTE pra
-- PUBLIC (portanto `anon` e `authenticated`) e sem `search_path` fixo. Diferente das duas funções
-- de trigger da mesma migration — que erram se chamadas diretamente ("trigger functions can only
-- be called as triggers") — esta é uma função comum: o PostgREST a expõe em
-- `/rest/v1/rpc/reativar_monthly_program_mais_recente` e, sendo SECURITY DEFINER, ela ignora RLS.
-- Ou seja, um caminho de ESCRITA em `documentos_rag` alcançável com a anon key.
-- Confirmado pelos lints do Supabase 0011 (function_search_path_mutable), 0028 e 0029.
--
-- Impacto real é baixo (a função é idempotente e converge pro estado correto), mas não há nenhum
-- motivo pra ela ser pública: os dois únicos chamadores são triggers SECURITY DEFINER, que rodam
-- como owner e não dependem de GRANT.
--
-- `SET search_path = public, pg_temp`: em função SECURITY DEFINER, search_path mutável permite que
-- o chamador plante um objeto homônimo num schema à frente de `public` e sequestre a resolução de
-- nome. `pg_temp` vai por último de propósito — nunca antes de `public`.
--
-- Idempotente: ALTER/REVOKE podem rodar N vezes com o mesmo resultado. Escopo restrito a esta
-- função — as outras 42 com search_path mutável e 31 executáveis por anon são débito
-- pré-existente do projeto, fora do escopo deste passo (registrado no gate).
ALTER FUNCTION public.reativar_monthly_program_mais_recente(text, uuid)
  SET search_path = public, pg_temp;

REVOKE EXECUTE ON FUNCTION public.reativar_monthly_program_mais_recente(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reativar_monthly_program_mais_recente(text, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reativar_monthly_program_mais_recente(text, uuid) FROM authenticated;
