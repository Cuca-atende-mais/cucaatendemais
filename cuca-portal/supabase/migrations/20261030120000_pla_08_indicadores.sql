-- S-PLA-08: base do Painel de Indicadores do Planejamento 2027.
-- Aditiva e idempotente: só cria uma função nova. Nenhum objeto existente muda.
--
-- A função devolve, por projeto, os fatos que o painel agrega (orçamento somado e por categoria,
-- correções em aberto e validação). As contas do painel (por setor, status, situação, mês e categoria)
-- ficam na rota, em TypeScript, para reaproveitar a regra de meses da S-PLA-03 sem reescrevê-la.
--
-- Acesso: EXECUTE revogado de public, anon e authenticated. Só a rota do servidor chama (cliente de
-- serviço), depois de conferir `pla_indic_ver` e de calcular o escopo de setor com a função da S-PLA-01
-- no cliente do próprio usuário. Assim ninguém logado chama a função direto para ver outros setores.
-- Devolve um único jsonb (lista de projetos), sem o limite de linhas por consulta da API.
-- Excluídos (S-PLA-03) nunca entram.

create or replace function public.pla_indicadores_projetos(p_ano integer, p_setores text[])
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
    select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id,
        'nome', p.nome,
        'setor_id', p.setor_id,
        'tipo', p.tipo,
        'status', p.status,
        'situacao_2026', p.situacao_2026,
        'periodo_ano_todo', p.periodo_ano_todo,
        'data_inicio', p.data_inicio,
        'data_fim', p.data_fim,
        'participantes_estimados', p.participantes_estimados,
        'responsavel_nome', p.responsavel_nome,
        'orcamento_total', coalesce((
            select sum(o.valor_total) from public.planejamento_projeto_orcamento o where o.projeto_id = p.id
        ), 0),
        'orcamento_categorias', coalesce((
            select jsonb_object_agg(c.categoria, c.valor)
            from (
                select coalesce(o.categoria, 'sem_categoria') as categoria, sum(o.valor_total) as valor
                from public.planejamento_projeto_orcamento o
                where o.projeto_id = p.id
                group by 1
            ) c
        ), '{}'::jsonb),
        'correcoes_abertas', (
            select count(*) from public.planejamento_projeto_correcoes c
            where c.projeto_id = p.id and c.resolvida_em is null
        ),
        'validado', exists (select 1 from public.planejamento_projeto_validacoes v where v.projeto_id = p.id)
    ) order by p.setor_id, p.nome, p.id), '[]'::jsonb)
    from public.planejamento_projetos p
    where p.ano = p_ano
      and p.excluido_em is null
      and p.setor_id = any(coalesce(p_setores, '{}'::text[]));
$$;
revoke execute on function public.pla_indicadores_projetos(integer, text[]) from public, anon, authenticated;
grant execute on function public.pla_indicadores_projetos(integer, text[]) to service_role;
