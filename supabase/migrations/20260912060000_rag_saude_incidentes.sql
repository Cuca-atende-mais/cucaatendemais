-- S-WM-AUD-007 (AC6, 2a metade) — deteccao automatica dos dois estados que deixam uma unidade
-- MUDA sobre programacao, e que hoje so aparecem se alguem fizer varredura manual:
--   (a) unidade sem nenhum `monthly_program` ativo;
--   (b) unidade COM documento ativo mas com ZERO chunks (indexacao que nunca completou).
--
-- Os dois produzem a MESMA falha percebida pelo cidadao. O incidente de 2026-09-11, que derrubou
-- Mondubim e Jangurussu por horas, foi do tipo (a) e so foi descoberto por acaso.
--
-- Por que aqui e nao em `alertas-institucionais`: aquela Edge Function e event-driven (recebe
-- `record`/`table` de trigger) e dispara TEMPLATE WhatsApp pra colaboradores. Checagem periodica
-- de saude nao e evento, e disparo proativo na Meta exige template pre-aprovado — dependencia
-- externa que nao da pra resolver em codigo. Esta migration entrega a DETECCAO com registro
-- duravel e consultavel; o canal de notificacao fica como passo seguinte, com o template.

create table if not exists public.rag_saude_incidentes (
  id uuid primary key default gen_random_uuid(),
  detectado_em timestamptz not null default now(),
  unidade_cuca text not null,
  problema text not null,          -- 'sem_documento_ativo' | 'documento_ativo_sem_chunks'
  detalhe text,
  resolvido_em timestamptz,
  unique (unidade_cuca, problema, resolvido_em)
);

create index if not exists idx_rag_saude_abertos on public.rag_saude_incidentes (unidade_cuca, problema) where resolvido_em is null;

alter table public.rag_saude_incidentes enable row level security;
drop policy if exists "rag_saude_incidentes_service_role_only" on public.rag_saude_incidentes;
create policy "rag_saude_incidentes_service_role_only"
  on public.rag_saude_incidentes for all to service_role using (true) with check (true);

-- Fonte da verdade das 5 unidades: as que JA tiveram programacao aprovada alguma vez. Evita
-- hardcodar nome de unidade e evita alarme falso numa unidade que ainda nao entrou no sistema.
create or replace function public.verificar_saude_rag_institucional()
returns table (unidade_cuca text, problema text, detalhe text)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  with unidades as (
    select distinct c.unidade_cuca from public.campanhas_mensais c where c.status = 'aprovado'
  ),
  ativos as (
    select d.unidade_cuca, d.id,
           (select count(*) from public.chunks_documentos ch where ch.documento_id = d.id) as chunks
    from public.documentos_rag d
    where d.tipo = 'monthly_program' and d.ativo = true
  )
  select u.unidade_cuca, 'sem_documento_ativo'::text,
         'Nenhum monthly_program ativo — o agente nao consegue responder nada de programacao'::text
  from unidades u
  where not exists (select 1 from ativos a where a.unidade_cuca = u.unidade_cuca)
  union all
  select a.unidade_cuca, 'documento_ativo_sem_chunks'::text,
         'Documento ativo ' || a.id::text || ' sem chunks — indexacao nao completou'
  from ativos a
  where a.chunks = 0;
$function$;

revoke execute on function public.verificar_saude_rag_institucional() from public, anon, authenticated;
grant execute on function public.verificar_saude_rag_institucional() to service_role;

-- Abre incidente novo e fecha o que voltou ao normal. Idempotente: rodar N vezes com o mesmo
-- estado nao gera linha duplicada (o unique parcial em resolvido_em IS NULL garante 1 aberto por
-- unidade+problema).
create or replace function public.registrar_saude_rag_institucional()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
BEGIN
  INSERT INTO public.rag_saude_incidentes (unidade_cuca, problema, detalhe)
  SELECT v.unidade_cuca, v.problema, v.detalhe
  FROM public.verificar_saude_rag_institucional() v
  WHERE NOT EXISTS (
    SELECT 1 FROM public.rag_saude_incidentes i
    WHERE i.unidade_cuca = v.unidade_cuca AND i.problema = v.problema AND i.resolvido_em IS NULL
  );

  UPDATE public.rag_saude_incidentes i
  SET resolvido_em = now()
  WHERE i.resolvido_em IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.verificar_saude_rag_institucional() v
      WHERE v.unidade_cuca = i.unidade_cuca AND v.problema = i.problema
    );
END;
$function$;

revoke execute on function public.registrar_saude_rag_institucional() from public, anon, authenticated;
grant execute on function public.registrar_saude_rag_institucional() to service_role;

-- A cada 15 min: o incidente de 11/09 durou horas. Mesmo padrao dos outros 10 jobs do projeto.
select cron.unschedule('verificar-saude-rag-institucional')
where exists (select 1 from cron.job where jobname = 'verificar-saude-rag-institucional');
select cron.schedule('verificar-saude-rag-institucional', '*/15 * * * *',
                     $$select public.registrar_saude_rag_institucional()$$);
