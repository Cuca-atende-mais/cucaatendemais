-- Desliga a limpeza automática de mensagens com mais de 60 dias.
--
-- O job `limpar_mensagens_antigas_60d` (pg_cron, todo dia às 02:00) rodava
-- `DELETE FROM mensagens WHERE created_at < NOW() - INTERVAL '60 days'` sem
-- guardar cópia em lugar nenhum. A tabela `mensagens` atende Institucional e
-- Empregabilidade. Decisão do Junior em 02/11/2026: nenhuma mensagem pode ser
-- apagada enquanto não houver cópia guardada antes (S-INST-QUAL-11).
--
-- O job só é desativado: o comando continua salvo em cron.job e pode ser
-- religado com cron.alter_job(job_id, active := true). Idempotente: rodar de
-- novo não muda nada, e se o job não existir não faz nada.

do $$
declare
  v_job_id bigint;
begin
  select jobid into v_job_id
  from cron.job
  where jobname = 'limpar_mensagens_antigas_60d';

  if v_job_id is not null then
    perform cron.alter_job(job_id := v_job_id, active := false);
  end if;
end
$$;
