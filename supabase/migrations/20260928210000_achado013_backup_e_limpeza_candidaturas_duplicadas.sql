-- ACHADO-013 (frente custo-llm): candidaturas repetidas criadas pelo Banco de Talentos.
-- A tela de aprovar talento para a vaga não verificava duplicidade, e a rota de convocação
-- comparava telefone "" com NULL — cada clique criava uma candidatura nova (e uma nova análise
-- de IA do mesmo currículo). O código foi corrigido no mesmo PR.
--
-- Decisão (Junior + sócio, 28/09/2026): guardar cópia das repetidas e apagar.
-- Regra de qual fica: por (talento, vaga), a que já teve andamento (status <> 'pendente'); se
-- nenhuma teve, a mais antiga. As apagadas eram todas 'pendente'. Conferido antes de aplicar:
-- nenhuma é referenciada por banco_talentos.candidatura_original_id nem tem
-- empregabilidade_followup.
--
-- Idempotente: a cópia só é criada uma vez; o DELETE apaga só o que está na cópia.

create table if not exists public.candidaturas_duplicadas_backup_20260928 as
select c.*, now() as backup_em
from public.candidaturas c
join (
  select id,
         row_number() over (partition by observacoes, vaga_id
                            order by (status <> 'pendente') desc, created_at asc) as rn
  from public.candidaturas
  where observacoes like 'banco_talentos:%' and vaga_id is not null
) r on r.id = c.id
where r.rn > 1;

-- Tabela de backup com dado pessoal: RLS ligada e sem policy — só service_role acessa.
alter table public.candidaturas_duplicadas_backup_20260928 enable row level security;
comment on table public.candidaturas_duplicadas_backup_20260928 is
  'Cópia das candidaturas repetidas do Banco de Talentos apagadas em 28/09/2026 (ACHADO-013). Para restaurar: insert into candidaturas select <colunas> from esta tabela.';

delete from public.candidaturas
where id in (select id from public.candidaturas_duplicadas_backup_20260928);
