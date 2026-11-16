-- S-INST-QUAL-08 — avisos da rede com data de validade (tipo `aviso` em `documentos_rag`).
--
-- Aviso = conteúdo temporário da rede toda (simulado, recesso, inscrições abertas), sem unidade, com
-- `metadados.valido_de` (opcional, AAAA-MM-DD), `metadados.valido_ate` (obrigatório, AAAA-MM-DD) e
-- `metadados.categoria` (`geral` padrão | `matricula`, usada pela S-INST-QUAL-10). Datas inclusivas, no
-- fuso de Fortaleza. Não é `eventos_pontuais` (programação por unidade), que não muda.
--
-- O que faz:
--   1. `trigger_indexar_documento`: `aviso` entra na exceção, como `servicos_rede` e `resumo_rede` — o
--      motor lê o aviso inteiro, então ele não pode virar trechos nem aparecer na busca. Corpo copiado
--      da definição em produção (16/11), só com `'aviso'` acrescentado.
--   2. `desativar_avisos_vencidos()` + cron diário `desativar-avisos-vencidos` às 03:05 UTC (00:05 em
--      Fortaleza): marca `ativo = false` nos avisos com `valido_ate` antes de hoje. Só serve para a tela
--      mostrar o estado certo — o motor confere a validade na leitura e nunca depende do cron.
--      Data mal formada não derruba o update (o regex filtra antes do cast).
--   3. `verificar_saude_rag_institucional()`: o alarme `servicos_rede_grande` passa a somar a base
--      institucional + os avisos `geral` válidos hoje (é o que vai inteiro em toda resposta). Mesma
--      assinatura e mesmo código de problema (`registrar_saude_rag_institucional` e o alerta da S-12
--      casam pelo código).
-- Idempotente: `create or replace` nas funções; o cron é removido e recriado.
--
-- Para voltar: tirar `'aviso'` do IN do gatilho; `select cron.unschedule('desativar-avisos-vencidos')`;
-- `drop function public.desativar_avisos_vencidos()`; recriar o alarme pela migration
-- 20261103050000_inst_qual_02_alarmes_saude_rag.sql.

-- 1. gatilho de indexação
create or replace function public.trigger_indexar_documento()
 returns trigger
 language plpgsql
 security definer
as $function$
BEGIN
  IF NEW.tipo IN ('resumo_rede', 'servicos_rede', 'aviso') THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://svzkrkfzpiqcesloukgb.supabase.co/functions/v1/processar-documento',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT get_anon_key())
    ),
    body := jsonb_build_object(
      'documento_id', NEW.id
    )
  );

  RETURN NEW;
END;
$function$;

-- 2. desativação diária dos vencidos
create or replace function public.desativar_avisos_vencidos()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_hoje date := (now() at time zone 'America/Fortaleza')::date;
  v_total integer;
begin
  update public.documentos_rag
  set ativo = false
  where tipo = 'aviso'
    and ativo = true
    and (metadados->>'valido_ate') ~ '^\d{4}-\d{2}-\d{2}$'
    and (metadados->>'valido_ate')::date < v_hoje;
  get diagnostics v_total = row_count;
  return v_total;
end;
$function$;

revoke all on function public.desativar_avisos_vencidos() from public, anon, authenticated;

select cron.unschedule('desativar-avisos-vencidos')
where exists (select 1 from cron.job where jobname = 'desativar-avisos-vencidos');
select cron.schedule('desativar-avisos-vencidos', '5 3 * * *', 'select public.desativar_avisos_vencidos()');

-- 3. alarme de tamanho: base institucional + avisos gerais válidos hoje
create or replace function public.verificar_saude_rag_institucional()
 returns table(unidade_cuca text, problema text, detalhe text, acao_sugerida text)
 language sql
 stable security definer
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
  ),
  avisos_validos as (
    -- S-INST-QUAL-08: mesma regra do motor (avisosValidos): geral, sem unidade, válido hoje em Fortaleza;
    -- fim ausente ou mal formado não conta; início ausente = já começou; início mal formado não conta.
    select coalesce(sum(length(d.titulo) + length(d.conteudo)), 0) as tamanho
    from public.documentos_rag d
    where d.tipo = 'aviso' and d.ativo = true and d.unidade_cuca is null
      and coalesce(d.metadados->>'categoria', 'geral') = 'geral'
      and (d.metadados->>'valido_ate') ~ '^\d{4}-\d{2}-\d{2}$'
      and (d.metadados->>'valido_ate')::date >= (now() at time zone 'America/Fortaleza')::date
      and (
        d.metadados->>'valido_de' is null
        or ((d.metadados->>'valido_de') ~ '^\d{4}-\d{2}-\d{2}$'
            and (d.metadados->>'valido_de')::date <= (now() at time zone 'America/Fortaleza')::date)
      )
  ),
  tamanho_total as (
    select coalesce((select tamanho from base_rede), 0) + (select tamanho from avisos_validos) as tamanho,
           (select tamanho from avisos_validos) as avisos
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
         'A base institucional (servicos_rede) ativa mais os avisos válidos têm ' || t.tamanho
           || ' caracteres (avisos: ' || t.avisos || '); alerta acima de 30.000',
         'Revisar o tamanho da base institucional e dos avisos. Acima de ~3x, reavaliar a base inteira em toda resposta'::text
  from tamanho_total t
  where t.tamanho > 30000;
$function$;
