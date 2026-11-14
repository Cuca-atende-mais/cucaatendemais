// S-INST-QUAL-05 — rajada inteira em toda a rota e fim do "Em que mais posso te ajudar?" indevido.
// Cobre AC1 (rajada resolve unidade + pedido; duas unidades → menu), AC2 (sem frase pronta fora de
// cortesia; Emprega+ pela rajada), AC5 (chave ROTA_USA_RAJADA=false volta ao comportamento de antes)
// e as regras de apoio (cortesia por mensagem, não repetir a frase pronta, transbordo pela rajada).
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  anterioresDaRajada,
  decidirAguardandoUnidade,
  decidirConversaEngajada,
  decidirPrimeiraMensagem,
  deveAcionarHandoverNaRajada,
  ehCortesiaPura,
  handler,
  historicoAntesDaRajada,
  JANELA_RAJADA_MS,
  MARCADOR_CLASSIFICADOR_EMPREGO,
  MENU_UNIDADES,
  mensagensDaRajada,
  montarMensagemEncaminhamento,
  rajadaEhCortesiaPura,
  rajadaTemPedido,
  rotaUsaRajada,
  textoRajada,
  trocarRajadaNoHistorico,
  ultimaRespostaFoiFrasePronta,
  unidadesCitadas,
} from "./index.ts";

const FRASE_PRONTA = "Em que mais posso te ajudar? 😊";
const AVALIACAO_VAZIA = { unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false };
const NUMERO_EMPREGA = "5585999401057";
const EMPREGA = montarMensagemEncaminhamento("empregabilidade", NUMERO_EMPREGA);

/** Roda `fn` com a chave desligada e devolve o ambiente como estava. */
async function comChaveDesligada<T>(fn: () => Promise<T> | T): Promise<T> {
  const antes = Deno.env.get("ROTA_USA_RAJADA");
  Deno.env.set("ROTA_USA_RAJADA", "false");
  try {
    return await fn();
  } finally {
    if (antes === undefined) Deno.env.delete("ROTA_USA_RAJADA");
    else Deno.env.set("ROTA_USA_RAJADA", antes);
  }
}

const u = (content: string, minutosAntes = 0) => ({ role: "user", content, created_at: new Date(Date.UTC(2026, 10, 13, 15, 0, 0) - minutosAntes * 60000).toISOString() });
const a = (content: string, minutosAntes = 0) => ({ role: "assistant", content, created_at: new Date(Date.UTC(2026, 10, 13, 15, 0, 0) - minutosAntes * 60000).toISOString() });

// ── Funções puras ──────────────────────────────────────────────────────────────────────────
Deno.test("textoRajada: junta as mensagens do cidadão depois da última resposta do bot e termina na atual", () => {
  const historico = [u("Oi", 5), a("Olá! Em que posso te ajudar? 😊", 4), u("Queria natação na Barra", 0.2), u("Oi boa tarde", 0)];
  assertEquals(textoRajada(historico, "Oi boa tarde"), "Queria natação na Barra\nOi boa tarde");
  // a mensagem atual não está no histórico (caller que não grava antes): só acrescenta
  assertEquals(textoRajada(historico.slice(0, 3), "Oi boa tarde"), "Queria natação na Barra\nOi boa tarde");
  // sem mensagem anterior na rajada: é a própria mensagem
  assertEquals(textoRajada([u("Oi", 5), a("Olá!", 4), u("tem judô?", 0)], "tem judô?"), "tem judô?");
  // o que veio antes da resposta do bot não entra (assunto já respondido)
  assertEquals(anterioresDaRajada(historico, "Oi boa tarde"), ["Queria natação na Barra"]);
});

