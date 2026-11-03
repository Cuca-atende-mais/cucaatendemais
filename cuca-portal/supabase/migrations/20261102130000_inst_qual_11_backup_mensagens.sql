-- S-INST-QUAL-11 — Backup permanente das mensagens e dos disparos.
--
-- Toda mensagem do Institucional e da Empregabilidade (tabela `mensagens`) e todo
-- envio de disparo em massa (tabela `logs_disparo`) ganha uma cópia permanente em
-- `mensagens_arquivo`, gravada na hora por gatilho. O backup não tem chave
-- estrangeira: excluir lead, conversa ou disparo nunca apaga a cópia, só marca
-- `apagada_em`.
--
-- A limpeza de 60 dias de `mensagens` passa a chamar
-- `limpar_mensagens_arquivadas_60d()`, que só apaga o que já tem cópia. O job
-- continua DESLIGADO aqui; ele é religado numa migration separada, depois dos
-- testes (AC10).
--
-- Ordem importa: os gatilhos são criados ANTES da carga inicial. Assim nenhuma
-- mensagem gravada durante a migration fica sem cópia.
--
-- Idempotente: IF NOT EXISTS / CREATE OR REPLACE / DROP TRIGGER IF EXISTS /
-- ON CONFLICT DO NOTHING. Retrocompatível: só adiciona; `logs_disparo` ganha duas
-- colunas opcionais.

-- ─── 1. Tabelas ──────────────────────────────────────────────────────────────

create table if not exists public.mensagens_arquivo (
  id                uuid primary key,
  origem            text not null check (origem in ('mensagens', 'disparo')),
  -- colunas de `mensagens`
  conversa_id       uuid,
  lead_id           uuid,
  tipo              varchar not null,
  conteudo          text,
  midia_url         text,
  transcricao       text,
  sentimento        varchar,
  sentimento_score  double precision,
  remetente         varchar not null,
  created_at        timestamptz,
  wamid             text,
  -- retrato no momento da cópia
  agente_tipo       varchar,
  canal_ativo       varchar,
  unidade_cuca      text,
  -- só para disparo
  telefone          varchar,
  disparo_tipo      text check (disparo_tipo in ('campanha', 'divulgacao')),
  disparo_ref_id    uuid,
  template_nome     text,
  status_envio      varchar,
  erro_envio        text,
  texto_aproximado  boolean,
  -- controle
  arquivado_em      timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  apagada_em        timestamptz
);

comment on table public.mensagens_arquivo is
  'S-INST-QUAL-11: backup permanente de mensagens (Institucional/Empregabilidade) e de disparos em massa. Sem FK; nunca é apagado.';

create index if not exists mensagens_arquivo_lead_idx      on public.mensagens_arquivo (lead_id);
create index if not exists mensagens_arquivo_conversa_idx  on public.mensagens_arquivo (conversa_id, created_at);
create index if not exists mensagens_arquivo_telefone_idx  on public.mensagens_arquivo (telefone) where telefone is not null;
create index if not exists mensagens_arquivo_created_idx   on public.mensagens_arquivo (created_at);
create index if not exists mensagens_arquivo_wamid_idx     on public.mensagens_arquivo (wamid) where wamid is not null;

create table if not exists public.mensagens_arquivo_falhas (
  id           bigint generated always as identity primary key,
  origem       text not null,
  registro_id  uuid,
  erro         text,
  ocorrido_em  timestamptz not null default now()
);

comment on table public.mensagens_arquivo_falhas is
  'S-INST-QUAL-11: falhas ao copiar para mensagens_arquivo. A mensagem original nunca deixa de ser gravada; a limpeza de 60 dias recupera a cópia que faltar.';

-- ─── 2. Colunas novas em logs_disparo (preenchidas pelo worker) ──────────────

alter table public.logs_disparo add column if not exists texto_enviado text;
alter table public.logs_disparo add column if not exists template_nome text;

comment on column public.logs_disparo.texto_enviado is
  'S-INST-QUAL-11: texto final que a pessoa recebeu (template com as variáveis preenchidas). Nulo se não deu para montar.';
