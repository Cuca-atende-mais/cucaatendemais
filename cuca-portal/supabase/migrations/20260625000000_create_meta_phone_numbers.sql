-- S-WM-03 Task 2: criar tabela de mapeamento phone_number_id → agente/canal
CREATE TABLE IF NOT EXISTS meta_phone_numbers (
    phone_number_id  varchar        NOT NULL,
    waba_id          varchar        NOT NULL,
    agente_tipo      varchar        NOT NULL,
    canal_tipo       varchar        NOT NULL,
    unidade_cuca     varchar,
    display_name     varchar,
    ativo            boolean        NOT NULL DEFAULT true,
    created_at       timestamptz    NOT NULL DEFAULT now(),
    updated_at       timestamptz    NOT NULL DEFAULT now(),
    CONSTRAINT meta_phone_numbers_pkey PRIMARY KEY (phone_number_id)
);

ALTER TABLE meta_phone_numbers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON meta_phone_numbers;
CREATE POLICY "service_role full access" ON meta_phone_numbers
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated read" ON meta_phone_numbers;
CREATE POLICY "authenticated read" ON meta_phone_numbers
    FOR SELECT TO authenticated USING (true);

-- Seed: WABA de teste (dados confirmados 2026-06-25)
INSERT INTO meta_phone_numbers
    (phone_number_id, waba_id, agente_tipo, canal_tipo, display_name)
VALUES
    ('1215172285010519', '27334860332820469', 'Empregabilidade', 'Empregabilidade', 'Test WhatsApp Business Account')
ON CONFLICT (phone_number_id) DO NOTHING;
