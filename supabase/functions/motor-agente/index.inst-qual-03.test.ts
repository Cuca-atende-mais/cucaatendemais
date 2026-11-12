// S-INST-QUAL-03 — registro do custo de todas as chamadas de IA e do resultado da busca.
// AC1: sequência fixa de mensagens grava o número exato de registros por feature.
// AC2: cada chamada à busca preenche `resultado_busca` (com resultado, vazia, erro, sem busca).
// AC3: falha no registro não afeta a resposta ao cidadão.
// Nada aqui chama a OpenAI ou o banco de verdade: `fetch` e o cliente do Supabase são mocks.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  avaliarSelecaoUnidade,
  classificarResultadoBusca,
  combinarResolucaoAtividade,
  detectarAtividadeComDiagnostico,
  detectarAtividadeMencionada,
  gerarEmbedding,
  handler,
  interpretarTurnoProgramacao,
  MARCADOR_CLASSIFICADOR_EMPREGO,
  redefinirCachePrecos,
  resolverAtividadeComDiagnostico,
  resolverAtividadeMencionadaComHistorico,
  type RespostaOpenAIUso,
} from "./index.ts";

const PRECOS = {
  "gpt-4o-mini": { in: 0.15, cached_in: 0.075, out: 0.6 },
  "text-embedding-3-small": { in: 0.02, cached_in: 0.02, out: 0 },
};

// ── Funções puras ─────────────────────────────────────────────────────────────────────────

Deno.test("classificarResultadoBusca: com resultado, vazia, erro (objeto ou texto)", () => {
  assertEquals(classificarResultadoBusca([{ conteudo: "x" }], null, 5), { resultado_busca: "sucesso_com_resultado", p_limite: 5, erro: null });
  assertEquals(classificarResultadoBusca([], null, 3), { resultado_busca: "sucesso_vazio", p_limite: 3, erro: null });
  assertEquals(classificarResultadoBusca(null, null, 3), { resultado_busca: "sucesso_vazio", p_limite: 3, erro: null });
  const errorOriginal = console.error;
  console.error = () => {};
  try {
    assertEquals(classificarResultadoBusca(null, { message: "statement timeout" }, 5), { resultado_busca: "erro", p_limite: 5, erro: "statement timeout" });
    assertEquals(classificarResultadoBusca(null, "falhou", 5).erro, "falhou");
    assertEquals(classificarResultadoBusca(null, { message: "x".repeat(900) }, 5).erro!.length, 500);
  } finally {
    console.error = errorOriginal;
  }
});

Deno.test("detectarAtividadeComDiagnostico: separa 'não achei' de 'ambíguo', sem mudar a função antiga", () => {
  const catalogo = ["Fundamentos da Fotografia", "Fotografia Avançada", "Natação"];
  // trecho que casa com 2 títulos (Fase 2)
  assertEquals(detectarAtividadeComDiagnostico("fotografia", catalogo), { atividade: null, ambigua: true });
  assertEquals(detectarAtividadeMencionada("fotografia", catalogo), null);
  // nada casa
  assertEquals(detectarAtividadeComDiagnostico("qual o endereço?", catalogo), { atividade: null, ambigua: false });
  // casa um só
  assertEquals(detectarAtividadeComDiagnostico("tem natação?", catalogo), { atividade: "Natação", ambigua: false });
  assertEquals(detectarAtividadeMencionada("tem natação?", catalogo), "Natação");
});

