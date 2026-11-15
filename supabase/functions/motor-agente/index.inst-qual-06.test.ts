// S-INST-QUAL-06 — rota do Institucional consolidada: uma leitura por IA + decisão em código.
// Cobre AC1 (`decidirRota`, uma linha da tabela da story por teste), AC6 (leitura com timeout, erro
// ou JSON inválido cai na rota antiga com rota_fallback = true) e parte do AC5 (chave desligada não
// chama a leitura; a comparação completa, byte a byte, é feita pelo gabarito offline).
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  type AcaoRota,
  consolidarLeitura,
  decidirRota,
  ESCOLHA_REDE,
  faixaEtariaDoDetalhe,
  type EstadoRota,
  handler,
  type ItemProgramacao,
  type LeituraTurno,
  lerChaveRotaEstruturada,
  lerTurnoInstitucional,
  MARCA_CONFIRMAR_ESCOPO,
  MARCADOR_CLASSIFICADOR_EMPREGO,
  MARCADOR_LEITURA_TURNO,
  MENU_UNIDADES,
  mensagemPedeDetalhe,
  montarConsultaComContexto,
  montarMensagemEncaminhamento,
  montarPerguntaAtividade,
  montarPerguntaConfirmarEscopo,
  opcoesDeAtividade,
  PERGUNTA_VAGA_AMBIGUA,
  redefinirCacheRotaEstruturada,
  resolverEscolhaDeAtividade,
  resolverRespostaConfirmacao,
  completarSoUnidadeComPedidoAnterior,
  pedidoAnteriorDoLead,
  textoPedeRede,
  validarLeituraTurno,
  definirRelogioAtendimento,
  dentroHorarioAtendimentoHumano,
  deveAcionarHandoverInstitucional,
  MENSAGEM_FORA_HORARIO_ATENDENTE,
  removerOfertaDeAtendente,
  respostaSemAtendente,
  montarContatoUnidades,
  FRASE_SEM_INFORMACAO,
  atividadeNovaNaConversa,
} from "./index.ts";

// S-INST-QUAL-06: transbordo só dentro do horário do atendente (seg a sex, 08:00–16:59). Relógio fixo
// numa quarta às 15:00 para os testes de transbordo não dependerem da hora em que a suíte roda.
const QUARTA_15H = () => new Date("2026-11-11T15:00:00-03:00");
definirRelogioAtendimento(QUARTA_15H);

// ── Apoio ──────────────────────────────────────────────────────────────────────────────────
const leitura = (parcial: Partial<LeituraTurno>): LeituraTurno => ({
  tipo: "pedido_novo",
  assunto: "programacao",
  unidade_citada: null,
  escopo: "nao_disse",
  canal: null,
  atividade: null,
  termos_busca: [],
  area: null,
  idade: null,
  contexto: {},
  ...parcial,
});

const estado = (parcial: Partial<EstadoRota> = {}): EstadoRota => ({
  unidadeSalva: null,
  unidadeAnterior: null,
  escopoRedeSalvo: false,
  sessaoReaberta: false,
  primeiraRespostaDaSessao: false,
  ultimaRespostaFoiPronta: false,
  disparoRecente: false,
  contextoDeProgramacao: false,
  pedeDetalhe: false,
    atividadeNovaNaConversa: false,
  opcoesAtividade: () => [],
  ...parcial,
});

const item = (unidade: string, titulo: string, idade: string, area: ItemProgramacao["area"] = "ESPORTES"): ItemProgramacao => ({
  unidade,
  titulo,
  detalhe: "Esporte Modalidade: " + titulo + " - Turma TURMA 1. Público: Misto (Idade: " + idade + "). Dias: Ter e Qui. Horário: 07:00 às 08:00.",
  area,
});
// Títulos reais do catálogo de 2026-11 (Cuca Pici), incluindo o espaço duplo de "NATAÇÃO  SELEÇÃO".
const ITENS: ItemProgramacao[] = [
  item("Cuca Pici", "NATAÇÃO", "15 a 29 anos"),
  item("Cuca Pici", "NATAÇÃO", "15 a 29 anos"),
  item("Cuca Pici", "NATAÇÃO INFANTIL", "08 a 14 anos"),
  item("Cuca Pici", "NATAÇÃO  SELEÇÃO", "15 a 29 anos"),
  item("Cuca Pici", "NATAÇÃO SELEÇÃO", "15 a 29 anos"),
  item("Cuca Pici", "NATAÇÃO PARALIMPICA", "15 a 29 anos"),
  item("Cuca Pici", "JIU-JITSU", "15 a 29 anos"),
  item("Cuca Barra", "NATAÇÃO", "15 a 29 anos"),
  item("Cuca Barra", "BALÉ INFANTIL", "07 a 12 anos", "CURSOS"),
  item("Cuca Barra", "TEATRO", "15 a 29 anos", "CURSOS"),
];

// ── AC1: decidirRota, uma linha da tabela por teste ──────────────────────────────────────────
Deno.test("AC1 linha 1: unidade_citada = varias → menu de unidades", () => {
  assertEquals(decidirRota(leitura({ unidade_citada: "varias", atividade: "natação" }), estado({ unidadeSalva: "Cuca Barra" })).acao, "menu_unidades");
});

Deno.test("AC1 linha 2: saudação na 1ª resposta → saudação pronta; cortesia → frase pronta; despedida → encerra", () => {
  assertEquals(decidirRota(leitura({ tipo: "saudacao", assunto: null }), estado({ primeiraRespostaDaSessao: true })).acao, "saudacao");
  assertEquals(decidirRota(leitura({ tipo: "cortesia", assunto: null }), estado()).acao, "cortesia");
  assertEquals(decidirRota(leitura({ tipo: "saudacao", assunto: null }), estado()).acao, "cortesia");
  assertEquals(decidirRota(leitura({ tipo: "despedida", assunto: null }), estado({ primeiraRespostaDaSessao: true })).acao, "despedida");
  // não repete a frase pronta (story 05): segue pela pergunta geral ou pela unidade salva
  assertEquals(decidirRota(leitura({ tipo: "cortesia", assunto: null }), estado({ ultimaRespostaFoiPronta: true })).acao, "pergunta_geral");
  assertEquals(decidirRota(leitura({ tipo: "cortesia", assunto: null }), estado({ ultimaRespostaFoiPronta: true, unidadeSalva: "Cuca Pici" })), { acao: "unidade", unidade: "Cuca Pici", pedido: true, troca: false });
  // disparo recente ainda não reconhecido: o modelo responde, com o aviso no prompt
  assertEquals(decidirRota(leitura({ tipo: "saudacao", assunto: null }), estado({ primeiraRespostaDaSessao: true, disparoRecente: true })).acao, "gpt_livre");
});

Deno.test("AC1 linha 3: pedido de humano (gerente, funcionário, setor) → transbordo", () => {
  assertEquals(decidirRota(leitura({ tipo: "pedido_humano", assunto: null }), estado({ unidadeSalva: "Cuca Barra" })).acao, "handover");
});

Deno.test("AC1 linha 4: outro canal → encaminhar (empregabilidade e Acesso CUCA)", () => {
  assertEquals(decidirRota(leitura({ tipo: "outro_canal", assunto: null, canal: "empregabilidade" }), estado()), { acao: "encaminhar", canal: "empregabilidade" });
  assertEquals(decidirRota(leitura({ tipo: "outro_canal", assunto: null, canal: "acesso_cuca" }), estado()), { acao: "encaminhar", canal: "acesso_cuca" });
});

Deno.test("AC1 linha 5: 'vagas' sem contexto → pergunta emprego ou curso; 'vagas' depois de natação é programação", () => {
  assertEquals(decidirRota(leitura({ tipo: "vagas_ambiguo", assunto: null }), estado()).acao, "perguntar_vaga");
  assertEquals(decidirRota(leitura({ tipo: "continuacao", atividade: "natação", termos_busca: ["natacao"] }), estado({ unidadeSalva: "Cuca Pici" })), { acao: "programacao", escopo: "Cuca Pici", escopoDaMensagem: false, listarPorIdade: false });
});

Deno.test("AC1 linha 6: escopo = rede → programação da rede (sem atividade nem área, pergunta a área)", () => {
  assertEquals(decidirRota(leitura({ escopo: ESCOLHA_REDE, atividade: "judô", termos_busca: ["judo"] }), estado()), { acao: "programacao", escopo: ESCOLHA_REDE, escopoDaMensagem: true, listarPorIdade: false });
  assertEquals(decidirRota(leitura({ escopo: ESCOLHA_REDE, assunto: "o_que_tem" }), estado()), { acao: "perguntar_area", escopo: ESCOLHA_REDE, escopoDaMensagem: true });
});

