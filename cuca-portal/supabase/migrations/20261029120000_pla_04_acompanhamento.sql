-- S-PLA-04: acompanhamento do projeto — correções pedidas, comentários, validação e pendências.
-- Aditiva e idempotente: só cria tabelas, funções e uma policy novas. Nenhum objeto existente muda.
--
-- Leitura: RLS = `pla_acomp_ver` + projeto visível (a subconsulta passa pela policy de
-- `planejamento_projetos`: setor, permissão de ver/editar e não excluído). AC9.
-- Escrita: só pelas funções SECURITY DEFINER abaixo (search_path fixo, execução só para authenticated).
-- Cada uma exige a permissão da ação + `pla_acomp_ver` + projeto visível (mesma regra da S-PLA-03:
-- ninguém atua num projeto que não conseguiria abrir). A regra "só o próprio comentário" fica na
-- função de editar/excluir, junto da permissão.
-- Permissões de ação única: checadas sempre com 'read' (a matriz de Perfis grava só `can_read`).
-- Tipos novos na tabela única de eventos (S-PLA-02): correcao_pedida, correcao_resolvida, validado,
-- validacao_retirada, pendencia_criada, pendencia_concluida. Ficam ocultos sem `pla_acomp_ver`
-- (policy restritiva nova; os tipos das S-PLA-02/03 continuam como estão).
-- Nada aqui mexe em `planejamento_projetos.updated_at` (que é da ficha): é com ele que a tela sabe
-- se a ficha foi salva depois da validação.

-- 1. Tabelas ------------------------------------------------------------------------------------
create table if not exists public.planejamento_projeto_correcoes (
    id uuid primary key default gen_random_uuid(),
    projeto_id uuid not null references public.planejamento_projetos(id) on delete cascade,
    -- Seção da ficha (1 a 7, as mesmas da S-PLA-02); null = sem seção.
    secao smallint check (secao between 1 and 7),
    texto text not null check (length(btrim(texto)) between 1 and 2000),
    pedido_por uuid,
    pedido_por_nome text,
    created_at timestamptz not null default now(),
    resolvida_em timestamptz,
    resolvida_por uuid,
    resolvida_por_nome text,
    resolucao_obs text check (resolucao_obs is null or length(resolucao_obs) <= 2000)
);
create index if not exists planejamento_projeto_correcoes_projeto_idx
    on public.planejamento_projeto_correcoes (projeto_id, created_at);
create index if not exists planejamento_projeto_correcoes_abertas_idx
    on public.planejamento_projeto_correcoes (projeto_id) where resolvida_em is null;

create table if not exists public.planejamento_projeto_comentarios (
    id uuid primary key default gen_random_uuid(),
    projeto_id uuid not null references public.planejamento_projetos(id) on delete cascade,
    texto text not null check (length(btrim(texto)) between 1 and 2000),
    autor_id uuid not null,
    autor_nome text,
    created_at timestamptz not null default now(),
    editado_em timestamptz
);
create index if not exists planejamento_projeto_comentarios_projeto_idx
    on public.planejamento_projeto_comentarios (projeto_id, created_at);

-- Uma validação por projeto: retirar apaga a linha (o histórico fica nos eventos).
create table if not exists public.planejamento_projeto_validacoes (
    projeto_id uuid primary key references public.planejamento_projetos(id) on delete cascade,
    validado_por uuid,
    validado_por_nome text,
    validado_em timestamptz not null default now()
);

-- Pendências sem prazo e sem data (D9/D10).
create table if not exists public.planejamento_projeto_pendencias (
    id uuid primary key default gen_random_uuid(),
    projeto_id uuid not null references public.planejamento_projetos(id) on delete cascade,
    texto text not null check (length(btrim(texto)) between 1 and 500),
    responsavel text check (responsavel is null or length(responsavel) <= 200),
    feito boolean not null default false,
    feito_por_nome text,
    criado_por uuid,
    criado_por_nome text,
    created_at timestamptz not null default now()
);
create index if not exists planejamento_projeto_pendencias_projeto_idx
    on public.planejamento_projeto_pendencias (projeto_id, created_at);

