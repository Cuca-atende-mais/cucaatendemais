// S-INST-QUAL-14 — programação por dia e turno, o assunto inteiro.
// Itens no formato real da programação de novembro de 2026. Nenhum teste chama a OpenAI nem o banco:
// o handler roda com fetch e supabase falsos e com a data simulada (sem depender do dia real).
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  dataRelativaDaMensagem,
  datasDoItem,
  decidirRota,
  descreverDias,
  diasDaMensagem,
  ESCOLHA_REDE,
  type EstadoRota,
  extrairItensProgramacao,
  filtrarItensPorContexto,
  filtroHerdadoDoContexto,
  handler,
  itemAconteceNaData,
  itemVencido,
  type ItemProgramacao,
  itensVigentes,
  type LeituraTurno,
  LIMPEZA_ESTADO_SESSAO,
  lerMensagemAtual,
  marcaDaResposta,
  MARCADOR_CLASSIFICADOR_EMPREGO,
  MARCADOR_LEITURA_TURNO,
  mesclarContextoDaConversa,
  montarConsultaComContexto,
  pedidoDeTirarFiltro,
  semDataVencida,
  semTrechosVencidos,
  temFiltroDeDiaOuTurno,
  unidadeDaListaDaConsulta,
} from "./index.ts";
import { comDataSimulada } from "./eval/lib/data_simulada.ts";

// ── Programação de teste (formato de novembro) ──────────────────────────────────────────────
const CABECALHO_JW = "PROGRAMAÇÃO MENSAL DE NOVEMBRO DE 2026 — Cuca José Walter\nEsta programação vale para o mês de novembro de 2026.\n";
const ITENS_JW = {
  canto: "• A voz como extenção do corpo - Técnica vocal(canto)\n  Detalhes: Curso: A voz como extenção do corpo - Técnica vocal(canto). Educador: Fabricio Maciel. Carga Horária: 16h. Período: 03/11/2026 a 26/11/2026 (Ter e Qui). Horário: 15:00 às 17:00. Requisitos: 15 a 29 anos.\n  Horário: 15:00:00 às 17:00:00",
  fotografia: "• INTRODUÇÃO À FOTOGRAFIA PROFISSIONAL\n  Detalhes: Curso: INTRODUÇÃO À FOTOGRAFIA PROFISSIONAL. Educador: Lia. Carga Horária: 4h. Período: 06/11/2026 a 06/11/2026 (Qua e Sex). Horário: 09:00 às 13:00. Requisitos: 15 a 29 anos.",
  natacao: "• NATAÇÃO\n  Detalhes: Esporte Modalidade: Natação - Turma TURMA 1. Público: Misto (Idade: 15 a 29 anos). Dias: Ter e Qui. Horário: 07:00 às 08:00.",
  judo: "• JUDÔ\n  Detalhes: Esporte Modalidade: Judô - Turma TURMA 2. Público: Misto (Idade: 15 a 29 anos). Dias: Qua e Sex. Horário: 19:00 às 20:00.",
  venhaJogar: "• VENHA JOGAR\n  Detalhes: Programa (DIA A DIA): VENHA JOGAR. Atividade: VENHA JOGAR. Data: 07/11 a 28/11 (Sábado). Horário: 08:00 às 17:00. Local: BIBLIOTECA. Informações: Jogos de tabuleiro.",
  capoeira: "• COMUNIDADE EM PAUTA\n  Detalhes: Programa (DIA A DIA): COMUNIDADE EM PAUTA. Atividade: Aulão de Capoeira. Data: 28/11 (Sábado). Horário: 09:00 às 11:00. Local: QUADRA. Informações: Aulão aberto.",
  piscina: "• COMUNIDADE EM PAUTA\n  Detalhes: Programa (DIA A DIA): COMUNIDADE EM PAUTA. Atividade: Piscina Recreativa. Data: 12/11 (Quinta-feira). Horário: 09:00 às 11:00. Local: PISCINA. Informações: Lazer.",
  cine20: "• COMUNIDADE EM PAUTA\n  Detalhes: Programa (DIA A DIA): COMUNIDADE EM PAUTA. Atividade: Cine Juventude. Data: 20/11 (Sexta-feira). Horário: 14:00 às 16:00. Local: CINECLUBE. Informações: Sessão de cinema.",
  cine27: "• COMUNIDADE EM PAUTA\n  Detalhes: Programa (DIA A DIA): COMUNIDADE EM PAUTA. Atividade: Batalha de Rima. Data: 27/11 (Sexta-feira). Horário: 18:00 às 21:00. Local: MIRANTE. Informações: Rima.",
};
const PROGRAMACAO: Record<string, string> = {
  "Cuca José Walter": CABECALHO_JW + "\n== CURSOS ==\n" + ITENS_JW.canto + "\n" + ITENS_JW.fotografia + "\n\n== ESPORTES ==\n" + ITENS_JW.natacao + "\n" + ITENS_JW.judo +
    "\n\n== DIA A DIA ==\n" + [ITENS_JW.venhaJogar, ITENS_JW.capoeira, ITENS_JW.piscina, ITENS_JW.cine20, ITENS_JW.cine27].join("\n") + "\n",
  "Cuca Mondubim": `PROGRAMAÇÃO MENSAL DE NOVEMBRO DE 2026 — Cuca Mondubim

== CURSOS ==
• Curso dBásico e Libras III
  Detalhes: Curso: Curso dBásico e Libras III. Educador: Ana. Carga Horária: 16h. Período: 07/11/2026 a 28/11/2026 (Sáb). Horário: 08:00 às 12:00. Requisitos: 15 a 29 anos.
• Violão
  Detalhes: Curso: Violão. Educador: Beto. Carga Horária: 16h. Período: 03/11/2026 a 26/11/2026 (Qua e Sex). Horário: 18:00 às 20:00. Requisitos: 15 a 29 anos.
`,
  "Cuca Pici": `PROGRAMAÇÃO MENSAL DE NOVEMBRO DE 2026 — Cuca Pici

== CURSOS ==
• Tech Start: Automatize, Inove e Lucre com Python & Inteligência Artificial
  Detalhes: Curso: Tech Start: Automatize, Inove e Lucre com Python & Inteligência Artificial. Educador: Alexandre Lins. Carga Horária: 24h. Período: 07/11/2026 a 12/12/2026 (Sáb). Horário: 08:00 às 12:00. Requisitos: 15 a 29 anos.
`,
  "Cuca Barra": `PROGRAMAÇÃO MENSAL DE NOVEMBRO DE 2026 — Cuca Barra

== ESPORTES ==
• NATAÇÃO INFANTIL
  Detalhes: Esporte Modalidade: Natação Infantil - Turma TURMA 3. Público: Misto (Idade: 08 a 14 anos). Dias: Sáb. Horário: 08:00 às 09:00.
`,
};
const ITENS: ItemProgramacao[] = Object.entries(PROGRAMACAO).flatMap(([u, c]) => extrairItensProgramacao(u, c));
const titulos = (itens: ItemProgramacao[]) => itens.map((it) => it.unidade + " / " + it.titulo + (it.detalhe.includes("Atividade: ") ? " / " + it.detalhe.match(/Atividade: ([^.]*)/)![1] : ""));
const SEGUNDA_16_11 = Date.parse("2026-11-16T15:00:00-03:00");
const SEXTA_20_11 = Date.parse("2026-11-20T15:00:00-03:00");