Deno.test("AC1 linha 7: pedido novo sem escopo, com unidade salva, conversa reaberta ou >2h → confirmar o escopo (1, 2 ou 3)", () => {
  // >2h: a S-WM-71 zerou a unidade salva; vale a de antes do corte
  assertEquals(decidirRota(leitura({ atividade: "natação" }), estado({ unidadeAnterior: "Cuca Pici", sessaoReaberta: true })), { acao: "confirmar_escopo", unidade: "Cuca Pici" });
  // conversa encerrada e reaberta dentro das 2h (unidade ainda salva)
  assertEquals(decidirRota(leitura({ assunto: "o_que_tem" }), estado({ unidadeSalva: "Cuca Barra", sessaoReaberta: true })), { acao: "confirmar_escopo", unidade: "Cuca Barra" });
  // pergunta institucional (vale para a rede toda) não confirma: segue
  assertEquals(decidirRota(leitura({ assunto: "institucional" }), estado({ unidadeAnterior: "Cuca Barra", sessaoReaberta: true })).acao, "pergunta_geral");
  // com escopo dito na mensagem, não confirma
  assertEquals(decidirRota(leitura({ escopo: "Cuca Barra", unidade_citada: "Cuca Barra", assunto: "institucional" }), estado({ unidadeAnterior: "Cuca Pici", sessaoReaberta: true })).acao, "unidade");
  const pergunta = montarPerguntaConfirmarEscopo("Cuca Pici");
  assertStringIncludes(pergunta, "Você quer saber do Cuca Pici, de outra unidade ou da rede toda? Responda 1, 2 ou 3.");
  assertStringIncludes(pergunta, "1️⃣ Cuca Pici\n2️⃣ Outra unidade\n3️⃣ Toda a Rede CUCA");
});

Deno.test("AC1 linha 8: continuação com unidade salva → segue na unidade, sem perguntar", () => {
  assertEquals(decidirRota(leitura({ tipo: "continuacao", atividade: "capoeira" }), estado({ unidadeSalva: "Cuca Pici", sessaoReaberta: true })), { acao: "programacao", escopo: "Cuca Pici", escopoDaMensagem: false, listarPorIdade: false });
  assertEquals(decidirRota(leitura({ tipo: "continuacao", assunto: "institucional" }), estado({ unidadeSalva: "Cuca Pici" })), { acao: "unidade", unidade: "Cuca Pici", pedido: true, troca: false });
});

Deno.test("AC1 linha 9: pedido novo sem escopo e sem unidade salva → rede filtrada pela atividade; sem atividade, pergunta a unidade", () => {
  assertEquals(decidirRota(leitura({ atividade: "natação" }), estado()), { acao: "programacao", escopo: ESCOLHA_REDE, escopoDaMensagem: false, listarPorIdade: false });
  assertEquals(decidirRota(leitura({ area: "CURSOS" }), estado()).acao, "perguntar_escopo");
  assertEquals(decidirRota(leitura({ assunto: "o_que_tem" }), estado()).acao, "perguntar_escopo");
  // pergunta institucional sem unidade não pede a unidade antes: vai para a pergunta geral
  assertEquals(decidirRota(leitura({ assunto: "institucional" }), estado()).acao, "pergunta_geral");
});

Deno.test("AC1 linha 10: unidade resolvida com pedido → responde o pedido; programação inteira só para 'o que tem' ou só a unidade", () => {
  assertEquals(decidirRota(leitura({ escopo: "Cuca Barra", unidade_citada: "Cuca Barra", assunto: "institucional" }), estado()), { acao: "unidade", unidade: "Cuca Barra", pedido: true, troca: true });
  assertEquals(decidirRota(leitura({ escopo: "Cuca Barra", unidade_citada: "Cuca Barra", atividade: "natação" }), estado()), { acao: "programacao", escopo: "Cuca Barra", escopoDaMensagem: true, listarPorIdade: false });
  assertEquals(decidirRota(leitura({ escopo: "Cuca Barra", unidade_citada: "Cuca Barra", assunto: "o_que_tem" }), estado()), { acao: "unidade", unidade: "Cuca Barra", pedido: false, troca: true });
  assertEquals(decidirRota(leitura({ tipo: "so_unidade", assunto: null, escopo: "Cuca Barra", unidade_citada: "Cuca Barra" }), estado()), { acao: "unidade", unidade: "Cuca Barra", pedido: false, troca: true });
});

Deno.test("AC1 linha 11: idade sem atividade → lista as turmas compatíveis, na unidade ou na rede", () => {
  assertEquals(decidirRota(leitura({ idade: 8 }), estado({ unidadeSalva: "Cuca Barra" })), { acao: "programacao", escopo: "Cuca Barra", escopoDaMensagem: false, listarPorIdade: true });
  assertEquals(decidirRota(leitura({ idade: 8 }), estado()), { acao: "programacao", escopo: ESCOLHA_REDE, escopoDaMensagem: false, listarPorIdade: true });
  assertEquals(decidirRota(leitura({ assunto: "o_que_tem", idade: 8 }), estado()), { acao: "programacao", escopo: ESCOLHA_REDE, escopoDaMensagem: false, listarPorIdade: true });
  const r = montarConsultaComContexto(ITENS, { texto: "minha filha tem 8 anos", atividade: null, termos: [], area: null, contexto: { idade: 8 }, escopo: ESCOLHA_REDE, listarPorIdade: true });
  assertEquals(r.situacao, "idade");
  assertStringIncludes(r.bloco, "NATAÇÃO INFANTIL");
  assertStringIncludes(r.bloco, "BALÉ INFANTIL");
  assert(!r.bloco.includes("TEATRO"), "teatro é de 15 a 29 anos");
});

Deno.test("AC1 linha 12: atividade ambígua → pergunta qual; com idade, filtra antes; continuação não pergunta", () => {
  const opcoesPici = (l: LeituraTurno) => (escopo: string) => opcoesDeAtividade(ITENS, l, escopo);
  const natacao = leitura({ atividade: "natação", termos_busca: ["natacao"], escopo: "Cuca Pici", unidade_citada: "Cuca Pici" });
  const acao = decidirRota(natacao, estado({ opcoesAtividade: opcoesPici(natacao) })) as Extract<AcaoRota, { acao: "perguntar_atividade" }>;
  assertEquals(acao.acao, "perguntar_atividade");
  assertEquals(acao.opcoes, ["NATAÇÃO (15 a 29 anos)", "NATAÇÃO INFANTIL (08 a 14 anos)", "NATAÇÃO SELEÇÃO (15 a 29 anos)", "NATAÇÃO PARALIMPICA (15 a 29 anos)"]);
  assertStringIncludes(montarPerguntaAtividade(acao.opcoes, "Cuca Pici"), "Encontrei mais de uma opção no Cuca Pici:\n\n1️⃣ NATAÇÃO (15 a 29 anos)\n2️⃣ NATAÇÃO INFANTIL (08 a 14 anos)");
  // idade 10 → só a infantil sobra: não pergunta
  const comIdade = { ...natacao, idade: 10, contexto: { idade: 10 } };
  assertEquals(decidirRota(comIdade, estado({ opcoesAtividade: opcoesPici(comIdade) })).acao, "programacao");
  // continuação não reabre a pergunta
  const cont = { ...natacao, tipo: "continuacao" as const };
  assertEquals(decidirRota(cont, estado({ opcoesAtividade: opcoesPici(cont) })).acao, "programacao");
  // termo que já discrimina ("natação infantil") não é ambíguo
  assertEquals(opcoesDeAtividade(ITENS, leitura({ atividade: "natação infantil", termos_busca: ["natacao", "infantil"] }), "Cuca Pici"), []);
  // uma opção só na Barra
  assertEquals(opcoesDeAtividade(ITENS, natacao, "Cuca Barra"), []);
});

