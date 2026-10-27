-- S-PLA-01 (ajuste de 2026-10-27, decisão do Junior): colaborador SEM setor marcado atua em TODOS os
-- setores; com setores marcados, só neles. O acesso ao módulo continua vindo do perfil (RBAC).
-- Sai a dependência de `pla_todos_setores`. Idempotente: só troca o corpo da função e reafirma os grants.

create or replace function public.pla_pode_atuar_setor(p_setor text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
    -- As duas contas Developer atuam em tudo, mesmo que alguém marque setores no cadastro delas.
    select public.is_developer()
        or exists (
            select 1
            from public.colaboradores c
            where c.user_id = auth.uid()
              and (
                  not exists (select 1 from public.planejamento_colaborador_setores cs where cs.colaborador_id = c.id)
                  or exists (
                      select 1 from public.planejamento_colaborador_setores cs
                      where cs.colaborador_id = c.id and cs.setor_id = p_setor
                  )
              )
        );
$$;
revoke execute on function public.pla_pode_atuar_setor(text) from public, anon;
grant execute on function public.pla_pode_atuar_setor(text) to authenticated;
