-- DIAGNÓSTICO TEMPORÁRIO (S-WM-16, investigação de duplicação de mensagens) —
-- captura o wamid (msg["id"] da Meta) de cada evento inbound recebido, para
-- decidir se a duplicação é "mesmo wamid 2x" (Meta reentregou o mesmo evento)
-- ou "wamids diferentes" (2 entregas distintas, problema de config na Meta).
-- Tabela e o código que grava nela devem ser removidos assim que a
-- investigação for concluída (ver Debug Log da S-WM-16).

CREATE TABLE IF NOT EXISTS public._debug_wamid_capture (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    wamid text,
    phone_number_id text,
    recebido_em timestamptz DEFAULT now()
);
