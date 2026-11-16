// S-INST-QUAL-13 — programação por dia da semana ("quais cursos tem aos sábados?").
// Itens no formato real da programação de novembro de 2026 (copiados do banco em 16/11, só leitura).
// Nenhum teste chama a OpenAI nem o banco: o handler roda com fetch e supabase falsos.
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  completarSoUnidadeComPedidoAnterior,
  consolidarLeitura,
  consultaPorDia,
  descreverDias,
  diasDaMensagem,
  diasDoContexto,
  diasDoItem,
  ESCOLHA_REDE,
  extrairItensProgramacao,
  filtrarItensPorContexto,
  handler,
  type ItemProgramacao,
  type LeituraTurno,
  lerMensagemAtual,
  MARCADOR_CLASSIFICADOR_EMPREGO,
  MARCADOR_LEITURA_TURNO,
  montarConsultaComContexto,
  semDia,
} from "./index.ts";

// ── Programação de teste (formato de novembro) ──────────────────────────────────────────────
const PROGRAMACAO: Record<string, string> = {
  "Cuca José Walter": `PROGRAMAÇÃO MENSAL DE NOVEMBRO DE 2026 — Cuca José Walter
Esta programação vale para o mês de novembro de 2026.

== CURSOS ==
• A voz como extenção do corpo - Técnica vocal(canto)
  Detalhes: Curso: A voz como extenção do corpo - Técnica vocal(canto). Educador: Fabricio Maciel. Carga Horária: 16h. Período: 03/11/2026 a 26/11/2026 (Ter e Qui). Horário: 15:00 às 17:00. Requisitos: 15 a 29 anos interessados em aprender/desenvolver o canto. Ementa: K-POP. A quantidade de vagas muda com frequencia; oriente a pessoa a procurar a unidade CUCA para verificar a disponibilidade.
  Horário: 15:00:00 às 17:00:00
• POWER YOGA - CORPO E ENERGIA
  Detalhes: Curso: POWER YOGA - CORPO E ENERGIA. Educador: Giovanna Santos. Carga Horária: 4h. Período: 03/11/2026 a 26/11/2026 (Qui). Horário: 15:30 às 16:30. Requisitos: A partir de 15 anos, sem limite de idade. Ementa: Yoga.
  Horário: 15:30:00 às 16:30:00

== ESPORTES ==
• NATAÇÃO
  Detalhes: Esporte Modalidade: Natação - Turma TURMA 1. Público: Misto (Idade: 15 a 29 anos). Dias: Ter e Qui. Horário: 07:00 às 08:00.

== DIA A DIA ==
• VENHA JOGAR
  Detalhes: Programa (DIA A DIA): VENHA JOGAR. Atividade: VENHA JOGAR. Data: 07/11 a 28/11 (Sábado). Horário: 08:00 às 17:00. Local: BIBLIOTECA. Informações: Jogos de estratégia e tabuleiro na biblioteca.07112026. Sessão: Artes e Bibliotecas.
  Local: BIBLIOTECA
• COMUNIDADE EM PAUTA
  Detalhes: Programa (DIA A DIA): COMUNIDADE EM PAUTA. Atividade: Aulão de Capoeira. Data: 28/11 (Sábado). Horário: 09:00 às 11:00. Local: QUADRA. Informações: Aulão aberto. Sessão: DPDH.
• COMUNIDADE EM PAUTA
  Detalhes: Programa (DIA A DIA): COMUNIDADE EM PAUTA. Atividade: Piscina Recreativa. Data: 12/11 (Quinta-feira). Horário: 09:00 às 11:00. Local: PISCINA. Informações: Lazer aos sábados e domingos no verão. Sessão: DPDH.
`,
  "Cuca Mondubim": `PROGRAMAÇÃO MENSAL DE NOVEMBRO DE 2026 — Cuca Mondubim

== CURSOS ==
• Curso dBásico e Libras III
  Detalhes: Curso: Curso dBásico e Libras III. Educador: Ana. Carga Horária: 16h. Período: 07/11/2026 a 28/11/2026 (Sáb). Horário: 08:00 às 12:00. Requisitos: 15 a 29 anos. Ementa: Libras.
• Violão
  Detalhes: Curso: Violão. Educador: Beto. Carga Horária: 16h. Período: 03/11/2026 a 26/11/2026 (Qua e Sex). Horário: 18:00 às 20:00. Requisitos: 15 a 29 anos. Ementa: Violão.
`,
  "Cuca Pici": `PROGRAMAÇÃO MENSAL DE NOVEMBRO DE 2026 — Cuca Pici

== CURSOS ==
• Tech Start: Automatize, Inove e Lucre com Python & Inteligência Artificial
  Detalhes: Curso: Tech Start: Automatize, Inove e Lucre com Python & Inteligência Artificial. Educador: Alexandre Lins. Carga Horária: 24h. Período: 07/11/2026 a 12/12/2026 (Sáb). Horário: 08:00 às 12:00. Requisitos: Ter idade entre 15 e 29 anos, preferencialmente. Ementa: Python.
`,
  "Cuca Barra": `PROGRAMAÇÃO MENSAL DE NOVEMBRO DE 2026 — Cuca Barra

== ESPORTES ==
• NATAÇÃO INFANTIL
  Detalhes: Esporte Modalidade: Natação Infantil - Turma TURMA 3. Público: Misto (Idade: 08 a 14 anos). Dias: Sáb. Horário: 08:00 às 09:00.
`,
};
const ITENS: ItemProgramacao[] = Object.entries(PROGRAMACAO).flatMap(([u, c]) => extrairItensProgramacao(u, c));
const titulos = (itens: ItemProgramacao[]) => itens.map((it) => it.unidade + " / " + it.titulo);
const SABADO = { dia: "sábado" };

