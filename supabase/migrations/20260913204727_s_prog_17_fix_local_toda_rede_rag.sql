-- S-PROG-17 (correção @qa A1) — evento "Toda a Rede" sem local quebrava o gatilho de RAG.
-- `'LOCAL: ' || COALESCE(local, unidade_cuca)` virava NULL quando os dois eram nulos, o `conteudo` inteiro
-- ficava NULL e `documentos_rag.conteudo` é NOT NULL: autorizar o evento falhava. Agora cai em
-- 'Toda a Rede CUCA' (local vazio também). Resto da função igual à migration 20260913170146. Idempotente.
CREATE OR REPLACE FUNCTION public.trigger_indexar_evento()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_doc_id uuid;
  v_conteudo TEXT;
BEGIN
  SELECT id INTO v_doc_id FROM public.documentos_rag
  WHERE metadados->>'evento_id' = NEW.id::text LIMIT 1;

  IF NEW.status IN ('autorizado', 'aprovado', 'em_andamento', 'pausada', 'pausada_limite_diario', 'concluida') THEN

    v_conteudo :=
      'EVENTO: ' || NEW.titulo || E'\n' ||
      'DESCRIÇÃO: ' || COALESCE(NEW.descricao, '') || E'\n' ||
      'DATA: ' || COALESCE(NEW.data_inicio::text, NEW.data_evento::text) ||
        CASE
          WHEN NEW.data_fim IS NOT NULL AND NEW.data_fim::text != COALESCE(NEW.data_inicio::text, NEW.data_evento::text)
          THEN ' até ' || NEW.data_fim::text
          ELSE ''
        END || E'\n' ||
      'HORÁRIO: ' || COALESCE(NEW.hora_inicio::text, 'A definir') || E'\n' ||
      'LOCAL: ' || COALESCE(NULLIF(NEW.local, ''), NEW.unidade_cuca, 'Toda a Rede CUCA') || E'\n' ||
      CASE
        WHEN NEW.flyer_url IS NOT NULL AND NEW.flyer_url != ''
        THEN 'FLYER: ' || NEW.flyer_url || E'\n'
        ELSE ''
      END;

    IF v_doc_id IS NOT NULL THEN
      UPDATE public.documentos_rag SET
        titulo      = NEW.titulo,
        tipo        = 'eventos_pontuais',
        conteudo    = v_conteudo,
        unidade_cuca = NEW.unidade_cuca,
        ativo       = true,
        updated_at  = NOW(),
        metadados   = metadados || jsonb_build_object('indexado_em', NOW())
      WHERE id = v_doc_id;
    ELSE
      INSERT INTO public.documentos_rag (titulo, tipo, conteudo, metadados, unidade_cuca, ativo, created_by)
      VALUES (
        NEW.titulo,
        'eventos_pontuais',
        v_conteudo,
        jsonb_build_object(
          'evento_id',   NEW.id,
          'indexado_em', NOW(),
          'source_type', 'rede_cuca_global'
        ),
        NEW.unidade_cuca,
        true,
        NEW.created_by
      );
    END IF;

  ELSE
    -- Aguardando aprovação / devolvido / cancelado: fora do RAG
    IF v_doc_id IS NOT NULL THEN
      UPDATE public.documentos_rag SET ativo = false, updated_at = NOW() WHERE id = v_doc_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
