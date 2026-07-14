// S-WM-32 — Testes do passo de geração do resumo_rede (Task 2). Mesmo espírito dos testes de
// auditoria do motor-agente (motor-agente/index.audit.test.ts): mock mínimo e encadeável do
// client Supabase, e mock de fetch pra nunca depender de chamada real à OpenAI em teste
// automatizado (ver Dev Notes/Testing da story).
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { montarPromptResumoRede, handler } from "./index.ts";

type ChamadaRegistrada = { tabela: string; metodo: string; payload?: unknown; filtros?: Record<string, unknown> };

// deno-lint-ignore no-explicit-any
function criarSupabaseMock(opts: {
  permitido: boolean;
  monthlyPrograms: { unidade_cuca: string; conteudo: string }[];
  resumoRedeAntigo?: boolean;
}, chamadas: ChamadaRegistrada[]): any {
  function criarChain(tabela: string) {
    // deno-lint-ignore no-explicit-any
    const chain: any = { _filtros: {} as Record<string, unknown> };
    for (const metodo of ["select", "order"]) {
      chain[metodo] = (..._args: unknown[]) => chain;
    }
    chain.eq = (coluna: string, valor: unknown) => {
      chain._filtros = { ...chain._filtros, [coluna]: valor };
      return chain;
    };
    chain.update = (payload: unknown) => {
      chain._pendingUpdate = payload;
      return chain;
    };
    chain.insert = (payload: unknown) => {
      chamadas.push({ tabela, metodo: "insert", payload });
      chain._insertPayload = payload;
      return chain;
    };
    chain.select = (..._args: unknown[]) => chain;
    chain.single = () => ({
      then: (resolve: (v: { data: unknown; error: null }) => unknown) => {
        if (tabela === "documentos_rag" && chain._insertPayload) {
          return resolve({ data: { id: "novo-resumo-rede-id" }, error: null });
        }
        return resolve({ data: null, error: null });
      },
    });
    chain.then = (resolve: (v: { data: unknown; error: null }) => unknown) => {
      if (chain._pendingUpdate !== undefined) {
        chamadas.push({ tabela, metodo: "update", payload: chain._pendingUpdate, filtros: chain._filtros });
        return resolve({ data: null, error: null });
      }
      if (tabela === "documentos_rag" && chain._filtros.tipo === "monthly_program") {
        chamadas.push({ tabela, metodo: "select", filtros: chain._filtros });
        return resolve({ data: opts.monthlyPrograms, error: null });
      }
      return resolve({ data: [], error: null });
    };
    return chain;
  }
  return {
    from: (tabela: string) => criarChain(tabela),
    rpc: (nome: string, args?: Record<string, unknown>) => {
      chamadas.push({ tabela: "rpc:" + nome, metodo: "rpc", payload: args });
      if (nome === "has_permission") {
        return { then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data: opts.permitido, error: null }) };
      }
      if (nome === "get_openai_key") {
        return { then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data: "fake-openai-key", error: null }) };
      }
      return { then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data: null, error: null }) };
    },
  };
}

function comFetchMockado<T>(fn: () => Promise<T>, respostaResumo = "Natação: Cuca Barra, Cuca Mondubim"): Promise<T> {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request) => {
    const urlStr = String(url instanceof Request ? url.url : url);
    if (urlStr.includes("api.openai.com/v1/chat/completions")) {
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: respostaResumo } }] }), { status: 200 }));
    }
    throw new Error("fetch não-mockado nesse teste: " + urlStr);
    // deno-lint-ignore no-explicit-any
  }) as any;
  return fn().finally(() => { globalThis.fetch = fetchOriginal; });
}

function requestFake(): Request {
  return new Request("http://localhost/gerar-resumo-rede", {
    method: "POST",
    headers: { Authorization: "Bearer fake-user-jwt" },
  });
}

