-- FIX SQS-45 T2: Remover transbordo_humano do reset diário
-- transbordo_humano é configuração permanente de atendentes, não fila temporária
CREATE OR REPLACE FUNCTION public.reset_automation_memory()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_mensagens  int;
  v_conversas  int;
  v_webhooks   int;
BEGIN
  DELETE FROM mensagens WHERE true;
  GET DIAGNOSTICS v_mensagens = ROW_COUNT;
  DELETE FROM conversas WHERE true;
  GET DIAGNOSTICS v_conversas = ROW_COUNT;
  DELETE FROM logs_webhook WHERE true;
  GET DIAGNOSTICS v_webhooks = ROW_COUNT;
  RETURN jsonb_build_object(
    'success', true,
    'executed_at', now(),
    'mensagens', v_mensagens,
    'conversas', v_conversas,
    'logs_webhook', v_webhooks
  );
END;
$$;
