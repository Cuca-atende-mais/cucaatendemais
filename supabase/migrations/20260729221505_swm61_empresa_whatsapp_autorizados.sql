-- SEC-01 v2 (Junior, 2026-07-29): substitui a ideia original de 1 coluna
-- whatsapp_verificado por uma lista de números autorizados por empresa —
-- suporta múltiplos números legítimos (ex.: dono + RH) e guarda quem
-- autorizou cada um (NULL = vínculo automático no 1º contato; e-mail/nome
-- do colaborador = autorizado manualmente após transbordo).
-- Plano 001 da Auditoria de Empregabilidade (2026-07-29) — story S-EMP-AUD-001.
CREATE TABLE IF NOT EXISTS public.empresa_whatsapp_autorizados (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    telefone character varying NOT NULL,
    autorizado_em timestamptz NOT NULL DEFAULT now(),
    autorizado_por character varying,
    UNIQUE (empresa_id, telefone)
);

CREATE INDEX IF NOT EXISTS empresa_whatsapp_autorizados_empresa_id_idx
    ON public.empresa_whatsapp_autorizados (empresa_id);

-- RLS: mesmo padrão de leitura já usado em `empresas` (has_permission via
-- sys_permissions/funcoes_permissoes) — a tabela guarda a própria lista de
-- autorização de segurança, não pode ficar com RLS desabilitada (baseline do
-- projeto: empresas e candidaturas já têm rowsecurity = true). Sem policy de
-- INSERT/UPDATE/DELETE: só o worker (service_role, que bypassa RLS) e o
-- endpoint novo do portal (Step 3/5, também service_role) escrevem nesta
-- tabela — deny-by-default para clientes autenticados diretos é o
-- comportamento correto aqui.
ALTER TABLE public.empresa_whatsapp_autorizados ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Leitura de números autorizados baseada em permissões"
    ON public.empresa_whatsapp_autorizados;
CREATE POLICY "Leitura de números autorizados baseada em permissões"
    ON public.empresa_whatsapp_autorizados
    FOR SELECT
    USING (has_permission('empreg_vagas', 'read'));
