-- SQS-41 Task 1: Campos de roteamento para Unificação Multi-Tenant Rede CUCA
-- Transição Single-Tenant → Multi-Tenant Global (instância empregoredecuca)

-- 1.1 Coluna unidade_destino na tabela vagas
-- Valores válidos: UUID de uma das 5 unidades CUCA ou 'global' (Toda a Rede)
ALTER TABLE public.vagas
ADD COLUMN IF NOT EXISTS unidade_destino VARCHAR(100) DEFAULT 'global';

COMMENT ON COLUMN public.vagas.unidade_destino IS
  'Roteamento multi-tenant: UUID da unidade CUCA responsável pelo atendimento da vaga, ou ''global'' para toda a Rede CUCA.';

-- 1.2 Coluna unidade_atendimento_id na tabela candidaturas
-- Armazena qual unidade CUCA atendeu/atende o candidato nesta candidatura
ALTER TABLE public.candidaturas
ADD COLUMN IF NOT EXISTS unidade_atendimento_id VARCHAR(100);

COMMENT ON COLUMN public.candidaturas.unidade_atendimento_id IS
  'UUID da unidade CUCA que está atendendo este candidato. Preenchido pelo bot quando candidato escolhe unidade em vagas globais.';

-- Índices para performance de roteamento e agrupamento
CREATE INDEX IF NOT EXISTS idx_vagas_unidade_destino
  ON public.vagas(unidade_destino);

CREATE INDEX IF NOT EXISTS idx_candidaturas_unidade_atendimento
  ON public.candidaturas(unidade_atendimento_id);
