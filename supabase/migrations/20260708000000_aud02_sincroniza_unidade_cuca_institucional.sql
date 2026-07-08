-- AUD-02 (auditoria externa 2026-07-07): sincroniza o Git com o valor real de produção.
-- A migração original (20260626000001_wm04_insert_meta_phone_numbers.sql) gravou
-- unidade_cuca=NULL para o número Institucional, mas o valor em produção é 'Geral'
-- (confirmado por leitura direta em produção em 2026-07-08) — foi editado manualmente
-- fora do Git em algum momento. Esta migração não altera a original (histórico
-- preservado); só declara explicitamente o valor real daqui pra frente.
-- Idempotente: UPDATE com WHERE por PK, roda quantas vezes for aplicada sem efeito colateral.

UPDATE public.meta_phone_numbers
SET unidade_cuca = 'Geral'
WHERE phone_number_id = '1233832826470497'
  AND (unidade_cuca IS DISTINCT FROM 'Geral');
