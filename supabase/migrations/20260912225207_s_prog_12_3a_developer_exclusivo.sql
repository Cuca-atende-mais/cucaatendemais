-- S-PROG-12 item 3a (URGENTE) — Developer e concessão de permissão só para as duas contas.
-- Decisão do Junior (2026-09-12): somente valmir@cucateste.com e dev.cucaatendemais@gmail.com.
--
-- Efeito medido antes de aplicar (produção, 2026-09-12):
--   - is_developer(): muda o resultado só para sec@cucateste.com (perde) e dev.cucaatendemais@gmail.com
--     (ganha; hoje não tem linha em colaboradores). Nenhuma outra conta muda.
--   - has_permission: perfil "Developer" só tinha valmir@ e sec@; função "super_admin" não tinha ninguém.
--   - sys_roles/sys_permissions: valmirmoreirajunior@gmail.com (Super Admin Cuca) perde a escrita.
--   - funcoes/funcoes_permissoes/permissoes: escrita deixa de ser aberta a qualquer usuário logado.
-- Idempotente: CREATE OR REPLACE e DROP POLICY IF EXISTS.

-- ─── 1. is_developer(): e-mail da conta de autenticação, sem depender de colaboradores ───
CREATE OR REPLACE FUNCTION public.is_developer()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = auth.uid()
      AND lower(u.email) IN ('valmir@cucateste.com', 'dev.cucaatendemais@gmail.com')
  );
END;
$function$;

-- ─── 2. has_permission: nome de perfil "Developer"/"super_admin" deixa de ser passe livre ───
-- Corpo copiado de pg_get_functiondef (produção). Mudanças: passo 2 removido (função super_admin do
-- sistema antigo) e 'super_admin'/'Developer' fora da lista do passo 3. O Developer real já passa no
-- passo 1. "Super Admin Cuca" mantém o acesso a dados (decisão do Junior). Prefixo do passo 5 inalterado.
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

-- ─── 3. pode_gerenciar_funcao: Developer decide antes de exigir funcao_id ───
-- Corpo copiado de produção; única mudança é a ordem (dev.cucaatendemais não tem colaborador).
CREATE OR REPLACE FUNCTION public.pode_gerenciar_funcao(p_funcao_id uuid, p_unidade text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
DECLARE
  v_my_level INT;
  v_target_level INT;
  v_my_unit TEXT;
BEGIN
  -- Developer é Deus no sistema
  IF public.is_developer() THEN RETURN TRUE; END IF;

  -- 1. Identificar quem eu sou
  SELECT f.nivel_acesso, c.unidade_cuca
  INTO v_my_level, v_my_unit
  FROM colaboradores c
  JOIN funcoes f ON c.funcao_id = f.id
  WHERE c.user_id = auth.uid();

  -- Se eu não existir ou não estiver logado
  IF v_my_level IS NULL THEN RETURN FALSE; END IF;

  -- 2. Nível do alvo
  SELECT nivel_acesso INTO v_target_level FROM funcoes WHERE id = p_funcao_id;

  -- 3. Trava Hierárquica: Meu nível deve ser estritamente maior
  IF v_my_level <= v_target_level THEN RETURN FALSE; END IF;

  -- 4. Trava Regional:
  IF v_my_unit IS NULL OR v_my_unit = 'Geral' THEN RETURN TRUE; END IF;

  RETURN v_my_unit = p_unidade;
END;
$function$;

-- ─── 4. Perfis e permissões: escrita só pelas duas contas ───
DROP POLICY IF EXISTS "sys_roles: escrita para admin" ON public.sys_roles;
DROP POLICY IF EXISTS "sys_roles: update para admin" ON public.sys_roles;
DROP POLICY IF EXISTS "sys_roles: delete para admin" ON public.sys_roles;
CREATE POLICY "sys_roles: escrita para admin" ON public.sys_roles FOR INSERT WITH CHECK (public.is_developer());
CREATE POLICY "sys_roles: update para admin" ON public.sys_roles FOR UPDATE USING (public.is_developer()) WITH CHECK (public.is_developer());
CREATE POLICY "sys_roles: delete para admin" ON public.sys_roles FOR DELETE USING (public.is_developer());

DROP POLICY IF EXISTS "sys_permissions: escrita para admin" ON public.sys_permissions;
DROP POLICY IF EXISTS "sys_permissions: update para admin" ON public.sys_permissions;
DROP POLICY IF EXISTS "sys_permissions: delete para admin" ON public.sys_permissions;
CREATE POLICY "sys_permissions: escrita para admin" ON public.sys_permissions FOR INSERT WITH CHECK (public.is_developer());
CREATE POLICY "sys_permissions: update para admin" ON public.sys_permissions FOR UPDATE USING (public.is_developer()) WITH CHECK (public.is_developer());
CREATE POLICY "sys_permissions: delete para admin" ON public.sys_permissions FOR DELETE USING (public.is_developer());

-- ─── 5. Sistema antigo: leitura para logados, escrita só pelas duas contas ───
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['funcoes', 'funcoes_permissoes', 'permissoes'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS acesso_autenticado ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS leitura_autenticado ON public.%I', t);
    EXECUTE format('DROP POLICY IF EXISTS escrita_developer ON public.%I', t);
    EXECUTE format('CREATE POLICY leitura_autenticado ON public.%I FOR SELECT USING (auth.uid() IS NOT NULL)', t);
    EXECUTE format('CREATE POLICY escrita_developer ON public.%I FOR ALL USING (public.is_developer()) WITH CHECK (public.is_developer())', t);
  END LOOP;
END $$;

-- ─── 6. sec@cucateste.com deixa de ser Developer (fica sem perfil até o Junior atribuir) ───
UPDATE public.colaboradores
SET role_id = NULL, funcao_id = NULL, updated_at = NOW()
WHERE lower(email) = 'sec@cucateste.com'
  AND (role_id IS NOT NULL OR funcao_id IS NOT NULL);
