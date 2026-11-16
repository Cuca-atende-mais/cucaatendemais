// S-INST-QUAL-08 — avisos da rede com data de validade.
// AC2: aviso vencido não vai ao prompt, mesmo ainda ativo (antes do cron). AC3: aviso que começa
// amanhã não vai hoje e vai amanhã (data simulada). AC4: aviso `geral` válido aparece no bloco
// "AVISOS"; aviso `matricula` não. A data é sempre a de Fortaleza (22h em Fortaleza já é o dia
// seguinte em UTC).
import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { avisosValidos, handler, hojeFortalezaISO, montarBlocoAvisos } from "./index.ts";

const aviso = (metadados: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  ({ titulo: "Recesso", conteudo: "As unidades fecham no recesso de fim de ano.", metadados, unidade_cuca: null, ...extra });

Deno.test("hoje em Fortaleza: 22h em Fortaleza ainda é o mesmo dia, mesmo com o UTC no dia seguinte", () => {
  assertEquals(hojeFortalezaISO(new Date("2026-11-17T01:00:00Z")), "2026-11-16"); // 22h de 16/11 em Fortaleza
  assertEquals(hojeFortalezaISO(new Date("2026-11-17T03:00:00Z")), "2026-11-17"); // 00h de 17/11
  assertEquals(hojeFortalezaISO(new Date("2026-01-05T12:00:00Z")), "2026-01-05"); // mês e dia com zero
});

Deno.test("AC2: valido_ate ontem fica fora, mesmo com o aviso ainda ativo; hoje é o último dia válido", () => {
  assertEquals(avisosValidos([aviso({ valido_ate: "2026-11-15" })], "2026-11-16"), []);
  assertEquals(avisosValidos([aviso({ valido_ate: "2026-11-16" })], "2026-11-16").length, 1);
});

Deno.test("AC3: valido_de amanhã fica fora hoje e entra amanhã", () => {
  const lista = [aviso({ valido_de: "2026-11-17", valido_ate: "2026-11-20" })];
  assertEquals(avisosValidos(lista, "2026-11-16"), []);
  assertEquals(avisosValidos(lista, "2026-11-17").length, 1);
  assertEquals(avisosValidos(lista, "2026-11-20").length, 1);
  assertEquals(avisosValidos(lista, "2026-11-21"), []);
});

Deno.test("AC4: matrícula fora; sem categoria conta como geral; na dúvida o aviso não vai", () => {
  const hoje = "2026-11-16";
  assertEquals(avisosValidos([aviso({ valido_ate: "2026-11-30", categoria: "matricula" })], hoje), []);
  assertEquals(avisosValidos([aviso({ valido_ate: "2026-11-30", categoria: "geral" })], hoje).length, 1);
  assertEquals(avisosValidos([aviso({ valido_ate: "2026-11-30" })], hoje).length, 1);
  // sem fim, fim mal formado, início mal formado, com unidade, sem texto: fora
  for (const item of [
    aviso({}),
    aviso({ valido_ate: "30/11/2026" }),
    aviso({ valido_de: "16-11-2026", valido_ate: "2026-11-30" }),
    aviso({ valido_ate: "2026-11-30" }, { unidade_cuca: "Cuca Barra" }),
    aviso({ valido_ate: "2026-11-30" }, { conteudo: "   " }),
    null,
    "texto",
  ]) assertEquals(avisosValidos([item], hoje), [], JSON.stringify(item));
  // resultado que não é lista (ex.: mock que devolve um objeto) vira lista vazia
  assertEquals(avisosValidos({ conteudo: "x" }, hoje), []);
  assertEquals(avisosValidos(null, hoje), []);
});

Deno.test("bloco AVISOS: um aviso por linha, com a data de fim; vazio sem aviso", () => {
  assertEquals(montarBlocoAvisos([]), "");
  const bloco = montarBlocoAvisos([{ titulo: "Recesso", conteudo: "Fechado de 24/12 a 02/01.", valido_ate: "2027-01-02" }]);
  assertStringIncludes(bloco, "--- AVISOS DA REDE");
  assertStringIncludes(bloco, "- Recesso: Fechado de 24/12 a 02/01. (válido até 02/01/2027)");
});

// ── AC4 no prompt de verdade ───────────────────────────────────────────────────────────────
type Resposta = { data: unknown };

// deno-lint-ignore no-explicit-any
function supabaseMock(respostas: Record<string, Resposta>): any {
  function chain(tabela: string) {
    let tipo: string | null = null;
    // deno-lint-ignore no-explicit-any
    const c: any = {};
    for (const m of ["select", "in", "neq", "gte", "lte", "order", "limit", "single", "maybeSingle", "insert", "update", "upsert", "delete"]) c[m] = () => c;
    c.eq = (coluna: string, valor: unknown) => { if (coluna === "tipo") tipo = String(valor); return c; };
    c.then = (resolve: (v: unknown) => unknown) => {
      const chave = tipo ? `${tabela}:${tipo}` : tabela;
      return resolve({ data: (respostas[chave] ?? respostas[tabela])?.data ?? null, error: null });
    };
    return c;
  }
  return {
    from: (t: string) => chain(t),
    rpc: (nome: string) => ({ then: (resolve: (v: unknown) => unknown) => resolve({ data: respostas["rpc:" + nome]?.data ?? null, error: null }) }),
  };
}

async function promptSistema(avisos: unknown[], agora: number, agente_tipo = "Institucional"): Promise<string> {
  const chat: { messages: { content: string }[] }[] = [];
  const fetchOriginal = globalThis.fetch;
  const DateOriginal = globalThis.Date;
  class DataFixa extends DateOriginal {
    // deno-lint-ignore no-explicit-any
    constructor(...args: any[]) {
      // deno-lint-ignore no-explicit-any
      if (args.length === 0) super(agora); else super(...(args as [any]));
    }
    static override now() { return agora; }
  }
  globalThis.Date = DataFixa as DateConstructor;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const u = String(url instanceof Request ? url.url : url);
    if (u.includes("/v1/embeddings")) return Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: [0, 0, 0] }] }), { status: 200 }));
    if (u.includes("/v1/chat/completions")) {
      const corpoTexto = String(init?.body ?? "");
      if (corpoTexto.includes("CLASSIFICADOR DE EMPREGO")) return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: '{"fala_de_emprego":false,"vaga_sem_tipo":false,"outra_pergunta":null}' } }] }), { status: 200 }));
      const corpo = JSON.parse(corpoTexto || "{}");
      chat.push(corpo);
      const conteudo = corpo?.temperature === 0
        ? JSON.stringify({ unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false })
        : "Resposta de teste";
      return Promise.resolve(new Response(JSON.stringify({ id: "chatcmpl-x", choices: [{ message: { content: conteudo } }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }), { status: 200 }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  const sb = supabaseMock({
    "rpc:get_openai_key": { data: "fake" },
    "leads": { data: { id: "lead-1", nome: "Fulano", opt_in: true, bloqueado: false } },
    "conversas": { data: { id: "conv-1", status: "ativa", metadata: { unidade_selecionada: "Cuca Barra", conversa_engajada: true }, lead_id: "lead-1", primeira_interacao_lead_em: "2026-09-01T00:00:00Z" } },
    "mensagens": { data: [] },
    "prompts_agentes": { data: { prompt_sistema: "SISTEMA DO AGENTE", prompt_contexto: "CONTEXTO DO AGENTE", temperatura: 0.7, max_tokens: 500, menu_boas_vindas: null, updated_at: "2026-09-08T13:52:12Z" } },
    "documentos_rag": { data: { id: "doc-1", conteudo: "TEXTO DO DOCUMENTO", metadados: { vigencia_mes: 11, vigencia_ano: 2026, campanha_id: "camp-1" } } },
    "documentos_rag:servicos_rede": { data: { conteudo: "BASE INSTITUCIONAL" } },
    "documentos_rag:aviso": { data: avisos },
    "atividades_mensais": { data: [] },
    "chunks_documentos": { data: [] },
    "rpc:buscar_chunks_similares": { data: [] },
    "system_config": { data: null },
  });
  try {
    await handler(new Request("http://localhost/motor-agente", {
      method: "POST",
      body: JSON.stringify({ mensagem: "tem xadrez?", telefone: "5585999999999", canal_origem: "test", agente_tipo, unidade_cuca: "Geral", conversa_id: "conv-1" }),
    }), sb);
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    globalThis.fetch = fetchOriginal;
    globalThis.Date = DateOriginal;
  }
  assert(chat.length > 0, "nenhuma chamada de chat");
  return chat[chat.length - 1].messages.map((m) => m.content).join("\n");
}

const AS_22H_DE_16_11 = Date.UTC(2026, 10, 17, 1, 0, 0); // 16/11/2026 22:00 em Fortaleza (UTC já é 17/11)

Deno.test("AC4: aviso geral válido vai ao prompt, depois da base; matrícula e vencido não", async () => {
  const prompt = await promptSistema([
    aviso({ valido_ate: "2026-11-16" }, { titulo: "Recesso", conteudo: "FECHADO NO RECESSO" }),
    aviso({ valido_ate: "2026-11-30", categoria: "matricula" }, { titulo: "Matrícula", conteudo: "TEXTO DA MATRICULA" }),
    aviso({ valido_ate: "2026-11-15" }, { titulo: "Simulado", conteudo: "SIMULADO VENCIDO" }),
  ], AS_22H_DE_16_11);
  assertStringIncludes(prompt, "--- AVISOS DA REDE");
  assertStringIncludes(prompt, "- Recesso: FECHADO NO RECESSO (válido até 16/11/2026)");
  assert(!prompt.includes("TEXTO DA MATRICULA"), "aviso de matrícula entrou no bloco");
  assert(!prompt.includes("SIMULADO VENCIDO"), "aviso vencido entrou no prompt");
  assert(prompt.indexOf("BASE INSTITUCIONAL") < prompt.indexOf("--- AVISOS DA REDE"), "o bloco de avisos vem depois da base");
});

Deno.test("AC3 no prompt: aviso que começa amanhã não vai hoje e vai amanhã", async () => {
  const lista = [aviso({ valido_de: "2026-11-17", valido_ate: "2026-11-20" }, { conteudo: "COMECA AMANHA" })];
  assert(!(await promptSistema(lista, AS_22H_DE_16_11)).includes("COMECA AMANHA"));
  assertStringIncludes(await promptSistema(lista, AS_22H_DE_16_11 + 3 * 3600_000), "COMECA AMANHA"); // 17/11 01h em Fortaleza
});

Deno.test("sem aviso válido, nenhum bloco; agente sem programação não recebe avisos", async () => {
  assert(!(await promptSistema([], AS_22H_DE_16_11)).includes("AVISOS DA REDE"));
  assert(!(await promptSistema([aviso({ valido_ate: "2026-11-30" })], AS_22H_DE_16_11, "sofia")).includes("AVISOS DA REDE"));
});