// ── Leitura do dia ──────────────────────────────────────────────────────────────────────────
Deno.test("Dia do item: os três formatos reais (Período, Dias, Data) e só os campos de data", () => {
  const dias = (titulo: string, unidade = "Cuca José Walter") => descreverDias(diasDoItem(ITENS.find((it) => it.titulo === titulo && it.unidade === unidade)!.detalhe) ?? new Set());
  assertEquals(dias("A voz como extenção do corpo - Técnica vocal(canto)"), "terça e quinta");
  assertEquals(dias("Tech Start: Automatize, Inove e Lucre com Python & Inteligência Artificial", "Cuca Pici"), "sábado");
  assertEquals(dias("NATAÇÃO INFANTIL", "Cuca Barra"), "sábado");
  assertEquals(dias("VENHA JOGAR"), "sábado");
  // "Lazer aos sábados e domingos" está em Informações: não conta; vale a Data (quinta-feira).
  const piscina = ITENS.find((it) => it.detalhe.includes("Piscina Recreativa"))!;
  assertEquals(descreverDias(diasDoItem(piscina.detalhe)!), "quinta");
  assertEquals(diasDoItem("Curso: X. Horário: 08:00 às 10:00."), null);
  assertEquals(descreverDias(diasDoItem("Dias: Ter e Qua e Qui e Sex.")!), "terça, quarta, quinta e sexta");
});

Deno.test("Dia do contexto: texto, plural, lista, abreviado e fim de semana", () => {
  assertEquals(descreverDias(diasDoContexto({ dia: "sábado" })!), "sábado");
  assertEquals(descreverDias(diasDoContexto({ dia: "sabados" })!), "sábado");
  assertEquals(descreverDias(diasDoContexto({ dia: ["Sáb", "domingo"] })!), "sábado e domingo");
  assertEquals(descreverDias(diasDoContexto({ dia: "fim de semana" })!), "sábado e domingo");
  assertEquals(diasDoContexto({}), null);
  assertEquals(diasDoContexto({ dia: "amanhã" }), null);
});

