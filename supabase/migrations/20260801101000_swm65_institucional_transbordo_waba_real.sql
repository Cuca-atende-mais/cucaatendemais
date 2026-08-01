-- S-WM-65: atualiza institucional_transbordo_v1 para a WABA real do numero
-- institucional novo.
--
-- Confirmado via Graph API real em 2026-08-01:
-- GET /1035278895899806/message_templates?name=institucional_transbordo_v1
--   name=institucional_transbordo_v1
--   status=APPROVED
--   Meta template_id=1529393162293040
--   category=UTILITY
--   parameter_format=NAMED
--   body="Ola {{colaborador}}, o cidadao {{lead}} solicitou atendimento humano
--         no canal {{canal}}. Acesse o portal para assumir a conversa."
--
-- Nome preservado, portanto a decisao da story e UPDATE direto do registro ativo
-- existente em meta_templates (sem criar _v2).

UPDATE meta_templates
SET
  categoria = 'UTILITY',
  status = 'aprovado',
  variaveis = '[{"posicao":1,"descricao":"colaborador"},{"posicao":2,"descricao":"lead"},{"posicao":3,"descricao":"canal"}]'::jsonb,
  automacoes = ARRAY['Institucional', 'Transbordo'],
  waba_ids = ARRAY['1035278895899806'],
  phone_number_ids = ARRAY['1291080677418758'],
  ativo = true,
  parameter_format = 'NAMED',
  corpo_texto = 'Olá {{colaborador}}, o cidadão {{lead}} solicitou atendimento humano no canal {{canal}}. Acesse o portal para assumir a conversa.',
  corpo_texto_aprovado = 'Olá {{colaborador}}, o cidadão {{lead}} solicitou atendimento humano no canal {{canal}}. Acesse o portal para assumir a conversa.',
  observacoes = 'Meta template_id=1529393162293040 (confirmado APPROVED via Graph API 2026-08-01 na WABA real 1035278895899806). Usado por _notificar_transbordo (worker/meta_adapter_inbound.py).'
WHERE nome = 'institucional_transbordo_v1'
  AND ativo = true;

INSERT INTO meta_templates (
  nome, categoria, status, variaveis, automacoes, waba_ids, phone_number_ids,
  ativo, parameter_format, corpo_texto, corpo_texto_aprovado, observacoes
)
SELECT
  'institucional_transbordo_v1',
  'UTILITY',
  'aprovado',
  '[{"posicao":1,"descricao":"colaborador"},{"posicao":2,"descricao":"lead"},{"posicao":3,"descricao":"canal"}]'::jsonb,
  ARRAY['Institucional', 'Transbordo'],
  ARRAY['1035278895899806'],
  ARRAY['1291080677418758'],
  true,
  'NAMED',
  'Olá {{colaborador}}, o cidadão {{lead}} solicitou atendimento humano no canal {{canal}}. Acesse o portal para assumir a conversa.',
  'Olá {{colaborador}}, o cidadão {{lead}} solicitou atendimento humano no canal {{canal}}. Acesse o portal para assumir a conversa.',
  'Meta template_id=1529393162293040 (confirmado APPROVED via Graph API 2026-08-01 na WABA real 1035278895899806). Usado por _notificar_transbordo (worker/meta_adapter_inbound.py).'
WHERE NOT EXISTS (
  SELECT 1 FROM meta_templates
  WHERE nome = 'institucional_transbordo_v1'
    AND ativo = true
);