Deno.test("textoRajada: a mensagem atual sai pelo texto cru (emoji) ou normalizado, e o caso misto troca a rajada inteira", () => {
  const historico = [a("Sobre qual unidade?", 1), u("Barra", 0.1), u("6️⃣", 0)];
  assertEquals(textoRajada(historico, "6", "6️⃣"), "Barra\n6");
  assertEquals(textoRajada(historico, "6"), "Barra\n6");
  const trocado = trocarRajadaNoHistorico([a("Olá", 2), u("quero emprego", 0.1), u("e tem judô?", 0)], "tem judô?");
  assertEquals(trocado.map((m) => m.content), ["Olá", "tem judô?"]);
  assertEquals(historicoAntesDaRajada([u("oi", 3), a("Olá", 2), u("x", 0.1), u("y", 0)]).map((m) => m.content), ["oi", "Olá"]);
});

Deno.test("textoRajada: mensagem mais antiga que a janela não entra (sem resposta do bot por demora, não é rajada)", () => {
  const historico = [a("Vou te encaminhar para um atendente humano, só um momento!", 300), u("quero falar com atendente", 200), u("alguém?", 30), u("oi", 0)];
  assertEquals(mensagensDaRajada(historico), ["oi"]);
  assertEquals(textoRajada(historico, "oi"), "oi");
  assert(JANELA_RAJADA_MS >= 5 * 60000);
});

Deno.test("textoRajada: marcador de mídia sem texto fica fora ('Boa tarde' + imagem sem legenda, rajada real de 12/11)", () => {
  const historico = [u("Boa tarde", 0.2), u("[Imagem enviada sem legenda]", 0.1), u("oi", 0)];
  assertEquals(mensagensDaRajada(historico), ["Boa tarde", "oi"]);
  assertEquals(rajadaEhCortesiaPura(mensagensDaRajada(historico)), true);
});

Deno.test("ehCortesiaPura: só pontuação deixou de ser cortesia; emoji continua", () => {
  for (const f of ["?", "??", "…", ".", "+", "!*"]) assertEquals(ehCortesiaPura(f), false, f);
  for (const f of ["👍", "🙏🏻", "", "tudo bem com você?", "Oii bom dia", "Boa noite 🌙"]) assertEquals(ehCortesiaPura(f), true, f);
});

Deno.test("rajadaEhCortesiaPura: avalia mensagem por mensagem (rajadas reais de 05 a 13/11)", () => {
  for (const r of [["Oi", "Boa tarde"], ["Boa tarde", "Tudo bem?"], ["Olá bom dia", "tudo bem com você?"], ["Bom dia", "Bom dia"], ["Opa", "Bom dia"], ["Boa", "Noite"], ["Oi", "Bom dia", "tudo bem?"]]) {
    assertEquals(rajadaEhCortesiaPura(r), true, r.join(" | "));
  }
  for (const r of [["Quais os cursos tem", "Boa tarde"], ["Bom dia", "Como faço pra corrigir meu email no portal"], ["Gostaria de saber sobre as próximas seletivas de Handebol", "Quando aconteceram", "?"], ["Boa tarde", "?"]]) {
    assertEquals(rajadaEhCortesiaPura(r), false, r.join(" | "));
  }
});

Deno.test("deveAcionarHandoverNaRajada: pedido em qualquer mensagem ou dividido; negação na rajada cancela", () => {
  assertEquals(deveAcionarHandoverNaRajada(["quero falar com um atendente", "oi"], "Institucional"), true);
  assertEquals(deveAcionarHandoverNaRajada(["não consigo", "acessar minha conta do portal"], "Institucional"), true);
  assertEquals(deveAcionarHandoverNaRajada(["quero falar com atendente", "não, não preciso de atendente, já resolvi"], "Institucional"), false);
  assertEquals(deveAcionarHandoverNaRajada(["oi", "tem natação na Barra?"], "Institucional"), false);
  assertEquals(deveAcionarHandoverNaRajada(["quero falar com um atendente"], "sofia"), false);
});

Deno.test("unidadesCitadas: nomes exatos, sem repetir, sem tolerância a erro de digitação", () => {
  assertEquals(unidadesCitadas("Barra\nPici"), ["Cuca Barra", "Cuca Pici"]);
  assertEquals(unidadesCitadas("Cuca José Walter\nno walter mesmo"), ["Cuca José Walter"]);
  assertEquals(unidadesCitadas("Vocês têm natação ou hidroginástica no cuca da barra do Ceará"), ["Cuca Barra"]);
  // rajada realista sem unidade nenhuma (inclusive palavra parecida com nome de unidade)
  assertEquals(unidadesCitadas("Oi boa tarde\nqueria saber da barragem e do picolé\ntem curso de manutenção de moto?"), []);
});

