// S-INST-QUAL-01 — correções rápidas de conteúdo e regra do Institucional.
// Cobre os critérios testáveis no código: AC4 (pedido de pessoa/setor), AC8 (Emprega+),
// AC9 (frases reais do Portal), AC10 (Acesso CUCA com os telefones das unidades) e as regras
// novas do prompt (A3, A6, A7, A9), que só valem para Institucional/maria.
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classificarPerguntaEmprego,
  decidirEmprego,
  MARCADOR_CLASSIFICADOR_EMPREGO,
  montarPromptClassificadorEmprego,
  trocarUltimaMensagemDoLead,
  validarClassificacaoEmpregoModelo,
  conversaEmContextoDeProgramacao,
  deveAcionarHandoverInstitucional,
  handler,
  INSTRUCAO_INSTITUCIONAL,
  INSTRUCAO_SEGURANCA,
  montarMensagemAcessoCucaPelaUnidade,
  montarMensagemEncaminhamento,
  PERGUNTA_VAGA_AMBIGUA,
  restoDaMensagemSemEmprego,
} from "./index.ts";

const NUMERO_EMPREGA = "5585999401057";
const EMPREGA = montarMensagemEncaminhamento("empregabilidade", NUMERO_EMPREGA);

const TELEFONES_UNIDADES = [
  { nome: "CUCA Mondubim", telefone: "(85) 99796-0300" },
  { nome: "CUCA Jangurussu", telefone: "(85) 99796-0190" },
  { nome: "CUCA José Walter", telefone: "(85) 99796-0198" },
  { nome: "CUCA Pici", telefone: "(85) 99796-0354" },
  { nome: "CUCA Barra", telefone: "(85) 99796-0256" },
];

// ── AC4: pedido de pessoa ou setor vai para o atendente ────────────────────────────────────
Deno.test("AC4: pedido de gerente, setor ou coordenação aciona o transbordo", () => {
  for (const frase of [
    "quero falar com o gerente do cuca barra",
    "preciso falar com alguém do setor de matrícula",
    "me passa pra coordenação",
    "Quero falar com a diretora",
    "pode chamar um funcionário?",
  ]) {
    assertEquals(deveAcionarHandoverInstitucional(frase, "Institucional"), true, frase);
  }
});

Deno.test("AC4: negação, pergunta sobre setor e nome da unidade sozinho NÃO acionam", () => {
  for (const frase of [
    "não quero falar com o gerente",
    "o setor de esportes tem natação?",
    "Cuca Barra",
    "posso falar com meu responsável e volto depois?",
    "a matrícula precisa do responsável?",
    "quero me matricular no judô mas não consigo de manhã, tem à noite?",
    "posso chamar alguém pra fazer o curso comigo?",
    "posso chamar uma equipe pra jogar na quadra?",
  ]) {
    assertEquals(deveAcionarHandoverInstitucional(frase, "Institucional"), false, frase);
  }
});

Deno.test("AC4: outros agentes continuam fora (sofia não transborda por regex)", () => {
  assertEquals(deveAcionarHandoverInstitucional("quero falar com o gerente", "sofia"), false);
});

// ── AC9: as duas frases reais de outubro sobre o Portal da Juventude ───────────────────────
Deno.test("AC9: frases reais de 01/10 sobre atualizar o cadastro no Portal acionam o transbordo", () => {
  for (const frase of [
    "Estou pelo portal da juventude tentando me inscrever em cursos, mas não consigo pois diz que preciso atualizar meu cadastro. Como faço?",
    "Boa tarde!\nTo tentando me inscrever nos cursos pelo portal da juventude mas nao consigo pq diz q preciso atualizar meu cadastro. Mas como faço isso.",
  ]) {
    assertEquals(deveAcionarHandoverInstitucional(frase, "Institucional"), true, frase);
  }
});

// ── AC8: Emprega+ (funções puras) ──────────────────────────────────────────────────────────
Deno.test("AC8 camada 1: termos claros de emprego", () => {
  for (const frase of [
    "Emprego", "Jovem aprendiz", "Vagas de emprego", "Cadastrar currículo", "oi, quero trabalhar", "tem estágio?", "Oi, trabalho",
    // achado 1 do @qa: citar só onde quer trabalhar não é outra pergunta
    "tem vagas de emprego no cuca Pici?", "Quero trabalhar no CUCA", "vaga de emprego na unidade do Mondubim",
    "Está tendo vaga para jovem aprendiz no cuca barra?", "Como posso trabalhar/estagiar na Rede Cuca?",
  ]) {
    assertEquals(classificarPerguntaEmprego(frase, "Institucional", false), "emprego", frase);
  }
});

