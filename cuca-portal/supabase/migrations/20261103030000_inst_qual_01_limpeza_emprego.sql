-- S-INST-QUAL-01 (A8, decisão do Junior de 03/11) — o Institucional não fala de emprego.
-- Tira da base do Institucional o conteúdo que ensinava o modelo a responder sobre emprego
-- (achado 3 da revisão do @qa). Quem decide se a mensagem é de emprego passa a ser o modelo,
-- no código (`classificarEmpregoComModelo`); aqui fica só a limpeza dos dados.
--
-- 1. Desativa a FAQ "Empregabilidade e Vagas de Emprego no CUCA" (revisão de currículo, Jovem
--    Aprendiz, "pergunte na unidade sobre as vagas"). A busca (`buscar_chunks_similares`) já filtra
--    `documentos_rag.ativo = true`. Só o motor-agente lê FAQ de `documentos_rag`; o worker e a
--    Empregabilidade não leem (conferido em 03/11).
-- 2. `servicos_rede` (entra inteiro no prompt do Institucional; não é reindexado):
--    §5  sai o bloco "Trabalho e oportunidades… empregabilidade";
--    §19 sai "ações de empregabilidade" do Horizonte Digital;
--    §20 Jovens Monitores continua (é programa da Rede, o Institucional responde), sem as
--        "250 vagas" e sem a área "trabalho e empregabilidade";
--    §26 Emprega+: sai o "como funciona"; fica que é o canal de emprego da Rede CUCA, que faz
--        parte da Rede (nunca dizer que não é) e que o assunto é encaminhado.
-- 3. `prompt_sistema` do Institucional: no GUARDRAIL DE ESCOPO, Empregabilidade passa de assunto
--    que responde para assunto que só encaminha; a lista do encaminhamento ganha os termos que
--    aparecem nas mensagens reais (estágio, jovem aprendiz, contratação, trampo, bico).
--
-- Funciona também com o motor-agente que está no ar: só tira conteúdo de emprego e reforça a regra
-- de encaminhamento que já existe nas duas versões.
-- Idempotente: cada troca confere o texto antigo; se ele não existe e o novo já está lá, não faz
-- nada; se nenhum dos dois existe, para tudo (o texto mudou por fora e precisa ser revisto).

create or replace function pg_temp.trocar_texto(p_atual text, p_antigo text, p_novo text, p_rotulo text)
returns text language plpgsql as $f$
begin
  if position(p_antigo in p_atual) > 0 then
    return replace(p_atual, p_antigo, p_novo);
  elsif position(p_novo in p_atual) > 0 then
    return p_atual;
  end if;
  raise exception 'S-INST-QUAL-01: trecho não encontrado (%), revisar antes de aplicar', p_rotulo;
end;
$f$;

-- 1. FAQ de Empregabilidade
update public.documentos_rag
set ativo = false
where id = 'a3ad5c44-b362-4b29-bb2c-c05d1f540fc6' and ativo = true;

-- 2. servicos_rede ativo
do $$
declare
  v_srv text;
begin
  select conteudo into v_srv from public.documentos_rag where id = '19554be4-4cab-49f8-93d2-cc745ae9d92c';
  if v_srv is null then
    raise exception 'S-INST-QUAL-01: servicos_rede não encontrado';
  end if;

  -- §5: o bloco some inteiro (o "novo" é o cabeçalho seguinte, que continua no texto)
  if position($t$💼 Trabalho e oportunidades$t$ in v_srv) > 0 then
    v_srv := pg_temp.trocar_texto(v_srv,
      $t$💼 Trabalho e oportunidades

Atividades de formação, empregabilidade, qualificação e preparação para o mundo do trabalho.

$t$,
      '',
      'servicos_rede: §5 trabalho e oportunidades');
  end if;

  v_srv := pg_temp.trocar_texto(v_srv,
    $t$* hackathons;
* ações de empregabilidade.$t$,
    $t$* hackathons.$t$,
    'servicos_rede: §19 ações de empregabilidade');

  v_srv := pg_temp.trocar_texto(v_srv,
    $t$Em 2026, o programa abriu 250 vagas para jovens, com atuação em áreas como:$t$,
    $t$O programa tem atuação em áreas como:$t$,
    'servicos_rede: §20 250 vagas');

  v_srv := pg_temp.trocar_texto(v_srv,
    $t$* direitos humanos;
* trabalho e empregabilidade;
$t$,
    $t$* direitos humanos;
$t$,
    'servicos_rede: §20 área trabalho e empregabilidade');

  v_srv := pg_temp.trocar_texto(v_srv,
    $t$O Emprega+ é o canal de empregabilidade da Rede CUCA — um atendimento próprio pelo
WhatsApp que leva as vagas de emprego direto pro celular do jovem.

COMO FUNCIONA:
- O jovem vê as vagas abertas por empresas parceiras
- Escolhe a vaga que combina com o perfil dele
- Envia o currículo direto ali na conversa, sem formulário e sem site
- A candidatura fica registrada na hora

$t$,
    $t$O Emprega+ é o canal de emprego da Rede CUCA, com atendimento próprio pelo WhatsApp.
Vaga de emprego, estágio, jovem aprendiz, currículo e qualquer assunto de trabalho são
atendidos lá, não aqui.

$t$,
    'servicos_rede: §26 como funciona o Emprega+');

  v_srv := pg_temp.trocar_texto(v_srv,
    $t$Se alguém perguntar "o que é o Emprega+", "como funciona o Emprega+" ou similar,
NUNCA diga que ele não é da Rede CUCA ou que você não conhece. Explique que é o canal
de vagas de emprego da Rede CUCA e ofereça encaminhar para esse atendimento.$t$,
    $t$Se alguém perguntar sobre o Emprega+ ou sobre emprego, NUNCA diga que ele não é da Rede
CUCA ou que você não conhece, e NÃO explique como ele funciona: use o encaminhamento para o
canal de empregabilidade.$t$,
    'servicos_rede: §26 regra do Emprega+');

  update public.documentos_rag set conteudo = v_srv
  where id = '19554be4-4cab-49f8-93d2-cc745ae9d92c' and conteudo is distinct from v_srv;
end
$$;

-- 3. prompt_sistema do Institucional
do $$
declare
  v_sis text;
begin
  select prompt_sistema into v_sis from public.prompts_agentes where id = '719884bd-26bb-466a-9b54-9effc49f8128';
  if v_sis is null then
    raise exception 'S-INST-QUAL-01: prompt do Institucional não encontrado';
  end if;

  v_sis := pg_temp.trocar_texto(v_sis,
    $t$    - Empregabilidade e acesso aos espaços do CUCA
$t$,
    $t$    - Acesso aos espaços do CUCA
    Empregabilidade (emprego, trabalho, estágio, jovem aprendiz, currículo, contratação) NÃO é assunto que você responde: só encaminha, pela regra de ENCAMINHAMENTO PARA OUTROS CANAIS.
$t$,
    'prompt_sistema: guardrail de escopo');

  v_sis := pg_temp.trocar_texto(v_sis,
    $t$  - Empregabilidade (vagas de emprego, currículo, entrevista, mercado de trabalho)$t$,
    $t$  - Empregabilidade (vagas de emprego, estágio, jovem aprendiz, currículo, entrevista, contratação, trabalho, trampo, bico)$t$,
    'prompt_sistema: lista do encaminhamento');

  update public.prompts_agentes set prompt_sistema = v_sis
  where id = '719884bd-26bb-466a-9b54-9effc49f8128' and prompt_sistema is distinct from v_sis;
end
$$;
