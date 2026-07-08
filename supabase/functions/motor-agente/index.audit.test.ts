// Testes de auditoria — NÃO faz parte da suíte original do Valmir (index.test.ts).
// Cada teste aqui prova, de forma automatizada, um dos achados de
// docs/qa/AUDITORIA-motor-agente-institucional-2026-07-07.md. Eles descrevem o
// comportamento DESEJADO/correto — se o bug ainda não foi corrigido, o teste FALHA.
// Isso é intencional: é uma suíte "vermelha" servindo de checklist executável.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  contemPalavra,
  decidirAguardandoUnidade,
  extrairTextoMenu,
  decidirPrimeiraMensagem,
  deveTentarNovamente,
  MENU_UNIDADES,
  handler,
} from "./index.ts";

// ── Mock mínimo e encadeável do client Supabase, usado pelos testes AUD-04 abaixo ───────────
// Mesmo espírito do MagicMock encadeável do lado pytest (worker/tests/test_meta_adapter_inbound.py),
// adaptado para a API fluente do supabase-js (.from().select().eq()... / .rpc()). Cada chamada é
// registrada em `chamadas`, e a resolução final (await/.then()) devolve o que
// `respostasPorTabela[tabela]` configurar para aquela tabela/rpc — não distingue o formato da
// chain (select vs. update vs. insert): nos fluxos testados aqui isso não muda o resultado
// observável, só o dado de leitura importa.
type ChamadaRegistrada = { tabela: string; metodo: string };

// deno-lint-ignore no-explicit-any
function criarSupabaseMock(respostasPorTabela: Record<string, { data: unknown }>, chamadas: ChamadaRegistrada[]): any {
  function criarChain(tabela: string) {
    // deno-lint-ignore no-explicit-any
    const chain: any = {};
    for (const metodo of ["select", "insert", "update", "eq", "order", "limit", "single"]) {
      chain[metodo] = (..._args: unknown[]) => {
        chamadas.push({ tabela, metodo });
        return chain;
      };
    }
    chain.then = (resolve: (v: { data: unknown; error: null }) => unknown) =>
      resolve({ data: respostasPorTabela[tabela]?.data ?? null, error: null });
    return chain;
  }
  return {
    from: (tabela: string) => criarChain(tabela),
    rpc: (nome: string, ..._args: unknown[]) => {
      chamadas.push({ tabela: "rpc:" + nome, metodo: "rpc" });
      const resposta = respostasPorTabela["rpc:" + nome];
      return { then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data: resposta?.data ?? null, error: null }) };
    },
  };
}

/** Base comum aos 2 cenários AUD-04 abaixo — só muda `conversas.metadata` e a mensagem do lead. */
function respostasBaseAUD04(metadataConversa: Record<string, unknown>): Record<string, { data: unknown }> {
  return {
    "rpc:get_openai_key": { data: "fake-openai-key" },
    "leads": { data: { id: "lead-1", nome: "Fulano", opt_in: true, bloqueado: false } },
    "conversas": { data: { id: "conv-1", status: "ativa", metadata: metadataConversa } },
    "mensagens": { data: [] },
    "prompts_agentes": { data: { prompt_sistema: "sistema", prompt_contexto: "", temperatura: 0.7, max_tokens: 500, menu_boas_vindas: null } },
    "documentos_rag": { data: { id: "doc-1" } },
    "chunks_documentos": { data: [{ conteudo: "chunk de teste" }] },
    "rpc:buscar_chunks_similares": { data: [] },
  };
}

/** Stub de `fetch` global — intercepta só as 2 chamadas à OpenAI que o handler faz nesse fluxo
 * (embeddings e chat/completions); qualquer outra URL não-mockada derruba o teste (falha alta,
 * não falso-positivo silencioso). */
function comFetchMockado<T>(fn: () => Promise<T>): Promise<T> {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request) => {
    const urlStr = String(url instanceof Request ? url.url : url);
    if (urlStr.includes("api.openai.com/v1/embeddings")) {
      return Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: [0, 0, 0] }] }), { status: 200 }));
    }
    if (urlStr.includes("api.openai.com/v1/chat/completions")) {
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: "Resposta de teste" } }] }), { status: 200 }));
    }
    throw new Error("fetch não-mockado nesse teste: " + urlStr);
    // deno-lint-ignore no-explicit-any
  }) as any;
  return fn().finally(() => { globalThis.fetch = fetchOriginal; });
}

function requestFake(mensagem: string): Request {
  return new Request("http://localhost/motor-agente", {
    method: "POST",
    body: JSON.stringify({ mensagem, telefone: "5585999999999", canal_origem: "test", agente_tipo: "Institucional", unidade_cuca: "Geral" }),
  });
}

// ── AUD-01: "aguardando_unidade" é um estado sem saída ──────────────────────
Deno.test("AUD-01: quando o lead 'mudou de assunto', a conversa deveria sair do estado de espera de unidade", () => {
  const decisao = decidirAguardandoUnidade(undefined, { unidade: null, quer_sair: false, mudou_de_assunto: true });
  assertEquals(
    decisao.aguardandoUnidade,
    false,
    "AUD-01: depois de reconhecer que a mensagem não era uma tentativa de escolher unidade, a conversa deveria poder seguir para outros assuntos — hoje ela permanece travada em aguardando_unidade=true para sempre",
  );
});