// ── Datas dos itens (decisão a) ─────────────────────────────────────────────────────────────
Deno.test("AC7: datas dos campos Período e Data, com e sem ano; item vencido só com a data inteira passada", () => {
  const hoje = "2026-11-16";
  assertEquals(datasDoItem("Período: 03/11/2026 a 26/11/2026 (Ter e Qui). Horário: 15:00", hoje), ["2026-11-03", "2026-11-26"]);
  assertEquals(datasDoItem("Data: 07/11 a 28/11 (Sábado). Horário: 08:00", hoje), ["2026-11-07", "2026-11-28"]);
  assertEquals(datasDoItem("Dias: Ter e Qui. Horário: 07:00 às 08:00.", hoje), []);
  // data em "Informações" não conta
  assertEquals(datasDoItem("Dias: Sáb. Informações: inscrições até 10/11.", hoje), []);
  assert(itemVencido("Período: 06/11/2026 a 06/11/2026 (Qua e Sex).", hoje), "curso que acabou em 06/11");
  assert(itemVencido("Data: 12/11 (Quinta-feira).", hoje), "evento de 12/11");
  assert(!itemVencido("Data: 07/11 a 28/11 (Sábado).", hoje), "intervalo em andamento fica");
  assert(!itemVencido("Data: 16/11 (Segunda-feira).", hoje), "evento de hoje fica");
  assert(!itemVencido("Dias: Ter e Qui.", hoje), "item sem data fica");
});

Deno.test("AC7 (virada do ano): 'Data: 02/01' visto em 20/12 fica; 'Data: 20/12' visto em 05/01 sai", () => {
  assertEquals(datasDoItem("Data: 02/01 (Sábado).", "2026-12-20"), ["2027-01-02"]);
  assert(!itemVencido("Data: 02/01 (Sábado).", "2026-12-20"));
  assertEquals(datasDoItem("Data: 20/12 (Domingo).", "2027-01-05"), ["2026-12-20"]);
  assert(itemVencido("Data: 20/12 (Domingo).", "2027-01-05"));
});

Deno.test("AC7: itens vigentes em 16/11 — saem a fotografia (06/11) e a piscina (12/11); o resto fica", () => {
  const fora = ITENS.filter((it) => !itensVigentes(ITENS, "2026-11-16").includes(it));
  assertEquals(titulos(fora), ["Cuca José Walter / INTRODUÇÃO À FOTOGRAFIA PROFISSIONAL", "Cuca José Walter / COMUNIDADE EM PAUTA / Piscina Recreativa"]);
  // trecho do texto inteiro (um item por trecho, como no banco)
  const trechos = Object.values(ITENS_JW).map((i) => ({ conteudo: CABECALHO_JW + i }));
  assertEquals(semTrechosVencidos(trechos, "2026-11-16").length, trechos.length - 2);
  assertEquals(semTrechosVencidos(null, "2026-11-16"), []);
});

