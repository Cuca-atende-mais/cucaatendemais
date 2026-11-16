-- S-INST-QUAL-07 — base institucional única (`servicos_rede`), organizada em seções e enviada inteira.
--
-- Texto validado pelo Junior e pelo sócio (João) e aprovado pelo Junior em 15/11/2026 (AC1);
-- o registro fica em `metadados.validacao`, `aprovado_por` e `aprovado_em`, fora do texto que vai ao modelo.
--
-- O que faz, numa transação só (a migration roda inteira ou nada):
--   1. grava o `servicos_rede` novo (id fixo) e garante que ele está ATIVO, com 5653 caracteres
--      (o atual, 19554be4, tem 14.759). `carregarServicosRede` (motor-agente) lê o ativo mais
--      recente; o gatilho `tr_indexar_documento` pula `servicos_rede`, então ele não vira trechos;
--   2. desativa o `servicos_rede` antigo (fica guardado, para voltar) — só depois de conferir que o
--      novo está ativo, para nunca deixar o atendimento sem base;
--   3. só depois, desativa as 3 FAQs institucionais que ainda estão ativas (AC4). A FAQ
--      "Empregabilidade e Vagas" (a3ad5c44) já está desativada desde 03/11 (S-INST-QUAL-01).
--      Desativar só muda `ativo`; o gatilho de indexação não roda (ele olha titulo/conteudo) e
--      `buscar_chunks_similares` já filtra `ativo = true`;
--   4. confere que sobrou exatamente 1 `servicos_rede` ativo.
--   0. antes de tudo, ajusta o guardrail de escopo do `prompt_sistema` do Institucional (decisão do
--      Junior, 15/11, depois do gabarito): sem as FAQs, o modelo recusava com "Não consigo te ajudar
--      com isso" perguntas sobre a unidade que a base não responde (ex.: estacionamento). A frase nova
--      diz que essas perguntas são do CUCA e vão para a regra de falta de informação ("não encontrei"
--      + telefone). O guardrail para assuntos de fora (matemática, receitas etc.) não muda. O mesmo par
--      de textos está em `supabase/functions/motor-agente/eval/lib/base07.ts` (o teste confere).
-- Rodar de novo (inclusive depois de um rollback) publica de novo o texto deste arquivo.
--
-- Para voltar (rollback):
--   update public.documentos_rag set ativo = true  where id = '19554be4-4cab-49f8-93d2-cc745ae9d92c';
--   update public.documentos_rag set ativo = false where id = '7693e78c-ae64-4c3c-a1f9-693928823269';
--   update public.documentos_rag set ativo = true  where id in ('74a99302-b098-4df2-87be-fe4fad438db1',
--     '69520872-887e-47e2-85d6-5c95a46cbecc', 'ff197b71-9259-48fd-a990-a10c548dc85e');
--   e, no prompt_sistema do Institucional (719884bd), tirar o parágrafo que começa com
--   "Pergunta sobre uma unidade ou sobre a Rede CUCA" (a linha da recusa logo abaixo fica).

-- 0. guardrail de escopo do prompt_sistema. Idempotente: confere primeiro o texto NOVO (que contém o
-- antigo no fim, então checar o antigo primeiro duplicaria o parágrafo numa segunda rodada).
do $g0$
declare
  v_antigo constant text := $g$    Se a pergunta não tiver relação com o CUCA, recuse educadamente e redirecione:$g$;
  v_novo constant text := $g$    Pergunta sobre uma unidade ou sobre a Rede CUCA (estrutura, estacionamento, acessibilidade, dias e horários de funcionamento, serviços) É assunto do CUCA, mesmo quando a base não tiver a resposta. Nesse caso, NUNCA use a recusa abaixo: siga a regra de falta de informação das REGRAS OBRIGATÓRIAS — diga que não encontrou e passe o telefone da unidade.
    Se a pergunta não tiver relação com o CUCA, recuse educadamente e redirecione:$g$;
  v_sis text;