Deno.test("Atividade escolhida: número ou nome viram o título; consulta usa só aquele título", () => {
  const opcoes = ["NATAÇÃO (15 a 29 anos)", "NATAÇÃO INFANTIL (08 a 14 anos)", "NATAÇÃO PARALIMPICA (15 a 29 anos)"];
  assertEquals(resolverEscolhaDeAtividade("2", opcoes), "NATAÇÃO INFANTIL");
  assertEquals(resolverEscolhaDeAtividade("a infantil", opcoes), "NATAÇÃO INFANTIL");
  assertEquals(resolverEscolhaDeAtividade("natação", opcoes), "NATAÇÃO");
  assertEquals(resolverEscolhaDeAtividade("9", opcoes), undefined);
  const r = montarConsultaComContexto(ITENS, { texto: "tem natação?", atividade: "NATAÇÃO", termos: ["natacao"], area: null, contexto: {}, escopo: "Cuca Pici", tituloExato: "NATAÇÃO" });
  assertEquals(r.situacao, "na_unidade");
  assert(!r.bloco.includes("INFANTIL") && !r.bloco.includes("PARALIMPICA"), r.bloco);
});

Deno.test("Gabarito r1 (CF-04/CF-08): 'vaga' com atividade ou com conversa de programação não pergunta 'emprego ou curso?'", () => {
  // sem contexto nenhum: pergunta
  assertEquals(decidirRota(leitura({ tipo: "vagas_ambiguo", assunto: null }), estado()), { acao: "perguntar_vaga" });
  // "Quantas vagas tem na natação?" (Barra salva) → programação da natação na Barra
  const comAtividade = decidirRota(leitura({ tipo: "vagas_ambiguo", atividade: "natação", termos_busca: ["natacao"] }), estado({ unidadeSalva: "Cuca Barra", contextoDeProgramacao: true }));
  assertEquals(comAtividade.acao, "programacao");
  // "Como saber se tem vaga?" (Jangurussu salva) → responde pela unidade
  assertEquals(decidirRota(leitura({ tipo: "vagas_ambiguo", assunto: null }), estado({ unidadeSalva: "Cuca Jangurussu", contextoDeProgramacao: true })), { acao: "unidade", unidade: "Cuca Jangurussu", pedido: true, troca: false });
});

Deno.test("Gabarito r1 (BU-03/F5-05/F5-03/F4-04/CF-12): pedido de detalhe não vira 'qual dessas opções?'", () => {
  for (const t of ["Qual o horário do vôlei?", "Onde tem curso de informática?", "Qual a idade da natação em cada unidade?", "A natação não pode gente de 15/16 anos?", "Posso me inscrever em duas turmas de natação?", "quais dias tem judô?"]) assert(mensagemPedeDetalhe(t), t);
  for (const t of ["Tem natação no Cuca Pici?", "Tem hidroginástica no Cuca José Walter?", "Natação 16 anos", "quero natação", "bom dia, tem judô?"]) assert(!mensagemPedeDetalhe(t), t);
  const opcoes = () => ["NATAÇÃO", "NATAÇÃO INFANTIL"];
  assertEquals(decidirRota(leitura({ atividade: "vôlei", termos_busca: ["volei"] }), estado({ unidadeSalva: "Cuca Pici", pedeDetalhe: true, opcoesAtividade: opcoes })).acao, "programacao");
  assertEquals(decidirRota(leitura({ atividade: "natação", termos_busca: ["natacao"] }), estado({ unidadeSalva: "Cuca Pici", opcoesAtividade: opcoes })).acao, "perguntar_atividade");
});

Deno.test("Gabarito r1 (F1-01/F3-05): área da mensagem atual manda; 'rede' do modelo só com apoio no texto", () => {
  // rajada "curso pro meu filho de 13" + "Algum esporte" → Esportes
  const f101 = consolidarLeitura(leitura({ tipo: "continuacao", assunto: "o_que_tem", area: "CURSOS" }), "Gostaria de algum curso para o meu filho ele tem 13 anos\nAlgum esporte", ["Gostaria de algum curso para o meu filho ele tem 13 anos", "Algum esporte"]);
  assertEquals(f101.area, "ESPORTES");
  assertEquals(f101.idade, 13);
  // área nula no modelo é completada pelo texto
  assertEquals(consolidarLeitura(leitura({ assunto: "o_que_tem", area: null }), "quais cursos tem?").area, "CURSOS");
  // "quais cursos tem?" com o modelo dizendo rede → não disse; com unidade salva e conversa reaberta, confirma
  const f305 = consolidarLeitura(leitura({ assunto: "o_que_tem", escopo: ESCOLHA_REDE }), "quais cursos tem?");
  assertEquals(f305.escopo, "nao_disse");
  assertEquals(decidirRota(f305, estado({ unidadeSalva: "Cuca Pici", sessaoReaberta: true })), { acao: "confirmar_escopo", unidade: "Cuca Pici" });
  // com apoio no texto, a rede fica
  assert(textoPedeRede("Onde tem curso de informática?"));
  assert(textoPedeRede("tem judô em todas as unidades?"));
  assertEquals(consolidarLeitura(leitura({ escopo: ESCOLHA_REDE, atividade: "informática", termos_busca: ["informatica"] }), "Onde tem curso de informática?").escopo, ESCOLHA_REDE);
});

Deno.test("Gabarito r2 (F6-03): só a unidade logo depois de um pedido de atividade = o mesmo pedido nessa unidade", () => {
  const historico = [
    { role: "user", content: "[CONTEXTO INTERNO — nao e mensagem do lead] NOME DO LEAD: Fulano" },
    { role: "user", content: "Olá" }, { role: "assistant", content: "Em que posso te ajudar? 😊" },
    { role: "user", content: "gostaria de saber quando tem inscrição para natação infantil" }, { role: "user", content: "?" },
    { role: "assistant", content: "A natação infantil está disponível no CUCA José Walter e no CUCA Pici." },
  ];
  const anterior = pedidoAnteriorDoLead(historico);
  assertEquals(anterior, "gostaria de saber quando tem inscrição para natação infantil\n?");
  const soUnidade = leitura({ tipo: "so_unidade", assunto: null, unidade_citada: "Cuca Barra", escopo: "Cuca Barra" });
  const l = completarSoUnidadeComPedidoAnterior(soUnidade, anterior, ITENS);
  assertEquals(l.tipo, "continuacao");
  assertEquals(l.assunto, "programacao");
  assert(l.termos_busca.includes("natacao"), JSON.stringify(l.termos_busca));
  assertEquals(decidirRota(l, estado({ opcoesAtividade: () => ["NATAÇÃO", "NATAÇÃO INFANTIL"] })).acao, "programacao");
  // pedido anterior sem atividade do catálogo ("quero saber sobre vocês"): segue como só a unidade
  assertEquals(completarSoUnidadeComPedidoAnterior(soUnidade, "quero saber sobre vocês", ITENS), soUnidade);
  // sem resposta anterior do bot, não há pedido anterior
  assertEquals(pedidoAnteriorDoLead([{ role: "user", content: "tem natação?" }]), "");
});

Deno.test("Resposta à confirmação de escopo: dois caminhos — 'o mesmo' segue no X; 'não' abre a partir da negativa", () => {
  const r = (t: string) => resolverRespostaConfirmacao(t, "Cuca Barra");
  const MESMA = { tipo: "mesma" }, OUTRA = { tipo: "outra_unidade" };
  // mesma unidade (o contexto anterior continua valendo)
  for (const t of ["1", "sim", "Sim!", "isso", "Essa mesmo!", "o mesmo", "mesmo", "mesmo Cuca Barra", "do Barra mesmo", "pode ser", "sim, a Barra", "ok 👍", "quero no mesmo"]) assertEquals(r(t), MESMA, t);
  // negativa → menu, sem a unidade nem o contexto de antes
  for (const t of ["2", "não", "Nao.", "n", "não quero essa", "outra", "outra unidade", "não é o Barra", "nem", "sim, mas outra unidade"]) assertEquals(r(t), OUTRA, t);
  // negativa que já diz para onde ir
  assertEquals(r("não, do Pici"), { tipo: "escopo", escopo: "Cuca Pici" });
  assertEquals(r("não, quero no José Walter"), { tipo: "escopo", escopo: "Cuca José Walter" });
  assertEquals(r("Pici"), { tipo: "escopo", escopo: "Cuca Pici" });
  assertEquals(r("não é o Barra, é o Pici"), { tipo: "escopo", escopo: "Cuca Pici" });
  assertEquals(r("3"), { tipo: "escopo", escopo: ESCOLHA_REDE });
  assertEquals(r("não, na rede toda"), { tipo: "escopo", escopo: ESCOLHA_REDE });
  // não responde à pergunta → a mensagem segue como mensagem nova
  for (const t of ["não, obrigado", "nao precisa", "Pici ou Barra?", "tem judô?", "qual o endereço?"]) assertEquals(r(t), null, t);
});

