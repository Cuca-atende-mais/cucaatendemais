-- S-PROG-13: "Excluir programação inteira" começa desmarcado em todos os perfis.
-- O espelhamento da S-PROG-12 copiou a opção de `programacao_mensal.can_delete`, o que daria a 6
-- perfis a exclusão de programação mensal (inclusive aprovada, que tira o mês do RAG) quando o
-- portal novo entrar. Hoje só as 2 contas Developer excluem, e elas passam sem precisar da opção.
-- Quem deve excluir passa a ser decidido na tela de Perfis.
UPDATE public.sys_permissions
SET can_read = false, can_create = false, can_update = false, can_delete = false
WHERE module = 'pgm_excluir_programacao'
  AND (can_read OR can_create OR can_update OR can_delete);
