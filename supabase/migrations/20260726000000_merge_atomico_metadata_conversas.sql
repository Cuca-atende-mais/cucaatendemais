-- Fix: conversas.metadata é escrita por 3 processos concorrentes (motor-agente,
-- worker/campanhas_engine.py::_processar_item_disparo_interno,
-- worker/campanhas_engine.py::_processar_disparo_divulgacao_interno) que compartilham
-- o mesmo número WhatsApp Institucional. motor-agente lê conversa.metadata 1x no início
-- da requisição e depois grava esse snapshot em memória de volta até 14 vezes ao longo
-- do mesmo turno (.update({metadata: ...}) substitui a coluna JSONB inteira — não faz
-- merge no banco). Se um dos workers gravar um campo (ex.: ultimo_disparo) enquanto uma
-- requisição do motor-agente pro mesmo lead já está em andamento, o próximo .update() do
-- motor-agente apaga esse campo, porque o snapshot em memória nunca o teve.
--
-- Esta função faz o merge no próprio Postgres, atomicamente: cada chamador manda só as
-- chaves que ele quer definir/alterar (não a linha inteira), e o banco funde isso sobre o
-- valor ATUAL da coluna (não sobre uma cópia antiga) — nenhuma chave que o chamador não
-- menciona é tocada, então uma chave gravada por outro processo entre o read e o write do
-- chamador atual nunca é apagada por este merge.

CREATE OR REPLACE FUNCTION public.merge_conversa_metadata(p_conversa_id uuid, p_patch jsonb)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.conversas
  SET metadata = COALESCE(metadata, '{}'::jsonb) || p_patch
  WHERE id = p_conversa_id;
$$;
