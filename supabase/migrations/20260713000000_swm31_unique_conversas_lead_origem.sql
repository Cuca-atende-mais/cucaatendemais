-- S-WM-31 Task 1: corrige corrida de duplicação de conversa. worker/meta_adapter_inbound.py
-- e supabase/functions/motor-agente/index.ts faziam select-então-insert sem trava sobre
-- conversas(lead_id, origem_id) — dois webhooks quase simultâneos do mesmo lead podiam cada
-- um "não achar" conversa existente e inserir a sua, gerando 2+ linhas para o mesmo lead,
-- cada uma com metadata/histórico fragmentado (saudação duplicada, reset de conversa).
--
-- Antes de aplicar a constraint única, faz merge de qualquer duplicata já existente:
-- mantém a linha mais antiga (MIN(created_at)) como canônica, migra mensagens.conversa_id
-- das duplicatas mais recentes para ela (nunca apaga mensagem), depois remove as linhas de
-- conversas duplicadas. Idempotente: sem duplicatas restantes, o loop não encontra grupos
-- com count(*) > 1 e não faz nada.

DO $$
DECLARE
  v_grupos_mesclados int := 0;
  r RECORD;
  v_canonical uuid;
BEGIN
  FOR r IN
    SELECT lead_id, origem_id
    FROM public.conversas
    WHERE lead_id IS NOT NULL
    GROUP BY lead_id, origem_id
    HAVING count(*) > 1
  LOOP
    SELECT id INTO v_canonical
    FROM public.conversas
    WHERE lead_id = r.lead_id AND origem_id = r.origem_id
    ORDER BY created_at ASC
    LIMIT 1;

    UPDATE public.mensagens
    SET conversa_id = v_canonical
    WHERE conversa_id IN (
      SELECT id FROM public.conversas
      WHERE lead_id = r.lead_id AND origem_id = r.origem_id AND id <> v_canonical
    );

    DELETE FROM public.conversas
    WHERE lead_id = r.lead_id AND origem_id = r.origem_id AND id <> v_canonical;

    v_grupos_mesclados := v_grupos_mesclados + 1;
  END LOOP;

  RAISE NOTICE 'S-WM-31 dedup conversas: % grupo(s) com duplicata mesclado(s)', v_grupos_mesclados;
END $$;

-- Unique index (equivalente a constraint única, mesmo padrão idempotente já usado neste
-- projeto — ver 20260704200000_wm20_wamid_dedupe_mensagens.sql). Habilita
-- upsert(on_conflict="lead_id,origem_id") no worker e no motor-agente.
CREATE UNIQUE INDEX IF NOT EXISTS conversas_lead_id_origem_id_unique
    ON public.conversas (lead_id, origem_id);