Deno.test("AC8 camada 1: caso misto pede a outra parte ao fluxo normal", () => {
  assertEquals(classificarPerguntaEmprego("curso de informática e vaga de emprego", "Institucional", false), "emprego_misto");
  assertEquals(restoDaMensagemSemEmprego("curso de informática e vaga de emprego"), ["curso", "informatica"]);
});

Deno.test("AC8 camada 1: 'trabalho' sem intenção, negação e outros agentes não disparam", () => {
  assertEquals(classificarPerguntaEmprego("eu trabalho de dia, tem curso à noite?", "Institucional", false), null);
  assertEquals(classificarPerguntaEmprego("não quero emprego, quero natação", "Institucional", false), null);
  assertEquals(classificarPerguntaEmprego("Emprego", "sofia", false), null);
  assertEquals(classificarPerguntaEmprego("Emprego", "Empregabilidade", false), null);
  // conferidos em mensagens reais (set-nov/2026)
  assertEquals(classificarPerguntaEmprego("Quero verificar se ainda tem vaga em Informática Básica para Iniciantes e Currículo na Prática", "Institucional", false), null);
  assertEquals(classificarPerguntaEmprego("preciso pra botar no currículo dele", "Institucional", false), null);
  assertEquals(classificarPerguntaEmprego("Nao queria saber sobre as vagas", "Institucional", false), null);
  assertEquals(classificarPerguntaEmprego("Boa noite! Vocês têm vaga para estagiários?", "Institucional", false), "emprego");
});

Deno.test("AC8 camada 2: 'tem vagas?' sem contexto pergunta; com programação em andamento segue o fluxo", () => {
  assertEquals(classificarPerguntaEmprego("tem vagas?", "Institucional", false), "vagas_ambiguo");
  assertEquals(classificarPerguntaEmprego("tem vagas?", "Institucional", true), null);
  // atividade no texto: é vaga de curso
  assertEquals(classificarPerguntaEmprego("tem vagas de natação?", "Institucional", false), null);
  // unidade citada também é sinal de vaga de curso (a lista de "onde trabalhar" é só da camada 1)
  assertEquals(classificarPerguntaEmprego("No Jangurussu tem vaga para 30+?", "Institucional", false), null);
  assertEquals(classificarPerguntaEmprego("Tem vaga no cuca do Jangurussu", "Institucional", false), null);
});

Deno.test("AC8 camada 2: sinais de conversa de programação", () => {
  assertEquals(conversaEmContextoDeProgramacao({}, ""), false);
  assertEquals(conversaEmContextoDeProgramacao({ unidade_selecionada: "Cuca Pici" }, ""), true);
  assertEquals(conversaEmContextoDeProgramacao({}, "✅ Natação — 15 a 29 anos | Ter e Qui, 18h"), true);
  assertEquals(conversaEmContextoDeProgramacao({}, "Oi! Sou a Maria 😊 Me conta, de qual unidade você quer saber?"), false);
  assertEquals(conversaEmContextoDeProgramacao({}, "Para se inscrever nas atividades do CUCA, você pode fazer a matrícula pelo Portal"), true);
  // disparo em massa não fica em `mensagens`: o aviso recente conta como contexto; o antigo, não
  const agora = Date.now();
  assertEquals(conversaEmContextoDeProgramacao({ ultimo_disparo: { titulo: "Programação de Novembro", enviado_em: new Date(agora - 3 * 3600_000).toISOString() } }, ""), true);
  assertEquals(conversaEmContextoDeProgramacao({ ultimo_disparo: { titulo: "Programação de Outubro", enviado_em: new Date(agora - 30 * 86400_000).toISOString() } }, ""), false);
});

