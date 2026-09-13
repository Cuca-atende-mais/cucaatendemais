-- S-PROG-12 item 4 — espelha as permissões atuais de programacao_mensal nas opções `pgm_*`.
-- Ninguém perde acesso quando a S-PROG-13 trocar as checagens.
--
-- Só preenche perfis que ainda NÃO têm nenhuma linha `pgm_*`: pode ser rodada de novo sem desfazer
-- escolhas feitas na tela de Perfis. Motivo: a tela antiga (antes do redeploy) apaga e regrava só os
-- módulos que conhece; um perfil salvo nela perde as linhas `pgm_*` e volta a ser elegível aqui.
-- Rodar de novo imediatamente antes da S-PROG-13 entrar em produção.
--
-- Equivalência (mesma de `espelharPermissoes` em cuca-portal/src/lib/rbac/catalogo-programacao-mensal.ts):
--   can_read   -> pgm_lista, pgm_historico, pgm_exportar
--   can_create -> pgm_criar_zero, pgm_duplicar, pgm_importar_planilha
--   can_delete -> pgm_excluir_programacao
--   CRUD       -> pgm_<categoria>_atividades
--   can_update -> pgm_<categoria>_enviar/_autorizar/_devolver/_reabrir
--   divulgacao.can_create -> pgm_disparo_global
--   ninguém    -> pgm_rag_aprovar
-- Opção de ação única guarda o "liberado" em can_read.
WITH mapa(module, origem) AS (
  VALUES
    ('pgm_lista', 'read'), ('pgm_historico', 'read'), ('pgm_exportar', 'read'),
    ('pgm_criar_zero', 'create'), ('pgm_duplicar', 'create'), ('pgm_importar_planilha', 'create'),
    ('pgm_excluir_programacao', 'delete'),
    ('pgm_esportes_atividades', 'crud'), ('pgm_cursos_atividades', 'crud'),
    ('pgm_dia_a_dia_atividades', 'crud'), ('pgm_especiais_atividades', 'crud'),
    ('pgm_esportes_enviar', 'update'), ('pgm_esportes_autorizar', 'update'), ('pgm_esportes_devolver', 'update'), ('pgm_esportes_reabrir', 'update'),
    ('pgm_cursos_enviar', 'update'), ('pgm_cursos_autorizar', 'update'), ('pgm_cursos_devolver', 'update'), ('pgm_cursos_reabrir', 'update'),
    ('pgm_dia_a_dia_enviar', 'update'), ('pgm_dia_a_dia_autorizar', 'update'), ('pgm_dia_a_dia_devolver', 'update'), ('pgm_dia_a_dia_reabrir', 'update'),
    ('pgm_especiais_enviar', 'update'), ('pgm_especiais_autorizar', 'update'), ('pgm_especiais_devolver', 'update'), ('pgm_especiais_reabrir', 'update'),
    ('pgm_rag_aprovar', 'nenhum'),
    ('pgm_disparo_global', 'disparo')
),
elegiveis AS (
  SELECT sp.role_id, sp.can_read, sp.can_create, sp.can_update, sp.can_delete,
         COALESCE(dv.can_create, FALSE) AS div_create
  FROM public.sys_permissions sp
  LEFT JOIN public.sys_permissions dv ON dv.role_id = sp.role_id AND dv.module = 'divulgacao'
  WHERE sp.module = 'programacao_mensal'
    AND NOT EXISTS (
      SELECT 1 FROM public.sys_permissions x WHERE x.role_id = sp.role_id AND x.module LIKE 'pgm\_%'
    )
)
INSERT INTO public.sys_permissions (role_id, module, can_read, can_create, can_update, can_delete)
SELECT e.role_id, m.module,
  CASE m.origem
    WHEN 'read' THEN e.can_read
    WHEN 'create' THEN e.can_create
    WHEN 'delete' THEN e.can_delete
    WHEN 'update' THEN e.can_update
    WHEN 'crud' THEN e.can_read
    WHEN 'disparo' THEN e.div_create
    ELSE FALSE
  END,
  CASE WHEN m.origem = 'crud' THEN e.can_create ELSE FALSE END,
  CASE WHEN m.origem = 'crud' THEN e.can_update ELSE FALSE END,
  CASE WHEN m.origem = 'crud' THEN e.can_delete ELSE FALSE END
FROM elegiveis e
CROSS JOIN mapa m
ON CONFLICT (role_id, module) DO NOTHING;