Deno.test("Dia da mensagem: sábado e domingo sozinhos; dia útil só com '-feira' ou preposição; intervalo", () => {
  const d = (t: string) => descreverDias(diasDaMensagem(t));
  assertEquals(d("Quais são os cursos que tem aos sábados?"), "sábado");
  assertEquals(d("e aos sábados que curso tem pra fazer?"), "sábado");
  assertEquals(d("tem alguma coisa no fim de semana?"), "sábado e domingo");
  assertEquals(d("abre domingo?"), "domingo");
  assertEquals(d("tem curso na quarta?"), "quarta");
  assertEquals(d("tem curso quarta-feira?"), "quarta");
  assertEquals(d("de segunda a sexta tem natação?"), "segunda, terça, quarta, quinta e sexta");
  assertEquals(d("quero a segunda opção"), "");
  assertEquals(d("meu filho está na quinta série"), "");
  assertEquals(d("tem natação?"), "");
});

Deno.test("lerMensagemAtual: dia entra no contexto junto com turno; sem dia, contexto como antes", () => {
  assertEquals(lerMensagemAtual("tem curso no sábado de manhã?").contexto, { turno: "manha", dia: "sábado" });
  assertEquals(lerMensagemAtual("tem natação à noite?").contexto, { turno: "noite" });
  assertEquals(lerMensagemAtual("quais cursos tem?").contexto, {});
});

// ── AC1: filtro por dia ────────────────────────────────────────────────────────────────────
Deno.test("AC1: sábado fica com (Sáb), (Sábado) e Dias: Sáb; sai (Ter e Qui); item sem dia fica; sem dia nada muda", () => {
  const semDiaLegivel: ItemProgramacao = { unidade: "Cuca Pici", titulo: "OFICINA SEM DIA", detalhe: "Curso: OFICINA SEM DIA. Horário: 09:00 às 10:00.", area: "CURSOS" };
  const itens = [...ITENS, semDiaLegivel];
  const noSabado = titulos(filtrarItensPorContexto(itens, SABADO));
  assert(noSabado.includes("Cuca Pici / Tech Start: Automatize, Inove e Lucre com Python & Inteligência Artificial"));
  assert(noSabado.includes("Cuca Mondubim / Curso dBásico e Libras III"));
  assert(noSabado.includes("Cuca Barra / NATAÇÃO INFANTIL"));
  assert(noSabado.includes("Cuca José Walter / VENHA JOGAR"));
  assert(noSabado.includes("Cuca Pici / OFICINA SEM DIA"), "item sem dia legível não some");
  assert(!noSabado.includes("Cuca José Walter / A voz como extenção do corpo - Técnica vocal(canto)"));
  assert(!noSabado.includes("Cuca Mondubim / Violão"));
  // fim de semana = sábado e domingo
  assertEquals(titulos(filtrarItensPorContexto(itens, { dia: "fim de semana" })), noSabado);
  // sem dia: idêntico ao filtro de antes (só idade/gênero/turno)
  assertEquals(filtrarItensPorContexto(itens, {}), itens);
  assertEquals(filtrarItensPorContexto(itens, { turno: "noite" }), filtrarItensPorContexto(itens, semDia({ turno: "noite", dia: "sábado" })));
});

// ── AC2, AC3, AC4: consulta por dia ─────────────────────────────────────────────────────────
const consulta = (parcial: Partial<Parameters<typeof montarConsultaComContexto>[1]>) => ({
  texto: "Quais são os cursos que tem aos sábados?",
  atividade: null,
  termos: [] as string[],
  area: "CURSOS" as const,
  contexto: SABADO as Record<string, unknown>,
  escopo: "Cuca José Walter",
  ...parcial,
});