// ── AC10: Acesso CUCA manda falar com a unidade ────────────────────────────────────────────
// ── AC8: classificador de emprego pelo modelo (decisão do Junior, 03/11) ──────────────────
Deno.test("AC8 classificador: o código junta as 3 respostas do modelo e cai na reserva quando vem fora do formato", () => {
  const v = validarClassificacaoEmpregoModelo;
  assertEquals(v({ fala_de_emprego: true, vaga_sem_tipo: false, outra_pergunta: null }, false), { classificacao: "emprego", outraPergunta: null });
  assertEquals(v({ fala_de_emprego: true, vaga_sem_tipo: false, outra_pergunta: " tem judô? " }, false, "quero emprego e tem judô?"), { classificacao: "emprego_misto", outraPergunta: "tem judô?" });
  // trava do misto: "outra pergunta" que ainda é emprego, ou é a mensagem inteira, vira só emprego
  for (const [outra, texto] of [
    ["o que é o cuca emprega+?", "o que é o cuca emprega+ ?"],
    ["tem vagas de emprego no cuca Pici?", "Olá boa tarde, tem vagas de emprego no cuca Pici?"],
    ["como funciona essa parte de empregabilidade?", "Como funciona essa parte de empregabilidade?"],
    ["saber sobre vagas disponíveis", "Gostaria de deixar meu currículo, e saber sobre vagas disponíveis"],
  ]) {
    assertEquals(v({ fala_de_emprego: true, vaga_sem_tipo: false, outra_pergunta: outra }, false, texto)?.classificacao, "emprego", outra);
  }
  assertEquals(v({ fala_de_emprego: true, vaga_sem_tipo: false, outra_pergunta: "quais cursos tem no cuca do Pici?" }, false, "Gostaria de saber sobre os cursos e vaga de emprego aqui no cuca Do pici")?.classificacao, "emprego_misto");
  assertEquals(v({ fala_de_emprego: true, vaga_sem_tipo: false, outra_pergunta: "" }, true), { classificacao: "emprego", outraPergunta: null }, "emprego vale mesmo com programação em andamento");
  assertEquals(v({ fala_de_emprego: true, vaga_sem_tipo: true, outra_pergunta: null }, false), { classificacao: "emprego", outraPergunta: null }, "emprego vence vaga sem tipo");
  assertEquals(v({ fala_de_emprego: false, vaga_sem_tipo: true, outra_pergunta: null }, false, "tem vagas?"), { classificacao: "vagas_ambiguo", outraPergunta: null });
  assertEquals(v({ fala_de_emprego: false, vaga_sem_tipo: true, outra_pergunta: null }, true, "tem vagas?"), { classificacao: null, outraPergunta: null }, "com programação em andamento, vaga é de curso");
  assertEquals(v({ fala_de_emprego: false, vaga_sem_tipo: true, outra_pergunta: null }, false, "tem"), { classificacao: null, outraPergunta: null }, "sem a palavra vaga, não pergunta emprego ou curso");
  assertEquals(v({ fala_de_emprego: false, vaga_sem_tipo: false, outra_pergunta: "tem judô?" }, false), { classificacao: null, outraPergunta: null }, "outra pergunta sem emprego é ignorada");
  assertEquals(v({ fala_de_emprego: "sim", vaga_sem_tipo: false }, false), null);
  assertEquals(v({ fala_de_emprego: true }, false), null);
  assertEquals(v({ assunto: "emprego" }, false), null);
  assertEquals(v(null, false), null);
  assertEquals(v("emprego", false), null);
  assertEquals(v({ fala_de_emprego: true, vaga_sem_tipo: false, outra_pergunta: "x".repeat(2000) }, false)?.outraPergunta?.length, 400);
});

Deno.test("AC8 classificador: decidirEmprego usa o modelo e só recorre à lista quando ele falha", async () => {
  let chamou = 0;
  const modelo = (r: ReturnType<typeof validarClassificacaoEmpregoModelo>) => () => { chamou++; return Promise.resolve(r); };
  assertEquals(await decidirEmprego("tô procurando um trampo", "Institucional", false, modelo({ classificacao: "emprego", outraPergunta: null })), { classificacao: "emprego", outraPergunta: null, fonte: "modelo" });
  assertEquals(await decidirEmprego("Jovem aprendiz", "Institucional", false, modelo(null)), { classificacao: "emprego", outraPergunta: null, fonte: "lista" });
  assertEquals(await decidirEmprego("tem oficina de currículo?", "maria", false, modelo({ classificacao: null, outraPergunta: null })), { classificacao: null, outraPergunta: null, fonte: "modelo" });
  chamou = 0;
  assertEquals((await decidirEmprego("2", "Institucional", false, modelo(null))).fonte, "sem_chamada");
  assertEquals((await decidirEmprego("👍", "Institucional", false, modelo(null))).fonte, "sem_chamada");
  assertEquals((await decidirEmprego("quero emprego", "sofia", false, modelo(null))).fonte, "sem_chamada");
  assertEquals(chamou, 0, "dígito, emoji e outros agentes não chamam o modelo");
});

