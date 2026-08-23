-- S-AE-10 (reconstrução, 2026-08-23) — RAG 100% próprio da Academia Enem.
-- Decisão do Junior: a Academia Enem é um canal totalmente desacoplado dos demais — nunca
-- compartilha tabela de RAG com o Institucional/demais módulos (documentos_rag/chunks_documentos
-- são compartilhados e tinham inclusive uma RLS permissiva cruzada: has_permission('ae_rag',...)
-- OR has_permission('programacao_rag_global',...) liberava os dois lados um pro outro).
-- Tabelas novas, isoladas, com RLS keyed SÓ a 'ae_rag' — sem OR com nenhuma outra permissão.

create table if not exists public.ae_documentos_rag (
    id uuid primary key default gen_random_uuid(),
    titulo varchar not null,
    tipo varchar not null,
    conteudo text not null,
    metadados jsonb,
    ativo boolean not null default true,
    created_by uuid references colaboradores(id),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists public.ae_chunks_documentos (
    id uuid primary key default gen_random_uuid(),
    documento_id uuid not null references public.ae_documentos_rag(id) on delete cascade,
    chunk_index integer not null default 0,
    conteudo text not null,
    embedding vector(1536),
    metadados jsonb,
    created_at timestamptz not null default now()
);

create index if not exists idx_ae_chunks_documento_id on public.ae_chunks_documentos(documento_id);
create index if not exists idx_ae_chunks_embedding on public.ae_chunks_documentos
    using ivfflat (embedding vector_cosine_ops) with (lists = 100);

alter table public.ae_documentos_rag enable row level security;
alter table public.ae_chunks_documentos enable row level security;

drop policy if exists "ae_documentos_rag: leitura" on public.ae_documentos_rag;
create policy "ae_documentos_rag: leitura" on public.ae_documentos_rag
    for select using (has_permission('ae_rag', 'read'));
drop policy if exists "ae_documentos_rag: criacao" on public.ae_documentos_rag;
create policy "ae_documentos_rag: criacao" on public.ae_documentos_rag
    for insert with check (has_permission('ae_rag', 'create'));
drop policy if exists "ae_documentos_rag: atualizacao" on public.ae_documentos_rag;
create policy "ae_documentos_rag: atualizacao" on public.ae_documentos_rag
    for update using (has_permission('ae_rag', 'update'));
drop policy if exists "ae_documentos_rag: delecao" on public.ae_documentos_rag;
create policy "ae_documentos_rag: delecao" on public.ae_documentos_rag
    for delete using (has_permission('ae_rag', 'delete'));

drop policy if exists "ae_chunks_documentos: leitura" on public.ae_chunks_documentos;
create policy "ae_chunks_documentos: leitura" on public.ae_chunks_documentos
    for select using (has_permission('ae_rag', 'read'));
drop policy if exists "ae_chunks_documentos: criacao" on public.ae_chunks_documentos;
create policy "ae_chunks_documentos: criacao" on public.ae_chunks_documentos
    for insert with check (has_permission('ae_rag', 'create'));
drop policy if exists "ae_chunks_documentos: atualizacao" on public.ae_chunks_documentos;
create policy "ae_chunks_documentos: atualizacao" on public.ae_chunks_documentos
    for update using (has_permission('ae_rag', 'update'));
drop policy if exists "ae_chunks_documentos: delecao" on public.ae_chunks_documentos;
create policy "ae_chunks_documentos: delecao" on public.ae_chunks_documentos
    for delete using (has_permission('ae_rag', 'delete'));

-- RPC de busca vetorial própria — NUNCA reaproveita buscar_chunks_similares (compartilhada).
create or replace function public.ae_buscar_chunks_similares(
    query_embedding vector,
    p_tipos text[] default null,
    p_limite integer default 5
)
returns table(chunk_id uuid, documento_id uuid, conteudo text, similaridade double precision, metadados jsonb)
language plpgsql
security definer
as $$
begin
  return query
  select
    c.id as chunk_id,
    c.documento_id,
    c.conteudo::text,
    1 - (c.embedding <=> query_embedding) as similaridade,
    c.metadados
  from public.ae_chunks_documentos c
  join public.ae_documentos_rag d on d.id = c.documento_id
  where c.embedding is not null
    and d.ativo = true
    and (p_tipos is null or d.tipo::text = any(p_tipos))
  order by c.embedding <=> query_embedding
  limit p_limite;
end;
$$;