Deno.test("AC2 (P1 e P2): cursos aos sábados no José Walter → não tem lá, mostra Mondubim e Pici, e o que o JW tem no sábado", () => {
  // As duas leituras que o modelo pode dar: "sábados" em termos_busca (o que aconteceu em 15/11) ou nada.
  for (const termos of [["sábados"], []]) {
    const r = montarConsultaComContexto(ITENS, consulta({ termos }));
    assertEquals(r.situacao, "dia_outras_unidades", "termos=" + JSON.stringify(termos));
    assertEquals(r.dia, "sábado");
    assertStringIncludes(r.bloco, "No Cuca José Walter NAO ha Cursos e Oficinas no sábado");
    assertStringIncludes(r.bloco, "Curso dBásico e Libras III");
    assertStringIncludes(r.bloco, "Tech Start");
    assertStringIncludes(r.bloco, "Outras atividades no Cuca José Walter no sábado");
    assertStringIncludes(r.bloco, "VENHA JOGAR (Dia a Dia (eventos e atividades abertas)) — 07/11 a 28/11 (Sábado), 08:00 às 17:00");
    assertStringIncludes(r.bloco, "COMUNIDADE EM PAUTA: Aulão de Capoeira");
    assert(!r.bloco.includes("A voz como"), "curso de terça e quinta não entra");
    assert(!r.bloco.includes("Piscina Recreativa"), "atividade de quinta não entra");
  }
});

Deno.test("AC3: cursos aos sábados no Pici → lista o Tech Start com dia e horário", () => {
  const r = montarConsultaComContexto(ITENS, consulta({ escopo: "Cuca Pici", termos: ["sábados"] }));
  assertEquals(r.situacao, "dia_na_unidade");
  assertStringIncludes(r.bloco, "Tech Start: Automatize, Inove e Lucre com Python & Inteligência Artificial — Curso: Tech Start");
  assertStringIncludes(r.bloco, "(Sáb). Horário: 08:00 às 12:00");
  assert(!r.bloco.includes("Libras"), "na unidade, só a unidade");
});

Deno.test("AC4: cursos aos sábados pela rede → Mondubim e Pici (nunca 'nenhuma')", () => {
  const r = montarConsultaComContexto(ITENS, consulta({ escopo: ESCOLHA_REDE, termos: ["sábados"] }));
  assertEquals(r.situacao, "dia_rede");
  assertStringIncludes(r.bloco, "Cuca Mondubim:");
  assertStringIncludes(r.bloco, "Cuca Pici:");
  assert(!r.bloco.includes("Cuca José Walter:"));
});

Deno.test("Dia sem a área em lugar nenhum: diz que nenhuma tem e cita o que há no dia (outras áreas)", () => {
  const r = consultaPorDia(ITENS, { area: "CURSOS", contexto: { dia: "domingo" }, escopo: "Cuca José Walter" }, diasDoContexto({ dia: "domingo" })!);
  assertEquals(r.situacao, "dia_nenhuma");
  assertEquals(r.bloco, "");
});

Deno.test("Dia + outro contexto (turno da conversa, como em 15/11): tem no sábado fora do turno → situação própria, nunca 'nenhuma'", () => {
  for (const escopo of ["Cuca José Walter", ESCOLHA_REDE]) {
    const r = montarConsultaComContexto(ITENS, consulta({ escopo, termos: ["sábados"], contexto: { dia: "sábado", turno: "noite" } }));
    assertEquals(r.situacao, "dia_fora_do_contexto", escopo);
    assertEquals(r.foraDoContexto, "turno: noite");
    assertStringIncludes(r.bloco, "Tem Cursos e Oficinas no sábado, mas NAO para o contexto informado (turno: noite)");
    assertStringIncludes(r.bloco, "Tech Start");
  }
});

