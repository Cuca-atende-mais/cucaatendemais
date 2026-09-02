-- OCR anti-starvation: contador de tentativas no loop de análise de currículo.
--
-- Problema: o ocr_pending_loop (worker/main.py) seleciona candidaturas com
-- matching_score IS NULL AND dados_ocr_json IS NULL (LIMIT 5, sem ORDER BY).
-- Quando o OCR falha, o worker grava apenas matching_justificativa = 'Erro OCR: ...'
-- e deixa matching_score/dados_ocr_json nulos — então a candidatura com erro
-- continua batendo no filtro para sempre e ocupa a janela do LIMIT 5, "starvando"
-- os currículos novos, que ficam eternamente em "Análise em andamento".
--
-- Solução: coluna de contador de tentativas. O loop passa a filtrar
-- ocr_tentativas < N e incrementar a cada tentativa, de modo que um currículo
-- que erra (ou trava) N vezes sai da fila em vez de bloquear os demais.
--
-- Idempotente (IF NOT EXISTS) e retrocompatível (aditivo, default 0 — worker
-- antigo não referencia a coluna; worker novo exige que ela exista, por isso a
-- migration é aplicada ANTES do deploy do worker).

ALTER TABLE candidaturas
  ADD COLUMN IF NOT EXISTS ocr_tentativas smallint NOT NULL DEFAULT 0;

COMMENT ON COLUMN candidaturas.ocr_tentativas IS
  'Nº de tentativas de OCR/análise de IA disparadas pelo ocr_pending_loop. '
  'O loop só processa candidaturas com ocr_tentativas < limite (evita starvation '
  'por candidaturas que erram/travam repetidamente).';

-- Backfill: candidaturas que hoje estão presas em erro de OCR (as que causam a
-- starvation atual) são marcadas como esgotadas, saindo da fila imediatamente.
-- O reprocessamento controlado delas (zerar ocr_tentativas) fica para depois do
-- fix de robustez do parsing da resposta do modelo.
UPDATE candidaturas
   SET ocr_tentativas = 3
 WHERE matching_score IS NULL
   AND dados_ocr_json IS NULL
   AND matching_justificativa LIKE 'Erro OCR:%'
   AND ocr_tentativas < 3;
