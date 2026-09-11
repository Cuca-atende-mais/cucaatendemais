-- S-PROG-09 (item 1): grava um rascunho de programação preservando o `campanha_id` — a rota
-- anterior (POST /api/programacao/importar) resolve conflito de mês/unidade APAGANDO a campanha e
-- recriando, o que é destrutivo para um editor que salva e volta depois:
--   - apaga campanha_historico inteiro (ON DELETE CASCADE em campanha_id);
--   - troca o id da campanha, quebrando documentos_rag.metadados->>'campanha_id', usado por
--     buscarAtividadeDeterministica no motor-agente.
-- Esta função nunca apaga a campanha: só substitui as atividades, numa única transação (a chamada
-- da função inteira é atômica), e recusa gravar se a campanha não estiver em rascunho.
--
-- Regra de negócio confirmada pelo Junior (2026-09-10): duplicar SEMPRE zera hora_inicio, hora_fim
-- e vagas (nunca repete o dado da origem). Para categorias com data própria (CURSOS/DIA A
-- DIA/ESPECIAIS) a data também zera. ESPORTES não tem data individual (é recorrente por dia da
-- semana) — `atividades_mensais.data_atividade` é NOT NULL, então ESPORTES sempre recebe o
-- placeholder do 1º dia do mês da campanha, mesma convenção já usada pela importação de planilha
-- (`import-planilha-modal.tsx`, `fallbackDate`). Isso é garantido aqui, na gravação, não confiado
-- ao cliente.
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

-- SECURITY DEFINER: a checagem de permissão (has_permission('programacao','update')) é feita na
-- rota (/api/programacao/rascunho), com o usuário autenticado — mesmo padrão de
-- /api/programacao/status. A função em si roda com privilégio elevado só para poder gravar
-- independente de RLS, já que a rota já validou quem pode chamar.
REVOKE ALL ON FUNCTION public.programacao_salvar_rascunho(uuid, text, jsonb) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.programacao_salvar_rascunho(uuid, text, jsonb) TO authenticated, service_role;
