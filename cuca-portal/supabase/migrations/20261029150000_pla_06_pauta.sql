-- S-PLA-06: ordem da pauta de apresentações (setores e projetos), a mesma para todos.
-- Aditiva e idempotente: só cria 2 tabelas e 2 funções. Nada existente muda.
--
-- Ordem efetiva (a mesma regra em `lib/planejamento/pauta.ts`):
--   * setores: os que têm posição salva, pela posição; depois os outros, pela ordem de exibição do setor;
--   * projetos de um setor: os que têm posição salva NESTE setor, pela posição; depois os outros
--     (projeto novo ou que mudou de setor), por data de criação. Assim projeto novo entra no fim.
-- Gravação: só pelas funções abaixo (SECURITY DEFINER, search_path fixo, execução só para
-- authenticated), com `pla_apresent_ver` + `pla_apresent_ordem` e escopo de setor. A tela manda a
-- nova ordem só do que a pessoa vê; os itens que ela não vê (encerrados escondidos, setores de fora do
-- escopo) mantêm as suas posições, e os visíveis ocupam, na nova ordem, as posições que já eram deles.

-- 1. Tabelas ------------------------------------------------------------------------------------
create table if not exists public.planejamento_pauta_setores (
    ano smallint not null check (ano between 2027 and 2100),
    setor_id text not null references public.planejamento_setores(id),
    posicao integer not null check (posicao > 0),
    atualizado_por uuid,
    atualizado_em timestamptz not null default now(),
    primary key (ano, setor_id)
);

create table if not exists public.planejamento_pauta_projetos (
    projeto_id uuid primary key references public.planejamento_projetos(id) on delete cascade,
    -- Setor em que a posição vale: se o projeto mudar de setor, a posição antiga é ignorada.
    setor_id text not null references public.planejamento_setores(id),
    posicao integer not null check (posicao > 0),
    atualizado_por uuid,
    atualizado_em timestamptz not null default now()
);
create index if not exists planejamento_pauta_projetos_setor_idx on public.planejamento_pauta_projetos (setor_id, posicao);

-- 2. Leitura (RLS) ------------------------------------------------------------------------------
alter table public.planejamento_pauta_setores enable row level security;
alter table public.planejamento_pauta_projetos enable row level security;

drop policy if exists planejamento_pauta_setores_select on public.planejamento_pauta_setores;
create policy planejamento_pauta_setores_select on public.planejamento_pauta_setores
    for select to authenticated
    using ((select public.has_permission('pla_apresent_ver', 'read')));

-- A posição de um projeto só é lida por quem vê o projeto (a subconsulta passa pela RLS do projeto).
drop policy if exists planejamento_pauta_projetos_select on public.planejamento_pauta_projetos;
create policy planejamento_pauta_projetos_select on public.planejamento_pauta_projetos
    for select to authenticated
    using ((select public.has_permission('pla_apresent_ver', 'read'))
        and exists (select 1 from public.planejamento_projetos p where p.id = projeto_id));

revoke all on public.planejamento_pauta_setores, public.planejamento_pauta_projetos from anon;
revoke insert, update, delete, truncate on public.planejamento_pauta_setores, public.planejamento_pauta_projetos from authenticated;
grant select on public.planejamento_pauta_setores, public.planejamento_pauta_projetos to authenticated;

