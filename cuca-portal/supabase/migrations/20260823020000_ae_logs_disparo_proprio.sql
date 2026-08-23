-- S-AE-10 (reconstrução, 2026-08-23) — log de envio 100% próprio da Academia Enem.
-- Decisão do Junior: nunca compartilhar `logs_disparo` (ledger usado por Institucional/
-- Divulgação/Ouvidoria) — nem a contagem de teto diário desses módulos deve saber nada sobre
-- a Academia Enem, nem o contrário. A coluna `disparo_academia_enem_id` (S-AE-09, aditiva) tinha
-- 0 linhas usando-a (confirmado antes desta migration) — removida sem risco de perda de dado.

alter table public.logs_disparo drop column if exists disparo_academia_enem_id;

create table if not exists public.logs_disparo_academia_enem (
    id uuid primary key default gen_random_uuid(),
    disparo_academia_enem_id uuid references public.disparos_academia_enem(id),
    lead_id uuid,
    telefone varchar not null,
    wamid text,
    status varchar not null,
    erro text,
    enviado_em timestamptz,
    status_timestamp_meta timestamptz,
    created_at timestamptz not null default now(),
    atualizado_em timestamptz not null default now()
);

create index if not exists idx_logs_disparo_ae_disparo_id on public.logs_disparo_academia_enem(disparo_academia_enem_id);
create index if not exists idx_logs_disparo_ae_wamid on public.logs_disparo_academia_enem(wamid);

alter table public.logs_disparo_academia_enem enable row level security;

drop policy if exists "logs_disparo_ae: leitura" on public.logs_disparo_academia_enem;
create policy "logs_disparo_ae: leitura" on public.logs_disparo_academia_enem
    for select using (has_permission('ae_disparo', 'read'));
-- Sem policy de INSERT/UPDATE pro client autenticado: escrita é sempre via service role
-- (worker), mesmo padrão já usado no resto do módulo (RLS aqui é defesa em profundidade,
-- não o mecanismo de enforcement real).
