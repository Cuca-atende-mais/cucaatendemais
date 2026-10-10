-- S-WM-72 (R7): o menu de áreas do prompt do agente Institucional passa a listar só as 3 áreas que
-- existem na programação mensal (seções do monthly_program / atividades_mensais.categoria):
-- Cursos e Oficinas (CURSOS), Esportes (ESPORTES) e Dia a Dia (DIA A DIA).
-- "Atividades Culturais" e "Tecnologia" não são áreas da programação — dança, teatro, música e
-- informática estão dentro de Cursos e Oficinas.
--
-- Troca SÓ o trecho do menu, nos dois campos (espaçamentos diferentes depois do emoji: 3 espaços
-- em prompt_sistema, 2 em prompt_contexto). Idempotente: o WHERE só casa enquanto o texto antigo
-- existir. Conferido antes de aplicar: 1 ocorrência em cada campo.
--
-- ROLLBACK (reverso exato):
--   prompt_sistema:  '3️⃣   Dia a Dia (eventos e atividades abertas)'
--                 -> '3️⃣   Atividades Culturais' || E'\n    ' || '4️⃣   Tecnologia'
--   prompt_contexto: '3️⃣  Dia a Dia (eventos e atividades abertas)'
--                 -> '3️⃣  Atividades Culturais' || E'\n          ' || '4️⃣  Tecnologia'

UPDATE public.prompts_agentes
SET prompt_sistema = replace(
      prompt_sistema,
      '3️⃣   Atividades Culturais' || E'\n    ' || '4️⃣   Tecnologia',
      '3️⃣   Dia a Dia (eventos e atividades abertas)'),
    updated_at = now()
WHERE agente_tipo = 'Institucional'
  AND prompt_sistema LIKE '%' || '3️⃣   Atividades Culturais' || E'\n    ' || '4️⃣   Tecnologia' || '%';

UPDATE public.prompts_agentes
SET prompt_contexto = replace(
      prompt_contexto,
      '3️⃣  Atividades Culturais' || E'\n          ' || '4️⃣  Tecnologia',
      '3️⃣  Dia a Dia (eventos e atividades abertas)'),
    updated_at = now()
WHERE agente_tipo = 'Institucional'
  AND prompt_contexto LIKE '%' || '3️⃣  Atividades Culturais' || E'\n          ' || '4️⃣  Tecnologia' || '%';
