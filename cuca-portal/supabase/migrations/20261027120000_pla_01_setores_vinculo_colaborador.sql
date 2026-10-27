-- S-PLA-01: setores oficiais do Planejamento 2027, vínculo colaborador × setor e função de escopo.
-- Aditiva e idempotente: nada existente muda (colaboradores não ganha coluna).

-- 1. Setores oficiais (D1). Lista fixa: sem tela de cadastro nesta story.
create table if not exists public.planejamento_setores (
    id text primary key,
    nome text not null unique,
    cor text not null check (cor ~ '^#[0-9a-f]{6}$'),
    ordem smallint not null unique,
    created_at timestamptz not null default now()
);

insert into public.planejamento_setores (id, nome, cor, ordem) values
    ('direitos_humanos',    'Direitos Humanos',      '#7c3aed', 1),
    ('empregabilidade',     'Empregabilidade',       '#2563eb', 2),
    ('cultura',             'Cultura',               '#db2777', 3),
    ('artes_biblioteca',    'Artes e Biblioteca',    '#ea580c', 4),
    ('educacao_tecnologia', 'Educação e Tecnologia', '#0891b2', 5),
    ('esportes',            'Esportes',              '#16a34a', 6)
on conflict (id) do nothing;

alter table public.planejamento_setores enable row level security;
drop policy if exists planejamento_setores_select on public.planejamento_setores;
create policy planejamento_setores_select on public.planejamento_setores
    for select to authenticated using (true);
revoke insert, update, delete, truncate on public.planejamento_setores from anon, authenticated;

-- 2. Vínculo colaborador × setor (D5). Gravação só pelas rotas de servidor (cliente de serviço).
create table if not exists public.planejamento_colaborador_setores (
    colaborador_id uuid not null references public.colaboradores(id) on delete cascade,
    setor_id text not null references public.planejamento_setores(id),
    created_at timestamptz not null default now(),
    primary key (colaborador_id, setor_id)
);
create index if not exists planejamento_colaborador_setores_setor_idx
    on public.planejamento_colaborador_setores (setor_id);

alter table public.planejamento_colaborador_setores enable row level security;
drop policy if exists planejamento_colaborador_setores_select on public.planejamento_colaborador_setores;
create policy planejamento_colaborador_setores_select on public.planejamento_colaborador_setores
    for select to authenticated using (true);
revoke insert, update, delete, truncate on public.planejamento_colaborador_setores from anon, authenticated;

-- 3. Escopo de visibilidade: o usuário logado pode atuar no setor?
-- Sim com `pla_todos_setores` (Developer e Super Admin Cuca entram pela regra atual de has_permission)
-- ou quando o setor está vinculado ao colaborador dele. Usada pelas policies das próximas stories.
create or replace function public.pla_pode_atuar_setor(p_setor text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce(public.has_permission('pla_todos_setores', 'read'), false)
        or exists (
            select 1
            from public.planejamento_colaborador_setores cs
            join public.colaboradores c on c.id = cs.colaborador_id
            where c.user_id = auth.uid()
              and cs.setor_id = p_setor
        );
$$;
revoke execute on function public.pla_pode_atuar_setor(text) from public, anon;
grant execute on function public.pla_pode_atuar_setor(text) to authenticated;

-- 4. Troca atômica do conjunto de setores de um colaborador (tudo ou nada).
-- Só o cliente de serviço das rotas chama: a permissão `pla_setor_vincular` é conferida na rota.
create or replace function public.pla_substituir_setores_colaborador(p_colaborador uuid, p_setores text[])
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
    delete from public.planejamento_colaborador_setores where colaborador_id = p_colaborador;
    insert into public.planejamento_colaborador_setores (colaborador_id, setor_id)
    select p_colaborador, s from unnest(coalesce(p_setores, '{}')) as s group by s;
end;
$$;
revoke execute on function public.pla_substituir_setores_colaborador(uuid, text[]) from public, anon, authenticated;
grant execute on function public.pla_substituir_setores_colaborador(uuid, text[]) to service_role;
