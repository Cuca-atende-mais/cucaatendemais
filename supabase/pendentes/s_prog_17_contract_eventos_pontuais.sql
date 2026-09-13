-- S-PROG-17 (contract): eventos_pontuais só é gravada pela chave de serviço (rotas do portal e worker);
-- leitura exige "Ver eventos" (ou o painel de Acompanhamento de Envios) e a unidade.
-- NÃO APLICAR antes de: (1) merge + redeploy do `portal` com a S-PROG-17 (a tela antiga grava direto na
-- tabela e passaria a falhar). (2) confirmar no EasyPanel que o cuca-worker tem SUPABASE_SERVICE_ROLE_KEY:
-- `claim_evento_pontual` não é SECURITY DEFINER e, com a chave anônima, deixaria de achar eventos
-- `aprovado` sem erro nenhum. (Já exigido e confirmado no contrato da S-PROG-13.)
-- Ao aplicar, mover este arquivo para supabase/migrations com a versão devolvida pelo servidor.
-- Idempotente.

-- 0. Reespelha perfis que perderam as linhas `pgp_*` ao serem salvos na tela antiga de Perfis
-- (mesmo bloco da migration 20260913170146; só perfis sem nenhuma linha `pgp_*`).
WITH mapa(module, origem) AS (
  VALUES
    ('pgp_ver', 'read'), ('pgp_criar', 'create'),
    ('pgp_editar', 'update'), ('pgp_autorizar', 'update'), ('pgp_devolver', 'update'),
    ('pgp_disparar', 'update'), ('pgp_cancelar', 'update'), ('pgp_excluir', 'nenhum')
),
elegiveis AS (
  SELECT sp.role_id, sp.can_read, sp.can_create, sp.can_update
  FROM public.sys_permissions sp
  WHERE sp.module = 'programacao_pontual'
    AND NOT EXISTS (
      SELECT 1 FROM public.sys_permissions x WHERE x.role_id = sp.role_id AND x.module LIKE 'pgp\_%'
    )
)
INSERT INTO public.sys_permissions (role_id, module, can_read, can_create, can_update, can_delete)
SELECT e.role_id, m.module,
  CASE m.origem
    WHEN 'read' THEN COALESCE(e.can_read, FALSE)
    WHEN 'create' THEN COALESCE(e.can_create, FALSE)
    WHEN 'update' THEN COALESCE(e.can_update, FALSE)
    ELSE FALSE
  END,
  FALSE, FALSE, FALSE
FROM elegiveis e
CROSS JOIN mapa m
ON CONFLICT (role_id, module) DO NOTHING;

-- 1. Políticas antigas (checagem por prefixo 'programacao', sem unidade, sem checar o status novo).
DROP POLICY IF EXISTS "Eventos: Criação permitida com permissão" ON public.eventos_pontuais;
DROP POLICY IF EXISTS "Eventos: Atualização permitida com permissão" ON public.eventos_pontuais;
DROP POLICY IF EXISTS "Eventos: Deleção permitida com permissão" ON public.eventos_pontuais;
DROP POLICY IF EXISTS "Eventos: Leitura restrita por unidade ou developer" ON public.eventos_pontuais;
DROP POLICY IF EXISTS "eventos_pontuais_leitura" ON public.eventos_pontuais;

-- 2. Leitura: "Ver eventos" + unidade. `listar_disparos_acompanhamento` (SECURITY INVOKER) junta esta
-- tabela para mostrar o título do evento; quem tem o painel de Acompanhamento de Envios continua lendo,
-- senão veria "(evento removido ou desvinculado)".
CREATE POLICY "eventos_pontuais_leitura" ON public.eventos_pontuais
    FOR SELECT TO authenticated
    USING (
        public.is_developer()
        OR (
            (unidade_cuca IS NULL OR unidade_cuca::text = public.get_my_unit() OR public.get_my_unit() IS NULL)
            AND (
                public.has_permission_exata('pgp_ver', 'read')
                OR public.has_permission_exata('config_acompanhamento_envios', 'read')
            )
        )
    );

-- 3. Sem política de INSERT/UPDATE/DELETE: só a chave de serviço grava (rotas /api/programacao/pontual,
-- /api/programacao/excluir, worker). Gatilhos e funções SECURITY DEFINER não são afetados.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.eventos_pontuais FROM anon, authenticated;
REVOKE SELECT ON public.eventos_pontuais FROM anon;
