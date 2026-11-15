-- S-INST-QUAL-06: rota do Institucional consolidada (uma leitura por IA + decisão em código).
--
-- 1. `rag_retrieval_logs.rota_fallback`: true quando a leitura do turno falhou (erro, mais de 5 s ou
--    JSON inválido) e a rota antiga decidiu (plano B); false quando a rota estruturada decidiu;
--    NULL quando a rota antiga decidiu por escolha (chave desligada, número respondendo a uma lista,
--    resposta a pergunta pendente) e em todos os turnos de antes desta story.
--    Sem valor padrão e sem CHECK, como as colunas da S-INST-QUAL-03: o motor não espera nem confere
--    esse insert, e um erro de insert faria o registro do turno sumir em silêncio.
--
-- 2. Chave `rota_estruturada` em `system_config` (`on` | `off`). Nasce `off`: o motor só usa a rota
--    nova com `on`; qualquer outro valor, linha ausente ou erro de leitura = rota antiga. É a reversão
--    imediata (não é período de espera): ligar e desligar é um UPDATE nesta linha, sem deploy. O motor
--    relê a chave a cada 60 s.
--    `ON CONFLICT (chave) DO NOTHING`: se a linha já existir (já ligada), a migration não sobrescreve.
--
-- Aditiva e idempotente. Aplicar ANTES do deploy do motor-agente que grava `rota_fallback`.

alter table public.rag_retrieval_logs add column if not exists rota_fallback boolean;

comment on column public.rag_retrieval_logs.rota_fallback is
  'S-INST-QUAL-06: true = leitura do turno falhou e a rota antiga decidiu (plano B); false = rota estruturada decidiu; NULL = rota antiga por escolha (chave off, dígito de lista, pendência) ou turno anterior à story.';

insert into public.system_config (chave, valor, descricao)
values (
  'rota_estruturada',
  'off',
  'Institucional — rota estruturada da S-INST-QUAL-06 (uma leitura por IA decide a rota). on = ligada; qualquer outro valor = rota antiga. Reversão imediata: voltar para off (o motor relê a cada 60 s).'
)
on conflict (chave) do nothing;