Deno.test("rajadaTemPedido: pedido escrito antes da saudação conta; só unidade ou cumprimento não", () => {
  assertEquals(rajadaTemPedido(["Queria natação na Barra"]), true);
  assertEquals(rajadaTemPedido(["Barra"]), false);
  assertEquals(rajadaTemPedido(["Cuca do Pici"]), false);
  assertEquals(rajadaTemPedido(["oi", "bom dia"]), false);
});

Deno.test("ultimaRespostaFoiFrasePronta: reconhece as duas frases prontas (com e sem 'De novo, foi mal')", () => {
  assertEquals(ultimaRespostaFoiFrasePronta([u("oi"), a(FRASE_PRONTA)]), true);
  assertEquals(ultimaRespostaFoiFrasePronta([u("oi"), a("De novo, foi mal! 😅\n\n" + FRASE_PRONTA), u("ok")]), true);
  assertEquals(ultimaRespostaFoiFrasePronta([u("oi"), a("Oi! Que bom te ver por aqui! 😊\n\nEm que posso te ajudar? 😊")]), true);
  assertEquals(ultimaRespostaFoiFrasePronta([u("oi"), a("A natação é às terças.")]), false);
  assertEquals(ultimaRespostaFoiFrasePronta([u("oi")]), false);
});

Deno.test("Decisões de unidade: `cortesia` do handler manda; sem ele, vale o texto (como antes)", () => {
  const nada = AVALIACAO_VAZIA;
  // rajada de cumprimentos com mais de 5 palavras juntas: cortesia=true → frase pronta
  assertEquals(decidirConversaEngajada(undefined, nada, "Olá bom dia\ntudo bem com você? tudo certo", true).resposta, FRASE_PRONTA);
  // cortesia=false (ex.: a última resposta já foi a frase pronta) → caminho de pergunta geral
  const engajada = decidirConversaEngajada(undefined, nada, "ok", false);
  assertEquals(engajada.resposta, null);
  assertEquals(engajada.perguntaGeralAtiva, true);
  assertEquals(decidirAguardandoUnidade(undefined, nada, "ok", false).resposta, null);
  assertEquals(decidirPrimeiraMensagem(undefined, nada, "oi", false).resposta, null);
  // sem `cortesia`: comportamento de antes
  assertEquals(decidirConversaEngajada(undefined, nada, "ok").resposta, FRASE_PRONTA);
});

Deno.test("AC5 (funções): chave desligada → '?' volta a ser cortesia", async () => {
  assertEquals(rotaUsaRajada(), true);
  await comChaveDesligada(() => {
    assertEquals(rotaUsaRajada(), false);
    assertEquals(ehCortesiaPura("?"), true);
    assertEquals(ehCortesiaPura("tudo bem com você?"), false);
  });
  assertEquals(rotaUsaRajada(), true);
});

// ── Handler ────────────────────────────────────────────────────────────────────────────────
type Chamada = { tabela: string; metodo: string; arg?: unknown };

