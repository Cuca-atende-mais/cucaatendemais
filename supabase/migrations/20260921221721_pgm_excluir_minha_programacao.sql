-- Programação mensal: "Excluir minha programação" por categoria (decisão do Junior, 2026-09-21).
--
-- * Cada pessoa exclui só as categorias dela, dentro da programação da unidade — nunca a programação
--   inteira com a parte dos outros. Em rascunho: quem tem "excluir minha programação" (assistente).
--   Enviada ou autorizada (antes de publicar): só quem tem "excluir programação enviada ou autorizada"
--   (supervisor). Publicada (RAG no ar): só Developer. A rota `/api/programacao/excluir` decide quais
--   categorias a pessoa pode excluir e chama `pgm_excluir_categorias` (só a chave de serviço executa).
-- * Supervisor que exclui uma categoria enviada ou autorizada deixa a unidade TRAVADA até essa categoria
--   ser recriada e autorizada de novo: a linha em `campanha_categoria_status` fica com
--   `exigir_recriacao = true` e conta como categoria obrigatória no status da programação, no nível 1
--   da Divulgação e no "Aprovar RAG". A marca some quando a categoria é autorizada de novo.
-- * "Excluir programação inteira" (todas as categorias) fica só para Developer, também pela API direta.
--
-- Idempotente e retrocompatível: coluna nova com padrão false, funções com a mesma assinatura.

ALTER TABLE public.campanha_categoria_status
    ADD COLUMN IF NOT EXISTS exigir_recriacao boolean NOT NULL DEFAULT false;

