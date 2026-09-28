-- ACHADO-014 (frente custo-llm): o currículo espontâneo era gravado em talent_bank procurando o
-- telefone EXATAMENTE como veio — mas a tabela guarda telefones em pelo menos 6 formatos
-- ("(85) 99999-9999", "(85)999999999", "85 99999-9999", só dígitos...). A análise de IA era paga
-- e o resultado se perdia em silêncio.
-- Esta função compara só os dígitos (sem o 55 do país, quando houver) dos dois lados.
-- Aditiva e idempotente (create or replace).

create or replace function public.normalizar_telefone_digitos(p_telefone text)
returns text
language sql
immutable
as $$
  select case
           when d ~ '^55[0-9]{10,11}$' then substr(d, 3)
           else d
         end
  from (select regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g') as d) x;
$$;

-- Grava as habilidades extraídas no talento com esse telefone. Devolve quantas linhas mudaram
-- (0 = nenhum talento com esse telefone; o chamador loga e não trata como sucesso).
create or replace function public.atualizar_skills_talento_por_telefone(p_telefone text, p_skills jsonb)
returns integer
language sql
as $$
  with u as (
    update public.talent_bank
       set skills_jsonb = p_skills,
           updated_at   = now()
     where public.normalizar_telefone_digitos(telefone) = public.normalizar_telefone_digitos(p_telefone)
       and public.normalizar_telefone_digitos(p_telefone) <> ''
    returning 1
  )
  select count(*)::integer from u;
$$;

revoke all on function public.atualizar_skills_talento_por_telefone(text, jsonb) from public, anon, authenticated;
grant execute on function public.atualizar_skills_talento_por_telefone(text, jsonb) to service_role;
