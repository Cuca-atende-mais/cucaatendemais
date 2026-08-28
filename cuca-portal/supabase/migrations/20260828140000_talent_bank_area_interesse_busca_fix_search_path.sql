-- Corrige achado de segurança do @qa (lint function_search_path_mutable, WARN) sobre a
-- função criada em 20260828120000_talent_bank_area_interesse_busca.sql: fixa search_path
-- para evitar resolução de schema mutável (boa prática do Supabase para toda função nova).

create or replace function talent_bank_set_area_interesse_busca()
returns trigger
language plpgsql
set search_path = public
as $$
begin
    new.area_interesse_busca := array_to_string(new.area_interesse, ' ');
    return new;
end;
$$;
