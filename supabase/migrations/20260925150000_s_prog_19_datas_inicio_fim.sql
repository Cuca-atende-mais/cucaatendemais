-- S-PROG-19 (expand): data início e data fim em colunas para CURSOS, DIA A DIA e ESPECIAIS.
-- Aditivo e idempotente: nada é removido nem renomeado. `data_atividade` continua existindo e sendo
-- gravada = data início (ordenação, RAG e leitores antigos). A cobrança dos 4 campos no envio para
-- autorização (outubro/2026 em diante) fica numa 2ª migration, aplicada só depois do redeploy do
-- portal (`supabase/pendentes/s_prog_19_obrigatoriedade_envio.sql`).

-- 1. Colunas
ALTER TABLE public.atividades_mensais ADD COLUMN IF NOT EXISTS data_inicio date;
ALTER TABLE public.atividades_mensais ADD COLUMN IF NOT EXISTS data_fim date;

-- 2. Regra única de "datas a partir do que já está gravado" — usada no preenchimento abaixo e na
--    função de salvar rascunho quando a tela antiga não manda as chaves novas. Mesma regra nos dois
--    lugares = a comparação por conteúdo do rascunho não enxerga diferença falsa.
--    CURSOS: início = 1ª data de `periodo` (senão `data_atividade`); fim = 2ª data (senão o início;
--    2ª data antes do início = fim vazio, nunca inventado). DIA A DIA/ESPECIAIS: início = fim =
--    `data_atividade`. ESPORTES e outras: vazio. Data impossível no texto (31/02) é ignorada.
CREATE OR REPLACE FUNCTION public.pgm_datas_padrao(p_categoria text, p_data_atividade date, p_periodo text)
RETURNS TABLE(data_inicio date, data_fim date)
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
    v_slug text := public.pgm_slug_categoria(p_categoria);
    v_datas date[] := ARRAY[]::date[];
    v_txt text;
    v_d date;
BEGIN
    IF v_slug = 'cursos' THEN
        FOR v_txt IN SELECT m[1] FROM regexp_matches(coalesce(p_periodo, ''), '(\d{2}/\d{2}/\d{4})', 'g') AS m LOOP
            BEGIN
                v_d := to_date(v_txt, 'DD/MM/YYYY');
                IF to_char(v_d, 'DD/MM/YYYY') = v_txt THEN
                    v_datas := v_datas || v_d;
                END IF;
            EXCEPTION WHEN others THEN
                NULL;
            END;
            EXIT WHEN cardinality(v_datas) >= 2;
        END LOOP;
        data_inicio := coalesce(v_datas[1], p_data_atividade);
        data_fim := CASE
            WHEN data_inicio IS NULL THEN NULL
            WHEN cardinality(v_datas) >= 2 THEN CASE WHEN v_datas[2] >= data_inicio THEN v_datas[2] END
            ELSE data_inicio
        END;
    ELSIF v_slug IN ('dia_a_dia', 'especiais') THEN
        data_inicio := p_data_atividade;
        data_fim := p_data_atividade;
    END IF;
    RETURN NEXT;
END;
$$;

-- Só usada por dentro das funções do servidor (SECURITY DEFINER); ninguém chama direto.
REVOKE ALL ON FUNCTION public.pgm_datas_padrao(text, date, text) FROM PUBLIC, anon, authenticated;

-- 3. Backup do que o preenchimento toca (setembro e outubro/2026, as 3 categorias)
CREATE TABLE IF NOT EXISTS public.backup_pgm_datas_inicio_fim_20260925 AS
SELECT a.id, a.data_atividade, a.hora_inicio, a.hora_fim, a.metadata->>'periodo' AS periodo, now() AS copiado_em
FROM public.atividades_mensais a
JOIN public.campanhas_mensais c ON c.id = a.campanha_id
WHERE c.ano = 2026 AND c.mes IN (9, 10)
  AND public.pgm_slug_categoria(a.categoria) IN ('cursos', 'dia_a_dia', 'especiais');

ALTER TABLE public.backup_pgm_datas_inicio_fim_20260925 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.backup_pgm_datas_inicio_fim_20260925 FROM anon, authenticated;

