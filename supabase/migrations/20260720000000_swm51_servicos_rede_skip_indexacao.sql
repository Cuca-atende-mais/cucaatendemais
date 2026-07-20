-- S-WM-51: estende trigger_indexar_documento pra também pular 'servicos_rede', mesma exceção
-- já aplicada a 'resumo_rede' pela migration 20260713200000_swm32_resumo_rede_skip_indexacao.sql.
-- Sem isso, todo insert/update de titulo/conteudo no documento de serviços institucionais
-- (tipo novo desta story, carregado inteiro via carregarServicosRede, sem chunk/embedding —
-- mesmo padrão do resumo_rede) dispara processar-documento à toa: custo real de embedding da
-- OpenAI + chunks mortos em chunks_documentos (nenhum p_tipos de buscar_chunks_similares inclui
-- 'servicos_rede', igual já valia pra 'resumo_rede') — mesmo incidente já ocorrido em produção,
-- reproduzido pra um tipo novo se esta migration não for aplicada.

CREATE OR REPLACE FUNCTION public.trigger_indexar_documento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.tipo IN ('resumo_rede', 'servicos_rede') THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://svzkrkfzpiqcesloukgb.supabase.co/functions/v1/processar-documento',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT get_anon_key())
    ),
    body := jsonb_build_object(
      'documento_id', NEW.id
    )
  );

  RETURN NEW;
END;
$function$;
