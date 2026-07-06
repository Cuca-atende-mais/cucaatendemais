-- Fix: corrige unidade_cuca do colaborador admin e do role Developer.
-- Idempotente: UPDATE com WHERE já satisfaz re-execução sem efeito colateral.
-- Ambiente: cuca-dev (jmwokdcqxmojhvrkgpbd) — NÃO aplicar em produção manualmente.
-- A promoção para produção ocorre via merge main + gate humano (Junior).

DO $$
BEGIN
  -- 1. Colaborador admin@cucadev.com.br: limpa unidade legada ('barra-do-ceara')
  --    para que canSeeAllUnits = true e o admin tenha acesso global ao RBAC.
  UPDATE colaboradores
  SET unidade_cuca = NULL
  WHERE user_id = '06d8d6fc-e287-40a1-aa4b-1cf3c6c7c3ab'
    AND unidade_cuca IS DISTINCT FROM NULL;

  -- 2. Role 'Developer': limpa unidade_cuca incorreta ('barra-do-ceara')
  --    para que o role seja tratado como global (visível para todos os admins).
  UPDATE sys_roles
  SET unidade_cuca = NULL
  WHERE name = 'Developer'
    AND unidade_cuca IS DISTINCT FROM NULL;
END $$;
