-- SQS-51: salvamento atomico do editor de curriculo.
--
-- O editor interno salvava direto do browser em curriculos e depois tentava
-- atualizar talent_bank. Isso deixava duas operacoes separadas sujeitas a RLS,
-- sessao expirada e sucesso parcial. Esta RPC valida o colaborador uma vez e
-- persiste curriculos + espelho em talent_bank em uma transacao.

CREATE OR REPLACE FUNCTION public.salvar_curriculo_estruturado(
    p_talent_id uuid,
    p_curriculo_id uuid DEFAULT NULL,
    p_dados jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_curriculo_id uuid;
    v_nome text;
    v_telefone text;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM public.colaboradores
        WHERE user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Usuario nao autorizado: apenas colaboradores podem salvar curriculos.'
            USING ERRCODE = '42501';
    END IF;

    IF p_talent_id IS NULL THEN
        RAISE EXCEPTION 'Candidato e obrigatorio.' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.talent_bank
        WHERE id = p_talent_id
    ) THEN
        RAISE EXCEPTION 'Candidato nao encontrado.' USING ERRCODE = 'P0002';
    END IF;

    IF p_dados IS NULL THEN
        p_dados := '{}'::jsonb;
    END IF;

    IF p_curriculo_id IS NOT NULL THEN
        UPDATE public.curriculos
        SET dados = p_dados,
            updated_at = now()
        WHERE id = p_curriculo_id
          AND talent_id = p_talent_id
          AND deleted_at IS NULL
        RETURNING id INTO v_curriculo_id;
    END IF;

    IF v_curriculo_id IS NULL THEN
        SELECT id
        INTO v_curriculo_id
        FROM public.curriculos
        WHERE talent_id = p_talent_id
          AND deleted_at IS NULL
        ORDER BY updated_at DESC
        LIMIT 1;

        IF v_curriculo_id IS NOT NULL THEN
            UPDATE public.curriculos
            SET dados = p_dados,
                updated_at = now()
            WHERE id = v_curriculo_id;
        ELSE
            INSERT INTO public.curriculos (talent_id, dados)
            VALUES (p_talent_id, p_dados)
            RETURNING id INTO v_curriculo_id;
        END IF;
    END IF;

    v_nome := NULLIF(btrim(COALESCE(p_dados->>'nome', '')), '');
    v_telefone := NULLIF(btrim(COALESCE(p_dados->>'telefone', '')), '');

    UPDATE public.talent_bank
    SET nome = COALESCE(v_nome, nome),
        telefone = COALESCE(v_telefone, telefone),
        curriculo_estruturado = p_dados,
        updated_at = now()
    WHERE id = p_talent_id;

    RETURN v_curriculo_id;
END;
$$;

REVOKE ALL ON FUNCTION public.salvar_curriculo_estruturado(uuid, uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.salvar_curriculo_estruturado(uuid, uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.salvar_curriculo_estruturado(uuid, uuid, jsonb) IS
'SQS-51: salva curriculo estruturado e sincroniza talent_bank em transacao para colaboradores autenticados.';
