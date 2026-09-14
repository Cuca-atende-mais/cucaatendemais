-- S-PROG-16 (contract A): Divulgação deixa de consultar o módulo antigo `divulgacao`.
-- Aplicado em produção em 2026-09-13 (versão no nome do arquivo), após merge + redeploy do `portal`.
-- Idempotente.

-- 0. Reespelha "Ver Divulgação" para perfis salvos na tela antiga (mesmo bloco da migration 20260913222009).
INSERT INTO public.sys_permissions (role_id, module, can_read, can_create, can_update, can_delete)
SELECT r.id, 'pgm_divulgacao_ver',
  EXISTS (
    SELECT 1 FROM public.sys_permissions sp
    WHERE sp.role_id = r.id
      AND ((sp.module = 'divulgacao' AND sp.can_read) OR (sp.module IN ('pgm_rag_aprovar', 'pgm_disparo_global') AND sp.can_read))
  ),
  FALSE, FALSE, FALSE
FROM public.sys_roles r
WHERE EXISTS (
    SELECT 1 FROM public.sys_permissions sp
    WHERE sp.role_id = r.id AND sp.module IN ('divulgacao', 'pgm_rag_aprovar', 'pgm_disparo_global')
  )
  AND NOT EXISTS (SELECT 1 FROM public.sys_permissions x WHERE x.role_id = r.id AND x.module = 'pgm_divulgacao_ver')
ON CONFLICT (role_id, module) DO NOTHING;

-- 1. Leitura das campanhas mensais só com as opções novas.
CREATE OR REPLACE FUNCTION public.pgm_pode_ler_campanhas()
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
    RETURN public.has_permission_exata('pgm_lista', 'read')
        OR public.has_permission_exata('pgm_criar_zero', 'read')
        OR public.has_permission_exata('pgm_duplicar', 'read')
        OR public.has_permission_exata('pgm_importar_planilha', 'read')
        OR public.has_permission_exata('pgm_rag_aprovar', 'read')
        OR public.has_permission_exata('pgm_disparo_global', 'read')
        OR public.has_permission_exata('pgm_divulgacao_ver', 'read')
        OR EXISTS (
            SELECT 1 FROM unnest(ARRAY['ESPORTES', 'CURSOS', 'DIA A DIA', 'ESPECIAIS']) AS c(nome)
            WHERE public.pgm_pode_categoria(c.nome, 'read')
        );
END;
$function$;

REVOKE ALL ON FUNCTION public.pgm_pode_ler_campanhas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pgm_pode_ler_campanhas() TO authenticated, service_role;

-- 2. disparos_divulgacao: só a chave de serviço grava (rota `disparar` e worker). Leitura da página continua.
DROP POLICY IF EXISTS auth_insert_disparos_divulgacao ON public.disparos_divulgacao;
DROP POLICY IF EXISTS auth_update_disparos_divulgacao ON public.disparos_divulgacao;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.disparos_divulgacao FROM anon, authenticated;
REVOKE SELECT ON public.disparos_divulgacao FROM anon;