Deno.test("AC8 classificador: o prompt leva as decisões do Junior (ponto 3) e o contexto da conversa", () => {
  const p = montarPromptClassificadorEmprego("tem vagas?", [{ role: "user", content: "oi" }, { role: "assistant", content: "Em que posso te ajudar?" }, { role: "user", content: "tem vagas?" }]);
  assertStringIncludes(p, MARCADOR_CLASSIFICADOR_EMPREGO);
  assertStringIncludes(p, "trabalhar na própria Rede CUCA");
  assertStringIncludes(p, "empresa que quer divulgar vaga");
  assertStringIncludes(p, "Jovens Monitores, inclusive seleção ou edital de monitores");
  assertStringIncludes(p, "\"serviço\" no sentido de atendimento");
  assertStringIncludes(p, "mensagem sem conteúdo próprio");
  assertStringIncludes(p, "Maria: Em que posso te ajudar?");
  assertStringIncludes(p, "MENSAGEM ATUAL do lead: tem vagas?");
});

Deno.test("AC8 classificador: caso misto troca só a última mensagem do lead, e só se for a mesma", () => {
  const hist = [{ role: "user", content: "oi" }, { role: "assistant", content: "Olá!" }, { role: "user", content: "curso de judô e emprego" }];
  assertEquals(trocarUltimaMensagemDoLead(hist, "curso de judô e emprego", "tem judô?").at(-1), { role: "user", content: "tem judô?" });
  assertEquals(trocarUltimaMensagemDoLead(hist, "curso de judô e emprego", "tem judô?")[0], hist[0]);
  assertEquals(hist[2].content, "curso de judô e emprego", "não altera o original");
  assertEquals(trocarUltimaMensagemDoLead(hist, "outra coisa", "x"), hist, "mensagem diferente: não mexe");
  assertEquals(trocarUltimaMensagemDoLead([], "a", "b"), []);
});

Deno.test("AC10: Acesso CUCA sem número traz os 5 telefones de unidades_cuca, na ordem do bot", () => {
  const msg = montarMensagemEncaminhamento("acesso_cuca", null, TELEFONES_UNIDADES);
  assertStringIncludes(msg, "falar direto com a unidade, por telefone ou pessoalmente");
  assertStringIncludes(msg, "📞 Cuca Barra: (85) 99796-0256\n📞 Cuca Jangurussu: (85) 99796-0190\n📞 Cuca Mondubim: (85) 99796-0300\n📞 Cuca Pici: (85) 99796-0354\n📞 Cuca José Walter: (85) 99796-0198");
  assertEquals(msg.includes("em breve te passo o contato"), false);
  assertEquals(msg.includes("wa.me"), false);
});

Deno.test("AC10: sem telefones (leitura falhou) continua mandando falar com a unidade, sem promessa", () => {
  const msg = montarMensagemAcessoCucaPelaUnidade([]);
  assertStringIncludes(msg, "falar direto com a unidade");
  assertEquals(msg.includes("em breve te passo o contato"), false);
});

Deno.test("AC10: ouvidoria e academia_enem sem número não mudam", () => {
  assertStringIncludes(montarMensagemEncaminhamento("ouvidoria", null, TELEFONES_UNIDADES), "em breve te passo o contato");
  assertStringIncludes(montarMensagemEncaminhamento("academia_enem", null, TELEFONES_UNIDADES), "em breve te passo o contato");
});

// ── A3/A6/A7/A9: texto das regras ──────────────────────────────────────────────────────────
Deno.test("A3: regra 1 cita os blocos de programação atuais e os institucionais", () => {
  for (const trecho of ["programacao vigente da rede", "atividade especifica com dado exato", "eventos e faq", "bloco de servicos da rede", "endereco, telefone, matricula"]) {
    assertStringIncludes(INSTRUCAO_SEGURANCA, trecho);
  }
});