Deno.test("resolverAtividadeComDiagnostico: ambiguidade no histórico é marcada; a função antiga devolve o mesmo formato", () => {
  const historico = [
    { role: "user", content: "tem natação na Barra?" },
    { role: "user", content: "e judô também?" },
  ];
  assertEquals(resolverAtividadeComDiagnostico("e no Jangurussu?", ["Natação", "Judô"], historico), { atividade: null, origem: null, ambigua: true });
  assertEquals(resolverAtividadeMencionadaComHistorico("e no Jangurussu?", ["Natação", "Judô"], historico), { atividade: null, origem: null });
  assertEquals(resolverAtividadeComDiagnostico("quais atividades tem no Jangurussu?", ["Natação", "Judô"], historico), { atividade: null, origem: null, ambigua: false });
  assertEquals(resolverAtividadeComDiagnostico("e no Pici, tem judô?", ["Natação", "Judô"], historico), { atividade: "Judô", origem: "mensagem_atual", ambigua: false });
});

Deno.test("combinarResolucaoAtividade: vale a que achou; senão o motivo mais informativo", () => {
  assertEquals(combinarResolucaoAtividade("nao_encontrada", "encontrada"), "encontrada");
  assertEquals(combinarResolucaoAtividade("sem_documento", "ambigua"), "ambigua");
  assertEquals(combinarResolucaoAtividade("sem_documento", "nao_encontrada"), "nao_encontrada");
  assertEquals(combinarResolucaoAtividade("sem_documento", undefined), "sem_documento");
  assertEquals(combinarResolucaoAtividade(null, undefined), null);
});

// ── Callback opcional nas três funções ──────────────────────────────────────────────────

async function comFetch<T>(resposta: unknown, fn: () => Promise<T>, status = 200): Promise<T> {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(JSON.stringify(resposta), { status }))) as typeof fetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = fetchOriginal;
  }
}

Deno.test("callback: as três funções entregam o corpo com usage; sem callback seguem como antes", async () => {
  const recebidos: RespostaOpenAIUso[] = [];
  const cb = (c: RespostaOpenAIUso, ms: number) => { assert(ms >= 0); recebidos.push(c); };

  const emb = await comFetch({ model: "text-embedding-3-small", data: [{ embedding: [1, 2] }], usage: { prompt_tokens: 7, total_tokens: 7 } }, () => gerarEmbedding("oi", "k", cb));
  assertEquals(emb, [1, 2]);
  assertEquals(recebidos[0].usage?.prompt_tokens, 7);

  const unidade = { unidade: "Cuca Pici", quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false };
  const av = await comFetch({ id: "r1", model: "gpt-4o-mini", choices: [{ message: { content: JSON.stringify(unidade) } }], usage: { prompt_tokens: 300, completion_tokens: 20 } }, () => avaliarSelecaoUnidade("no pici", "k", [], cb));
  assertEquals(av.unidade, "Cuca Pici");
  assertEquals(recebidos[1].id, "r1");

  const interp = { tipo: "pergunta_programacao", atividade: "natação", termos_busca: ["natacao"], area: "ESPORTES", contexto: {}, escopo: null };
  const it = await comFetch({ id: "i1", model: "gpt-4o-mini", choices: [{ message: { content: JSON.stringify(interp) } }], usage: { prompt_tokens: 800, completion_tokens: 40 } }, () => interpretarTurnoProgramacao("tem natação?", "k", [], cb));
  assertEquals(it.tipo, "pergunta_programacao");
  assertEquals(recebidos[2].id, "i1");
  assertEquals(recebidos.length, 3);

  // sem callback (chamadas atuais dos testes antigos) e sem usage: nada quebra
  assertEquals(await comFetch({ data: [{ embedding: [3] }] }, () => gerarEmbedding("oi", "k")), [3]);
  assertEquals(await comFetch({ data: [{ embedding: [4] }] }, () => gerarEmbedding("oi", "k", cb)), [4]);
  assertEquals(recebidos.length, 3);
});

Deno.test("callback: erro dentro do callback não muda o resultado da função", async () => {
  const cb = () => { throw new Error("registro quebrou"); };
  const errorOriginal = console.error;
  console.error = () => {};
  try {
    const emb = await comFetch({ data: [{ embedding: [9] }], usage: { prompt_tokens: 1 } }, () => gerarEmbedding("oi", "k", cb));
    assertEquals(emb, [9]);
  } finally {
    console.error = errorOriginal;
  }
});

