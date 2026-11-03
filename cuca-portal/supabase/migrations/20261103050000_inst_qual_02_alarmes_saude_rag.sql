-- S-INST-QUAL-02 — Alarmes de busca vazia e de tamanho da base institucional, com ação sugerida.
--
-- Estende o mecanismo que já existe (20260912060000_rag_saude_incidentes.sql):
--   - `verificar_saude_rag_institucional()` lista os problemas do momento;
--   - `registrar_saude_rag_institucional()` (cron `verificar-saude-rag-institucional`, a cada 15 min)
--     abre um incidente por (unidade_cuca, problema) e o resolve quando o problema some.
--
-- O que muda:
--   1. `rag_saude_incidentes.acao_sugerida` (texto curto do que fazer). É o que a central de alertas
--      (S-INST-QUAL-12) vai mandar por e-mail e mostrar no sino. Aceita vazio.
--   2. Dois problemas novos, ambos da rede inteira (unidade_cuca = 'Rede', porque a coluna é
--      NOT NULL e o incidente não é de uma unidade só):
--      - `busca_vazia_com_unidade`: mais de 5% das buscas com unidade voltaram vazias nas últimas
--        24h, com pelo menos 20 buscas no período (abaixo disso a taxa não diz nada);
--      - `servicos_rede_grande`: o `servicos_rede` ativo passou de 30 mil caracteres (o dobro do
--        tamanho de 02/11).
--   3. Os problemas que já existiam ganham a sua ação sugerida.
--
-- Consulta da busca vazia (até a S-INST-QUAL-03 gravar `resultado_busca`):
--   linhas de `rag_retrieval_logs` do Institucional, com unidade escolhida (unidade_cuca não nula e
--   diferente de 'Geral', que é o valor de quem ainda não escolheu unidade) e camada
--   'vetorial' (achou) ou 'sem_match_rag' (voltou vazia). Isso deixa de fora a pergunta geral sem
--   unidade. Limite conhecido: o pedido de "outras unidades" sem atividade também grava
--   'sem_match_rag' sem buscar no banco, e não dá para separar pelo log de hoje. Pesa pouco: de
--   04/10 a 02/11, antes do índice voltar a ser usado, foram 2 casos em 999 buscas (0,2%).
--   Quando a S-INST-QUAL-03 estiver no ar, trocar por `resultado_busca = 'sucesso_vazio'`.
--
-- Idempotente: `add column if not exists`, `drop function if exists` + `create`, `create or replace`.
-- A troca do tipo de retorno de `verificar_saude_rag_institucional` exige drop + create; as
-- permissões são refeitas abaixo, iguais às da migration original (só service_role executa).

alter table public.rag_saude_incidentes
  add column if not exists acao_sugerida text;

comment on column public.rag_saude_incidentes.acao_sugerida is
  'Texto curto do que fazer quando o incidente abre. Lido pela central de alertas (S-INST-QUAL-12).';

drop function if exists public.verificar_saude_rag_institucional();