// ── Prompt (pura, testável sem mock) ────────────────────────────────────────
Deno.test("montarPromptResumoRede: inclui o bloco de cada unidade e a instrução de normalização", () => {
  const prompt = montarPromptResumoRede([
    { unidade: "Cuca Barra", conteudo: "• FUTSAL\n  Detalhes: ..." },
    { unidade: "Cuca Mondubim", conteudo: "• FUTEBOL DE SALÃO\n  Detalhes: ..." },
  ]);
  assertStringIncludes(prompt, "--- Cuca Barra ---");
  assertStringIncludes(prompt, "--- Cuca Mondubim ---");
  assertStringIncludes(prompt, "FUTSAL");
  assertStringIncludes(prompt, "FUTEBOL DE SALÃO");
  assertStringIncludes(prompt, "normalize nomes equivalentes");
  assertStringIncludes(prompt, "NUNCA invente");
});

// ── AC7: permissão ───────────────────────────────────────────────────────────
Deno.test("S-WM-32 AC7: sem a permissão exigida, a requisição é rejeitada (403) e nada é gerado/gravado", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const mock = criarSupabaseMock({ permitido: false, monthlyPrograms: [] }, chamadas);
  const resp = await handler(requestFake(), mock);
  assertEquals(resp.status, 403, "sem permissão, o endpoint deveria rejeitar com 403");
  const tentouGerarOuGravar = chamadas.some((c) => c.tabela === "documentos_rag");
  assertEquals(tentouGerarOuGravar, false, "sem permissão, nenhuma leitura/escrita em documentos_rag deveria acontecer");
});

// ── AC1/AC2: geração + substituição ──────────────────────────────────────────
Deno.test("S-WM-32 AC1: com permissão, gera o resumo_rede e desativa qualquer versão ativa anterior (não duplica)", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const mock = criarSupabaseMock({
    permitido: true,
    monthlyPrograms: [
      { unidade_cuca: "Cuca Barra", conteudo: "• FUTSAL\n  Detalhes: Turma 1. Professor: Ana." },
      { unidade_cuca: "Cuca Mondubim", conteudo: "• FUTEBOL DE SALÃO\n  Detalhes: Turma 2. Professor: Beto." },
    ],
  }, chamadas);

  const resp = await comFetchMockado(() => handler(requestFake(), mock));
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  const body = await resp.json();
  assertEquals(body.success, true);
  assertEquals(body.unidades, 2);

  const desativouAnterior = chamadas.some((c) =>
    c.tabela === "documentos_rag" && c.metodo === "update" &&
    (c.payload as { ativo?: boolean })?.ativo === false &&
    c.filtros?.tipo === "resumo_rede" && c.filtros?.ativo === true
  );
  assertEquals(desativouAnterior, true, "AC1: deveria desativar qualquer resumo_rede ativo=true anterior (incl. o registro manual do stopgap) antes de ativar o novo — nunca duas versões ativas simultâneas");

  const criouNovo = chamadas.some((c) =>
    c.tabela === "documentos_rag" && c.metodo === "insert" &&
    (c.payload as { tipo?: string; unidade_cuca?: string | null; ativo?: boolean })?.tipo === "resumo_rede" &&
    (c.payload as { unidade_cuca?: string | null }).unidade_cuca === null &&
    (c.payload as { ativo?: boolean }).ativo === true
  );
  assertEquals(criouNovo, true, "AC1: deveria gravar um novo documentos_rag com tipo=resumo_rede, unidade_cuca=null, ativo=true");
});

Deno.test("S-WM-32: sem nenhum monthly_program ativo, retorna erro sem tentar chamar o LLM", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const mock = criarSupabaseMock({ permitido: true, monthlyPrograms: [] }, chamadas);
  const resp = await handler(requestFake(), mock);
  assertEquals(resp.status, 422, "sem monthly_program ativo, não há dado real pra gerar o resumo — deveria falhar de forma clara, não gerar um resumo vazio/alucinado");
  const gerouDocumento = chamadas.some((c) => c.tabela === "documentos_rag" && c.metodo === "insert");
  assertEquals(gerouDocumento, false);
});

Deno.test("gerar-resumo-rede: método não-POST é rejeitado (405)", async () => {
  const resp = await handler(new Request("http://localhost/gerar-resumo-rede", { method: "GET" }));
  assertEquals(resp.status, 405);
});
