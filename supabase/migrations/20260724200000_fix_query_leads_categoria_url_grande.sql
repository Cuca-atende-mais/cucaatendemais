-- Achado 2026-07-24: _query_leads_sync (worker/campanhas_engine.py) buscava lead_id em
-- lead_interesses e depois montava um filtro .in_("id", lead_ids) com todos os IDs num único
-- GET — com uma categoria de centenas de leads (ex.: 722), a URL resultante passa do limite
-- do gateway/PostgREST e a API devolve corpo vazio/inválido, quebrando o parse de JSON no
-- cliente Python e derrubando o disparo inteiro (status="pausada").
--
-- Esta função faz o join direto no Postgres: o corpo da requisição RPC (POST) só carrega os
-- UUIDs de categoria (poucos, sempre pequeno), nunca a lista de leads que fizer match — o
-- volume de leads elegíveis deixa de ter qualquer relação com o tamanho da requisição.
CREATE OR REPLACE FUNCTION public.buscar_leads_por_categoria(
  p_categorias uuid[],
  p_unidade text DEFAULT NULL
)
RETURNS TABLE (id uuid, telefone character varying, nome character varying)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT l.id, l.telefone, l.nome
  FROM public.leads l
  JOIN public.lead_interesses li ON li.lead_id = l.id
  WHERE li.categoria_id = ANY(p_categorias)
    AND l.opt_in = true
    AND l.bloqueado = false
    AND (p_unidade IS NULL OR l.unidade_cuca = p_unidade)
$$;
