-- S-WM-16 (correção pós-QA): desativar número de teste Institucional duplicado
-- 2 números ativos com canal_tipo='Institucional' causavam ambiguidade em queries
-- sem ORDER BY (ex.: supabase/functions/alertas-institucionais/index.ts), fazendo
-- o número de teste ser escolhido em vez do real. Achado e verificado por @qa.

UPDATE public.meta_phone_numbers
SET ativo = false
WHERE phone_number_id = '1215172285010519' AND ativo = true;