Deno.test("Item 6: faixa etária lida do '(Idade: …)' real, não do 'idade:' de 'Modalidade:' nem de datas", () => {
  // Textos reais do catálogo de 2026-11.
  assertEquals(faixaEtariaDoDetalhe("Esporte Modalidade: FUTSAL (SESC) - Turma TURMA 1. Professor: X. Público: Misto (Idade: 8 a 13 anos). Dias: Ter e Qui."), "8 a 13 anos");
  assertEquals(faixaEtariaDoDetalhe("Esporte Modalidade: NATAÇÃO - Turma TURMA 2 (SELEÇÃO). Público: Misto (Idade: 15 a 29 anos)."), "15 a 29 anos");
  assertEquals(faixaEtariaDoDetalhe("HORA PINTADA. Data: 05/11 a 25/11 (quinta-feira). Local: Biblioteca."), null);
  assertEquals(faixaEtariaDoDetalhe("Curso. Requisitos: ter idade entre 15 e 29 anos."), "ter idade 15 a 29 anos");
});

// ── Validação e consolidação da leitura ──────────────────────────────────────────────────────
Deno.test("validarLeituraTurno: tipo fora da lista invalida a leitura (plano B); campos são saneados", () => {
  assertEquals(validarLeituraTurno(null), null);
  assertEquals(validarLeituraTurno([]), null);
  assertEquals(validarLeituraTurno({ tipo: "qualquer" }), null);
  const l = validarLeituraTurno({ tipo: "pedido_novo", unidade_citada: "Cuca Inexistente", escopo: "rede", canal: "financeiro", atividade: "natação", idade: "8", contexto: { Turno: "noite" } })!;
  assertEquals(l.unidade_citada, null);
  assertEquals(l.escopo, "nao_disse");
  assertEquals(l.canal, null);
  assertEquals(l.assunto, "programacao"); // sem assunto, com atividade
  assertEquals(l.idade, 8);
  assertEquals(l.contexto, { turno: "noite" });
  // outro_canal sem canal válido não tem o que encaminhar
  assertEquals(validarLeituraTurno({ tipo: "outro_canal", canal: "financeiro" })!.tipo, "pedido_novo");
});

Deno.test("consolidarLeitura: unidade escrita manda; unidade deduzida (não escrita) sai; duas unidades na rajada = varias", () => {
  assertEquals(consolidarLeitura(leitura({ unidade_citada: "Cuca Pici", escopo: "Cuca Pici" }), "e de vôlei?").escopo, "nao_disse");
  assertEquals(consolidarLeitura(leitura({ unidade_citada: "Cuca Pici", escopo: "Cuca Pici" }), "tem vôlei na Barra?").escopo, "Cuca Barra");
  assertEquals(consolidarLeitura(leitura({ unidade_citada: "Cuca Jangurussu", escopo: "Cuca Jangurussu" }), "tem no jangurusu?").escopo, "Cuca Jangurussu");
  assertEquals(consolidarLeitura(leitura({}), "Barra\nPici", ["Barra", "Pici"]).unidade_citada, "varias");
  assertEquals(consolidarLeitura(leitura({}), "tem judô em todas as unidades?").escopo, ESCOLHA_REDE);
  const comIdade = consolidarLeitura(leitura({ atividade: "natação" }), "natação pra criança de 7 anos");
  assertEquals(comIdade.idade, 7);
  assertEquals(comIdade.contexto.idade, 7);
  assertEquals(comIdade.termos_busca, ["natacao"]);
});

// ── Leitura por IA: timeout, erro e JSON inválido devolvem null (AC6) ──────────────────────────
async function comFetch<T>(falso: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  const errOriginal = console.error;
  globalThis.fetch = falso;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    globalThis.fetch = original;
    console.error = errOriginal;
  }
}
const respostaOpenAI = (conteudo: string) => new Response(JSON.stringify({ choices: [{ message: { content: conteudo } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
const fetchQueNuncaResponde = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_res, rej) => init?.signal?.addEventListener("abort", () => rej(new DOMException("abortado", "AbortError"))))) as typeof fetch;

Deno.test("AC6 (função): leitura com timeout, erro HTTP ou JSON inválido → null", async () => {
  assertEquals(await comFetch(fetchQueNuncaResponde, () => lerTurnoInstitucional("tem natação?", "k", [], undefined, 50)), null);
  assertEquals(await comFetch((() => Promise.resolve(new Response("erro", { status: 500 }))) as typeof fetch, () => lerTurnoInstitucional("tem natação?", "k")), null);
  assertEquals(await comFetch((() => Promise.resolve(respostaOpenAI("não é json"))) as typeof fetch, () => lerTurnoInstitucional("tem natação?", "k")), null);
  assertEquals(await comFetch((() => Promise.resolve(respostaOpenAI(JSON.stringify({ tipo: "inventado" })))) as typeof fetch, () => lerTurnoInstitucional("tem natação?", "k")), null);
  const ok = await comFetch((() => Promise.resolve(respostaOpenAI(JSON.stringify({ tipo: "pedido_novo", assunto: "programacao", atividade: "natação" })))) as typeof fetch, () => lerTurnoInstitucional("tem natação?", "k"));
  assertEquals(ok?.atividade, "natação");
});

// ── Chave rota_estruturada ───────────────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
const supabaseSoConfig = (valor: unknown, falhar = false): any => ({
  from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: () => falhar ? Promise.reject(new Error("rede")) : Promise.resolve({ data: valor === undefined ? null : { valor }, error: null }) }) }),
  }),
});

Deno.test("Chave rota_estruturada: só 'on' liga; ausente, outro valor ou erro = rota antiga", async () => {
  redefinirCacheRotaEstruturada();
  assertEquals(await lerChaveRotaEstruturada(supabaseSoConfig("on"), false), true);
  assertEquals(await lerChaveRotaEstruturada(supabaseSoConfig(" ON "), false), true);
  assertEquals(await lerChaveRotaEstruturada(supabaseSoConfig("off"), false), false);
  assertEquals(await lerChaveRotaEstruturada(supabaseSoConfig(undefined), false), false);
  const errOriginal = console.error;
  console.error = () => {};
  assertEquals(await lerChaveRotaEstruturada(supabaseSoConfig("on", true), false), false);
  console.error = errOriginal;
  // com cache: o valor lido vale por 60 s
  assertEquals(await lerChaveRotaEstruturada(supabaseSoConfig("on"), true), true);
  assertEquals(await lerChaveRotaEstruturada(supabaseSoConfig("off"), true), true);
  redefinirCacheRotaEstruturada();
});

// ── Handler ──────────────────────────────────────────────────────────────────────────────────
type Chamada = { tabela: string; metodo: string; arg?: unknown };
const NUMERO_EMPREGA = "5585999401057";

// deno-lint-ignore no-explicit-any
function supabaseMock(dados: Record<string, unknown>, config: Record<string, string>, chamadas: Chamada[]): any {
  function cadeia(tabela: string) {
    let chave: string | null = null;
    // deno-lint-ignore no-explicit-any
    const proxy: any = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") {
          const data = tabela === "system_config" ? (chave && chave in config ? { valor: config[chave] } : null) : dados[tabela] ?? null;
          return (resolve: (v: unknown) => unknown) => resolve({ data, error: null });
        }
        return (arg?: unknown, valor?: unknown) => {
          if (tabela === "system_config" && prop === "eq" && arg === "chave") chave = String(valor);
          chamadas.push({ tabela, metodo: String(prop), arg });
          return proxy;
        };
      },
    });
    return proxy;
  }
  return {
    from: (t: string) => cadeia(t),
    rpc: (nome: string, arg?: unknown) => {
      chamadas.push({ tabela: "rpc:" + nome, metodo: "rpc", arg });
      return { then: (resolve: (v: unknown) => unknown) => resolve({ data: dados["rpc:" + nome] ?? null, error: null }) };
    },
  };
}

type Msg = { conteudo: string; remetente: string; minutos: number };
const lead = (conteudo: string, minutos: number): Msg => ({ conteudo, remetente: "lead", minutos });
const bot = (conteudo: string, minutos: number): Msg => ({ conteudo, remetente: "agente", minutos });