Deno.test("AUD-01: quando o lead sinaliza que 'quer sair', a conversa deveria sair do estado de espera de unidade", () => {
  const decisao = decidirAguardandoUnidade(undefined, { unidade: null, quer_sair: true, mudou_de_assunto: false });
  assertEquals(
    decisao.aguardandoUnidade,
    false,
    "AUD-01: lead que sinaliza que não quer escolher agora ainda fica marcado como aguardando_unidade=true — qualquer mensagem futura sem nome de unidade repete o mesmo texto indefinidamente",
  );
});

// ── AUD-04: seleção de unidade por nome não recebe a visão geral ────────────
// Reescrito para exercitar o HANDLER real (não a função pura calcularPrecisaVisaoGeral
// isolada): o bug de verdade estava na wiring do call-site (trocouUnidade nunca era setado
// na resolução inicial de unidade), não na fórmula em si — um teste que só chama a função
// pura com inputs sintéticos não prova a wiring, e não consegue provar as duas pontas ao
// mesmo tempo sem contradição (ver Change Log / relatório @dev, Bloco B).
Deno.test("AUD-04: resolver a unidade por NOME (não só dígito) ativa a visão geral completa da programação", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const supabaseMock = criarSupabaseMock(
    respostasBaseAUD04({ aguardando_unidade: true }), // sem unidade_selecionada ainda — 1ª resolução
    chamadas,
  );
  await comFetchMockado(async () => {
    const resp = await handler(requestFake("Mondubim"), supabaseMock);
    assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  });
  const carregouProgramacaoCompleta = chamadas.some((c) => c.tabela === "documentos_rag");
  assertEquals(
    carregouProgramacaoCompleta,
    true,
    "AUD-04: resolver a unidade digitando o NOME ('Mondubim') deveria carregar a programação mensal completa (documentos_rag), igual à seleção por dígito — mas a wiring do call-site nunca seta trocouUnidade nesse caminho",
  );
});

Deno.test("AUD-04 (guarda-costas): pergunta de acompanhamento com unidade já salva NÃO deveria recarregar a visão geral completa (controle de custo de RAG do commit 168e8d2)", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const supabaseMock = criarSupabaseMock(
    respostasBaseAUD04({ unidade_selecionada: "Cuca Mondubim" }), // unidade já resolvida antes, sem troca nesta mensagem
    chamadas,
  );
  await comFetchMockado(async () => {
    const resp = await handler(requestFake("Tem natação essa semana?"), supabaseMock);
    assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  });
  const carregouProgramacaoCompleta = chamadas.some((c) => c.tabela === "documentos_rag");
  assertEquals(
    carregouProgramacaoCompleta,
    false,
    "uma pergunta de acompanhamento (unidade já salva, sem seleção nova) não pode recarregar os ~40 chunks da programação completa — isso reintroduziria o RAG token bloat que o commit 168e8d2 corrigiu; deveria usar busca vetorial de poucos chunks",
  );
});

// ── AUD-05: dígito solto na frase é confundido com número de unidade ────────
Deno.test("AUD-05: um dígito 1-5 que aparece como idade/quantidade na frase não deveria ser lido como escolha de unidade", () => {
  const msgLower = "tem vaga pra maiores de 3 anos?".toLowerCase();
  const casouComoEscolhaDeUnidade = contemPalavra(msgLower, "3");
  assertEquals(
    casouComoEscolhaDeUnidade,
    false,
    "AUD-05: '3' aqui é uma idade, não uma escolha de unidade — mas o match por palavra inteira (\\b3\\b) casa mesmo assim, fazendo o bot selecionar Cuca Mondubim por engano",
  );
});

// ── AUD-07: 1ª mensagem ignora o conteúdo, sempre pede o menu ───────────────
Deno.test("AUD-07: 1ª mensagem que já cita uma unidade deveria resolvê-la direto, sem pedir o menu de novo", () => {
  const decisao = decidirPrimeiraMensagem("quero saber da barra");
  assertEquals(
    decisao.unidadeSelecionada,
    "Cuca Barra",
    "AUD-07: o lead já disse a unidade na própria 1ª mensagem, mas o código ignora o conteúdo e sempre manda o menu de unidades de novo",
  );
});

// ── AUD-09: unidade tratada como "área de programação" na instrução ao GPT ──
Deno.test("AUD-09: extrairTextoMenu não deveria tratar o nome de uma unidade como área de programação selecionada", () => {
  // Cenário: o dígito "3" foi resposta ao MENU_UNIDADES (escolha de unidade), não ao menu
  // de categorias (Esportes/Cursos/etc). extrairTextoMenu não distingue os dois contextos.
  const textoOpcao = extrairTextoMenu("3", MENU_UNIDADES);
  assertEquals(
    textoOpcao,
    "",
    "AUD-09: '3' foi resposta ao menu de UNIDADES, não ao de categorias — mas extrairTextoMenu extrai 'Mondubim' como se fosse uma área de programação, contaminando a instrução enviada ao GPT ('Foque APENAS nessa área')",
  );
});

// ── AUD-13: retry cobre só 429, não 5xx transitório ─────────────────────────
Deno.test("AUD-13: um 503 transitório da OpenAI também deveria ser retentado, não só 429", () => {
  assertEquals(
    deveTentarNovamente(503, 0),
    true,
    "AUD-13: erros 5xx transitórios da OpenAI (500/502/503) também deveriam acionar o retry com backoff, mas hoje só 429 é tratado — um 503 vira 'problema técnico' imediato para o lead",
  );
});
