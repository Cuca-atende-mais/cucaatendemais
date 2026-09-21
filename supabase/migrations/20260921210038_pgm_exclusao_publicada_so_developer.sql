-- Programação mensal: programação publicada (RAG no ar) só pode ser excluída por Developer
-- (decisão do Junior, 2026-09-21). Antes de publicar, exclui quem tem "Excluir programação inteira".
--
-- "Publicada" = o documento da programação está no ar no RAG — mesma regra do selo "No RAG" de
-- `pgm_situacao_campanhas` e do estado "no_ar" da Divulgação.
--
-- A exclusão pelo portal passa pela rota `/api/programacao/excluir`, que grava com a chave de serviço
-- (as políticas não se aplicam e `is_developer()` não enxerga o usuário): a rota é quem aplica a regra.
-- A política abaixo repete a regra para quem tentar apagar direto pela API, com a própria sessão.

-- ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pgm_campanha_publicada(p_campanha_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.documentos_rag d
        WHERE d.tipo = 'monthly_program' AND d.ativo
          AND d.metadados->>'campanha_id' = p_campanha_id::text
          AND EXISTS (SELECT 1 FROM public.chunks_documentos ch WHERE ch.documento_id = d.id)
    )
$function$;

REVOKE ALL ON FUNCTION public.pgm_campanha_publicada(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pgm_campanha_publicada(uuid) TO authenticated, service_role;

-- Exclusão direta pela API (sem passar pela rota): mesma regra da rota `/api/programacao/excluir`.
DROP POLICY IF EXISTS campanhas_mensais_exclusao ON public.campanhas_mensais;
CREATE POLICY campanhas_mensais_exclusao ON public.campanhas_mensais
    FOR DELETE TO authenticated
    USING (
        public.is_developer()
        OR (
            public.has_permission_exata('pgm_excluir_programacao'::character varying, 'read'::character varying)
            AND NOT public.pgm_campanha_publicada(id)
        )
    );