function dados(metadata: Record<string, unknown>, anteriores: Msg[], atual: string, status = "ativa"): Record<string, unknown> {
  const agora = Date.now();
  const linhas = [...anteriores, lead(atual, 0)].map((m) => ({ conteudo: m.conteudo, remetente: m.remetente, created_at: new Date(agora - m.minutos * 60000 - 1000).toISOString() }));
  return {
    "rpc:get_openai_key": "chave-falsa",
    "rpc:buscar_chunks_similares": [],
    leads: { id: "lead-1", nome: "Fulano", opt_in: true, bloqueado: false },
    conversas: { id: "conv-1", status, metadata, lead_id: "lead-1" },
    mensagens: linhas.reverse(),
    prompts_agentes: { prompt_sistema: "sistema", prompt_contexto: "", temperatura: 0.7, max_tokens: 500, menu_boas_vindas: null },
    configuracoes: { valor: { empregabilidade: NUMERO_EMPREGA, acesso_cuca: null } },
    unidades_cuca: [],
    documentos_rag: null,
  };
}

type RespostaLeitura = Record<string, unknown> | "erro" | "timeout" | "json_invalido";
type Opcoes = { leitura?: RespostaLeitura; emprego?: Record<string, unknown>; chave?: string | null; respostaModelo?: string };
const NAO_EMPREGO = { fala_de_emprego: false, vaga_sem_tipo: false, outra_pergunta: null };
const SEM_UNIDADE = { unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false };

async function rodar(atual: string, d: Record<string, unknown>, opcoes: Opcoes = {}) {
  const chamadas: Chamada[] = [];
  const prompts: string[] = [];
  const leituras: string[] = [];
  const antigos: string[] = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const endereco = String(url instanceof Request ? url.url : url);
    const corpo = String(init?.body ?? "");
    const json = (conteudo: string) => Promise.resolve(respostaOpenAI(conteudo));
    if (endereco.includes("/embeddings")) return Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: [0, 0, 0] }] }), { status: 200 }));
    if (endereco.includes("/chat/completions")) {
      if (corpo.includes(MARCADOR_CLASSIFICADOR_EMPREGO)) return json(JSON.stringify(opcoes.emprego ?? NAO_EMPREGO));
      if (corpo.includes(MARCADOR_LEITURA_TURNO)) {
        leituras.push(corpo);
        const l = opcoes.leitura ?? { tipo: "pedido_novo", assunto: "institucional", escopo: "nao_disse" };
        if (l === "erro") return Promise.resolve(new Response("erro", { status: 500 }));
        if (l === "json_invalido") return json("{ quebrado");
        if (l === "timeout") return fetchQueNuncaResponde(url, init);
        return json(JSON.stringify(l));
      }
      if (corpo.includes("Unidades válidas (use o nome EXATO)")) { antigos.push("unidade"); return json(JSON.stringify(SEM_UNIDADE)); }
      if (corpo.includes("Você interpreta mensagens de leads")) { antigos.push("interpretador"); return json(JSON.stringify({ tipo: "nao_programacao", atividade: null, termos_busca: [], area: null, escopo: null, contexto: {} })); }
      prompts.push(corpo);
      return json(opcoes.respostaModelo ?? "Resposta do modelo.");
    }
    throw new Error("fetch não mockado: " + endereco);
  }) as typeof fetch;
  const logOriginal = console.log;
  const errOriginal = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    const config: Record<string, string> = opcoes.chave === null ? {} : { rota_estruturada: opcoes.chave ?? "on" };
    const req = new Request("http://localhost/motor-agente", {
      method: "POST",
      body: JSON.stringify({ mensagem: atual, telefone: "5585999999999", canal_origem: "test", agente_tipo: "Institucional", unidade_cuca: "Geral", conversa_id: "conv-1" }),
    });
    const resp = await handler(req, supabaseMock(d, config, chamadas));
    assertEquals(resp.status, 200);
    const corpo = await resp.json();
    await new Promise((r) => setTimeout(r, 20));
    return { corpo, chamadas, prompts, leituras, antigos };
  } finally {
    globalThis.fetch = fetchOriginal;
    console.log = logOriginal;
    console.error = errOriginal;
  }
}

const registrosRota = (chamadas: Chamada[]) => chamadas.filter((c) => c.tabela === "rag_retrieval_logs" && c.metodo === "insert").map((c) => c.arg as Record<string, unknown>);
const metadataGravada = (chamadas: Chamada[]) => chamadas.filter((c) => c.tabela === "rpc:merge_conversa_metadata").map((c) => (c.arg as { p_patch: Record<string, unknown> }).p_patch);

for (const falha of ["erro", "json_invalido", "timeout"] as const) {
  Deno.test("AC6 (handler): leitura com " + falha + " cai na rota antiga e registra rota_fallback = true", async () => {
    const { leituras, antigos, chamadas, prompts } = await rodar("quero saber dos documentos", dados({}, [], "quero saber dos documentos"), { leitura: falha });
    assertEquals(leituras.length, 1);
    assert(antigos.includes("unidade"), "a rota antiga (classificador de unidade) decidiu");
    assert(prompts.length === 1, "a resposta saiu pelo modelo, como antes");
    const reg = registrosRota(chamadas);
    assertEquals(reg.length, 1);
    assertEquals(reg[0].rota_fallback, true);
  });
}

Deno.test("AC5 (handler): chave desligada ou ausente → leitura nunca é chamada e rota_fallback fica null", async () => {
  for (const chave of ["off", null]) {
    const { leituras, antigos, chamadas } = await rodar("quero saber dos documentos", dados({}, [], "quero saber dos documentos"), { chave });
    assertEquals(leituras.length, 0);
    assert(antigos.includes("unidade"));
    assertEquals(registrosRota(chamadas)[0].rota_fallback, null);
  }
});

Deno.test("Handler: com a leitura, a rota antiga não roda (um classificador só) e o registro tem rota_fallback = false", async () => {
  const { leituras, antigos, chamadas, prompts, corpo } = await rodar("quais documentos para a matrícula?", dados({}, [], "quais documentos para a matrícula?"));
  assertEquals(leituras.length, 1);
  assertEquals(antigos, []);
  assertEquals(corpo.resposta, "Resposta do modelo.");
  assertStringIncludes(prompts[0], "INSTRUCAO CRITICA: esta pergunta e sobre a rede CUCA inteira"); // pergunta geral
  assertEquals(registrosRota(chamadas)[0].rota_fallback, false);
});

Deno.test("Handler: a leitura recebe a rajada e o histórico só até a última resposta do bot", async () => {
  const { leituras } = await rodar("Oi boa tarde", dados({}, [lead("Oi", 10), bot("Olá! Em que posso te ajudar? 😊", 9), lead("Queria natação na Barra", 0.1)], "Oi boa tarde"), { leitura: { tipo: "pedido_novo", assunto: "programacao", unidade_citada: "Cuca Barra", escopo: "Cuca Barra", atividade: "natação" } });
  assertStringIncludes(leituras[0], "Mensagem do lead (pode ter várias linhas, mandadas em sequência): Queria natação na Barra\\nOi boa tarde");
  assertStringIncludes(leituras[0], "Lead: Oi");
});

Deno.test("Handler: cortesia pela leitura → frase pronta, sem chamar o modelo de resposta", async () => {
  const { corpo, prompts, chamadas } = await rodar("ok", dados({ conversa_engajada: true }, [lead("tem judô?", 3), bot("Tem sim! ...", 2)], "ok"), { leitura: { tipo: "cortesia" } });
  assertEquals(corpo.resposta, "Em que mais posso te ajudar? 😊");
  assertEquals(prompts.length, 0);
  assertEquals(registrosRota(chamadas)[0].camada, "resposta_canned");
});

Deno.test("Handler: despedida pela leitura → encerra a conversa", async () => {
  const { corpo, chamadas } = await rodar("valeu, era só isso", dados({ conversa_engajada: true }, [lead("tem judô?", 3), bot("Tem sim!", 2)], "valeu, era só isso"), { leitura: { tipo: "despedida" } });
  assertEquals(corpo.encerrado, true);
  assert(chamadas.some((c) => c.tabela === "conversas" && c.metodo === "update" && (c.arg as Record<string, unknown>).status === "encerrada"));
});

Deno.test("Handler: pedido de humano pela leitura → transbordo", async () => {
  const { corpo, chamadas } = await rodar("posso conversar com alguém da coordenação de esportes?", dados({}, [], "posso conversar com alguém da coordenação de esportes?"), { leitura: { tipo: "pedido_humano" } });
  assertEquals(corpo.handover, true);
  assert(chamadas.some((c) => c.tabela === "conversas" && (c.arg as Record<string, unknown>)?.status === "awaiting_human"));
});

