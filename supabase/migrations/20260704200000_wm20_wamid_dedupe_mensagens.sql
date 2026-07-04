-- S-WM-20 Task 1: dedupe de mensagens inbound por wamid (id da mensagem na Meta).
-- Reentrega de webhook (retry da Meta) processava a mesma mensagem 2x, duplicando
-- gravação em mensagens e disparando resposta duplicada. Coluna nullable: histórico
-- existente não tem esse dado, sem backfill retroativo.
ALTER TABLE public.mensagens ADD COLUMN IF NOT EXISTS wamid text;

CREATE UNIQUE INDEX IF NOT EXISTS mensagens_wamid_unique
    ON public.mensagens (wamid)
    WHERE wamid IS NOT NULL;
