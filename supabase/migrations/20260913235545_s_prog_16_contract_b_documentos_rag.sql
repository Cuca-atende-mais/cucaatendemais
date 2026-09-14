-- S-PROG-16 (contract B): documentos do assistente (`documentos_rag`, `chunks_documentos`) deixam de
-- aceitar gravação pela API de quem não é Developer.
-- Aplicado em produção em 2026-09-13 (versão no nome do arquivo), após merge + redeploy do `portal`, deploy da `gerar-resumo-rede` (v3) e do contract A.
-- Idempotente.
--
-- Quem continua gravando: chave de serviço (rotas /api/rag-global/**, Divulgação, Edge Functions, worker),
-- funções SECURITY DEFINER (gatilhos de indexação, ativação de mês, busca de chunks) e contas Developer
-- (página developer/base-conhecimento, pelo navegador). Por isso `authenticated` mantém os privilégios
-- de tabela e a trava fica na regra.

-- 0. Reespelha a base global para perfis salvos na tela antiga (mesmo bloco da migration 20260913222009).
WITH mapa(module, origem) AS (
  VALUES
    ('pgr_ver', 'read'),
    ('pgr_cadastrar', 'create'),
    ('pgr_editar', 'update'),
    ('pgr_ativar', 'update'),
    ('pgr_excluir', 'delete'),
    ('pgr_reindexar', 'update'),
    ('pgr_gerar_resumo', 'update')
),
elegiveis AS (
  SELECT sp.role_id, sp.can_read, sp.can_create, sp.can_update, sp.can_delete
  FROM public.sys_permissions sp
  WHERE sp.module = 'programacao_rag_global'
    AND NOT EXISTS (
      SELECT 1 FROM public.sys_permissions x WHERE x.role_id = sp.role_id AND x.module LIKE 'pgr\_%'
    )
)
INSERT INTO public.sys_permissions (role_id, module, can_read, can_create, can_update, can_delete)
SELECT e.role_id, m.module,
  CASE m.origem
    WHEN 'read' THEN COALESCE(e.can_read, FALSE)
    WHEN 'create' THEN COALESCE(e.can_create, FALSE)
    WHEN 'update' THEN COALESCE(e.can_update, FALSE)
    WHEN 'delete' THEN COALESCE(e.can_delete, FALSE)
    ELSE FALSE
  END,
  FALSE, FALSE, FALSE
FROM elegiveis e
CROSS JOIN mapa m
ON CONFLICT (role_id, module) DO NOTHING;

-- 1. Regras antigas (`programacao_rag_global` por prefixo, sem olhar o tipo; `ae_rag` é resto: a Academia
-- Enem usa `ae_documentos_rag`).
DROP POLICY IF EXISTS "documentos_rag: leitura com permissao rag" ON public.documentos_rag;
DROP POLICY IF EXISTS "documentos_rag: criacao com permissao rag" ON public.documentos_rag;
DROP POLICY IF EXISTS "documentos_rag: atualizacao com permissao rag" ON public.documentos_rag;
DROP POLICY IF EXISTS "documentos_rag: delecao com permissao rag" ON public.documentos_rag;
DROP POLICY IF EXISTS "chunks_documentos: leitura com permissao rag" ON public.chunks_documentos;
DROP POLICY IF EXISTS "chunks_documentos: criacao com permissao rag" ON public.chunks_documentos;
DROP POLICY IF EXISTS "chunks_documentos: atualizacao com permissao rag" ON public.chunks_documentos;
DROP POLICY IF EXISTS "chunks_documentos: delecao com permissao rag" ON public.chunks_documentos;

DROP POLICY IF EXISTS documentos_rag_leitura ON public.documentos_rag;
DROP POLICY IF EXISTS documentos_rag_gravacao_developer ON public.documentos_rag;
DROP POLICY IF EXISTS chunks_documentos_leitura ON public.chunks_documentos;
DROP POLICY IF EXISTS chunks_documentos_gravacao_developer ON public.chunks_documentos;

-- 2. Leitura: Developer ou "Ver base global".
CREATE POLICY documentos_rag_leitura ON public.documentos_rag
    FOR SELECT TO authenticated
    USING (public.is_developer() OR public.has_permission_exata('pgr_ver', 'read'));
CREATE POLICY chunks_documentos_leitura ON public.chunks_documentos
    FOR SELECT TO authenticated
    USING (public.is_developer() OR public.has_permission_exata('pgr_ver', 'read'));

-- 3. Gravação pela API: só Developer.
CREATE POLICY documentos_rag_gravacao_developer ON public.documentos_rag
    FOR ALL TO authenticated
    USING (public.is_developer())
    WITH CHECK (public.is_developer());
CREATE POLICY chunks_documentos_gravacao_developer ON public.chunks_documentos
    FOR ALL TO authenticated
    USING (public.is_developer())
    WITH CHECK (public.is_developer());

-- 4. Anônimo não lê nem grava; ninguém trunca (TRUNCATE não passa pela regra).
REVOKE ALL ON public.documentos_rag FROM anon;
REVOKE ALL ON public.chunks_documentos FROM anon;
REVOKE TRUNCATE ON public.documentos_rag FROM authenticated;
REVOKE TRUNCATE ON public.chunks_documentos FROM authenticated;
