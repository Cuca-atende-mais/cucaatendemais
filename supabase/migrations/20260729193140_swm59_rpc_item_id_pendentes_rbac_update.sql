-- S-WM-59 (Painel de Acompanhamento de Envios — Controle de Pausa e Limite):
--
-- 1. Estende listar_disparos_acompanhamento (S-WM-58) com 2 colunas novas:
--    - item_id: o id na tabela de origem (eventos_pontuais.id / ouvidoria_eventos.id /
--      disparos_divulgacao.id) — necessário pro portal chamar
--      /retomar-disparo/{origem}/{item_id} (S-WM-60), que espera esse id, não disparo_id
--      (que só coincide com item_id no caso de divulgação). Sem isso o botão "Reenviar
--      pendentes" não tem como saber qual id mandar pro worker nos casos pontual/ouvidoria.
--    - total_pendentes: quantos destinatários elegíveis ainda não têm NENHUMA linha em
--      logs_disparo pra este disparo — mesmo critério usado por
--      _query_leads_pendentes_sync/_query_leads_divulgacao_pendentes_sync
--      (worker/campanhas_engine.py, S-WM-60), não a aproximação
--      total_elegiveis - (total_enviados + total_falhou) [que já teria dupla contagem de
--      linhas com status='aviso', presentes em ambos os buckets] — contagem exata via
--      COUNT(DISTINCT lead_id), consistente com o que o botão "Reenviar pendentes" de fato
--      vai enviar.
--
-- CREATE OR REPLACE FUNCTION não permite mudar as colunas de RETURNS TABLE — precisa DROP
-- antes. Só há 1 overload desta função (confirmado: p_motor/p_desde/p_ate/p_limit sempre
-- com os mesmos defaults desde a criação original) e nenhuma GRANT explícita foi usada nas
-- 2 migrations anteriores que a definem — as permissões de execução default do schema
-- public se aplicam (mesmas de antes, chamada só via client admin/service_role no route.ts,
-- que já bypassa RLS/grants).
--
-- 2. Semeia can_update=true pro role "Super Admin Cuca" no módulo config_acompanhamento_envios
--    (que hoje só tinha can_read=true, seedado pela S-WM-58) — os itens 2 (botão "Reenviar
--    pendentes") e 3 (seletor de limite diário) desta story são ESCRITAS reais (disparam
--    envio real de WhatsApp / mudam daily_limit) e não podem ficar atrás só de can_read,
--    senão qualquer role com acesso de leitura ao painel ganharia acidentalmente permissão
--    de acionar reenvios e mudar limites de disparo.

DROP FUNCTION IF EXISTS public.listar_disparos_acompanhamento(text, timestamptz, timestamptz, integer);

CREATE FUNCTION public.listar_disparos_acompanhamento(
  p_motor text DEFAULT NULL,
  p_desde timestamptz DEFAULT NULL,
  p_ate timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  disparo_id uuid,
  item_id uuid,
  motor text,
  titulo text,
  status text,
  criado_em timestamptz,
  total_elegiveis integer,
  total_enviados integer,
  total_entregues integer,
  total_falhou integer,
  total_pendentes integer
)
LANGUAGE sql
STABLE
AS $function$
  WITH pontual_ouvidoria AS (
    SELECT
      d.id AS disparo_id,
      CASE WHEN d.tipo = 'pontual' THEN d.evento_id ELSE oe.id END AS item_id,
      CASE WHEN d.tipo = 'pontual' THEN 'pontual' ELSE 'ouvidoria' END AS motor,
      COALESCE(ep.titulo, oe.titulo, '(evento removido ou desvinculado)') AS titulo,
      d.status,
      d.created_at AS criado_em,
      COALESCE(d.total_destinatarios, 0) AS total_elegiveis,
      (SELECT count(*)::int FROM logs_disparo ld WHERE ld.disparo_id = d.id AND ld.status <> 'falhou') AS total_enviados,
      (SELECT count(*)::int FROM logs_disparo ld WHERE ld.disparo_id = d.id AND ld.status IN ('entregue', 'lido', 'apagada')) AS total_entregues,
      (SELECT count(*)::int FROM logs_disparo ld WHERE ld.disparo_id = d.id AND ld.status IN ('falhou', 'aviso')) AS total_falhou,
      GREATEST(
        COALESCE(d.total_destinatarios, 0)
          - (SELECT count(DISTINCT ld.lead_id)::int FROM logs_disparo ld WHERE ld.disparo_id = d.id),
        0
      ) AS total_pendentes
    FROM disparos d
    LEFT JOIN eventos_pontuais ep ON ep.id = d.evento_id
    LEFT JOIN ouvidoria_eventos oe ON oe.disparo_id = d.id::text
    WHERE (p_motor IS NULL
           OR (p_motor = 'pontual' AND d.tipo = 'pontual')
           OR (p_motor = 'ouvidoria' AND d.tipo <> 'pontual'))
      AND (p_desde IS NULL OR d.created_at >= p_desde)
      AND (p_ate IS NULL OR d.created_at <= p_ate)
  ),
  divulgacao AS (
    SELECT
      dd.id AS disparo_id,
      dd.id AS item_id,
      'divulgacao'::text AS motor,
      dd.titulo,
      dd.status,
      dd.created_at AS criado_em,
      COALESCE(dd.total_leads, 0) AS total_elegiveis,
      (SELECT count(*)::int FROM logs_disparo ld WHERE ld.disparo_divulgacao_id = dd.id AND ld.status <> 'falhou') AS total_enviados,
      (SELECT count(*)::int FROM logs_disparo ld WHERE ld.disparo_divulgacao_id = dd.id AND ld.status IN ('entregue', 'lido', 'apagada')) AS total_entregues,
      (SELECT count(*)::int FROM logs_disparo ld WHERE ld.disparo_divulgacao_id = dd.id AND ld.status IN ('falhou', 'aviso')) AS total_falhou,
      GREATEST(
        COALESCE(dd.total_leads, 0)
          - (SELECT count(DISTINCT ld.lead_id)::int FROM logs_disparo ld WHERE ld.disparo_divulgacao_id = dd.id),
        0
      ) AS total_pendentes
    FROM disparos_divulgacao dd
    WHERE (p_motor IS NULL OR p_motor = 'divulgacao')
      AND (p_desde IS NULL OR dd.created_at >= p_desde)
      AND (p_ate IS NULL OR dd.created_at <= p_ate)
  )
  SELECT * FROM pontual_ouvidoria
  UNION ALL
  SELECT * FROM divulgacao
  ORDER BY criado_em DESC
  LIMIT p_limit;
$function$;

-- Restaura explicitamente o grant observado ao vivo antes do DROP (PUBLIC EXECUTE — cobre
-- anon/authenticated/service_role/postgres) em vez de confiar em default privileges do
-- schema reaplicarem sozinhos após o DROP+CREATE.
GRANT EXECUTE ON FUNCTION public.listar_disparos_acompanhamento(text, timestamptz, timestamptz, integer) TO PUBLIC;

DO $$
DECLARE
  v_role_id uuid;
BEGIN
  SELECT id INTO v_role_id FROM sys_roles WHERE name = 'Super Admin Cuca';
  IF v_role_id IS NOT NULL THEN
    UPDATE sys_permissions
    SET can_update = true, updated_at = now()
    WHERE role_id = v_role_id AND module = 'config_acompanhamento_envios';
  END IF;
END $$;
