-- S-PROG-09 — Correção de achado CRÍTICO do @qa (2026-09-10): `programacao_salvar_rascunho` é
-- `SECURITY DEFINER` (contorna RLS) e tinha `GRANT EXECUTE` para `authenticated` sem nenhuma
-- checagem de permissão dentro da função — a única barreira era o `has_permission` da rota
-- Next.js (`app/api/programacao/rascunho/route.ts`). Isso é chamável direto via
-- `/rest/v1/rpc/programacao_salvar_rascunho` com o JWT de qualquer colaborador autenticado,
-- sem passar pela rota, apagando e recriando atividades de qualquer campanha em rascunho —
-- diferente de todo outro caminho de escrita do módulo, onde a RLS (`has_permission('programacao',
-- <ação>)` em `atividades_mensais`/`campanhas_mensais`) é a barreira real.
--
-- `has_permission()` é seguro de chamar de dentro de uma função SECURITY DEFINER: ela lê
-- `auth.uid()`, que reflete o JWT de quem chamou a função, não o dono dela (confirmado lendo a
-- definição de `has_permission` em produção) — mesmo padrão que toda RLS do projeto já usa.
CREATE OR REPLACE FUNCTION public.programacao_salvar_rascunho(
    p_campanha_id uuid,
    p_titulo text,
    p_atividades jsonb
)
RETURNS TABLE(campanha_id uuid, total_atividades int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
    v_status text;
    v_mes int;
    v_ano int;
    v_placeholder date;
    v_total int;
BEGIN
    -- Achado crítico do @qa (2026-09-10): checagem de permissão AQUI, não só na rota — é a
    -- única barreira que sobrevive a uma chamada direta via REST, contornando o Next.js.
    IF NOT public.has_permission('programacao', 'update') THEN
        RAISE EXCEPTION 'Sem permissão para editar programação' USING ERRCODE = '42501';
    END IF;

    SELECT status, mes, ano INTO v_status, v_mes, v_ano
    FROM public.campanhas_mensais
    WHERE id = p_campanha_id
    FOR UPDATE;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Programação não encontrada' USING ERRCODE = 'P0002';
    END IF;

    IF v_status <> 'rascunho' THEN
        RAISE EXCEPTION 'Só é possível salvar uma programação em rascunho (status atual: %)', v_status
            USING ERRCODE = 'P0001';
    END IF;

    v_placeholder := make_date(v_ano, v_mes, 1);

    DELETE FROM public.atividades_mensais WHERE atividades_mensais.campanha_id = p_campanha_id;

    INSERT INTO public.atividades_mensais (
        campanha_id, titulo, categoria, descricao, local, data_atividade,
        hora_inicio, hora_fim, unidade_cuca, metadata
    )
    SELECT
        p_campanha_id,
        a->>'titulo',
        a->>'categoria',
        a->>'descricao',
        a->>'local',
        COALESCE(NULLIF(a->>'data_atividade', '')::date, v_placeholder),
        NULLIF(a->>'hora_inicio', '')::time,
        NULLIF(a->>'hora_fim', '')::time,
        a->>'unidade_cuca',
        COALESCE(a->'metadata', '{}'::jsonb)
    FROM jsonb_array_elements(p_atividades) AS a;

    SELECT count(*) INTO v_total FROM public.atividades_mensais WHERE atividades_mensais.campanha_id = p_campanha_id;

    UPDATE public.campanhas_mensais
    SET titulo = p_titulo, total_atividades = v_total, updated_at = now()
    WHERE id = p_campanha_id;

    RETURN QUERY SELECT p_campanha_id, v_total;
END;
$function$;

-- GRANT inalterado — a permissão de chamar continua com `authenticated` (a rota usa o client do
-- usuário logado, não service_role), mas agora a função em si recusa quem não tem
-- has_permission('programacao','update'), independente de como foi chamada.
REVOKE ALL ON FUNCTION public.programacao_salvar_rascunho(uuid, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.programacao_salvar_rascunho(uuid, text, jsonb) TO authenticated, service_role;
