-- S-PLA-02: projeto do Planejamento (ficha completa), listas filhas e tabela única de eventos.
-- Aditiva e idempotente: só cria objetos novos; nada existente muda.
--
-- Escrita: só pela função `pla_salvar_projeto` (SECURITY DEFINER), que confere permissão, setor e a
-- regra de status (AC15) e grava a ficha e as listas numa transação só. Insert/update/delete direto
-- nas tabelas fica revogado de `anon` e `authenticated`. Leitura: RLS com a função de escopo da
-- S-PLA-01 (`pla_pode_atuar_setor`) + `has_permission`.
-- Permissões de ação única (matriz de Perfis grava só `can_read`): sempre checadas com 'read'.

-- 1. Projeto ------------------------------------------------------------------------------------
create table if not exists public.planejamento_projetos (
    id uuid primary key default gen_random_uuid(),
    ano smallint not null default 2027 check (ano between 2027 and 2100),

    -- 1. Identificação
    nome text not null check (length(btrim(nome)) > 0),
    tipo text not null check (tipo in ('evento_pontual', 'atividade_continua', 'projeto')),
    setor_id text not null references public.planejamento_setores(id),
    responsavel_nome text,
    responsavel_contato text,

    -- 2. Relação com 2026
    situacao_2026 text check (situacao_2026 in ('mantem', 'mantem_ajustes', 'novo', 'encerrado')),
    mudancas_2026 text,
    justificativa_2026 text,

    -- 3. Objetivos e público (objetivos específicos na tabela filha)
    objetivo_geral text,
    publico_alvo text,
    faixa_etaria_min smallint check (faixa_etaria_min between 0 and 120),
    faixa_etaria_max smallint check (faixa_etaria_max between 0 and 120),
    participantes_estimados integer check (participantes_estimados >= 0),

    -- 4. Execução
    periodo_ano_todo boolean not null default false,
    data_inicio date,
    data_fim date,
    duracao text,
    frequencia text check (frequencia in ('evento_unico', 'semanal', 'duas_vezes_semana', 'quinzenal', 'mensal', 'outra')),
    frequencia_outra text,
    dias_horarios text,
    locais_unidades uuid[] not null default '{}',
    local_outro boolean not null default false,
    local_outro_texto text,
    como_sera_realizado text,

    -- 7. Resultados de 2026 e observações
    resultados_2026_participantes integer check (resultados_2026_participantes >= 0),
    resultados_2026_principais text,
    resultados_2026_funcionou text,
    resultados_2026_melhorar text,
    observacoes text,

    -- Ciclo
    status text not null default 'em_construcao'
        check (status in ('em_construcao', 'projeto_salvo', 'aprovado', 'em_execucao', 'concluido', 'reprovado')),
    ficha text not null default 'parcial' check (ficha in ('parcial', 'final')),

    -- Autoria: id do auth.users (as contas Developer podem não ter cadastro de colaborador)
    criado_por uuid,
    criado_por_nome text,
    atualizado_por uuid,
    atualizado_por_nome text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),

    constraint planejamento_projetos_faixa_ck
        check (faixa_etaria_min is null or faixa_etaria_max is null or faixa_etaria_min <= faixa_etaria_max),
    constraint planejamento_projetos_datas_ano_ck
        check ((data_inicio is null or extract(year from data_inicio) = ano)
           and (data_fim is null or extract(year from data_fim) = ano)),
    constraint planejamento_projetos_datas_ordem_ck
        check (data_inicio is null or data_fim is null or data_fim >= data_inicio),
    constraint planejamento_projetos_ano_todo_ck
        check (not periodo_ano_todo or (data_inicio is null and data_fim is null))
);
create index if not exists planejamento_projetos_setor_idx on public.planejamento_projetos (setor_id);
create index if not exists planejamento_projetos_ano_idx on public.planejamento_projetos (ano);

-- 2. Listas filhas ------------------------------------------------------------------------------
create table if not exists public.planejamento_projeto_objetivos (
    id uuid primary key default gen_random_uuid(),
    projeto_id uuid not null references public.planejamento_projetos(id) on delete cascade,
    ordem smallint not null,
    texto text not null check (length(btrim(texto)) > 0)
);
create index if not exists planejamento_projeto_objetivos_projeto_idx
    on public.planejamento_projeto_objetivos (projeto_id, ordem);

