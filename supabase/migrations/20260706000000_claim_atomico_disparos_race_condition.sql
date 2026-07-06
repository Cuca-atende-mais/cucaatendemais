-- Fix: disparo duplicado para o mesmo lead (2 workers gunicorn rodando
-- campanhas_loop() em paralelo, cada um com seu próprio SELECT+UPDATE
-- não atômico sobre a fila de pendentes/aprovados).
--
-- Substitui o padrão "SELECT status=X" seguido de "UPDATE status=em_andamento"
-- (com janela de corrida entre as duas chamadas) por um claim atômico via
-- UPDATE ... WHERE id = (SELECT ... FOR UPDATE SKIP LOCKED) em uma única
-- instrução SQL — dois processos concorrentes nunca conseguem reivindicar
-- a mesma linha.

CREATE OR REPLACE FUNCTION public.claim_disparo_divulgacao()
RETURNS SETOF public.disparos_divulgacao
LANGUAGE sql
AS $$
  UPDATE public.disparos_divulgacao
  SET status = 'em_andamento', updated_at = now()
  WHERE id = (
    SELECT id FROM public.disparos_divulgacao
    WHERE status = 'pendente'
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING *;
$$;

CREATE OR REPLACE FUNCTION public.claim_evento_pontual()
RETURNS SETOF public.eventos_pontuais
LANGUAGE sql
AS $$
  UPDATE public.eventos_pontuais
  SET status = 'em_andamento', updated_at = now()
  WHERE id = (
    SELECT id FROM public.eventos_pontuais
    WHERE status = 'aprovado' AND disparo_id IS NULL
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING *;
$$;

CREATE OR REPLACE FUNCTION public.claim_ouvidoria_evento()
RETURNS SETOF public.ouvidoria_eventos
LANGUAGE sql
AS $$
  UPDATE public.ouvidoria_eventos
  SET status = 'em_andamento', updated_at = now()
  WHERE id = (
    SELECT id FROM public.ouvidoria_eventos
    WHERE status = 'ativo' AND disparo_id IS NULL
    ORDER BY created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING *;
$$;
