-- S-WM-58 (correção pós-gate CONCERNS, achado do @qa): a RPC listar_disparos_acompanhamento
-- omitia silenciosamente disparos pontuais reais do painel.
--
-- Causa raiz (confirmada com dado real em produção, não estimada):
-- eventos_pontuais.disparo_id é um ponteiro reverso que guarda só o ÚLTIMO disparo daquele
-- evento — se o mesmo evento disparar mais de uma vez, o JOIN por FK reversa
-- (ep.disparo_id = d.id, versão original desta RPC) só encontra o disparo mais recente; os
-- anteriores ficam "órfãos" da FK reversa para sempre, mesmo existindo de verdade em
-- `disparos` com `total_destinatarios`/`logs_disparo` reais.
--
-- Dado real (produção, 2026-07-29): de 10 disparos `tipo='pontual'`, o JOIN antigo só
-- encontrava 5. Investigação encontrou 2 causas distintas, ambas resolvidas abaixo:
--   1. "Sobrescrita" — o evento existe, mas seu `disparo_id` reverso aponta pra OUTRO disparo
--      mais recente do mesmo evento (1 caso real: evento 3cb1226e-..., 2 disparos, só o mais
--      recente aparecia). `disparos.evento_id` (FK direta, preenchida na criação do disparo e
--      nunca sobrescrita depois) resolve isso: join por `ep.id = d.evento_id` em vez de
--      `ep.disparo_id = d.id` — direção contrária, sem o problema de "só guarda o último".
--   2. "Evento excluído depois" — o evento de origem foi apagado via
--      /configuracoes/programacao (rota `programacao/excluir`), deixando `disparos.evento_id`
--      apontando pra um id que não existe mais em `eventos_pontuais` (sem FK/constraint entre
--      as duas tabelas, confirmado via pg_constraint — a exclusão não é bloqueada). Nesse caso
--      não há como recuperar o título do evento (o dado não existe mais), mas o disparo em si
--      é 100% real (tem total_destinatarios e logs_disparo reais) e não deve desaparecer do
--      painel por isso — mostrado com título genérico em vez de ser silenciosamente excluído
--      do UNION ALL (recomendação não bloqueante do @qa no gate CONCERNS, aplicada aqui).
--
-- NÃO altera eventos_pontuais.disparo_id nem ouvidoria_eventos.disparo_id (schema/comportamento
-- legado pré-existente, fora de escopo) — a correção é inteiramente em como a RPC busca os
-- dados, join por FK direta em vez de reversa + inclusão sem depender de match de evento.
--
-- Ouvidoria: `disparos.evento_id` só é preenchido pelo worker para origem='eventos_pontuais'
-- (worker/campanhas_engine.py:375/399) — não há FK direta equivalente pra ouvidoria hoje, e
-- mudar isso é mudança em worker/, fora de escopo desta story. Ouvidoria mantém o join reverso
-- (oe.disparo_id = d.id::text), com o mesmo risco latente de "sobrescrita" descrito acima —
-- mas não some mais do painel silenciosamente: a motor/inclusão agora vêm de `disparos.tipo`
-- (confirmado 1:1 confiável para esta tabela: só 2 origens gravam nela, eventos_pontuais e
-- ouvidoria_eventos — ver worker/campanhas_engine.py, `_criar_disparo_sync` só é chamado a
-- partir de `_processar_item_disparo_interno`), não do match de JOIN.

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
      CASE WHEN d.tipo = 'pontual' THEN 'pontual' ELSE 'ouvidoria' END AS motor,
      COALESCE(ep.titulo, oe.titulo, '(evento removido ou desvinculado)') AS titulo,
      d.status,
      d.created_at AS criado_em,
      COALESCE(d.total_destinatarios, 0) AS total_elegiveis,
      (SELECT count(*)::int FROM logs_disparo ld WHERE ld.disparo_id = d.id AND ld.status <> 'falhou') AS total_enviados,
      (SELECT count(*)::int FROM logs_disparo ld WHERE ld.disparo_id = d.id AND ld.status IN ('entregue', 'lido', 'apagada')) AS total_entregues,
      (SELECT count(*)::int FROM logs_disparo ld WHERE ld.disparo_id = d.id AND ld.status IN ('falhou', 'aviso')) AS total_falhou
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