Deno.test("A9/A6/A7: regras do Institucional (sem resposta → atendente; telefone; ligar antes)", () => {
  assertStringIncludes(INSTRUCAO_INSTITUCIONAL, "SEM RESPOSTA NA BASE");
  assertStringIncludes(INSTRUCAO_INSTITUCIONAL, "[[HANDOVER]]");
  assertStringIncludes(INSTRUCAO_INSTITUCIONAL, "'nao tem natacao no Pici em novembro'");
  assertStringIncludes(INSTRUCAO_INSTITUCIONAL, "TELEFONE DA UNIDADE");
  assertStringIncludes(INSTRUCAO_INSTITUCIONAL, "ligar antes para confirmar se ainda ha vaga");
  assertStringIncludes(INSTRUCAO_INSTITUCIONAL, "NUNCA afirme que ha vaga");
});

// ── Handler: mock encadeável (qualquer método devolve a cadeia; o await devolve o dado da tabela)
type Chamada = { tabela: string; metodo: string; arg?: unknown };

// deno-lint-ignore no-explicit-any
function supabaseMock(dados: Record<string, unknown>, chamadas: Chamada[]): any {
  function cadeia(tabela: string) {
    // deno-lint-ignore no-explicit-any
    const alvo: any = {};
    // deno-lint-ignore no-explicit-any
    const proxy: any = new Proxy(alvo, {
      get(_t, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => unknown) => resolve({ data: dados[tabela] ?? null, error: null });
        }
        return (arg?: unknown) => { chamadas.push({ tabela, metodo: String(prop), arg }); return proxy; };
      },
    });
    return proxy;
  }
  return {
    from: (t: string) => cadeia(t),
    rpc: (nome: string) => ({ then: (resolve: (v: unknown) => unknown) => resolve({ data: dados["rpc:" + nome] ?? null, error: null }) }),
  };
}

function dadosBase(metadata: Record<string, unknown>, historico: { conteudo: string; remetente: string }[] = []): Record<string, unknown> {
  return {
    "rpc:get_openai_key": "chave-falsa",
    "rpc:buscar_chunks_similares": [],
    leads: { id: "lead-1", nome: "Fulano", opt_in: true, bloqueado: false },
    conversas: { id: "conv-1", status: "ativa", metadata, lead_id: "lead-1" },
    // o handler lê o histórico em ordem decrescente
    mensagens: [...historico].reverse(),
    prompts_agentes: { prompt_sistema: "sistema", prompt_contexto: "", temperatura: 0.7, max_tokens: 500, menu_boas_vindas: null },
    configuracoes: { valor: { empregabilidade: NUMERO_EMPREGA, acesso_cuca: null } },
    unidades_cuca: TELEFONES_UNIDADES,
    documentos_rag: null,
  };
}

/** Resposta do classificador de emprego no teste: o JSON que o modelo devolveria, ou uma falha
 * ("http" = erro 500, "rede" = fetch lança, "lixo" = texto fora do formato). */
type RespostaClassificador = Record<string, unknown> | "http" | "rede" | "lixo";
const OUTRO: RespostaClassificador = { fala_de_emprego: false, vaga_sem_tipo: false, outra_pergunta: null };
const SO_EMPREGO: RespostaClassificador = { fala_de_emprego: true, vaga_sem_tipo: false, outra_pergunta: null };
const MISTO_INFO: RespostaClassificador = { fala_de_emprego: true, vaga_sem_tipo: false, outra_pergunta: "tem curso de informática?" };
const VAGA_SEM_TIPO: RespostaClassificador = { fala_de_emprego: false, vaga_sem_tipo: true, outra_pergunta: null };

