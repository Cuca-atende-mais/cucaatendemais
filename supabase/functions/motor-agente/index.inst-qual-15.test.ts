// S-INST-QUAL-15 — programação por dia: as três pontas da revisão da 14.
// Mesmos itens de teste da 14 (formato real de novembro de 2026). Nenhum teste chama a OpenAI nem o banco.
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  diasDaMensagem,
  ESCOLHA_REDE,
  extrairItensProgramacao,
  garantirOutrasAtividadesDoDia,
  handler,
  type ItemProgramacao,
  marcaDaResposta,
  MARCADOR_CLASSIFICADOR_EMPREGO,
  MARCADOR_LEITURA_TURNO,
  montarConsultaComContexto,
  nomeLegivelDaAtividade,
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
const SEGUNDA_16_11 = Date.parse("2026-11-16T15:00:00-03:00");

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

const JW = { unidade_selecionada: "Cuca José Walter", conversa_engajada: true };


// ── Achado 3: ordinal e "segunda" que não são dia ───────────────────────────────────────────
Deno.test("AC3: '2ª via', '2º grau', 'na segunda semana' e afins não viram dia", () => {
  const agora = new Date("2026-11-17T15:00:00Z");
  for (const f of [
    "pedido de 2ª via do certificado", "de 2ª mão", "tem curso de 2º grau?", "na 2ª chamada",
    "na segunda semana de dezembro tem matrícula?", "de segunda via", "na segunda edição do Tech Start",
    "segunda chamada do edital", "como pego a 2ª via?", "é a 3ª vez que pergunto", "fiz o 2º ciclo", "na 2ª etapa",
    "a segunda opção", "quinta série tem reforço?", "minha filha está na 5ª série", "tem algo de segunda mão?",
  ]) assertEquals([...diasDaMensagem(f, agora)], [], f);
});

Deno.test("AC3: dias de verdade continuam sendo lidos", () => {
  const agora = new Date("2026-11-17T15:00:00Z");
  const casos: [string, string[]][] = [
    ["de segunda a sexta tem?", ["seg", "ter", "qua", "qui", "sex"]],
    ["tem na 2ª?", ["seg"]],
    ["toda 2ª feira", ["seg"]],
    ["tem natação segunda?", ["seg"]],
    ["quarta à tarde", ["qua"]],
    ["tem aula 3ª feira?", ["ter"]],
    ["na segunda de manhã tem?", ["seg"]],
    ["tem na segunda?", ["seg"]],
  ];
  for (const [f, esperado] of casos) assertEquals([...diasDaMensagem(f, agora)].sort(), [...esperado].sort(), f);
});

// ── Achado 1: "2" com a unidade como título ─────────────────────────────────────────────────
// Resposta real do modelo na rodada de 17/11 (DS-01): unidade como título, cursos numerados.
const RESPOSTA_POR_CURSO = "No Cuca José Walter não há Cursos e Oficinas aos sábados na programação deste mês. \n\nPorém, em outras unidades, temos as seguintes opções:\n\n**Cuca Mondubim:**\n1️⃣ Curso dBásico e Libras III — Sábados, 09:00 às 12:00. \n\n**Cuca Pici:**\n2️⃣ Tech Start: Automatize, Inove e Lucre com Python & Inteligência Artificial — Sábados, 08:00 às 12:00.\n3️⃣ Tech Start: Automatize, Inove e Lucre com Python & Inteligência Artificial — Sábados, 13:00 às 17:00.\n\nQuer saber mais detalhes de algum desses cursos? 😊";
const consultaDe = (resposta: string) => ({ texto: "Quais são os cursos que tem aos sábados?", atividade: null, termos: [], area: "CURSOS" as const, contexto: { dia: "sábado" }, marca: marcaDaResposta(resposta) });