Deno.test("Handler: duas unidades → menu, e a pergunta fica pendente com a leitura", async () => {
  const { corpo, chamadas } = await rodar("tem natação na Barra e no Pici?", dados({}, [], "tem natação na Barra e no Pici?"), { leitura: { tipo: "pedido_novo", assunto: "programacao", unidade_citada: "varias", atividade: "natação" } });
  assertStringIncludes(corpo.resposta, MENU_UNIDADES);
  const patch = metadataGravada(chamadas).at(-1)!;
  assertEquals(patch.aguardando_unidade, true);
  assertEquals((patch.prog_pendente as Record<string, unknown>).texto, "tem natação na Barra e no Pici?");
  assert((patch.prog_pendente as Record<string, unknown>).leitura);
});

Deno.test("Handler: >2h com unidade salva + pedido novo → confirma o escopo; '2' mostra o menu; '1' segue na unidade", async () => {
  const antigo = 3 * 60; // 3h
  const { corpo, chamadas } = await rodar("tem natação?", dados({ unidade_selecionada: "Cuca Pici", conversa_engajada: true }, [lead("tem judô?", antigo + 2), bot("No Cuca Pici tem judô...", antigo + 1)], "tem natação?"), { leitura: { tipo: "pedido_novo", assunto: "programacao", atividade: "natação", termos_busca: ["natacao"] } });
  assertEquals(corpo.resposta, montarPerguntaConfirmarEscopo("Cuca Pici"));
  const pendente = metadataGravada(chamadas).at(-1)!.prog_pendente as Record<string, unknown>;
  assertEquals(pendente.confirmar_escopo, "Cuca Pici");

  const metadataComPendente = { conversa_engajada: true, prog_pendente: pendente };
  const r2 = await rodar("2", dados(metadataComPendente, [lead("tem natação?", 2), bot(corpo.resposta, 1)], "2"));
  assertEquals(r2.corpo.resposta, MENU_UNIDADES);
  assertEquals(r2.leituras.length, 0);
  assertEquals(metadataGravada(r2.chamadas).at(-1)!.aguardando_unidade, true);

  const r1 = await rodar("1", dados(metadataComPendente, [lead("tem natação?", 2), bot(corpo.resposta, 1)], "1"));
  assertEquals(r1.leituras.length, 0);
  assertEquals(metadataGravada(r1.chamadas).some((p) => p.unidade_selecionada === "Cuca Pici"), true);
  assertStringIncludes(r1.prompts[0], "PERGUNTA DO LEAD QUE VOCE ESTA RESPONDENDO AGORA (ele acabou de escolher onde quer saber): tem natação?");
  assert(MARCA_CONFIRMAR_ESCOPO.length > 0);
});

Deno.test("Handler: confirmação de escopo — 'o mesmo' traz de volta a unidade e o contexto de antes; 'não' abre sem eles", async () => {
  const antigo = 3 * 60; // 3h: a S-WM-71 zera unidade e contexto
  const anteriores = [lead("tenho 16 anos, tem judô?", antigo + 2), bot("No Cuca Pici tem judô...", antigo + 1)];
  const { corpo, chamadas } = await rodar("tem natação?", dados({ unidade_selecionada: "Cuca Pici", prog_contexto: { idade: 16 }, conversa_engajada: true }, anteriores, "tem natação?"), { leitura: { tipo: "pedido_novo", assunto: "programacao", atividade: "natação", termos_busca: ["natacao"] } });
  assertEquals(corpo.resposta, montarPerguntaConfirmarEscopo("Cuca Pici"));
  const gravado = metadataGravada(chamadas).at(-1)!;
  const pendente = gravado.prog_pendente as Record<string, unknown>;
  // enquanto a pessoa não responde, o contexto de antes fica guardado à parte, sem valer
  assertEquals(pendente.contexto_anterior, { idade: 16 });
  assertEquals(gravado.prog_contexto, {});
  const conversaDepois = (texto: string) => dados({ conversa_engajada: true, prog_pendente: pendente, prog_contexto: {} }, [lead("tem natação?", 2), bot(corpo.resposta, 1)], texto);

  // "mesmo Cuca Pici" → Pici + idade 16 de volta, sem nova leitura
  const mesmo = await rodar("mesmo Cuca Pici", conversaDepois("mesmo Cuca Pici"));
  assertEquals(mesmo.leituras.length, 0);
  const pMesmo = metadataGravada(mesmo.chamadas);
  assert(pMesmo.some((p) => p.unidade_selecionada === "Cuca Pici"));
  assertEquals(pMesmo.at(-1)!.prog_contexto, { idade: 16 });
  assertStringIncludes(mesmo.prompts[0], "tem natação?");

  // "não" → menu de unidades; sai a unidade e o contexto de antes; a pergunta continua pendente
  const nao = await rodar("não", conversaDepois("não"));
  assertEquals(nao.corpo.resposta, MENU_UNIDADES);
  const pNao = metadataGravada(nao.chamadas).at(-1)!;
  assertEquals(pNao.unidade_selecionada, null);
  assertEquals(pNao.prog_contexto, {});
  assertEquals((pNao.prog_pendente as Record<string, unknown>).texto, "tem natação?");
  assertEquals((pNao.prog_pendente as Record<string, unknown>).confirmar_escopo, undefined);
  assertEquals((pNao.prog_pendente as Record<string, unknown>).contexto_anterior, undefined);

  // "não, do Barra" → direto no Barra, sem o contexto de antes
  const barra = await rodar("não, do Barra", conversaDepois("não, do Barra"));
  const pBarra = metadataGravada(barra.chamadas);
  assert(pBarra.some((p) => p.unidade_selecionada === "Cuca Barra"));
  assertEquals(pBarra.at(-1)!.prog_contexto, {});

  // "não, obrigado" → não é resposta: a pendência cai e a mensagem segue como mensagem nova
  const obrigado = await rodar("não, obrigado", conversaDepois("não, obrigado"), { leitura: { tipo: "cortesia", assunto: "institucional" } });
  assertEquals(obrigado.leituras.length, 1);
  assert(metadataGravada(obrigado.chamadas).some((p) => p.prog_pendente === null));
});

Deno.test("Handler: conversa encerrada e reaberta (sem o corte de 2h) — mesma bifurcação; sem resposta, a unidade de antes sai", async () => {
  // A unidade e o contexto continuam no metadata (não houve corte de sessão); a despedida encerrou a conversa.
  const anteriores = [lead("tenho 16 anos, tem judô?", 12), bot("No Cuca Pici tem judô...", 11), lead("obrigado, tchau", 10), bot("Que bom poder ajudar! 😊 Se precisar de mais alguma coisa, é só chamar por aqui. Até logo! 👋", 9)];
  const meta = { unidade_selecionada: "Cuca Pici", prog_contexto: { idade: 16 }, conversa_engajada: true };
  const { corpo, chamadas } = await rodar("tem natação?", dados(meta, anteriores, "tem natação?", "encerrada"), { leitura: { tipo: "pedido_novo", assunto: "programacao", atividade: "natação", termos_busca: ["natacao"] } });
  assertEquals(corpo.resposta, montarPerguntaConfirmarEscopo("Cuca Pici"));
  const gravado = metadataGravada(chamadas).at(-1)!;
  const pendente = gravado.prog_pendente as Record<string, unknown>;
  assertEquals(pendente.contexto_anterior, { idade: 16 });
  assertEquals(gravado.prog_contexto, {});
  const depois = (texto: string) => dados({ ...meta, prog_contexto: {}, prog_pendente: pendente }, [...anteriores, lead("tem natação?", 2), bot(corpo.resposta, 1)], texto);

  const sim = await rodar("sim", depois("sim"));
  assertEquals(sim.leituras.length, 0);
  assertEquals(metadataGravada(sim.chamadas).at(-1)!.prog_contexto, { idade: 16 });
  assert(metadataGravada(sim.chamadas).some((p) => p.unidade_selecionada === "Cuca Pici"));

  const nao = await rodar("não", depois("não"));
  assertEquals(nao.corpo.resposta, MENU_UNIDADES);
  assertEquals(metadataGravada(nao.chamadas).at(-1)!.unidade_selecionada, null);
  assertEquals(metadataGravada(nao.chamadas).at(-1)!.prog_contexto, {});

  const pici = await rodar("não, do Barra", depois("não, do Barra"));
  assert(metadataGravada(pici.chamadas).some((p) => p.unidade_selecionada === "Cuca Barra"));
  assertEquals(metadataGravada(pici.chamadas).at(-1)!.prog_contexto, {});

  const outra = await rodar("qual o endereço?", depois("qual o endereço?"), { leitura: { tipo: "pedido_novo", assunto: "institucional" } });
  assertEquals(outra.leituras.length, 1);
  const pOutra = metadataGravada(outra.chamadas);
  assert(pOutra.some((p) => p.prog_pendente === null && p.unidade_selecionada === null), "unidade de antes saiu");
});

