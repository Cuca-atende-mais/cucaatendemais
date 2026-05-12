-- SQS-54: trigger function nao deve ficar exposta para chamada direta via RPC.

REVOKE EXECUTE ON FUNCTION public.trigger_indexar_vaga() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trigger_indexar_vaga() FROM anon;
REVOKE EXECUTE ON FUNCTION public.trigger_indexar_vaga() FROM authenticated;
