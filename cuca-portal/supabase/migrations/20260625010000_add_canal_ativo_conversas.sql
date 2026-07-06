-- S-WM-03 Task 3: feature flag por conversa
ALTER TABLE conversas
    ADD COLUMN IF NOT EXISTS canal_ativo varchar NOT NULL DEFAULT 'uazapi';