// ── Leitura do dia (AC5) ────────────────────────────────────────────────────────────────────
Deno.test("AC5: frases novas de dia; hoje/amanhã pela data de Fortaleza; falsos positivos continuam sem dia", () => {
  const sexta = new Date(SEXTA_20_11);
  const dias = (t: string) => descreverDias(diasDaMensagem(t, sexta));
  assertEquals(dias("o que tem hoje?"), "sexta");
  assertEquals(dias("tem algo amanhã?"), "sábado");
  assertEquals(dias("hoje à noite tem o quê?"), "sexta");
  assertEquals(dias("o que tem durante a semana?"), "segunda, terça, quarta, quinta e sexta");
  assertEquals(dias("dias de semana"), "segunda, terça, quarta, quinta e sexta");
  assertEquals(dias("tem curso dia útil?"), "segunda, terça, quarta, quinta e sexta");
  assertEquals(dias("tem aula no sabadão?"), "sábado");
  assertEquals(dias("tem aula 3ª feira?"), "terça");
  assertEquals(dias("tem aula na 3ª?"), "terça");
  assertEquals(dias("2a feira tem?"), "segunda");
  assertEquals(dias("tem natação segunda?"), "segunda");
  assertEquals(dias("quarta à tarde"), "quarta");
  for (const negativo of ["quero a segunda", "a segunda?", "na quinta série", "de segunda mão", "queria saber hoje sobre natação", "até amanhã!", "hoje em dia tem natação?", "minha filha está na 5ª série", "a segunda opção", "quinta série"]) {
    assertEquals(dias(negativo), "", negativo);
  }
  assertEquals(lerMensagemAtual("o que tem hoje?", sexta).contexto, { dia: "sexta", data: "2026-11-20" });
  assertEquals(lerMensagemAtual("quarta à tarde", sexta).contexto, { turno: "tarde", dia: "quarta" });
});

Deno.test("AC5: 'hoje' depois das 21h em Fortaleza continua sendo o dia de Fortaleza (o UTC já virou)", () => {
  const sexta2230 = new Date("2026-11-20T22:30:00-03:00"); // 01:30 UTC do sábado
  assertEquals(dataRelativaDaMensagem("o que tem hoje?", sexta2230), "2026-11-20");
  assertEquals(descreverDias(diasDaMensagem("o que tem hoje?", sexta2230)), "sexta");
  assertEquals(dataRelativaDaMensagem("e amanhã?", sexta2230), "2026-11-21");
});

// ── Hoje com data marcada (AC6) ─────────────────────────────────────────────────────────────
Deno.test("AC6: 'hoje' (sexta 20/11) traz o evento de 20/11 e não o de 27/11; intervalo vale dentro dele", () => {
  assertEquals(itemAconteceNaData("Data: 20/11 (Sexta-feira).", "2026-11-20"), true);
  assertEquals(itemAconteceNaData("Data: 27/11 (Sexta-feira).", "2026-11-20"), false);
  assertEquals(itemAconteceNaData("Data: 07/11 a 28/11 (Sábado).", "2026-11-21"), true);
  assertEquals(itemAconteceNaData("Dias: Qua e Sex.", "2026-11-20"), null);
  const doDia = filtrarItensPorContexto(ITENS.filter((it) => it.unidade === "Cuca José Walter"), { dia: "sexta", data: "2026-11-20" });
  assertEquals(titulos(doDia), ["Cuca José Walter / JUDÔ", "Cuca José Walter / COMUNIDADE EM PAUTA / Cine Juventude"]);
});

// ── Filtro da conversa: saída e mescla (AC2) ────────────────────────────────────────────────
Deno.test("AC2: pedido de tirar o filtro — 'qualquer dia', 'qualquer horário', 'tanto faz' só sobre dia/horário", () => {
  assertEquals(pedidoDeTirarFiltro("pode ser qualquer dia", "No sábado tem natação às 8h."), { dia: true, turno: false });
  assertEquals(pedidoDeTirarFiltro("qualquer horário", ""), { dia: false, turno: true });
  assertEquals(pedidoDeTirarFiltro("qualquer dia e horário", ""), { dia: true, turno: true });
  assertEquals(pedidoDeTirarFiltro("tanto faz o horário", ""), { dia: false, turno: true });
  // "tanto faz" sozinho só vale como resposta a uma pergunta do bot sobre dia ou horário
  assertEquals(pedidoDeTirarFiltro("tanto faz", "No sábado não tem natação. Quer ver outro dia?"), { dia: true, turno: false });
  assertEquals(pedidoDeTirarFiltro("tanto faz", "Tem de manhã e à noite. Prefere de manhã ou à tarde?"), { dia: false, turno: true });
  // negativos: a resposta do bot cita o dia, mas não pergunta por ele
  const P1 = "No Cuca José Walter não tem curso no sábado. Tem nestas unidades:\n1️⃣ Cuca Mondubim\n2️⃣ Cuca Pici\nQuer saber de alguma?";
  assertEquals(pedidoDeTirarFiltro("tanto faz", "De qual unidade você quer saber sobre natação? Se preferir, vejo em toda a Rede CUCA 😊"), { dia: false, turno: false });
  assertEquals(pedidoDeTirarFiltro("tanto faz", P1), { dia: false, turno: false });
  assertEquals(pedidoDeTirarFiltro("qualquer uma", P1), { dia: false, turno: false });
  assertEquals(pedidoDeTirarFiltro("pode ser qualquer unidade", P1), { dia: false, turno: false });
  assertEquals(pedidoDeTirarFiltro("não importa a idade", "Me diz qual te interessa que eu mostro os dias e horários."), { dia: false, turno: false });
  assertEquals(pedidoDeTirarFiltro("tanto faz", "No sábado não tem natação, só na terça."), { dia: false, turno: false });
  assertEquals(pedidoDeTirarFiltro("qualquer curso", "No sábado tem Libras."), { dia: false, turno: false });
});