-- 2. RLS de leitura (AC9) -----------------------------------------------------------------------
alter table public.planejamento_projeto_correcoes enable row level security;
alter table public.planejamento_projeto_comentarios enable row level security;
alter table public.planejamento_projeto_validacoes enable row level security;
alter table public.planejamento_projeto_pendencias enable row level security;

drop policy if exists planejamento_projeto_correcoes_select on public.planejamento_projeto_correcoes;
create policy planejamento_projeto_correcoes_select on public.planejamento_projeto_correcoes
    for select to authenticated
    using ((select public.has_permission('pla_acomp_ver', 'read'))
        and exists (select 1 from public.planejamento_projetos p where p.id = projeto_id));

drop policy if exists planejamento_projeto_comentarios_select on public.planejamento_projeto_comentarios;
create policy planejamento_projeto_comentarios_select on public.planejamento_projeto_comentarios
    for select to authenticated
    using ((select public.has_permission('pla_acomp_ver', 'read'))
        and exists (select 1 from public.planejamento_projetos p where p.id = projeto_id));

drop policy if exists planejamento_projeto_validacoes_select on public.planejamento_projeto_validacoes;
create policy planejamento_projeto_validacoes_select on public.planejamento_projeto_validacoes
    for select to authenticated
    using ((select public.has_permission('pla_acomp_ver', 'read'))
        and exists (select 1 from public.planejamento_projetos p where p.id = projeto_id));

drop policy if exists planejamento_projeto_pendencias_select on public.planejamento_projeto_pendencias;
create policy planejamento_projeto_pendencias_select on public.planejamento_projeto_pendencias
    for select to authenticated
    using ((select public.has_permission('pla_acomp_ver', 'read'))
        and exists (select 1 from public.planejamento_projetos p where p.id = projeto_id));

revoke all on public.planejamento_projeto_correcoes, public.planejamento_projeto_comentarios,
    public.planejamento_projeto_validacoes, public.planejamento_projeto_pendencias from anon;
revoke insert, update, delete, truncate on public.planejamento_projeto_correcoes, public.planejamento_projeto_comentarios,
    public.planejamento_projeto_validacoes, public.planejamento_projeto_pendencias from authenticated;
grant select on public.planejamento_projeto_correcoes, public.planejamento_projeto_comentarios,
    public.planejamento_projeto_validacoes, public.planejamento_projeto_pendencias to authenticated;

-- 3. Eventos do acompanhamento só com `pla_acomp_ver` (AC9). Policy RESTRITIVA nova, somada à
-- permissiva da S-PLA-02 (que continua igual): os tipos antigos (criacao, salvar_projeto,
-- ficha_voltou_parcial, status_alterado, exclusao) seguem visíveis como hoje.
drop policy if exists planejamento_projeto_eventos_acomp on public.planejamento_projeto_eventos;
create policy planejamento_projeto_eventos_acomp on public.planejamento_projeto_eventos
    as restrictive
    for select to authenticated
    using (
        tipo not in ('correcao_pedida', 'correcao_resolvida', 'validado', 'validacao_retirada', 'pendencia_criada', 'pendencia_concluida')
        or (select public.has_permission('pla_acomp_ver', 'read'))
    );

-- 4. Guarda comum das escritas: sessão, permissão da ação, `pla_acomp_ver` e projeto visível.
-- Fora do escopo, inexistente ou excluído: "Projeto não encontrado." (não revela que existe).
-- Só é chamada pelas funções abaixo (sem execução para authenticated).
create or replace function public.pla_acomp_guarda(p_projeto uuid, p_permissao text, p_mensagem text)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
    v_setor text;
    v_excluido timestamptz;
begin
    if auth.uid() is null then
        raise exception 'Sessão expirada. Entre de novo no portal.' using errcode = '42501';
    end if;
    if not coalesce(public.has_permission(p_permissao, 'read'), false) then
        raise exception '%', p_mensagem using errcode = '42501';
    end if;
    select setor_id, excluido_em into v_setor, v_excluido from public.planejamento_projetos where id = p_projeto;
    if not found or v_excluido is not null
       or not coalesce(public.has_permission('pla_acomp_ver', 'read'), false)
       or not public.pla_pode_ler_projetos() or not public.pla_pode_atuar_setor(v_setor) then
        raise exception 'Projeto não encontrado.' using errcode = 'P0002';
    end if;
