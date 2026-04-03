-- S37A-06: Adiciona colunas demográficas em talent_bank e candidaturas
-- Todas as colunas são nullable para não quebrar registros legados.

ALTER TABLE talent_bank
    ADD COLUMN IF NOT EXISTS escolaridade_normalizada text,
    ADD COLUMN IF NOT EXISTS genero                   text,
    ADD COLUMN IF NOT EXISTS bairro                   text,
    ADD COLUMN IF NOT EXISTS pcd                      boolean,
    ADD COLUMN IF NOT EXISTS pcd_tipo                 text,
    ADD COLUMN IF NOT EXISTS primeiro_emprego         boolean,
    ADD COLUMN IF NOT EXISTS experiencia_meses        integer;

ALTER TABLE candidaturas
    ADD COLUMN IF NOT EXISTS escolaridade_normalizada text,
    ADD COLUMN IF NOT EXISTS genero                   text,
    ADD COLUMN IF NOT EXISTS bairro                   text,
    ADD COLUMN IF NOT EXISTS pcd                      boolean,
    ADD COLUMN IF NOT EXISTS pcd_tipo                 text,
    ADD COLUMN IF NOT EXISTS primeiro_emprego         boolean,
    ADD COLUMN IF NOT EXISTS experiencia_meses        integer;
