-- S-INST-QUAL-12 — Central de alertas para as contas Developer (parte 1: estrutura, sem gatilhos).
--
-- Cria:
--   - `alertas_sistema`: alerta genérico (qualquer processo pode gravar, hoje só o RAG);
--   - `alertas_leitura`: quem leu qual alerta (contagem de não lidos por pessoa);
--   - funções do portal (contar, listar com páginas, marcar como lido), que rodam com o papel de
--     quem chama e dependem da RLS;
--   - o segredo do cabeçalho da chamada ao e-mail, gerado no próprio cofre (o valor nunca aparece
--     neste arquivo) e lido só pelo `service_role`;
--   - as configurações `alertas_email_destino` e `alertas_email_funcao_url` em `system_config`.
--
-- Os gatilhos (incidente do RAG → alerta, alerta → e-mail) ficam na migration seguinte,
-- aplicada só depois do deploy da Edge Function `enviar-alerta-email`. Assim nenhuma chamada sai
-- para uma função que ainda não existe.
--
-- Acesso: só as duas contas Developer leem (`public.is_developer()`, que confere o e-mail em
-- auth.users e por isso vale também sem `profile`). Cada pessoa grava só a própria leitura. Só o
-- banco e o `service_role` criam ou alteram alertas.
--
-- Idempotente e só aditiva: `if not exists`, `create or replace`, `drop policy if exists`,
-- `on conflict do nothing`.

-- 1. Tabelas ---------------------------------------------------------------------------------

create table if not exists public.alertas_sistema (
  id uuid primary key default gen_random_uuid(),
  origem text not null,
  tipo text not null,
  severidade text not null default 'atencao'
    constraint alertas_sistema_severidade_check check (severidade in ('info', 'atencao', 'critico')),
  titulo text not null,
  detalhe text,
  acao_sugerida text,
  referencia_id uuid,
  criado_em timestamptz not null default now(),
  resolvido_em timestamptz,
  email_enviado_em timestamptz,
  email_erro text
);

comment on table public.alertas_sistema is
  'Central de alertas (S-INST-QUAL-12). Lida só pelas contas Developer. origem+referencia_id ligam ao registro que gerou o alerta (ex.: rag_saude → rag_saude_incidentes.id).';

create index if not exists idx_alertas_sistema_criado_em on public.alertas_sistema (criado_em desc);
create unique index if not exists uq_alertas_sistema_origem_referencia
  on public.alertas_sistema (origem, referencia_id) where referencia_id is not null;

create table if not exists public.alertas_leitura (
  alerta_id uuid not null references public.alertas_sistema (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  lido_em timestamptz not null default now(),
  primary key (alerta_id, user_id)
);

create index if not exists idx_alertas_leitura_user on public.alertas_leitura (user_id);

-- 2. Permissões e RLS --------------------------------------------------------------------------
-- O Supabase concede tudo a anon/authenticated em tabela nova do schema public; aqui fica só o
-- necessário.

revoke all on public.alertas_sistema from public, anon, authenticated;
grant select on public.alertas_sistema to authenticated;
grant all on public.alertas_sistema to service_role;

revoke all on public.alertas_leitura from public, anon, authenticated;
grant select, insert on public.alertas_leitura to authenticated;
grant all on public.alertas_leitura to service_role;

alter table public.alertas_sistema enable row level security;
alter table public.alertas_leitura enable row level security;

drop policy if exists alertas_sistema_leitura_developer on public.alertas_sistema;
create policy alertas_sistema_leitura_developer on public.alertas_sistema
  for select to authenticated
  using ((select public.is_developer()));

drop policy if exists alertas_leitura_select_propria on public.alertas_leitura;
create policy alertas_leitura_select_propria on public.alertas_leitura
  for select to authenticated
  using (user_id = (select auth.uid()) and (select public.is_developer()));

drop policy if exists alertas_leitura_insert_propria on public.alertas_leitura;
create policy alertas_leitura_insert_propria on public.alertas_leitura
  for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.is_developer()));

-- 3. Funções do portal (rodam com o papel de quem chama: a RLS decide o que aparece) ----------

create or replace function public.alertas_contar_nao_lidos()
returns integer
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $function$
  select count(*)::integer
  from public.alertas_sistema a
  where not exists (
    select 1 from public.alertas_leitura l
    where l.alerta_id = a.id and l.user_id = auth.uid()
  );
