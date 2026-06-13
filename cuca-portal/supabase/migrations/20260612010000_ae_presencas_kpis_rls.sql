-- C-1 (S-AE-11): a leitura de ae_presencas era exigida só por ae_presenca:read, mas o dashboard de KPIs
-- é protegido por ae_kpis:read. Sem isso, um perfil só com ae_kpis veria o dashboard vazio.
-- Amplia a policy de SELECT para aceitar ae_presenca:read OU ae_kpis:read (mantém a granularidade da S-AE-01).
drop policy if exists "ae_presencas: select via ae_presenca:read" on public.ae_presencas;

create policy "ae_presencas: select via ae_presenca ou ae_kpis"
on public.ae_presencas for select
to authenticated
using (
  public.has_permission('ae_presenca', 'read')
  or public.has_permission('ae_kpis', 'read')
);
