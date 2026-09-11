-- S-PROG-10 (item 2): a primeira linha de `v_conteudo` passa a nomear o mês por extenso e
-- declarar a vigência explicitamente, em vez de `(8/2026)` — formato ambíguo pro modelo em texto
-- corrido e que some no meio do chunk (achado da story, não meu).
--
-- Só a construção do cabeçalho muda (as duas primeiras linhas de `v_conteudo` + a string de
-- comparação usada pra detectar campanha sem atividade e cair no fallback). O resto da função —
-- inclusive a lógica de `metadados` do item 1 (migration anterior) — é idêntico, preservado por
-- CREATE OR REPLACE sobre a versão que já está em produção.
CREATE OR REPLACE FUNCTION public.trigger_indexar_campanha_mensal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_doc_id uuid;
  v_conteudo text;
  v_linha record;
  v_categoria_atual text := '';
  v_metadados jsonb;
  -- S-PROG-10 (item 2): nomes de mês por extenso, em português. Array PL/pgSQL construído com
  -- ARRAY[...] é indexado a partir de 1 por padrão (não de 0) — `v_nomes_mes[1]` = 'janeiro',
  -- bate direto com `NEW.mes` (sempre 1-12). Achado no próprio teste desta migration: a primeira
  -- versão tinha uma string vazia no índice 1 "pra imitar índice 0", o que empurrava tudo um
  -- mês pra trás (mês 8/agosto virava "julho" no texto indexado) — sem essa string vazia.
  v_nomes_mes text[] := ARRAY['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
    'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  v_mes_nome text;
BEGIN
  SELECT id INTO v_doc_id FROM public.documentos_rag
  WHERE metadados->>'campanha_id' = NEW.id::text
  LIMIT 1;

  IF (NEW.status = 'aprovado') THEN
    -- Desativar monthly_program de meses anteriores da mesma unidade
    UPDATE public.documentos_rag
    SET ativo = false, updated_at = NOW()
    WHERE tipo = 'monthly_program'
      AND unidade_cuca = NEW.unidade_cuca
      AND metadados->>'campanha_id' != NEW.id::text;

    v_mes_nome := v_nomes_mes[NEW.mes];

    -- Monta conteúdo rico a partir das atividades reais — cabeçalho com mês por extenso e frase
    -- de vigência explícita (S-PROG-10 item 2), em vez de "(8/2026)".
    v_conteudo := 'PROGRAMAÇÃO MENSAL DE ' || UPPER(v_mes_nome) || ' DE ' || NEW.ano || ' — ' || NEW.unidade_cuca || chr(10);
    v_conteudo := v_conteudo || 'Esta programação vale para o mês de ' || v_mes_nome || ' de ' || NEW.ano || '.' || chr(10);
    v_conteudo := v_conteudo || 'Título: ' || NEW.titulo || chr(10) || chr(10);

    FOR v_linha IN (
      SELECT categoria, titulo, descricao, local, hora_inicio, hora_fim, data_atividade
      FROM public.atividades_mensais
      WHERE campanha_id = NEW.id
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

    -- Detecta campanha sem nenhuma atividade utilizável — string de comparação atualizada pro
    -- novo formato do cabeçalho (item 2); mesma lógica de antes, só o texto mudou.
    IF v_conteudo = 'PROGRAMAÇÃO MENSAL DE ' || UPPER(v_mes_nome) || ' DE ' || NEW.ano || ' — ' || NEW.unidade_cuca || chr(10)
                   || 'Esta programação vale para o mês de ' || v_mes_nome || ' de ' || NEW.ano || '.' || chr(10)
                   || 'Título: ' || NEW.titulo || chr(10) || chr(10) THEN
      v_conteudo := v_conteudo || 'Detalhes: Consulte a programação no Portal da Juventude.';
    END IF;

    -- S-PROG-10 (item 1): metadados estruturados — mes/ano/unidade_cuca, além do campanha_id que
    -- já existia. Usado nos dois caminhos abaixo (INSERT e UPDATE).
    v_metadados := jsonb_build_object(
      'campanha_id', NEW.id,
      'mes', NEW.mes,
      'ano', NEW.ano,
      'unidade_cuca', NEW.unidade_cuca
    );

    IF v_doc_id IS NOT NULL THEN
      UPDATE public.documentos_rag SET
        titulo = NEW.titulo,
        conteudo = v_conteudo,
        metadados = v_metadados,
        unidade_cuca = NEW.unidade_cuca,
        ativo = true,
        updated_at = NOW()
      WHERE id = v_doc_id;
    ELSE
      INSERT INTO public.documentos_rag (titulo, tipo, conteudo, metadados, unidade_cuca, ativo, created_by)
      VALUES (
        NEW.titulo,
        'monthly_program',
        v_conteudo,
        v_metadados,
        NEW.unidade_cuca,
        true,
        NEW.created_by
      );
    END IF;
  ELSE
    IF v_doc_id IS NOT NULL THEN
      UPDATE public.documentos_rag SET ativo = false, updated_at = NOW() WHERE id = v_doc_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
