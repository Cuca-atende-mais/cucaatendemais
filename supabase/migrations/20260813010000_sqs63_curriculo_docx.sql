-- SQS-63: download do currículo público também em DOCX (além do PDF já
-- existente). Reaproveita a mesma tabela de tokens de uso único da SQS-58,
-- diferenciando por `tipo` qual arquivo cada token autoriza baixar.

ALTER TABLE public.empregabilidade_curriculo_download_tokens
    ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'pdf';

ALTER TABLE public.talent_bank
    ADD COLUMN IF NOT EXISTS arquivo_docx_url text;

COMMENT ON COLUMN public.talent_bank.arquivo_docx_url IS
'SQS-63: URL do .docx gerado a partir do currículo público estruturado (mesmo dado do PDF em arquivo_cv_url), formato editável.';

-- Precisa recriar a função (não é possível ALTER no tipo de retorno com
-- CREATE OR REPLACE) pra também devolver `tipo`, permitindo à rota de
-- download saber qual arquivo (PDF ou DOCX) aquele token específico
-- autoriza — cada token continua de uso único e vale só para um dos dois.
DROP FUNCTION IF EXISTS public.consumir_curriculo_download_token(text);

CREATE FUNCTION public.consumir_curriculo_download_token(
    p_token_hash text
)
RETURNS TABLE(talent_id uuid, tipo text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    UPDATE public.empregabilidade_curriculo_download_tokens t
    SET used_at = now()
    WHERE t.token_hash = p_token_hash
      AND t.used_at IS NULL
      AND t.expires_at > now()
    RETURNING t.talent_id, t.tipo;
END;
$$;

REVOKE ALL ON FUNCTION public.consumir_curriculo_download_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.consumir_curriculo_download_token(text) TO service_role;
