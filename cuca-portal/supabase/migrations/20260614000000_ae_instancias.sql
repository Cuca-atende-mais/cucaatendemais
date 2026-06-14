-- S-AE-02: Instâncias (workspaces) da AuctaFlux assumidas pelo módulo Academia Enem (WhatsApp Oficial Meta / BSP).
-- Modelo/provider distinto de instancias_uazapi (não é extensão dela). Cada linha = um workspace AuctaFlux.
-- Campos espelham GET /workspaces e GET /workspaces/{id}/connection (contrato confirmado em 2026-06-14).
create table if not exists public.ae_instancias (
    id uuid default gen_random_uuid() primary key,
    workspace_id uuid not null,                  -- UUID do workspace na AuctaFlux
    slug text,                                   -- slug do workspace (AuctaFlux)
    display_name text,                           -- nome de exibição (connection.display_name) / name
    phone_number text,                           -- número conectado (null enquanto pending_signup)
    phone_number_id text,                        -- id do número na Meta
    waba_id text,                                -- WhatsApp Business Account id
    status text,                                 -- pending_signup | connected | disconnected | ...
    quality_rating text,                         -- quality rating do número (Meta)
    messaging_limit_tier text,                   -- tier de volume de envio (Meta)
    pending_reason text,                         -- motivo quando pendente/desconectado (resolver na AuctaFlux)
    forward_secret text,                         -- segredo HMAC obtido via rotate-secret AO ASSUMIR (S-AE-02 fatia 2)
    instancia_nome text,                         -- vínculo com a linha companheira em instancias_uazapi (canal_tipo='AcademiaEnem'); preenchido ao assumir (fatia 2)
    ativa boolean not null default false,        -- assumida e operando no módulo (local)
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null,
    constraint ae_instancias_workspace_uniq unique (workspace_id)
);

create index if not exists idx_ae_instancias_ativa on public.ae_instancias (ativa);
create index if not exists idx_ae_instancias_instancia_nome on public.ae_instancias (instancia_nome);

-- RLS keyed à função canônica has_permission(recurso, acao) — mesmo padrão de ae_presencas / DoD transversal S-AE-01.
-- (enforcement server-side real por recurso ae_instancia; has_permission já faz bypass de developer.)
-- Observação: as operações server-side (assumir/webhook) usam service role e ignoram RLS; as policies
-- protegem leituras/escritas feitas com o token do usuário autenticado.
alter table public.ae_instancias enable row level security;

create policy "ae_instancias: select via ae_instancia:read"
on public.ae_instancias for select
to authenticated
using (public.has_permission('ae_instancia', 'read'));

create policy "ae_instancias: insert via ae_instancia:create"
on public.ae_instancias for insert
to authenticated
with check (public.has_permission('ae_instancia', 'create'));

create policy "ae_instancias: update via ae_instancia:update"
on public.ae_instancias for update
to authenticated
using (public.has_permission('ae_instancia', 'update'))
with check (public.has_permission('ae_instancia', 'update'));

create policy "ae_instancias: delete via ae_instancia:delete"
on public.ae_instancias for delete
to authenticated
using (public.has_permission('ae_instancia', 'delete'));