-- ── Excluir categorias (transação única) ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pgm_excluir_categorias(p_campanha_id uuid, p_categorias text[], p_usuario_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_status text;
    v_item text;
    v_nome text;
    v_de text;
    v_marcada boolean;
    v_resta int;
    v_novo text;
BEGIN
    SELECT status INTO v_status FROM public.campanhas_mensais WHERE id = p_campanha_id FOR UPDATE;
    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Programação não encontrada' USING ERRCODE = 'P0002';
    END IF;
    IF public.pgm_campanha_publicada(p_campanha_id) THEN
        RAISE EXCEPTION 'Programação publicada (no ar) só pode ser excluída por Developer.' USING ERRCODE = '42501';
    END IF;

    FOREACH v_item IN ARRAY coalesce(p_categorias, ARRAY[]::text[]) LOOP
        v_nome := CASE public.pgm_slug_categoria(v_item)
            WHEN 'esportes' THEN 'ESPORTES' WHEN 'cursos' THEN 'CURSOS'
            WHEN 'dia_a_dia' THEN 'DIA A DIA' WHEN 'especiais' THEN 'ESPECIAIS'
        END;
        CONTINUE WHEN v_nome IS NULL;

        SELECT s.status, s.exigir_recriacao INTO v_de, v_marcada
        FROM public.campanha_categoria_status s
        WHERE s.campanha_id = p_campanha_id AND s.categoria = v_nome
        FOR UPDATE;

        DELETE FROM public.atividades_mensais a
        WHERE a.campanha_id = p_campanha_id
          AND public.pgm_slug_categoria(a.categoria) = public.pgm_slug_categoria(v_nome);

        IF coalesce(v_de, 'rascunho') = 'rascunho' AND NOT coalesce(v_marcada, false) THEN
            -- Rascunho que nunca foi enviado: a parte some sem deixar pendência.
            DELETE FROM public.campanha_categoria_status
            WHERE campanha_id = p_campanha_id AND categoria = v_nome;
        ELSE
            -- Já tinha sido enviada/autorizada: a unidade fica travada até recriar e autorizar de novo.
            UPDATE public.campanha_categoria_status
            SET status = 'rascunho', exigir_recriacao = true, atualizado_por = p_usuario_id, atualizado_em = now()
            WHERE campanha_id = p_campanha_id AND categoria = v_nome;
        END IF;

        INSERT INTO public.campanha_historico (campanha_id, de_status, para_status, motivo, usuario_id, categoria)
        VALUES (p_campanha_id, coalesce(v_de, 'rascunho'), 'excluida', 'Programação da categoria excluída', p_usuario_id, v_nome);
    END LOOP;

    SELECT count(*) INTO v_resta FROM public.atividades_mensais WHERE campanha_id = p_campanha_id;
    IF v_resta = 0 THEN
        -- Sem atividade de ninguém: a programação vazia sai (a unidade fica "sem programação" no nível 1).
        DELETE FROM public.campanhas_mensais WHERE id = p_campanha_id;
        RETURN 'excluida';
    END IF;

    SELECT CASE WHEN bool_and(s.status = 'autorizada') THEN 'autorizada' ELSE 'rascunho' END
    INTO v_novo
    FROM public.campanha_categoria_status s
    WHERE s.campanha_id = p_campanha_id
      AND (s.exigir_recriacao OR EXISTS (
            SELECT 1 FROM public.atividades_mensais a
            WHERE a.campanha_id = p_campanha_id AND public.pgm_slug_categoria(a.categoria) = public.pgm_slug_categoria(s.categoria)));
    v_novo := coalesce(v_novo, 'rascunho');

    IF v_novo IS DISTINCT FROM v_status THEN
        UPDATE public.campanhas_mensais SET status = v_novo, updated_at = now() WHERE id = p_campanha_id;
    END IF;

    RETURN v_novo;
END;
$function$;

REVOKE ALL ON FUNCTION public.pgm_excluir_categorias(uuid, text[], uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pgm_excluir_categorias(uuid, text[], uuid) TO service_role;

-- ── Mudança de status por categoria: categoria marcada conta como obrigatória ────────────────────
CREATE OR REPLACE FUNCTION public.pgm_mudar_status_categoria(p_campanha_id uuid, p_categoria text, p_para text, p_motivo text, p_usuario_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_status_campanha text;
    v_nome text := CASE public.pgm_slug_categoria(p_categoria)
        WHEN 'esportes' THEN 'ESPORTES' WHEN 'cursos' THEN 'CURSOS'
        WHEN 'dia_a_dia' THEN 'DIA A DIA' WHEN 'especiais' THEN 'ESPECIAIS'
    END;
    v_de text;
    v_novo_status_campanha text;
BEGIN
    SELECT status INTO v_status_campanha FROM public.campanhas_mensais WHERE id = p_campanha_id FOR UPDATE;
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

    IF p_para = 'rascunho' AND nullif(btrim(coalesce(p_motivo, '')), '') IS NULL THEN
        RAISE EXCEPTION 'Motivo é obrigatório para devolver ou reabrir' USING ERRCODE = 'P0001';
    END IF;

    -- Autorizada de novo: a categoria excluída pelo supervisor foi recriada, a trava sai.
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
$function$;

-- ── Aprovar RAG: não passa com categoria excluída ainda não recriada e autorizada ───────────────
CREATE OR REPLACE FUNCTION public.pgm_aprovar_rag_campanha(p_campanha_id uuid, p_usuario_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
    v_status text;
    v_doc uuid;
BEGIN
    SELECT status INTO v_status FROM public.campanhas_mensais WHERE id = p_campanha_id FOR UPDATE;
    IF v_status IS NULL THEN
        RAISE EXCEPTION 'Programação não encontrada' USING ERRCODE = 'P0002';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.atividades_mensais a WHERE a.campanha_id = p_campanha_id)
       OR EXISTS (
            SELECT 1 FROM public.atividades_mensais a
            WHERE a.campanha_id = p_campanha_id
              AND NOT EXISTS (
                  SELECT 1 FROM public.campanha_categoria_status s
                  WHERE s.campanha_id = p_campanha_id AND s.status = 'autorizada'
                    AND public.pgm_slug_categoria(s.categoria) = public.pgm_slug_categoria(a.categoria)
              )
       ) THEN
        RAISE EXCEPTION 'Nem todas as categorias desta programação estão autorizadas' USING ERRCODE = 'P0001';
    END IF;

    IF EXISTS (SELECT 1 FROM public.campanha_categoria_status s WHERE s.campanha_id = p_campanha_id AND s.exigir_recriacao) THEN
        RAISE EXCEPTION 'Categoria excluída nesta programação precisa ser recriada e autorizada antes' USING ERRCODE = 'P0001';
    END IF;

    IF v_status <> 'aprovado' THEN
        UPDATE public.campanhas_mensais SET status = 'aprovado', updated_at = now() WHERE id = p_campanha_id;
    END IF;

    v_doc := public.montar_documento_rag_campanha(p_campanha_id);

    INSERT INTO public.campanha_historico (campanha_id, de_status, para_status, motivo, usuario_id, categoria)
    VALUES (p_campanha_id, v_status, 'aprovado', 'RAG aprovado na Divulgação', p_usuario_id, NULL);

    RETURN v_doc;
END;
$function$;

-- ── Situação para os cards: categoria marcada entra no total (ex.: "2 de 3 autorizadas") ─────────
CREATE OR REPLACE FUNCTION public.pgm_situacao_campanhas(p_ids uuid[])
 RETURNS TABLE(campanha_id uuid, total_categorias integer, autorizadas integer, aguardando integer, no_rag boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
    SELECT
        c.id,
        (SELECT count(*)::int FROM public.campanha_categoria_status s
            WHERE s.campanha_id = c.id
              AND (s.exigir_recriacao OR EXISTS (SELECT 1 FROM public.atividades_mensais a
                          WHERE a.campanha_id = c.id AND public.pgm_slug_categoria(a.categoria) = public.pgm_slug_categoria(s.categoria)))),
        (SELECT count(*)::int FROM public.campanha_categoria_status s
            WHERE s.campanha_id = c.id AND s.status = 'autorizada'
              AND EXISTS (SELECT 1 FROM public.atividades_mensais a
                          WHERE a.campanha_id = c.id AND public.pgm_slug_categoria(a.categoria) = public.pgm_slug_categoria(s.categoria))),
        (SELECT count(*)::int FROM public.campanha_categoria_status s
            WHERE s.campanha_id = c.id AND s.status = 'aguardando_autorizacao'
              AND EXISTS (SELECT 1 FROM public.atividades_mensais a
                          WHERE a.campanha_id = c.id AND public.pgm_slug_categoria(a.categoria) = public.pgm_slug_categoria(s.categoria))),
        EXISTS (
            SELECT 1 FROM public.documentos_rag d
            WHERE d.tipo = 'monthly_program' AND d.ativo
              AND d.metadados->>'campanha_id' = c.id::text
              AND EXISTS (SELECT 1 FROM public.chunks_documentos ch WHERE ch.documento_id = d.id)
        )
    FROM public.campanhas_mensais c
    WHERE c.id = ANY(p_ids)
      AND (
          public.is_developer()
          OR (
              (c.unidade_cuca IS NULL OR c.unidade_cuca::text = public.get_my_unit() OR public.get_my_unit() IS NULL)
              AND public.pgm_pode_ler_campanhas()
          )
      );
$function$;

-- ── Programação inteira pela API direta: só Developer ───────────────────────────────────────────
DROP POLICY IF EXISTS campanhas_mensais_exclusao ON public.campanhas_mensais;
CREATE POLICY campanhas_mensais_exclusao ON public.campanhas_mensais
    FOR DELETE TO authenticated
    USING (public.is_developer());