Deno.test("Handler: 'vagas' depois de natação — o Emprega+ não responde 'emprego ou curso'; a leitura decide", async () => {
  // Sem unidade salva e sem palavra de programação na última resposta: a regra fixa da 01 não vê o
  // contexto e perguntaria "emprego ou curso?".
  const historico = [lead("tem natação?", 3), bot("Tem sim! 😊", 2)];
  const { corpo, leituras } = await rodar("ainda tem vagas?", dados({ conversa_engajada: true }, historico, "ainda tem vagas?"), {
    emprego: { fala_de_emprego: false, vaga_sem_tipo: true, outra_pergunta: null },
    leitura: { tipo: "continuacao", assunto: "programacao", atividade: "natação", termos_busca: ["natacao"] },
  });
  assertEquals(leituras.length, 1);
  assert(corpo.resposta !== PERGUNTA_VAGA_AMBIGUA, "não perguntou emprego ou curso");
  // a leitura falhando, vale o de antes
  const falhou = await rodar("ainda tem vagas?", dados({ conversa_engajada: true }, historico, "ainda tem vagas?"), {
    emprego: { fala_de_emprego: false, vaga_sem_tipo: true, outra_pergunta: null },
    leitura: "erro",
  });
  assertEquals(falhou.corpo.resposta, PERGUNTA_VAGA_AMBIGUA);
});

Deno.test("Handler: encaminhamento pela leitura sai montado pelo código", async () => {
  const { corpo } = await rodar("quero mandar meu currículo", dados({}, [], "quero mandar meu currículo"), { leitura: { tipo: "outro_canal", canal: "empregabilidade" } });
  assertEquals(corpo.resposta, montarMensagemEncaminhamento("empregabilidade", NUMERO_EMPREGA));
});

Deno.test("Handler: número que responde a uma lista do bot continua resolvido pelo código, sem leitura", async () => {
  const { leituras } = await rodar("4", dados({ aguardando_unidade: true }, [lead("quais cursos?", 2), bot(MENU_UNIDADES, 1)], "4"));
  assertEquals(leituras.length, 0);
});

// ── Replay real de 7 dias (14/11): transbordo só com apoio no texto; continuação sem atividade ──
Deno.test("Replay 7d: pedido_humano do modelo sem apoio no texto não transborda", () => {
  for (const texto of ["Quero sim", "No cuca barra?", "Ronaldo Salviano", "Poderia por favor me tirar essa dúvida?"]) {
    const l = consolidarLeitura(leitura({ tipo: "pedido_humano", assunto: null }), texto);
    assertEquals(l.tipo, "pedido_novo", texto);
    assertEquals(l.assunto, "institucional", texto);
    assert(decidirRota(l, estado({})).acao !== "handover", texto);
  }
  const explicito = consolidarLeitura(leitura({ tipo: "pedido_humano", assunto: null }), "quero falar com a gerente");
  assertEquals(decidirRota(explicito, estado({})).acao, "handover");
  const naRajada = consolidarLeitura(leitura({ tipo: "pedido_humano", assunto: null }), "oi\nquero falar com um atendente", ["oi", "quero falar com um atendente"]);
  assertEquals(naRajada.tipo, "pedido_humano");
});

Deno.test("Replay 7d: continuação sem atividade com unidade salva segue o pedido, sem resumo geral", () => {
  const l = leitura({ tipo: "continuacao", assunto: "programacao" });
  assertEquals(decidirRota(l, estado({ unidadeSalva: "Cuca Mondubim" })), { acao: "unidade", unidade: "Cuca Mondubim", pedido: true, troca: false });
  // pedido novo sem atividade nem área continua no resumo da unidade (como antes)
  assertEquals(decidirRota(leitura({ tipo: "pedido_novo", assunto: "programacao" }), estado({ unidadeSalva: "Cuca Mondubim" })), { acao: "unidade", unidade: "Cuca Mondubim", pedido: false, troca: true });
});

Deno.test("Handler: pedido_humano da leitura sem apoio no texto não põe a conversa em awaiting_human", async () => {
  const { corpo, chamadas } = await rodar("Quero sim", dados({}, [], "Quero sim"), { leitura: { tipo: "pedido_humano" } });
  assert(corpo.handover !== true);
  assert(!chamadas.some((c) => c.tabela === "conversas" && (c.arg as Record<string, unknown>)?.status === "awaiting_human"));
});

// ── Decisões do Junior (14/11, depois da revisão do @qa): atendente e assunto novo ────────────────
const TELEFONES = [
  { nome: "CUCA Barra", telefone: "(85) 3452-0001" },
  { nome: "CUCA Pici", telefone: "(85) 3452-0004" },
];

Deno.test("Horário do atendente (o mesmo do Emprega+): seg a sex, 08:00 às 16:59, -03:00", () => {
  const em = (iso: string) => dentroHorarioAtendimentoHumano(new Date(iso));
  assertEquals(em("2026-11-11T15:00:00-03:00"), true); // quarta
  assertEquals(em("2026-11-11T08:00:00-03:00"), true);
  assertEquals(em("2026-11-11T07:59:00-03:00"), false);
  assertEquals(em("2026-11-11T16:59:00-03:00"), true);
  assertEquals(em("2026-11-11T17:00:00-03:00"), false);
  assertEquals(em("2026-11-14T12:17:00-03:00"), false); // sábado (DUDA)
  assertEquals(em("2026-11-15T10:00:00-03:00"), false); // domingo
  assertEquals(em("2026-11-14T02:41:00Z"), false); // sexta 23:41 em Fortaleza (kamys), já sábado em UTC
  assertEquals(em("2026-11-13T22:28:00Z"), false); // sexta 19:28 em Fortaleza (§🐇)
});

Deno.test("Pedido explícito de atendente: humano, atendente e alguém dentro da frase; emprego e perguntas comuns não", () => {
  for (const t of ["Tem humanos aí?", "cadê os humanos?", "não tem humano aí?", "Quero falar com alguém!", "Tem alguém aí para me ajudar?", "Atendente", "cadê o atendente?", "tem algum humano ai?", "Não tem ninguém pra me responder?", "quero falar com a gerente"]) {
    assert(deveAcionarHandoverInstitucional(t, "Institucional"), t);
  }
  for (const t of ["tem vaga de atendente?", "quero ser atendente", "Quero sim", "Teria gastronomia?", "alguém sabe se tem natação?", "posso levar alguém comigo?", "tem curso de recursos humanos?", "tem curso de direitos humanos?", "Conseguiu me conectar?", "não quero atendente, só a informação"]) {
    assert(!deveAcionarHandoverInstitucional(t, "Institucional"), t);
  }
});

