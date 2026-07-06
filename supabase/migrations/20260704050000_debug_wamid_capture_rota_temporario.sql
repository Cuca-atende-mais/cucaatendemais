-- DIAGNÓSTICO TEMPORÁRIO (S-WM-16, investigação de duplicação de mensagens) —
-- captura CADA requisição HTTP recebida em /webhook/meta, no ponto mais externo
-- possível (antes de background_tasks.add_task), pra distinguir:
-- - 2 requisições HTTP aqui = Meta entrega 2x na camada HTTP (config externa)
-- - 1 requisição HTTP aqui mas 2 inserts em _debug_wamid_capture = bug de
--   concorrência no processamento interno (processar_webhook_meta)
-- Tabela e o código que grava nela devem ser removidos assim que a
-- investigação for concluída (ver Debug Log da S-WM-16).

CREATE TABLE IF NOT EXISTS public._debug_wamid_capture_rota (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    wamid text,
    phone_number_id text,
    recebido_em timestamptz DEFAULT now()
);
