-- S-PLA-03: exclusão lógica, troca manual de status, duplicar e excluir projeto.
-- Aditiva e idempotente. Objetos existentes que mudam (só para ignorar projeto excluído):
--   * policy de leitura `planejamento_projetos_select` (ganha `excluido_em is null`);
--   * função `pla_salvar_projeto`: corpo idêntico ao da S-PLA-02, só a guarda de "Projeto não
--     encontrado" passa a valer também para projeto excluído.
-- Escrita continua só por funções SECURITY DEFINER (search_path fixo, execução só para authenticated).
-- Permissões de ação única: sempre checadas com 'read' (a matriz de Perfis grava só `can_read`).
-- Tipos novos na tabela única de eventos: `status_alterado` e `exclusao`; a cópia grava `criacao`
-- com `duplicado_de` no detalhe.

-- 1. Exclusão lógica (AC9): o dado fica guardado, o projeto some de todas as telas.
alter table public.planejamento_projetos add column if not exists excluido_em timestamptz;
alter table public.planejamento_projetos add column if not exists excluido_por uuid;
alter table public.planejamento_projetos add column if not exists excluido_por_nome text;

-- 2. Leitura: excluído não aparece para ninguém pelo portal. As listas filhas e os eventos herdam
-- pela subconsulta das policies da S-PLA-02 (que passa por esta policy).
drop policy if exists planejamento_projetos_select on public.planejamento_projetos;
create policy planejamento_projetos_select on public.planejamento_projetos
    for select to authenticated
    using (
        excluido_em is null
        and ((select public.has_permission('pla_proj_ver', 'read')) or (select public.has_permission('pla_proj_editar', 'read')))
        and public.pla_pode_atuar_setor(setor_id)
    );

-- 3. Quem pode ler projetos (mesma regra de permissão da policy): usado pelas ações abaixo para que
-- ninguém duplique, exclua ou mude o status de um projeto que não conseguiria abrir.
create or replace function public.pla_pode_ler_projetos()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    select coalesce(public.has_permission('pla_proj_ver', 'read'), false)
        or coalesce(public.has_permission('pla_proj_editar', 'read'), false);
$$;
revoke execute on function public.pla_pode_ler_projetos() from public, anon;
grant execute on function public.pla_pode_ler_projetos() to authenticated;

