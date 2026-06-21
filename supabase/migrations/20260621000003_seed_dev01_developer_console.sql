-- Seed: cria usuário dev01@cucadev.com.br dedicado ao Developer Console.
-- Idempotente: verificações EXISTS evitam duplicação em re-execução.
-- Ambiente: cuca-dev (jmwokdcqxmojhvrkgpbd) — NÃO aplicar em produção manualmente.
-- A promoção para produção ocorre via merge main + gate humano (Junior).

DO $$
DECLARE
  v_user_id  uuid;
  v_role_id  uuid;
BEGIN
  -- 1. Obtém o UUID do sys_role 'Developer' (já existente desde 20260621000000)
  SELECT id INTO v_role_id FROM sys_roles WHERE name = 'Developer';
  IF v_role_id IS NULL THEN
    RAISE EXCEPTION 'sys_role Developer não encontrado — execute 20260621000000 primeiro';
  END IF;

  -- 2. Cria o auth user se ainda não existir
  SELECT id INTO v_user_id FROM auth.users WHERE email = 'dev01@cucadev.com.br';

  IF v_user_id IS NULL THEN
    v_user_id := gen_random_uuid();
    INSERT INTO auth.users (
      id, aud, role, email,
      encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data,
      is_super_admin, is_sso_user, is_anonymous,
      created_at, updated_at
    ) VALUES (
      v_user_id,
      'authenticated',
      'authenticated',
      'dev01@cucadev.com.br',
      crypt('DevCuca2026!temp', gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}',
      '{"name":"Dev Console 01"}',
      false, false, false,
      now(), now()
    );
  END IF;

  -- 3. Cria o colaborador se ainda não existir
  IF NOT EXISTS (SELECT 1 FROM colaboradores WHERE email = 'dev01@cucadev.com.br') THEN
    INSERT INTO colaboradores (user_id, nome_completo, email, unidade_cuca, role_id)
    VALUES (v_user_id, 'Dev Console 01', 'dev01@cucadev.com.br', NULL, v_role_id);
  END IF;

END $$;