// ── Handler com estado entre turnos ─────────────────────────────────────────────────────

const PROGRAMACAO_PICI = [
  "== ESPORTES ==",
  "• NATAÇÃO",
  "Detalhes: Terça e quinta, 8h às 9h. Faixa etária: 7 a 17 anos.",
  "== CURSOS ==",
  "• VIOLÃO",
  "Detalhes: Quarta, 14h.",
].join("\n");

type Insercao = { tabela: string; payload: Record<string, unknown> };
type Estado = {
  metadata: Record<string, unknown>;
  mensagens: { conteudo: string; remetente: string }[]; // ordem cronológica
  insercoes: Insercao[];
  busca: { data: unknown; error: unknown };
  erroUso: unknown;
  documentoAtivo: boolean;
  programacaoRede: boolean; // false: a leitura da programação da rede (S-WM-72) volta vazia
};

function novoEstado(parcial: Partial<Estado> = {}): Estado {
  return { metadata: {}, mensagens: [], insercoes: [], busca: { data: [], error: null }, erroUso: null, documentoAtivo: true, programacaoRede: true, ...parcial };
}

// deno-lint-ignore no-explicit-any
function supabaseComEstado(estado: Estado): any {
  function dado(tabela: string, passos: string[]): unknown {
    const unico = passos.includes("single") || passos.includes("maybeSingle");
    switch (tabela) {
      case "leads": return { id: "lead-1", nome: "Fulano", opt_in: true, bloqueado: false };
      case "conversas": return { id: "conv-1", status: "ativa", metadata: { ...estado.metadata }, lead_id: "lead-1" };
      case "mensagens": return [...estado.mensagens].reverse(); // o handler lê em ordem decrescente
      case "prompts_agentes": return { prompt_sistema: "sistema", prompt_contexto: "", temperatura: 0.7, max_tokens: 500, menu_boas_vindas: null };
      case "configuracoes": return { valor: { empregabilidade: "5585999401057", acesso_cuca: null } };
      case "unidades_cuca": return [];
      case "system_config": return { valor: JSON.stringify(PRECOS) };
      case "documentos_rag":
        if (!estado.documentoAtivo) return unico ? null : [];
        if (unico) return { id: "doc-pici", conteudo: PROGRAMACAO_PICI, metadados: null };
        return estado.programacaoRede ? [{ unidade_cuca: "Cuca Pici", conteudo: PROGRAMACAO_PICI, created_at: "2026-11-01T00:00:00Z" }] : [];
      // chunks no formato que `extrairModalidades` lê (camada determinística por texto)
      case "chunks_documentos": return [{ conteudo: "Modalidade: Natação - Turma A. Terça e quinta, 8h às 9h." }];
      case "atividades_mensais": return [];
      default: return null;
    }
  }
  function cadeia(tabela: string) {
    const passos: string[] = [];
    // deno-lint-ignore no-explicit-any
    const proxy: any = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") {
          return (resolve: (v: unknown) => unknown) => {
            if (tabela === "ai_usage_logs") return resolve({ data: null, error: estado.erroUso });
            return resolve({ data: dado(tabela, passos), error: null });
          };
        }
        return (arg?: unknown) => {
          passos.push(String(prop));
          if (prop === "insert") {
            estado.insercoes.push({ tabela, payload: arg as Record<string, unknown> });
            if (tabela === "mensagens") estado.mensagens.push({ conteudo: (arg as { conteudo: string }).conteudo, remetente: (arg as { remetente: string }).remetente });
          }
          return proxy;
        };
      },
    });
    return proxy;
  }
  return {
    from: (t: string) => cadeia(t),
    rpc: (nome: string, args?: Record<string, unknown>) => ({
      then: (resolve: (v: unknown) => unknown) => {
        if (nome === "merge_conversa_metadata") {
          Object.assign(estado.metadata, (args?.p_patch ?? {}) as Record<string, unknown>);
          return resolve({ data: null, error: null });
        }
        if (nome === "get_openai_key") return resolve({ data: "chave-falsa", error: null });
        if (nome === "buscar_chunks_similares") return resolve(estado.busca);
        return resolve({ data: null, error: null });
      },
    }),
  };
}