Deno.test("AC2: mescla — dia novo substitui (não soma); pedido de tirar apaga o guardado e o que o modelo repetiu", () => {
  const sessao = { dia: "sábado", turno: "noite", idade: 16 };
  assertEquals(mesclarContextoDaConversa(sessao, { atividade_nao_importa: true }), { dia: "sábado", turno: "noite", idade: 16, atividade_nao_importa: true });
  assertEquals(mesclarContextoDaConversa(sessao, { dia: "terça" }), { dia: "terça", turno: "noite", idade: 16 });
  // "pode ser qualquer dia" — o modelo repetiu o sábado da conversa: sai
  assertEquals(mesclarContextoDaConversa(sessao, { dia: "sábado" }, { dia: true, turno: false }, {}), { turno: "noite", idade: 16 });
  // "qualquer horário" com o modelo repetindo a noite: sai; o dia fica
  assertEquals(mesclarContextoDaConversa(sessao, { turno: "noite" }, { dia: false, turno: true }, {}), { dia: "sábado", idade: 16 });
  // "qualquer dia, mas de manhã": o turno escrito agora entra
  assertEquals(mesclarContextoDaConversa(sessao, { turno: "manha" }, { dia: true, turno: false }, { turno: "manha" }), { turno: "manha", idade: 16 });
  // dia novo sem data tira a data de "hoje"
  assertEquals(mesclarContextoDaConversa({ dia: "sexta", data: "2026-11-20" }, { dia: "sábado" }), { dia: "sábado" });
  assertEquals(semDataVencida<Record<string, unknown>>({ dia: "sexta", data: "2026-11-20", turno: "noite" }, "2026-11-21"), { turno: "noite" });
  assertEquals(semDataVencida({ dia: "sábado", data: "2026-11-21" }, "2026-11-20"), { dia: "sábado", data: "2026-11-21" });
  assert(temFiltroDeDiaOuTurno({ dia: "sábado" }) && temFiltroDeDiaOuTurno({ turno: "noite" }) && !temFiltroDeDiaOuTurno({ idade: 16 }));
  assertEquals(filtroHerdadoDoContexto({ dia: "sábado", turno: "noite" }, {}, {}), ["dia", "turno"]);
  assertEquals(filtroHerdadoDoContexto({ dia: "sábado", turno: "noite" }, { turno: "noite" }, { dia: "sábado" }), []);
  assert("prog_ultima_consulta" in LIMPEZA_ESTADO_SESSAO);
});

// ── Rota (AC1) ──────────────────────────────────────────────────────────────────────────────
const leitura = (parcial: Partial<LeituraTurno>): LeituraTurno => ({ tipo: "pedido_novo", assunto: "programacao", unidade_citada: null, escopo: "nao_disse", canal: null, atividade: null, termos_busca: [], area: null, idade: null, contexto: {}, ...parcial });
const estado = (parcial: Partial<EstadoRota> = {}): EstadoRota => ({ unidadeSalva: null, unidadeAnterior: null, escopoRedeSalvo: false, sessaoReaberta: false, primeiraRespostaDaSessao: false, ultimaRespostaFoiPronta: false, disparoRecente: false, contextoDeProgramacao: false, pedeDetalhe: false, atividadeNovaNaConversa: false, opcoesAtividade: () => [], ...parcial });

Deno.test("AC1 (rota): 'o que tem' com dia/turno numa unidade vai para a lista filtrada; sem filtro, nada muda", () => {
  const oQueTem = leitura({ assunto: "o_que_tem", contexto: { dia: "sábado" } });
  assertEquals(decidirRota(oQueTem, estado({ unidadeSalva: "Cuca José Walter", filtroDaConversa: true })), { acao: "programacao", escopo: "Cuca José Walter", escopoDaMensagem: false, listarPorIdade: true });
  assertEquals(decidirRota(leitura({ assunto: "o_que_tem" }), estado({ unidadeSalva: "Cuca José Walter" })), { acao: "unidade", unidade: "Cuca José Walter", pedido: false, troca: true });
  // com área, segue a consulta da área (filtrada pelo dia)
  assertEquals(decidirRota(leitura({ assunto: "o_que_tem", area: "CURSOS" }), estado({ unidadeSalva: "Cuca José Walter", filtroDaConversa: true })).acao, "programacao");
  // rede sem área continua perguntando a área (a pendência guarda o dia); sem unidade, pergunta a unidade
  assertEquals(decidirRota(leitura({ assunto: "o_que_tem", escopo: ESCOLHA_REDE }), estado({ filtroDaConversa: true })).acao, "perguntar_area");
  assertEquals(decidirRota(oQueTem, estado({ filtroDaConversa: true })).acao, "perguntar_escopo");
  // só a unidade, com filtro na conversa: a lista filtrada dessa unidade
  assertEquals(decidirRota(leitura({ tipo: "so_unidade", escopo: "Cuca Pici", unidade_citada: "Cuca Pici" }), estado({ filtroDaConversa: true })), { acao: "programacao", escopo: "Cuca Pici", escopoDaMensagem: true, listarPorIdade: true });
  // continuação sem atividade ("me manda os horários") segue como antes (filtro vai na instrução)
  assertEquals(decidirRota(leitura({ tipo: "continuacao" }), estado({ unidadeSalva: "Cuca José Walter", filtroDaConversa: true })).acao, "unidade");
  // pergunta institucional não muda
  assertEquals(decidirRota(leitura({ assunto: "institucional" }), estado({ unidadeSalva: "Cuca José Walter", filtroDaConversa: true })).acao, "unidade");
});

