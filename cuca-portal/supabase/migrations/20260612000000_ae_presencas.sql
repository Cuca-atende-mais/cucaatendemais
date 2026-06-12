-- S-AE-07: Importação tabular de presença da Academia Enem.
-- Uma linha por aluno (telefone normalizado) × encontro (data). Idempotência via único (telefone, data_encontro).
create table if not exists public.ae_presencas (
    id uuid default gen_random_uuid() primary key,
    nome text,
    telefone text not null,                 -- normalizado: dígitos + DDI 55 (mesma normalização dos disparos)
    presente boolean not null default false, -- "sim" -> true / "não" -> false
    data_encontro date not null,
    unidade_cuca text,                       -- opcional (uso futuro)
    lead_id uuid references public.leads(id) on delete set null, -- vínculo opcional quando o telefone casa
    created_at timestamp with time zone default now() not null,
    constraint ae_presencas_telefone_data_uniq unique (telefone, data_encontro)
);

create index if not exists idx_ae_presencas_data on public.ae_presencas (data_encontro);
create index if not exists idx_ae_presencas_lead on public.ae_presencas (lead_id);

-- RLS keyed à função canônica has_permission(recurso, acao) — alinha ao DoD transversal da S-AE-01
-- (enforcement server-side real na tabela, por recurso ae_presenca). has_permission já faz bypass de developer.
alter table public.ae_presencas enable row level security;

create policy "ae_presencas: select via ae_presenca:read"
on public.ae_presencas for select
to authenticated
using (public.has_permission('ae_presenca', 'read'));

create policy "ae_presencas: insert via ae_presenca:create"
on public.ae_presencas for insert
to authenticated
with check (public.has_permission('ae_presenca', 'create'));

create policy "ae_presencas: update via ae_presenca:update"
on public.ae_presencas for update
to authenticated
using (public.has_permission('ae_presenca', 'update'))
with check (public.has_permission('ae_presenca', 'update'));

create policy "ae_presencas: delete via ae_presenca:delete"
on public.ae_presencas for delete
to authenticated
using (public.has_permission('ae_presenca', 'delete'));
