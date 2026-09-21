-- Programação mensal: `pgm_situacao_campanhas` passa a devolver `a_recriar` — quantas categorias foram
-- excluídas pelo supervisor e ainda precisam ser recriadas e autorizadas. A tela de criação usa isso para
-- não oferecer "Substituir?" numa programação que o servidor recusaria (ela já foi enviada/autorizada).
--
-- Mudar as colunas de retorno exige DROP + CREATE (CREATE OR REPLACE não troca o tipo de retorno).
-- Retrocompatível: só acrescenta uma coluna; a lista lê os campos pelo nome. Grants refeitos iguais aos de antes.

DROP FUNCTION IF EXISTS public.pgm_situacao_campanhas(uuid[]);

CREATE FUNCTION public.pgm_situacao_campanhas(p_ids uuid[])
 RETURNS TABLE(campanha_id uuid, total_categorias integer, autorizadas integer, aguardando integer, no_rag boolean, a_recriar integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT
        c.id,
        (SELECT count(*)::int FROM public.campanha_categoria_status s
            WHERE s.campanha_id = c.id
              AND (s.exigir_recriacao OR EXISTS (SELECT 1 FROM public.atividades_mensais a
                          WHERE a.campanha_id = c.id AND public.pgm_slug_categoria(a.categoria) = public.pgm_slug_categoria(s.categoria)))),
        (SELECT count(*)::int FROM public.campanha_categoria_status s
            WHERE s.campanha_id = c.id AND s.status = 'autorizada'
              AND EXISTS (SELECT 1 FROM public.atividades_mensais a
                          WHERE a.campanha_id = c.id AND public.pgm_slug_categoria(a.categoria) = public.pgm_slug_categoria(s.categoria))),
        (SELECT count(*)::int FROM public.campanha_categoria_status s
            WHERE s.campanha_id = c.id AND s.status = 'aguardando_autorizacao'
              AND EXISTS (SELECT 1 FROM public.atividades_mensais a
                          WHERE a.campanha_id = c.id AND public.pgm_slug_categoria(a.categoria) = public.pgm_slug_categoria(s.categoria))),
        EXISTS (
            SELECT 1 FROM public.documentos_rag d
            WHERE d.tipo = 'monthly_program' AND d.ativo
              AND d.metadados->>'campanha_id' = c.id::text
              AND EXISTS (SELECT 1 FROM public.chunks_documentos ch WHERE ch.documento_id = d.id)
        ),
        (SELECT count(*)::int FROM public.campanha_categoria_status s
            WHERE s.campanha_id = c.id AND s.exigir_recriacao)
    FROM public.campanhas_mensais c
    WHERE c.id = ANY(p_ids)
      AND (
          public.is_developer()
          OR (
              (c.unidade_cuca IS NULL OR c.unidade_cuca::text = public.get_my_unit() OR public.get_my_unit() IS NULL)
              AND public.pgm_pode_ler_campanhas()
          )
      );
$function$;

REVOKE ALL ON FUNCTION public.pgm_situacao_campanhas(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pgm_situacao_campanhas(uuid[]) TO authenticated, service_role;