// ── Filtro herdado que esvazia (AC3) ────────────────────────────────────────────────────────
const vigentes16 = itensVigentes(ITENS, "2026-11-16");
Deno.test("AC3: violão com o sábado da conversa → 'filtro_herdado' com os dias do violão (nunca 'nenhuma')", () => {
  const r = montarConsultaComContexto(vigentes16, { texto: "tem violão?", atividade: "violão", termos: ["violao"], area: null, contexto: { dia: "sábado" }, escopo: "Cuca Mondubim", filtroHerdado: ["dia"] });
  assertEquals(r.situacao, "filtro_herdado");
  assertEquals(r.filtro, "dia: sábado");
  assertStringIncludes(r.bloco, "Com o filtro da conversa (dia: sábado) nao ha nada");
  assertStringIncludes(r.bloco, "Violão");
  // o mesmo pedido com o sábado escrito AGORA não é herdado: segue como antes
  assertEquals(montarConsultaComContexto(vigentes16, { texto: "tem violão no sábado?", atividade: "violão", termos: ["violao"], area: null, contexto: { dia: "sábado" }, escopo: "Cuca Mondubim" }).situacao, "nenhuma");
});

Deno.test("AC3: lista pelo turno da conversa (sem idade) → situação 'contexto'; turno que esvazia → 'filtro_herdado'", () => {
  const noite = montarConsultaComContexto(vigentes16, { texto: "o que tem?", atividade: null, termos: [], area: null, contexto: { turno: "noite" }, escopo: "Cuca José Walter", listarPorIdade: true, filtroHerdado: ["turno"] });
  assertEquals(noite.situacao, "contexto");
  assertStringIncludes(noite.bloco, "JUDÔ");
  assert(!noite.bloco.includes("NATAÇÃO"), "natação é de manhã");
  const pici = montarConsultaComContexto(vigentes16, { texto: "o que tem?", atividade: null, termos: [], area: null, contexto: { turno: "noite" }, escopo: "Cuca Pici", listarPorIdade: true, filtroHerdado: ["turno"] });
  assertEquals(pici.situacao, "filtro_herdado");
  assertStringIncludes(pici.bloco, "Tech Start");
});

// ── "2" na lista (AC4) ──────────────────────────────────────────────────────────────────────
Deno.test("AC4: número da lista vale só se a última resposta for a da consulta guardada", () => {
  const resposta = "No Cuca José Walter não tem curso no sábado. Tem nestas unidades:\n1️⃣ Cuca Mondubim\n2️⃣ Cuca Pici\nQuer saber de alguma?";
  const consulta = { texto: "cursos aos sábados", atividade: null, termos: [], area: "CURSOS" as const, contexto: { dia: "sábado" }, marca: marcaDaResposta(resposta) };
  assertEquals(unidadeDaListaDaConsulta("2", resposta, consulta), "Cuca Pici");
  assertEquals(unidadeDaListaDaConsulta("1", resposta, consulta), "Cuca Mondubim");
  assertEquals(unidadeDaListaDaConsulta("3", resposta, consulta), null);
  // outra resposta (ex.: menu fixo de unidades) não usa a consulta guardada
  assertEquals(unidadeDaListaDaConsulta("2", "Sobre qual unidade CUCA você quer saber? 😊\n\n1️⃣ Barra\n2️⃣ Jangurussu", consulta), null);
});

