-- S-WM-57 (emenda 2026-07-28, revisão do sócio): proteção contra status da Meta
-- chegando fora de ordem no consumo de statuses[] (worker/meta_adapter_inbound.py).
--
-- O UPDATE de logs_disparo por wamid (Step 5 do Plano 007) sobrescrevia o status
-- sem checar se o evento recebido era mais recente que o já gravado — 2 webhooks
-- quase simultâneos pro mesmo wamid (ex.: "read" processado antes de "delivered"
-- terminar de gravar, ou reentrega de um evento antigo pela Meta) podiam fazer o
-- status regredir (ex.: "lido" sobrescrito por um "entregue" atrasado).
--
-- Esta coluna guarda o timestamp do evento reportado pela própria Meta (epoch,
-- convertido para timestamptz), permitindo que o UPDATE seguinte cheque a ordem
-- na própria query (via .or_(), atômico), em vez de SELECT-depois-compara em
-- Python (que teria janela de corrida entre 2 webhooks concorrentes).

ALTER TABLE public.logs_disparo
  ADD COLUMN IF NOT EXISTS status_timestamp_meta timestamptz;
