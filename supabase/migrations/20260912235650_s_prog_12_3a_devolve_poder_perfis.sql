-- S-PROG-12 item 3a (ajuste) — devolve a gestão de perfis a quem tem permissão de Perfis.
-- Decisão do Junior (2026-09-12): o poder de cada perfil é escolha da Rede Cuca; quem tem
-- config_perfis cria perfis e marca permissões, inclusive dando poder total. Exclusivo das contas
-- Developer continua sendo só o módulo técnico:
--   - linhas de sys_permissions com module 'developer%' (já ignoradas por has_permission para não Developer);
--   - o perfil "Developer" (nome) e as permissões dele não são criados, alterados ou apagados por outros.
-- funcoes/funcoes_permissoes/permissoes (sistema antigo, sem uso no portal) seguem só Developer.
-- Idempotente.

CREATE OR REPLACE FUNCTION public.pode_gerir_perfil(p_acao text, p_role_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
BEGIN
  IF public.is_developer() THEN
    RETURN TRUE;
  END IF;
  IF NOT public.has_permission('config_perfis', p_acao) THEN
    RETURN FALSE;
  END IF;
  RETURN NOT EXISTS (SELECT 1 FROM public.sys_roles r WHERE r.id = p_role_id AND r.name = 'Developer');
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.pode_gerir_perfil(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pode_gerir_perfil(text, uuid) TO authenticated, service_role;

-- sys_roles
DROP POLICY IF EXISTS "sys_roles: escrita para admin" ON public.sys_roles;
DROP POLICY IF EXISTS "sys_roles: update para admin" ON public.sys_roles;
DROP POLICY IF EXISTS "sys_roles: delete para admin" ON public.sys_roles;
CREATE POLICY "sys_roles: escrita para admin" ON public.sys_roles FOR INSERT
  WITH CHECK (public.is_developer() OR (public.has_permission('config_perfis', 'create') AND name <> 'Developer'));
CREATE POLICY "sys_roles: update para admin" ON public.sys_roles FOR UPDATE
  USING (public.pode_gerir_perfil('update', id))
  WITH CHECK (public.is_developer() OR name <> 'Developer');
CREATE POLICY "sys_roles: delete para admin" ON public.sys_roles FOR DELETE
  USING (public.pode_gerir_perfil('delete', id));

-- sys_permissions (a tela de Perfis grava apagando e inserindo a matriz do perfil)
DROP POLICY IF EXISTS "sys_permissions: escrita para admin" ON public.sys_permissions;
DROP POLICY IF EXISTS "sys_permissions: update para admin" ON public.sys_permissions;
DROP POLICY IF EXISTS "sys_permissions: delete para admin" ON public.sys_permissions;
CREATE POLICY "sys_permissions: escrita para admin" ON public.sys_permissions FOR INSERT
  WITH CHECK (public.is_developer() OR (public.pode_gerir_perfil('create', role_id) AND module NOT LIKE 'developer%'));
CREATE POLICY "sys_permissions: update para admin" ON public.sys_permissions FOR UPDATE
  USING (public.is_developer() OR (public.pode_gerir_perfil('update', role_id) AND module NOT LIKE 'developer%'))
  WITH CHECK (public.is_developer() OR (public.pode_gerir_perfil('update', role_id) AND module NOT LIKE 'developer%'));
CREATE POLICY "sys_permissions: delete para admin" ON public.sys_permissions FOR DELETE
  USING (public.is_developer() OR (public.pode_gerir_perfil('delete', role_id) AND module NOT LIKE 'developer%'));
