-- Reativa a tabela logs_disparo (id, disparo_id, lead_id, telefone, status, erro, enviado_em,
-- created_at) — existia desde antes da migração pra Meta, mas o código que escrevia nela foi
-- removido no commit b8282cd (S-WM-05, 2026-06-26) e nunca foi refeito; está com 0 linhas em
-- produção (confirmado por consulta direta, 2026-07-27). Em vez de criar uma 3ª tabela de "log
-- de disparo por lead" do zero, esta migração adiciona as colunas que faltam pra cobrir também
-- o caminho de divulgação mensal (disparo_divulgacao_id) e a correlação com o wamid retornado
-- pela Meta (necessária pra casar com os eventos statuses[] do webhook, ver worker/meta_adapter_inbound.py).
--
-- Achado B/C do diagnóstico arquitetural (docs/qa/RELATORIO-10-panorama-disparo-corrida-juventude-2026-07-26.md):
-- hoje o sistema só sabe se o POST pra API da Meta teve sucesso HTTP, nunca se a mensagem foi de
-- fato entregue, lida ou falhou do lado do destinatário — os eventos statuses[] que a Meta manda
-- pra isso são descartados sem leitura.
--
-- Ajuste sobre o texto original do plano (S-WM-57, Task 0 — 2026-07-27): a suposição de que
-- disparo_id/lead_id não tinham FK estava desatualizada. Confirmado ao vivo, direto em produção:
--   logs_disparo_disparo_id_fkey -> disparos(id)           ON DELETE CASCADE
--   logs_disparo_lead_id_fkey    -> leads(id)              ON DELETE CASCADE
-- O CASCADE em lead_id é uma decisão de produto (se um lead é excluído, ex. pedido LGPD, o
-- histórico de entrega dele neste ledger some junto) — avaliada e mantida como está pelo Junior,
-- sem mudança. A coluna nova disparo_divulgacao_id segue a MESMA convenção já estabelecida na
-- tabela (FK + CASCADE), em vez de ficar sem REFERENCES como o texto desatualizado do plano
-- original descrevia.

ALTER TABLE public.logs_disparo
  ADD COLUMN disparo_divulgacao_id uuid REFERENCES public.disparos_divulgacao(id) ON DELETE CASCADE,
  ADD COLUMN wamid text,
  ADD COLUMN atualizado_em timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.logs_disparo
  ADD CONSTRAINT logs_disparo_um_disparo_check CHECK (
    (disparo_id IS NOT NULL AND disparo_divulgacao_id IS NULL) OR
    (disparo_id IS NULL AND disparo_divulgacao_id IS NOT NULL)
  );

CREATE INDEX idx_logs_disparo_wamid ON public.logs_disparo (wamid) WHERE wamid IS NOT NULL;
CREATE INDEX idx_logs_disparo_lead_id ON public.logs_disparo (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX idx_logs_disparo_disparo_divulgacao_id ON public.logs_disparo (disparo_divulgacao_id) WHERE disparo_divulgacao_id IS NOT NULL;
