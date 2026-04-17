-- FIX: RLS policies com nomes de roles incorretos em tabelas de transbordo
-- Problema: policies usavam 'super_admin', 'coordenador', 'Super Admin', 'Desenvolvedor'
-- que não existem no sys_roles. Nomes reais: 'Developer', 'Super Admin Cuca', etc.

-- ── 1. human_handover_contacts ──────────────────────────────────
DROP POLICY IF EXISTS "Admins e Ops podem ver e gerenciar os contatos de transbordo"
  ON public.human_handover_contacts;

-- Roles com acesso TOTAL (leitura + escrita)
CREATE POLICY "write_roles_human_handover"
  ON public.human_handover_contacts
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.colaboradores c
      JOIN public.sys_roles r ON r.id = c.role_id
      WHERE c.user_id = auth.uid()
        AND r.name IN ('Developer', 'Super Admin Cuca', 'Auxiliar administrativo', 'Institucional')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.colaboradores c
      JOIN public.sys_roles r ON r.id = c.role_id
      WHERE c.user_id = auth.uid()
        AND r.name IN ('Developer', 'Super Admin Cuca', 'Auxiliar administrativo', 'Institucional')
    )
  );

-- Gerente: somente leitura
CREATE POLICY "gerente_read_human_handover"
  ON public.human_handover_contacts
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.colaboradores c
      JOIN public.sys_roles r ON r.id = c.role_id
      WHERE c.user_id = auth.uid()
        AND r.name = 'Gerente'
    )
  );

-- ── 2. transbordo_humano ─────────────────────────────────────────
-- Policy super_admin usava 'Super Admin' e 'Desenvolvedor' — nomes errados
DROP POLICY IF EXISTS "super_admin_transbordo_all" ON public.transbordo_humano;

CREATE POLICY "super_admin_transbordo_all"
  ON public.transbordo_humano
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.colaboradores c
      JOIN public.sys_roles r ON r.id = c.role_id
      WHERE c.user_id = auth.uid()
        AND r.name IN ('Developer', 'Super Admin Cuca')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.colaboradores c
      JOIN public.sys_roles r ON r.id = c.role_id
      WHERE c.user_id = auth.uid()
        AND r.name IN ('Developer', 'Super Admin Cuca')
    )
  );