Deno.test("AC1: lista numerada por curso → a unidade vem do título acima da linha", () => {
  const c = consultaDe(RESPOSTA_POR_CURSO);
  assertEquals(unidadeDaListaDaConsulta("1", RESPOSTA_POR_CURSO, c), "Cuca Mondubim");
  assertEquals(unidadeDaListaDaConsulta("2", RESPOSTA_POR_CURSO, c), "Cuca Pici");
  assertEquals(unidadeDaListaDaConsulta("3", RESPOSTA_POR_CURSO, c), "Cuca Pici");
  assertEquals(unidadeDaListaDaConsulta("4", RESPOSTA_POR_CURSO, c), null);
});

Deno.test("AC1: título com marcador embaixo (formato do DS-04) e lista por unidade (DS-08) continuam iguais", () => {
  const porUnidade = "No Cuca José Walter não tem curso no sábado. Tem nestas unidades:\n1️⃣ Cuca Mondubim\n2️⃣ Cuca Pici\nQuer saber de alguma?";
  assertEquals(unidadeDaListaDaConsulta("2", porUnidade, consultaDe(porUnidade)), "Cuca Pici");
  const comMarcador = "No Cuca Jangurussu não há Cursos aos sábados. Mas tem em outras unidades!\n\n1️⃣ Cuca Mondubim: \n   • Curso dBásico e Libras III — Sábados\n\n2️⃣ Cuca Pici: \n   • Tech Start — Sábados, 08:00\n   • Tech Start — Sábados, 13:00\n\nQuer saber mais?";
  assertEquals(unidadeDaListaDaConsulta("2", comMarcador, consultaDe(comMarcador)), "Cuca Pici");
});

Deno.test("AC1 (negativo): sem título, a abertura que cita a unidade consultada não vira a unidade do número", () => {
  const semTitulo = "No Cuca José Walter não há Cursos e Oficinas aos sábados na programação deste mês.\n1️⃣ Curso dBásico e Libras III — Sábados\n2️⃣ Tech Start — Sábados\nQuer saber de algum?";
  assertEquals(unidadeDaListaDaConsulta("1", semTitulo, consultaDe(semTitulo)), null);
  assertEquals(unidadeDaListaDaConsulta("2", semTitulo, consultaDe(semTitulo)), null);
  const comFraseNoMeio = "No Cuca José Walter não há cursos no sábado.\n\nPorém, em outras unidades, temos as seguintes opções:\n1️⃣ Libras III\n2️⃣ Tech Start\nQuer saber?";
  assertEquals(unidadeDaListaDaConsulta("1", comFraseNoMeio, consultaDe(comFraseNoMeio)), null);
  // resposta que não é a da consulta guardada: nada muda
  assertEquals(unidadeDaListaDaConsulta("2", RESPOSTA_POR_CURSO, consultaDe("outra resposta qualquer")), null);
});

// ── Achado 2: P2 garantido pelo código ──────────────────────────────────────────────────────
Deno.test("AC2: consulta por dia guarda os nomes do P2 (onde, dia, atividades sem repetir)", () => {
  const r = montarConsultaComContexto(ITENS, { texto: "Quais são os cursos que tem aos sábados?", atividade: null, termos: [], area: "CURSOS", contexto: { dia: "sábado" }, escopo: "Cuca José Walter" });
  assertEquals(r.situacao, "dia_outras_unidades");
  assertEquals(r.outrasAtividades, { onde: "no Cuca José Walter", dia: "sábado", nomes: ["Venha Jogar", "Aulão de Capoeira"] });
  // unidade com a área no dia: P2 também vem
  const pici = montarConsultaComContexto(ITENS, { texto: "cursos aos sábados", atividade: null, termos: [], area: "CURSOS", contexto: { dia: "sábado" }, escopo: "Cuca Pici" });
  assertEquals(pici.situacao, "dia_na_unidade");
  assertEquals(pici.outrasAtividades, undefined, "o Pici não tem outras áreas no sábado");
  // rede sem a área no dia (Dia a Dia na terça): P2 da rede, com a unidade em cada nome
  const rede = montarConsultaComContexto(ITENS, { texto: "o que tem do dia a dia na terça?", atividade: null, termos: [], area: "DIA A DIA", contexto: { dia: "terça" }, escopo: ESCOLHA_REDE });
  assertEquals(rede.situacao, "dia_nenhuma");
  assertEquals(rede.outrasAtividades?.onde, "na rede");
  assert(rede.outrasAtividades!.nomes.every((n) => n.endsWith("(Cuca José Walter)")), JSON.stringify(rede.outrasAtividades));
});

