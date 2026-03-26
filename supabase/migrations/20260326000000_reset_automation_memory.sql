-- =============================================================
-- reset_automation_memory
-- Limpa mensagens e memórias de todas as automações
-- Cron: todo dia às 03:00 UTC = 00:00 BRT (Brasília/São Paulo)
-- =============================================================

-- 1. Função que realiza o reset
CREATE OR REPLACE FUNCTION reset_automation_memory()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mensagens    int;
  v_conversas    int;
  v_webhooks     int;
  v_transbordo   int;
BEGIN
  -- Deletar mensagens de todas as conversas
  DELETE FROM mensagens;
  GET DIAGNOSTICS v_mensagens = ROW_COUNT;

  -- Deletar todas as conversas (e seus metadados/memória de workflow)
  DELETE FROM conversas;
  GET DIAGNOSTICS v_conversas = ROW_COUNT;

  -- Limpar fila de transbordo humano
  DELETE FROM transbordo_humano;
  GET DIAGNOSTICS v_transbordo = ROW_COUNT;

  -- Limpar logs de webhook (auditoria de baixo nível)
  DELETE FROM logs_webhook;
  GET DIAGNOSTICS v_webhooks = ROW_COUNT;

  RETURN jsonb_build_object(
    'success',       true,
    'executed_at',   now(),
    'mensagens',     v_mensagens,
    'conversas',     v_conversas,
    'transbordo',    v_transbordo,
    'logs_webhook',  v_webhooks
  );
END;
$$;

-- 2. Garantir que apenas service_role/postgres pode executar
REVOKE ALL ON FUNCTION reset_automation_memory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION reset_automation_memory() TO service_role;

-- 3. Agendar via pg_cron — 03:00 UTC = 00:00 BRT todos os dias
--    Execute isso manualmente no SQL Editor do Supabase Dashboard
--    (requer pg_cron habilitado em Database > Extensions)
--
-- SELECT cron.schedule(
--   'reset_automation_memory_daily',
--   '0 3 * * *',
--   $$SELECT reset_automation_memory()$$
-- );
--
-- Para verificar jobs agendados:
-- SELECT * FROM cron.job;
--
-- Para remover o job:
-- SELECT cron.unschedule('reset_automation_memory_daily');
