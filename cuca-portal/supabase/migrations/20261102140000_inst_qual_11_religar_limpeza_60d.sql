-- S-INST-QUAL-11 (AC10) — Religa a limpeza de 60 dias de `mensagens`, agora com a
-- função segura `limpar_mensagens_arquivadas_60d()` (só apaga o que já tem cópia
-- em `mensagens_arquivo`).
--
-- Aplicar só depois dos testes AC2–AC9 passarem. Busca o job pelo nome;
-- idempotente: rodar de novo não muda nada, e sem o job não faz nada.

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'limpar_mensagens_antigas_60d';

  if v_job_id is not null then
    perform cron.alter_job(
      job_id  := v_job_id,
      command := 'select public.limpar_mensagens_arquivadas_60d()',
      active  := true
    );
  end if;
end
$$;