create table if not exists public.planejamento_projeto_orcamento (
    id uuid primary key default gen_random_uuid(),
    projeto_id uuid not null references public.planejamento_projetos(id) on delete cascade,
    ordem smallint not null,
    item text,
    categoria text check (categoria in ('material', 'espaco', 'transporte', 'alimentacao', 'divulgacao', 'servicos', 'outros')),
    quantidade numeric(12,2) check (quantidade >= 0),
    valor_unitario numeric(12,2) check (valor_unitario >= 0),
    valor_total numeric(14,2) generated always as (round(coalesce(quantidade, 0) * coalesce(valor_unitario, 0), 2)) stored
);
create index if not exists planejamento_projeto_orcamento_projeto_idx
    on public.planejamento_projeto_orcamento (projeto_id, ordem);

create table if not exists public.planejamento_projeto_metas (
    id uuid primary key default gen_random_uuid(),
    projeto_id uuid not null references public.planejamento_projetos(id) on delete cascade,
    ordem smallint not null,
    meta text,
    indicador text,
    resultado_esperado text
);
create index if not exists planejamento_projeto_metas_projeto_idx
    on public.planejamento_projeto_metas (projeto_id, ordem);

-- 3. Tabela única de eventos do projeto (AC17). `tipo` é texto: a S-PLA-03 e a S-PLA-04 só
-- acrescentam valores. Nesta story: criacao, salvar_projeto, ficha_voltou_parcial.
create table if not exists public.planejamento_projeto_eventos (
    id uuid primary key default gen_random_uuid(),
    projeto_id uuid not null references public.planejamento_projetos(id) on delete cascade,
    tipo text not null check (tipo ~ '^[a-z][a-z0-9_]*$'),
    detalhe jsonb not null default '{}'::jsonb,
    autor_id uuid,
    autor_nome text,
    created_at timestamptz not null default now()
);
create index if not exists planejamento_projeto_eventos_projeto_idx
    on public.planejamento_projeto_eventos (projeto_id, created_at);

-- 4. RLS: leitura no escopo do setor com `pla_proj_ver` ou `pla_proj_editar` (quem edita precisa
-- ler a ficha). Fora do escopo, a linha simplesmente não existe para o usuário (AC14).
alter table public.planejamento_projetos enable row level security;
alter table public.planejamento_projeto_objetivos enable row level security;
alter table public.planejamento_projeto_orcamento enable row level security;
alter table public.planejamento_projeto_metas enable row level security;
alter table public.planejamento_projeto_eventos enable row level security;

drop policy if exists planejamento_projetos_select on public.planejamento_projetos;
create policy planejamento_projetos_select on public.planejamento_projetos
    for select to authenticated
    using (
        ((select public.has_permission('pla_proj_ver', 'read')) or (select public.has_permission('pla_proj_editar', 'read')))
        and public.pla_pode_atuar_setor(setor_id)
    );

-- As filhas herdam a visibilidade do projeto (a subconsulta passa pela RLS de planejamento_projetos).
drop policy if exists planejamento_projeto_objetivos_select on public.planejamento_projeto_objetivos;
create policy planejamento_projeto_objetivos_select on public.planejamento_projeto_objetivos
    for select to authenticated
    using (exists (select 1 from public.planejamento_projetos p where p.id = projeto_id));

drop policy if exists planejamento_projeto_orcamento_select on public.planejamento_projeto_orcamento;
create policy planejamento_projeto_orcamento_select on public.planejamento_projeto_orcamento
    for select to authenticated
    using (exists (select 1 from public.planejamento_projetos p where p.id = projeto_id));

drop policy if exists planejamento_projeto_metas_select on public.planejamento_projeto_metas;
create policy planejamento_projeto_metas_select on public.planejamento_projeto_metas
    for select to authenticated
    using (exists (select 1 from public.planejamento_projetos p where p.id = projeto_id));

