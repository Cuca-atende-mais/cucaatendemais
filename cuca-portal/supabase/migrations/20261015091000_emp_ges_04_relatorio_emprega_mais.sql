-- S-EMP-GES-04 (AC4, AC9, AC11, AC12): agregação do relatório Emprega+ no banco.
-- Só leitura. Chamada só pela rota do portal com o cliente de serviço, depois de a rota calcular o escopo
-- de unidade pela permissão (AC13) — por isso o EXECUTE é revogado de public/anon/authenticated: um
-- usuário logado não consegue chamar direto e ver todas as unidades.
-- Meses no fuso de Fortaleza. Idempotente (CREATE OR REPLACE).

-- Unidade atribuída a cada vaga/seleção (AC11/AC12), com a origem da atribuição:
--   1. 'colaborador': unidade do colaborador que liberou (vagas.liberada_por → colaboradores.unidade_cuca);
--   2. 'destino':     vagas.unidade_destino quando é o UUID de uma unidade;
--   3. 'base':        vagas.unidade_cuca (nome ou UUID);
--   4. 'rede':        nenhuma das anteriores — "Rede Cuca (todas as unidades)".
-- Nomes comparados sem diferenciar maiúsculas ("Cuca Pici" = "CUCA Pici"); "Geral" não é unidade.
CREATE OR REPLACE FUNCTION public.emp_relatorio_unidade_vagas()
RETURNS TABLE (vaga_id uuid, unidade text, origem text)
LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT v.id,
        COALESCE(uc.id::text, ud.id::text, ub.id::text, 'rede'),
        CASE WHEN uc.id IS NOT NULL THEN 'colaborador'
             WHEN ud.id IS NOT NULL THEN 'destino'
             WHEN ub.id IS NOT NULL THEN 'base'
             ELSE 'rede' END
    FROM vagas v
    LEFT JOIN colaboradores c ON c.id = v.liberada_por
    LEFT JOIN unidades_cuca uc ON lower(uc.nome) = lower(trim(c.unidade_cuca)) OR uc.id::text = trim(c.unidade_cuca)
    LEFT JOIN unidades_cuca ud ON ud.id::text = trim(v.unidade_destino)
    LEFT JOIN unidades_cuca ub ON lower(ub.nome) = lower(trim(v.unidade_cuca)) OR ub.id::text = trim(v.unidade_cuca)
$$;

