-- ACHADO-016 (frente custo-llm): limite de respostas de IA por conversa, lido pelo worker
-- (worker/limite_ia.py). Valores decididos em 28/09/2026 (Junior + sócio): 20 por hora e 40 por
-- dia, acima do máximo real medido de 13/h e 17/dia por pessoa. Editáveis aqui, sem deploy.
-- Idempotente: não sobrescreve um ajuste manual feito depois.
insert into public.system_config (chave, valor, descricao, updated_at) values
  ('ia_limite_por_hora', '20', 'Máximo de respostas de IA por conversa na última hora; acima disso, resposta pronta (ACHADO-016).', now()),
  ('ia_limite_por_dia', '40', 'Máximo de respostas de IA por conversa nas últimas 24h; acima disso, resposta pronta (ACHADO-016).', now()),
  ('ia_limite_mensagem', 'Recebi várias mensagens seguidas por aqui! 😊 Para te ajudar melhor, espera um pouquinho e me manda de novo daqui a alguns minutos. Se preferir, as informações também estão no Portal da Juventude: portaldajuventude.fortaleza.ce.gov.br', 'Resposta enviada quando a conversa passa do limite de respostas de IA (ACHADO-016).', now())
on conflict (chave) do nothing;