drop policy if exists planejamento_projeto_eventos_select on public.planejamento_projeto_eventos;
create policy planejamento_projeto_eventos_select on public.planejamento_projeto_eventos
    for select to authenticated
    using (exists (select 1 from public.planejamento_projetos p where p.id = projeto_id));

revoke all on public.planejamento_projetos, public.planejamento_projeto_objetivos,
    public.planejamento_projeto_orcamento, public.planejamento_projeto_metas,
    public.planejamento_projeto_eventos from anon;
revoke insert, update, delete, truncate on public.planejamento_projetos, public.planejamento_projeto_objetivos,
    public.planejamento_projeto_orcamento, public.planejamento_projeto_metas,
    public.planejamento_projeto_eventos from authenticated;
grant select on public.planejamento_projetos, public.planejamento_projeto_objetivos,
    public.planejamento_projeto_orcamento, public.planejamento_projeto_metas,
    public.planejamento_projeto_eventos to authenticated;

-- 5. Nome de quem está logado: cadastro de colaborador; sem cadastro (conta Developer), o e-mail.
create or replace function public.pla_nome_usuario()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce(
        (select nullif(btrim(c.nome_completo), '') from public.colaboradores c where c.user_id = auth.uid() limit 1),
        (select u.email::text from auth.users u where u.id = auth.uid())
    );
$$;
revoke execute on function public.pla_nome_usuario() from public, anon;
grant execute on function public.pla_nome_usuario() to authenticated;