-- Indicadores mês a mês. p_inicio/p_fim: primeiro dia do mês inicial e do mês final (inclusive).
-- unidade: UUID da unidade, 'rede' (vaga sem unidade atribuível) ou 'sem_unidade' (currículos e
-- empresas, que não têm unidade e só entram no consolidado).
CREATE OR REPLACE FUNCTION public.relatorio_emprega_mais(p_inicio date, p_fim date)
RETURNS TABLE (mes text, unidade text, indicador text, valor bigint)
LANGUAGE sql STABLE
SET search_path = public
AS $$
    WITH limites AS (
        SELECT date_trunc('month', p_inicio)::timestamp AS ini,
               (date_trunc('month', p_fim) + interval '1 month')::timestamp AS fim
    ),
    vu AS (SELECT * FROM emp_relatorio_unidade_vagas()),
    vagas_periodo AS (
        SELECT to_char(v.created_at AT TIME ZONE 'America/Fortaleza', 'YYYY-MM') AS mes, vu.unidade, v.tipo, v.total_vagas
        FROM vagas v JOIN vu ON vu.vaga_id = v.id, limites l
        WHERE v.created_at AT TIME ZONE 'America/Fortaleza' >= l.ini AND v.created_at AT TIME ZONE 'America/Fortaleza' < l.fim
    )
    SELECT mes, unidade, 'vagas_normais', count(*) FROM vagas_periodo WHERE tipo IS DISTINCT FROM 'selecao_evento' GROUP BY 1, 2
    UNION ALL
    SELECT mes, unidade, 'selecoes', count(*) FROM vagas_periodo WHERE tipo = 'selecao_evento' GROUP BY 1, 2
    UNION ALL
    SELECT mes, unidade, 'postos', COALESCE(sum(total_vagas), 0) FROM vagas_periodo GROUP BY 1, 2
    UNION ALL
    SELECT to_char(c.email_enviado_em AT TIME ZONE 'America/Fortaleza', 'YYYY-MM'), COALESCE(vu.unidade, 'rede'), 'encaminhamentos', count(*)
    FROM candidaturas c LEFT JOIN vu ON vu.vaga_id = c.vaga_id, limites l
    WHERE c.email_enviado_em AT TIME ZONE 'America/Fortaleza' >= l.ini AND c.email_enviado_em AT TIME ZONE 'America/Fortaleza' < l.fim
    GROUP BY 1, 2
    UNION ALL
    SELECT to_char(cv.created_at AT TIME ZONE 'America/Fortaleza', 'YYYY-MM'), 'sem_unidade', 'curriculos', count(*)
    FROM curriculos cv, limites l
    WHERE cv.deleted_at IS NULL
      AND cv.created_at AT TIME ZONE 'America/Fortaleza' >= l.ini AND cv.created_at AT TIME ZONE 'America/Fortaleza' < l.fim
    GROUP BY 1
    UNION ALL
    SELECT to_char(e.created_at AT TIME ZONE 'America/Fortaleza', 'YYYY-MM'), 'sem_unidade', 'empresas', count(*)
    FROM empresas e, limites l
    WHERE e.created_at AT TIME ZONE 'America/Fortaleza' >= l.ini AND e.created_at AT TIME ZONE 'America/Fortaleza' < l.fim
    GROUP BY 1
$$;

-- Aba Detalhe (AC5, AC12): vagas e seleções cadastradas no período, com a unidade atribuída, a origem
-- da atribuição e os candidatos encaminhados no período.
CREATE OR REPLACE FUNCTION public.relatorio_emprega_mais_detalhe(p_inicio date, p_fim date)
RETURNS TABLE (vaga_id uuid, numero_vaga integer, titulo text, empresa text, tipo text, unidade text, origem text,
               postos integer, encaminhados bigint, criada_em timestamptz)
LANGUAGE sql STABLE
SET search_path = public
AS $$
    WITH limites AS (
        SELECT date_trunc('month', p_inicio)::timestamp AS ini,
               (date_trunc('month', p_fim) + interval '1 month')::timestamp AS fim
    )
    SELECT v.id, v.numero_vaga, v.titulo::text, COALESCE(NULLIF(e.nome_fantasia, ''), e.nome)::text, v.tipo::text,
           vu.unidade, vu.origem, v.total_vagas,
           (SELECT count(*) FROM candidaturas c
             WHERE c.vaga_id = v.id
               AND c.email_enviado_em AT TIME ZONE 'America/Fortaleza' >= l.ini
               AND c.email_enviado_em AT TIME ZONE 'America/Fortaleza' < l.fim),
           v.created_at
    FROM vagas v
    JOIN emp_relatorio_unidade_vagas() vu ON vu.vaga_id = v.id
    LEFT JOIN empresas e ON e.id = v.empresa_id
    CROSS JOIN limites l
    WHERE v.created_at AT TIME ZONE 'America/Fortaleza' >= l.ini AND v.created_at AT TIME ZONE 'America/Fortaleza' < l.fim
    ORDER BY v.created_at
$$;

REVOKE EXECUTE ON FUNCTION public.emp_relatorio_unidade_vagas() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.relatorio_emprega_mais(date, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.relatorio_emprega_mais_detalhe(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.emp_relatorio_unidade_vagas() TO service_role;
GRANT EXECUTE ON FUNCTION public.relatorio_emprega_mais(date, date) TO service_role;
GRANT EXECUTE ON FUNCTION public.relatorio_emprega_mais_detalhe(date, date) TO service_role;