-- 4. Gravação da ficha (S-PLA-02), agora recusando projeto excluído.
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
        if not found or v_atual.excluido_em is not null or not public.pla_pode_atuar_setor(v_atual.setor_id) then
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
-- 5. Troca manual de status (AC11 a AC14). Permissão por destino, escopo de setor, sem ordem
-- obrigatória, observação opcional. 'ficha' = "Voltar ao status da ficha": Em construção (ficha
-- parcial) ou Projeto salvo (ficha final); a partir daí o status volta a acompanhar os botões.
-- Não mexe em "Atualizado por/em" (que é da ficha): a troca fica no evento `status_alterado`.
create or replace function public.pla_mudar_status(p_id uuid, p_destino text, p_observacao text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid uuid := auth.uid();
    v_nome_usuario text;
    v_atual public.planejamento_projetos%rowtype;
    v_permissao text;
    v_novo text;
    v_obs text := nullif(btrim(p_observacao), '');
begin
    if v_uid is null then
        raise exception 'Sessão expirada. Entre de novo no portal.' using errcode = '42501';
    end if;
    v_permissao := case p_destino
        when 'aprovado' then 'pla_status_aprovado'
        when 'em_execucao' then 'pla_status_execucao'
        when 'concluido' then 'pla_status_concluido'
        when 'reprovado' then 'pla_status_reprovado'
        when 'ficha' then 'pla_status_ficha'
    end;
    if v_permissao is null then
        raise exception 'Status inválido.' using errcode = '22023';
    end if;
    if not coalesce(public.has_permission(v_permissao, 'read'), false) then
        raise exception 'Sem permissão para marcar este status.' using errcode = '42501';
    end if;
    if v_obs is not null and length(v_obs) > 2000 then
        raise exception 'O motivo da mudança pode ter até 2.000 caracteres.' using errcode = '22023';
    end if;

    select * into v_atual from public.planejamento_projetos where id = p_id for update;
    if not found or v_atual.excluido_em is not null
       or not public.pla_pode_ler_projetos() or not public.pla_pode_atuar_setor(v_atual.setor_id) then
        raise exception 'Projeto não encontrado.' using errcode = 'P0002';
    end if;

    v_novo := case
        when p_destino = 'ficha' then case v_atual.ficha when 'final' then 'projeto_salvo' else 'em_construcao' end
        else p_destino
    end;
    if v_novo = v_atual.status then
        raise exception 'O projeto já está com esse status.' using errcode = '22023';
    end if;

    v_nome_usuario := public.pla_nome_usuario();
    update public.planejamento_projetos set status = v_novo where id = p_id;
    insert into public.planejamento_projeto_eventos (projeto_id, tipo, detalhe, autor_id, autor_nome)
    values (p_id, 'status_alterado',
        jsonb_build_object('status_anterior', v_atual.status, 'status', v_novo, 'destino', p_destino, 'observacao', v_obs),
        v_uid, v_nome_usuario);

    return jsonb_build_object('status', v_novo, 'status_anterior', v_atual.status, 'alterado_em', now(), 'alterado_por', v_nome_usuario);
end;
$$;
revoke execute on function public.pla_mudar_status(uuid, text, text) from public, anon;
grant execute on function public.pla_mudar_status(uuid, text, text) to authenticated;

-- 6. Duplicar (AC8): cópia "{nome} (cópia)", mesmo setor, todas as listas, Em construção / parcial.
-- Tudo numa transação só. O setor é o do original, que já passou pelo escopo.
create or replace function public.pla_duplicar_projeto(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid uuid := auth.uid();
    v_nome_usuario text;
    v_orig public.planejamento_projetos%rowtype;
    v_id uuid := gen_random_uuid();
begin
    if v_uid is null then
        raise exception 'Sessão expirada. Entre de novo no portal.' using errcode = '42501';
    end if;
    if not coalesce(public.has_permission('pla_proj_duplicar', 'read'), false) then
        raise exception 'Sem permissão para duplicar projetos.' using errcode = '42501';
    end if;
    select * into v_orig from public.planejamento_projetos where id = p_id;
    if not found or v_orig.excluido_em is not null
       or not public.pla_pode_ler_projetos() or not public.pla_pode_atuar_setor(v_orig.setor_id) then
        raise exception 'Projeto não encontrado.' using errcode = 'P0002';
    end if;

    v_nome_usuario := public.pla_nome_usuario();

    insert into public.planejamento_projetos (
        id, ano, nome, tipo, setor_id, responsavel_nome, responsavel_contato,
        situacao_2026, mudancas_2026, justificativa_2026,
        objetivo_geral, publico_alvo, faixa_etaria_min, faixa_etaria_max, participantes_estimados,
        periodo_ano_todo, data_inicio, data_fim, duracao, frequencia, frequencia_outra, dias_horarios,
        locais_unidades, local_outro, local_outro_texto, como_sera_realizado,
        resultados_2026_participantes, resultados_2026_principais, resultados_2026_funcionou,
        resultados_2026_melhorar, observacoes,
        status, ficha, criado_por, criado_por_nome, atualizado_por, atualizado_por_nome
    )
    select
        v_id, o.ano, o.nome || ' (cópia)', o.tipo, o.setor_id, o.responsavel_nome, o.responsavel_contato,
        o.situacao_2026, o.mudancas_2026, o.justificativa_2026,
        o.objetivo_geral, o.publico_alvo, o.faixa_etaria_min, o.faixa_etaria_max, o.participantes_estimados,
        o.periodo_ano_todo, o.data_inicio, o.data_fim, o.duracao, o.frequencia, o.frequencia_outra, o.dias_horarios,
        o.locais_unidades, o.local_outro, o.local_outro_texto, o.como_sera_realizado,
        o.resultados_2026_participantes, o.resultados_2026_principais, o.resultados_2026_funcionou,
        o.resultados_2026_melhorar, o.observacoes,
        'em_construcao', 'parcial', v_uid, v_nome_usuario, v_uid, v_nome_usuario
    from public.planejamento_projetos o
    where o.id = p_id;

    insert into public.planejamento_projeto_objetivos (projeto_id, ordem, texto)
    select v_id, ordem, texto from public.planejamento_projeto_objetivos where projeto_id = p_id;
    insert into public.planejamento_projeto_orcamento (projeto_id, ordem, item, categoria, quantidade, valor_unitario)
    select v_id, ordem, item, categoria, quantidade, valor_unitario from public.planejamento_projeto_orcamento where projeto_id = p_id;
    insert into public.planejamento_projeto_metas (projeto_id, ordem, meta, indicador, resultado_esperado)
    select v_id, ordem, meta, indicador, resultado_esperado from public.planejamento_projeto_metas where projeto_id = p_id;

    insert into public.planejamento_projeto_eventos (projeto_id, tipo, detalhe, autor_id, autor_nome)
    values (v_id, 'criacao',
        jsonb_build_object('status', 'em_construcao', 'ficha', 'parcial', 'duplicado_de', p_id, 'duplicado_de_nome', v_orig.nome),
        v_uid, v_nome_usuario);

    return jsonb_build_object('id', v_id);
end;
$$;
revoke execute on function public.pla_duplicar_projeto(uuid) from public, anon;
grant execute on function public.pla_duplicar_projeto(uuid) to authenticated;

-- 7. Excluir (AC9): exclusão lógica, com quem e quando, e evento `exclusao`.
create or replace function public.pla_excluir_projeto(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_uid uuid := auth.uid();
    v_nome_usuario text;
    v_atual public.planejamento_projetos%rowtype;
begin
    if v_uid is null then
        raise exception 'Sessão expirada. Entre de novo no portal.' using errcode = '42501';
    end if;
    if not coalesce(public.has_permission('pla_proj_excluir', 'read'), false) then
        raise exception 'Sem permissão para excluir projetos.' using errcode = '42501';
    end if;
    select * into v_atual from public.planejamento_projetos where id = p_id for update;
    if not found or v_atual.excluido_em is not null
       or not public.pla_pode_ler_projetos() or not public.pla_pode_atuar_setor(v_atual.setor_id) then
        raise exception 'Projeto não encontrado.' using errcode = 'P0002';
    end if;

    v_nome_usuario := public.pla_nome_usuario();
    update public.planejamento_projetos
        set excluido_em = now(), excluido_por = v_uid, excluido_por_nome = v_nome_usuario
        where id = p_id;
    insert into public.planejamento_projeto_eventos (projeto_id, tipo, detalhe, autor_id, autor_nome)
    values (p_id, 'exclusao', jsonb_build_object('status', v_atual.status, 'ficha', v_atual.ficha), v_uid, v_nome_usuario);

    return jsonb_build_object('id', p_id, 'excluido_em', now());
end;
$$;
revoke execute on function public.pla_excluir_projeto(uuid) from public, anon;
grant execute on function public.pla_excluir_projeto(uuid) to authenticated;
