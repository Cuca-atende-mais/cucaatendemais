-- SQS-58: controle do formulario publico de curriculo estruturado.
-- Mantem rate limit por telefone e download de PDF com token de uso unico.

CREATE TABLE IF NOT EXISTS public.empregabilidade_curriculo_rate_limits (
    phone_hash text NOT NULL,
    bucket_start timestamptz NOT NULL,
    attempts integer NOT NULL DEFAULT 0,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (phone_hash, bucket_start)
);

CREATE TABLE IF NOT EXISTS public.empregabilidade_curriculo_download_tokens (
    token_hash text PRIMARY KEY,
    talent_id uuid NOT NULL REFERENCES public.talent_bank(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.empregabilidade_curriculo_rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.empregabilidade_curriculo_download_tokens ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.registrar_limite_curriculo_publico(
    p_phone_hash text,
    p_limit integer DEFAULT 5
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_bucket timestamptz := date_trunc('hour', now());
    v_attempts integer;
BEGIN
    IF p_phone_hash IS NULL OR btrim(p_phone_hash) = '' THEN
        RETURN false;
    END IF;

    INSERT INTO public.empregabilidade_curriculo_rate_limits (phone_hash, bucket_start, attempts)
    VALUES (p_phone_hash, v_bucket, 1)
    ON CONFLICT (phone_hash, bucket_start)
    DO UPDATE SET
        attempts = public.empregabilidade_curriculo_rate_limits.attempts + 1,
        updated_at = now()
    RETURNING attempts INTO v_attempts;

    RETURN v_attempts <= GREATEST(p_limit, 1);
END;
$$;

CREATE OR REPLACE FUNCTION public.consumir_curriculo_download_token(
    p_token_hash text
)
RETURNS TABLE(talent_id uuid)
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
    RETURNING t.talent_id;
END;
$$;

REVOKE ALL ON TABLE public.empregabilidade_curriculo_rate_limits FROM PUBLIC;
REVOKE ALL ON TABLE public.empregabilidade_curriculo_download_tokens FROM PUBLIC;
REVOKE ALL ON FUNCTION public.registrar_limite_curriculo_publico(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consumir_curriculo_download_token(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.registrar_limite_curriculo_publico(text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.consumir_curriculo_download_token(text) TO service_role;

COMMENT ON TABLE public.empregabilidade_curriculo_download_tokens IS
'SQS-58: tokens de download de PDF do curriculo publico, uso unico e TTL curto.';

-- Fecha a brecha historica que deixava `curriculos` exposto para anon.
-- A pagina publica da SQS-58 escreve via rota service-role validada por link;
-- o dashboard permanece via usuario autenticado com permissao de curriculos.
DROP POLICY IF EXISTS curriculos_all ON public.curriculos;

CREATE POLICY "curriculos_select_colaboradores"
ON public.curriculos
FOR SELECT
TO authenticated
USING (public.has_permission('empreg_curriculos'::character varying, 'read'::character varying));

CREATE POLICY "curriculos_insert_colaboradores"
ON public.curriculos
FOR INSERT
TO authenticated
WITH CHECK (public.has_permission('empreg_curriculos'::character varying, 'create'::character varying));

CREATE POLICY "curriculos_update_colaboradores"
ON public.curriculos
FOR UPDATE
TO authenticated
USING (public.has_permission('empreg_curriculos'::character varying, 'update'::character varying))
WITH CHECK (public.has_permission('empreg_curriculos'::character varying, 'update'::character varying));

CREATE POLICY "curriculos_delete_colaboradores"
ON public.curriculos
FOR DELETE
TO authenticated
USING (public.has_permission('empreg_curriculos'::character varying, 'delete'::character varying));