// deno-lint-ignore no-explicit-any
function supabaseMock(dados: Record<string, unknown>, chamadas: Chamada[]): any {
  function cadeia(tabela: string) {
    // deno-lint-ignore no-explicit-any
    const proxy: any = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve({ data: dados[tabela] ?? null, error: null });
        return (arg?: unknown) => { chamadas.push({ tabela, metodo: String(prop), arg }); return proxy; };
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

/** Monta os dados do mock. O worker grava a mensagem atual antes de chamar o motor, então ela vai
 * no fim do histórico (como no gabarito). */
function dados(metadata: Record<string, unknown>, anteriores: Msg[], atual: string): Record<string, unknown> {
  const agora = Date.now();
  const linhas = [...anteriores, lead(atual, 0)].map((m) => ({ conteudo: m.conteudo, remetente: m.remetente, created_at: new Date(agora - m.minutos * 60000 - 1000).toISOString() }));
  return {
    "rpc:get_openai_key": "chave-falsa",
    "rpc:buscar_chunks_similares": [],
    leads: { id: "lead-1", nome: "Fulano", opt_in: true, bloqueado: false },
    conversas: { id: "conv-1", status: "ativa", metadata, lead_id: "lead-1" },
    mensagens: linhas.reverse(), // o handler lê em ordem decrescente
    prompts_agentes: { prompt_sistema: "sistema", prompt_contexto: "", temperatura: 0.7, max_tokens: 500, menu_boas_vindas: null },
    configuracoes: { valor: { empregabilidade: NUMERO_EMPREGA, acesso_cuca: null } },
    unidades_cuca: [],
    documentos_rag: null,
  };
}

type Classificacao = Record<string, unknown>;
const NAO_EMPREGO: Classificacao = { fala_de_emprego: false, vaga_sem_tipo: false, outra_pergunta: null };
const SO_EMPREGO: Classificacao = { fala_de_emprego: true, vaga_sem_tipo: false, outra_pergunta: null };
const SEM_UNIDADE: Classificacao = { unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false };

async function rodar(
  atual: string,
  d: Record<string, unknown>,
  opcoes: { emprego?: Classificacao; unidade?: Classificacao } = {},
): Promise<{ corpo: { resposta: string; mensagens?: string[]; handover: boolean }; chamadas: Chamada[]; prompts: string[]; empregos: string[]; unidades: string[] }> {
  const chamadas: Chamada[] = [];
  const prompts: string[] = [];
  const empregos: string[] = [];
  const unidades: string[] = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const endereco = String(url instanceof Request ? url.url : url);
    const corpo = String(init?.body ?? "");
    const json = (conteudo: string) => Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: conteudo } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 }));
    if (endereco.includes("/embeddings")) return Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: [0, 0, 0] }] }), { status: 200 }));
    if (endereco.includes("/chat/completions")) {
      if (corpo.includes(MARCADOR_CLASSIFICADOR_EMPREGO)) { empregos.push(corpo); return json(JSON.stringify(opcoes.emprego ?? NAO_EMPREGO)); }
      if (corpo.includes("Unidades válidas (use o nome EXATO)")) { unidades.push(corpo); return json(JSON.stringify(opcoes.unidade ?? SEM_UNIDADE)); }
      if (corpo.includes("Você interpreta mensagens de leads")) return json(JSON.stringify({ tipo: "outro", atividade: null, termos_busca: [], area: null, escopo: null, contexto: {} }));
      prompts.push(corpo);
      return json("Resposta do modelo.");
    }
    throw new Error("fetch não mockado: " + endereco);
  }) as typeof fetch;
  const logOriginal = console.log;
  console.log = () => {};
  try {
    const req = new Request("http://localhost/motor-agente", {
      method: "POST",
      body: JSON.stringify({ mensagem: atual, telefone: "5585999999999", canal_origem: "test", agente_tipo: "Institucional", unidade_cuca: "Geral", conversa_id: "conv-1" }),
    });
    const resp = await handler(req, supabaseMock(d, chamadas));
    assertEquals(resp.status, 200);
    const corpo = await resp.json();
    await new Promise((r) => setTimeout(r, 20)); // registros em segundo plano
    return { corpo, chamadas, prompts, empregos, unidades };
  } finally {
    globalThis.fetch = fetchOriginal;
    console.log = logOriginal;
  }
}

const metadataGravada = (chamadas: Chamada[]) => chamadas.filter((c) => c.tabela === "rpc:merge_conversa_metadata").map((c) => (c.arg as { p_patch: Record<string, unknown> }).p_patch);
const ultimoPatch = (chamadas: Chamada[]) => metadataGravada(chamadas).at(-1) ?? {};
const promptFinal = (prompts: string[]) => prompts.at(-1) ?? "";