Deno.test("Palavra que sobra do texto (unidade, verbo) não derruba a consulta por dia; atividade lida que não existe continua 'nenhuma'", () => {
  for (const texto of ["Quais cursos tem aos sábados no José Walter?", "cuca Mondubim tem curso sábado?", "Dia de sábado estará funcionando para fazer inscrição?"]) {
    const r = montarConsultaComContexto(ITENS, consulta({ texto }));
    assert(String(r.situacao).startsWith("dia_"), texto + " → " + r.situacao);
  }
  const xadrez = montarConsultaComContexto(ITENS, consulta({ texto: "tem xadrez no sábado?", atividade: "xadrez", termos: ["xadrez"], area: null }));
  assertEquals(xadrez.situacao, "nenhuma");
  // atividade escrita no texto, sem leitura do modelo: casa com título → caminho da atividade
  const natacao = montarConsultaComContexto(ITENS, consulta({ texto: "tem natação no sábado?", area: null }));
  assertEquals(natacao.situacao, "outras_unidades");
});

Deno.test("Atividade + dia: natação no sábado no José Walter → Barra tem no sábado; JW tem natação em outro dia", () => {
  const r = montarConsultaComContexto(ITENS, consulta({ texto: "tem natação no sábado?", atividade: "natação no sábado", termos: ["natacao", "sabado"], area: null }));
  assertEquals(r.situacao, "outras_unidades");
  assertStringIncludes(r.bloco, "Cuca Barra:");
  assertStringIncludes(r.bloco, "NATAÇÃO INFANTIL");
  assertStringIncludes(r.bloco, "NAO para o contexto informado (dia: sábado)");
});

Deno.test("AC5: sem dia no contexto, a consulta segue como antes ('sábados' sozinho em termos continua 'nenhuma')", () => {
  const r = montarConsultaComContexto(ITENS, consulta({ termos: ["sábados"], contexto: {} }));
  assertEquals(r.situacao, "nenhuma");
  assertEquals(r.dia, undefined);
  const area = montarConsultaComContexto(ITENS, consulta({ contexto: {} }));
  assertEquals(area.situacao, "area");
  assertStringIncludes(area.bloco, "A voz como");
});

// ── O dia vale só para o turno ──────────────────────────────────────────────────────────────
const leitura = (parcial: Partial<LeituraTurno>): LeituraTurno => ({
  tipo: "pedido_novo", assunto: "programacao", unidade_citada: null, escopo: "nao_disse", canal: null,
  atividade: null, termos_busca: [], area: null, idade: null, contexto: {}, ...parcial,
});

Deno.test("Dia só da mensagem atual: o do modelo (sessão) não fica; o escrito agora entra; o resto do contexto fica", () => {
  assertEquals(consolidarLeitura(leitura({ atividade: "natação", contexto: { dia: "sábado", turno: "noite" } }), "e natação?").contexto, { turno: "noite" });
  // formas que o leitor da mensagem recusa, mas que falam de dia: vale o que o modelo leu
  assertEquals(consolidarLeitura(leitura({ area: "CURSOS", contexto: { dia: "sexta" } }), "tem curso sexta?").contexto, { dia: "sexta" });
  assertEquals(consolidarLeitura(leitura({ contexto: { dia: "quarta" } }), "e quarta?").contexto, { dia: "quarta" });
  assertEquals(consolidarLeitura(leitura({ contexto: {} }), "o que tem no fds?").contexto, { dia: "sábado e domingo" });
  assertEquals(consolidarLeitura(leitura({ area: "CURSOS", termos_busca: ["sábados"] }), "Quais são os cursos que tem aos sábados?").contexto, { dia: "sábado" });
  assertEquals(semDia({ dia: "sábado", idade: 16 }), { idade: 16 });
  assertEquals(semDia(null), {});
});

