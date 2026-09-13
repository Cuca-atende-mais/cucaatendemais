-- S-PROG-12 item 2 — checagem exata de permissão, sem comparação por prefixo.
-- Usada por tudo que as S-PROG-12 a 15 criarem (módulos `pgm_*`). Não altera has_permission.
-- Regras: contas Developer passam; módulo técnico `developer%` nunca é concedido por perfil;
-- sem passe por nome de perfil (nem "Super Admin Cuca") — vale o que está marcado na matriz.
-- Idempotente.
CREATE OR REPLACE FUNCTION public.has_permission_exata(p_recurso character varying, p_acao character varying)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_role_id UUID;
BEGIN
  IF public.is_developer() THEN
    RETURN TRUE;
  END IF;

  IF p_recurso LIKE 'developer%' THEN
    RETURN FALSE;
  END IF;

  SELECT c.role_id INTO v_role_id
  FROM colaboradores c
  WHERE c.user_id = auth.uid()
    AND COALESCE(c.ativo, TRUE);

  IF v_role_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM sys_permissions sp
    WHERE sp.role_id = v_role_id
      AND sp.module = p_recurso
      AND CASE p_acao
            WHEN 'create' THEN sp.can_create
            WHEN 'read'   THEN sp.can_read
            WHEN 'update' THEN sp.can_update
            WHEN 'delete' THEN sp.can_delete
            ELSE FALSE
          END
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.has_permission_exata(character varying, character varying) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_permission_exata(character varying, character varying) TO authenticated, service_role;
