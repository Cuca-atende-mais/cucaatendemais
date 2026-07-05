-- Cutover S-WM-Meta (achado do Relatório 4/5 de auditoria de migrations): limpeza de artefato órfão.
-- _debug_wamid_capture_rota foi criada em 20260704050000 para investigação de duplicação
-- de mensagens (S-WM-16/17) e nunca teve um DROP correspondente. Confirmado via grep em
-- toda a base develop (.py/.ts/.tsx/.sql) que nenhum código de aplicação grava nela hoje —
-- a investigação está concluída e a tabela ficaria como lixo de debug esquecido em produção.

DROP TABLE IF EXISTS public._debug_wamid_capture_rota;
