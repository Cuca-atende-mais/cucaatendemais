-- S-INST-QUAL-06 — regra geral (decisão do Junior, 15/11): falta de informação NUNCA é motivo de
-- atendente. O atendente só entra quando a própria pessoa pede (e dentro do horário, regra do código).
-- Quando a base não tem a resposta, o bot diz que não encontrou e passa o telefone da unidade.
--
-- Origem: 5 conversas de 13 e 14/11 foram para `awaiting_human` sem ninguém pedir atendente — o bot
-- não achou a informação (gastronomia, bebê de 11 meses, natação para adulto iniciante, "mais"
-- atividades, sábado) e ofereceu/acionou o atendente, fora do horário de atendimento.
--
-- O código do motor-agente (regra A de `INSTRUCAO_INSTITUCIONAL`, `[[HANDOVER]]` do modelo ignorado no
-- Institucional) já segue a regra nova. Este arquivo alinha o `prompt_sistema` do Institucional, que
-- ainda mandava o contrário em dois pontos:
--   1. REGRA CRÍTICA DE HANDOVER: sai "ou quando as regras obrigatórias mandarem chamar um atendente
--      por falta de informação na base" (vinha da A9 da S-INST-QUAL-01, revogada pelo Junior) e entra
--      o parágrafo "FALTA DE INFORMAÇÃO NÃO É MOTIVO DE ATENDENTE";
--   2. REGRA PROGRAMAÇÃO MESES ANTERIORES (hotfix de 05/11): deixa de ser "TRANSBORDO OBRIGATÓRIO" —
--      a resposta pronta passa a mandar falar com a unidade, com o telefone, sem [[HANDOVER]].
-- O ANTI-ALUCINAÇÃO ("siga a regra de falta de informação das REGRAS OBRIGATÓRIAS") não muda: ele já
-- aponta para a regra A do código.
--
-- Com o motor-agente anterior (antes do deploy desta story) as trocas também funcionam: só tiram
-- motivos de transbordo do texto; o pedido explícito de atendente continua igual.
-- Idempotente: cada troca confere o texto antigo; se ele não existe e o novo já está lá, não faz nada;
-- se nenhum dos dois existe, para tudo (o texto mudou por fora e precisa ser revisto).

create or replace function pg_temp.trocar_texto(p_atual text, p_antigo text, p_novo text, p_rotulo text)
returns text language plpgsql as $f$
begin
  if position(p_antigo in p_atual) > 0 then
    return replace(p_atual, p_antigo, p_novo);
  elsif position(p_novo in p_atual) > 0 then
    return p_atual;
  end if;
  raise exception 'S-INST-QUAL-06: trecho não encontrado (%), revisar antes de aplicar', p_rotulo;
end;
$f$;

do $$
declare
  v_sis text;
begin
  select prompt_sistema into v_sis
  from public.prompts_agentes
  where id = '719884bd-26bb-466a-9b54-9effc49f8128' and agente_tipo = 'Institucional';
  if v_sis is null then
    raise exception 'S-INST-QUAL-06: prompt do Institucional não encontrado';
  end if;

  -- 1a. REGRA CRÍTICA DE HANDOVER: só o pedido da pessoa aciona o atendente.
  v_sis := pg_temp.trocar_texto(v_sis,
    $t$, ou quando as regras obrigatórias mandarem chamar um atendente por falta de informação na base, você DEVE concordar gentilmente E incluir OBRIGATORIAMENTE a tag [[HANDOVER]] no FINAL da sua resposta —$t$,
    $t$, você DEVE concordar gentilmente E incluir OBRIGATORIAMENTE a tag [[HANDOVER]] no FINAL da sua resposta —$t$,
    'REGRA CRÍTICA DE HANDOVER');

  -- 1b + 2a. Parágrafo novo antes da regra de meses anteriores, que deixa de ser transbordo.
  v_sis := pg_temp.trocar_texto(v_sis,
    $t$REGRA PROGRAMAÇÃO MESES ANTERIORES — TRANSBORDO OBRIGATÓRIO:$t$,
    $t$FALTA DE INFORMAÇÃO NÃO É MOTIVO DE ATENDENTE: se a informação pedida não estiver na base, siga a regra de falta de informação das REGRAS OBRIGATÓRIAS — diga que não encontrou e passe o telefone da unidade. Nunca ofereça falar com atendente por conta própria e não use [[HANDOVER]] por falta de informação: o atendente só entra quando a própria pessoa pede para falar com alguém.

    REGRA PROGRAMAÇÃO MESES ANTERIORES:$t$,
    'MESES ANTERIORES: título');

  -- 2b. Resposta pronta de meses anteriores: falar com a unidade, com o telefone, sem atendente.
  v_sis := pg_temp.trocar_texto(v_sis,
    $t$"Só tenho disponível a programação do mês atual. Para informações sobre meses anteriores, te conecto com nosso atendimento humano que pode te ajudar! 😊 [[HANDOVER]]"$t$,
    $t$"Só tenho disponível a programação do mês atual. Para informações sobre meses anteriores, fale direto com a unidade CUCA 😊" — e, logo abaixo, o telefone da unidade da conversa (lista "Telefones das unidades"; sem unidade definida, os de todas as unidades).$t$,
    'MESES ANTERIORES: resposta pronta');

  -- 2c. Sem transbordo nesse caso.
  v_sis := pg_temp.trocar_texto(v_sis,
    $t$Sempre acione [[HANDOVER]] nesse caso sem tentar responder o mérito da pergunta.$t$,
    $t$Não responda o mérito da pergunta e NÃO use [[HANDOVER]] nesse caso.$t$,
    'MESES ANTERIORES: sem transbordo');

  update public.prompts_agentes
  set prompt_sistema = v_sis
  where id = '719884bd-26bb-466a-9b54-9effc49f8128'
    and prompt_sistema is distinct from v_sis;
end
$$;
