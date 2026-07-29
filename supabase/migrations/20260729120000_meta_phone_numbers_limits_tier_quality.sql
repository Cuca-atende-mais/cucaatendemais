-- Plano 008 / S-WM-60
-- Move o limite diário para o lugar correto: por número Meta, não global em configuracoes.
-- messaging_limit_tier e quality_rating também são por número e são preenchidos manualmente
-- a partir do Business Manager; esta migration NÃO busca nada automaticamente na API da Meta.
--
-- NÃO aplicada pelo @dev — instrução explícita de Junior para esta story (diferente de
-- stories anteriores): aplicar em produção via @devops só depois do gate do QA, porque é
-- mudança de comportamento sensível o bastante pra passar por gate antes de tocar produção.
--
-- ORDEM DE DEPLOY OBRIGATÓRIA (@devops, ler antes de aplicar): o worker (código desta
-- story) lê meta_phone_numbers.daily_limit em toda chamada de disparo/retomada assim que
-- redeployado. Se o worker for redeployado ANTES desta migration ser aplicada, toda
-- chamada a _get_daily_limit_by_phone_sync falha (coluna não existe) — a função tem
-- try/except e cai no fallback (500), então não quebra o disparo, mas loga erro
-- indevidamente até a migration ser aplicada. Aplicar esta migration ANTES (ou, na pior
-- hipótese, imediatamente junto) do redeploy do worker, nunca depois.
--
-- Confirmado ao vivo (2026-07-29, @dev): nenhuma das 4 colunas abaixo existe hoje em
-- meta_phone_numbers (STOP condition do plano verificada — não bateu, seguindo normalmente).

ALTER TABLE public.meta_phone_numbers
  ADD COLUMN IF NOT EXISTS daily_limit integer,
  ADD COLUMN IF NOT EXISTS messaging_limit_tier integer,
  ADD COLUMN IF NOT EXISTS messaging_limit_tier_confirmado_em timestamptz,
  ADD COLUMN IF NOT EXISTS quality_rating text;

-- Semeado com o valor já confirmado ao vivo no Business Manager em 2026-07-28 (print
-- real, "Limites de mensagens" — 250 → 2000 [atual] → 10000 → 100000 → Ilimitado), pra
-- não nascer NULL quando já sabemos o valor certo. Hoje os 3 motores deste plano usam
-- o número Institucional; o ganho de limites distintos aparece quando Ouvidoria/Academia
-- Enem ganharem phone_number_id próprio.
--
-- Nota: o texto original do plano registra a confirmação como "28/07, 14:06 GMT+1", mas o
-- literal ISO do rascunho usava "-01:00" (GMT-1) — sinal trocado. Corrigido aqui para
-- "+01:00", consistente com o texto ("GMT+1"); é só o timestamp de quando o dado foi
-- checado (campo de observabilidade), não afeta o valor de daily_limit/messaging_limit_tier
-- em si.
UPDATE public.meta_phone_numbers
SET daily_limit = 2000,
    messaging_limit_tier = 2000,
    messaging_limit_tier_confirmado_em = '2026-07-28T14:06:00+01:00'
WHERE canal_tipo = 'Institucional';
