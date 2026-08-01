-- S-WM-62: atualiza phone_number_ids dos 3 templates ativos de Empregabilidade
-- (empregabilidade_convite_entrevista_v1, empregabilidade_feedback_empresa_v1,
-- empregabilidade_transbordo_v1), que apontavam para o phone_number_id antigo
-- (1245704551949387) em vez do ativo real hoje (1222392144295329, confirmado por trafego
-- real: conversas de Empregabilidade de 2026-07-31 usam esse origem_id com sucesso).
--
-- Mesma classe de bug ja corrigida para o canal Institucional nesta sessao (ver
-- supabase/migrations/20260731140551_fix_meta_templates_institucional_phone_number_id.sql).
-- waba_id nao muda (1524581392742603, sem evidencia de ter mudado -- diferente do Institucional,
-- onde so a WABA mudou; aqui so o phone_number_id mudou).
--
-- Reconfirmado (Task 0, S-WM-62) imediatamente antes de aplicar: phone_number_id ativo em
-- meta_phone_numbers para agente_tipo='Empregabilidade' continua 1222392144295329.
--
-- Idempotente: UPDATE chaveado por nome + ativo, seguro para reexecutar.

UPDATE meta_templates
SET phone_number_ids = ARRAY['1222392144295329']
WHERE nome IN ('empregabilidade_convite_entrevista_v1','empregabilidade_feedback_empresa_v1','empregabilidade_transbordo_v1')
  AND ativo = true;
