create table if not exists public.empresas (
    id uuid default gen_random_uuid() primary key,
    nome text not null,
    cnpj text unique,
    telefone text,
    email text,
    endereco text,
    setor text,
    porte text,
    contato_responsavel text,
    ativa boolean default true not null,
    created_by uuid references public.colaboradores(id) on delete set null,
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null
);

-- RLS
alter table public.empresas enable row level security;

create policy "Empresas são visíveis para todos os autenticados"
on public.empresas for select
to authenticated
using (true);

create policy "Admins e Ops podem inserir/atualizar empresas"
on public.empresas for all
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