async function rodar(
  mensagem: string,
  dados: Record<string, unknown>,
  respostaGpt = "Resposta do modelo.",
  agente_tipo = "Institucional",
  classificador: RespostaClassificador = OUTRO,
): Promise<{ corpo: { resposta: string; mensagens: string[]; handover: boolean }; chamadas: Chamada[]; prompts: string[]; classificacoes: string[] }> {
  const chamadas: Chamada[] = [];
  const prompts: string[] = [];
  const classificacoes: string[] = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const u = String(url instanceof Request ? url.url : url);
    if (u.includes("/embeddings")) return Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: [0, 0, 0] }] }), { status: 200 }));
    if (u.includes("/chat/completions") && String(init?.body ?? "").includes(MARCADOR_CLASSIFICADOR_EMPREGO)) {
      classificacoes.push(String(init?.body));
      if (classificador === "http") return Promise.resolve(new Response("erro", { status: 500 }));
      if (classificador === "rede") return Promise.reject(new TypeError("falha de rede"));
      const conteudo = classificador === "lixo" ? "não sei" : JSON.stringify(classificador);
      return Promise.resolve(new Response(JSON.stringify({ id: "cls-1", model: "gpt-4o-mini-2024-07-18", choices: [{ message: { content: conteudo } }], usage: { prompt_tokens: 900, completion_tokens: 15 } }), { status: 200 }));
    }
    if (u.includes("/chat/completions")) {
      if (init?.body) prompts.push(String(init.body));
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: respostaGpt } }] }), { status: 200 }));
    }
    throw new Error("fetch não mockado: " + u);
  }) as typeof fetch;
  const logOriginal = console.log;
  console.log = () => {};
  try {
    const req = new Request("http://localhost/motor-agente", {
      method: "POST",
      body: JSON.stringify({ mensagem, telefone: "5585999999999", canal_origem: "test", agente_tipo, unidade_cuca: "Geral", conversa_id: "conv-1" }),
    });
    const resp = await handler(req, supabaseMock(dados, chamadas));
    assertEquals(resp.status, 200);
    const corpo = await resp.json();
    await new Promise((r) => setTimeout(r, 20)); // o registro de consumo roda em segundo plano
    return { corpo, chamadas, prompts, classificacoes };
  } finally {
    globalThis.fetch = fetchOriginal;
    console.log = logOriginal;
  }
}

function mensagensGravadas(chamadas: Chamada[]): string[] {
  return chamadas.filter((c) => c.tabela === "mensagens" && c.metodo === "insert").map((c) => (c.arg as { conteudo: string }).conteudo);
}

Deno.test("AC8 (handler): o modelo diz emprego → Emprega+ com o número — conversa engajada, 1ª mensagem e esperando unidade", async () => {
  const estados: [string, Record<string, unknown>][] = [
    ["engajada", { unidade_selecionada: "Cuca Barra", conversa_engajada: true }],
    ["primeira mensagem", {}],
    ["esperando unidade", { aguardando_unidade: true }],
  ];
  for (const frase of ["Emprego", "Jovem aprendiz", "Vagas de emprego", "Cadastrar currículo", "oi, quero trabalhar"]) {
    for (const [nome, metadata] of estados) {
      const { corpo, chamadas, prompts, classificacoes } = await rodar(frase, dadosBase(metadata), undefined, undefined, SO_EMPREGO);
      assertEquals(corpo.mensagens, [EMPREGA], frase + " / " + nome);
      assertStringIncludes(corpo.resposta, "wa.me/" + NUMERO_EMPREGA);
      assertEquals(classificacoes.length, 1, "o modelo classifica: " + frase);
      assertEquals(prompts.length, 0, "não chama o modelo de resposta: " + frase + " / " + nome);
      assertEquals(mensagensGravadas(chamadas), [EMPREGA]);
    }
  }
});

Deno.test("AC8 (handler, achado 2 do @qa): gíria e cargo que a lista não pega vão ao Emprega+ quando o modelo diz emprego", async () => {
  for (const frase of ["tô procurando um trampo", "tão contratando?", "vaga de atendente", "quero mandar meu cv", "a rede cuca está contratando Assistente Social?"]) {
    const reserva = classificarPerguntaEmprego(frase, "Institucional", false);
    assert(reserva !== "emprego", "a lista sozinha não resolvia: " + frase);
    const { corpo, prompts } = await rodar(frase, dadosBase({ unidade_selecionada: "Cuca Barra", conversa_engajada: true }), undefined, undefined, SO_EMPREGO);
    assertEquals(corpo.mensagens, [EMPREGA], frase);
    assertEquals(prompts.length, 0, frase);
  }
});

Deno.test("AC8 (handler): o modelo diz que não é emprego → fluxo normal, mesmo quando a lista diria emprego", async () => {
  const frase = "tem oficina de currículo no Pici?";
  assert(classificarPerguntaEmprego(frase, "Institucional", false) !== null, "a lista mandaria o Emprega+");
  const { corpo, prompts } = await rodar(frase, dadosBase({ unidade_selecionada: "Cuca Pici", conversa_engajada: true }), "Tem a oficina Currículo na Prática!", undefined, OUTRO);
  assertEquals(corpo.mensagens.includes(EMPREGA), false);
  assert(prompts.length > 0, "segue para o modelo de resposta");
});

