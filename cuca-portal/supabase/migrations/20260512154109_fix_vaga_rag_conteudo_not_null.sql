-- SQS-54: evita falha ao publicar vaga sem local/unidade preenchidos.
-- A versao anterior podia gerar conteudo NULL em documentos_rag quando
-- COALESCE(NEW.local, NEW.unidade_cuca) retornava NULL.

CREATE OR REPLACE FUNCTION public.trigger_indexar_vaga()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_doc_id uuid;
  v_titulo text;
  v_descricao text;
  v_requisitos text;
  v_salario text;
  v_local text;
  v_conteudo text;
BEGIN
  SELECT id INTO v_doc_id
  FROM public.documentos_rag
  WHERE metadados->>'vaga_id' = NEW.id::text
  LIMIT 1;

  IF (NEW.status = 'aberta') THEN
    v_titulo := COALESCE(NULLIF(BTRIM(NEW.titulo), ''), 'Vaga sem titulo');
    v_descricao := COALESCE(NULLIF(BTRIM(NEW.descricao), ''), 'Nao informado');
    v_requisitos := COALESCE(NULLIF(BTRIM(NEW.requisitos), ''), 'Nao informado');
    v_salario := COALESCE(NULLIF(BTRIM(NEW.salario), ''), 'A combinar');
    v_local := COALESCE(
      NULLIF(BTRIM(NEW.local), ''),
      NULLIF(BTRIM(NEW.unidade_cuca), ''),
      NULLIF(BTRIM(NEW.unidade_destino), ''),
      'Nao informado'
    );

    v_conteudo := concat_ws(E'\n',
      'VAGA: ' || v_titulo,
      'DESCRICAO: ' || v_descricao,
      'REQUISITOS: ' || v_requisitos,
      'SALARIO: ' || v_salario,
      'LOCAL: ' || v_local
    );

    IF v_doc_id IS NOT NULL THEN
      UPDATE public.documentos_rag SET
        titulo = v_titulo,
        tipo = 'job_posting',
        conteudo = v_conteudo,
        metadados = COALESCE(metadados, '{}'::jsonb) || jsonb_build_object('vaga_id', NEW.id, 'empresa_id', NEW.empresa_id),
        unidade_cuca = NULLIF(BTRIM(COALESCE(NEW.unidade_cuca, '')), ''),
        ativo = true,
        updated_at = NOW()
      WHERE id = v_doc_id;
    ELSE
      INSERT INTO public.documentos_rag (titulo, tipo, conteudo, metadados, unidade_cuca, ativo, created_by)
      VALUES (
        v_titulo,
        'job_posting',
        v_conteudo,
        jsonb_build_object('vaga_id', NEW.id, 'empresa_id', NEW.empresa_id),
        NULLIF(BTRIM(COALESCE(NEW.unidade_cuca, '')), ''),
        true,
        NEW.created_by
      );
    END IF;
  ELSE
    IF v_doc_id IS NOT NULL THEN
      UPDATE public.documentos_rag
      SET ativo = false, updated_at = NOW()
      WHERE id = v_doc_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