/** Respostas da OpenAI por tipo de chamada, reconhecida pelo texto do prompt. Toda resposta traz
 * `usage`, como a API real — é o que dispara o registro. */
let tipoInterpretado = "pergunta_programacao";

function fetchOpenAIFalso(chamadas: string[]): typeof fetch {
  const corpo = (id: string, conteudo: string) => new Response(JSON.stringify({ id, model: "gpt-4o-mini-2024-07-18", choices: [{ message: { content: conteudo } }], usage: { prompt_tokens: 500, completion_tokens: 30 } }), { status: 200 });
  return ((url: string | URL | Request, init?: RequestInit) => {
    const u = String(url instanceof Request ? url.url : url);
    const body = String(init?.body ?? "");
    if (u.includes("/embeddings")) {
      chamadas.push("embedding");
      return Promise.resolve(new Response(JSON.stringify({ model: "text-embedding-3-small", data: [{ embedding: [0, 0, 0] }], usage: { prompt_tokens: 8, total_tokens: 8 } }), { status: 200 }));
    }
    if (body.includes(MARCADOR_CLASSIFICADOR_EMPREGO)) {
      chamadas.push("classificador_emprego");
      return Promise.resolve(corpo("emp", JSON.stringify({ fala_de_emprego: false, vaga_sem_tipo: false, outra_pergunta: null })));
    }
    if (body.includes("Você interpreta mensagens de leads")) {
      chamadas.push("interpretacao_programacao");
      return Promise.resolve(corpo("int", JSON.stringify({ tipo: tipoInterpretado, atividade: "natação", termos_busca: ["natacao"], area: "ESPORTES", contexto: {}, escopo: null })));
    }
    if (body.includes("Um lead da rede CUCA está conversando com a Maria")) {
      chamadas.push("classificacao_rota");
      return Promise.resolve(corpo("rota", JSON.stringify({ unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: true })));
    }
    if (u.includes("/chat/completions")) {
      chamadas.push("chat");
      return Promise.resolve(corpo("chat", "No Cuca Pici tem natação terça e quinta, das 8h às 9h."));
    }
    throw new Error("fetch não mockado: " + u);
  }) as typeof fetch;
}

/** Um turno: grava a mensagem do lead no histórico (como o worker faz) e chama o handler. */
async function turno(estado: Estado, mensagem: string, chamadas: string[] = []): Promise<{ status: number; corpo: Record<string, unknown> }> {
  estado.mensagens.push({ conteudo: mensagem, remetente: "lead" });
  const fetchOriginal = globalThis.fetch;
  const logOriginal = console.log;
  const errorOriginal = console.error;
  globalThis.fetch = fetchOpenAIFalso(chamadas);
  console.log = () => {};
  console.error = () => {};
  try {
    const resp = await handler(new Request("http://localhost/motor-agente", {
      method: "POST",
      body: JSON.stringify({ mensagem, telefone: "5585999999999", canal_origem: "test", agente_tipo: "Institucional", unidade_cuca: "Geral", conversa_id: "conv-1" }),
    }), supabaseComEstado(estado));
    const corpo = await resp.json();
    await new Promise((r) => setTimeout(r, 30)); // registros rodam em segundo plano
    return { status: resp.status, corpo };
  } finally {
    globalThis.fetch = fetchOriginal;
    console.log = logOriginal;
    console.error = errorOriginal;
  }
}