Deno.test("AC1 (handler): 'Queria natação na Barra' + 'Oi boa tarde' resolve Cuca Barra e responde o pedido, sem resumo geral", async () => {
  const { corpo, chamadas, prompts } = await rodar("Oi boa tarde", dados({}, [lead("Queria natação na Barra", 0.1)], "Oi boa tarde"));
  assertEquals(ultimoPatch(chamadas).unidade_selecionada, "Cuca Barra");
  assertEquals(corpo.resposta, "Resposta do modelo.");
  const prompt = promptFinal(prompts);
  assertStringIncludes(prompt, "ja fez um pedido especifico");
  assert(!prompt.includes("apresente um resumo geral da programacao usando formato compacto"), "não pode pedir resumo geral");
});

Deno.test("AC1 (handler): rajada com 'Barra' e 'Pici' mostra o menu, sem escolher uma", async () => {
  const { corpo, chamadas, prompts } = await rodar("Pici", dados({}, [lead("Barra", 0.1)], "Pici"));
  assertStringIncludes(corpo.resposta, "mais de uma unidade");
  assertStringIncludes(corpo.resposta, MENU_UNIDADES);
  const patch = ultimoPatch(chamadas);
  assertEquals(patch.aguardando_unidade, true);
  assertEquals(patch.unidade_selecionada, undefined);
  assertEquals((patch.prog_pendente as { texto: string }).texto, "Barra\nPici");
  assertEquals(prompts.length, 0);
});

Deno.test("AC1 (handler): unidade já salva + rajada com duas outras unidades também mostra o menu", async () => {
  const { corpo } = await rodar("e no Pici?", dados({ unidade_selecionada: "Cuca Mondubim", conversa_engajada: true }, [bot("A natação no Mondubim é às terças.", 2), lead("tem no Jangurussu?", 0.1)], "e no Pici?"));
  assertStringIncludes(corpo.resposta, MENU_UNIDADES);
});

Deno.test("AC2 (handler): 'No esperança' depois de 'não encontrei' não recebe a frase pronta", async () => {
  const historico = [lead("O Integração ainda está acontecendo?", 1), bot("Não encontrei a Integração na programação deste mês. De qual unidade você quer saber?", 0.5)];
  const { corpo, prompts } = await rodar("No esperança", dados({ conversa_engajada: true }, historico, "No esperança"));
  assert(!corpo.resposta.includes(FRASE_PRONTA));
  assertEquals(prompts.length, 1, "segue pelo caminho de pergunta geral (modelo)");
});

Deno.test("AC2 (handler): 'oi' + 'vagas de emprego' na 1ª rajada responde o Emprega+, e o classificador recebe a rajada", async () => {
  const r1 = await rodar("vagas de emprego", dados({}, [lead("oi", 0.1)], "vagas de emprego"), { emprego: SO_EMPREGO });
  assertEquals(r1.corpo.mensagens, [EMPREGA]);
  // ordem invertida: a pergunta veio antes do "oi" — o classificador vê as duas mensagens
  const r2 = await rodar("oi", dados({}, [lead("vagas de emprego", 0.1)], "oi"), { emprego: SO_EMPREGO });
  assertEquals(r2.corpo.mensagens, [EMPREGA]);
  assertStringIncludes(r2.empregos[0], "vagas de emprego\\noi");
});

Deno.test("Handler: rajada só de cumprimentos (mais de 5 palavras juntas) recebe a saudação pronta, sem chamar o modelo", async () => {
  const { corpo, prompts } = await rodar("tudo bem com você?", dados({}, [lead("Olá bom dia", 0.1)], "tudo bem com você?"));
  assertStringIncludes(corpo.resposta, "Em que posso te ajudar? 😊");
  assertEquals(prompts.length, 0);
});

Deno.test("Handler: pergunta escrita antes do 'Boa tarde' não recebe frase pronta (rajada real de 05/11)", async () => {
  const { corpo, prompts } = await rodar("Boa tarde", dados({}, [lead("Quais os cursos tem", 0.1)], "Boa tarde"));
  assert(!corpo.resposta.includes("Em que posso te ajudar"));
  assert(prompts.length === 1 || corpo.resposta.includes(MENU_UNIDADES), "segue para o modelo ou pede a unidade");
});

