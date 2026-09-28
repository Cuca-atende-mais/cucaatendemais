-- PLANO-028 (frente custo-llm): reserva atômica no processamento de currículo.
-- O loop `ocr_pending_loop` e o endpoint `POST /process-cv` podiam processar o mesmo currículo
-- ao mesmo tempo (pagando a análise de IA duas vezes e gravando um resultado arbitrário).
-- Agora os dois passam por `reservar_ocr_candidatura`, um UPDATE condicional que só um
-- executor vence, e fecham com `finalizar_ocr_candidatura`, que só vale para o dono da reserva.
--
-- Emenda ao plano: a elegibilidade usa `matching_score is null` (análise ainda não concluída),
-- NÃO `dados_ocr_json is null`. A convocação do Banco de Talentos cria a candidatura já com as
-- habilidades do talento em `dados_ocr_json` e em seguida pede a análise contra a vaga; com o
-- critério do plano, essa análise nunca rodaria. `matching_score` só é preenchido pelo sucesso
-- de `process_cv_ocr`.
--
-- Aditiva e idempotente. `ocr_tentativas` continua existindo (anti-starvation após falha).

alter table public.candidaturas
  add column if not exists ocr_status        text,
  add column if not exists ocr_reservado_em  timestamptz,
  add column if not exists ocr_reservado_por text,
  add column if not exists ocr_token         uuid;

comment on column public.candidaturas.ocr_status is
  'PLANO-028: null | processando | ok | erro. Reserva do processamento de currículo; não substitui ocr_tentativas.';
comment on column public.candidaturas.ocr_token is
  'PLANO-028: identifica a reserva atual. Toda gravação do resultado confere o token — uma execução expirada não sobrescreve quem assumiu depois.';

create index if not exists ix_candidaturas_ocr_reserva
  on public.candidaturas (ocr_status, ocr_reservado_em)
  where ocr_status is not null;

-- Devolve o token da reserva se este executor ganhou, NULL se não (outro executor com a
-- candidatura, análise já concluída ou teto de tentativas). A reserva expira em 10 min, para
-- não prender a candidatura se o worker cair no meio.
create or replace function public.reservar_ocr_candidatura(
  p_candidatura_id uuid,
  p_executor text,
  p_max_tentativas integer default 3
) returns uuid
language sql
as $$
  update public.candidaturas
     set ocr_status        = 'processando',
         ocr_reservado_em  = now(),
         ocr_reservado_por = p_executor,
         ocr_token         = gen_random_uuid(),
         ocr_tentativas    = coalesce(ocr_tentativas, 0) + 1
   where id = p_candidatura_id
     and matching_score is null
     and coalesce(ocr_tentativas, 0) < p_max_tentativas
     and (ocr_status is null
          or ocr_status in ('erro', 'ok')
          or (ocr_status = 'processando' and ocr_reservado_em < now() - interval '10 minutes'))
  returning ocr_token;
$$;

-- Fecha a reserva com 'ok' ou 'erro'. Devolve false se a reserva não é mais deste executor.
create or replace function public.finalizar_ocr_candidatura(
  p_candidatura_id uuid,
  p_token uuid,
  p_status text
) returns boolean
language sql
as $$
  with f as (
    update public.candidaturas
       set ocr_status = p_status
     where id = p_candidatura_id
       and ocr_token = p_token
       and p_status in ('ok', 'erro')
    returning 1
  )
  select exists (select 1 from f);
$$;

revoke all on function public.reservar_ocr_candidatura(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.finalizar_ocr_candidatura(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reservar_ocr_candidatura(uuid, text, integer) to service_role;
grant execute on function public.finalizar_ocr_candidatura(uuid, uuid, text) to service_role;
