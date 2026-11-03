-- S-INST-QUAL-12 — Central de alertas (parte 2: gatilhos).
--
-- Aplicada depois do deploy da Edge Function `enviar-alerta-email` (03/11, v1, verify_jwt ligado).
--
-- 1. `rag_saude_incidentes` → `alertas_sistema`:
--    - incidente aberto (INSERT) cria um alerta com a ação sugerida e `referencia_id` = id do
--      incidente; a data do alerta é a do incidente (`detectado_em`);
--    - incidente resolvido (UPDATE de `resolvido_em`) preenche o `resolvido_em` do alerta.
--    Severidade: `sem_documento_ativo` e `documento_ativo_sem_chunks` = critico (a unidade fica sem
--    programação para a IA); o resto = atencao.
-- 2. `alertas_sistema` (INSERT) → e-mail: chama a Edge Function por `net.http_post`, levando só o
--    `alerta_id`, a chave anon como Bearer e o segredo do cofre no cabeçalho `x-alerta-segredo`.
--    O `pg_net` é assíncrono e só envia depois do commit: a transação do cron não espera o e-mail.
--
-- Os dois gatilhos capturam qualquer erro (`exception when others`) e só registram um aviso:
-- o cron de saúde e quem grava alertas nunca quebram por causa da central.
--
-- Sem carga inicial: incidentes que já estavam abertos antes desta migration não viram alerta
-- (decisão registrada na story; o único aberto em 03/11 é o `busca_vazia_com_unidade` das 15:45,
-- de um problema já corrigido e que se resolve sozinho). Só o que abrir daqui em diante gera
-- alerta e e-mail.
--
-- Idempotente: `create or replace function`, `drop trigger if exists` + `create trigger`.

create or replace function public.alertas_de_incidente_rag()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_titulo text;
  v_severidade text;
begin
  begin
    if tg_op = 'INSERT' then
      v_severidade := case new.problema
        when 'sem_documento_ativo' then 'critico'
        when 'documento_ativo_sem_chunks' then 'critico'
        else 'atencao'
      end;
      v_titulo := case new.problema
        when 'sem_documento_ativo' then 'Unidade sem programação ativa para a IA: ' || new.unidade_cuca
        when 'documento_ativo_sem_chunks' then 'Programação sem indexação: ' || new.unidade_cuca
        when 'busca_vazia_com_unidade' then 'Buscas do Institucional voltando vazias'
        when 'servicos_rede_grande' then 'Base institucional maior que o limite'
        when 'matricula_sem_data' then 'Matrícula sem data cadastrada'
        else 'Alerta da base de conhecimento: ' || new.problema
          || case when new.unidade_cuca is not null and new.unidade_cuca <> 'Rede' then ' (' || new.unidade_cuca || ')' else '' end
      end;

      insert into public.alertas_sistema
        (origem, tipo, severidade, titulo, detalhe, acao_sugerida, referencia_id, criado_em, resolvido_em)
      values
        ('rag_saude', new.problema, v_severidade, v_titulo, new.detalhe, new.acao_sugerida, new.id,
         coalesce(new.detectado_em, now()), new.resolvido_em)
      on conflict (origem, referencia_id) where referencia_id is not null do nothing;

    elsif tg_op = 'UPDATE' and new.resolvido_em is not null and old.resolvido_em is null then
      update public.alertas_sistema
      set resolvido_em = new.resolvido_em
      where origem = 'rag_saude' and referencia_id = new.id and resolvido_em is null;
    end if;
  exception when others then
    raise warning '[central de alertas] falha ao espelhar o incidente % (%): %', new.id, tg_op, sqlerrm;
  end;
  return null;
end;
$function$;

create or replace function public.alertas_enviar_email()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_url text;
  v_segredo text;
begin
  begin
    select sc.valor into v_url from public.system_config sc where sc.chave = 'alertas_email_funcao_url';
    v_segredo := public.alertas_email_segredo();

    if coalesce(v_url, '') = '' or coalesce(v_segredo, '') = '' then
      update public.alertas_sistema
      set email_erro = 'Envio não configurado: falta alertas_email_funcao_url em system_config ou o segredo alertas_email_segredo no cofre'
      where id = new.id;
      return null;
    end if;

    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || public.get_anon_key(),
        'x-alerta-segredo', v_segredo
      ),
      body := jsonb_build_object('alerta_id', new.id),
      timeout_milliseconds := 15000
    );
  exception when others then
    raise warning '[central de alertas] falha ao pedir o e-mail do alerta %: %', new.id, sqlerrm;
    begin
      update public.alertas_sistema set email_erro = left('Falha ao chamar o envio: ' || sqlerrm, 500) where id = new.id;
    exception when others then
      null;
    end;
  end;
  return null;
end;
$function$;

revoke execute on function public.alertas_de_incidente_rag() from public, anon, authenticated;
revoke execute on function public.alertas_enviar_email() from public, anon, authenticated;

drop trigger if exists trg_alertas_de_incidente_rag on public.rag_saude_incidentes;
create trigger trg_alertas_de_incidente_rag
  after insert or update of resolvido_em on public.rag_saude_incidentes
  for each row execute function public.alertas_de_incidente_rag();

drop trigger if exists trg_alertas_enviar_email on public.alertas_sistema;
create trigger trg_alertas_enviar_email
  after insert on public.alertas_sistema
  for each row execute function public.alertas_enviar_email();