Deno.test("Só a unidade depois da resposta de P1: 'Pici' = cursos aos sábados no Pici", () => {
  const l = completarSoUnidadeComPedidoAnterior(leitura({ tipo: "so_unidade", unidade_citada: "Cuca Pici", escopo: "Cuca Pici" }), "Quais são os cursos que tem aos sábados?", ITENS);
  assertEquals(l.tipo, "continuacao");
  assertEquals(l.area, "CURSOS");
  assertEquals(l.contexto, { dia: "sábado" });
  // sem dia nem atividade na pergunta anterior: segue como antes
  const sem = leitura({ tipo: "so_unidade", unidade_citada: "Cuca Pici", escopo: "Cuca Pici" });
  assertEquals(completarSoUnidadeComPedidoAnterior(sem, "quais cursos tem?", ITENS), sem);
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
async function rodar(atual: string, metadata: Record<string, unknown>, leituraModelo: Record<string, unknown>, anteriores: Msg[] = INICIO) {
  const agora = Date.now();
  const msgs = [
    ...anteriores,
    { conteudo: atual, remetente: "lead", minutos: 0 },
  ].map((m) => ({ conteudo: m.conteudo, remetente: m.remetente, created_at: new Date(agora - m.minutos * 60000 - 1000).toISOString() })).reverse();
  const dados: Record<string, unknown> = {
    "rpc:get_openai_key": "chave-falsa",
    "rpc:buscar_chunks_similares": [],
    leads: { id: "lead-1", nome: "Fulano", opt_in: true, bloqueado: false },
    conversas: { id: "conv-1", status: "ativa", metadata, lead_id: "lead-1" },
    mensagens: msgs,
    prompts_agentes: { prompt_sistema: "sistema", prompt_contexto: "", temperatura: 0.7, max_tokens: 500, menu_boas_vindas: null },
    configuracoes: { valor: { empregabilidade: "5585999401057", acesso_cuca: null } },
    unidades_cuca: [],
    // Toda leitura de documentos_rag devolve a programação (a base institucional e os avisos ficam vazios).
    documentos_rag: Object.entries(PROGRAMACAO).map(([u, c], i) => ({ unidade_cuca: u, conteudo: c, created_at: "2026-11-02T13:42:5" + i + "Z" })),
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
      if (corpo.includes(MARCADOR_LEITURA_TURNO)) return Promise.resolve(respostaOpenAI(JSON.stringify(leituraModelo)));
      prompts.push(corpo);
      return Promise.resolve(respostaOpenAI("Resposta do modelo."));
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
    await resp.json();
    await new Promise((r) => setTimeout(r, 20));
    return { prompts, chamadas };
  } finally {
    globalThis.fetch = fetchOriginal;
    console.log = logOriginal;
    console.error = errOriginal;
  }
}

// A leitura que o modelo deu em 15/11: "sábados" em termos_busca, sem dia no contexto.
const LEITURA_15_11 = { tipo: "pedido_novo", assunto: "programacao", escopo: "nao_disse", area: "CURSOS", termos_busca: ["sábados"], contexto: {} };

Deno.test("AC2 (handler): José Walter salvo + 'cursos aos sábados' → bloco e instrução de P1/P2 no prompt", async () => {
  const { prompts, chamadas } = await rodar("Quais são os cursos que tem aos sábados?", { unidade_selecionada: "Cuca José Walter", conversa_engajada: true }, LEITURA_15_11);
  assertEquals(prompts.length, 1);
  // o dia não vai para o contexto da sessão (vale só neste turno)
  const patches = chamadas.filter((c) => c.tabela === "rpc:merge_conversa_metadata").map((c) => (c.arg as { p_patch: Record<string, unknown> }).p_patch);
  assert(patches.length > 0);
  assert(patches.every((m) => !(m.prog_contexto as Record<string, unknown> | undefined)?.dia), "prog_contexto gravado sem dia");
  const p = JSON.parse(prompts[0]).messages.map((m: { content: string }) => m.content).join("\n");
  assertStringIncludes(p, "--- PROGRAMACAO VIGENTE (programacao mensal ativa, filtrada pela pergunta e pelo contexto: dia: sábado) ---");
  assertStringIncludes(p, "No Cuca José Walter NAO ha Cursos e Oficinas no sábado");
  assertStringIncludes(p, "Tech Start");
  assertStringIncludes(p, "COMUNIDADE EM PAUTA: Aulão de Capoeira");
  assertStringIncludes(p, "O Cuca José Walter nao tem Cursos e Oficinas no sábado na programacao deste mes");
  assertStringIncludes(p, "NUNCA diga que a rede nao tem Cursos e Oficinas no sábado");
  assert(!p.includes("em nenhuma unidade na programacao deste mes (a busca foi feita em todas as unidades)"), "não pode cair na instrução de 'nenhuma'");
});

Deno.test("AC4 (handler): rede salva + 'e aos sábados que curso tem pra fazer?' → lista da rede, sem 'nenhuma'", async () => {
  const { prompts } = await rodar("e aos sábados que curso tem pra fazer?", { prog_escopo: ESCOLHA_REDE, conversa_engajada: true }, LEITURA_15_11);
  assertEquals(prompts.length, 1);
  const p = JSON.parse(prompts[0]).messages.map((m: { content: string }) => m.content).join("\n");
  assertStringIncludes(p, "Cursos e Oficinas no sábado, por unidade:");
  assertStringIncludes(p, "Cuca Mondubim:");
  assertStringIncludes(p, "dizendo em quais unidades tem Cursos e Oficinas no sábado");
  assert(!p.includes("a busca foi feita em todas as unidades"));
});

Deno.test("Handler: o dia não é herdado da sessão (prog_contexto com dia não filtra o turno seguinte)", async () => {
  const { prompts } = await rodar("quais cursos tem?", { unidade_selecionada: "Cuca José Walter", conversa_engajada: true, prog_contexto: { dia: "sábado" } }, { tipo: "pedido_novo", assunto: "programacao", escopo: "nao_disse", area: "CURSOS", contexto: {} });
  assertEquals(prompts.length, 1);
  const p = JSON.parse(prompts[0]).messages.map((m: { content: string }) => m.content).join("\n");
  assert(!p.includes("no sábado"), "sem filtro de sábado");
  assertStringIncludes(p, "A voz como");
});

const textoDoPrompt = (prompts: string[]) => JSON.parse(prompts[0]).messages.map((m: { content: string }) => m.content).join("\n");

Deno.test("Handler (15/11 com o turno herdado): prog_contexto 'turno: noite' + cursos aos sábados → mostra o que tem no sábado, sem 'nenhuma'", async () => {
  const { prompts } = await rodar("Quais são os cursos que tem aos sábados?", { unidade_selecionada: "Cuca Jangurussu", conversa_engajada: true, prog_contexto: { turno: "noite" } }, LEITURA_15_11);
  assertEquals(prompts.length, 1);
  const p = textoDoPrompt(prompts);
  assertStringIncludes(p, "Tem Cursos e Oficinas no sábado, mas NAO para o contexto informado (turno: noite)");
  assertStringIncludes(p, "nada para o contexto da conversa (turno: noite)");
  assertStringIncludes(p, "NUNCA diga que nao tem Cursos e Oficinas no sábado");
  assert(!p.includes("a busca foi feita em todas as unidades"));
});

Deno.test("Handler (2 turnos de P1): depois de 'não tem no JW; tem no Mondubim e no Pici', 'Pici' → cursos aos sábados no Pici", async () => {
  const anteriores: Msg[] = [
    { conteudo: "Quais são os cursos que tem aos sábados?", remetente: "lead", minutos: 2 },
    { conteudo: "No Cuca José Walter não tem curso no sábado. Tem nestas unidades:\n1️⃣ Cuca Mondubim\n2️⃣ Cuca Pici\nQuer saber de alguma?", remetente: "agente", minutos: 1 },
  ];
  const { prompts } = await rodar("Pici", { unidade_selecionada: "Cuca José Walter", conversa_engajada: true }, { tipo: "so_unidade", assunto: "programacao", unidade_citada: "Cuca Pici", escopo: "Cuca Pici", contexto: {} }, anteriores);
  assertEquals(prompts.length, 1);
  const p = textoDoPrompt(prompts);
  assertStringIncludes(p, "Cursos e Oficinas no sábado no Cuca Pici:");
  assertStringIncludes(p, "Tech Start");
});
