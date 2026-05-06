-- SQS-51 (A1, A5): RPC SECURITY DEFINER para criar candidato + currículo atomicamente.
--
-- Motivação: a tela /empregabilidade/criar-curriculo (dashboard interno) faz dois
-- INSERTs sequenciais (talent_bank e curriculos) direto do browser via cliente
-- anon. A policy de talent_bank exige `EXISTS (SELECT 1 FROM colaboradores
-- WHERE user_id = auth.uid())`. Sempre que o JWT do browser é inválido (sessão
-- expirada, NEXT_PUBLIC_* vazios no build, middleware deixou anônimo passar) o
-- INSERT é rejeitado com "new row violates row-level security policy" e o
-- registro órfão pode ficar em talent_bank sem currículo correspondente.
--
-- Esta função:
--   1. Valida explicitamente que auth.uid() pertence a um colaborador (mesma
--      checagem da policy — sem afrouxar segurança).
--   2. Faz INSERTs em transação única; se um falhar, ambos rollback.
--   3. Retorna o talent_id para o front redirecionar ao editor.
--
-- O front passa a chamar `supabase.rpc('criar_candidato_curriculo', ...)` em
-- vez de dois `from(...).insert(...)`.

CREATE OR REPLACE FUNCTION public.criar_candidato_curriculo(
    p_nome           text,
    p_telefone       text,
    p_data_nascimento date DEFAULT NULL,
    p_area           text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_talent_id uuid;
BEGIN
    -- Mesma checagem da policy de talent_bank — não relaxa segurança.
    IF NOT EXISTS (
        SELECT 1 FROM public.colaboradores
        WHERE user_id = auth.uid()
    ) THEN
        RAISE EXCEPTION 'Usuário não autorizado: apenas colaboradores podem criar candidatos.'
            USING ERRCODE = '42501';
    END IF;

    -- Validações mínimas de input
    IF p_nome IS NULL OR length(btrim(p_nome)) = 0 THEN
        RAISE EXCEPTION 'Nome é obrigatório.' USING ERRCODE = '22023';
    END IF;
    IF p_telefone IS NULL OR length(btrim(p_telefone)) = 0 THEN
        RAISE EXCEPTION 'Telefone é obrigatório.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.talent_bank (
        nome, telefone, data_nascimento, area_interesse, status
    )
    VALUES (
        btrim(p_nome),
        btrim(p_telefone),
        p_data_nascimento,
        CASE
            WHEN p_area IS NULL OR length(btrim(p_area)) = 0 THEN NULL
            ELSE ARRAY[btrim(p_area)]
        END,
        'disponivel'
    )
    RETURNING id INTO v_talent_id;

    INSERT INTO public.curriculos (talent_id, dados)
    VALUES (
        v_talent_id,
        jsonb_build_object(
            'nome', btrim(p_nome),
            'telefone', btrim(p_telefone)
        )
    );

    RETURN v_talent_id;
END;
$$;

REVOKE ALL ON FUNCTION public.criar_candidato_curriculo(text, text, date, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.criar_candidato_curriculo(text, text, date, text) TO authenticated;

COMMENT ON FUNCTION public.criar_candidato_curriculo(text, text, date, text) IS
'SQS-51: cria talent_bank + currículo atomicamente; valida auth.uid() em colaboradores.';