-- 6. Gravação da ficha (AC6, AC7, AC8, AC9, AC15, AC17).
-- p_id null = projeto novo (exige `pla_proj_criar`); com id = projeto existente (exige `pla_proj_editar`,
-- também para o autor). p_modo: 'parcial' (Salvar parcial), 'final' (Salvar projeto) ou 'manter'
-- (botão "Salvar" da caixa de saída: mantém a ficha como estava; projeto novo nasce parcial).
-- Status: só Em construção ↔ Projeto salvo acompanham o botão; os quatro status manuais nunca mudam aqui.
create or replace function public.pla_salvar_projeto(p_id uuid, p_modo text, p_dados jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid uuid := auth.uid();
    v_nome_usuario text;
    v_atual public.planejamento_projetos%rowtype;
    v_id uuid;
    v_nome text := nullif(btrim(p_dados->>'nome'), '');
    v_tipo text := nullif(btrim(p_dados->>'tipo'), '');
    v_setor text := nullif(btrim(p_dados->>'setor_id'), '');
    v_ano_todo boolean := coalesce((p_dados->>'periodo_ano_todo')::boolean, false);
    v_locais uuid[];
    v_ficha text;
    v_status text;
    v_ficha_anterior text;
    v_status_anterior text;
begin
    if v_uid is null then
        raise exception 'Sessão expirada. Entre de novo no portal.' using errcode = '42501';
    end if;
    if p_modo is null or p_modo not in ('parcial', 'final', 'manter') then
        raise exception 'Modo de gravação inválido.' using errcode = '22023';
    end if;
    if p_dados is null or jsonb_typeof(p_dados) <> 'object' then
        raise exception 'Dados do projeto inválidos.' using errcode = '22023';
    end if;
    if v_nome is null then
        raise exception 'Preencha o nome do projeto.' using errcode = '22023';
    end if;
    if v_tipo is null then
        raise exception 'Escolha o tipo do projeto.' using errcode = '22023';
    end if;
    if v_setor is null then
        raise exception 'Escolha o setor do projeto.' using errcode = '22023';
    end if;
    if not exists (select 1 from public.planejamento_setores s where s.id = v_setor) then
        raise exception 'Setor inválido.' using errcode = '22023';
    end if;

    v_locais := coalesce(array(
        select distinct (x)::uuid from jsonb_array_elements_text(coalesce(p_dados->'locais_unidades', '[]'::jsonb)) as x
    ), '{}');
    if exists (select 1 from unnest(v_locais) as u where not exists (select 1 from public.unidades_cuca uc where uc.id = u)) then
        raise exception 'Unidade inválida no local do projeto.' using errcode = '22023';
    end if;

    v_nome_usuario := public.pla_nome_usuario();

    if p_id is null then
        if not coalesce(public.has_permission('pla_proj_criar', 'read'), false) then
            raise exception 'Sem permissão para criar projetos.' using errcode = '42501';
        end if;
        if not public.pla_pode_atuar_setor(v_setor) then
            raise exception 'Você não pode criar projeto neste setor.' using errcode = '42501';
        end if;
        v_ficha := case when p_modo = 'final' then 'final' else 'parcial' end;
        v_status := case when v_ficha = 'final' then 'projeto_salvo' else 'em_construcao' end;
        v_id := gen_random_uuid();
        insert into public.planejamento_projetos (id, nome, tipo, setor_id, status, ficha, criado_por, criado_por_nome)
        values (v_id, v_nome, v_tipo, v_setor, v_status, v_ficha, v_uid, v_nome_usuario);
        insert into public.planejamento_projeto_eventos (projeto_id, tipo, detalhe, autor_id, autor_nome)
        values (v_id, 'criacao', jsonb_build_object('status', v_status, 'ficha', v_ficha), v_uid, v_nome_usuario);
    else
        if not coalesce(public.has_permission('pla_proj_editar', 'read'), false) then
            raise exception 'Sem permissão para editar projetos.' using errcode = '42501';
        end if;
        select * into v_atual from public.planejamento_projetos where id = p_id for update;
        -- Fora do escopo do setor: mesma resposta de projeto inexistente (não revela que existe).
        if not found or not public.pla_pode_atuar_setor(v_atual.setor_id) then
            raise exception 'Projeto não encontrado.' using errcode = 'P0002';
        end if;
        if v_setor <> v_atual.setor_id and not public.pla_pode_atuar_setor(v_setor) then
            raise exception 'Você não pode mover o projeto para este setor.' using errcode = '42501';
        end if;
        v_id := p_id;
        v_ficha_anterior := v_atual.ficha;
        v_status_anterior := v_atual.status;
        v_ficha := case p_modo when 'final' then 'final' when 'parcial' then 'parcial' else v_atual.ficha end;
        v_status := case
            when v_atual.status in ('em_construcao', 'projeto_salvo') then
                case p_modo when 'final' then 'projeto_salvo' when 'parcial' then 'em_construcao' else v_atual.status end
            else v_atual.status
        end;
        delete from public.planejamento_projeto_objetivos where projeto_id = v_id;
        delete from public.planejamento_projeto_orcamento where projeto_id = v_id;
        delete from public.planejamento_projeto_metas where projeto_id = v_id;
    end if;

    update public.planejamento_projetos set
        nome = v_nome,
        tipo = v_tipo,
        setor_id = v_setor,
        responsavel_nome = nullif(btrim(p_dados->>'responsavel_nome'), ''),
        responsavel_contato = nullif(btrim(p_dados->>'responsavel_contato'), ''),
        situacao_2026 = nullif(btrim(p_dados->>'situacao_2026'), ''),
        mudancas_2026 = nullif(btrim(p_dados->>'mudancas_2026'), ''),
        justificativa_2026 = nullif(btrim(p_dados->>'justificativa_2026'), ''),
        objetivo_geral = nullif(btrim(p_dados->>'objetivo_geral'), ''),
        publico_alvo = nullif(btrim(p_dados->>'publico_alvo'), ''),
        faixa_etaria_min = (nullif(btrim(p_dados->>'faixa_etaria_min'), ''))::smallint,
        faixa_etaria_max = (nullif(btrim(p_dados->>'faixa_etaria_max'), ''))::smallint,
        participantes_estimados = (nullif(btrim(p_dados->>'participantes_estimados'), ''))::integer,
        periodo_ano_todo = v_ano_todo,
        data_inicio = case when v_ano_todo then null else (nullif(btrim(p_dados->>'data_inicio'), ''))::date end,
        data_fim = case when v_ano_todo then null else (nullif(btrim(p_dados->>'data_fim'), ''))::date end,
        duracao = nullif(btrim(p_dados->>'duracao'), ''),
        frequencia = nullif(btrim(p_dados->>'frequencia'), ''),
        frequencia_outra = nullif(btrim(p_dados->>'frequencia_outra'), ''),
        dias_horarios = nullif(btrim(p_dados->>'dias_horarios'), ''),
        locais_unidades = v_locais,
        local_outro = coalesce((p_dados->>'local_outro')::boolean, false),
        local_outro_texto = nullif(btrim(p_dados->>'local_outro_texto'), ''),
        como_sera_realizado = nullif(btrim(p_dados->>'como_sera_realizado'), ''),
        resultados_2026_participantes = (nullif(btrim(p_dados->>'resultados_2026_participantes'), ''))::integer,
        resultados_2026_principais = nullif(btrim(p_dados->>'resultados_2026_principais'), ''),
        resultados_2026_funcionou = nullif(btrim(p_dados->>'resultados_2026_funcionou'), ''),
        resultados_2026_melhorar = nullif(btrim(p_dados->>'resultados_2026_melhorar'), ''),
        observacoes = nullif(btrim(p_dados->>'observacoes'), ''),
        status = v_status,
        ficha = v_ficha,
        atualizado_por = v_uid,
        atualizado_por_nome = v_nome_usuario,
        updated_at = now()
    where id = v_id;

    insert into public.planejamento_projeto_objetivos (projeto_id, ordem, texto)
    select v_id, row_number() over (order by o.n), btrim(o.e->>'texto')
    from jsonb_array_elements(coalesce(p_dados->'objetivos', '[]'::jsonb)) with ordinality as o(e, n)
    where nullif(btrim(o.e->>'texto'), '') is not null;

    insert into public.planejamento_projeto_orcamento (projeto_id, ordem, item, categoria, quantidade, valor_unitario)
    select v_id, row_number() over (order by o.n),
        nullif(btrim(o.e->>'item'), ''),
        nullif(btrim(o.e->>'categoria'), ''),
        (nullif(btrim(o.e->>'quantidade'), ''))::numeric,
        (nullif(btrim(o.e->>'valor_unitario'), ''))::numeric
    from jsonb_array_elements(coalesce(p_dados->'orcamento', '[]'::jsonb)) with ordinality as o(e, n)
    where coalesce(nullif(btrim(o.e->>'item'), ''), nullif(btrim(o.e->>'categoria'), ''),
                   nullif(btrim(o.e->>'quantidade'), ''), nullif(btrim(o.e->>'valor_unitario'), '')) is not null;

    insert into public.planejamento_projeto_metas (projeto_id, ordem, meta, indicador, resultado_esperado)
    select v_id, row_number() over (order by o.n),
        nullif(btrim(o.e->>'meta'), ''),
        nullif(btrim(o.e->>'indicador'), ''),
        nullif(btrim(o.e->>'resultado_esperado'), '')
    from jsonb_array_elements(coalesce(p_dados->'metas', '[]'::jsonb)) with ordinality as o(e, n)
    where coalesce(nullif(btrim(o.e->>'meta'), ''), nullif(btrim(o.e->>'indicador'), ''),
                   nullif(btrim(o.e->>'resultado_esperado'), '')) is not null;

    if p_modo = 'final' then
        insert into public.planejamento_projeto_eventos (projeto_id, tipo, detalhe, autor_id, autor_nome)
        values (v_id, 'salvar_projeto',
            jsonb_build_object('status_anterior', v_status_anterior, 'status', v_status), v_uid, v_nome_usuario);
    end if;
    if v_ficha_anterior = 'final' and v_ficha = 'parcial' then
        insert into public.planejamento_projeto_eventos (projeto_id, tipo, detalhe, autor_id, autor_nome)
        values (v_id, 'ficha_voltou_parcial',
            jsonb_build_object('status_anterior', v_status_anterior, 'status', v_status), v_uid, v_nome_usuario);
    end if;

    return jsonb_build_object(
        'id', v_id,
        'status', v_status,
        'ficha', v_ficha,
        'ficha_anterior', v_ficha_anterior,
        'atualizado_em', now()
    );
end;
$$;
revoke execute on function public.pla_salvar_projeto(uuid, text, jsonb) from public, anon;
grant execute on function public.pla_salvar_projeto(uuid, text, jsonb) to authenticated;