// ── Handler (motor inteiro, sem rede) ───────────────────────────────────────────────────────
type Chamada = { tabela: string; metodo: string; arg?: unknown };
const respostaOpenAI = (conteudo: string) => new Response(JSON.stringify({ choices: [{ message: { content: conteudo } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });

// deno-lint-ignore no-explicit-any
function supabaseMock(dados: Record<string, unknown>, chamadas: Chamada[]): any {
  function cadeia(tabela: string) {
    let chave: string | null = null;
    // deno-lint-ignore no-explicit-any
    const proxy: any = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") {
          const data = tabela === "system_config" ? (chave === "rota_estruturada" ? { valor: "on" } : null) : dados[tabela] ?? null;
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
const INICIO: Msg[] = [{ conteudo: "oi", remetente: "lead", minutos: 5 }, { conteudo: "Olá! Em que posso te ajudar? 😊", remetente: "agente", minutos: 4 }];
type Opcoes = { anteriores?: Msg[]; agora?: number; respostaModelo?: string; leituraFalha?: boolean; interpretacao?: Record<string, unknown> };

function rodar(atual: string, metadata: Record<string, unknown>, leituraModelo: Record<string, unknown>, opcoes: Opcoes = {}) {
  return comDataSimulada(opcoes.agora ?? SEGUNDA_16_11, () => rodarNaData(atual, metadata, leituraModelo, opcoes));
}
async function rodarNaData(atual: string, metadata: Record<string, unknown>, leituraModelo: Record<string, unknown>, opcoes: Opcoes) {
  const agora = Date.now();
  const msgs = [...(opcoes.anteriores ?? INICIO), { conteudo: atual, remetente: "lead", minutos: 0 }]
    .map((m) => ({ conteudo: m.conteudo, remetente: m.remetente, created_at: new Date(agora - m.minutos * 60000 - 1000).toISOString() })).reverse();
  const dados: Record<string, unknown> = {
    "rpc:get_openai_key": "chave-falsa",
    "rpc:buscar_chunks_similares": [],
    leads: { id: "lead-1", nome: "Fulano", opt_in: true, bloqueado: false },
    conversas: { id: "conv-1", status: "ativa", metadata, lead_id: "lead-1" },
    mensagens: msgs,
    prompts_agentes: { prompt_sistema: "sistema", prompt_contexto: "", temperatura: 0.7, max_tokens: 500, menu_boas_vindas: null },
    configuracoes: { valor: { empregabilidade: "5585999401057", acesso_cuca: null } },
    unidades_cuca: [],
    documentos_rag: Object.entries(PROGRAMACAO).map(([u, c], i) => ({ id: "doc-" + i, unidade_cuca: u, conteudo: c, created_at: "2026-11-02T13:42:5" + i + "Z" })),
    // texto inteiro da programação (um item por trecho, como no banco) — usado na programação inteira
    chunks_documentos: Object.values(ITENS_JW).map((i) => ({ conteudo: CABECALHO_JW + "Título: Programação Cuca José Walter — Novembro 2026\n" + i })),
  };
  const chamadas: Chamada[] = [];
  const prompts: string[] = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const endereco = String(url instanceof Request ? url.url : url);
    const corpo = String(init?.body ?? "");
    if (endereco.includes("/embeddings")) return Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: [0, 0, 0] }] }), { status: 200 }));
    if (endereco.includes("/chat/completions")) {
      if (corpo.includes(MARCADOR_CLASSIFICADOR_EMPREGO)) return Promise.resolve(respostaOpenAI(JSON.stringify({ fala_de_emprego: false, vaga_sem_tipo: false, outra_pergunta: null })));
      if (corpo.includes(MARCADOR_LEITURA_TURNO)) return Promise.resolve(opcoes.leituraFalha ? new Response("erro", { status: 500 }) : respostaOpenAI(JSON.stringify(leituraModelo)));
      if (corpo.includes("Você interpreta mensagens de leads")) return Promise.resolve(respostaOpenAI(JSON.stringify(opcoes.interpretacao ?? { tipo: "nao_programacao", atividade: null, termos_busca: [], area: null, contexto: {}, escopo: null })));
      prompts.push(corpo);
      return Promise.resolve(respostaOpenAI(opcoes.respostaModelo ?? "Resposta do modelo."));
    }
    throw new Error("fetch não mockado: " + endereco);
  }) as typeof fetch;
  const logOriginal = console.log;
  const errOriginal = console.error;
  console.log = () => {};
  console.error = () => {};
  try {
    const req = new Request("http://localhost/motor-agente", {
      method: "POST",
      body: JSON.stringify({ mensagem: atual, telefone: "5585999999999", canal_origem: "test", agente_tipo: "Institucional", unidade_cuca: "Geral", conversa_id: "conv-1" }),
    });
    const resp = await handler(req, supabaseMock(dados, chamadas));
    assertEquals(resp.status, 200);
    const corpo = await resp.json();
    await new Promise((r) => setTimeout(r, 20));
    const patches = chamadas.filter((c) => c.tabela === "rpc:merge_conversa_metadata").map((c) => (c.arg as { p_patch: Record<string, unknown> }).p_patch);
    return { prompts, patches, corpo, metadataFinal: patches.at(-1) ?? metadata };
  } finally {
    globalThis.fetch = fetchOriginal;
    console.log = logOriginal;
    console.error = errOriginal;
  }
}
const texto = (prompts: string[]) => JSON.parse(prompts[0]).messages.map((m: { content: string }) => m.content).join("\n");

const O_QUE_TEM = (contexto: Record<string, unknown> = {}, termos: string[] = []) => ({ tipo: "pedido_novo", assunto: "o_que_tem", escopo: "nao_disse", termos_busca: termos, contexto });
const JW = { unidade_selecionada: "Cuca José Walter", conversa_engajada: true };

Deno.test("AC1 (handler): 'O que tem no sábado?' com a unidade salva → consulta por dia, nas duas leituras do modelo", async () => {
  for (const l of [O_QUE_TEM(), O_QUE_TEM({}, ["sábado"]), O_QUE_TEM({ dia: "sábado" })]) {
    const { prompts } = await rodar("O que tem no sábado?", JW, l);
    assertEquals(prompts.length, 1, JSON.stringify(l));
    const p = texto(prompts);
    assertStringIncludes(p, "atividades no sábado no Cuca José Walter:");
    assertStringIncludes(p, "VENHA JOGAR");
    assert(!p.includes("PROGRAMACAO MENSAL ATUAL"), "nunca a programação inteira");
    assert(!p.includes("A voz como"), "curso de terça e quinta não entra");
  }
});

Deno.test("AC1 (handler): sem unidade salva → pergunta a unidade guardando o dia; escolhida a unidade → consulta por dia", async () => {
  const t1 = await rodar("O que tem no sábado?", { conversa_engajada: true }, O_QUE_TEM());
  assertEquals(t1.prompts.length, 0);
  assertStringIncludes(t1.corpo.resposta, "De qual unidade você quer saber");
  const t2 = await rodar("José Walter", t1.metadataFinal, { tipo: "so_unidade", assunto: null, unidade_citada: "Cuca José Walter", escopo: "Cuca José Walter", contexto: {} }, {
    anteriores: [...INICIO, { conteudo: "O que tem no sábado?", remetente: "lead", minutos: 2 }, { conteudo: t1.corpo.resposta, remetente: "agente", minutos: 1 }],
  });
  assertEquals(t2.prompts.length, 1);
  assertStringIncludes(texto(t2.prompts), "atividades no sábado no Cuca José Walter:");
});

