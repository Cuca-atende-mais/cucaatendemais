-- S-PROG-13 (expand): checagem de permissão por categoria e salvar rascunho por categoria.
-- Só adiciona funções novas. Não altera políticas nem `programacao_salvar_rascunho`: o portal que
-- está no ar continua igual até o redeploy. As políticas por categoria entram na migration
-- `s_prog_13_contract_politicas_categoria`, depois do redeploy do portal.

-- Nome da categoria gravado na linha -> slug usado nos módulos `pgm_{slug}_atividades`.
-- `ESPORTE` (grafia antiga) conta como ESPORTES.
CREATE OR REPLACE FUNCTION public.pgm_slug_categoria(p_categoria text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
    SELECT CASE upper(btrim(coalesce(p_categoria, '')))
        WHEN 'ESPORTES' THEN 'esportes'
        WHEN 'ESPORTE' THEN 'esportes'
        WHEN 'CURSOS' THEN 'cursos'
        WHEN 'DIA A DIA' THEN 'dia_a_dia'
        WHEN 'ESPECIAIS' THEN 'especiais'
    END
$$;

-- Pode fazer `p_acao` (read/create/update/delete) nas atividades da categoria? As duas contas
-- Developer passam sempre, inclusive em categoria desconhecida.
CREATE OR REPLACE FUNCTION public.pgm_pode_categoria(p_categoria text, p_acao text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_slug text := public.pgm_slug_categoria(p_categoria);
BEGIN
    IF public.is_developer() THEN
        RETURN TRUE;
    END IF;
    IF v_slug IS NULL THEN
        RETURN FALSE;
    END IF;
    RETURN public.has_permission_exata('pgm_' || v_slug || '_atividades', p_acao);
END;
$$;

REVOKE ALL ON FUNCTION public.pgm_slug_categoria(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pgm_pode_categoria(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pgm_slug_categoria(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pgm_pode_categoria(text, text) TO authenticated, service_role;

-- Salvar rascunho mexendo só nas categorias que quem salva pode alterar.
-- A função roda como SECURITY DEFINER (as políticas não valem aqui dentro), então a proteção por
-- categoria é feita nela, categoria por categoria:
--   * sem "ver" na categoria: não pode vir nenhuma linha dela; as linhas do banco ficam intactas;
--   * com "ver": compara o que está no banco com o que veio da tela. Sem diferença, nada muda.
--     As linhas não têm id no payload, então a diferença é contada por conteúdo: cada linha que
--     sai pareada com uma que entra conta como edição (precisa "editar", ou "criar" + "excluir");
--     saídas a mais precisam "excluir"; entradas a mais precisam "criar".
-- Qualquer categoria sem permissão para a mudança recusa a gravação inteira (nada é gravado).
CREATE OR REPLACE FUNCTION public.programacao_salvar_rascunho_categorias(
    p_campanha_id uuid,
    p_titulo text,
    p_atividades jsonb
)
RETURNS TABLE(campanha_id uuid, total_atividades integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status text;
    v_mes int;
    v_ano int;
    v_placeholder date;
    v_total int;
    v_categoria text;
    v_nome text;
    v_saem int;
    v_entram int;
    v_pares int;
BEGIN
    IF jsonb_typeof(p_atividades) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Lista de atividades inválida' USING ERRCODE = '22023';
    END IF;

    IF NOT (
        public.is_developer()
        OR EXISTS (
            SELECT 1
            FROM unnest(ARRAY['ESPORTES', 'CURSOS', 'DIA A DIA', 'ESPECIAIS']) AS c(nome)
            WHERE public.pgm_pode_categoria(c.nome, 'create') OR public.pgm_pode_categoria(c.nome, 'update')
                OR public.pgm_pode_categoria(c.nome, 'delete')
        )
    ) THEN
        RAISE EXCEPTION 'Sem permissão para editar programação' USING ERRCODE = '42501';
    END IF;

    SELECT cm.status, cm.mes, cm.ano INTO v_status, v_mes, v_ano
    FROM public.campanhas_mensais cm
    WHERE cm.id = p_campanha_id
    FOR UPDATE;

    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Programação não encontrada' USING ERRCODE = 'P0002';
    END IF;

    IF v_status <> 'rascunho' THEN
        RAISE EXCEPTION 'Só é possível salvar uma programação em rascunho (status atual: %)', v_status
            USING ERRCODE = 'P0001';
    END IF;

    v_placeholder := make_date(v_ano, v_mes, 1);

    -- Linhas que vieram da tela, já no formato gravado (categoria conhecida vira o nome oficial).
    CREATE TEMP TABLE IF NOT EXISTS pg_temp.pgm_rascunho_novas (
        chave text, titulo text, categoria text, descricao text, local text, data_atividade date,
        hora_inicio time, hora_fim time, unidade_cuca text, metadata jsonb
    ) ON COMMIT DROP;
    TRUNCATE pg_temp.pgm_rascunho_novas;

    INSERT INTO pg_temp.pgm_rascunho_novas
    SELECT
        coalesce(public.pgm_slug_categoria(a->>'categoria'), 'outra:' || coalesce(a->>'categoria', '')),
        a->>'titulo',
        CASE public.pgm_slug_categoria(a->>'categoria')
            WHEN 'esportes' THEN 'ESPORTES'
            WHEN 'cursos' THEN 'CURSOS'
            WHEN 'dia_a_dia' THEN 'DIA A DIA'
            WHEN 'especiais' THEN 'ESPECIAIS'
            ELSE a->>'categoria'
        END,
        a->>'descricao',
        a->>'local',
        COALESCE(NULLIF(a->>'data_atividade', '')::date, v_placeholder),
        NULLIF(a->>'hora_inicio', '')::time,
        NULLIF(a->>'hora_fim', '')::time,
        a->>'unidade_cuca',
        COALESCE(a->'metadata', '{}'::jsonb)
    FROM jsonb_array_elements(p_atividades) AS a;

    FOR v_categoria IN
        SELECT n.chave FROM pg_temp.pgm_rascunho_novas n
        UNION
        SELECT coalesce(public.pgm_slug_categoria(am.categoria), 'outra:' || coalesce(am.categoria, ''))
        FROM public.atividades_mensais am
        WHERE am.campanha_id = p_campanha_id
    LOOP
        v_nome := CASE v_categoria
            WHEN 'esportes' THEN 'ESPORTES' WHEN 'cursos' THEN 'CURSOS'
            WHEN 'dia_a_dia' THEN 'DIA A DIA' WHEN 'especiais' THEN 'ESPECIAIS'
            ELSE substr(v_categoria, 7)
        END;

        -- Categoria que a pessoa não enxerga: fica como está, e não pode vir linha dela.
        IF NOT public.pgm_pode_categoria(v_nome, 'read') THEN
            IF EXISTS (SELECT 1 FROM pg_temp.pgm_rascunho_novas n WHERE n.chave = v_categoria) THEN
                RAISE EXCEPTION 'Sem permissão para gravar atividades da categoria %', v_nome
                    USING ERRCODE = '42501';
            END IF;
            CONTINUE;
        END IF;

        WITH existentes AS (
            SELECT am.titulo::text AS titulo,
                   CASE public.pgm_slug_categoria(am.categoria)
                       WHEN 'esportes' THEN 'ESPORTES' WHEN 'cursos' THEN 'CURSOS'
                       WHEN 'dia_a_dia' THEN 'DIA A DIA' WHEN 'especiais' THEN 'ESPECIAIS'
                       ELSE am.categoria::text
                   END AS categoria,
                   am.descricao, am.local::text AS local, am.data_atividade, am.hora_inicio, am.hora_fim,
                   am.unidade_cuca::text AS unidade_cuca, coalesce(am.metadata, '{}'::jsonb) AS metadata
            FROM public.atividades_mensais am
            WHERE am.campanha_id = p_campanha_id
              AND coalesce(public.pgm_slug_categoria(am.categoria), 'outra:' || coalesce(am.categoria, '')) = v_categoria
        ),
        novas AS (
            SELECT n.titulo, n.categoria, n.descricao, n.local, n.data_atividade, n.hora_inicio, n.hora_fim,
                   n.unidade_cuca, n.metadata
            FROM pg_temp.pgm_rascunho_novas n
            WHERE n.chave = v_categoria
        )
        SELECT
            (SELECT count(*) FROM (SELECT * FROM existentes EXCEPT ALL SELECT * FROM novas) s),
            (SELECT count(*) FROM (SELECT * FROM novas EXCEPT ALL SELECT * FROM existentes) e)
        INTO v_saem, v_entram;

        IF v_saem = 0 AND v_entram = 0 THEN
            CONTINUE;
        END IF;

        v_pares := least(v_saem, v_entram);
        IF (v_pares > 0 AND NOT (
                public.pgm_pode_categoria(v_nome, 'update')
                OR (public.pgm_pode_categoria(v_nome, 'create') AND public.pgm_pode_categoria(v_nome, 'delete'))
            ))
           OR (v_saem > v_pares AND NOT public.pgm_pode_categoria(v_nome, 'delete'))
           OR (v_entram > v_pares AND NOT public.pgm_pode_categoria(v_nome, 'create')) THEN
            RAISE EXCEPTION 'Sem permissão para alterar atividades da categoria %', v_nome
                USING ERRCODE = '42501';
        END IF;

        DELETE FROM public.atividades_mensais am
        WHERE am.campanha_id = p_campanha_id
          AND coalesce(public.pgm_slug_categoria(am.categoria), 'outra:' || coalesce(am.categoria, '')) = v_categoria;

        INSERT INTO public.atividades_mensais (
            campanha_id, titulo, categoria, descricao, local, data_atividade,
            hora_inicio, hora_fim, unidade_cuca, metadata
        )
        SELECT p_campanha_id, n.titulo, n.categoria, n.descricao, n.local, n.data_atividade,
               n.hora_inicio, n.hora_fim, n.unidade_cuca, n.metadata
        FROM pg_temp.pgm_rascunho_novas n
        WHERE n.chave = v_categoria;
    END LOOP;

    SELECT count(*) INTO v_total FROM public.atividades_mensais am WHERE am.campanha_id = p_campanha_id;

    UPDATE public.campanhas_mensais
    SET titulo = p_titulo, total_atividades = v_total, updated_at = now()
    WHERE id = p_campanha_id;

    RETURN QUERY SELECT p_campanha_id, v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.programacao_salvar_rascunho_categorias(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.programacao_salvar_rascunho_categorias(uuid, text, jsonb) TO authenticated, service_role;
