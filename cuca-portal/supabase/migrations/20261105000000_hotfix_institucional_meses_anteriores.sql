-- Hotfix 05/11/2026 — Institucional: a regra "PROGRAMAÇÃO MESES ANTERIORES — TRANSBORDO
-- OBRIGATÓRIO" do prompt do agente disparava em pergunta de prazo/data de inscrição ("Quando é as
-- matrículas?", "se já passou o prazo") e mandava a pessoa para o atendente com a frase de "meses
-- anteriores", travando a conversa. Casos reais de 04-05/11 (Leonardo, Samantha).
--
-- Acrescenta, logo depois da regra, quando ela NÃO vale. Não muda a regra em si.
-- Idempotente: se o texto novo já está lá, não faz nada; se o trecho de referência sumiu, para
-- tudo (o prompt mudou por fora e precisa ser revisto).

do $$
declare
  v_sis text;
  v_ref constant text := $t$NUNCA invente, suponha ou busque atividades de meses passados. Sempre acione [[HANDOVER]] nesse caso sem tentar responder o mérito da pergunta.$t$;
  v_acrescimo constant text := $t$
    ESTA REGRA NÃO VALE para prazo, data ou horário de inscrição ou matrícula ("quando é a matrícula?", "já passou o prazo?", "as inscrições ainda estão abertas?") nem para pergunta sobre o mês atual ou os próximos. Ela só vale quando a pessoa perguntar, de forma explícita, da programação de um mês que JÁ PASSOU. Inscrição e matrícula: responda com o FAQ e os serviços da rede.$t$;
begin
  select prompt_sistema into v_sis
  from public.prompts_agentes where id = '719884bd-26bb-466a-9b54-9effc49f8128';
  if v_sis is null then
    raise exception 'Hotfix 05/11: prompt do Institucional não encontrado';
  end if;

  if position(v_acrescimo in v_sis) > 0 then
    return;
  end if;
  if position(v_ref in v_sis) = 0 then
    raise exception 'Hotfix 05/11: trecho da regra de meses anteriores não encontrado, revisar antes de aplicar';
  end if;

  update public.prompts_agentes
  set prompt_sistema = replace(v_sis, v_ref, v_ref || v_acrescimo)
  where id = '719884bd-26bb-466a-9b54-9effc49f8128';
end
$$;
