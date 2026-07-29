-- S-WM-58: Painel de Acompanhamento de Envios (Visão de Entrega) — RPC de agregação
-- + seed do recurso RBAC config_acompanhamento_envios pro role Super Admin Cuca.
--
-- A função agrega logs_disparo (S-WM-57, já em produção) por disparo_id/disparo_divulgacao_id.
-- Motor pontual/ouvidoria é distinguido via FK reversa (eventos_pontuais.disparo_id /
-- ouvidoria_eventos.disparo_id) — disparos.tipo NÃO distingue isso de forma confiável hoje
-- (código grava tipo='mensal' tanto pra ouvidoria_eventos quanto pra qualquer origem que não
-- seja eventos_pontuais, confirmado em worker/campanhas_engine.py:396).
--
-- Achado ao aplicar esta migration: ouvidoria_eventos.disparo_id é `text`, enquanto
-- eventos_pontuais.disparo_id é `uuid` (inconsistência de schema pré-existente, não
-- introduzida nem corrigida aqui — fora de escopo desta story). O JOIN abaixo faz cast
-- explícito (oe.disparo_id::uuid) só pra comparar, sem alterar a coluna real.
--
-- Sem checagem de permissão dentro da função (STABLE, não SECURITY DEFINER) — a autorização
-- é feita na camada da rota Next.js (cuca-portal/src/app/api/configuracoes/acompanhamento-envios),
-- mesmo padrão já usado em cuca-portal/src/app/api/divulgacao/disparar/route.ts (checagem de
-- sys_permissions em TS antes de usar o client admin, que já bypassa RLS).

CREATE OR REPLACE FUNCTION public.listar_disparos_acompanhamento(
  p_motor text DEFAULT NULL,
  p_desde timestamptz DEFAULT NULL,
  p_ate timestamptz DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  disparo_id uuid,
  motor text,
  titulo text,
  status text,
  criado_em timestamptz,
  total_elegiveis integer,
  total_enviados integer,
  total_entregues integer,
  total_falhou integer
)
LANGUAGE sql
STABLE
AS $function$
  WITH pontual_ouvidoria AS (
    SELECT
      d.id AS disparo_id,
      CASE WHEN ep.id IS NOT NULL THEN 'pontual' ELSE 'ouvidoria' END AS motor,
      COALESCE(ep.titulo, oe.titulo) AS titulo,
      d.status,
      d.created_at AS criado_em,
      COALESCE(d.total_destinatarios, 0) AS total_elegiveis,
      (SELECT count(*)::int FROM logs_disparo ld WHERE ld.disparo_id = d.id AND ld.status <> 'falhou') AS total_enviados,
      (SELECT count(*)::int FROM logs_disparo ld WHERE ld.disparo_id = d.id AND ld.status IN ('entregue', 'lido', 'apagada')) AS total_entregues,
      (SELECT count(*)::int FROM logs_disparo ld WHERE ld.disparo_id = d.id AND ld.status IN ('falhou', 'aviso')) AS total_falhou
    FROM disparos d
    LEFT JOIN eventos_pontuais ep ON ep.disparo_id = d.id
    LEFT JOIN ouvidoria_eventos oe ON oe.disparo_id = d.id::text
    WHERE (ep.id IS NOT NULL OR oe.id IS NOT NULL)
      AND (p_motor IS NULL
           OR (p_motor = 'pontual' AND ep.id IS NOT NULL)
           OR (p_motor = 'ouvidoria' AND oe.id IS NOT NULL))
      AND (p_desde IS NULL OR d.created_at >= p_desde)
      AND (p_ate IS NULL OR d.created_at <= p_ate)
  ),
  divulgacao AS (
    SELECT
      dd.id AS disparo_id,
      'divulgacao'::text AS motor,
      dd.titulo,
      dd.status,
      dd.created_at AS criado_em,
      COALESCE(dd.total_leads, 0) AS total_elegiveis,
      (SELECT count(*)::int FROM logs_disparo ld WHERE ld.disparo_divulgacao_id = dd.id AND ld.status <> 'falhou') AS total_enviados,
      (SELECT count(*)::int FROM logs_disparo ld WHERE ld.disparo_divulgacao_id = dd.id AND ld.status IN ('entregue', 'lido', 'apagada')) AS total_entregues,
      (SELECT count(*)::int FROM logs_disparo ld WHERE ld.disparo_divulgacao_id = dd.id AND ld.status IN ('falhou', 'aviso')) AS total_falhou
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

-- Seed: Super Admin Cuca ganha acesso de saída ao novo recurso — mesmo padrão idempotente
-- já usado em 20260621000000_seed_sys_roles_super_admin.sql (ON CONFLICT DO NOTHING).
DO $$
DECLARE
  v_role_id uuid;
BEGIN
  SELECT id INTO v_role_id FROM sys_roles WHERE name = 'Super Admin Cuca';
  IF v_role_id IS NOT NULL THEN
    INSERT INTO sys_permissions (role_id, module, can_read, can_create, can_update, can_delete)
    VALUES (v_role_id, 'config_acompanhamento_envios', true, false, false, false)
    ON CONFLICT (role_id, module) DO NOTHING;
  END IF;
END $$;
