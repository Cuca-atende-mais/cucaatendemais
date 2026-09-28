-- Frente custo-llm — limpeza aprovada em 28/09/2026:
-- 1) `metricas_openai`: tabela sem uso no código (só 4 linhas de teste de 19-20/02/2026, nenhuma
--    escrita desde então); o registro de consumo passou a ser `ai_usage_logs` (PLANO-023).
-- 2) Índices repetidos em `ai_usage_logs`, criados pela migration do PLANO-023 sem notar os que já
--    existiam: `ix_ai_usage_logs_created_at` repete `idx_ail_created_at`, e o composto
--    `ix_ai_usage_logs_feature_created (feature, created_at)` cobre `idx_ail_feature (feature)`.
-- Idempotente.
drop table if exists public.metricas_openai;
drop index if exists public.ix_ai_usage_logs_created_at;
drop index if exists public.idx_ail_feature;
