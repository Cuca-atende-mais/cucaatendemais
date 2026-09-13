-- S-PROG-14: proteção do RAG de setembro até a liberação das S-PROG-14/15.
-- O portal no ar (S-PROG-13) ainda publica ou tira o mês do RAG ao "Aprovar" e ao "Reabrir" uma
-- programação, pelo gatilho antigo. Desmarca "Autorizar" e "Reabrir" das 4 categorias em todos os
-- perfis; as contas Developer continuam passando. Criar, editar, salvar, enviar e devolver continuam.
-- Depois da liberação, o Junior configura essas opções nos perfis de coordenador.
UPDATE public.sys_permissions
SET can_read = false, can_create = false, can_update = false, can_delete = false
WHERE module IN (
    'pgm_esportes_autorizar', 'pgm_cursos_autorizar', 'pgm_dia_a_dia_autorizar', 'pgm_especiais_autorizar',
    'pgm_esportes_reabrir', 'pgm_cursos_reabrir', 'pgm_dia_a_dia_reabrir', 'pgm_especiais_reabrir'
)
  AND (can_read OR can_create OR can_update OR can_delete);