end;
$$;
revoke execute on function public.pla_acomp_guarda(uuid, text, text) from public, anon, authenticated;

create or replace function public.pla_acomp_evento(p_projeto uuid, p_tipo text, p_detalhe jsonb, p_nome text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
    insert into public.planejamento_projeto_eventos (projeto_id, tipo, detalhe, autor_id, autor_nome)
    values (p_projeto, p_tipo, coalesce(p_detalhe, '{}'::jsonb), auth.uid(), p_nome);
$$;
revoke execute on function public.pla_acomp_evento(uuid, text, jsonb, text) from public, anon, authenticated;

-- 5. Correções (AC2) ----------------------------------------------------------------------------
create or replace function public.pla_correcao_pedir(p_projeto uuid, p_texto text, p_secao integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_texto text := nullif(btrim(p_texto), '');
    v_nome text;
    v_id uuid := gen_random_uuid();
begin
    perform public.pla_acomp_guarda(p_projeto, 'pla_correcao_pedir', 'Sem permissão para pedir correção.');
    if v_texto is null then
        raise exception 'Escreva o que precisa ser corrigido.' using errcode = '22023';
    end if;
    if length(v_texto) > 2000 then
        raise exception 'O pedido de correção pode ter até 2.000 caracteres.' using errcode = '22023';
    end if;
    if p_secao is not null and p_secao not between 1 and 7 then
        raise exception 'Seção da ficha inválida.' using errcode = '22023';
    end if;
    v_nome := public.pla_nome_usuario();
    insert into public.planejamento_projeto_correcoes (id, projeto_id, secao, texto, pedido_por, pedido_por_nome)
    values (v_id, p_projeto, p_secao, v_texto, auth.uid(), v_nome);
    perform public.pla_acomp_evento(p_projeto, 'correcao_pedida',
        jsonb_build_object('correcao_id', v_id, 'secao', p_secao, 'texto', v_texto), v_nome);
    return jsonb_build_object('id', v_id);
end;
$$;
revoke execute on function public.pla_correcao_pedir(uuid, text, integer) from public, anon;
grant execute on function public.pla_correcao_pedir(uuid, text, integer) to authenticated;

create or replace function public.pla_correcao_resolver(p_id uuid, p_observacao text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_atual public.planejamento_projeto_correcoes%rowtype;
    v_obs text := nullif(btrim(p_observacao), '');
    v_nome text;
begin
    if auth.uid() is null then
        raise exception 'Sessão expirada. Entre de novo no portal.' using errcode = '42501';
    end if;
    select * into v_atual from public.planejamento_projeto_correcoes where id = p_id for update;
    if not found then
        raise exception 'Correção não encontrada.' using errcode = 'P0002';
    end if;
    perform public.pla_acomp_guarda(v_atual.projeto_id, 'pla_correcao_resolver', 'Sem permissão para marcar correção como resolvida.');
    if v_atual.resolvida_em is not null then
        raise exception 'Esta correção já foi marcada como resolvida.' using errcode = '22023';
    end if;
    if v_obs is not null and length(v_obs) > 2000 then
        raise exception 'A observação pode ter até 2.000 caracteres.' using errcode = '22023';
    end if;
    v_nome := public.pla_nome_usuario();
    update public.planejamento_projeto_correcoes
        set resolvida_em = now(), resolvida_por = auth.uid(), resolvida_por_nome = v_nome, resolucao_obs = v_obs
        where id = p_id;
    perform public.pla_acomp_evento(v_atual.projeto_id, 'correcao_resolvida',
        jsonb_build_object('correcao_id', p_id, 'secao', v_atual.secao, 'texto', v_atual.texto, 'observacao', v_obs), v_nome);
    return jsonb_build_object('id', p_id);
end;
$$;
revoke execute on function public.pla_correcao_resolver(uuid, text) from public, anon;
grant execute on function public.pla_correcao_resolver(uuid, text) to authenticated;

-- 6. Comentários (AC3): editar e excluir só o próprio ----------------------------------------
create or replace function public.pla_comentario_criar(p_projeto uuid, p_texto text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_texto text := nullif(btrim(p_texto), '');
    v_id uuid := gen_random_uuid();
begin
    perform public.pla_acomp_guarda(p_projeto, 'pla_coment_criar', 'Sem permissão para comentar.');
    if v_texto is null then
        raise exception 'Escreva o comentário.' using errcode = '22023';
    end if;
    if length(v_texto) > 2000 then
        raise exception 'O comentário pode ter até 2.000 caracteres.' using errcode = '22023';
    end if;
    insert into public.planejamento_projeto_comentarios (id, projeto_id, texto, autor_id, autor_nome)
    values (v_id, p_projeto, v_texto, auth.uid(), public.pla_nome_usuario());
    return jsonb_build_object('id', v_id);
end;
$$;
revoke execute on function public.pla_comentario_criar(uuid, text) from public, anon;
grant execute on function public.pla_comentario_criar(uuid, text) to authenticated;

create or replace function public.pla_comentario_editar(p_id uuid, p_texto text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_atual public.planejamento_projeto_comentarios%rowtype;
    v_texto text := nullif(btrim(p_texto), '');
begin
    if auth.uid() is null then
        raise exception 'Sessão expirada. Entre de novo no portal.' using errcode = '42501';
    end if;
    select * into v_atual from public.planejamento_projeto_comentarios where id = p_id for update;
    if not found then
        raise exception 'Comentário não encontrado.' using errcode = 'P0002';
    end if;
    perform public.pla_acomp_guarda(v_atual.projeto_id, 'pla_coment_editar', 'Sem permissão para editar comentários.');
    if v_atual.autor_id is distinct from auth.uid() then
        raise exception 'Você só pode editar os seus próprios comentários.' using errcode = '42501';
    end if;
    if v_texto is null then
        raise exception 'Escreva o comentário.' using errcode = '22023';
    end if;
    if length(v_texto) > 2000 then
        raise exception 'O comentário pode ter até 2.000 caracteres.' using errcode = '22023';
    end if;
    if v_texto = v_atual.texto then
        return jsonb_build_object('id', p_id, 'editado_em', v_atual.editado_em);
    end if;
    update public.planejamento_projeto_comentarios set texto = v_texto, editado_em = now() where id = p_id;
    return jsonb_build_object('id', p_id, 'editado_em', now());
end;
$$;
revoke execute on function public.pla_comentario_editar(uuid, text) from public, anon;
grant execute on function public.pla_comentario_editar(uuid, text) to authenticated;

create or replace function public.pla_comentario_excluir(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_atual public.planejamento_projeto_comentarios%rowtype;
begin
    if auth.uid() is null then
        raise exception 'Sessão expirada. Entre de novo no portal.' using errcode = '42501';
    end if;
    select * into v_atual from public.planejamento_projeto_comentarios where id = p_id for update;
    if not found then
        raise exception 'Comentário não encontrado.' using errcode = 'P0002';
    end if;
    perform public.pla_acomp_guarda(v_atual.projeto_id, 'pla_coment_excluir', 'Sem permissão para excluir comentários.');
    if v_atual.autor_id is distinct from auth.uid() then
        raise exception 'Você só pode excluir os seus próprios comentários.' using errcode = '42501';
    end if;
    delete from public.planejamento_projeto_comentarios where id = p_id;
    return jsonb_build_object('id', p_id);
end;
$$;
revoke execute on function public.pla_comentario_excluir(uuid) from public, anon;
grant execute on function public.pla_comentario_excluir(uuid) to authenticated;

-- 7. Validação (AC4): informativa, não muda status nem trava a ficha -----------------------
create or replace function public.pla_validar_projeto(p_projeto uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_nome text;
begin
    perform public.pla_acomp_guarda(p_projeto, 'pla_valid_dar', 'Sem permissão para validar projetos.');
    perform 1 from public.planejamento_projetos where id = p_projeto for update;
    if exists (select 1 from public.planejamento_projeto_validacoes where projeto_id = p_projeto) then
        raise exception 'O projeto já está validado.' using errcode = '22023';
    end if;
    v_nome := public.pla_nome_usuario();
    insert into public.planejamento_projeto_validacoes (projeto_id, validado_por, validado_por_nome)
    values (p_projeto, auth.uid(), v_nome);
    perform public.pla_acomp_evento(p_projeto, 'validado', '{}'::jsonb, v_nome);
    return jsonb_build_object('projeto_id', p_projeto, 'validado_por_nome', v_nome, 'validado_em', now());
end;
$$;
revoke execute on function public.pla_validar_projeto(uuid) from public, anon;
grant execute on function public.pla_validar_projeto(uuid) to authenticated;

create or replace function public.pla_retirar_validacao(p_projeto uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_atual public.planejamento_projeto_validacoes%rowtype;
begin
    perform public.pla_acomp_guarda(p_projeto, 'pla_valid_retirar', 'Sem permissão para retirar a validação.');
    select * into v_atual from public.planejamento_projeto_validacoes where projeto_id = p_projeto for update;
    if not found then
        raise exception 'O projeto não está validado.' using errcode = '22023';
    end if;
    delete from public.planejamento_projeto_validacoes where projeto_id = p_projeto;
    perform public.pla_acomp_evento(p_projeto, 'validacao_retirada',
        jsonb_build_object('validado_por_nome', v_atual.validado_por_nome, 'validado_em', v_atual.validado_em),
        public.pla_nome_usuario());
    return jsonb_build_object('projeto_id', p_projeto);
end;
$$;
revoke execute on function public.pla_retirar_validacao(uuid) from public, anon;
grant execute on function public.pla_retirar_validacao(uuid) to authenticated;

-- 8. Pendências (AC5) ---------------------------------------------------------------------------
create or replace function public.pla_pendencia_criar(p_projeto uuid, p_texto text, p_responsavel text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_texto text := nullif(btrim(p_texto), '');
    v_resp text := nullif(btrim(p_responsavel), '');
    v_nome text;
    v_id uuid := gen_random_uuid();
begin
    perform public.pla_acomp_guarda(p_projeto, 'pla_pend_criar', 'Sem permissão para adicionar pendências.');
    if v_texto is null then
        raise exception 'Escreva a pendência.' using errcode = '22023';
    end if;
    if length(v_texto) > 500 then
        raise exception 'A pendência pode ter até 500 caracteres.' using errcode = '22023';
    end if;
    if v_resp is not null and length(v_resp) > 200 then
        raise exception 'O responsável pode ter até 200 caracteres.' using errcode = '22023';
    end if;
    v_nome := public.pla_nome_usuario();
    insert into public.planejamento_projeto_pendencias (id, projeto_id, texto, responsavel, criado_por, criado_por_nome)
    values (v_id, p_projeto, v_texto, v_resp, auth.uid(), v_nome);
    perform public.pla_acomp_evento(p_projeto, 'pendencia_criada',
        jsonb_build_object('pendencia_id', v_id, 'texto', v_texto, 'responsavel', v_resp), v_nome);
    return jsonb_build_object('id', v_id);
end;
$$;
revoke execute on function public.pla_pendencia_criar(uuid, text, text) from public, anon;
grant execute on function public.pla_pendencia_criar(uuid, text, text) to authenticated;

create or replace function public.pla_pendencia_editar(p_id uuid, p_texto text, p_responsavel text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_atual public.planejamento_projeto_pendencias%rowtype;
    v_texto text := nullif(btrim(p_texto), '');
    v_resp text := nullif(btrim(p_responsavel), '');
begin
    if auth.uid() is null then
        raise exception 'Sessão expirada. Entre de novo no portal.' using errcode = '42501';
    end if;
    select * into v_atual from public.planejamento_projeto_pendencias where id = p_id for update;
    if not found then
        raise exception 'Pendência não encontrada.' using errcode = 'P0002';
    end if;
    perform public.pla_acomp_guarda(v_atual.projeto_id, 'pla_pend_editar', 'Sem permissão para editar pendências.');
    if v_texto is null then
        raise exception 'Escreva a pendência.' using errcode = '22023';
    end if;
    if length(v_texto) > 500 then
        raise exception 'A pendência pode ter até 500 caracteres.' using errcode = '22023';
    end if;
    if v_resp is not null and length(v_resp) > 200 then
        raise exception 'O responsável pode ter até 200 caracteres.' using errcode = '22023';
    end if;
    update public.planejamento_projeto_pendencias set texto = v_texto, responsavel = v_resp where id = p_id;
    return jsonb_build_object('id', p_id);
end;
$$;
revoke execute on function public.pla_pendencia_editar(uuid, text, text) from public, anon;
grant execute on function public.pla_pendencia_editar(uuid, text, text) to authenticated;

create or replace function public.pla_pendencia_excluir(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_atual public.planejamento_projeto_pendencias%rowtype;
begin
    if auth.uid() is null then
        raise exception 'Sessão expirada. Entre de novo no portal.' using errcode = '42501';
    end if;
    select * into v_atual from public.planejamento_projeto_pendencias where id = p_id for update;
    if not found then
        raise exception 'Pendência não encontrada.' using errcode = 'P0002';
    end if;
    perform public.pla_acomp_guarda(v_atual.projeto_id, 'pla_pend_excluir', 'Sem permissão para excluir pendências.');
    delete from public.planejamento_projeto_pendencias where id = p_id;
    return jsonb_build_object('id', p_id);
end;
$$;
revoke execute on function public.pla_pendencia_excluir(uuid) from public, anon;
grant execute on function public.pla_pendencia_excluir(uuid) to authenticated;

-- Marcar e desmarcar "Feito". Só a marcação gera evento (`pendencia_concluida`, AC6).
create or replace function public.pla_pendencia_marcar(p_id uuid, p_feito boolean)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    v_atual public.planejamento_projeto_pendencias%rowtype;
    v_nome text;
begin
    if auth.uid() is null then
        raise exception 'Sessão expirada. Entre de novo no portal.' using errcode = '42501';
    end if;
    if p_feito is null then
        raise exception 'Valor inválido.' using errcode = '22023';
    end if;
    select * into v_atual from public.planejamento_projeto_pendencias where id = p_id for update;
    if not found then
        raise exception 'Pendência não encontrada.' using errcode = 'P0002';
    end if;
    perform public.pla_acomp_guarda(v_atual.projeto_id, 'pla_pend_feito', 'Sem permissão para marcar pendências.');
    if v_atual.feito = p_feito then
        return jsonb_build_object('id', p_id, 'feito', p_feito);
    end if;
    v_nome := public.pla_nome_usuario();
    update public.planejamento_projeto_pendencias
        set feito = p_feito, feito_por_nome = case when p_feito then v_nome end
        where id = p_id;
    if p_feito then
        perform public.pla_acomp_evento(v_atual.projeto_id, 'pendencia_concluida',
            jsonb_build_object('pendencia_id', p_id, 'texto', v_atual.texto), v_nome);
    end if;
    return jsonb_build_object('id', p_id, 'feito', p_feito);
end;
$$;
revoke execute on function public.pla_pendencia_marcar(uuid, boolean) from public, anon;
grant execute on function public.pla_pendencia_marcar(uuid, boolean) to authenticated;

-- 9. Selos da lista (AC7): contagem no banco, uma chamada só, um valor só (sem o limite de 1.000
-- linhas por consulta). SECURITY INVOKER: a RLS das tabelas acima vale (sem `pla_acomp_ver`, vem vazio).
-- Formato: { "<projeto_id>": { "correcoes": n, "validado": true|false }, ... }
create or replace function public.pla_resumo_acompanhamento(p_ano integer)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
    select coalesce(jsonb_object_agg(r.projeto_id, jsonb_build_object('correcoes', r.correcoes, 'validado', r.validado)), '{}'::jsonb)
    from (
        select p.id as projeto_id,
            (select count(*) from public.planejamento_projeto_correcoes c where c.projeto_id = p.id and c.resolvida_em is null) as correcoes,
            exists (select 1 from public.planejamento_projeto_validacoes v where v.projeto_id = p.id) as validado
        from public.planejamento_projetos p
        where p.ano = p_ano and p.excluido_em is null
    ) r
    where r.correcoes > 0 or r.validado;
$$;
revoke execute on function public.pla_resumo_acompanhamento(integer) from public, anon;
grant execute on function public.pla_resumo_acompanhamento(integer) to authenticated;
