-- Seed: insere categoria 'Academia Enem' e remove eventos de teste sem data.
-- Idempotente: pode ser reaplicado sem efeito colateral.
-- Ambiente: cuca-dev (jmwokdcqxmojhvrkgpbd) — NÃO aplicar em produção manualmente.

-- #2: Garante que a categoria 'Academia Enem' existe em categorias_interesse.
-- A rota /api/academia-enem/leads depende desta entrada para funcionar.
INSERT INTO categorias_interesse (nome)
SELECT 'Academia Enem'
WHERE NOT EXISTS (
    SELECT 1 FROM categorias_interesse WHERE nome = 'Academia Enem'
);

-- #3a: Remove eventos de teste criados sem data_inicio (placeholders de seed).
-- Estes registros causam TypeError: null.split("-") na página de Programação.
-- Todos os registros afetados têm título sufixado com "(Teste)" — confirma origem de seed.
DELETE FROM eventos_pontuais
WHERE data_inicio IS NULL;