Deno.test("AC2: frase do P2 entra antes da pergunta final quando o modelo não citou nada", () => {
  const p2 = { onde: "no Cuca José Walter", dia: "sábado", nomes: ["Venha Jogar", "Aulão de Capoeira"] };
  const sem = "No Cuca José Walter não há cursos aos sábados.\n\n1️⃣ Cuca Mondubim\n2️⃣ Cuca Pici\n\nQuer saber mais sobre algum desses cursos? 😊";
  const com = garantirOutrasAtividadesDoDia(sem, p2);
  assertStringIncludes(com, "No Cuca José Walter, no sábado, também tem: Venha Jogar e Aulão de Capoeira.\n\nQuer saber mais");
  // citou ao menos uma (qualquer caixa): não mexe
  const citou = sem.replace("2️⃣ Cuca Pici", "2️⃣ Cuca Pici\n\nNo JW, no sábado, tem o VENHA JOGAR.");
  assertEquals(garantirOutrasAtividadesDoDia(citou, p2), citou);
  // citou de forma mais curta ("Temporada da Dança", sem o ano): não repete
  const p2Danca = { onde: "no Cuca José Walter", dia: "sábado", nomes: ["Temporada da Dança 2026"] };
  const curta = "No sábado o JW tem a Temporada da Dança.\n\nQuer saber mais?";
  assertEquals(garantirOutrasAtividadesDoDia(curta, p2Danca), curta);
  // sem pergunta no fim: acrescenta no fim
  assertEquals(garantirOutrasAtividadesDoDia("Não tem curso no sábado.", p2), "Não tem curso no sábado.\n\nNo Cuca José Walter, no sábado, também tem: Venha Jogar e Aulão de Capoeira.");
  // sem P2: nada muda
  assertEquals(garantirOutrasAtividadesDoDia(sem, null), sem);
  // muitos nomes: até 4 e "entre outras"; rede com a unidade no nome
  const rede = garantirOutrasAtividadesDoDia("Ninguém tem.", { onde: "na rede", dia: "domingo", nomes: ["A (Cuca Barra)", "B (Cuca Pici)", "C (Cuca Barra)", "D (Cuca Mondubim)", "E (Cuca Pici)"] });
  assertStringIncludes(rede, "Na rede, no domingo, também tem: A (Cuca Barra), B (Cuca Pici), C (Cuca Barra) e D (Cuca Mondubim), entre outras.");
});

Deno.test("AC2: 'Atividade' longa (descrição dos Especiais) não vira nome; vale o título", () => {
  const especial = extrairItensProgramacao("Cuca José Walter", "PROGRAMAÇÃO MENSAL DE NOVEMBRO DE 2026 — Cuca José Walter\n\n== ESPECIAIS ==\n• TEMPORADA DA DANÇA 2026\n  Detalhes: Programa (ESPECIAIS): TEMPORADA DA DANÇA 2026. Atividade: A TEMPORADA DE DANÇA NA REDE CUCA É UMA AÇÃO VOLTADA À VALORIZAÇÃO DA DANÇA COMO EXPRESSÃO ARTÍSTICA E CULTURAL, PROMOVENDO A DIFUSÃO DE TALENTOS. Data: 28/11 (Sábado). Horário: 16:00 às 18:00. Local: TEATRO.\n");
  const r = montarConsultaComContexto([...ITENS, ...especial], { texto: "cursos aos sábados", atividade: null, termos: [], area: "CURSOS", contexto: { dia: "sábado" }, escopo: "Cuca José Walter" });
  assert(r.outrasAtividades!.nomes.includes("Temporada da Dança 2026"), JSON.stringify(r.outrasAtividades));
  assert(!r.outrasAtividades!.nomes.some((n) => n.length > 50), JSON.stringify(r.outrasAtividades));
});