begin
  select prompt_sistema into v_sis
  from public.prompts_agentes
  where id = '719884bd-26bb-466a-9b54-9effc49f8128' and agente_tipo = 'Institucional';
  if v_sis is null then
    raise exception 'S-INST-QUAL-07: prompt do Institucional não encontrado';
  end if;
  if position(v_novo in v_sis) > 0 then
    return;
  end if;
  if position(v_antigo in v_sis) = 0 then
    raise exception 'S-INST-QUAL-07: guardrail de escopo não encontrado no prompt_sistema, revisar antes de aplicar';
  end if;
  update public.prompts_agentes
  set prompt_sistema = replace(v_sis, v_antigo, v_novo)
  where id = '719884bd-26bb-466a-9b54-9effc49f8128';
end
$g0$;

do $do$
declare
  v_novo constant uuid := '7693e78c-ae64-4c3c-a1f9-693928823269';
  v_texto constant text := $base$BASE INSTITUCIONAL DA REDE CUCA

1. QUEM SOMOS

A Rede Cuca é uma política pública da Prefeitura de Fortaleza voltada principalmente para a juventude. São cinco unidades, em diferentes territórios da cidade: Cuca Barra, Cuca Mondubim, Cuca José Walter, Cuca Pici e Cuca Jangurussu. Os Cucas são espaços públicos que oferecem formação, esporte, cultura, lazer, tecnologia, convivência, cidadania e apoio ao projeto de vida dos jovens.

Quem pode participar: a Rede atende prioritariamente jovens de 15 a 29 anos que moram em Fortaleza. Algumas atividades têm público próprio e atendem crianças, adolescentes, adultos, pessoas idosas, famílias, coletivos e a comunidade em geral. A faixa etária de cada atividade está na programação do mês.

É gratuito: cursos, esportes, atividades culturais, oficinas e eventos são gratuitos. Algumas atividades têm inscrição, seleção ou edital próprio.

2. HORÁRIO DE ATENDIMENTO

As cinco unidades atendem o público de terça a sexta, das 8h às 17h30. No sábado, só há atendimento ao público quando há evento marcado para esse dia, conforme a programação do mês. Segunda-feira, domingo e feriado não há atendimento ao público.

3. ENDEREÇOS E TELEFONES

Endereços:
- Cuca Barra: Av. Presidente Castelo Branco, 6417, Barra do Ceará
- Cuca Mondubim: Rua Professor Glauco Lobo, s/n, Mondubim
- Cuca José Walter: Rua 69, Prefeito José Walter
- Cuca Pici: Rua Coronel Matos Dourado, 1499, Pici
- Cuca Jangurussu: Av. Governador Leonel Brizola, s/n, Jangurussu

Telefones das unidades (números só para ligação):
- Cuca Barra: (85) 99796-0256
- Cuca Mondubim: (85) 99796-0300
- Cuca José Walter: (85) 99796-0198
- Cuca Pici: (85) 99796-0354
- Cuca Jangurussu: (85) 99796-0190

4. MATRÍCULA

