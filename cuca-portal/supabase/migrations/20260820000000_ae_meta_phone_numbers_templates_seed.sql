-- S-AE-02 — Cadastro do número/WABA e templates da Academia Enem em meta_phone_numbers/meta_templates.
--
-- NÃO EXECUTAR AINDA: os valores de phone_number_id/waba_id abaixo são PLACEHOLDER — só existem de
-- verdade após o pareamento do número na conta Meta da Academia Enem (bloqueado, aguardando o
-- serviço `cuca-academia-enem` estar no ar e o webhook configurado — ver S-AE-02, seção "Passo a
-- passo"). Preencher os valores reais e remover este comentário antes de aplicar via apply_migration.
--
-- Idempotente (ON CONFLICT DO NOTHING) e aditivo — não altera nenhuma linha existente de
-- Institucional (1233832826470497) / Empregabilidade (1245704551949387).

INSERT INTO public.meta_phone_numbers
  (phone_number_id, waba_id, agente_tipo, canal_tipo, unidade_cuca, display_name, ativo)
VALUES
  ('SUBSTITUIR_PHONE_NUMBER_ID', 'SUBSTITUIR_WABA_ID', 'academia_enem', 'academia_enem', NULL, 'CUCA Academia Enem', true)
ON CONFLICT (phone_number_id) DO NOTHING;

-- Templates da Academia Enem — status 'pendente' até a Meta aprovar. Ajustar nome/corpo/variáveis
-- conforme os templates reais submetidos (ver S-AE-09 para o ciclo de submissão via IA validadora).
INSERT INTO public.meta_templates
  (nome, categoria, status, automacoes, phone_number_ids, waba_ids, corpo_texto, variaveis, observacoes, ativo)
VALUES
  ('academia_enem_transbordo_v1', 'UTILITY', 'pendente',
   ARRAY['Academia Enem', 'Transbordo'], ARRAY['SUBSTITUIR_PHONE_NUMBER_ID'], ARRAY['SUBSTITUIR_WABA_ID'],
   'Olá {{1}}, o jovem {{2}} solicitou atendimento humano no canal Academia Enem. Acesse o portal para assumir a conversa.',
   '[{"posicao":1,"descricao":"colaborador"},{"posicao":2,"descricao":"lead"}]'::jsonb,
   'Notificação de transbordo — canal Academia Enem (S-AE-06). Placeholder: submeter à Meta antes de marcar aprovado.', true)
ON CONFLICT (nome) WHERE ativo = true DO NOTHING;
