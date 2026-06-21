-- Seed: cria role 'Super Admin Cuca' com todas as permissões e vincula ao usuário de teste.
-- Idempotente: pode ser reaplicado sem efeito colateral.
-- Ambiente: cuca-dev (jmwokdcqxmojhvrkgpbd) — NÃO aplicar em produção manualmente.
-- A promoção para produção ocorre via merge main + gate humano (Junior).

DO $$
DECLARE
  v_role_id uuid;
BEGIN
  -- 1. Garante que o role existe; preserva o UUID se já existir
  SELECT id INTO v_role_id FROM sys_roles WHERE name = 'Super Admin Cuca';
  IF v_role_id IS NULL THEN
    INSERT INTO sys_roles (name, description)
    VALUES ('Super Admin Cuca', 'Acesso total ao sistema — todos os módulos')
    RETURNING id INTO v_role_id;
  END IF;

  -- 2. Insere permissões para todos os módulos do menuItems/constants.ts
  --    ON CONFLICT (role_id, module) DO NOTHING garante idempotência
  INSERT INTO sys_permissions (role_id, module, can_read, can_create, can_update, can_delete)
  VALUES
    (v_role_id, 'dashboard',                    true, true, true, true),
    (v_role_id, 'leads_overview',               true, true, true, true),
    (v_role_id, 'atendimentos_institucional',   true, true, true, true),
    (v_role_id, 'programacao_mensal',           true, true, true, true),
    (v_role_id, 'atendimentos_programacao',     true, true, true, true),
    (v_role_id, 'empreg_painel',                true, true, true, true),
    (v_role_id, 'atendimentos_empregabilidade', true, true, true, true),
    (v_role_id, 'empreg_empresas',              true, true, true, true),
    (v_role_id, 'empreg_vagas',                 true, true, true, true),
    (v_role_id, 'empreg_selecao',               true, true, true, true),
    (v_role_id, 'empreg_candidatos',            true, true, true, true),
    (v_role_id, 'empreg_banco_cv',              true, true, true, true),
    (v_role_id, 'empreg_curriculos',            true, true, true, true),
    (v_role_id, 'ae_painel',                    true, true, true, true),
    (v_role_id, 'atendimentos_academia_enem',   true, true, true, true),
    (v_role_id, 'ae_instancia',                 true, true, true, true),
    (v_role_id, 'ae_rag',                       true, true, true, true),
    (v_role_id, 'ae_presenca',                  true, true, true, true),
    (v_role_id, 'ae_kpis',                      true, true, true, true),
    (v_role_id, 'ae_leads_filtro',              true, true, true, true),
    (v_role_id, 'acesso_solicitacoes_n1',       true, true, true, true),
    (v_role_id, 'acesso_solicitacoes_n2',       true, true, true, true),
    (v_role_id, 'acesso_espacos',               true, true, true, true),
    (v_role_id, 'ouvidoria_painel',             true, true, true, true),
    (v_role_id, 'ouvidoria_eventos',            true, true, true, true),
    (v_role_id, 'divulgacao',                   true, true, true, true),
    (v_role_id, 'config_whatsapp',              true, true, true, true),
    (v_role_id, 'config_colaboradores',         true, true, true, true),
    (v_role_id, 'config_perfis',               true, true, true, true),
    (v_role_id, 'config_unidades',              true, true, true, true),
    (v_role_id, 'config_categorias',            true, true, true, true),
    (v_role_id, 'programacao_rag_global',       true, true, true, true)
  ON CONFLICT (role_id, module) DO NOTHING;

  -- 3. Vincula o usuário de teste ao role
  --    Condição AND role_id IS NULL garante que não sobrescreve vinculações futuras
  UPDATE colaboradores
  SET role_id = v_role_id
  WHERE email = 'admin@cucadev.com.br'
    AND role_id IS NULL;

END $$;