-- 4. Preenchimento (decisão do Junior, 2026-09-25): só setembro e outubro/2026; até agosto fica vazio.
--    Só linhas ainda sem data início (idempotente). Hora fim vazia com hora início = hora início;
--    sem nenhuma hora, fica vazio (não se inventa horário).
WITH calc AS (
    SELECT a.id, d.data_inicio, d.data_fim
    FROM public.atividades_mensais a
    JOIN public.campanhas_mensais c ON c.id = a.campanha_id
    CROSS JOIN LATERAL public.pgm_datas_padrao(a.categoria, a.data_atividade, a.metadata->>'periodo') d
    WHERE c.ano = 2026 AND c.mes IN (9, 10)
      AND public.pgm_slug_categoria(a.categoria) IN ('cursos', 'dia_a_dia', 'especiais')
      AND a.data_inicio IS NULL
)
UPDATE public.atividades_mensais a
SET data_inicio = calc.data_inicio,
    data_fim = calc.data_fim,
    hora_fim = CASE WHEN a.hora_fim IS NULL AND a.hora_inicio IS NOT NULL THEN a.hora_inicio ELSE a.hora_fim END
FROM calc
WHERE a.id = calc.id;

-- 5. Data fim nunca antes do início (vale sempre; só compara quando as duas existem).
ALTER TABLE public.atividades_mensais DROP CONSTRAINT IF EXISTS atividades_mensais_data_fim_apos_inicio;
ALTER TABLE public.atividades_mensais ADD CONSTRAINT atividades_mensais_data_fim_apos_inicio
    CHECK (data_fim IS NULL OR data_inicio IS NULL OR data_fim >= data_inicio) NOT VALID;
ALTER TABLE public.atividades_mensais VALIDATE CONSTRAINT atividades_mensais_data_fim_apos_inicio;

-- 6. Salvar rascunho por categoria grava as duas colunas e as inclui na comparação por conteúdo
--    (mudar só a data fim conta como edição). Resto idêntico à versão vigente.
CREATE OR REPLACE FUNCTION public.programacao_salvar_rascunho_categorias(p_campanha_id uuid, p_titulo text, p_atividades jsonb, p_categorias text[])
 RETURNS TABLE(campanha_id uuid, total_atividades integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $$
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
        hora_inicio time, hora_fim time, unidade_cuca text, metadata jsonb, data_inicio date, data_fim date
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
        COALESCE(a->'metadata', '{}'::jsonb),
        -- S-PROG-19: tela nova manda as chaves (vazio fica vazio: o rascunho salva incompleto e o
        -- envio cobra). Tela antiga (sem as chaves, até o redeploy do portal): mesma regra do
        -- preenchimento dos dados, para a comparação abaixo não ver diferença falsa e não apagar datas.
        CASE WHEN a ? 'data_inicio' THEN NULLIF(a->>'data_inicio', '')::date ELSE pd.data_inicio END,
        CASE WHEN a ? 'data_fim' THEN NULLIF(a->>'data_fim', '')::date ELSE pd.data_fim END
    FROM jsonb_array_elements(p_atividades) AS a
    CROSS JOIN LATERAL public.pgm_datas_padrao(a->>'categoria', NULLIF(a->>'data_atividade', '')::date, a->'metadata'->>'periodo') AS pd;

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
                   am.unidade_cuca::text AS unidade_cuca, coalesce(am.metadata, '{}'::jsonb) AS metadata,
                   am.data_inicio, am.data_fim
            FROM public.atividades_mensais am
            WHERE am.campanha_id = p_campanha_id
              AND coalesce(public.pgm_slug_categoria(am.categoria), 'outra:' || coalesce(am.categoria, '')) = v_categoria
        ),
        novas AS (
            SELECT n.titulo, n.categoria, n.descricao, n.local, n.data_atividade, n.hora_inicio, n.hora_fim,
                   n.unidade_cuca, n.metadata, n.data_inicio, n.data_fim
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
            hora_inicio, hora_fim, unidade_cuca, metadata, data_inicio, data_fim
        )
        SELECT p_campanha_id, n.titulo, n.categoria, n.descricao, n.local, n.data_atividade,
               n.hora_inicio, n.hora_fim, n.unidade_cuca, n.metadata, n.data_inicio, n.data_fim
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
