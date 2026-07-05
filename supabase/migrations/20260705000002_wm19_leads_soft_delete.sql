-- S-WM-19 Task 2: CRUD de exclusão de leads ausente em /leads. Mapeamento
-- confirmou 10 FKs em ON DELETE CASCADE para leads.id (conversas, mensagens,
-- candidatos, etc.) — hard delete apagaria histórico de conversa irrecuperável.
-- Decisão (usuário, 2026-07-05): soft delete. `bloqueado` já existe mas significa
-- "não recebe mensagem", conceito diferente de "removido da lista" — nova coluna
-- dedicada para não sobrecarregar semântica existente.

alter table public.leads
  add column if not exists excluido boolean not null default false;

create index if not exists idx_leads_excluido on public.leads (excluido);
