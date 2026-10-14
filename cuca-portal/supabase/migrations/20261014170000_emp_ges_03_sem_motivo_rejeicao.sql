-- S-EMP-GES-03: o motivo da rejeição saiu do escopo (decisão do Junior, 14/10): nem a empresa nem a equipe
-- registram motivo. A coluna nasceu no mesmo dia, nunca recebeu valor e não tem outro uso. Idempotente.
ALTER TABLE public.candidaturas DROP COLUMN IF EXISTS motivo_rejeicao;