Deno.test("AC2: sem pergunta no fim, a frase entra antes da despedida", () => {
  const p2 = { onde: "no Cuca Pici", dia: "sábado", nomes: ["Venha Jogar"] };
  const resp = "Tech Start no Pici:\n- Sábados, 08:00 às 12:00\n\nSe precisar de mais alguma informação ou quiser se inscrever, é só avisar! 😊";
  assertEquals(garantirOutrasAtividadesDoDia(resp, p2), "Tech Start no Pici:\n- Sábados, 08:00 às 12:00\n\nNo Cuca Pici, no sábado, também tem: Venha Jogar.\n\nSe precisar de mais alguma informação ou quiser se inscrever, é só avisar! 😊");
});

Deno.test("AC2: nome em caixa alta fica legível; caixa mista fica como está", () => {
  assertEquals(nomeLegivelDaAtividade("VENHA JOGAR"), "Venha Jogar");
  assertEquals(nomeLegivelDaAtividade("TEMPORADA DA DANÇA 2026"), "Temporada da Dança 2026");
  assertEquals(nomeLegivelDaAtividade("Aulão de Capoeira"), "Aulão de Capoeira");
});

const CURSOS_SABADO = { tipo: "pedido_novo", assunto: "programacao", escopo: "nao_disse", area: "CURSOS", termos_busca: ["sábados"], contexto: {} };

Deno.test("AC2 (handler): modelo não citou o P2 → a resposta final traz o que o JW tem no sábado, antes da pergunta", async () => {
  const semP2 = "No Cuca José Walter não há Cursos e Oficinas aos sábados.\n\n1️⃣ Cuca Mondubim\n2️⃣ Cuca Pici\n\nQuer saber mais sobre algum desses cursos? 😊";
  const { corpo } = await rodar("Quais são os cursos que tem aos sábados?", JW, CURSOS_SABADO, { respostaModelo: semP2 });
  assertStringIncludes(corpo.resposta, "No Cuca José Walter, no sábado, também tem: Venha Jogar e Aulão de Capoeira.");
  assert(corpo.resposta.indexOf("também tem") < corpo.resposta.indexOf("Quer saber mais"));
});

Deno.test("AC2 (handler): modelo citou o P2 → a resposta fica como o modelo escreveu", async () => {
  const comP2 = "No Cuca José Walter não há Cursos aos sábados, mas tem o Venha Jogar.\n\n1️⃣ Cuca Mondubim\n2️⃣ Cuca Pici\n\nQuer saber mais?";
  const { corpo } = await rodar("Quais são os cursos que tem aos sábados?", JW, CURSOS_SABADO, { respostaModelo: comP2 });
  assert(!corpo.resposta.includes("também tem:"), corpo.resposta);
});

Deno.test("AC1 (handler): lista numerada por curso (resposta real) → '2' repete a consulta no Pici", async () => {
  const t1 = await rodar("Quais são os cursos que tem aos sábados?", JW, CURSOS_SABADO, { respostaModelo: RESPOSTA_POR_CURSO });
  assert(t1.metadataFinal.prog_ultima_consulta, "consulta guardada");
  const t2 = await rodar("2", t1.metadataFinal, { tipo: "pedido_novo", assunto: null, escopo: "nao_disse", contexto: {} }, {
    anteriores: [...INICIO, { conteudo: "Quais são os cursos que tem aos sábados?", remetente: "lead", minutos: 2 }, { conteudo: t1.corpo.resposta, remetente: "agente", minutos: 1 }],
  });
  assertEquals(t2.prompts.length, 1);
  const p = texto(t2.prompts);
  assertStringIncludes(p, "Cursos e Oficinas no sábado no Cuca Pici:");
  assertEquals(t2.metadataFinal.unidade_selecionada, "Cuca Pici");
});
