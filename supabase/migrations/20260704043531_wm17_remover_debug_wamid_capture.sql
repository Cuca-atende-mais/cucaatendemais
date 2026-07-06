-- S-WM-17: remove a infraestrutura temporária usada para diagnosticar a
-- duplicação de mensagens no webhook Meta. Idempotente para permitir promoção
-- controlada entre ambientes após validação no cuca-dev.
DROP TABLE IF EXISTS public._debug_wamid_capture;
DROP TABLE IF EXISTS public._debug_wamid_capture_rota;
