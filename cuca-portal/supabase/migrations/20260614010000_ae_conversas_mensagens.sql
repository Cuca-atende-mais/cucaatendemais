-- S-AE-02 fatia 2: Camada de conversas PRÓPRIA do módulo Academia Enem (AuctaFlux / WhatsApp Oficial).
-- Tabelas DEDICADAS, isoladas de conversas/mensagens do uazapi (decisão @po 2026-06-14: isolamento total).
-- A camada uazapi (instancias_uazapi, conversas, mensagens, worker, chat-sidebar) permanece BLINDADA.

-- Uma conversa por (instância, contato externo). Espelha a mecânica de `conversas`, mas própria do módulo.
create table if not exists public.ae_conversas (
    id uuid default gen_random_uuid() primary key,
    ae_instancia_id uuid not null references public.ae_instancias(id) on delete cascade,
    lead_id uuid references public.leads(id) on delete set null,   -- vínculo opcional quando o telefone casa
    wa_contact text not null,                                       -- telefone/wa id do lead (normalizado: dígitos + DDI 55)
    push_name text,                                                 -- nome de exibição do WhatsApp
    status varchar default 'ativa',                                 -- ativa | encerrada | awaiting_human
    estado varchar,                                                 -- etapa do fluxo (ae_fluxo): novo/aguardando_nome/...
    metadata jsonb default '{}'::jsonb,                             -- ae_fluxo, ultimo_disparo (S-AE-09), etc.
    nao_lidas integer not null default 0,
    ultima_mensagem_em timestamp with time zone,
    ultima_entrada_em timestamp with time zone,                     -- última msg RECEBIDA do lead (base da janela 24h)
    created_at timestamp with time zone default now() not null,
    updated_at timestamp with time zone default now() not null,
    constraint ae_conversas_instancia_contato_uniq unique (ae_instancia_id, wa_contact)
);

create index if not exists idx_ae_conversas_instancia on public.ae_conversas (ae_instancia_id);
create index if not exists idx_ae_conversas_lead on public.ae_conversas (lead_id);
create index if not exists idx_ae_conversas_ultima_msg on public.ae_conversas (ultima_mensagem_em desc);

-- Mensagens da conversa. Idempotência do webhook via UNIQUE(wa_message_id) (NULLs distintos no PG → outbound sem wamid OK).
create table if not exists public.ae_mensagens (
    id uuid default gen_random_uuid() primary key,
    ae_conversa_id uuid not null references public.ae_conversas(id) on delete cascade,
    wa_message_id text,                                             -- id da mensagem na Meta (idempotência do webhook)
    remetente varchar not null,                                     -- lead | atendente | ia | sistema
    tipo varchar not null default 'text',                           -- text | image | audio | template | ...
    conteudo text,
    midia_url text,
    status varchar,                                                 -- sent | delivered | read | failed (outbound)
    metadata jsonb default '{}'::jsonb,                             -- passthrough_id, timestamp Meta, campos não mapeados
    created_at timestamp with time zone default now() not null,
    constraint ae_mensagens_wamid_uniq unique (wa_message_id)
);

create index if not exists idx_ae_mensagens_conversa on public.ae_mensagens (ae_conversa_id, created_at);

-- Realtime (mesmo padrão SQS-45): o painel (S-AE-03) recebe eventos sem F5.
-- Entrega respeita a RLS do assinante → painel só popula com `atendimentos_academia_enem:read` (bypass de developer à parte).
alter publication supabase_realtime add table public.ae_conversas;
alter publication supabase_realtime add table public.ae_mensagens;

-- RLS keyed à função canônica has_permission, recurso do atendimento do módulo (consumido por S-AE-03).
-- Operações server-side (webhook/engine) usam service role e ignoram RLS; as policies cobrem o acesso do usuário autenticado.
alter table public.ae_conversas enable row level security;
alter table public.ae_mensagens enable row level security;

create policy "ae_conversas: select via atendimentos_academia_enem:read"
on public.ae_conversas for select to authenticated
using (public.has_permission('atendimentos_academia_enem', 'read'));

create policy "ae_conversas: insert via atendimentos_academia_enem:create"
on public.ae_conversas for insert to authenticated
with check (public.has_permission('atendimentos_academia_enem', 'create'));

create policy "ae_conversas: update via atendimentos_academia_enem:update"
on public.ae_conversas for update to authenticated
using (public.has_permission('atendimentos_academia_enem', 'update'))
with check (public.has_permission('atendimentos_academia_enem', 'update'));

create policy "ae_mensagens: select via atendimentos_academia_enem:read"
on public.ae_mensagens for select to authenticated
using (public.has_permission('atendimentos_academia_enem', 'read'));

create policy "ae_mensagens: insert via atendimentos_academia_enem:create"
on public.ae_mensagens for insert to authenticated
with check (public.has_permission('atendimentos_academia_enem', 'create'));

create policy "ae_mensagens: update via atendimentos_academia_enem:update"
on public.ae_mensagens for update to authenticated
using (public.has_permission('atendimentos_academia_enem', 'update'))
with check (public.has_permission('atendimentos_academia_enem', 'update'));
