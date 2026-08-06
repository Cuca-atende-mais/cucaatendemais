-- ============================================================================
-- Fecha exposição anon em `audit_logs` e `vagas_feedback_tokens`
-- ============================================================================
--
-- Achados da varredura feita logo após fechar `curriculos` (ver
-- 20260805200554_curriculos_rls_rbac_fecha_exposicao_anon.sql e
-- docs/qa/DIAGNOSTICO-exposicao-anon-curriculos-2026-08-05.md).
--
-- 1) audit_logs — a policy se chamava "Leitura de audit logs para super_admins",
--    mas a expressão era `true` para PUBLIC: o nome prometia uma restrição que a
--    policy não aplicava. Qualquer anônimo lia a trilha de auditoria inteira,
--    incluindo `usuario_id` e snapshots completos de linha (`dados_antigos` /
--    `dados_novos`) — hoje cobrindo `espacos_cuca` e `ouvidoria_eventos`.
--    Verificado: NENHUM código do portal lê `audit_logs` (grep em cuca-portal/src),
--    então restringir tem zero risco de quebra.
--
-- 2) vagas_feedback_tokens — anon podia LISTAR todos os tokens válidos, o que
--    permitiria enviar feedback se passando por qualquer empresa (bypass de
--    autenticação do fluxo). Verificado: os 4 consumidores reais são API routes
--    que usam `createAdminClient` (service_role), o qual ignora RLS por completo —
--    nenhum dependia desta policy. Removida sem substituto para anon.
--
-- NOTA DE PROCESSO: este arquivo foi criado APÓS a aplicação em produção (que foi
-- feita direto via MCP em 2026-08-05, versão 20260805210333). Falha apontada pelo
-- @qa: sem o arquivo, uma reconstrução do banco a partir das migrations traria as
-- duas tabelas de volta expostas. O SQL abaixo é idêntico ao que foi aplicado.
--
-- Idempotente (DROP ... IF EXISTS + CREATE).
-- ============================================================================

-- ── audit_logs: passa a fazer o que o nome sempre prometeu ──────────────────
DROP POLICY IF EXISTS audit_logs_super_admin_read ON public.audit_logs;
CREATE POLICY audit_logs_super_admin_read ON public.audit_logs
    FOR SELECT
    TO authenticated
    USING (
        public.is_developer()
        OR EXISTS (
            SELECT 1 FROM public.colaboradores c
            JOIN public.funcoes f ON f.id = c.funcao_id
            WHERE c.user_id = auth.uid() AND f.nome = 'super_admin'
        )
        OR EXISTS (
            SELECT 1 FROM public.colaboradores c
            JOIN public.sys_roles sr ON sr.id = c.role_id
            WHERE c.user_id = auth.uid()
              AND sr.name IN ('Super Admin Cuca', 'super_admin', 'Developer')
        )
    );

DROP POLICY IF EXISTS "Leitura de audit logs para super_admins" ON public.audit_logs;

-- ── vagas_feedback_tokens: remove leitura anon (consumidores usam service_role) ──
DROP POLICY IF EXISTS "Acesso público para verificação de token" ON public.vagas_feedback_tokens;
