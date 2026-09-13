-- S-PROG-16 (expand) — Divulgação e Base de Conhecimento Global: opções próprias.
-- Compatível com o portal antigo: nada aqui restringe gravação nem tira leitura. Idempotente.
--
-- Só preenche perfis que ainda NÃO têm a linha nova: pode ser rodada de novo sem desfazer escolhas feitas
-- na tela de Perfis. A tela antiga (antes do redeploy) apaga e regrava só os módulos que conhece; um perfil
-- salvo nela perde as linhas novas e volta a ser elegível. O contrato roda este espelhamento de novo.

-- 1. "Ver Divulgação" para quem via a página antes: módulo `divulgacao` (ler) ou uma das duas opções
-- (mesma regra de `espelharVerDivulgacao` em cuca-portal/src/lib/rbac/catalogo-divulgacao-rag-global.ts).
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

-- 2. Base global a partir de `programacao_rag_global`
-- (mesma equivalência de `ORIGEM_ESPELHAMENTO_RAG_GLOBAL`):
--   can_read   -> pgr_ver
--   can_create -> pgr_cadastrar
--   can_update -> pgr_editar, pgr_ativar, pgr_reindexar, pgr_gerar_resumo
--   can_delete -> pgr_excluir
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

-- 3. Leitura das campanhas mensais: aceita "Ver Divulgação" junto do módulo antigo (o contrato tira o antigo).
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
        OR public.has_permission_exata('divulgacao', 'read')
        OR EXISTS (
            SELECT 1 FROM unnest(ARRAY['ESPORTES', 'CURSOS', 'DIA A DIA', 'ESPECIAIS']) AS c(nome)
            WHERE public.pgm_pode_categoria(c.nome, 'read')
        );
END;
$function$;

REVOKE ALL ON FUNCTION public.pgm_pode_ler_campanhas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pgm_pode_ler_campanhas() TO authenticated, service_role;
