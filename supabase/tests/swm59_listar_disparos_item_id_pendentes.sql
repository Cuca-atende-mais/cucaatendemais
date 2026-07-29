-- Teste de regressão para public.listar_disparos_acompanhamento (S-WM-59, item 1/2).
--
-- Cobre as 2 colunas novas adicionadas nesta story:
--   - item_id: precisa ser o id na tabela de ORIGEM (eventos_pontuais/ouvidoria_eventos/
--     disparos_divulgacao), não disparo_id — é o que o portal manda pro endpoint
--     /retomar-disparo/{origem}/{item_id} (S-WM-60). Pra pontual, item_id != disparo_id;
--     pra divulgação, item_id == disparo_id (mesma tabela).
--   - total_pendentes: contagem exata (elegíveis - tentados via DISTINCT lead_id em
--     logs_disparo), não a aproximação enviados+falhou (que teria dupla contagem de linhas
--     'aviso').
--
-- Como rodar: cole o conteúdo inteiro num único execute_sql (ou `psql -f`). Transacional
-- (BEGIN...ROLLBACK) — nada é persistido.
--
-- Resultado esperado: a1 (pontual) tem item_id = evento 'aa', total_pendentes = 2 (5
-- elegíveis, 3 tentados: 2 sucesso + 1 aviso, sem dupla contagem). a-div (divulgação) tem
-- item_id = o próprio disparo_id.

BEGIN;

INSERT INTO eventos_pontuais (id, titulo, data_evento, status)
VALUES ('00000000-0000-0000-0000-0000000000aa', '[TESTE SWM59] Evento pendentes', CURRENT_DATE, 'concluido');

INSERT INTO disparos (id, tipo, evento_id, instancia_uazapi, mensagem_template, total_destinatarios, total_enviados, total_erros, status, created_at)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'pontual', '00000000-0000-0000-0000-0000000000aa', 'teste-swm59', 'teste_swm59', 5, 3, 0, 'pausada_limite_diario', now());

-- 3 leads tentados (2 sucesso + 1 aviso) — total_pendentes deve ser 5 - 3 = 2, não
-- 5 - (enviados[status<>'falhou', que JÁ inclui o aviso] + falhou[que TAMBÉM inclui o
-- aviso]) = 5 - (3+1) = 1, que subcontaria pendentes por dupla contagem do aviso.
INSERT INTO logs_disparo (disparo_id, lead_id, telefone, status)
VALUES
  ('00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), '5599999990001', 'entregue'),
  ('00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), '5599999990002', 'entregue'),
  ('00000000-0000-0000-0000-0000000000a1', gen_random_uuid(), '5599999990003', 'aviso');

INSERT INTO disparos_divulgacao (id, mes, ano, titulo, corpo_texto, instancia_uazapi, total_leads, total_enviados, total_erros, status, created_at)
VALUES ('00000000-0000-0000-0000-0000000000d1', 8, 2026, '[TESTE SWM59] Divulgação pendentes', 'corpo teste', 'teste-swm59', 4, 0, 0, 'pausado_limite_diario', now());

SELECT r.disparo_id, r.item_id, r.motor, r.total_elegiveis, r.total_pendentes
FROM listar_disparos_acompanhamento(p_limit := 1000) r
WHERE r.disparo_id IN (
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000d1'
)
ORDER BY r.disparo_id;

-- Asserção principal (conferir manualmente no resultado acima, ou descomentar pra travar
-- a checagem via exceção):
-- DO $$
-- DECLARE
--   v_item_id_pontual uuid;
--   v_pendentes_pontual int;
--   v_item_id_div uuid;
-- BEGIN
--   SELECT item_id, total_pendentes INTO v_item_id_pontual, v_pendentes_pontual
--   FROM listar_disparos_acompanhamento(p_limit := 1000)
--   WHERE disparo_id = '00000000-0000-0000-0000-0000000000a1';
--
--   IF v_item_id_pontual <> '00000000-0000-0000-0000-0000000000aa' THEN
--     RAISE EXCEPTION 'item_id pontual errado: esperado o evento aa, veio %', v_item_id_pontual;
--   END IF;
--   IF v_pendentes_pontual <> 2 THEN
--     RAISE EXCEPTION 'total_pendentes pontual errado: esperado 2, veio %', v_pendentes_pontual;
--   END IF;
--
--   SELECT item_id INTO v_item_id_div
--   FROM listar_disparos_acompanhamento(p_limit := 1000)
--   WHERE disparo_id = '00000000-0000-0000-0000-0000000000d1';
--   IF v_item_id_div <> '00000000-0000-0000-0000-0000000000d1' THEN
--     RAISE EXCEPTION 'item_id divulgacao deveria ser igual ao disparo_id, veio %', v_item_id_div;
--   END IF;
-- END $$;

ROLLBACK;