create function public.verificar_saude_rag_institucional()
returns table(unidade_cuca text, problema text, detalhe text, acao_sugerida text)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with unidades as (
    select distinct c.unidade_cuca from public.campanhas_mensais c where c.status = 'aprovado'
  ),
  ativos as (
    select d.unidade_cuca, d.id,
           (select count(*) from public.chunks_documentos ch where ch.documento_id = d.id) as chunks
    from public.documentos_rag d
    where d.tipo = 'monthly_program' and d.ativo = true
  ),
  buscas as (
    select count(*) as total,
           count(*) filter (where l.camada = 'sem_match_rag') as vazias
    from public.rag_retrieval_logs l
    where l.created_at > now() - interval '24 hours'
      and l.agente_tipo = 'Institucional'
      and l.unidade_cuca is not null
      and l.unidade_cuca <> 'Geral'
      and l.camada in ('vetorial', 'sem_match_rag')
  ),
  base_rede as (
    -- mesmo documento que o motor-agente usa: o servicos_rede ativo mais recente
    select length(d.conteudo) as tamanho
    from public.documentos_rag d
    where d.tipo = 'servicos_rede' and d.ativo = true
    order by d.created_at desc
    limit 1
  )
  select u.unidade_cuca, 'sem_documento_ativo'::text,
         'Nenhum monthly_program ativo — o agente nao consegue responder nada de programacao'::text,
         'Publicar a programação do mês desta unidade na Base de Conhecimento (documento de programação mensal ativo)'::text
  from unidades u
  where not exists (select 1 from ativos a where a.unidade_cuca = u.unidade_cuca)
  union all
  select a.unidade_cuca, 'documento_ativo_sem_chunks'::text,
         'Documento ativo ' || a.id::text || ' sem chunks — indexacao nao completou',
         'Reprocessar o documento na Base de Conhecimento: a indexação não terminou e o agente não enxerga o conteúdo'::text
  from ativos a
  where a.chunks = 0
  union all
  select 'Rede'::text, 'busca_vazia_com_unidade'::text,
         b.vazias || ' de ' || b.total || ' buscas com unidade voltaram vazias nas últimas 24h ('
           || round(100.0 * b.vazias / b.total, 1) || '%; alerta acima de 5% com pelo menos 20 buscas)',
         'Conferir se um índice vetorial voltou (pg_indexes) e rodar explain da busca'::text
  from buscas b
  where b.total >= 20 and b.vazias::numeric / b.total > 0.05
  union all
  select 'Rede'::text, 'servicos_rede_grande'::text,
         'A base institucional (servicos_rede) ativa tem ' || br.tamanho || ' caracteres; alerta acima de 30.000',
         'Revisar o tamanho da base institucional. Acima de ~3x, reavaliar a base inteira em toda resposta'::text
  from base_rede br
  where br.tamanho > 30000;
$function$;

revoke execute on function public.verificar_saude_rag_institucional() from public, anon, authenticated;
grant execute on function public.verificar_saude_rag_institucional() to service_role;

create or replace function public.registrar_saude_rag_institucional()
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
BEGIN
  INSERT INTO public.rag_saude_incidentes (unidade_cuca, problema, detalhe, acao_sugerida)
  SELECT v.unidade_cuca, v.problema, v.detalhe, v.acao_sugerida
  FROM public.verificar_saude_rag_institucional() v
  WHERE NOT EXISTS (
    SELECT 1 FROM public.rag_saude_incidentes i
    WHERE i.unidade_cuca = v.unidade_cuca AND i.problema = v.problema AND i.resolvido_em IS NULL
  );

  UPDATE public.rag_saude_incidentes i
  SET resolvido_em = now()
  WHERE i.resolvido_em IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.verificar_saude_rag_institucional() v
      WHERE v.unidade_cuca = i.unidade_cuca AND v.problema = i.problema
    );
END;
$function$;

revoke execute on function public.registrar_saude_rag_institucional() from public, anon, authenticated;
grant execute on function public.registrar_saude_rag_institucional() to service_role;

-- Incidentes que já existirem ganham a ação sugerida do seu problema (hoje a tabela está vazia).
update public.rag_saude_incidentes
set acao_sugerida = case problema
  when 'sem_documento_ativo' then 'Publicar a programação do mês desta unidade na Base de Conhecimento (documento de programação mensal ativo)'
  when 'documento_ativo_sem_chunks' then 'Reprocessar o documento na Base de Conhecimento: a indexação não terminou e o agente não enxerga o conteúdo'
  when 'busca_vazia_com_unidade' then 'Conferir se um índice vetorial voltou (pg_indexes) e rodar explain da busca'
  when 'servicos_rede_grande' then 'Revisar o tamanho da base institucional. Acima de ~3x, reavaliar a base inteira em toda resposta'
end
where acao_sugerida is null
  and problema in ('sem_documento_ativo', 'documento_ativo_sem_chunks', 'busca_vazia_com_unidade', 'servicos_rede_grande');
