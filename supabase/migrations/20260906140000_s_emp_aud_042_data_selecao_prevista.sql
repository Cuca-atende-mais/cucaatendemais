-- S-EMP-AUD-042: data prevista da seleção como campo bloqueante na criação de vaga.
-- Aditiva, nullable e idempotente (expand/contract) — vagas existentes ficam NULL, sem quebrar
-- nada; a exigência é de aplicação (formulário público + API + modal interno), não de banco.
ALTER TABLE vagas ADD COLUMN IF NOT EXISTS data_selecao_prevista date;
