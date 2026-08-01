-- S-WM-63: remove a tabela human_handover_contacts, aposentada em favor de
-- transbordo_humano (tabela canonica confirmada com Junior -- ja tem 3 telas de admin
-- funcionando, human_handover_contacts nao tinha nenhuma tela real usando ela).
--
-- Confirmado antes do DROP: unica linha era "Davi" (modulo='empregabilidade', legado desde
-- abril/2026), sem nenhuma FK referenciando esta tabela. _notificar_transbordo
-- (worker/meta_adapter_inbound.py) ja foi retargetado para ler transbordo_humano.
--
-- Idempotente: DROP TABLE IF EXISTS, seguro para reexecutar.

DROP TABLE IF EXISTS human_handover_contacts;