comment on column public.logs_disparo.template_nome is
  'S-INST-QUAL-11: nome do template da Meta usado no envio.';

-- ─── 3. Cópia de mensagens em lote (carga inicial e limpeza) ─────────────────

-- Copia para o backup as mensagens criadas antes de `p_ate` (todas, se nulo) que
-- ainda não estão lá. Retorna quantas copiou.
create or replace function public.mensagens_arquivo_copiar_lote(p_ate timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_qtd integer;
begin
  insert into public.mensagens_arquivo (
    id, origem, conversa_id, lead_id, tipo, conteudo, midia_url, transcricao,
    sentimento, sentimento_score, remetente, created_at, wamid,
    agente_tipo, canal_ativo, unidade_cuca
  )
  select
    m.id, 'mensagens', m.conversa_id, m.lead_id, m.tipo, m.conteudo, m.midia_url, m.transcricao,
    m.sentimento, m.sentimento_score, m.remetente, m.created_at, m.wamid,
    c.agente_tipo, c.canal_ativo, c.metadata->>'unidade_selecionada'
  from public.mensagens m
  left join public.conversas c on c.id = m.conversa_id
  where p_ate is null or m.created_at < p_ate
  on conflict (id) do nothing;

  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

-- ─── 4. Gatilho de cópia em `mensagens` ──────────────────────────────────────

create or replace function public.mensagens_arquivo_copiar_mensagem()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_agente   varchar;
  v_canal    varchar;
  v_unidade  text;
begin
  begin
    -- Gancho de teste (AC4): força a falha só na sessão que ligar a marcação.
    if current_setting('app.arquivo_forcar_falha', true) = 'on' then
      raise exception 'falha forçada (teste S-INST-QUAL-11)';
    end if;

    select c.agente_tipo, c.canal_ativo, c.metadata->>'unidade_selecionada'
      into v_agente, v_canal, v_unidade
    from public.conversas c
    where c.id = new.conversa_id;

    insert into public.mensagens_arquivo (
      id, origem, conversa_id, lead_id, tipo, conteudo, midia_url, transcricao,
      sentimento, sentimento_score, remetente, created_at, wamid,
      agente_tipo, canal_ativo, unidade_cuca
    ) values (
      new.id, 'mensagens', new.conversa_id, new.lead_id, new.tipo, new.conteudo, new.midia_url, new.transcricao,
      new.sentimento, new.sentimento_score, new.remetente, new.created_at, new.wamid,
      v_agente, v_canal, v_unidade
    )
    on conflict (id) do update set
      conversa_id      = excluded.conversa_id,
      lead_id          = excluded.lead_id,
      tipo             = excluded.tipo,
      conteudo         = excluded.conteudo,
      -- `expirar-anexos-conversas` zera midia_url depois de 15 dias; o backup
      -- guarda a chave antiga.
      midia_url        = coalesce(excluded.midia_url, mensagens_arquivo.midia_url),
      transcricao      = excluded.transcricao,
      sentimento       = excluded.sentimento,
      sentimento_score = excluded.sentimento_score,
      remetente        = excluded.remetente,
      created_at       = excluded.created_at,
      wamid            = excluded.wamid,
      agente_tipo      = coalesce(mensagens_arquivo.agente_tipo, excluded.agente_tipo),
      canal_ativo      = coalesce(mensagens_arquivo.canal_ativo, excluded.canal_ativo),
      unidade_cuca     = coalesce(mensagens_arquivo.unidade_cuca, excluded.unidade_cuca),
      atualizado_em    = now();
  exception when others then
    -- Nunca deixa a mensagem original de ser gravada.
    begin
      insert into public.mensagens_arquivo_falhas (origem, registro_id, erro)
      values ('mensagens', new.id, sqlstate || ': ' || sqlerrm);
    exception when others then
      null;
    end;
  end;
  return null;
end;
$$;

drop trigger if exists mensagens_arquivo_copiar on public.mensagens;
create trigger mensagens_arquivo_copiar
  after insert or update on public.mensagens
  for each row execute function public.mensagens_arquivo_copiar_mensagem();

-- ─── 5. Gatilho de cópia em `logs_disparo` ───────────────────────────────────

-- agente_tipo do disparo: canal_tipo do número em meta_phone_numbers, casado pelo
-- `instancia_uazapi` do disparo (que guarda o phone_number_id). Sem filtro de
-- `ativo` (o número antigo do Institucional está inativo). Sem número
-- reconhecido, fica 'Institucional' (todo disparo em massa hoje sai por ele).
create or replace function public.mensagens_arquivo_copiar_disparo()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_modelo   text;
  v_inst     text;
  v_tipo     text;
  v_ref      uuid;
  v_agente   varchar;
  v_canal    varchar;
begin
  begin
    if current_setting('app.arquivo_forcar_falha', true) = 'on' then
      raise exception 'falha forçada (teste S-INST-QUAL-11)';
    end if;

    if new.disparo_id is not null then
      select d.mensagem_template, d.instancia_uazapi into v_modelo, v_inst
      from public.disparos d where d.id = new.disparo_id;
      v_tipo := 'campanha';
      v_ref  := new.disparo_id;
    elsif new.disparo_divulgacao_id is not null then
      select d.mensagem_template, d.instancia_uazapi into v_modelo, v_inst
      from public.disparos_divulgacao d where d.id = new.disparo_divulgacao_id;
      v_tipo := 'divulgacao';
      v_ref  := new.disparo_divulgacao_id;
    end if;

    select p.canal_tipo, 'meta' into v_agente, v_canal
    from public.meta_phone_numbers p
    where p.phone_number_id = v_inst
    limit 1;

    insert into public.mensagens_arquivo (
      id, origem, conversa_id, lead_id, tipo, conteudo, remetente, created_at, wamid,
      agente_tipo, canal_ativo, telefone, disparo_tipo, disparo_ref_id, template_nome,
      status_envio, erro_envio, texto_aproximado
    ) values (
      new.id, 'disparo', null, new.lead_id, 'template',
      coalesce(new.texto_enviado, v_modelo), 'disparo',
      coalesce(new.enviado_em, new.created_at), new.wamid,
      coalesce(v_agente, 'Institucional'), v_canal, new.telefone, v_tipo, v_ref, new.template_nome,
      new.status, new.erro, new.texto_enviado is null
    )
    on conflict (id) do update set
      lead_id          = excluded.lead_id,
      telefone         = excluded.telefone,
      wamid            = excluded.wamid,
      status_envio     = excluded.status_envio,
      erro_envio       = excluded.erro_envio,
      template_nome    = coalesce(excluded.template_nome, mensagens_arquivo.template_nome),
      -- Só troca o texto quando chega o texto final; o modelo nunca sobrescreve.
      conteudo         = case when excluded.texto_aproximado = false
                              then excluded.conteudo else mensagens_arquivo.conteudo end,
      texto_aproximado = case when excluded.texto_aproximado = false
                              then false else mensagens_arquivo.texto_aproximado end,
      atualizado_em    = now();
  exception when others then
    begin
      insert into public.mensagens_arquivo_falhas (origem, registro_id, erro)
      values ('disparo', new.id, sqlstate || ': ' || sqlerrm);
    exception when others then
      null;
    end;
  end;
  return null;
end;
$$;

drop trigger if exists mensagens_arquivo_copiar on public.logs_disparo;
create trigger mensagens_arquivo_copiar
  after insert or update on public.logs_disparo
  for each row execute function public.mensagens_arquivo_copiar_disparo();

-- ─── 6. Exclusões só marcam `apagada_em` ─────────────────────────────────────

-- Cobre exclusão em cascata (lead, conversa, disparo) e a mensagem desfeita pelo
-- chat. Se a cópia não existir (falha anterior), ela é criada já marcada. A
-- limpeza de 60 dias liga `app.arquivo_limpeza` e não é marcada.
create or replace function public.mensagens_arquivo_marcar_mensagem_apagada()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if current_setting('app.arquivo_limpeza', true) = 'on' then
    return null;
  end if;
  begin
    insert into public.mensagens_arquivo (
      id, origem, conversa_id, lead_id, tipo, conteudo, midia_url, transcricao,
      sentimento, sentimento_score, remetente, created_at, wamid,
      agente_tipo, canal_ativo, unidade_cuca, apagada_em
    )
    select
      o.id, 'mensagens', o.conversa_id, o.lead_id, o.tipo, o.conteudo, o.midia_url, o.transcricao,
      o.sentimento, o.sentimento_score, o.remetente, o.created_at, o.wamid,
      c.agente_tipo, c.canal_ativo, c.metadata->>'unidade_selecionada', now()
    from linhas_apagadas o
    left join public.conversas c on c.id = o.conversa_id
    on conflict (id) do update set
      apagada_em    = coalesce(mensagens_arquivo.apagada_em, now()),
      atualizado_em = now();
  exception when others then
    begin
      insert into public.mensagens_arquivo_falhas (origem, registro_id, erro)
      values ('mensagens_exclusao', null, sqlstate || ': ' || sqlerrm);
    exception when others then
      null;
    end;
  end;
  return null;
end;
$$;

drop trigger if exists mensagens_arquivo_marcar_apagada on public.mensagens;
create trigger mensagens_arquivo_marcar_apagada
  after delete on public.mensagens
  referencing old table as linhas_apagadas
  for each statement execute function public.mensagens_arquivo_marcar_mensagem_apagada();

create or replace function public.mensagens_arquivo_marcar_disparo_apagado()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  begin
    insert into public.mensagens_arquivo (
      id, origem, lead_id, tipo, conteudo, remetente, created_at, wamid,
      agente_tipo, telefone, disparo_tipo, disparo_ref_id, template_nome,
      status_envio, erro_envio, texto_aproximado, apagada_em
    )
    select
      o.id, 'disparo', o.lead_id, 'template', o.texto_enviado, 'disparo',
      coalesce(o.enviado_em, o.created_at), o.wamid,
      'Institucional', o.telefone,
      case when o.disparo_id is not null then 'campanha'
           when o.disparo_divulgacao_id is not null then 'divulgacao' end,
      coalesce(o.disparo_id, o.disparo_divulgacao_id), o.template_nome,
      o.status, o.erro, o.texto_enviado is null, now()
    from linhas_apagadas o
    on conflict (id) do update set
      apagada_em    = coalesce(mensagens_arquivo.apagada_em, now()),
      atualizado_em = now();
  exception when others then
    begin
      insert into public.mensagens_arquivo_falhas (origem, registro_id, erro)
      values ('disparo_exclusao', null, sqlstate || ': ' || sqlerrm);
    exception when others then
      null;
    end;
  end;
  return null;
end;
$$;

drop trigger if exists mensagens_arquivo_marcar_apagada on public.logs_disparo;
create trigger mensagens_arquivo_marcar_apagada
  after delete on public.logs_disparo
  referencing old table as linhas_apagadas
  for each statement execute function public.mensagens_arquivo_marcar_disparo_apagado();

-- ─── 7. Carga inicial (depois dos gatilhos) ──────────────────────────────────

select public.mensagens_arquivo_copiar_lote(null);

insert into public.mensagens_arquivo (
  id, origem, conversa_id, lead_id, tipo, conteudo, remetente, created_at, wamid,
  agente_tipo, canal_ativo, telefone, disparo_tipo, disparo_ref_id, template_nome,
  status_envio, erro_envio, texto_aproximado
)
select
  l.id, 'disparo', null, l.lead_id, 'template',
  coalesce(l.texto_enviado, d.mensagem_template, dd.mensagem_template), 'disparo',
  coalesce(l.enviado_em, l.created_at), l.wamid,
  coalesce(p.canal_tipo, 'Institucional'),
  case when p.phone_number_id is not null then 'meta' end,
  l.telefone,
  case when l.disparo_id is not null then 'campanha'
       when l.disparo_divulgacao_id is not null then 'divulgacao' end,
  coalesce(l.disparo_id, l.disparo_divulgacao_id), l.template_nome,
  l.status, l.erro, l.texto_enviado is null
from public.logs_disparo l
left join public.disparos d             on d.id  = l.disparo_id
left join public.disparos_divulgacao dd on dd.id = l.disparo_divulgacao_id
left join lateral (
  select mp.canal_tipo, mp.phone_number_id
  from public.meta_phone_numbers mp
  where mp.phone_number_id = coalesce(d.instancia_uazapi, dd.instancia_uazapi)
  limit 1
) p on true
on conflict (id) do nothing;

-- ─── 8. Limpeza segura de 60 dias ────────────────────────────────────────────

-- 1º copia o que faltar; 2º apaga de `mensagens` só o que tem cópia. A marcação
-- de sessão impede que o gatilho de exclusão marque `apagada_em` nessas linhas, e
-- é desligada no fim para não afetar outros DELETEs da mesma transação.
create or replace function public.limpar_mensagens_arquivadas_60d()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_corte     timestamptz := now() - interval '60 days';
  v_copiadas  integer;
  v_apagadas  integer;
begin
  v_copiadas := public.mensagens_arquivo_copiar_lote(v_corte);

  perform set_config('app.arquivo_limpeza', 'on', true);

  delete from public.mensagens m
  where m.created_at < v_corte
    and exists (select 1 from public.mensagens_arquivo a where a.id = m.id);
  get diagnostics v_apagadas = row_count;

  perform set_config('app.arquivo_limpeza', 'off', true);

  return jsonb_build_object('copiadas', v_copiadas, 'apagadas', v_apagadas, 'corte', v_corte);
end;
$$;

-- Funções com SECURITY DEFINER: ninguém de fora chama.
revoke all on function public.mensagens_arquivo_copiar_lote(timestamptz) from public, anon, authenticated;
revoke all on function public.limpar_mensagens_arquivadas_60d() from public, anon, authenticated;
revoke all on function public.mensagens_arquivo_copiar_mensagem() from public, anon, authenticated;
revoke all on function public.mensagens_arquivo_copiar_disparo() from public, anon, authenticated;
revoke all on function public.mensagens_arquivo_marcar_mensagem_apagada() from public, anon, authenticated;
revoke all on function public.mensagens_arquivo_marcar_disparo_apagado() from public, anon, authenticated;

-- ─── 9. Jobs ─────────────────────────────────────────────────────────────────

-- O job de 60 dias passa a chamar a função segura, mas continua DESLIGADO.
-- Ele é religado numa migration própria, depois dos testes (AC10).
do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id from cron.job where jobname = 'limpar_mensagens_antigas_60d';
  if v_job_id is not null then
    perform cron.alter_job(
      job_id  := v_job_id,
      command := 'select public.limpar_mensagens_arquivadas_60d()',
      active  := false
    );
  end if;

  -- Job duplicado de logs_webhook (o `limpeza-logs-webhook` das 03:00 continua).
  if exists (select 1 from cron.job where jobname = 'limpar_logs_webhook_60d') then
    perform cron.unschedule('limpar_logs_webhook_60d');
  end if;
end
$$;

-- ─── 10. Acesso ──────────────────────────────────────────────────────────────

alter table public.mensagens_arquivo enable row level security;
alter table public.mensagens_arquivo_falhas enable row level security;

revoke all on public.mensagens_arquivo from anon, authenticated;
revoke all on public.mensagens_arquivo_falhas from anon, authenticated;
grant select on public.mensagens_arquivo to authenticated;
grant select on public.mensagens_arquivo_falhas to authenticated;

drop policy if exists mensagens_arquivo_leitura_developer on public.mensagens_arquivo;
create policy mensagens_arquivo_leitura_developer on public.mensagens_arquivo
  for select to authenticated
  using (public.is_developer());

drop policy if exists mensagens_arquivo_falhas_leitura_developer on public.mensagens_arquivo_falhas;
create policy mensagens_arquivo_falhas_leitura_developer on public.mensagens_arquivo_falhas
  for select to authenticated
  using (public.is_developer());
