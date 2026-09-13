-- S-PROG-14 + S-PROG-15 (liberação): aplicar SÓ depois do merge e do redeploy do portal com as duas
-- stories. Desliga o RAG do ciclo de edição, cria as transições por categoria e o "Aprovar RAG".
-- Não altera nenhum documento de RAG existente nem o `ativo` deles.

-- 0. "aguardando_autorizacao" tem 22 caracteres: amplia as colunas de status do histórico (só aumenta o limite).
ALTER TABLE public.campanha_historico ALTER COLUMN de_status TYPE varchar(40);
ALTER TABLE public.campanha_historico ALTER COLUMN para_status TYPE varchar(40);

-- 1. Categoria em rascunho? (sem status ainda = categoria nova, editável)
CREATE OR REPLACE FUNCTION public.pgm_categoria_em_rascunho(p_campanha_id uuid, p_categoria text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
    SELECT NOT EXISTS (
        SELECT 1 FROM public.campanha_categoria_status s
        WHERE s.campanha_id = p_campanha_id
          AND public.pgm_slug_categoria(s.categoria) = public.pgm_slug_categoria(p_categoria)
          AND s.status <> 'rascunho'
    )
$$;

REVOKE ALL ON FUNCTION public.pgm_categoria_em_rascunho(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pgm_categoria_em_rascunho(uuid, text) TO authenticated, service_role;

-- 2. O gatilho antigo deixa de publicar/tirar do ar o RAG a cada alteração da campanha.
--    A função `trigger_indexar_campanha_mensal` fica no banco só como referência para rollback.
DROP TRIGGER IF EXISTS tr_campanha_mensal_index ON public.campanhas_mensais;

-- 3. Montagem do documento de RAG
-- Única forma de montar o documento de RAG de uma campanha (extraída de
-- `trigger_indexar_campanha_mensal`, corpo copiado de pg_get_functiondef). Sempre cria documento NOVO e
-- inativo: `processar-documento` apaga os chunks antes de regravar, então atualizar o documento ativo no
-- lugar deixaria o agente sem conteúdo durante a indexação. A troca acontece em
-- `ativar_monthly_program_indexado` quando a indexação termina.
CREATE OR REPLACE FUNCTION public.montar_documento_rag_campanha(p_campanha_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_doc_id uuid;
  v_c public.campanhas_mensais%ROWTYPE;
  v_conteudo text;
  v_linha record;
  v_categoria_atual text := '';
  v_metadados jsonb;
  v_nomes_mes text[] := ARRAY['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  v_mes_nome text;
BEGIN
  SELECT * INTO v_c FROM public.campanhas_mensais WHERE id = p_campanha_id;
  IF v_c.id IS NULL THEN
    RAISE EXCEPTION 'Programação não encontrada' USING ERRCODE = 'P0002';
  END IF;

    v_mes_nome := v_nomes_mes[v_c.mes];

    v_conteudo := 'PROGRAMAÇÃO MENSAL DE ' || UPPER(v_mes_nome) || ' DE ' || v_c.ano || ' — ' || v_c.unidade_cuca || chr(10);
    v_conteudo := v_conteudo || 'Esta programação vale para o mês de ' || v_mes_nome || ' de ' || v_c.ano || '.' || chr(10);
    v_conteudo := v_conteudo || 'Título: ' || v_c.titulo || chr(10) || chr(10);

    FOR v_linha IN (
      SELECT categoria, titulo, descricao, local, hora_inicio, hora_fim, data_atividade
      FROM public.atividades_mensais
      WHERE campanha_id = v_c.id
      ORDER BY categoria, data_atividade, hora_inicio
    ) LOOP
      IF v_linha.categoria IS DISTINCT FROM v_categoria_atual THEN
        v_categoria_atual := COALESCE(v_linha.categoria, 'GERAL');
        v_conteudo := v_conteudo || chr(10) || '== ' || v_categoria_atual || ' ==' || chr(10);
      END IF;

      v_conteudo := v_conteudo || '• ' || COALESCE(v_linha.titulo, '') || chr(10);

      IF v_linha.descricao IS NOT NULL AND v_linha.descricao != '' THEN
        v_conteudo := v_conteudo || '  Detalhes: ' || v_linha.descricao || chr(10);
      END IF;

      IF v_linha.local IS NOT NULL AND v_linha.local != '' AND v_linha.local != 'Não informado' THEN
        v_conteudo := v_conteudo || '  Local: ' || v_linha.local || chr(10);
      END IF;

      IF v_linha.hora_inicio IS NOT NULL THEN
        v_conteudo := v_conteudo || '  Horário: ' || v_linha.hora_inicio::text;
        IF v_linha.hora_fim IS NOT NULL THEN
          v_conteudo := v_conteudo || ' às ' || v_linha.hora_fim::text;
        END IF;
        v_conteudo := v_conteudo || chr(10);
      END IF;
    END LOOP;

    IF v_conteudo = 'PROGRAMAÇÃO MENSAL DE ' || UPPER(v_mes_nome) || ' DE ' || v_c.ano || ' — ' || v_c.unidade_cuca || chr(10)
                   || 'Esta programação vale para o mês de ' || v_mes_nome || ' de ' || v_c.ano || '.' || chr(10)
                   || 'Título: ' || v_c.titulo || chr(10) || chr(10) THEN
      v_conteudo := v_conteudo || 'Detalhes: Consulte a programação no Portal da Juventude.';
    END IF;

    v_metadados := jsonb_build_object(
      'campanha_id', v_c.id,
      'mes', v_c.mes,
      'ano', v_c.ano,
      'unidade_cuca', v_c.unidade_cuca
    );

    INSERT INTO public.documentos_rag (titulo, tipo, conteudo, metadados, unidade_cuca, ativo, created_by)
    VALUES (v_c.titulo, 'monthly_program', v_conteudo, v_metadados, v_c.unidade_cuca, false, v_c.created_by)
    RETURNING id INTO v_doc_id;

  RETURN v_doc_id;
END;
$$;

REVOKE ALL ON FUNCTION public.montar_documento_rag_campanha(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.montar_documento_rag_campanha(uuid) TO service_role;

-- 4. Depois de colocar um documento no ar, remove os outros documentos da MESMA campanha
--    (versão anterior do mês ou tentativa que falhou). Documentos de outros meses ficam.
CREATE OR REPLACE FUNCTION public.ativar_monthly_program_indexado(p_documento_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_unidade text;
  v_chunks integer;
  v_campanha text;
BEGIN
  SELECT d.unidade_cuca, d.metadados->>'campanha_id' INTO v_unidade, v_campanha
  FROM public.documentos_rag d
  WHERE d.id = p_documento_id AND d.tipo = 'monthly_program';

  IF v_unidade IS NULL THEN
    RETURN false;
  END IF;

  SELECT count(*) INTO v_chunks FROM public.chunks_documentos c WHERE c.documento_id = p_documento_id;
  IF v_chunks = 0 THEN
    RETURN false;
  END IF;

  UPDATE public.documentos_rag
  SET ativo = (id = p_documento_id), updated_at = NOW()
  WHERE tipo = 'monthly_program'
    AND unidade_cuca = v_unidade
    AND ativo IS DISTINCT FROM (id = p_documento_id);

  IF v_campanha IS NOT NULL THEN
    DELETE FROM public.documentos_rag
    WHERE tipo = 'monthly_program'
      AND id <> p_documento_id
      AND metadados->>'campanha_id' = v_campanha;
  END IF;

  RETURN true;
END;
$function$;

-- 5. Excluir campanha: só troca o mês do RAG se a campanha excluída era a que estava no ar.
CREATE OR REPLACE FUNCTION public.delete_rag_on_campanha_delete()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_estava_no_ar boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.documentos_rag
    WHERE tipo = 'monthly_program' AND ativo
      AND metadados->>'campanha_id' = OLD.id::text
  ) INTO v_estava_no_ar;

  DELETE FROM public.documentos_rag
  WHERE tipo = 'monthly_program'
    AND metadados->>'campanha_id' = OLD.id::text;

  IF v_estava_no_ar THEN
    PERFORM public.reativar_monthly_program_mais_recente(OLD.unidade_cuca, OLD.id);
  END IF;

  RETURN OLD;
END;
$function$;

-- 6. Transição de status de uma categoria (chamada só pela rota do servidor, que confere permissão,
--    unidade e campos obrigatórios). O status da campanha passa a ser consequência: `autorizada` com
--    todas as categorias com atividade autorizadas, senão `rascunho`. `aprovado` só pelo "Aprovar RAG".
CREATE OR REPLACE FUNCTION public.pgm_mudar_status_categoria(
    p_campanha_id uuid, p_categoria text, p_para text, p_motivo text, p_usuario_id uuid
)
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

    UPDATE public.campanha_categoria_status
    SET status = p_para, atualizado_por = p_usuario_id, atualizado_em = now()
    WHERE campanha_id = p_campanha_id AND categoria = v_nome;

    INSERT INTO public.campanha_historico (campanha_id, de_status, para_status, motivo, usuario_id, categoria)
    VALUES (p_campanha_id, v_de, p_para, nullif(btrim(coalesce(p_motivo, '')), ''), p_usuario_id, v_nome);

    SELECT CASE WHEN bool_and(s.status = 'autorizada') THEN 'autorizada' ELSE 'rascunho' END
    INTO v_novo_status_campanha
    FROM public.campanha_categoria_status s
    WHERE s.campanha_id = p_campanha_id
      AND EXISTS (SELECT 1 FROM public.atividades_mensais a
                  WHERE a.campanha_id = p_campanha_id AND public.pgm_slug_categoria(a.categoria) = public.pgm_slug_categoria(s.categoria));

    IF v_novo_status_campanha IS DISTINCT FROM v_status_campanha THEN
        UPDATE public.campanhas_mensais SET status = v_novo_status_campanha, updated_at = now() WHERE id = p_campanha_id;
    END IF;

    RETURN v_novo_status_campanha;
END;
$$;

REVOKE ALL ON FUNCTION public.pgm_mudar_status_categoria(uuid, text, text, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pgm_mudar_status_categoria(uuid, text, text, text, uuid) TO service_role;

-- 7. "Aprovar RAG" de uma campanha (chamada pela rota da Divulgação, que confere permissão, mês e
--    nível 1 das 5 unidades). Grava `aprovado`, monta documento novo inativo e registra no histórico.
CREATE OR REPLACE FUNCTION public.pgm_aprovar_rag_campanha(p_campanha_id uuid, p_usuario_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
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

    IF v_status <> 'aprovado' THEN
        UPDATE public.campanhas_mensais SET status = 'aprovado', updated_at = now() WHERE id = p_campanha_id;
    END IF;

    v_doc := public.montar_documento_rag_campanha(p_campanha_id);

    INSERT INTO public.campanha_historico (campanha_id, de_status, para_status, motivo, usuario_id, categoria)
    VALUES (p_campanha_id, v_status, 'aprovado', 'RAG aprovado na Divulgação', p_usuario_id, NULL);

    RETURN v_doc;
END;
$$;

REVOKE ALL ON FUNCTION public.pgm_aprovar_rag_campanha(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pgm_aprovar_rag_campanha(uuid, uuid) TO service_role;

-- 8. Salvar rascunho recusa categoria enviada ou autorizada
CREATE OR REPLACE FUNCTION public.programacao_salvar_rascunho_categorias(p_campanha_id uuid, p_titulo text, p_atividades jsonb, p_categorias text[])
 RETURNS TABLE(campanha_id uuid, total_atividades integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
        COALESCE(NULLIF(a->>'data_atividade', '')::date, v_placeholder),
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

-- 9. Escrita direta pela API também respeita o bloqueio da categoria
DROP POLICY IF EXISTS "atividades_mensais_insercao_categoria" ON public.atividades_mensais;
DROP POLICY IF EXISTS "atividades_mensais_alteracao_categoria" ON public.atividades_mensais;
DROP POLICY IF EXISTS "atividades_mensais_exclusao_categoria" ON public.atividades_mensais;

CREATE POLICY "atividades_mensais_insercao_categoria" ON public.atividades_mensais
    FOR INSERT TO authenticated
    WITH CHECK (public.pgm_pode_categoria(categoria, 'create') AND public.pgm_categoria_em_rascunho(campanha_id, categoria));
CREATE POLICY "atividades_mensais_alteracao_categoria" ON public.atividades_mensais
    FOR UPDATE TO authenticated
    USING (public.pgm_pode_categoria(categoria, 'update') AND public.pgm_categoria_em_rascunho(campanha_id, categoria))
    WITH CHECK (public.pgm_pode_categoria(categoria, 'update') AND public.pgm_categoria_em_rascunho(campanha_id, categoria));
CREATE POLICY "atividades_mensais_exclusao_categoria" ON public.atividades_mensais
    FOR DELETE TO authenticated
    USING (public.pgm_pode_categoria(categoria, 'delete') AND public.pgm_categoria_em_rascunho(campanha_id, categoria));

-- 10. Campanhas criadas ou alteradas no fluxo antigo entre a migration de expansão e esta liberação
UPDATE public.campanha_categoria_status s
SET status = CASE c.status WHEN 'aprovado' THEN 'autorizada' ELSE 'aguardando_autorizacao' END, atualizado_em = now()
FROM public.campanhas_mensais c
WHERE c.id = s.campanha_id AND s.status = 'rascunho' AND c.status IN ('aprovado', 'pendente');

UPDATE public.campanhas_mensais SET status = 'rascunho', updated_at = now() WHERE status = 'pendente';
