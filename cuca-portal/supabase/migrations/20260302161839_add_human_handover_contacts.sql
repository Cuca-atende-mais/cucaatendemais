create table if not exists public.human_handover_contacts (
    id uuid default gen_random_uuid() primary key,
    modulo text not null, -- 'empregabilidade', 'ouvidoria', 'programacao', 'acesso_cuca', 'geral'
    unidade_cuca text, -- Nullish means general fallback
    telefone_destino text not null,
    nome_responsavel text,
    ativo boolean default true,
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null
);

-- RLS
alter table public.human_handover_contacts enable row level security;

create policy "Admins e Ops podem ver e gerenciar os contatos de transbordo"
on public.human_handover_contacts for all
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
