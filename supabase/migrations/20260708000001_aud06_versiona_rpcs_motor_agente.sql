-- AUD-06 (auditoria externa 2026-07-07): captura de estado atual das 3 funções (RPCs) usadas
-- pelo motor-agente que só existiam em produção, sem migração versionada — criadas direto no
-- banco em algum momento, fora do Git (mesmo padrão do AUD-02). Corpo capturado via
-- pg_get_functiondef contra produção (svzkrkfzpiqcesloukgb) em 2026-07-08, leitura read-only.
-- NENHUMA mudança de comportamento nesta migração — é captura idêntica ao que já roda hoje.
-- CREATE OR REPLACE torna a aplicação idempotente.
--
-- Confirmação explícita (pedida na auditoria): buscar_chunks_similares FILTRA
-- documentos_rag.ativo = true (ver "AND dr.ativo = true" abaixo) — não puxa programação de
-- meses/documentos expirados.
--
-- NÃO aplicar automaticamente — arquivo pronto para o Junior rodar manualmente em produção.

CREATE OR REPLACE FUNCTION public.get_openai_key()
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'vault', 'public'
AS $function$
DECLARE
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'openai_api_key'
  LIMIT 1;

  RETURN v_key;
END;
$function$;

CREATE OR REPLACE FUNCTION public.buscar_chunks_similares(
  query_embedding vector,
  p_unidade_cuca text DEFAULT NULL::text,
  p_tipos text[] DEFAULT NULL::text[],
  p_limite integer DEFAULT 5
)
 RETURNS TABLE(chunk_id uuid, documento_id uuid, conteudo text, similaridade double precision, metadados jsonb, fonte_tipo text)
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  RETURN QUERY
  SELECT
    cd.id AS chunk_id,
    cd.documento_id,
    cd.conteudo::text,
    1 - (cd.embedding <=> query_embedding) AS similaridade,
    cd.metadados,
    dr.tipo::text AS fonte_tipo
  FROM public.chunks_documentos cd
  JOIN public.documentos_rag dr ON dr.id = cd.documento_id
  WHERE cd.embedding IS NOT NULL
    AND dr.ativo = true
    AND (p_unidade_cuca IS NULL OR dr.unidade_cuca IS NULL OR dr.unidade_cuca = p_unidade_cuca)
    AND (p_tipos IS NULL OR dr.tipo::text = ANY(p_tipos))
  ORDER BY cd.embedding <=> query_embedding
  LIMIT p_limite;
END;
$function$;

CREATE OR REPLACE FUNCTION public.increment_nao_lidas(conv_id uuid)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE conversas SET nao_lidas = nao_lidas + 1 WHERE id = conv_id;
END;
$function$;
