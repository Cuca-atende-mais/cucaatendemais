-- S-PROG-12 item 3a (complemento) — módulo técnico Developer só para as duas contas.
-- Decisão do Junior (2026-09-12): o que é exclusivo de valmir@cucateste.com e
-- dev.cucaatendemais@gmail.com é o módulo técnico Developer; o resto dos perfis é escolha da Rede Cuca.
--
-- Achados em produção (2026-09-12):
--   - reset_automation_memory() apaga TODAS as mensagens, conversas e logs_webhook e estava executável
--     por anon e authenticated (RPC pública). A migration original (20260326) só dava a service_role.
--   - system_config (ALL) e ai_usage_logs (SELECT) são liberados por has_permission('developer', ...),
--     que o perfil "Super Admin Cuca" passava por nome.
-- Idempotente.

-- ─── 1. Reset de memória: só service_role (a rota do portal usa a chave de serviço) ───
REVOKE EXECUTE ON FUNCTION public.reset_automation_memory() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reset_automation_memory() FROM anon;
REVOKE EXECUTE ON FUNCTION public.reset_automation_memory() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.reset_automation_memory() TO service_role;

-- ─── 2. has_permission: recursos 'developer*' só para is_developer() ───
-- Corpo idêntico ao aplicado em 20260912225207; única mudança é o bloco "Módulo técnico".
CREATE OR REPLACE FUNCTION public.has_permission(p_recurso character varying, p_acao character varying)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_role_name   VARCHAR;
  v_role_id     UUID;
  v_old_ok      BOOLEAN;
  v_new_ok      BOOLEAN;
BEGIN
  -- 1. Developer bypass total
  IF public.is_developer() THEN
    RETURN TRUE;
  END IF;

  -- Módulo técnico: exclusivo das contas Developer, nenhum perfil concede
  IF p_recurso LIKE 'developer%' THEN
    RETURN FALSE;
  END IF;

  -- 3. Super Admin via sistema novo (sys_roles)
  SELECT sr.name INTO v_role_name
  FROM colaboradores c
  JOIN sys_roles sr ON c.role_id = sr.id
  WHERE c.user_id = auth.uid();

  IF v_role_name = 'Super Admin Cuca' THEN
    RETURN TRUE;
  END IF;

  -- 4. Checagem no sistema ANTIGO (funcoes_permissoes)
  SELECT EXISTS (
    SELECT 1
    FROM colaboradores c
    JOIN funcoes_permissoes fp ON fp.funcao_id = c.funcao_id
    JOIN permissoes p ON p.id = fp.permissao_id
    WHERE c.user_id = auth.uid()
      AND p.recurso = p_recurso
      AND (p.acao = p_acao OR p.acao = '*')
  ) INTO v_old_ok;

  IF COALESCE(v_old_ok, FALSE) THEN
    RETURN TRUE;
  END IF;

  -- 5. Checagem no sistema NOVO (sys_permissions)
  -- Mapeia: acao 'create'→can_create, 'read'→can_read, 'update'→can_update, 'delete'→can_delete
  -- Mapeia: recurso 'programacao' → modules programacao_mensal, programacao_pontual, etc.
  SELECT c.role_id INTO v_role_id
  FROM colaboradores c
  WHERE c.user_id = auth.uid();

  IF v_role_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM sys_permissions sp
    WHERE sp.role_id = v_role_id
      AND sp.module LIKE p_recurso || '%'
      AND CASE p_acao
            WHEN 'create' THEN sp.can_create
            WHEN 'read'   THEN sp.can_read
            WHEN 'update' THEN sp.can_update
            WHEN 'delete' THEN sp.can_delete
            ELSE FALSE
          END = TRUE
  ) INTO v_new_ok;

  RETURN COALESCE(v_new_ok, FALSE);
END;
$function$;