Deno.test("AC2 (handler): sábado → 'e natação?' filtra pelo sábado → 'e na terça?' troca → 'pode ser qualquer dia' tira o dia", async () => {
  const t1 = await rodar("O que tem no sábado?", JW, O_QUE_TEM());
  assertEquals((t1.metadataFinal.prog_contexto as Record<string, unknown>).dia, "sábado");
  // "e natação?" como continuação (pedido novo de atividade com unidade salva pergunta antes se é da mesma unidade — regra da 06)
  const t2 = await rodar("e natação?", t1.metadataFinal, { tipo: "continuacao", assunto: "programacao", escopo: "nao_disse", atividade: "natação", termos_busca: ["natacao"], contexto: {} });
  const p2 = texto(t2.prompts);
  assertStringIncludes(p2, "filtrada pela pergunta e pelo contexto: dia: sábado");
  assertStringIncludes(p2, "Cuca Barra");
  assertStringIncludes(p2, "NATAÇÃO INFANTIL");
  const t3 = await rodar("e na terça?", t2.metadataFinal, { tipo: "continuacao", assunto: "programacao", escopo: "nao_disse", atividade: "natação", termos_busca: ["natacao"], contexto: { dia: "terça" } });
  assertEquals((t3.metadataFinal.prog_contexto as Record<string, unknown>).dia, "terça");
  assertStringIncludes(texto(t3.prompts), "contexto: dia: terça");
  const comTurno = { ...t3.metadataFinal, prog_contexto: { dia: "terça", turno: "manha" } };
  const t4 = await rodar("pode ser qualquer dia", comTurno, { tipo: "continuacao", assunto: "programacao", escopo: "nao_disse", atividade: "natação", termos_busca: ["natacao"], contexto: { dia: "terça" } }, {
    anteriores: [...INICIO, { conteudo: "e na terça?", remetente: "lead", minutos: 2 }, { conteudo: "Na terça tem natação às 7h no José Walter.", remetente: "agente", minutos: 1 }],
  });
  // gravado no banco (não só em memória): sem o dia, com o turno
  assert(t4.patches.some((m) => JSON.stringify(m.prog_contexto) === JSON.stringify({ turno: "manha" })), "prog_contexto gravado só com o turno");
  assertEquals(t4.metadataFinal.prog_contexto, { turno: "manha" });
});

Deno.test("AC2 (handler): 'qualquer horário' tira o turno guardado; 'tanto faz' respondendo à pergunta de unidade não mexe", async () => {
  const t1 = await rodar("qualquer horário", { ...JW, prog_contexto: { dia: "sábado", turno: "noite" } }, { tipo: "continuacao", assunto: "programacao", escopo: "nao_disse", atividade: "judô", termos_busca: ["judo"], contexto: { turno: "noite" } });
  assertEquals(t1.metadataFinal.prog_contexto, { dia: "sábado" });
  const t2 = await rodar("tanto faz", { conversa_engajada: true, prog_contexto: { dia: "sábado" } }, { tipo: "cortesia", assunto: null, escopo: "nao_disse", contexto: {} }, {
    anteriores: [...INICIO, { conteudo: "tem natação?", remetente: "lead", minutos: 2 }, { conteudo: "De qual unidade você quer saber sobre natação? Se preferir, vejo em toda a Rede CUCA 😊", remetente: "agente", minutos: 1 }],
  });
  assert(t2.patches.every((m) => m.prog_contexto === undefined || (m.prog_contexto as Record<string, unknown>).dia === "sábado"), "o sábado continua guardado");
});

Deno.test("AC3 (handler): violão com o sábado da conversa no Mondubim → instrução de filtro herdado, sem 'nenhuma'", async () => {
  const { prompts } = await rodar("tem violão?", { unidade_selecionada: "Cuca Mondubim", conversa_engajada: true, prog_contexto: { dia: "sábado" } }, { tipo: "continuacao", assunto: "programacao", escopo: "nao_disse", atividade: "violão", termos_busca: ["violao"], contexto: {} });
  const p = texto(prompts);
  assertStringIncludes(p, "Nesta conversa a pessoa tinha pedido dia: sábado, e com esse filtro nao ha violão");
  assertStringIncludes(p, "Sem esse filtro, tem:");
  assertStringIncludes(p, "Qua e Sex");
  assert(!p.includes("a busca foi feita em todas as unidades"));
});

Deno.test("AC4 (handler): lista de P1 → '2' repete a consulta (cursos no sábado) no Pici, não a programação inteira", async () => {
  const respostaP1 = "No Cuca José Walter não tem curso no sábado. Tem nestas unidades:\n1️⃣ Cuca Mondubim\n2️⃣ Cuca Pici\nQuer saber de alguma?";
  const t1 = await rodar("Quais são os cursos que tem aos sábados?", JW, { tipo: "pedido_novo", assunto: "programacao", escopo: "nao_disse", area: "CURSOS", termos_busca: ["sábados"], contexto: {} }, { respostaModelo: respostaP1 });
  const guardada = t1.metadataFinal.prog_ultima_consulta as Record<string, unknown>;
  assert(guardada, "consulta guardada para o número");
  assertEquals(guardada.contexto, { dia: "sábado" });
  const t2 = await rodar("2", t1.metadataFinal, { tipo: "pedido_novo", assunto: null, escopo: "nao_disse", contexto: {} }, {
    anteriores: [...INICIO, { conteudo: "Quais são os cursos que tem aos sábados?", remetente: "lead", minutos: 2 }, { conteudo: respostaP1, remetente: "agente", minutos: 1 }],
  });
  assertEquals(t2.prompts.length, 1);
  const p = texto(t2.prompts);
  assertStringIncludes(p, "Cursos e Oficinas no sábado no Cuca Pici:");
  assertStringIncludes(p, "Tech Start");
  assert(!p.includes("PROGRAMACAO MENSAL ATUAL"));
  assertEquals(t2.metadataFinal.unidade_selecionada, "Cuca Pici");
  assertEquals(t2.metadataFinal.prog_ultima_consulta, null, "a consulta guardada sai depois de usada");
});

