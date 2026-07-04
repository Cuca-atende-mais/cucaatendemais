-- S-WM-16 (ajuste final): remover os últimos 3 templates "cuca_*" legados
-- Pré-requisito: nenhum código (worker, portal, edge functions) referencia esses
-- nomes por string literal — todo lookup agora é relacional (automacoes + phone_number_ids).
-- Confirmado por grep antes desta migration (ver Debug Log da story S-WM-16).

DELETE FROM public.meta_templates
WHERE nome IN ('cuca_evento_pontual', 'cuca_evento_pontual_admin', 'cuca_pesquisa_ouvidoria');
