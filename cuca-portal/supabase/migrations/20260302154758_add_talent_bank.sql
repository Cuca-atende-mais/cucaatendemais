create table if not exists public.talent_bank (
    id uuid default gen_random_uuid() primary key,
    nome text not null,
    data_nascimento date,
    telefone text,
    candidatura_origem_id uuid, -- UUID of original candidaturas (kept logic loose in case it gets deleted)
    vaga_origem_id uuid, -- UUID of the job they were rejected from
    skills_jsonb jsonb default '{}'::jsonb,
    status text default 'disponivel',
    arquivo_cv_url text, -- Original CV URL if any
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null
);

-- RLS
alter table public.talent_bank enable row level security;

create policy "Admins e Ops podem ver e gerenciar o banco de talentos"
on public.talent_bank for all
to authenticated
using (
  exists (
    select 1 from public.colaboradores
    where colaboradores.user_id = auth.uid()
      and colaboradores.role_id in (
        select id from public.sys_roles where name in ('super_admin', 'coordenador', 'operador', 'admin_local')
      )
  )
);
