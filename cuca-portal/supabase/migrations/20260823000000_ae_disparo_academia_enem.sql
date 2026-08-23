-- S-AE-09 — Disparo de Avisos Próprio da Academia Enem (fila, público e envio)
-- Fila isolada (disparos_academia_enem) + FK aditiva em logs_disparo (S-WM-67 continua
-- enxergando os envios via 3º bloco em worker/campanhas_engine.py::_contar_enviados_hoje_sync).
-- Idempotente (IF NOT EXISTS) e retrocompatível (aditivo — nenhuma coluna/policy existente é
-- alterada ou removida).

create table if not exists public.disparos_academia_enem (
    id uuid primary key default gen_random_uuid(),
    titulo text not null,
    template_nome text not null,
    instancia_uazapi text not null, -- phone_number_id da Academia Enem (nome de coluna consistente com disparos/disparos_divulgacao)
    publico_origem text not null default 'tag_academia_enem',
    contatos jsonb not null default '[]'::jsonb, -- [{lead_id, nome, telefone}] resolvido na criação (dedup já aplicado)
    total_destinatarios int not null default 0,
    total_enviados int not null default 0,
    total_erros int not null default 0,
    status text not null default 'pendente', -- pendente|em_andamento|pausada_limite_diario|pausada|concluida
    criado_por uuid references auth.users(id),
    iniciado_em timestamptz,
    concluido_em timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists idx_disparos_academia_enem_status on public.disparos_academia_enem(status, created_at);
create index if not exists idx_disparos_academia_enem_instancia on public.disparos_academia_enem(instancia_uazapi);

alter table public.logs_disparo
    add column if not exists disparo_academia_enem_id uuid references public.disparos_academia_enem(id);

create index if not exists idx_logs_disparo_disparo_academia_enem_id on public.logs_disparo(disparo_academia_enem_id);

-- RLS: keyed a has_permission('ae_disparo', acao) desde o início (padrão canônico do projeto —
-- S-AE-01 DoD; evita repetir o achado C-1 da S-AE-07, onde a policy original usava role-names
-- inexistentes e ficava morta/permissiva por engano).
alter table public.disparos_academia_enem enable row level security;

drop policy if exists "ae_disparo select" on public.disparos_academia_enem;
create policy "ae_disparo select" on public.disparos_academia_enem
    for select using (public.has_permission('ae_disparo', 'read'));

drop policy if exists "ae_disparo insert" on public.disparos_academia_enem;
create policy "ae_disparo insert" on public.disparos_academia_enem
    for insert with check (public.has_permission('ae_disparo', 'create'));

drop policy if exists "ae_disparo update" on public.disparos_academia_enem;
create policy "ae_disparo update" on public.disparos_academia_enem
    for update using (public.has_permission('ae_disparo', 'update'));

drop policy if exists "ae_disparo delete" on public.disparos_academia_enem;
create policy "ae_disparo delete" on public.disparos_academia_enem
    for delete using (public.has_permission('ae_disparo', 'delete'));

-- Claim atômico (FOR UPDATE SKIP LOCKED) — mesmo padrão de claim_disparo_divulgacao/
-- claim_evento_pontual, evita 2 execuções concorrentes do worker pegarem o mesmo item.
create or replace function public.claim_disparo_academia_enem()
returns setof public.disparos_academia_enem
language sql
as $$
    update public.disparos_academia_enem
    set status = 'em_andamento', updated_at = now()
    where id = (
      select id from public.disparos_academia_enem
      where status = 'pendente'
      order by created_at asc
      for update skip locked
      limit 1
    )
    returning *;
$$;