Deno.test("AC8 (handler): caso misto — o fluxo normal recebe só a outra pergunta, e o Emprega+ vai num balão no fim", async () => {
  const original = "curso de informática e vaga de emprego";
  const { corpo, chamadas, prompts } = await rodar(
    original,
    dadosBase({ unidade_selecionada: "Cuca José Walter", conversa_engajada: true }, [{ conteudo: original, remetente: "lead" }]),
    "No Cuca José Walter tem Informática Básica, Ter e Qui à tarde.",
    undefined,
    MISTO_INFO,
  );
  assertEquals(corpo.mensagens.at(-1), EMPREGA);
  assertStringIncludes(corpo.mensagens[0], "Informática Básica");
  assertEquals(corpo.resposta, corpo.mensagens.join("\n\n"));
  assert(prompts.length > 0);
  for (const p of prompts) {
    assertEquals(p.includes(original), false, "a parte de emprego não chega ao modelo de resposta");
  }
  assert(prompts.some((p) => p.includes("tem curso de informática?")), "a outra pergunta substitui a mensagem do lead");
  assert(prompts.some((p) => p.includes("ja foi respondida pelo sistema com o contato do Emprega+")), "o modelo é avisado");
  assertEquals(mensagensGravadas(chamadas).at(-1), EMPREGA, "o balão é gravado por último no histórico");
  const registro = chamadas.find((c) => c.tabela === "rag_retrieval_logs" && c.metodo === "insert");
  if (registro) assertEquals((registro.arg as { mensagem_lead: string }).mensagem_lead, original, "o registro guarda a mensagem como o lead mandou");
});

Deno.test("AC8 (handler, achado 1 do @qa): emprego citando outra unidade recebe só o Emprega+, sem trocar de unidade", async () => {
  for (const frase of ["tem vagas de emprego no cuca Pici?", "Quero trabalhar no CUCA", "vaga de emprego na unidade do Mondubim"]) {
    const { corpo, chamadas, prompts } = await rodar(frase, dadosBase({ unidade_selecionada: "Cuca Barra", conversa_engajada: true }), undefined, undefined, SO_EMPREGO);
    assertEquals(corpo.mensagens, [EMPREGA], frase);
    assertEquals(prompts.length, 0, "não chama o modelo de resposta: " + frase);
    assertEquals(chamadas.some((c) => c.tabela === "conversas" && c.metodo === "update"), false, "não mexe na conversa: " + frase);
  }
});

Deno.test("AC8 (handler): caso misto em que o modelo só devolve a tag — vira só o Emprega+, sem duplicar", async () => {
  const { corpo } = await rodar(
    "curso de informática e vaga de emprego",
    dadosBase({ unidade_selecionada: "Cuca José Walter", conversa_engajada: true }),
    "[[ENCAMINHAR:empregabilidade]]",
    undefined,
    MISTO_INFO,
  );
  assertEquals(corpo.mensagens.filter((m) => m === EMPREGA).length, 1);
});

Deno.test("AC8 (handler): caso misto numa frase pronta (1ª mensagem) também ganha o balão", async () => {
  const { corpo } = await rodar("curso de informática e vaga de emprego", dadosBase({}), undefined, undefined, MISTO_INFO);
  assert(corpo.mensagens.length >= 2, JSON.stringify(corpo.mensagens));
  assertEquals(corpo.mensagens.at(-1), EMPREGA);
});

Deno.test("AC8 (handler): 'tem vagas?' sem contexto recebe a pergunta emprego ou curso", async () => {
  const { corpo, prompts, classificacoes } = await rodar("tem vagas?", dadosBase({}), undefined, undefined, VAGA_SEM_TIPO);
  assertEquals(corpo.mensagens, [PERGUNTA_VAGA_AMBIGUA]);
  assertEquals(prompts.length, 0);
  assertEquals(classificacoes.length, 1);
});

