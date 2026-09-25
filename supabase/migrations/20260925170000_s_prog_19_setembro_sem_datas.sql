-- S-PROG-19 (ajuste, decisão do Junior em 2026-09-25): as regras novas valem só de outubro/2026 em
-- diante; os meses anteriores ficam como estavam. Desfaz o preenchimento de `data_inicio`/`data_fim`
-- que a migration 20260925150000 fez em setembro/2026 (136 linhas de CURSOS e DIA A DIA). Nenhum
-- outro campo foi alterado lá (hora fim preenchida: 0 linhas — conferido contra
-- `backup_pgm_datas_inicio_fim_20260925`). Outubro/2026 fica com o que foi preenchido.
-- Idempotente: só toca linhas de setembro que ainda têm alguma das duas datas.
-- Sem efeito no assistente: nada lê essas colunas para montar o RAG, e o único gatilho da tabela é
-- de INSERT.

UPDATE public.atividades_mensais a
SET data_inicio = NULL,
    data_fim = NULL
FROM public.campanhas_mensais c
WHERE c.id = a.campanha_id
  AND c.ano = 2026 AND c.mes = 9
  AND (a.data_inicio IS NOT NULL OR a.data_fim IS NOT NULL);