function contarPorFeature(estado: Estado): Record<string, number> {
  const contagem: Record<string, number> = {};
  for (const i of estado.insercoes) {
    if (i.tabela !== "ai_usage_logs") continue;
    const f = String(i.payload.feature);
    contagem[f] = (contagem[f] ?? 0) + 1;
  }
  return contagem;
}

function contarChamadas(chamadas: string[]): Record<string, number> {
  const contagem: Record<string, number> = {};
  for (const c of chamadas) contagem[c] = (contagem[c] ?? 0) + 1;
  return contagem;
}

function logsDeBusca(estado: Estado): Record<string, unknown>[] {
  return estado.insercoes.filter((i) => i.tabela === "rag_retrieval_logs").map((i) => i.payload);
}

Deno.test("AC1: 'oi' → 'tem natação?' → 'no Pici' grava o número exato de registros de cada feature", async () => {
  redefinirCachePrecos();
  const estado = novoEstado();
  const chamadas: string[] = [];

  // Turno 1 — "oi": 1ª mensagem, sem nome de unidade. O classificador de emprego roda em toda
  // mensagem com letra do Institucional, e a 1ª mensagem sem unidade passa pelo classificador de
  // rota (`avaliarSelecaoUnidade`, ramo da 1ª interação). Resposta: saudação + menu de unidades.
  const t1 = await turno(estado, "oi", chamadas);
  assertEquals(t1.status, 200);
  assertEquals(contarPorFeature(estado), { classificador_emprego: 1, classificacao_rota: 1 });

  // Turno 2 — "tem natação?": a programação tem natação, então o interpretador da S-WM-72 roda;
  // sem unidade na mensagem, o bot pergunta onde (pergunta pronta, sai antes do classificador de
  // rota, sem busca e sem resposta do modelo).
  const t2 = await turno(estado, "tem natação?", chamadas);
  assertEquals(t2.status, 200);
  assertEquals(contarPorFeature(estado), { classificador_emprego: 2, classificacao_rota: 1, interpretacao_programacao: 1 });

  // Turno 3 — "no Pici": responde à pergunta de escopo pendente → consulta de programação com
  // contexto: embedding da pergunta original para o FAQ e a resposta do modelo.
  const t3 = await turno(estado, "no Pici", chamadas);
  assertEquals(t3.status, 200);
  assertEquals(contarPorFeature(estado), { classificador_emprego: 3, classificacao_rota: 1, interpretacao_programacao: 1, embedding: 1, chat: 1 });

  // Um registro de busca por turno: só o 3º buscou (FAQ, p_limite 3; o mock devolve vazio).
  assertEquals(logsDeBusca(estado).map((l) => [l.camada, l.resultado_busca, l.p_limite]), [
    ["resposta_canned", "nao_aplicavel", null],
    ["pergunta_escopo", "nao_aplicavel", null],
    ["programacao_contexto", "sucesso_vazio", 3],
  ]);

  // Cada chamada feita à OpenAI virou exatamente um registro (nenhuma ficou de fora).
  assertEquals(contarPorFeature(estado), contarChamadas(chamadas));

  // Os registros novos levam tokens, custo, latência e conversa.
  const uso = estado.insercoes.filter((i) => i.tabela === "ai_usage_logs").map((i) => i.payload);
  const emb = uso.find((l) => l.feature === "embedding")!;
  assertEquals(emb.modelo, "text-embedding-3-small");
  assertEquals(emb.tokens_prompt, 8);
  assertEquals(emb.tokens_completion, 0);
  assertEquals(emb.conversa_id, "conv-1");
  assertEquals(emb.agente_tipo, "Institucional");
  assertEquals(typeof emb.latencia_ms, "number");
  assert(Math.abs((emb.custo_usd as number) - 8 * 0.02 / 1e6) < 1e-15);
  const interp = uso.find((l) => l.feature === "interpretacao_programacao")!;
  assertEquals(interp.openai_request_id, "int");
  assert(Math.abs((interp.custo_usd as number) - (500 * 0.15 + 30 * 0.6) / 1e6) < 1e-15);
  assert(!uso.some((l) => "tokens_total" in l || "custo_estimado_usd" in l), "colunas geradas não podem ir no insert");
});