-- 3. Ordem dos setores ----------------------------------------------------------------------------
create or replace function public.pla_pauta_ordenar_setores(p_ano integer, p_setores text[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid uuid := auth.uid();
    v_atual text[];
    v_novo text[] := '{}';
    v_proximo integer := 1;
    v_setor text;
begin
    if v_uid is null then
        raise exception 'Sessão expirada. Entre de novo no portal.' using errcode = '42501';
    end if;
    if not (coalesce(public.has_permission('pla_apresent_ver', 'read'), false)
            and coalesce(public.has_permission('pla_apresent_ordem', 'read'), false)) then
        raise exception 'Sem permissão para mudar a ordem da pauta.' using errcode = '42501';
    end if;
    if p_ano is null or p_ano not between 2027 and 2100 then
        raise exception 'Ano inválido.' using errcode = '22023';
    end if;
    if p_setores is null or cardinality(p_setores) = 0
       or cardinality(p_setores) <> (select count(distinct x) from unnest(p_setores) as x) then
        raise exception 'Ordem de setores inválida.' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtext('pla_pauta_setores_' || p_ano));

    v_atual := array(
        select s.id from public.planejamento_setores s
        left join public.planejamento_pauta_setores ps on ps.setor_id = s.id and ps.ano = p_ano
        order by (ps.posicao is null), ps.posicao, s.ordem, s.id
    );
    foreach v_setor in array p_setores loop
        if not (v_setor = any(v_atual)) then
            raise exception 'Setor inválido.' using errcode = '22023';
        end if;
        if not public.pla_pode_atuar_setor(v_setor) then
            raise exception 'Você não pode mudar a ordem deste setor.' using errcode = '42501';
        end if;
    end loop;

    -- Os setores enviados ocupam, na nova ordem, as posições que já eram deles.
    foreach v_setor in array v_atual loop
        if v_setor = any(p_setores) then
            v_novo := v_novo || p_setores[v_proximo];
            v_proximo := v_proximo + 1;
        else
            v_novo := v_novo || v_setor;
        end if;
    end loop;

    insert into public.planejamento_pauta_setores (ano, setor_id, posicao, atualizado_por, atualizado_em)
    select p_ano, x.setor, x.n, v_uid, now()
    from unnest(v_novo) with ordinality as x(setor, n)
    on conflict (ano, setor_id) do update
        set posicao = excluded.posicao, atualizado_por = excluded.atualizado_por, atualizado_em = excluded.atualizado_em;

    return jsonb_build_object('setores', to_jsonb(v_novo));
end;
$$;
revoke execute on function public.pla_pauta_ordenar_setores(integer, text[]) from public, anon;
grant execute on function public.pla_pauta_ordenar_setores(integer, text[]) to authenticated;

-- 4. Ordem dos projetos de um setor -----------------------------------------------------------
create or replace function public.pla_pauta_ordenar_projetos(p_ano integer, p_setor text, p_projetos uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid uuid := auth.uid();
    v_atual uuid[];
    v_novo uuid[] := '{}';
    v_proximo integer := 1;
    v_id uuid;
begin
    if v_uid is null then
        raise exception 'Sessão expirada. Entre de novo no portal.' using errcode = '42501';
    end if;
    if not (coalesce(public.has_permission('pla_apresent_ver', 'read'), false)
            and coalesce(public.has_permission('pla_apresent_ordem', 'read'), false)) then
        raise exception 'Sem permissão para mudar a ordem da pauta.' using errcode = '42501';
    end if;
    if p_ano is null or p_ano not between 2027 and 2100 then
        raise exception 'Ano inválido.' using errcode = '22023';
    end if;
    if p_setor is null or not exists (select 1 from public.planejamento_setores s where s.id = p_setor) then
        raise exception 'Setor inválido.' using errcode = '22023';
    end if;
    -- Fora do escopo: mesma resposta de setor sem projetos visíveis (não revela o que há nele).
    if not public.pla_pode_ler_projetos() or not public.pla_pode_atuar_setor(p_setor) then
        raise exception 'Projeto não encontrado.' using errcode = 'P0002';
    end if;
    if p_projetos is null or cardinality(p_projetos) = 0
       or cardinality(p_projetos) <> (select count(distinct x) from unnest(p_projetos) as x) then
        raise exception 'Ordem de projetos inválida.' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtext('pla_pauta_projetos_' || p_ano || '_' || p_setor));

    v_atual := array(
        select p.id from public.planejamento_projetos p
        left join public.planejamento_pauta_projetos pp on pp.projeto_id = p.id and pp.setor_id = p.setor_id
        where p.ano = p_ano and p.setor_id = p_setor and p.excluido_em is null
        order by (pp.posicao is null), pp.posicao, p.created_at, p.id
    );
    foreach v_id in array p_projetos loop
        if not (v_id = any(v_atual)) then
            raise exception 'Projeto não encontrado.' using errcode = 'P0002';
        end if;
    end loop;

    foreach v_id in array v_atual loop
        if v_id = any(p_projetos) then
            v_novo := v_novo || p_projetos[v_proximo];
            v_proximo := v_proximo + 1;
        else
            v_novo := v_novo || v_id;
        end if;
    end loop;

    insert into public.planejamento_pauta_projetos (projeto_id, setor_id, posicao, atualizado_por, atualizado_em)
    select x.id, p_setor, x.n, v_uid, now()
    from unnest(v_novo) with ordinality as x(id, n)
    on conflict (projeto_id) do update
        set setor_id = excluded.setor_id, posicao = excluded.posicao,
            atualizado_por = excluded.atualizado_por, atualizado_em = excluded.atualizado_em;

    return jsonb_build_object('projetos', to_jsonb(v_novo));
end;
$$;
revoke execute on function public.pla_pauta_ordenar_projetos(integer, text, uuid[]) from public, anon;
grant execute on function public.pla_pauta_ordenar_projetos(integer, text, uuid[]) to authenticated;
