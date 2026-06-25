-- S-WM-03 Task 4: rename instancia_uazapi → origem_id (expand/contract)
-- Constraint UNIQUE real confirmada via execute_sql: conversas_lead_instancia_unique

ALTER TABLE conversas ADD COLUMN IF NOT EXISTS origem_id varchar;

UPDATE conversas SET origem_id = instancia_uazapi WHERE origem_id IS NULL;

ALTER TABLE conversas ALTER COLUMN origem_id SET NOT NULL;

ALTER TABLE conversas DROP CONSTRAINT IF EXISTS conversas_lead_instancia_unique;
ALTER TABLE conversas ADD CONSTRAINT conversas_lead_id_origem_id_key UNIQUE (lead_id, origem_id);

ALTER TABLE conversas DROP COLUMN IF EXISTS instancia_uazapi;
