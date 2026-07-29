-- Teste de regressão para public.listar_disparos_acompanhamento (S-WM-58).
--
-- Cobre o achado do @qa Quinn no gate CONCERNS de 2026-07-28: o JOIN por FK reversa
-- (eventos_pontuais.disparo_id) omitia silenciosamente disparos pontuais reais quando
-- (a) o mesmo evento disparava mais de uma vez — o ponteiro reverso guarda só o último — ou
-- (b) o evento de origem era excluído depois do disparo (rota /configuracoes/programacao).
--
-- Como rodar: cole o conteúdo inteiro num único execute_sql (ou `psql -f`). É transacional
-- (BEGIN...ROLLBACK) — nada é persistido, seguro pra rodar direto em produção (cuca-dev está
-- descontinuado pra trabalho de banco, ver .claude/rules/cuca-deploy-environments.md).
--
-- Resultado esperado: a query final retorna 3 linhas (a1, a2, a3), cada uma com o
-- `total_elegiveis`/`total_entregues` correspondente. Se a RPC regredir pro join reverso
-- antigo, a1 desaparece (só a2 apareceria, por ser o disparo mais recente do evento aa).

BEGIN;

INSERT INTO eventos_pontuais (id, titulo, data_evento, status)
VALUES ('00000000-0000-0000-0000-0000000000aa', '[TESTE SWM58] Evento com 2 disparos', CURRENT_DATE, 'concluido');

-- Disparo mais antigo do evento — é o que o JOIN reverso antigo perdia.
INSERT INTO disparos (id, tipo, evento_id, instancia_uazapi, mensagem_template, total_destinatarios, total_enviados, total_erros, status, created_at)
VALUES ('00000000-0000-0000-0000-0000000000a1', 'pontual', '00000000-0000-0000-0000-0000000000aa', 'teste-swm58', 'teste_swm58', 3, 3, 0, 'concluida', now() - interval '2 days');

-- Disparo mais recente do MESMO evento.
INSERT INTO disparos (id, tipo, evento_id, instancia_uazapi, mensagem_template, total_destinatarios, total_enviados, total_erros, status, created_at)
VALUES ('00000000-0000-0000-0000-0000000000a2', 'pontual', '00000000-0000-0000-0000-0000000000aa', 'teste-swm58', 'teste_swm58', 5, 5, 0, 'concluida', now());

INSERT INTO logs_disparo (disparo_id, telefone, status)
VALUES
  ('00000000-0000-0000-0000-0000000000a1', '5599999990001', 'entregue'),
  ('00000000-0000-0000-0000-0000000000a1', '5599999990002', 'entregue'),
  ('00000000-0000-0000-0000-0000000000a2', '5599999990003', 'entregue'),
  ('00000000-0000-0000-0000-0000000000a2', '5599999990004', 'entregue');

-- Comportamento legado real (não alterado por esta correção): o ponteiro reverso do evento
-- só consegue apontar pra UM disparo — fica com o mais recente.
UPDATE eventos_pontuais SET disparo_id = '00000000-0000-0000-0000-0000000000a2'
WHERE id = '00000000-0000-0000-0000-0000000000aa';

-- Disparo cujo evento de origem foi excluído depois (evento_id 'bb' nunca existe em
-- eventos_pontuais) — simula a rota /configuracoes/programacao excluindo o evento.
INSERT INTO disparos (id, tipo, evento_id, instancia_uazapi, mensagem_template, total_destinatarios, total_enviados, total_erros, status, created_at)
VALUES ('00000000-0000-0000-0000-0000000000a3', 'pontual', '00000000-0000-0000-0000-0000000000bb', 'teste-swm58', 'teste_swm58', 2, 2, 0, 'concluida', now() - interval '1 day');

-- Asserção: as 3 linhas devem aparecer. a1/a2 com o título real do evento; a3 com o
-- fallback genérico (evento não existe mais, mas o disparo em si é real).
SELECT r.disparo_id, r.motor, r.titulo, r.total_elegiveis, r.total_entregues
FROM listar_disparos_acompanhamento(p_motor := 'pontual', p_limit := 1000) r
WHERE r.disparo_id IN (
  '00000000-0000-0000-0000-0000000000a1',
  '00000000-0000-0000-0000-0000000000a2',
  '00000000-0000-0000-0000-0000000000a3'
)
ORDER BY r.disparo_id;

ROLLBACK;
