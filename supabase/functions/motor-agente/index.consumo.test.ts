// PLANO-023: registro de consumo por chamada em `ai_usage_logs`.
import { assert, assertAlmostEquals, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { calcularCustoUsd, handler, redefinirCachePrecos } from "./index.ts";

const PRECOS = {
  "gpt-4o": { in: 2.5, cached_in: 1.25, out: 10 },
  "gpt-4o-mini": { in: 0.15, cached_in: 0.075, out: 0.6 },
};

Deno.test("custo: separa entrada com e sem cache e usa o preço do modelo datado", () => {
  // 9.000 de entrada (1.000 em cache) + 200 de saída no gpt-4o-mini
  const custo = calcularCustoUsd("gpt-4o-mini-2024-07-18", 9000, 1000, 200, PRECOS)!;
  assertAlmostEquals(custo, (8000 * 0.15 + 1000 * 0.075 + 200 * 0.6) / 1e6, 1e-12);
  // "gpt-4o-2024-08-06" não pode cair no preço do mini, nem o mini no do gpt-4o
  assertAlmostEquals(calcularCustoUsd("gpt-4o-2024-08-06", 1000, 0, 0, PRECOS)!, 1000 * 2.5 / 1e6, 1e-12);
});

Deno.test("custo: sem tabela de preço ou modelo desconhecido fica NULL, nunca chutado", () => {
  assertEquals(calcularCustoUsd("gpt-4o-mini", 100, 0, 10, null), null);
  assertEquals(calcularCustoUsd("modelo-novo", 100, 0, 10, PRECOS), null);
});

type Insercao = { tabela: string; payload: Record<string, unknown> };

// deno-lint-ignore no-explicit-any
function supabaseMock(respostas: Record<string, { data: unknown; error?: unknown }>, insercoes: Insercao[]): any {
  function chain(tabela: string) {
    // deno-lint-ignore no-explicit-any
    const c: any = {};
    for (const m of ["select", "eq", "in", "order", "limit", "single", "maybeSingle", "update", "upsert", "delete"]) c[m] = () => c;
    c.insert = (payload: Record<string, unknown>) => { insercoes.push({ tabela, payload }); return c; };
    c.then = (resolve: (v: unknown) => unknown) => {
      const r = respostas[tabela];
      const ehInsercaoDeUso = tabela === "ai_usage_logs";
      resolve({ data: r?.data ?? null, error: ehInsercaoDeUso ? (r?.error ?? null) : null });
    };
    return c;
  }
  return {
    from: (t: string) => chain(t),
    rpc: (nome: string) => ({ then: (resolve: (v: unknown) => unknown) => resolve({ data: respostas["rpc:" + nome]?.data ?? null, error: null }) }),
  };
}

async function turnoComFaq(opcoes: { precos?: unknown; erroInsercao?: unknown }): Promise<{ resp: Response; uso: Insercao[] }> {
  const insercoes: Insercao[] = [];
  redefinirCachePrecos();
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request) => {
    const u = String(url instanceof Request ? url.url : url);
    if (u.includes("/v1/embeddings")) return Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: [0, 0, 0] }] }), { status: 200 }));
    if (u.includes("/v1/chat/completions")) {
      return Promise.resolve(new Response(JSON.stringify({
        id: "chatcmpl-abc", model: "gpt-4o-mini-2024-07-18", choices: [{ message: { content: "Abrimos às 8h!" } }],
        usage: { prompt_tokens: 9000, completion_tokens: 200, total_tokens: 9200, prompt_tokens_details: { cached_tokens: 1000 } },
      }), { status: 200 }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;
  const sb = supabaseMock({
    "rpc:get_openai_key": { data: "fake" },
    "leads": { data: { id: "lead-1", nome: "Fulano", opt_in: true, bloqueado: false } },
    "conversas": { data: { id: "conv-9", status: "ativa", metadata: { unidade_selecionada: "Cuca Barra", conversa_engajada: true }, lead_id: "lead-1", primeira_interacao_lead_em: "2026-09-01T00:00:00Z" } },
    "mensagens": { data: [] },
    "prompts_agentes": { data: { prompt_sistema: "SISTEMA", prompt_contexto: "CONTEXTO", temperatura: 0.7, max_tokens: 500, menu_boas_vindas: null, updated_at: "2026-09-08T13:52:12Z" } },
    "documentos_rag": { data: { id: "doc-1", conteudo: "SERVICOS", metadados: null } },
    "chunks_documentos": { data: [] },
    "rpc:buscar_chunks_similares": { data: [{ conteudo: "FAQ: abre às 8h", fonte_tipo: "FAQ", similaridade: 0.9, documento_id: "faq-1" }] },
    "system_config": { data: opcoes.precos === undefined ? null : { valor: JSON.stringify(opcoes.precos) } },
    "ai_usage_logs": { data: null, error: opcoes.erroInsercao ?? null },
  }, insercoes);
  try {
    const resp = await handler(new Request("http://localhost/motor-agente", {
      method: "POST",
      body: JSON.stringify({ mensagem: "que horas abre?", telefone: "5585999999999", canal_origem: "test", agente_tipo: "Institucional", unidade_cuca: "Geral", conversa_id: "conv-9" }),
    }), sb);
    await new Promise((r) => setTimeout(r, 30)); // registro roda em segundo plano
    return { resp, uso: insercoes.filter((i) => i.tabela === "ai_usage_logs") };
  } finally {
    globalThis.fetch = fetchOriginal;
  }
}

Deno.test("registro: uma linha por resposta, com tokens, cache, blocos e sem colunas geradas", async () => {
  const { resp, uso } = await turnoComFaq({ precos: PRECOS });
  assertEquals(resp.status, 200);
  assertEquals(uso.length, 1);
  const l = uso[0].payload;
  assertEquals(l.feature, "chat");
  assertEquals(l.agente_tipo, "Institucional");
  assertEquals(l.modelo, "gpt-4o-mini-2024-07-18");
  assertEquals(l.tokens_prompt, 9000);
  assertEquals(l.tokens_completion, 200);
  assertEquals(l.tokens_prompt_cached, 1000);
  assertEquals(l.openai_request_id, "chatcmpl-abc");
  assertEquals(l.conversa_id, "conv-9");
  assertEquals(l.prompt_versao, "2026-09-08T13:52:12Z");
  assertAlmostEquals(l.custo_usd as number, (8000 * 0.15 + 1000 * 0.075 + 200 * 0.6) / 1e6, 1e-12);
  assert(!("tokens_total" in l) && !("custo_estimado_usd" in l), "colunas geradas não podem ir no insert");
  const blocos = l.blocos_contexto as Record<string, number>;
  assert(blocos.servicos_rede > 0 && blocos.prompt_sistema > 0 && blocos.instrucao_seguranca > 0, JSON.stringify(blocos));
  assert(!("contexto_rag" in blocos), "contexto_rag aparece desmembrado, não como bloco único");
});

Deno.test("registro: sem tabela de preço, grava a linha com custo NULL", async () => {
  const { uso } = await turnoComFaq({});
  assertEquals(uso.length, 1);
  assertEquals(uso[0].payload.custo_usd, null);
});

Deno.test("registro: erro do banco ao gravar não afeta a resposta ao cidadão", async () => {
  const { resp, uso } = await turnoComFaq({ precos: PRECOS, erroInsercao: { message: "violação de coluna gerada" } });
  assertEquals(resp.status, 200);
  const corpo = await resp.json();
  assertEquals(corpo.success, true);
  assertEquals(uso.length, 1);
});
