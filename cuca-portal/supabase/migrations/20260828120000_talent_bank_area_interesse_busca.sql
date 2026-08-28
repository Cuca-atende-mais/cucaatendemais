-- Corrige o filtro por área do Banco de Talentos (produção quebrada desde 2026-04-03,
-- commit 1e845fd): o front-end filtrava com `area_interesse::text` + ilike via PostgREST,
-- mas o cast só é aplicado pelo PostgREST quando também está declarado no `select` —
-- como o select é "*", o cast era ignorado e o Postgres tentava `ilike` direto na coluna
-- text[], retornando 42883 (operator does not exist: text[] ~~* unknown), que o PostgREST
-- traduz em HTTP 404. Isso quebrava 100% dos cliques nos cards de área.
--
-- Solução: coluna `area_interesse_busca` (text[] -> string), mantida por trigger
-- (não coluna gerada — array_to_string() é STABLE, não IMMUTABLE, e o Postgres não aceita
-- funções STABLE em generated column), com índice trigram para suportar ilike de
-- substring. O front-end passa a filtrar nessa coluna normal, sem cast na URL.

create extension if not exists pg_trgm;

alter table talent_bank
    add column if not exists area_interesse_busca text;

create or replace function talent_bank_set_area_interesse_busca()
returns trigger
language plpgsql
as $$
begin
    new.area_interesse_busca := array_to_string(new.area_interesse, ' ');
    return new;
end;
$$;

drop trigger if exists trg_talent_bank_area_interesse_busca on talent_bank;

create trigger trg_talent_bank_area_interesse_busca
    before insert or update of area_interesse on talent_bank
    for each row
    execute function talent_bank_set_area_interesse_busca();

-- Backfill dos registros existentes (idempotente: mesmo resultado a cada execução).
update talent_bank
    set area_interesse_busca = array_to_string(area_interesse, ' ')
    where area_interesse_busca is distinct from array_to_string(area_interesse, ' ');

create index if not exists idx_talent_bank_area_interesse_busca_trgm
    on talent_bank using gin (area_interesse_busca gin_trgm_ops);
