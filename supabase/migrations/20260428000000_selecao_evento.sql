-- SQS-49: Marcar Seleção — Processo Seletivo por Evento
-- Colunas aditivas com DEFAULT seguro: nenhuma linha existente é afetada.

-- ── vagas ────────────────────────────────────────────────────────────────────
ALTER TABLE vagas
  ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'vaga_normal'
    CHECK (tipo IN ('vaga_normal', 'selecao_evento')),
  ADD COLUMN IF NOT EXISTS cargos_lista JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS datas_selecao JSONB DEFAULT NULL;

COMMENT ON COLUMN vagas.tipo IS 'vaga_normal = vaga individual padrão; selecao_evento = processo seletivo por evento com múltiplos cargos';
COMMENT ON COLUMN vagas.cargos_lista IS 'Array JSON de cargos do evento: [{titulo, quantidade}]. Usado pela IA e pelo bot WhatsApp.';
COMMENT ON COLUMN vagas.datas_selecao IS 'Array JSON de datas/horários do evento: [{data, hora}]';

-- ── candidaturas ─────────────────────────────────────────────────────────────
ALTER TABLE candidaturas
  ADD COLUMN IF NOT EXISTS cargo_escolhido TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS confirmacao_presenca TEXT DEFAULT NULL
    CHECK (confirmacao_presenca IN ('confirmado', 'recusado'));

COMMENT ON COLUMN candidaturas.cargo_escolhido IS 'Cargo específico escolhido pelo candidato dentro de uma selecao_evento';
COMMENT ON COLUMN candidaturas.confirmacao_presenca IS 'Resposta do candidato à convocação para seleção: confirmado ou recusado';

-- Índice para facilitar filtragem por cargo dentro de um evento
CREATE INDEX IF NOT EXISTS idx_candidaturas_cargo_escolhido ON candidaturas(cargo_escolhido) WHERE cargo_escolhido IS NOT NULL;