Deno.test("Sem informação: a oferta de atendente sai e o contato da unidade entra (conversas reais de 13 e 14/11)", () => {
  // kamys: começou certo, mas ofereceu atendente
  const kamys = respostaSemAtendente("Não encontrei a atividade de gastronomia na programação deste mês no CUCA Barra. Para mais informações, recomendo falar com a unidade. Posso te conectar com um atendente para te ajudar! 😊", TELEFONES, "Cuca Barra");
  assertStringIncludes(kamys, "Não encontrei a atividade de gastronomia");
  assertStringIncludes(kamys, "📞 Cuca Barra: (85) 3452-0001");
  assert(!/atendente/i.test(kamys));
  assert(!kamys.includes("Cuca Pici"), "com a unidade definida, só o telefone dela");
  // §🐇: a frase inteira era a oferta → sobra "não encontrei" + todas as unidades (sem unidade definida)
  const coelho = respostaSemAtendente("Não tenho certeza se a unidade estará funcionando aos sábados, mas posso te conectar com um atendente que pode te ajudar com essa informação! 😊", TELEFONES, null);
  assertStringIncludes(coelho, FRASE_SEM_INFORMACAO);
  assertStringIncludes(coelho, "📞 Cuca Barra");
  assertStringIncludes(coelho, "📞 Cuca Pici");
  // Nathyxz: "quiser falar com um atendente"
  assertEquals(removerOfertaDeAtendente("Desculpe, não encontrei mais atividades na programação deste mês do Cuca Mondubim. Se precisar de mais informações ou quiser falar com um atendente, posso te ajudar com isso! 😊").texto, "Desculpe, não encontrei mais atividades na programação deste mês do Cuca Mondubim.");
  // telefone já no texto: não repete
  assertEquals(respostaSemAtendente("Não encontrei isso. Ligue para o Cuca Barra: (85) 3452-0001.", TELEFONES, "Cuca Barra"), "Não encontrei isso. Ligue para o Cuca Barra: (85) 3452-0001.");
  // texto sem oferta fica igual
  assertEquals(removerOfertaDeAtendente("Tem natação no Cuca Barra, terças e quintas.").removida, false);
  assertEquals(montarContatoUnidades([], null), "Para mais informações, procure a unidade CUCA mais perto de você.");
  // achado médio do @qa (15/11): orientação para procurar a unidade, com telefone, não é oferta
  const orientacao = "Para se matricular, entre em contato com a atendente da unidade pelo (85) 99796-0256.";
  assertEquals(removerOfertaDeAtendente(orientacao), { texto: orientacao, removida: false });
  assertEquals(removerOfertaDeAtendente("Recomendo falar com a atendente da unidade.").removida, false);
  // pontuação no começo da linha não some
  assertEquals(removerOfertaDeAtendente("...e aí, tudo bem? Posso te conectar com um atendente.").texto, "...e aí, tudo bem?");
  assertEquals(removerOfertaDeAtendente("Já te encaminho.").removida, true);
  assertEquals(removerOfertaDeAtendente("Posso chamar alguém da equipe pra te ajudar!").removida, true);
});

Deno.test("Handler: pedido explícito de atendente fora do horário → mensagem de horário, sem awaiting_human", async () => {
  definirRelogioAtendimento(() => new Date("2026-11-14T12:17:00-03:00")); // sábado
  try {
    for (const chave of ["on", null] as const) {
      const { corpo, chamadas } = await rodar("não tem humano aí?", dados({}, [], "não tem humano aí?"), { chave });
      assertEquals(corpo.handover, false);
      assertEquals(corpo.resposta, MENSAGEM_FORA_HORARIO_ATENDENTE);
      assert(!chamadas.some((c) => c.tabela === "conversas" && (c.arg as Record<string, unknown>)?.status === "awaiting_human"));
      assertEquals(registrosRota(chamadas).at(-1)?.camada, "handover_fora_horario");
    }
  } finally {
    definirRelogioAtendimento(QUARTA_15H);
  }
  const dentro = await rodar("não tem humano aí?", dados({}, [], "não tem humano aí?"));
  assertEquals(dentro.corpo.handover, true);
});

Deno.test("Handler: [[HANDOVER]] do modelo sem pedido explícito não transborda — com a chave on e off", async () => {
  for (const chave of ["on", null] as const) {
    const d = { ...dados({ unidade_selecionada: "Cuca Barra" }, [lead("tem curso no cuca barra?", 3), bot("Temos balé e teatro.", 2)], "teria gastronomia?"), unidades_cuca: TELEFONES };
    const { corpo, chamadas } = await rodar("teria gastronomia?", d, {
      chave,
      leitura: { tipo: "pedido_novo", assunto: "programacao", atividade: "gastronomia", termos_busca: ["gastronomia"], escopo: "nao_disse" },
      respostaModelo: "Não encontrei gastronomia no CUCA Barra. Posso te conectar com um atendente! [[HANDOVER]]",
    });
    assertEquals(corpo.handover, false, "chave " + chave);
    assert(!/atendente|\[\[/i.test(corpo.resposta), corpo.resposta);
    assert(!chamadas.some((c) => c.tabela === "conversas" && (c.arg as Record<string, unknown>)?.status === "awaiting_human"));
  }
});

Deno.test("Assunto novo na mesma sessão: futsal no Cuca Barra e agora natação → pergunta Barra, outra unidade ou rede", () => {
  const natacao = leitura({ tipo: "pedido_novo", assunto: "programacao", atividade: "natação", termos_busca: ["natacao"] });
  const conversaFutsal = [{ role: "user", content: "tem futsal no cuca barra?" }, { role: "assistant", content: "Tem sim! Futsal no Cuca Barra, terças e quintas." }];
  assertEquals(atividadeNovaNaConversa(natacao, conversaFutsal), true);
  assertEquals(decidirRota(natacao, estado({ unidadeSalva: "Cuca Barra", atividadeNovaNaConversa: true })), { acao: "confirmar_escopo", unidade: "Cuca Barra", sobre: "natação" });
  assertStringIncludes(montarPerguntaConfirmarEscopo("Cuca Barra", "natação"), "Sobre natação: você quer saber do Cuca Barra, " + MARCA_CONFIRMAR_ESCOPO);
  // escolheu da lista que o bot acabou de mostrar, ou já falou dela → não é assunto novo
  assertEquals(atividadeNovaNaConversa(natacao, [{ role: "user", content: "quais esportes tem?" }, { role: "assistant", content: "No Cuca Barra: Futsal, Natação e Vôlei." }]), false);
  assertEquals(atividadeNovaNaConversa(natacao, [{ role: "user", content: "e natação, tem?" }, { role: "assistant", content: "Tem sim, terças." }]), false);
  assertEquals(atividadeNovaNaConversa(natacao, []), false);
  // sem assunto novo, ou com a unidade na mensagem, ou continuação: segue direto
  assertEquals(decidirRota(natacao, estado({ unidadeSalva: "Cuca Barra" })).acao, "programacao");
  assertEquals(decidirRota({ ...natacao, escopo: "Cuca Pici", unidade_citada: "Cuca Pici" }, estado({ unidadeSalva: "Cuca Barra", atividadeNovaNaConversa: true })).acao, "programacao");
  assertEquals(decidirRota({ ...natacao, tipo: "continuacao" }, estado({ unidadeSalva: "Cuca Barra", atividadeNovaNaConversa: true })).acao, "programacao");
  // replay real: pergunta institucional ou sem atividade não pergunta
  const inscricao = leitura({ tipo: "pedido_novo", assunto: "institucional", termos_busca: ["inscrever"] });
  assert(decidirRota(inscricao, estado({ unidadeSalva: "Cuca Barra", atividadeNovaNaConversa: true })).acao !== "confirmar_escopo");
  const semAtividade = leitura({ tipo: "pedido_novo", assunto: "programacao", termos_busca: ["atividade", "criancas"], idade: 8 });
  assert(decidirRota(semAtividade, estado({ unidadeSalva: "Cuca Barra", atividadeNovaNaConversa: true })).acao !== "confirmar_escopo");
});

Deno.test("Handler: natação numa conversa de futsal no Cuca Barra → pergunta; '1' segue no Cuca Barra", async () => {
  const anteriores = [lead("tem futsal no cuca barra?", 4), bot("Tem sim! Futsal no Cuca Barra, terças e quintas.", 3)];
  const natacao = { tipo: "pedido_novo", assunto: "programacao", atividade: "natação", termos_busca: ["natacao"], area: "ESPORTES", escopo: "nao_disse" };
  const p1 = await rodar("e natação, tem?", dados({ unidade_selecionada: "Cuca Barra", conversa_engajada: true }, anteriores, "e natação, tem?"), { leitura: natacao });
  assertStringIncludes(p1.corpo.resposta, "Sobre natação: você quer saber do Cuca Barra");
  const pendente = metadataGravada(p1.chamadas).at(-1)!.prog_pendente as Record<string, unknown>;
  assertEquals(pendente.confirmar_escopo, "Cuca Barra");
  const p2 = await rodar("1", dados({ unidade_selecionada: "Cuca Barra", conversa_engajada: true, prog_pendente: pendente }, [...anteriores, lead("e natação, tem?", 2), bot(p1.corpo.resposta, 1)], "1"), { leitura: natacao });
  assert(!p2.corpo.resposta.includes(MARCA_CONFIRMAR_ESCOPO), "não pergunta de novo");
  assertEquals(p2.leituras.length, 0, "a resposta à pergunta é resolvida pelo código");
});