Deno.test("AC2 (handler, negativo): depois da lista de P1, 'qualquer uma' não tira o sábado da conversa", async () => {
  const respostaP1 = "No Cuca José Walter não tem curso no sábado. Tem nestas unidades:\n1️⃣ Cuca Mondubim\n2️⃣ Cuca Pici\nQuer saber de alguma?";
  const { metadataFinal } = await rodar("qualquer uma", { ...JW, prog_contexto: { dia: "sábado" } }, { tipo: "pedido_novo", assunto: "programacao", escopo: "nao_disse", area: "CURSOS", contexto: {} }, {
    anteriores: [...INICIO, { conteudo: "Quais são os cursos que tem aos sábados?", remetente: "lead", minutos: 2 }, { conteudo: respostaP1, remetente: "agente", minutos: 1 }],
  });
  assertEquals((metadataFinal.prog_contexto as Record<string, unknown>).dia, "sábado");
});

Deno.test("AC4 (handler): lista de 'outras_unidades' (atividade sem dia) → '1' repete a natação na Barra", async () => {
  const respostaLista = "O Cuca Mondubim não tem natação. Tem nestas unidades:\n1️⃣ Cuca Barra\n2️⃣ Cuca José Walter\nQuer saber de alguma?";
  const t1 = await rodar("tem natação?", { unidade_selecionada: "Cuca Mondubim", conversa_engajada: true }, { tipo: "continuacao", assunto: "programacao", escopo: "nao_disse", atividade: "natação", termos_busca: ["natacao"], contexto: {} }, { respostaModelo: respostaLista });
  assertEquals((t1.metadataFinal.prog_ultima_consulta as Record<string, unknown>)?.atividade, "natação");
  const t2 = await rodar("1", t1.metadataFinal, { tipo: "pedido_novo", assunto: null, escopo: "nao_disse", contexto: {} }, {
    anteriores: [...INICIO, { conteudo: "tem natação?", remetente: "lead", minutos: 2 }, { conteudo: respostaLista, remetente: "agente", minutos: 1 }],
  });
  const p = texto(t2.prompts);
  assertStringIncludes(p, "NATAÇÃO INFANTIL");
  assert(!p.includes("PROGRAMACAO MENSAL ATUAL"));
  assertEquals(t2.metadataFinal.unidade_selecionada, "Cuca Barra");
});

Deno.test("AC6 (handler): sexta 20/11, 'o que tem hoje?' no José Walter → Cine de 20/11 e judô; nunca a Batalha de 27/11", async () => {
  const { prompts, metadataFinal } = await rodar("o que tem hoje?", JW, O_QUE_TEM(), { agora: SEXTA_20_11 });
  const p = texto(prompts);
  assertStringIncludes(p, "Cine Juventude");
  assertStringIncludes(p, "JUDÔ");
  assert(!p.includes("Batalha de Rima"), "evento de outra sexta");
  assertEquals(metadataFinal.prog_contexto, { dia: "sexta", data: "2026-11-20" });
});

Deno.test("AC7 (handler): itens com data passada não vão ao modelo — nem na lista filtrada nem na programação inteira", async () => {
  const quinta = await rodar("o que tem na quinta?", JW, O_QUE_TEM());
  const p1 = texto(quinta.prompts);
  assertStringIncludes(p1, "NATAÇÃO");
  assert(!p1.includes("Piscina Recreativa"), "evento de 12/11");
  // programação inteira (troca de unidade sem pedido): trecho vencido sai do texto
  const inteira = await rodar("José Walter", { conversa_engajada: true, unidade_selecionada: "Cuca Barra" }, { tipo: "so_unidade", assunto: null, unidade_citada: "Cuca José Walter", escopo: "Cuca José Walter", contexto: {} });
  const p2 = texto(inteira.prompts);
  assertStringIncludes(p2, "PROGRAMACAO MENSAL ATUAL");
  assertStringIncludes(p2, "VENHA JOGAR");
  assert(!p2.includes("Piscina Recreativa") && !p2.includes("FOTOGRAFIA"), "trechos vencidos fora da programação inteira");
});

Deno.test("V6 (handler): continuação sem atividade com turno na conversa → instrução do filtro vai junto da programação", async () => {
  const { prompts } = await rodar("me manda os horários", { ...JW, prog_contexto: { turno: "noite" } }, { tipo: "continuacao", assunto: "programacao", escopo: "nao_disse", contexto: {} });
  assertStringIncludes(texto(prompts), "INSTRUCAO (filtro da conversa): nesta conversa a pessoa pediu turno: noite");
});

Deno.test("AC8 (handler, leitura do turno falhando): dia da mensagem filtra e o dia guardado vale no caminho de reserva", async () => {
  const cursos = await rodar("quais cursos tem no sábado?", JW, {}, { leituraFalha: true, interpretacao: { tipo: "pergunta_programacao", atividade: null, termos_busca: [], area: "CURSOS", contexto: {}, escopo: null } });
  assertEquals(cursos.prompts.length, 1);
  assertStringIncludes(texto(cursos.prompts), "No Cuca José Walter NAO ha Cursos e Oficinas no sábado");
  assertEquals((cursos.metadataFinal.prog_contexto as Record<string, unknown>).dia, "sábado");
  const natacao = await rodar("e natação?", { ...JW, prog_contexto: { dia: "sábado" } }, {}, { leituraFalha: true, interpretacao: { tipo: "continuacao", atividade: "natação", termos_busca: ["natacao"], area: "ESPORTES", contexto: {}, escopo: null } });
  const p = texto(natacao.prompts);
  assertStringIncludes(p, "contexto: dia: sábado");
  assertStringIncludes(p, "NATAÇÃO INFANTIL");
});
