-- S-PROG-10 (item 1): `trigger_indexar_campanha_mensal` passa a gravar mês, ano e unidade em
-- `documentos_rag.metadados`, além do `campanha_id` que já existia — é o que vai permitir o
-- motor-agente (item 3 desta mesma story, Edge Function, feito depois) comparar a vigência da
-- programação carregada com a data de hoje, no momento da resposta.
--
-- Achado de impacto (não estava no trecho da story, que só mostrava o lado INSERT): a função tem
-- dois caminhos — INSERT (documento novo) e UPDATE (documento já existe, reaprovação após reabrir
-- — fluxo normal da S-PROG-04). O UPDATE não tocava em `metadados` de jeito nenhum. Sem corrigir
-- os dois caminhos, reaprovar um mês já indexado (o caso mais comum, não o primeiro approve)
-- deixaria `metadados` congelado no formato antigo pra sempre — falha silenciosa do AC1.
--
-- Migration idempotente e retrocompatível: só ACRESCENTA chaves em `metadados`. `campanha_id`
-- continua no mesmo lugar, com o mesmo nome — `buscarAtividadeDeterministica` (motor-agente) e
-- `formatarChunks` não mudam (AC6). `v_conteudo` (texto indexado) não é tocado aqui — isso é
-- item 2 desta mesma story, em migration separada.
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

    -- Monta conteúdo rico a partir das atividades reais
    v_conteudo := 'PROGRAMAÇÃO MENSAL (' || NEW.mes || '/' || NEW.ano || ') - ' || NEW.unidade_cuca || chr(10);
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

    IF v_conteudo = 'PROGRAMAÇÃO MENSAL (' || NEW.mes || '/' || NEW.ano || ') - ' || NEW.unidade_cuca || chr(10) || 'Título: ' || NEW.titulo || chr(10) || chr(10) THEN
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
