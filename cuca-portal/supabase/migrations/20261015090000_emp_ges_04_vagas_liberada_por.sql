-- S-EMP-GES-04 (AC11): quem liberou a vaga/seleção (primeira mudança de status para 'aberta') e quando.
-- A unidade da vaga no relatório Emprega+ é a unidade desse colaborador (decisão do Junior, 2026-10-08).
-- Aditiva e idempotente: colunas nullable; vagas antigas ficam sem valor e o relatório usa o fallback
-- (unidade de destino → unidade base → "Rede Cuca").
ALTER TABLE public.vagas ADD COLUMN IF NOT EXISTS liberada_por uuid
    REFERENCES public.colaboradores(id) ON DELETE SET NULL;
ALTER TABLE public.vagas ADD COLUMN IF NOT EXISTS liberada_em timestamptz;