Deno.test("Handler: não repete a frase pronta — 'ok' logo depois dela vai para o caminho de pergunta geral", async () => {
  const { corpo, prompts } = await rodar("ok", dados({ conversa_engajada: true }, [lead("oi", 3), bot(FRASE_PRONTA, 2)], "ok"));
  assert(!corpo.resposta.includes(FRASE_PRONTA));
  assertEquals(prompts.length, 1);
});

Deno.test("Handler: '?' depois de uma pergunta sem resposta vai para o modelo, não para a frase pronta", async () => {
  const historico = [lead("Gostaria de saber sobre as próximas seletivas de Handebol", 3), bot("De qual unidade você quer saber sobre handebol? Se preferir, vejo em toda a Rede CUCA 😊", 2), lead("Quando aconteceram", 0.2)];
  const { corpo, prompts } = await rodar("?", dados({ conversa_engajada: true }, historico, "?"));
  assert(!corpo.resposta.includes(FRASE_PRONTA));
  assertEquals(prompts.length, 1);
});

Deno.test("Handler: transbordo pela rajada — pedido antes do 'oi' aciona; negação na rajada não aciona", async () => {
  const sim = await rodar("oi", dados({ conversa_engajada: true }, [lead("quero falar com um atendente", 0.1)], "oi"));
  assertEquals(sim.corpo.handover, true);
  const nao = await rodar("não, não preciso de atendente", dados({ conversa_engajada: true }, [lead("quero falar com um atendente", 0.1)], "não, não preciso de atendente"));
  assertEquals(nao.corpo.handover, false);
});

Deno.test("Handler: o classificador de unidade recebe a rajada como texto atual e o histórico só até a resposta do bot", async () => {
  const historico = [lead("oi", 3), bot("Oi! Em que posso te ajudar? 😊", 2), lead("minha filha tem 9 anos", 0.2)];
  const { unidades } = await rodar("quero algo pra ela", dados({ conversa_engajada: true }, historico, "quero algo pra ela"));
  assertEquals(unidades.length, 1);
  const prompt = JSON.parse(unidades[0]).messages[0].content as string;
  assertStringIncludes(prompt, "minha filha tem 9 anos\nquero algo pra ela");
  // a rajada não aparece de novo no "Historico recente"
  const historicoRecente = prompt.slice(prompt.indexOf("Historico recente"));
  assert(!historicoRecente.includes("Lead: minha filha tem 9 anos"), historicoRecente);
});

Deno.test("AC5 (handler): ROTA_USA_RAJADA=false volta ao comportamento de antes", async () => {
  await comChaveDesligada(async () => {
    // duas unidades na rajada: sem menu, a última mensagem decide (Pici)
    const duas = await rodar("Pici", dados({}, [lead("Barra", 0.1)], "Pici"));
    assert(!duas.corpo.resposta.includes("mais de uma unidade"));
    assertEquals(ultimoPatch(duas.chamadas).unidade_selecionada, "Cuca Pici");
    // pedido antes da saudação: só a última ("Oi boa tarde") conta → saudação pronta
    const ac1 = await rodar("Oi boa tarde", dados({}, [lead("Queria natação na Barra", 0.1)], "Oi boa tarde"));
    assertStringIncludes(ac1.corpo.resposta, "Em que posso te ajudar? 😊");
    // frase pronta repete e "?" é cortesia
    const repete = await rodar("ok", dados({ conversa_engajada: true }, [lead("oi", 3), bot(FRASE_PRONTA, 2)], "ok"));
    assertStringIncludes(repete.corpo.resposta, FRASE_PRONTA);
    // transbordo só pela última mensagem
    const transbordo = await rodar("oi", dados({ conversa_engajada: true }, [lead("quero falar com um atendente", 0.1)], "oi"));
    assertEquals(transbordo.corpo.handover, false);
  });
});
