-- S-AE-02 (sub-fatia diagnóstica): captura de webhooks da AuctaFlux para descobrir o ESQUEMA HMAC
-- e o SHAPE do payload (não documentados no PDF/console). TABELA TEMPORÁRIA — dropar após reverter o esquema.
-- O receptor grava headers + CORPO CRU (essencial: o HMAC é calculado sobre os bytes crus do corpo).
create table if not exists public.ae_webhook_capturas (
    id uuid default gen_random_uuid() primary key,
    metodo text,                      -- GET/POST
    url text,                         -- path + query string recebidos
    headers jsonb,                    -- todos os headers (procurar o de assinatura HMAC)
    corpo text,                       -- corpo CRU (raw) — usado para conferir a assinatura
    received_at timestamp with time zone default now() not null
);

create index if not exists idx_ae_webhook_capturas_received on public.ae_webhook_capturas (received_at desc);

-- Inserções são server-side (service role, bypass RLS). Leitura restrita a quem tem ae_instancia:read (+ developer).
alter table public.ae_webhook_capturas enable row level security;

create policy "ae_webhook_capturas: select via ae_instancia:read"
on public.ae_webhook_capturas for select to authenticated
using (public.has_permission('ae_instancia', 'read'));
