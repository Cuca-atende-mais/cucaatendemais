-- S-INST-QUAL-01 — correções de conteúdo do Institucional (dados), aplicadas no banco `cuca`.
--
-- A1: desativa a FAQ "SIMULADO ACADEMIA ENEM 2026 — HORÁRIOS" (provas em 20 e 27/09). A busca
--     vetorial (`buscar_chunks_similares`) já filtra `documentos_rag.ativo = true`, então os trechos
--     saem da busca sem reindexar. A FAQ de "Horários de Funcionamento" fica (P1).
-- A2: tira "vagas" (no sentido de quantidade) do `prompt_contexto` (item 3c) e do `servicos_rede`
--     (§3, item 6). O `servicos_rede` não é reindexado (o gatilho pula esse tipo) e entra inteiro no
--     prompt.
-- A4: a REGRA CRÍTICA DE HANDOVER do `prompt_sistema` passa a listar as mesmas pessoas e setores
--     que o código detecta.
-- A9: sai o "transbordo depois de 3 tentativas"; a regra nova (sem resposta na base → atendente)
--     fica no código (`INSTRUCAO_INSTITUCIONAL`). O ANTI-ALUCINAÇÃO passa a seguir a mesma regra.
-- A8: sai o "Maria só responde sobre PROGRAMAÇÃO" da regra de encaminhamento, que brigava com o
--     guardrail que lista Empregabilidade como assunto permitido.
-- A11: `unidades_cuca.telefone` passa para os números validados pela Mariana (26/10). Os fixos
--     antigos: Barra (85) 3101-2040, Mondubim 3101-2042, Jangurussu 3101-2044, José Walter
--     3101-2046, Pici 3101-2048.
--
-- Todas as trocas de texto funcionam também com o motor-agente anterior (só tiram texto ou
-- apontam para as regras obrigatórias, que existem nas duas versões).
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

-- A1
update public.documentos_rag
set ativo = false
where id = '929ad61f-78ce-47cc-8b3d-2b789ef4970c' and ativo = true;

-- A4, A8, A9 (prompt_sistema) e A2 (prompt_contexto) do Institucional
do $$
declare
  v_sis text;
  v_ctx text;
begin
  select prompt_sistema, prompt_contexto into v_sis, v_ctx
  from public.prompts_agentes where id = '719884bd-26bb-466a-9b54-9effc49f8128';
  if v_sis is null then
    raise exception 'S-INST-QUAL-01: prompt do Institucional não encontrado';
  end if;

  v_sis := pg_temp.trocar_texto(v_sis,
    $t$pedir para falar com um atendente humano, gerente, coordenador ou pessoa real (ex.: "quero falar com humano", "atendente",
    "pessoa real"), OU se você não conseguir resolver uma dúvida complexa depois de 3 tentativas, você DEVE$t$,
    $t$pedir para falar com um atendente humano, gerente, coordenador(a), diretor(a), responsável, funcionário(a), alguém da equipe ou de um setor (ex.: "quero falar com humano", "atendente",
    "pessoa real", "quero falar com o gerente", "alguém do setor de matrícula"), ou quando as regras obrigatórias mandarem chamar um atendente por falta de informação na base, você DEVE$t$,
    'prompt_sistema: regra de handover');
  v_sis := pg_temp.trocar_texto(v_sis,
    $t$    Se não encontrar a informação, diga: "Não tenho essa informação aqui, mas você pode confirmar diretamente na unidade ou pelo Portal da Juventude (https://portaldajuventude.fortaleza.ce.gov.br/portal-web/#/)."
$t$,
    $t$    Se não encontrar a informação, siga a regra de falta de informação das REGRAS OBRIGATÓRIAS — nunca complete com suposição.
$t$,
    'prompt_sistema: anti-alucinação');
  v_sis := pg_temp.trocar_texto(v_sis,
    $t$  Você (Maria) só responde sobre a PROGRAMAÇÃO do CUCA (cursos, atividades, eventos, horários,
  unidades). Se o jovem perguntar especificamente sobre:$t$,
    $t$  Alguns assuntos da Rede CUCA são atendidos por OUTRO canal. Se o jovem perguntar sobre:$t$,
    'prompt_sistema: encaminhamento');
  v_ctx := pg_temp.trocar_texto(v_ctx,
    $t$→ Use TUDO que o RAG tiver: descrição, professor, local, horário, vagas, requisitos.$t$,
    $t$→ Use TUDO que o RAG tiver: descrição, professor, local, horário, requisitos.$t$,
    'prompt_contexto: item 3c');

  update public.prompts_agentes
  set prompt_sistema = v_sis, prompt_contexto = v_ctx
  where id = '719884bd-26bb-466a-9b54-9effc49f8128'
    and (prompt_sistema is distinct from v_sis or prompt_contexto is distinct from v_ctx);
end
$$;

-- A2 (servicos_rede ativo)
do $$
declare
  v_srv text;
begin
  select conteudo into v_srv from public.documentos_rag where id = '19554be4-4cab-49f8-93d2-cc745ae9d92c';
  if v_srv is null then
    raise exception 'S-INST-QUAL-01: servicos_rede não encontrado';
  end if;
  v_srv := pg_temp.trocar_texto(v_srv,
    $t$5. horários;
6. quantidade de vagas, quando disponível;
7. documentos necessários;
8. como realizar a inscrição.$t$,
    $t$5. horários;
6. documentos necessários;
7. como realizar a inscrição.$t$,
    'servicos_rede: §3 item 6');
  update public.documentos_rag set conteudo = v_srv
  where id = '19554be4-4cab-49f8-93d2-cc745ae9d92c' and conteudo is distinct from v_srv;
end
$$;

-- A11
update public.unidades_cuca u
set telefone = n.telefone
from (values
  ('CUCA Barra',       '(85) 99796-0256'),
  ('CUCA Mondubim',    '(85) 99796-0300'),
  ('CUCA José Walter', '(85) 99796-0198'),
  ('CUCA Pici',        '(85) 99796-0354'),
  ('CUCA Jangurussu',  '(85) 99796-0190')
) as n(nome, telefone)
where u.nome = n.nome and u.telefone is distinct from n.telefone;
