-- S-PROG-19 (2ª parte): cobrança de data início, data fim, hora início e hora fim no ENVIO para
-- autorização (e na autorização) de CURSOS, DIA A DIA e ESPECIAIS, campanhas de outubro/2026 em diante.
-- ⚠️ NÃO APLICAR antes do redeploy do portal com a S-PROG-19: o portal atual não tem campo de data
-- fim, então ninguém conseguiria enviar DIA A DIA de outubro. Depois do redeploy, mover para
-- `supabase/migrations/` com a versão do dia e aplicar.
-- Resto da função idêntico à versão vigente (20260921221721_pgm_excluir_minha_programacao).

CREATE OR REPLACE FUNCTION public.pgm_mudar_status_categoria(p_campanha_id uuid, p_categoria text, p_para text, p_motivo text, p_usuario_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $$
DECLARE
    v_status_campanha text;
    v_nome text := CASE public.pgm_slug_categoria(p_categoria)
        WHEN 'esportes' THEN 'ESPORTES' WHEN 'cursos' THEN 'CURSOS'
        WHEN 'dia_a_dia' THEN 'DIA A DIA' WHEN 'especiais' THEN 'ESPECIAIS'
    END;
    v_de text;
    v_novo_status_campanha text;
    v_mes int;
    v_ano int;
    v_incompletas int;
BEGIN
    SELECT status, mes, ano INTO v_status_campanha, v_mes, v_ano FROM public.campanhas_mensais WHERE id = p_campanha_id FOR UPDATE;
    IF v_status_campanha IS NULL THEN
        RAISE EXCEPTION 'Programação não encontrada' USING ERRCODE = 'P0002';
    END IF;
    IF v_nome IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.atividades_mensais a
        WHERE a.campanha_id = p_campanha_id AND public.pgm_slug_categoria(a.categoria) = public.pgm_slug_categoria(v_nome)
    ) THEN
        RAISE EXCEPTION 'A categoria % não tem atividades nesta programação', coalesce(p_categoria, '(vazia)')
            USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.campanha_categoria_status (campanha_id, categoria, status)
    VALUES (p_campanha_id, v_nome, 'rascunho')
    ON CONFLICT (campanha_id, categoria) DO NOTHING;

    SELECT status INTO v_de FROM public.campanha_categoria_status
    WHERE campanha_id = p_campanha_id AND categoria = v_nome FOR UPDATE;

    IF NOT (
        (v_de = 'rascunho' AND p_para = 'aguardando_autorizacao')
        OR (v_de = 'aguardando_autorizacao' AND p_para IN ('autorizada', 'rascunho'))
        OR (v_de = 'autorizada' AND p_para = 'rascunho')
    ) THEN
        RAISE EXCEPTION 'Transição inválida para %: % → %', v_nome, v_de, p_para USING ERRCODE = 'P0001';
    END IF;

    -- S-PROG-19 (decisão do Junior, 2026-09-25): de outubro/2026 em diante, CURSOS, DIA A DIA e
    -- ESPECIAIS só vão para autorização (ou são autorizadas) com data início, data fim, hora início e
    -- hora fim preenchidas. O rascunho continua salvando incompleto — a cobrança é aqui, no envio.
    -- Hora fim antes da hora início: sempre erro em CURSOS (horário da aula); em DIA A DIA/ESPECIAIS
    -- só quando começa e termina no mesmo dia. Fim igual ao início é válido.
    IF p_para IN ('aguardando_autorizacao', 'autorizada')
       AND public.pgm_slug_categoria(v_nome) IN ('cursos', 'dia_a_dia', 'especiais')
       AND (v_ano * 12 + v_mes) >= (2026 * 12 + 10) THEN
        SELECT count(*) INTO v_incompletas
        FROM public.atividades_mensais a
        WHERE a.campanha_id = p_campanha_id
          AND public.pgm_slug_categoria(a.categoria) = public.pgm_slug_categoria(v_nome)
          AND (a.data_inicio IS NULL OR a.data_fim IS NULL OR a.hora_inicio IS NULL OR a.hora_fim IS NULL
               OR (a.hora_fim < a.hora_inicio
                   AND (public.pgm_slug_categoria(a.categoria) = 'cursos' OR a.data_fim = a.data_inicio)));
        IF v_incompletas > 0 THEN
            RAISE EXCEPTION '% atividade(s) de % sem data início, data fim, hora início ou hora fim (ou com hora fim antes do início). Preencha antes de enviar ou autorizar.', v_incompletas, v_nome
                USING ERRCODE = 'P0001';
        END IF;
    END IF;

    IF p_para = 'rascunho' AND nullif(btrim(coalesce(p_motivo, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Motivo é obrigatório para devolver ou reabrir' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.campanha_categoria_status
    SET status = p_para, atualizado_por = p_usuario_id, atualizado_em = now(),
        exigir_recriacao = CASE WHEN p_para = 'autorizada' THEN false ELSE exigir_recriacao END
    WHERE campanha_id = p_campanha_id AND categoria = v_nome;

    INSERT INTO public.campanha_historico (campanha_id, de_status, para_status, motivo, usuario_id, categoria)
    VALUES (p_campanha_id, v_de, p_para, nullif(btrim(coalesce(p_motivo, '')), ''), p_usuario_id, v_nome);

    SELECT CASE WHEN bool_and(s.status = 'autorizada') THEN 'autorizada' ELSE 'rascunho' END
    INTO v_novo_status_campanha
    FROM public.campanha_categoria_status s
    WHERE s.campanha_id = p_campanha_id
      AND (s.exigir_recriacao OR EXISTS (SELECT 1 FROM public.atividades_mensais a
                  WHERE a.campanha_id = p_campanha_id AND public.pgm_slug_categoria(a.categoria) = public.pgm_slug_categoria(s.categoria)));

    IF v_novo_status_campanha IS DISTINCT FROM v_status_campanha THEN
        UPDATE public.campanhas_mensais SET status = v_novo_status_campanha, updated_at = now() WHERE id = p_campanha_id;
    END IF;

    RETURN v_novo_status_campanha;
END;
$$;