Deno.test("AC8 (handler): 'tem vagas?' logo depois de uma resposta sobre natação no Pici segue o fluxo de atividade, mesmo se o modelo disser vaga sem tipo", async () => {
  const { corpo, prompts, classificacoes } = await rodar(
    "tem vagas?",
    dadosBase({ unidade_selecionada: "Cuca Pici", conversa_engajada: true }, [
      { conteudo: "tem natação no pici?", remetente: "lead" },
      { conteudo: "Tem sim! ✅ Natação — 15 a 29 anos | Ter e Qui, 18h", remetente: "agente" },
      { conteudo: "tem vagas?", remetente: "lead" },
    ]),
    "A quantidade de vagas muda com frequência. Liga pro Cuca Pici: (85) 99796-0354.",
    undefined,
    VAGA_SEM_TIPO,
  );
  assertEquals(corpo.mensagens.includes(PERGUNTA_VAGA_AMBIGUA), false);
  assertEquals(corpo.mensagens.includes(EMPREGA), false);
  assert(prompts.length > 0, "segue para o modelo");
  assertStringIncludes(classificacoes[0], "Lead: tem natação no pici?");
});

Deno.test("AC8 (handler): modelo indisponível → a lista de palavras decide (reserva)", async () => {
  for (const falha of ["http", "rede", "lixo"] as const) {
    const emprego = await rodar("Jovem aprendiz", dadosBase({ unidade_selecionada: "Cuca Barra", conversa_engajada: true }), undefined, undefined, falha);
    assertEquals(emprego.corpo.mensagens, [EMPREGA], "reserva pega termo claro (" + falha + ")");
    const curso = await rodar("tem natação no pici?", dadosBase({ unidade_selecionada: "Cuca Pici", conversa_engajada: true }), "Tem natação!", undefined, falha);
    assertEquals(curso.corpo.mensagens.includes(EMPREGA), false, "reserva não inventa emprego (" + falha + ")");
    assertEquals(curso.corpo.mensagens, ["Tem natação!"]);
  }
});

Deno.test("AC8 (handler): dígito de menu não chama o classificador; sofia nunca chama", async () => {
  const digito = await rodar("2", dadosBase({ unidade_selecionada: "Cuca Barra", conversa_engajada: true }));
  assertEquals(digito.classificacoes.length, 0);
  const sofia = await rodar("quero um emprego", dadosBase({ conversa_engajada: true }), "Resposta.", "sofia", SO_EMPREGO);
  assertEquals(sofia.classificacoes.length, 0);
  assertEquals(sofia.corpo.resposta.includes("wa.me/" + NUMERO_EMPREGA), false);
});

Deno.test("AC8 (handler): o consumo do classificador fica registrado à parte em ai_usage_logs", async () => {
  const { chamadas } = await rodar("tô procurando um trampo", dadosBase({ unidade_selecionada: "Cuca Barra", conversa_engajada: true }), undefined, undefined, SO_EMPREGO);
  const uso = chamadas.filter((c) => c.tabela === "ai_usage_logs" && c.metodo === "insert").map((c) => c.arg as Record<string, unknown>);
  assertEquals(uso.length, 1);
  assertEquals(uso[0].feature, "classificador_emprego");
  assertEquals(uso[0].tokens_prompt, 900);
  assertEquals(uso[0].conversa_id, "conv-1");
});

Deno.test("AC10 (handler): [[ENCAMINHAR:acesso_cuca]] devolve o texto novo com os 5 telefones", async () => {
  const { corpo } = await rodar("quero reservar a quadra", dadosBase({ unidade_selecionada: "Cuca Barra", conversa_engajada: true }), "[[ENCAMINHAR:acesso_cuca]]");
  assertEquals(corpo.resposta.includes("em breve te passo o contato"), false);
  for (const u of TELEFONES_UNIDADES) assertStringIncludes(corpo.resposta, u.telefone!);
});

Deno.test("A6/A7/A9 (handler): as regras do Institucional vão no prompt só de Institucional/maria", async () => {
  const inst = await rodar("qual o endereço?", dadosBase({ unidade_selecionada: "Cuca Barra", conversa_engajada: true }));
  assert(inst.prompts.some((p) => p.includes("SEM RESPOSTA NA BASE")), "Institucional recebe as regras");
  const sofia = await rodar("quero fazer uma reclamação", dadosBase({ conversa_engajada: true }), "Resposta.", "sofia");
  assert(sofia.prompts.length > 0);
  assertEquals(sofia.classificacoes.length, 0, "sofia não passa pelo classificador de emprego");
  assertEquals(sofia.prompts.some((p) => p.includes("SEM RESPOSTA NA BASE")), false, "sofia não recebe");
});
