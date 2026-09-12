-- S-WM-AUD-007 / Plano 012 — log de cada busca de RAG do Institucional.
--
-- Hoje nao ha como avaliar qualidade de recuperacao por query: o motor-agente loga no console
-- (nao consultavel por SQL, sem retencao garantida) e a informacao mais importante e simplesmente
-- descartada — `buscar_chunks_similares` JA devolve a coluna `similaridade` e nenhum ponto do
-- codigo usa ou registra esse valor.
--
-- Toda a validacao desta auditoria foi feita lendo conversa a mao e rodando script contra o
-- catalogo. Com este log, a proxima comeca com dado.
create table if not exists public.rag_retrieval_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  conversa_id uuid references public.conversas(id) on delete set null,
  agente_tipo text not null,
  unidade_cuca text,
  -- Qual camada respondeu. E o campo mais importante da tabela: permite medir quanto do
  -- atendimento vem de dado estruturado (confiavel) x busca vetorial (onde nascem as invencoes).
  --   deterministica_metadata -> atividades_mensais (1a camada, S-WM-35)
  --   deterministica_texto    -> chunks do monthly_program (2a camada, S-WM-34)
  --   vetorial                -> buscar_chunks_similares
  --   sem_match_rag           -> nenhuma fonte trouxe nada
  --   nao_aplicavel           -> turno sem busca de atividade (handover, encerramento, saudacao)
  camada text not null,
  atividade_resolvida text,
  -- [{documento_id, fonte_tipo, similaridade}] quando camada='vetorial'. A similaridade e o que
  -- permite descobrir que a busca devolveu 5 chunks irrelevantes — hoje invisivel.
  chunks_retornados jsonb,
  mensagem_lead text
);

create index if not exists idx_rag_retrieval_logs_created_at on public.rag_retrieval_logs (created_at desc);
create index if not exists idx_rag_retrieval_logs_camada on public.rag_retrieval_logs (camada);
create index if not exists idx_rag_retrieval_logs_unidade on public.rag_retrieval_logs (unidade_cuca);
create index if not exists idx_rag_retrieval_logs_conversa on public.rag_retrieval_logs (conversa_id);

alter table public.rag_retrieval_logs enable row level security;

-- Log interno de diagnostico. Escrito so pelo motor-agente (service_role, que ignora RLS).
-- Politica explicita mesmo assim — defesa em profundidade, e evita o lint rls_enabled_no_policy.
-- `anon`/`authenticated` nao tem policy nenhuma: nao leem nem escrevem.
drop policy if exists "rag_retrieval_logs_service_role_only" on public.rag_retrieval_logs;
create policy "rag_retrieval_logs_service_role_only"
  on public.rag_retrieval_logs
  for all
  to service_role
  using (true)
  with check (true);

comment on table public.rag_retrieval_logs is
  'S-WM-AUD-007/Plano 012: 1 linha por turno de conversa do Institucional, registrando qual camada de RAG respondeu e com que similaridade. Retencao sugerida: 90 dias (ver Maintenance notes da story).';
