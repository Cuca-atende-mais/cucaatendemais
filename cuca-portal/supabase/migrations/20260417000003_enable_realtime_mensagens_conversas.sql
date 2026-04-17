-- SQS-45: Habilitar Realtime para mensagens e conversas
-- Sem isso o portal não recebe eventos em tempo real (requer F5 para atualizar)
ALTER PUBLICATION supabase_realtime ADD TABLE public.mensagens;
ALTER PUBLICATION supabase_realtime ADD TABLE public.conversas;
