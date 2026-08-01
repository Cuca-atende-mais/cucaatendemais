-- S-WM-61: corrige o trigger chamar_alerta_handover, que referenciava NEW.instancia_uazapi
-- (coluna removida de conversas ha tempos, substituida por origem_id -- ver
-- cuca-portal/supabase/migrations/20260625020000_rename_instancia_uazapi_origem_id.sql).
--
-- Qualquer UPDATE que tente `status='awaiting_human'` disparava esse trigger, que lancava
-- "record NEW has no field instancia_uazapi" (42703), abortando a transacao inteira -- causa
-- raiz confirmada nos logs reais de producao (7 ocorrencias, 2026-07-31 21:29-22:17) tanto do
-- botao "Assumir Atendimento" (400 no PostgREST) quanto do transbordo da Empregabilidade
-- (status nunca gravava de fato, apesar do bot prometer encaminhamento humano).
--
-- Escopo deliberadamente minimo (S-WM-61): so troca o lookup de unidade_cuca para usar
-- meta_phone_numbers/origem_id (mesma correcao ja escrita e validada em cuca-dev via
-- supabase/migrations/20260701000000_wm15_parametrizar_net_http_post.sql, nunca promovida pra
-- producao). URL da Edge Function permanece hardcoded, identica a versao anterior -- a
-- parametrizacao via app.supabase_url fica fora de escopo (mecanismo de configuracao ainda nao
-- decidido, ver docs/migracao-meta/checklist-producao-app-supabase-url.md).
--
-- Idempotente: CREATE OR REPLACE FUNCTION, seguro para reexecutar.

CREATE OR REPLACE FUNCTION public.chamar_alerta_handover()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  edge_url TEXT := 'https://svzkrkfzpiqcesloukgb.supabase.co/functions/v1/alertas-institucionais';
  v_unidade TEXT;
BEGIN
  -- 1. So dispara se a conversa entrar em status 'awaiting_human'
  -- Verificamos se houve mudanca de status para evitar loops ou disparos duplicados
  IF (NEW.status = 'awaiting_human' AND (OLD.status IS NULL OR OLD.status <> 'awaiting_human')) THEN

    -- Descobrir a unidade associada ao numero da conversa para roteamento
    -- (S-WM-61: instancia_uazapi nao existe mais em conversas; lookup migrado para
    -- meta_phone_numbers/origem_id, mesmo padrao ja usado pelo resto do sistema pos-Meta)
    SELECT unidade_cuca INTO v_unidade
    FROM public.meta_phone_numbers
    WHERE phone_number_id = NEW.origem_id
    LIMIT 1;

    -- Notificar HUB de Alertas (Edge Function)
    PERFORM
      net.http_post(
        url := edge_url,
        headers := jsonb_build_object(
          'Content-Type', 'application/json'
        ),
        body := jsonb_build_object(
          'record', jsonb_build_object(
            'id', NEW.id,
            'lead_id', NEW.lead_id,
            'status', NEW.status,
            'unidade_cuca', v_unidade
          ),
          'table', 'conversas',
          'type', 'UPDATE'
        )
      );
  END IF;
  RETURN NEW;
END;
$function$;
