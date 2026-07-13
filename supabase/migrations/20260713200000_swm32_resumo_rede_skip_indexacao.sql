-- S-WM-32: resumo_rede é carregado por inteiro (sem chunking, sem embedding) — o gatilho
-- tr_indexar_documento (trigger_indexar_documento) hoje dispara processar-documento pra
-- QUALQUER insert/update de titulo/conteudo em documentos_rag, sem distinguir tipo. Confirmado
-- em produção: o registro manual do stopgap (id=8b0b4157-7024-421d-bdc3-a7d5ec944d6a,
-- tipo='resumo_rede') já foi indevidamente chunkeado/embeddado (5 chunks com embedding) por
-- esse gatilho, mesmo sem nenhuma automação desta story ainda existir — puro efeito colateral
-- do trigger genérico. Sem esta correção, cada geração do resumo_rede (via botão do portal)
-- dispararia custo real de embeddings da OpenAI à toa, e deixaria chunks mortos no índice
-- (nunca retornados por buscar_chunks_similares, já que nenhum p_tipos usado no código inclui
-- 'resumo_rede' — mas ainda assim, custo e dado morto sem propósito).

CREATE OR REPLACE FUNCTION public.trigger_indexar_documento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.tipo = 'resumo_rede' THEN
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

-- Limpeza única: remove os chunks já gerados indevidamente para documentos resumo_rede
-- existentes (efeito do gatilho antes desta correção) — nunca são retornados em busca (nenhum
-- p_tipos inclui 'resumo_rede'), mas não há motivo pra mantê-los.
DELETE FROM public.chunks_documentos
WHERE documento_id IN (SELECT id FROM public.documentos_rag WHERE tipo = 'resumo_rede');
