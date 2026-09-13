-- S-PROG-13: grafia antiga `ESPORTE` (66 linhas da campanha de junho/2026 do Jangurussu) passa a
-- `ESPORTES`, para as permissões por categoria valerem igual. Só troca o nome da categoria: não
-- muda o número de linhas nem o conteúdo, e atividades_mensais não tem gatilho (o RAG não é refeito).
UPDATE public.atividades_mensais
SET categoria = 'ESPORTES'
WHERE categoria = 'ESPORTE';
