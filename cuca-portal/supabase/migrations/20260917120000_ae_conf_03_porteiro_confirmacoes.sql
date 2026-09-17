-- S-AE-CONF-03 — tabela de acompanhamento das confirmações do Simulado Academia Enem + a
-- configuração da campanha (fechamento, evento, categoria, mapa de lotes).
--
-- Idempotente (IF NOT EXISTS / ON CONFLICT) e aditiva: não altera nenhuma tabela existente.
-- Nada aqui é lido por Institucional/Divulgação/Ouvidoria — só pelo porteiro do worker.

create table if not exists public.confirmacoes_simulado_ae (
    id                   uuid primary key default gen_random_uuid(),
    evento_id            uuid not null references public.eventos_pontuais(id),
    -- Lead que RECEBEU o convite (não o cadastro de onde a mensagem chegou — AC1/AC2.2).
    lead_id              uuid not null references public.leads(id),
    -- Cadastro de onde a resposta chegou: pode ser o duplicado sem o nono dígito (Caminho C).
    lead_respondente_id  uuid references public.leads(id),
    disparo_id           uuid references public.disparos(id),
    lote                 text,
    resposta             text not null check (resposta in ('confirmou', 'nao_vai')),
    origem               text not null check (origem in ('botao', 'texto')),
    mensagem             text,
    telefone_convite     varchar,
    telefone_resposta    varchar,
    respondido_em        timestamptz not null default now(),
    atualizado_em        timestamptz not null default now(),
    created_at           timestamptz not null default now()
);

-- AC5: a última resposta vale, sem duplicar a pessoa.
create unique index if not exists uq_confirmacoes_simulado_ae_evento_lead
    on public.confirmacoes_simulado_ae (evento_id, lead_id);
create index if not exists idx_confirmacoes_simulado_ae_disparo
    on public.confirmacoes_simulado_ae (disparo_id);

alter table public.confirmacoes_simulado_ae enable row level security;

drop policy if exists "confirmacoes_simulado_ae: leitura" on public.confirmacoes_simulado_ae;
create policy "confirmacoes_simulado_ae: leitura" on public.confirmacoes_simulado_ae
    for select using (has_permission('campanhas', 'read'));

-- Configuração da campanha — editável sem redeploy (AC2.1). `lotes` mapeia disparo_id → nome do
-- lote, porque `disparos` não guarda nem título nem as categorias que o disparo mirou.
insert into public.configuracoes (chave, valor, descricao)
values (
    'academia_enem_confirmacao',
    jsonb_build_object(
        'evento_id', '697646e3-f558-4f4f-a187-f6242f190d5e',
        'categoria_evento_id', null,
        'fechamento', '2026-09-20T12:00:00-03:00',
        'lotes', jsonb_build_object()
    ),
    'S-AE-CONF-03 — porteiro da confirmação do simulado: evento, categoria do evento, data/hora de fechamento e mapa disparo_id→lote.'
)
on conflict (chave) do nothing;
