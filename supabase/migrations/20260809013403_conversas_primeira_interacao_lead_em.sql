-- S-WM-66 Task 1 — coluna que marca o momento da 1a mensagem enviada PELO LEAD
-- (nunca setada pelo caminho de disparo/breadcrumb) -- base pra fixar, no painel
-- de Atendimento, toda conversa que ja teve interacao real, sem depender de
-- awaiting_human (handover explicito, que a instrucao de "fale com humano"
-- deliberadamente omitida do prompt torna raro). Ver
-- docs/qa/LEVANTAMENTO-Fila-Fixa-Leads-Engajados-Atendimento-2026-08.md e
-- docs/stories/S-WM-66-Fila-Fixa-Leads-Engajados-Atendimento.md.
--
-- Backfill obrigatorio (AC1): toda conversa que ja tem >=1 mensagem
-- remetente='lead' recebe o timestamp da primeira delas -- sem isso, a story
-- nasceria tratando leads que ja interagiram no passado como "nunca
-- interagiram", escondendo exatamente quem deveria aparecer fixo.
--
-- Resultado medido apos aplicar: 25 conversas com interacao real de lead, 25
-- com a coluna preenchida, 0 divergencias (diferenca simetrica entre os dois
-- conjuntos, nao so contagem batendo por coincidencia).
--
-- Idempotente: ADD COLUMN IF NOT EXISTS + UPDATE restrito a coluna NULL.

ALTER TABLE public.conversas
  ADD COLUMN IF NOT EXISTS primeira_interacao_lead_em timestamptz;

UPDATE public.conversas c
SET primeira_interacao_lead_em = (
  SELECT min(m.created_at) FROM public.mensagens m
  WHERE m.conversa_id = c.id AND m.remetente = 'lead'
)
WHERE c.primeira_interacao_lead_em IS NULL
  AND EXISTS (
    SELECT 1 FROM public.mensagens m WHERE m.conversa_id = c.id AND m.remetente = 'lead'
  );
