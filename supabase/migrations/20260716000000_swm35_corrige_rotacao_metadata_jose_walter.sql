-- S-WM-35 (VAL-09, Frente B3): corrige a rotação de 5 campos do metadata de
-- atividades_mensais para Cuca José Walter, categoria ESPORTES.
--
-- Confirmado na auditoria (B1): 214/214 linhas com o mesmo padrão de rotação cíclica —
-- o valor real de cada campo está presente, só sob o rótulo errado.
--   rótulo "sexo"         -> valor real é "vagas" (número puro, ex.: "25")
--   rótulo "vagas"        -> valor real é "dias_semana" (ex.: "TER/QUI")
--   rótulo "dias_semana"  -> valor real é "horario" (ex.: "18h ás 19h")
--   rótulo "horario"      -> valor real é "faixa_etaria" (ex.: "15 á 29+ anos")
--   rótulo "faixa_etaria" -> valor real é "sexo" (ex.: "MISTO" — confirmado 214/214
--                            batendo ^(misto|masculino|feminino)$ antes desta migration)
-- `professor` e `turma` não são afetados.
--
-- `descricao` (a string achatada que alimenta documentos_rag.conteudo/chunks_documentos via
-- trigger_indexar_campanha_mensal) é reconstruída com os MESMOS valores corrigidos, usando o
-- template exato de import-planilha-modal.tsx (linha ~298), para o texto que o bot lê bater
-- com o metadata corrigido.
--
-- Idempotente por construção: a condição `metadata->>'sexo' ~ '^[0-9]+$'` só é verdadeira no
-- estado quebrado (sexo com número). Depois de corrigido, sexo passa a conter
-- MISTO/MASCULINO/FEMININO, que nunca bate nesse regex — uma segunda execução não afeta
-- nenhuma linha (WHERE não seleciona nada).
--
-- Escopo: TODAS as linhas de Cuca José Walter / categoria ESPORTES, não só a campanha ativa
-- (o padrão é uniforme em todo o histórico já importado, e a correção é a mesma transformação
-- seja a linha de uma campanha ativa ou antiga — deixa o dado inteiro consistente).
--
-- NÃO cobre: hora_inicio/hora_fim (colunas de tipo `time`, já nulas antes desta migration,
-- permanecem nulas) — não são lidas pelo motor-agente hoje (só chunks_documentos.conteudo é
-- lido), e parsear os formatos de horário em texto livre direto em SQL é mais arriscado que a
-- lógica já testada em TypeScript (parseTimeString); registrado como gap conhecido, não corrigido
-- aqui, fora do escopo desta frente.

UPDATE public.atividades_mensais
SET
  descricao = 'Esporte Modalidade: ' || titulo || ' - Turma ' || (metadata->>'turma') ||
    '. Professor: ' || (metadata->>'professor') ||
    '. Vagas: ' || (metadata->>'sexo') ||
    '. Público: ' || (metadata->>'faixa_etaria') || ' (Idade: ' || (metadata->>'horario') || ')' ||
    '. Dias: ' || (metadata->>'vagas') ||
    '. Horário: ' || (metadata->>'dias_semana') || '.',
  metadata = jsonb_build_object(
    'professor', metadata->>'professor',
    'turma', metadata->>'turma',
    'faixa_etaria', metadata->>'horario',
    'sexo', metadata->>'faixa_etaria',
    'vagas', metadata->>'sexo',
    'dias_semana', metadata->>'vagas',
    'horario', metadata->>'dias_semana'
  )
WHERE categoria = 'ESPORTES'
  AND unidade_cuca = 'Cuca José Walter'
  AND metadata->>'sexo' ~ '^[0-9]+$';
