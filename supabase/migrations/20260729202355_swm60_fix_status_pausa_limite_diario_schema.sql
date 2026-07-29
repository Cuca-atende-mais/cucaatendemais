-- S-WM-60 (hotfix pós-merge, achado durante retomada da S-WM-59): a correção do falso
-- "concluído" (Steps 1-2 do Plano 008) escreve os status "pausada_limite_diario"
-- (pontual/ouvidoria) e "pausado_limite_diario" (divulgação) — mas o schema real não
-- comporta nenhum dos dois hoje:
--
--   1. `disparos.status` e `eventos_pontuais.status` são varchar(20) — "pausada_limite_diario"
--      tem 21 caracteres. Confirmado ao vivo (execute_sql, transação com ROLLBACK): a escrita
--      falha com "value too long for type character varying(20)". Afeta pontual (as 2
--      colunas) e ouvidoria (só `disparos.status`, já que `ouvidoria_eventos.status` já é
--      `text`, sem limite).
--   2. `disparos_divulgacao.status` tem CHECK constraint (`disparos_divulgacao_status_check`)
--      cuja whitelist (`pendente, em_andamento, concluido, pausado, erro`) não inclui
--      "pausado_limite_diario" — a escrita é bloqueada mesmo a coluna sendo `text`
--      (sem limite de tamanho). Confirmado via pg_get_constraintdef; há indício nos logs do
--      Postgres de uma violação real desta constraint (19:42:01 de hoje), não gerada por
--      este levantamento.
--
-- Nenhum `_update_db_sync` (worker/campanhas_engine.py) que grava esses status está dentro
-- de try/except — o erro sobe sem tratamento, abortando o item no meio do processamento.
-- Ou seja: o próprio ponto da S-WM-60 (nunca mais marcar falso "concluído" ao bater o
-- limite diário) está quebrado em produção desde o merge do PR#64 — qualquer disparo real
-- que bata o limite hoje quebra em vez de pausar corretamente.
--
-- Correção aditiva/expansiva (Article expand-before-contract): larga os 2 varchar(20) pra
-- `text` (mesmo tipo já usado em `ouvidoria_eventos.status`/`disparos_divulgacao.status` —
-- consistência entre as 4 tabelas de status de disparo, nunca mais reintroduz este limite) e
-- inclui o valor faltante na whitelist do CHECK de `disparos_divulgacao`. Idempotente: os
-- blocos DO verificam o estado atual antes de alterar.

DO $$
BEGIN
  IF (SELECT character_maximum_length FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'disparos' AND column_name = 'status') IS NOT NULL THEN
    ALTER TABLE public.disparos ALTER COLUMN status TYPE text;
  END IF;
END $$;

DO $$
BEGIN
  IF (SELECT character_maximum_length FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'eventos_pontuais' AND column_name = 'status') IS NOT NULL THEN
    ALTER TABLE public.eventos_pontuais ALTER COLUMN status TYPE text;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'disparos_divulgacao_status_check' AND conrelid = 'public.disparos_divulgacao'::regclass
  ) THEN
    ALTER TABLE public.disparos_divulgacao DROP CONSTRAINT disparos_divulgacao_status_check;
  END IF;

  ALTER TABLE public.disparos_divulgacao ADD CONSTRAINT disparos_divulgacao_status_check
    CHECK (status = ANY (ARRAY[
      'pendente'::text, 'em_andamento'::text, 'concluido'::text,
      'pausado'::text, 'erro'::text, 'pausado_limite_diario'::text
    ]));
END $$;
