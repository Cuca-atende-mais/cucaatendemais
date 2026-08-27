-- S-WM-68: agenda a expiração diária de anexos (imagem/PDF) de conversas via
-- pg_cron + pg_net, chamando a Edge Function `expirar-anexos-conversas`.
--
-- Autenticação: usa a anon key legada (formato JWT) tanto em `apikey` quanto
-- em `Authorization: Bearer` — não é segredo (é a mesma chave pública usada
-- em qualquer client-side do projeto), mas PRECISA ser a variante JWT: a
-- publishable key moderna (`sb_publishable_...`) não é um JWT e não passa na
-- checagem verify_jwt da Edge Function via header Authorization. Segue o
-- exemplo oficial do Supabase para "Invoke a Supabase Edge Function" via
-- pg_net+cron. A anon key só autentica a CHAMADA (verify_jwt); a function em
-- si roda com a SERVICE_ROLE_KEY internamente (env var do runtime da Edge
-- Function, nunca exposta aqui) para de fato apagar do Storage e atualizar
-- as tabelas.
--
-- URL/key hardcoded de propósito (não current_setting): o gap de
-- app.supabase_url/app.service_role_key documentado na S-WM-15 continua sem
-- configuração em produção — em vez de depender disso, este job usa a anon
-- key, que não tem esse problema de segredo/config ausente.

create or replace function public.chamar_expirar_anexos_conversas()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url     := 'https://svzkrkfzpiqcesloukgb.supabase.co/functions/v1/expirar-anexos-conversas',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2emtya2Z6cGlxY2VzbG91a2diIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExNTkzMjYsImV4cCI6MjA4NjczNTMyNn0.Mnq1Ca0Lr2NXu5WzxhKusy2yjUpJRKLqNV4oaZlIqoM',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN2emtya2Z6cGlxY2VzbG91a2diIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExNTkzMjYsImV4cCI6MjA4NjczNTMyNn0.Mnq1Ca0Lr2NXu5WzxhKusy2yjUpJRKLqNV4oaZlIqoM'
    ),
    body := '{}'::jsonb
  );
end;
$$;

revoke all on function public.chamar_expirar_anexos_conversas() from public;
grant execute on function public.chamar_expirar_anexos_conversas() to service_role;

select cron.schedule(
  'expirar_anexos_conversas_diario',
  '0 4 * * *', -- 04:00 UTC = 01:00 BRT, fora do horário de pico de atendimento
  $$select public.chamar_expirar_anexos_conversas()$$
)
where not exists (select 1 from cron.job where jobname = 'expirar_anexos_conversas_diario');