$function$;

create or replace function public.alertas_listar(p_pagina integer default 1, p_por_pagina integer default 10)
returns table (
  id uuid,
  origem text,
  tipo text,
  severidade text,
  titulo text,
  detalhe text,
  acao_sugerida text,
  criado_em timestamptz,
  resolvido_em timestamptz,
  email_enviado_em timestamptz,
  email_erro text,
  lido boolean,
  total bigint
)
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $function$
  select a.id, a.origem, a.tipo, a.severidade, a.titulo, a.detalhe, a.acao_sugerida,
         a.criado_em, a.resolvido_em, a.email_enviado_em, a.email_erro,
         exists (
           select 1 from public.alertas_leitura l
           where l.alerta_id = a.id and l.user_id = auth.uid()
         ) as lido,
         count(*) over () as total
  from public.alertas_sistema a
  order by a.criado_em desc, a.id
  limit greatest(least(coalesce(p_por_pagina, 10), 50), 1)
  offset (greatest(coalesce(p_pagina, 1), 1) - 1) * greatest(least(coalesce(p_por_pagina, 10), 50), 1);
$function$;

-- p_ids nulo = marcar todos como lidos. Devolve quantas leituras novas gravou.
create or replace function public.alertas_marcar_lidos(p_ids uuid[] default null)
returns integer
language sql
volatile
security invoker
set search_path to 'public', 'pg_temp'
as $function$
  with novas as (
    insert into public.alertas_leitura (alerta_id, user_id)
    select a.id, auth.uid()
    from public.alertas_sistema a
    where auth.uid() is not null
      and (p_ids is null or a.id = any (p_ids))
    on conflict (alerta_id, user_id) do nothing
    returning 1
  )
  select count(*)::integer from novas;
$function$;

revoke execute on function public.alertas_contar_nao_lidos() from public, anon;
revoke execute on function public.alertas_listar(integer, integer) from public, anon;
revoke execute on function public.alertas_marcar_lidos(uuid[]) from public, anon;
grant execute on function public.alertas_contar_nao_lidos() to authenticated, service_role;
grant execute on function public.alertas_listar(integer, integer) to authenticated, service_role;
grant execute on function public.alertas_marcar_lidos(uuid[]) to authenticated, service_role;

-- 4. Segredo do cabeçalho da chamada ao e-mail -------------------------------------------------
-- Gerado aqui, dentro do cofre: o valor não passa por arquivo, terminal nem log. O gatilho de
-- envio (próxima migration) manda esse valor no cabeçalho `x-alerta-segredo`; a Edge Function lê
-- o mesmo valor por `alertas_email_segredo()` com a chave de serviço e recusa a chamada se não
-- bater. Para trocar: `select vault.update_secret(id, <novo>) from vault.secrets where name = 'alertas_email_segredo'`.

do $do$
begin
  if not exists (select 1 from vault.secrets where name = 'alertas_email_segredo') then
    perform vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'hex'),
      'alertas_email_segredo',
      'Cabeçalho x-alerta-segredo da chamada banco → Edge Function enviar-alerta-email (S-INST-QUAL-12)'
    );
  end if;
end
$do$;

create or replace function public.alertas_email_segredo()
returns text
language sql
stable
security definer
set search_path to ''
as $function$
  select ds.decrypted_secret from vault.decrypted_secrets ds where ds.name = 'alertas_email_segredo' limit 1;
$function$;

revoke execute on function public.alertas_email_segredo() from public, anon, authenticated;
grant execute on function public.alertas_email_segredo() to service_role;

-- 5. Configuração (trocar sem código) -----------------------------------------------------------

insert into public.system_config (chave, valor, descricao) values
  ('alertas_email_destino', 'dev.cucaatendemais@gmail.com',
   'E-mail que recebe os alertas da central (S-INST-QUAL-12). Mais de um: separar por vírgula.'),
  ('alertas_email_funcao_url', 'https://svzkrkfzpiqcesloukgb.supabase.co/functions/v1/enviar-alerta-email',
   'Endereço da Edge Function que envia o e-mail de cada alerta (S-INST-QUAL-12).')
on conflict (chave) do nothing;
