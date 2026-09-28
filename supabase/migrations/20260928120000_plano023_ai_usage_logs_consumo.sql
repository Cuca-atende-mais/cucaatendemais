-- PLANO-023 (frente custo-llm): registrar o consumo de cada chamada à OpenAI.
--
-- A tabela ai_usage_logs já existe em produção (criada pelo painel, sem migration), com RLS:
-- service_role insere, quem tem developer:read lê. Esta migration só ACRESCENTA — é aditiva e
-- idempotente; nada existente é alterado ou removido.
--
-- Emenda ao plano original: `custo_estimado_usd` e `tokens_total` são colunas GERADAS pelo banco
-- (custo com preço fixo de US$ 5/15 por milhão, sem cache, errado para qualquer modelo em uso).
-- Elas não aceitam escrita, então o custo real vai numa coluna nova, `custo_usd`, calculada no
-- código com a tabela de preços abaixo. As colunas geradas ficam como estão.

alter table public.ai_usage_logs
  add column if not exists tokens_prompt_cached integer not null default 0,
  add column if not exists custo_usd            numeric(12,8),
  add column if not exists latencia_ms          integer,
  add column if not exists prompt_versao        text,
  add column if not exists blocos_contexto      jsonb,
  add column if not exists openai_request_id    text,
  add column if not exists camada_rag           text;

comment on column public.ai_usage_logs.tokens_prompt_cached is
  'usage.prompt_tokens_details.cached_tokens da resposta da OpenAI — a única medida real de acerto de cache.';
comment on column public.ai_usage_logs.custo_usd is
  'Custo real em US$, calculado no código com system_config.openai_precos_usd_por_milhao, separando entrada com e sem cache. NULL quando o modelo não tem preço configurado. Use esta coluna, não custo_estimado_usd (gerada, preço fixo).';
comment on column public.ai_usage_logs.blocos_contexto is
  'Tamanho em caracteres de cada bloco que entrou no prompt, ex. {"servicos_rede":15238,"programacao_completa":44991}. Mesma fonte que gerou o texto enviado.';
comment on column public.ai_usage_logs.camada_rag is
  'Espelha rag_retrieval_logs.camada do mesmo turno, para cruzar consumo com o caminho de busca.';
comment on column public.ai_usage_logs.custo_estimado_usd is
  'LEGADO: coluna gerada com preço fixo (US$ 5/15 por milhão), não reflete o modelo nem o cache. Usar custo_usd.';

create index if not exists ix_ai_usage_logs_created_at on public.ai_usage_logs (created_at desc);
create index if not exists ix_ai_usage_logs_feature_created on public.ai_usage_logs (feature, created_at desc);

-- Preços por milhão de tokens (conferidos na página oficial em 23/09/2026). Mudar preço aqui não
-- exige deploy. `valor` é texto: o código faz JSON.parse. Só insere se ainda não existir, para não
-- sobrescrever um ajuste manual feito depois.
insert into public.system_config (chave, valor, descricao, updated_at)
values (
  'openai_precos_usd_por_milhao',
  '{"gpt-4o":{"in":2.50,"cached_in":1.25,"out":10.00},"gpt-4o-mini":{"in":0.15,"cached_in":0.075,"out":0.60},"text-embedding-3-small":{"in":0.02,"cached_in":0.02,"out":0.00}}',
  'Preço da OpenAI em US$ por milhão de tokens, por modelo (PLANO-023). Usado para ai_usage_logs.custo_usd.',
  now()
)
on conflict (chave) do nothing;