- A matrícula costuma acontecer na primeira semana de cada mês, começando na terça-feira. É feita pelo Portal da Juventude (https://portaldajuventude.fortaleza.ce.gov.br/portal-web/#/) ou presencialmente na unidade, enquanto houver vaga.
- As vagas costumam ser preenchidas na semana da matrícula. Antes de ir à unidade se inscrever, o recomendado é ligar para a unidade e confirmar se ainda há vaga.
- Cada pessoa pode fazer até 2 modalidades diferentes. Não é possível fazer 2 turmas da mesma modalidade.
- Documentos para a matrícula: documento oficial com foto, CPF, comprovante de residência e e-mail.
- Menores de 18 anos: a matrícula presencial é feita pelo responsável.
- Atestado médico: obrigatório para toda modalidade esportiva. Cursos, atividades do Dia a Dia e Especiais (agenda cultural) não exigem atestado.
- Natação: além do atestado, há um teste de natação, feito pela unidade.
- Acesso ao Portal da Juventude: quem perdeu o acesso ou precisa atualizar o cadastro no portal pede à equipe de matrícula da unidade.

5. FREQUÊNCIA E CERTIFICADO

- Existe frequência mínima em todos os cursos. Quem falta sem justificativa pode não receber o certificado.
- Certificado de curso antigo: consultar pelo Portal da Juventude ou direto na unidade onde o curso foi feito.

6. SERVIÇOS E PROGRAMAS PERMANENTES

O que não muda de mês para mês. Cursos, esportes, turmas e horários de atividades estão na programação mensal, não aqui.

- Bibliotecas: acervo de livros, computadores com internet, espaço de estudo e pesquisa e atividades de leitura. Abertas a todos, não só a quem está matriculado.
- Cuca Saudável: educação em saúde, prevenção, redução de danos, preservativos gratuitos, testagem rápida e encaminhamento para a rede de saúde. Para a testagem, a pessoa vai direto à unidade, ligando antes para marcar.
- Direitos Humanos: rodas de conversa, formações, orientação, campanhas e encaminhamentos. As ações variam por unidade.
- Horizonte Digital: formação em tecnologia (cursos, oficinas, laboratórios e hackathons) nas cinco unidades.
- Jovens Monitores: programa de formação e experiência prática nos projetos da Rede. Tem edital próprio, aberto só em alguns períodos. Para saber se há edital aberto, ligar para a unidade.
- Ensaios Abertos: espaços e equipamentos para músicos e bandas, conforme a chamada de cada edição.
- Comunidade em Pauta: grupos e coletivos podem pedir espaços da unidade para ensaios, reuniões e ações comunitárias, conforme a disponibilidade. O pedido é feito ligando para a unidade.
- Cuca na Comunidade: ações da Rede levadas aos bairros.
- Visita guiada: escolas, instituições e grupos podem agendar uma visita à unidade, ligando para a unidade.
- Acesso CUCA: falar com a unidade, por telefone ou pessoalmente.
- Propostas de atrações: artistas, produtores e grupos que querem apresentar uma proposta para a programação falam com a unidade, por telefone ou pessoalmente. Enviar uma proposta não garante a contratação.
- Atendimento psicossocial: esta base ainda não tem a informação.
- Turma Integração: esta base ainda não tem a descrição. As turmas de Integração que existirem estão na programação do mês.

Defensoria Pública (só no Cuca Barra):
- Atendimento de terça a quinta, das 8h às 12h e das 13h às 16h; na sexta, das 8h às 12h e das 13h às 15h.
- A senha é retirada no setor de matrícula do Cuca Barra. Senhas por dia: terça, 10 à tarde; quarta, 10 de manhã e 10 à tarde; quinta, 10 de manhã e 10 à tarde; sexta, 5 à tarde.
- Atendimento on-line pelo WhatsApp (85) 98976-3733.

Emprega+: é o canal de vagas de emprego da Rede Cuca e faz parte da Rede Cuca, com WhatsApp próprio. Perguntas sobre emprego, estágio, jovem aprendiz, currículo ou primeiro emprego são atendidas lá.

7. CANAIS OFICIAIS

- Portal da Juventude: https://portaldajuventude.fortaleza.ce.gov.br/portal-web/#/
- Instagram oficial da Rede Cuca: @redecucaoficial (https://www.instagram.com/redecucaoficial/)$base$;
  v_validacao constant jsonb := $val${
  "1_quem_somos": "Junior e João (sócio), 15/11/2026",
  "2_horario": "Mariana, 02/11; sábado, domingo e feriado: Junior, 15/11; texto final validado por Junior e João (sócio), 15/11/2026",
  "3_telefones": "Mariana, 26/10; texto final validado por Junior e João (sócio), 15/11/2026",
  "3_enderecos": "Junior e João (sócio), 15/11/2026",
  "4_matricula_periodo_portal_ligar_antes": "Valmir (texto-base do aviso de matrícula), 26/10; texto final validado por Junior e João (sócio), 15/11/2026",
  "4_ate_2_modalidades": "Mariana; texto final validado por Junior e João (sócio), 15/11/2026",
  "4_documentos": "Junior e João (sócio), 15/11/2026",
  "4_menores_18": "Mariana, 02/11; texto final validado por Junior e João (sócio), 15/11/2026",
  "4_atestado": "Valmir, com base na Mariana, 26/10; texto final validado por Junior e João (sócio), 15/11/2026",
  "4_teste_natacao": "Junior e João (sócio), 15/11/2026",
  "4_acesso_portal": "Mariana; texto final validado por Junior e João (sócio), 15/11/2026",
  "5_frequencia_certificado": "Mariana, 02/11; texto final validado por Junior e João (sócio), 15/11/2026",
  "5_certificado_antigo": "Mariana, 22/10; texto final validado por Junior e João (sócio), 15/11/2026",
  "6_bibliotecas_testagem_horizonte_monitores_comunidade_visita": "Junior e João (sócio), 15/11/2026",
  "6_caminhos_de_acesso": "Junior e João (sócio), 15/11/2026",
  "6_acesso_cuca_e_propostas": "Junior e João (sócio), 15/11/2026",
  "6_direitos_humanos_ensaios_cuca_na_comunidade": "Junior e João (sócio), 15/11/2026",
  "6_defensoria": "Mariana (dados); manhã de terça e sexta confirmada pelo Junior, 15/11; texto final validado por Junior e João (sócio), 15/11/2026",
  "6_emprega_mais": "Mariana, 22/10; texto final validado por Junior e João (sócio), 15/11/2026",
  "6_psicossocial": "sem informação na base; mantido assim; texto final validado por Junior e João (sócio), 15/11/2026",
  "6_integracao": "sem descrição na base; mantido assim; texto final validado por Junior e João (sócio), 15/11/2026",
  "7_canais_oficiais": "Valmir, 26/10; texto final validado por Junior e João (sócio), 15/11/2026"
}$val$::jsonb;
  v_ativos int;
begin
  if length(v_texto) > 9000 then
    raise exception 'S-INST-QUAL-07: base com % caracteres, acima do limite de 9.000 (AC1)', length(v_texto);
  end if;
  if position('Telefones das unidades' in v_texto) = 0 then
    -- a regra B do motor-agente e o prompt mandam copiar o telefone desta lista
    raise exception 'S-INST-QUAL-07: a base precisa da lista "Telefones das unidades"';
  end if;

  -- 1. documento novo, ativo
  insert into public.documentos_rag (id, titulo, tipo, conteudo, metadados, unidade_cuca, ativo)
  values (
    v_novo,
    'Base institucional da Rede Cuca (novembro de 2026)',
    'servicos_rede',
    v_texto,
    jsonb_build_object(
      'source_type', 'rede_cuca_global',
      'origem', 'S-INST-QUAL-07',
      'substitui', '19554be4-4cab-49f8-93d2-cc745ae9d92c',
      'validacao', v_validacao,
      'aprovado_por', 'Junior (Valmir)',
      'aprovado_em', '2026-11-15'
    ),
    null,
    true
  )
  on conflict (id) do update
    set titulo = excluded.titulo, conteudo = excluded.conteudo, metadados = excluded.metadados, ativo = true;

  if not exists (select 1 from public.documentos_rag where id = v_novo and tipo = 'servicos_rede' and ativo) then
    raise exception 'S-INST-QUAL-07: a base nova não ficou ativa; nada foi desativado';
  end if;

  -- 2. antigo desativado (qualquer outro servicos_rede ativo)
  update public.documentos_rag
  set ativo = false
  where tipo = 'servicos_rede' and ativo = true and id <> v_novo;

  -- 3. FAQs, só depois da base publicada
  update public.documentos_rag
  set ativo = false
  where ativo = true
    and id in (
      '74a99302-b098-4df2-87be-fe4fad438db1',  -- O que é a Rede CUCA? (D12)
      '69520872-887e-47e2-85d6-5c95a46cbecc',  -- Como se inscrever em cursos e atividades (P2)
      'ff197b71-9259-48fd-a990-a10c548dc85e'   -- Horários de Funcionamento das Unidades CUCA (P1)
    );

  -- 4. exatamente uma base ativa
  select count(*) into v_ativos from public.documentos_rag where tipo = 'servicos_rede' and ativo;
  if v_ativos <> 1 then
    raise exception 'S-INST-QUAL-07: % servicos_rede ativos, esperado 1', v_ativos;
  end if;
end
$do$;
