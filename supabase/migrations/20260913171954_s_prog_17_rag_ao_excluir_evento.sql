-- S-PROG-17 — evento pontual apagado sai do RAG.
-- `tr_evento_index` roda só em INSERT/UPDATE: um evento excluído deixava o documento ativo em
-- `documentos_rag`, e o assistente continuava falando dele. Com "Excluir evento" virando opção liberável
-- (S-PROG-17), o gatilho cobre qualquer caminho de exclusão (rota do portal, SQL, Developer).
-- Não mexe nos documentos órfãos que já existem. Idempotente.
CREATE OR REPLACE FUNCTION public.trigger_desativar_rag_evento_excluido()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
BEGIN
  UPDATE public.documentos_rag
     SET ativo = false, updated_at = NOW()
   WHERE tipo = 'eventos_pontuais'
     AND metadados->>'evento_id' = OLD.id::text
     AND ativo;
  RETURN OLD;
END;
$function$;

REVOKE ALL ON FUNCTION public.trigger_desativar_rag_evento_excluido() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS tr_evento_desativar_rag_ao_excluir ON public.eventos_pontuais;
CREATE TRIGGER tr_evento_desativar_rag_ao_excluir
  AFTER DELETE ON public.eventos_pontuais
  FOR EACH ROW EXECUTE FUNCTION public.trigger_desativar_rag_evento_excluido();
