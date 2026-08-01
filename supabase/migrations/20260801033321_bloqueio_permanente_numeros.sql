-- Bloqueio permanente por telefone, independente do ciclo de vida de `leads`.
--
-- Contexto (investigacao 2026-08-01): o lead da WEBLOCACAO - MKL IT SOLUTIONS
-- (5511959803879) ja tinha sido excluido definitivamente uma vez
-- (20260731194138_exclui_definitivamente_lead_numero_comercial_weblocacao.sql),
-- mas como leads.bloqueado mora na propria linha de `leads`, a exclusao completa
-- fez o bloqueio desaparecer junto -- na proxima mensagem desse numero (bot de
-- atendimento automatico deles, nao um lead real), o worker recria o lead do
-- zero com bloqueado=false por padrao. Este numero permanente vive numa tabela
-- separada, checada ANTES do upsert de leads (worker/meta_adapter_inbound.py),
-- entao sobrevive a qualquer DELETE futuro em `leads`.
--
-- Idempotente: CREATE TABLE IF NOT EXISTS + ON CONFLICT DO NOTHING, seguro pra
-- reexecutar.

CREATE TABLE IF NOT EXISTS numeros_bloqueados_permanente (
    telefone   text PRIMARY KEY,
    motivo     text,
    bloqueado_por text,
    criado_em  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE numeros_bloqueados_permanente ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS super_admin_numeros_bloqueados_all ON numeros_bloqueados_permanente;
CREATE POLICY super_admin_numeros_bloqueados_all
ON numeros_bloqueados_permanente
FOR ALL
USING (
    EXISTS (
        SELECT 1 FROM colaboradores c JOIN sys_roles r ON r.id = c.role_id
        WHERE c.user_id = auth.uid() AND r.name IN ('Developer', 'Super Admin Cuca')
    )
)
WITH CHECK (
    EXISTS (
        SELECT 1 FROM colaboradores c JOIN sys_roles r ON r.id = c.role_id
        WHERE c.user_id = auth.uid() AND r.name IN ('Developer', 'Super Admin Cuca')
    )
);

INSERT INTO numeros_bloqueados_permanente (telefone, motivo, bloqueado_por)
VALUES (
    '5511959803879',
    'WEBLOCACAO - MKL IT SOLUTIONS: numero comercial com atendente automatico proprio, recria lead repetidamente apos exclusao. Bloqueio definitivo a pedido do Junior (2026-08-01).',
    'Junior'
)
ON CONFLICT (telefone) DO NOTHING;

-- Belt-and-suspenders: se o lead atual (recriado hoje) ainda existir, marca
-- bloqueado=true nele tambem, pro efeito ser imediato sem esperar por uma
-- proxima mensagem do numero.
UPDATE leads SET bloqueado = true, updated_at = now()
WHERE telefone = '5511959803879' AND bloqueado = false;