Deno.test("AC1: classificador de rota registrado quando o lead sem unidade faz um pedido que depende de unidade", async () => {
  redefinirCachePrecos();
  // conversa já engajada, sem unidade, e mensagem sem cara de programação nem nome de unidade:
  // a decisão de rota vai para o classificador semântico (`avaliarSelecaoUnidade`).
  const estado = novoEstado({ metadata: { conversa_engajada: true }, mensagens: [{ conteudo: "oi", remetente: "lead" }, { conteudo: "Olá! De qual unidade você quer saber?", remetente: "agente" }], documentoAtivo: false });
  const chamadas: string[] = [];
  await turno(estado, "quero saber os horários de lá", chamadas);
  const contagem = contarPorFeature(estado);
  assertEquals(contagem.classificacao_rota, 1);
  assertEquals(contagem, contarChamadas(chamadas));
  const rota = estado.insercoes.find((i) => i.tabela === "ai_usage_logs" && i.payload.feature === "classificacao_rota")!.payload;
  assertEquals(rota.openai_request_id, "rota");
  assertEquals(rota.conversa_id, "conv-1");
});

// ── AC2: resultado da busca no rag_retrieval_logs ───────────────────────────────────────

/** Conversa no Pici, em acompanhamento: sem atividade reconhecida nas camadas determinísticas,
 * cai na busca vetorial (p_limite 5). */
function estadoAcompanhamentoPici(busca: { data: unknown; error: unknown }, programacaoRede = true): Estado {
  return novoEstado({
    programacaoRede,
    metadata: { unidade_selecionada: "Cuca Pici", conversa_engajada: true },
    mensagens: [{ conteudo: "quero saber do pici", remetente: "lead" }, { conteudo: "Claro! O que você procura no Cuca Pici?", remetente: "agente" }],
    busca,
  });
}

Deno.test("AC2: busca com resultado → sucesso_com_resultado, com p_limite e sem erro", async () => {
  const estado = estadoAcompanhamentoPici({ data: [{ conteudo: "Endereço: Rua X", fonte_tipo: "FAQ", similaridade: 0.8, documento_id: "faq-1" }], error: null });
  await turno(estado, "qual o endereço da unidade?");
  const logs = logsDeBusca(estado);
  assertEquals(logs.length, 1);
  assertEquals(logs[0].camada, "vetorial");
  assertEquals(logs[0].resultado_busca, "sucesso_com_resultado");
  assertEquals(logs[0].p_limite, 5);
  assertEquals(logs[0].erro, null);
  assertEquals(logs[0].resolucao_atividade, "nao_encontrada");
});

Deno.test("AC2: busca vazia → sucesso_vazio (camada continua sem_match_rag)", async () => {
  const estado = estadoAcompanhamentoPici({ data: [], error: null });
  await turno(estado, "qual o endereço da unidade?");
  const [log] = logsDeBusca(estado);
  assertEquals(log.camada, "sem_match_rag");
  assertEquals(log.resultado_busca, "sucesso_vazio");
  assertEquals(log.p_limite, 5);
  assertEquals(log.erro, null);
});

Deno.test("AC2: busca com erro → erro, com a mensagem; o fluxo segue como antes (sem_match_rag e resposta normal)", async () => {
  const estado = estadoAcompanhamentoPici({ data: null, error: { message: "canceling statement due to statement timeout" } });
  const { status, corpo } = await turno(estado, "qual o endereço da unidade?");
  assertEquals(status, 200);
  assertEquals(corpo.success, true);
  const [log] = logsDeBusca(estado);
  assertEquals(log.camada, "sem_match_rag");
  assertEquals(log.resultado_busca, "erro");
  assertEquals(log.erro, "canceling statement due to statement timeout");
  assertEquals(log.p_limite, 5);
});

