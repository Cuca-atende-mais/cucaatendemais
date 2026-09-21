-- Programação mensal: data sem preenchimento automático (decisão do Junior, 2026-09-21).
--
-- 1. `atividades_mensais.data_atividade` passa a aceitar vazio. Nenhum caminho inventa data:
--    ESPORTES nunca tem data; DIA A DIA / ESPECIAIS / CURSOS sem data são barrados no
--    "Enviar para autorização" (checagem em `aprovacao.ts`), nunca preenchidos com o dia 1 do mês.
-- 2. As funções de salvar rascunho deixam de gravar o dia 1 do mês no lugar da data vazia.
-- 3. ESPORTES: as datas gravadas até aqui não significam nada (dia 1 provisório ou data vinda da
--    planilha). Vão para vazio; o valor antigo fica guardado numa tabela de backup.
--
-- Idempotente e retrocompatível: só amplia o que a coluna aceita, as funções mantêm a assinatura.
-- O passo 3 pode ser rodado de novo depois do redeploy do portal (pega linhas gravadas no meio).

-- 1 ────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.atividades_mensais ALTER COLUMN data_atividade DROP NOT NULL;

-- 2 ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.programacao_salvar_rascunho(p_campanha_id uuid, p_titulo text, p_atividades jsonb)
 RETURNS TABLE(campanha_id uuid, total_atividades integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_status text;
    v_total int;
BEGIN
    -- Achado crítico do @qa (2026-09-10): checagem de permissão AQUI, não só na rota — é a
    -- única barreira que sobrevive a uma chamada direta via REST, contornando o Next.js.
    IF NOT public.has_permission('programacao', 'update') THEN
        RAISE EXCEPTION 'Sem permissão para editar programação' USING ERRCODE = '42501';
    END IF;

    SELECT status INTO v_status
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
        NULLIF(a->>'data_atividade', '')::date,
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

CREATE OR REPLACE FUNCTION public.programacao_salvar_rascunho_categorias(p_campanha_id uuid, p_titulo text, p_atividades jsonb, p_categorias text[])
 RETURNS TABLE(campanha_id uuid, total_atividades integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_status text;
    v_total int;
    v_categoria text;
    v_nome text;
    v_saem int;
    v_entram int;
    v_pares int;
BEGIN
    IF jsonb_typeof(p_atividades) IS DISTINCT FROM 'array' OR p_categorias IS NULL THEN
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

    SELECT cm.status INTO v_status
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

    -- Linhas que vieram da tela, já no formato gravado (categoria conhecida vira o nome oficial).
    -- Sempre recriada: uma tabela com o mesmo nome deixada na sessão nunca é reaproveitada.
    DROP TABLE IF EXISTS pg_temp.pgm_rascunho_novas;
    CREATE TEMP TABLE pg_temp.pgm_rascunho_novas (
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
        -- Sem data automática: vazio fica vazio (ESPORTES nunca tem data; as demais são barradas no envio).
        NULLIF(a->>'data_atividade', '')::date,
        NULLIF(a->>'hora_inicio', '')::time,
        NULLIF(a->>'hora_fim', '')::time,
        a->>'unidade_cuca',
        COALESCE(a->'metadata', '{}'::jsonb)
    FROM jsonb_array_elements(p_atividades) AS a;

    -- Linha de categoria que a tela não declarou como editada: recusa tudo.
    SELECT n.categoria INTO v_nome
    FROM pg_temp.pgm_rascunho_novas n
    WHERE n.chave NOT IN (
        SELECT coalesce(public.pgm_slug_categoria(c), 'outra:' || coalesce(c, '')) FROM unnest(p_categorias) AS c
    )
    LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION 'Sem permissão para gravar atividades da categoria %', coalesce(v_nome, '(sem categoria)')
            USING ERRCODE = '42501';
    END IF;

    FOR v_categoria IN
        SELECT DISTINCT coalesce(public.pgm_slug_categoria(c), 'outra:' || coalesce(c, '')) FROM unnest(p_categorias) AS c
    LOOP
        v_nome := CASE v_categoria
            WHEN 'esportes' THEN 'ESPORTES' WHEN 'cursos' THEN 'CURSOS'
            WHEN 'dia_a_dia' THEN 'DIA A DIA' WHEN 'especiais' THEN 'ESPECIAIS'
            ELSE substr(v_categoria, 7)
        END;

        IF NOT public.pgm_pode_categoria(v_nome, 'read') THEN
            RAISE EXCEPTION 'Sem permissão para gravar atividades da categoria %', v_nome
                USING ERRCODE = '42501';
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

        -- S-PROG-14: categoria enviada ou autorizada não pode ser alterada; é preciso devolver ou reabrir.
        IF NOT public.pgm_categoria_em_rascunho(p_campanha_id, v_nome) THEN
            RAISE EXCEPTION 'A categoria % não está em rascunho: devolva ou reabra antes de editar', v_nome
                USING ERRCODE = '42501';
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
$function$;

-- 3 ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.backup_pgm_esportes_data_atividade_20260921 (
    atividade_id uuid PRIMARY KEY,
    data_atividade date,
    salvo_em timestamptz NOT NULL DEFAULT now()
);
-- Só a chave de serviço lê (sem política = nenhum acesso pela API pública).
ALTER TABLE public.backup_pgm_esportes_data_atividade_20260921 ENABLE ROW LEVEL SECURITY;

INSERT INTO public.backup_pgm_esportes_data_atividade_20260921 (atividade_id, data_atividade)
SELECT a.id, a.data_atividade
FROM public.atividades_mensais a
WHERE public.pgm_slug_categoria(a.categoria) = 'esportes' AND a.data_atividade IS NOT NULL
ON CONFLICT (atividade_id) DO NOTHING;

UPDATE public.atividades_mensais
SET data_atividade = NULL
WHERE public.pgm_slug_categoria(categoria) = 'esportes' AND data_atividade IS NOT NULL;