Deno.test("AC2: turno sem busca → nao_aplicavel", async () => {
  const estado = novoEstado();
  await turno(estado, "oi"); // 1ª mensagem: saudação pedindo a unidade, sem busca
  const logs = logsDeBusca(estado);
  assert(logs.length >= 1);
  for (const l of logs) {
    assertEquals(l.resultado_busca, "nao_aplicavel");
    assertEquals(l.p_limite, null);
    assertEquals(l.erro, null);
  }
});

Deno.test("AC2: atividade achada pela camada de texto → resolucao_atividade = encontrada, sem busca vetorial", async () => {
  // o interpretador da S-WM-72 diz que não é pergunta de programação: o turno segue o acompanhamento
  const estado = estadoAcompanhamentoPici({ data: [{ conteudo: "não deveria ser usado" }], error: null }, false);
  const chamadas: string[] = [];
  tipoInterpretado = "nao_programacao";
  try {
    await turno(estado, "tem natação?", chamadas);
  } finally {
    tipoInterpretado = "pergunta_programacao";
  }
  const [log] = logsDeBusca(estado);
  assertEquals(log.camada, "deterministica_texto");
  assertEquals(log.resolucao_atividade, "encontrada");
  assertEquals(log.resultado_busca, "nao_aplicavel");
  assertEquals(log.p_limite, null);
  assert(!chamadas.includes("embedding"), "achou na camada determinística: não gera embedding");
});

// ── AC3: falha no registro não afeta a resposta ─────────────────────────────────────────

Deno.test("AC3: insert em ai_usage_logs com erro não muda a resposta ao cidadão", async () => {
  redefinirCachePrecos();
  const comErro = novoEstado({ erroUso: { message: "permission denied" } });
  const semErro = novoEstado();
  // a saudação de abertura é sorteada: fixa o sorteio para comparar as duas conversas
  const randomOriginal = Math.random;
  Math.random = () => 0;
  try {
    for (const m of ["oi", "tem natação?", "no Pici"]) {
      const a = await turno(comErro, m);
      const b = await turno(semErro, m);
      assertEquals(a.status, 200);
      assertEquals(a.corpo.resposta, b.corpo.resposta);
      assertEquals(a.corpo.mensagens, b.corpo.mensagens);
    }
  } finally {
    Math.random = randomOriginal;
  }
  // o registro foi tentado nas duas conversas, mesmo recusado numa delas
  assertEquals(contarPorFeature(comErro), contarPorFeature(semErro));
});

Deno.test("AC3: registro que lança exceção não muda a resposta ao cidadão", async () => {
  redefinirCachePrecos();
  const estado = novoEstado();
  const base = supabaseComEstado(estado);
  // deno-lint-ignore no-explicit-any
  const quebrado: any = { ...base, from: (t: string) => { if (t === "ai_usage_logs") throw new Error("cliente quebrou"); return base.from(t); } };
  estado.mensagens.push({ conteudo: "oi", remetente: "lead" });
  const fetchOriginal = globalThis.fetch;
  const logOriginal = console.log;
  const errorOriginal = console.error;
  globalThis.fetch = fetchOpenAIFalso([]);
  console.log = () => {};
  console.error = () => {};
  try {
    const resp = await handler(new Request("http://localhost/motor-agente", {
      method: "POST",
      body: JSON.stringify({ mensagem: "oi", telefone: "5585999999999", canal_origem: "test", agente_tipo: "Institucional", unidade_cuca: "Geral", conversa_id: "conv-1" }),
    }), quebrado);
    assertEquals(resp.status, 200);
    assertEquals((await resp.json()).success, true);
    await new Promise((r) => setTimeout(r, 30));
  } finally {
    globalThis.fetch = fetchOriginal;
    console.log = logOriginal;
    console.error = errorOriginal;
  }
});
