// Testes de auditoria — NÃO faz parte da suíte original do Valmir (index.test.ts).
// Cada teste aqui prova, de forma automatizada, um dos achados de
// docs/qa/AUDITORIA-motor-agente-institucional-2026-07-07.md. Eles descrevem o
// comportamento DESEJADO/correto — se o bug ainda não foi corrigido, o teste FALHA.
// Isso é intencional: é uma suíte "vermelha" servindo de checklist executável.
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  contemPalavra,
  decidirAguardandoUnidade,
  decidirConversaEngajada,
  extrairTextoMenu,
  ultimaMensagemEhMenuNumerado,
  decidirPrimeiraMensagem,
  detectarUnidadeDireta,
  deveTentarNovamente,
  extrairTagComArgumento,
  validarCanalEncaminhamento,
  montarMensagemEncaminhamento,
  MENU_UNIDADES,
  SAUDACOES_ABERTURA,
  INSTRUCAO_SEGURANCA,
  avaliarSelecaoUnidade,
  gerarEmbedding,
  handler,
} from "./index.ts";

// ── Mock mínimo e encadeável do client Supabase, usado pelos testes AUD-04 abaixo ───────────
// Mesmo espírito do MagicMock encadeável do lado pytest (worker/tests/test_meta_adapter_inbound.py),
// adaptado para a API fluente do supabase-js (.from().select().eq()... / .rpc()). Cada chamada é
// registrada em `chamadas`, e a resolução final (await/.then()) devolve o que
// `respostasPorTabela[tabela]` configurar para aquela tabela/rpc — não distingue o formato da
// chain (select vs. update vs. insert): nos fluxos testados aqui isso não muda o resultado
// observável, só o dado de leitura importa.
// `args` (opcional) captura os argumentos da chamada — usado pelos testes VAL-12 que precisam
// confirmar QUAIS parâmetros (p_tipos/p_unidade_cuca) foram passados pra buscar_chunks_similares,
// não só que a RPC foi chamada. Aditivo: nenhum teste existente faz igualdade do array inteiro,
// só `.some((c) => c.tabela === ...)`, então adicionar o campo não quebra nada.
// `payload` (opcional, S-WM-21 Task 7 — achado do @qa Quinn): captura o argumento de `update`/
// `insert`, mesmo espírito de `args` acima, mas para o corpo do write em vez dos argumentos de
// uma RPC. Sem isso, um teste só sabe QUANTAS vezes `.update()` foi chamado, não o que cada
// chamada realmente gravou — foi exatamente essa lacuna que deixou passar um bug onde um 2º
// `.update({metadata:{...}})` no mesmo turno apagava o que um 1º tinha acabado de gravar (o
// mock nunca guardava o conteúdo pra comparar). Aditivo: nenhum teste existente lê `payload`,
// então adicionar o campo não quebra nada.
type ChamadaRegistrada = { tabela: string; metodo: string; args?: unknown[]; payload?: unknown };

// S-WM-39: `error` opcional por tabela — aditivo (default null, preserva todo call-site
// existente que só configura `data`). Simula uma query real do supabase-js falhando
// (select/insert na mesma tabela resolvem o mesmo `error` configurado — suficiente pros
// cenários testados, que não precisam diferenciar select de insert na mesma tabela).
// deno-lint-ignore no-explicit-any
function criarSupabaseMock(respostasPorTabela: Record<string, { data: unknown; error?: { message: string } | null }>, chamadas: ChamadaRegistrada[]): any {
  function criarChain(tabela: string) {
    // deno-lint-ignore no-explicit-any
    const chain: any = {};
    for (const metodo of ["select", "eq", "order", "limit", "single"]) {
      chain[metodo] = (...args: unknown[]) => {
        chamadas.push({ tabela, metodo, args });
        return chain;
      };
    }
    for (const metodo of ["insert", "update"]) {
      chain[metodo] = (payload: unknown) => {
        chamadas.push({ tabela, metodo, payload });
        return chain;
      };
    }
    chain.then = (resolve: (v: { data: unknown; error: { message: string } | null }) => unknown) =>
      resolve({ data: respostasPorTabela[tabela]?.data ?? null, error: respostasPorTabela[tabela]?.error ?? null });
    return chain;
  }
  return {
    from: (tabela: string) => criarChain(tabela),
    rpc: (nome: string, ...args: unknown[]) => {
      chamadas.push({ tabela: "rpc:" + nome, metodo: "rpc", args });
      const resposta = respostasPorTabela["rpc:" + nome];
      return { then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data: resposta?.data ?? null, error: null }) };
    },
  };
}

/** Base comum aos cenários de handler (AUD-04, AUD-07) abaixo — só muda `conversas.metadata` e
 * a mensagem do lead. */
function respostasBaseHandler(metadataConversa: Record<string, unknown>): Record<string, { data: unknown; error?: { message: string } | null }> {
  return {
    "rpc:get_openai_key": { data: "fake-openai-key" },
    "leads": { data: { id: "lead-1", nome: "Fulano", opt_in: true, bloqueado: false } },
    // S-WM-37: lead_id incluído por padrão (mesmo lead-1 do mock de "leads" abaixo) — testes que
    // precisam simular ownership mismatch (conversa de outro lead) sobrescrevem "conversas"
    // explicitamente com um lead_id diferente.
    "conversas": { data: { id: "conv-1", status: "ativa", metadata: metadataConversa, lead_id: "lead-1" } },
    "mensagens": { data: [] },
    "prompts_agentes": { data: { prompt_sistema: "sistema", prompt_contexto: "", temperatura: 0.7, max_tokens: 500, menu_boas_vindas: null } },
    "documentos_rag": { data: { id: "doc-1" } },
    "chunks_documentos": { data: [{ conteudo: "chunk de teste" }] },
    "rpc:buscar_chunks_similares": { data: [] },
  };
}

/** Stub de `fetch` global — intercepta só as 2 chamadas à OpenAI que o handler faz nesse fluxo
 * (embeddings e chat/completions); qualquer outra URL não-mockada derruba o teste (falha alta,
 * não falso-positivo silencioso). `respostaChatCompletions` é opcional (default "Resposta de
 * teste", preserva todo call-site existente) — testes de backlog 4a usam pra simular o GPT
 * emitindo a tag [[ENCAMINHAR:canal]]. */
function comFetchMockado<T>(fn: () => Promise<T>, respostaChatCompletions = "Resposta de teste"): Promise<T> {
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request) => {
    const urlStr = String(url instanceof Request ? url.url : url);
    if (urlStr.includes("api.openai.com/v1/embeddings")) {
      return Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: [0, 0, 0] }] }), { status: 200 }));
    }
    if (urlStr.includes("api.openai.com/v1/chat/completions")) {
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: respostaChatCompletions } }] }), { status: 200 }));
    }
    throw new Error("fetch não-mockado nesse teste: " + urlStr);
  }) as typeof fetch;
  return fn().finally(() => { globalThis.fetch = fetchOriginal; });
}

/** Captura as chamadas de console.log/console.warn durante `fn`, restaurando os originais ao
 * final (mesmo espírito de comFetchMockado acima) — usado pelos testes VAL-04 (observabilidade)
 * abaixo e pelo alerta de monthly_program grande demais (ambos os níveis vão pra `linhas`, sem
 * distinção — os testes filtram pelo texto da mensagem, que já é único por caso). */
function comConsoleLogCapturado<T>(fn: () => Promise<T>): Promise<{ resultado: T; linhas: string[] }> {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const linhas: string[] = [];
  // deno-lint-ignore no-explicit-any
  console.log = ((...args: any[]) => { linhas.push(args.map(String).join(" ")); }) as typeof console.log;
  // deno-lint-ignore no-explicit-any
  console.warn = ((...args: any[]) => { linhas.push(args.map(String).join(" ")); }) as typeof console.warn;
  return fn()
    .then((resultado) => ({ resultado, linhas }))
    .finally(() => { console.log = originalLog; console.warn = originalWarn; });
}

function requestFake(mensagem: string): Request {
  return new Request("http://localhost/motor-agente", {
    method: "POST",
    body: JSON.stringify({ mensagem, telefone: "5585999999999", canal_origem: "test", agente_tipo: "Institucional", unidade_cuca: "Geral" }),
  });
}

// S-WM-31 Task 3 (AC6): mesmo requestFake, com conversa_id opcional no body — único caller real
// hoje (worker/meta_adapter_inbound.py) sempre manda, mas o handler precisa aceitar ausência.
function requestFakeComConversaId(mensagem: string, conversaId?: string): Request {
  return new Request("http://localhost/motor-agente", {
    method: "POST",
    body: JSON.stringify({
      mensagem,
      telefone: "5585999999999",
      canal_origem: "test",
      agente_tipo: "Institucional",
      unidade_cuca: "Geral",
      ...(conversaId ? { conversa_id: conversaId } : {}),
    }),
  });
}

// ── AUD-01: "aguardando_unidade" é um estado sem saída ──────────────────────
// Reescrito no E4 (VAL-12): a versão original testava mudou_de_assunto=true isolado, sem o
// sinal pergunta_geral (que não existia). Isso colidia com VAL-13 (cortesia pura não pode
// destravar o fluxo) — a intenção original do AUD-01 ("não travar quem genuinamente quer
// mudar de assunto") só se aplica quando é uma pergunta institucional real, não uma cortesia.
Deno.test("AUD-01: pergunta institucional real (mudou de assunto de verdade) sai do estado de espera de unidade", () => {
  const decisao = decidirAguardandoUnidade(undefined, { unidade: null, quer_sair: false, mudou_de_assunto: true, pergunta_geral: true });
  assertEquals(
    decisao.aguardandoUnidade,
    false,
    "AUD-01: uma pergunta institucional de verdade (não é escolha de unidade, nem cortesia) deveria destravar aguardando_unidade e seguir pro fluxo normal — preserva a intenção original: não travar quem genuinamente quer falar de outra coisa",
  );
});

// ── S-WM-31 Task 3 (AC5) supera VAL-13: cortesia pura (ex.: "bom dia") não trava mais
// aguardando_unidade — critério unificado com decidirPrimeiraMensagem (pedido_depende_unidade).
Deno.test("S-WM-31 AC5: cortesia pura (pedido_depende_unidade=false) sai do estado de espera de unidade, sem reapresentar o menu", () => {
  const decisao = decidirAguardandoUnidade(undefined, {
    unidade: null,
    quer_sair: false,
    mudou_de_assunto: true,
    pergunta_geral: false,
    pedido_depende_unidade: false,
  });
  assertEquals(
    decisao.aguardandoUnidade,
    false,
    "S-WM-31 AC5: pedir a unidade de novo só quando pedido_depende_unidade=true — cortesia pura não deve mais travar/reapresentar o menu (supera VAL-13)",
  );
  assertEquals(
    (decisao.resposta ?? "").includes(MENU_UNIDADES),
    false,
    "S-WM-31 AC5: cortesia pura não pode vir com o menu de unidades anexado",
  );
});

Deno.test("S-WM-31 AC5: pedido que depende de unidade (pedido_depende_unidade=true) continua recebendo o menu em decidirAguardandoUnidade", () => {
  const decisao = decidirAguardandoUnidade(undefined, {
    unidade: null,
    quer_sair: false,
    mudou_de_assunto: true,
    pergunta_geral: false,
    pedido_depende_unidade: true,
  });
  assertEquals(
    decisao.aguardandoUnidade,
    true,
    "S-WM-31 AC5: um pedido que realmente depende de saber a unidade ainda precisa aguardar a escolha",
  );
  assertStringIncludes(decisao.resposta ?? "", MENU_UNIDADES, "S-WM-31 AC5: comportamento preservado quando pedido_depende_unidade=true");
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
    respostasBaseHandler({ aguardando_unidade: true }), // sem unidade_selecionada ainda — 1ª resolução
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
    respostasBaseHandler({ unidade_selecionada: "Cuca Mondubim" }), // unidade já resolvida antes, sem troca nesta mensagem
    chamadas,
  );
  // Tarefa "remover .limit(40)" (2026-07-16): a fingerprint antiga (`.limit(40)` em
  // chunks_documentos, exclusiva de carregarProgramacaoMensal) deixou de existir — a função não
  // usa mais `.limit()` nenhum (ver comentário em index.ts sobre por que remover o teto fixo é
  // seguro dado o contexto de 128k do gpt-4o). A nova fingerprint precisa é o texto do log
  // exclusivo de carregarProgramacaoMensal ("Chunks diretos monthly_program:") — buscarAtividadeEspecifica
  // loga um texto diferente ("Busca deterministica de atividade:").
  const { resultado, linhas } = await comFetchMockado(() =>
    comConsoleLogCapturado(() => handler(requestFake("Tem natação essa semana?"), supabaseMock))
  );
  assertEquals(resultado.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  const carregouProgramacaoCompleta = linhas.some((l) => l.includes("Chunks diretos monthly_program:"));
  assertEquals(
    carregouProgramacaoCompleta,
    false,
    "uma pergunta de acompanhamento (unidade já salva, sem seleção nova) não pode recarregar a programação completa via carregarProgramacaoMensal — isso reintroduziria o RAG token bloat que o commit 168e8d2 corrigiu; deveria usar busca determinística por atividade ou busca vetorial de poucos chunks",
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
  // VAL-12: assinatura mudou (recebe unidadeDetectadaDireta + avaliacaoSemantica em vez do
  // texto cru) — mesmo padrão de decidirAguardandoUnidade. Valor esperado não muda.
  const decisao = decidirPrimeiraMensagem(
    detectarUnidadeDireta("quero saber da barra"),
    { unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false },
  );
  assertEquals(
    decisao.unidadeSelecionada,
    "Cuca Barra",
    "AUD-07: o lead já disse a unidade na própria 1ª mensagem, mas o código ignora o conteúdo e sempre manda o menu de unidades de novo",
  );
});

// ── S-WM-31 Task 3 (AC6): motor-agente aceita conversa_id opcional no body ──────────────────
Deno.test("S-WM-31 AC6: conversa_id presente no body → resolve a conversa por PK, não re-deriva por lead_id+origem_id", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const supabaseMock = criarSupabaseMock(respostasBaseHandler({}), chamadas);
  await comFetchMockado(async () => {
    const resp = await handler(requestFakeComConversaId("oi", "conv-especifica-123"), supabaseMock);
    assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  });
  const buscouPorPk = chamadas.some((c) =>
    c.tabela === "conversas" && c.metodo === "eq" && c.args?.[0] === "id" && c.args?.[1] === "conv-especifica-123"
  );
  assertEquals(buscouPorPk, true, "AC6: com conversa_id presente, o handler deveria resolver a conversa por PK (eq('id', conversa_id))");
  const rederivouPorLeadOrigem = chamadas.some((c) => c.tabela === "conversas" && c.metodo === "eq" && c.args?.[0] === "lead_id");
  assertEquals(rederivouPorLeadOrigem, false, "AC6: não deveria mais re-derivar por lead_id+origem_id quando conversa_id já veio no body");
});

Deno.test("S-WM-31 AC6: conversa_id ausente no body → cai no fallback de resolução por telefone+canal_origem (lead_id+origem_id), sem quebrar", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const supabaseMock = criarSupabaseMock(respostasBaseHandler({}), chamadas);
  await comFetchMockado(async () => {
    const resp = await handler(requestFakeComConversaId("oi"), supabaseMock);
    assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  });
  const usouFallbackLeadOrigem = chamadas.some((c) => c.tabela === "conversas" && c.metodo === "eq" && c.args?.[0] === "lead_id");
  assertEquals(usouFallbackLeadOrigem, true, "AC6: sem conversa_id no body, o handler precisa continuar resolvendo por lead_id+origem_id (fallback pra qualquer caller futuro que não mande)");
});

// ── S-WM-31 Task 4 (item 6 do Escopo, Causa raiz B): conversa_engajada e 3º branch ──────────
Deno.test("S-WM-31: decidirConversaEngajada — unidade detectada resolve normalmente", () => {
  const decisao = decidirConversaEngajada("Cuca Mondubim", { unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false });
  assertEquals(decisao.unidadeSelecionada, "Cuca Mondubim");
  assertEquals(decisao.aguardandoUnidade, false);
  assertEquals(decisao.perguntaGeralAtiva, false);
  assertEquals(decisao.resposta, null);
});

Deno.test("S-WM-31: decidirConversaEngajada — pedido_depende_unidade=true sem unidade pede a unidade com tom de continuação (sem SAUDACOES_ABERTURA)", () => {
  const decisao = decidirConversaEngajada(undefined, { unidade: null, quer_sair: false, mudou_de_assunto: true, pergunta_geral: false, pedido_depende_unidade: true });
  assertEquals(decisao.unidadeSelecionada, null);
  assertEquals(decisao.aguardandoUnidade, true);
  assertEquals(decisao.perguntaGeralAtiva, false);
  assertStringIncludes(decisao.resposta ?? "", MENU_UNIDADES, "deveria conter o menu de unidades");
  const comecaComSaudacao = SAUDACOES_ABERTURA.some((s) => decisao.resposta?.startsWith(s));
  assertEquals(comecaComSaudacao, false, "conversa já engajada — nunca repetir SAUDACOES_ABERTURA");
});

Deno.test("VAL-19 (S-WM-50): decidirConversaEngajada — cortesia pura (pergunta_geral=false) recebe resposta canned, NÃO ativa perguntaGeralAtiva", () => {
  const decisao = decidirConversaEngajada(undefined, { unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false });
  assertEquals(decisao.unidadeSelecionada, null);
  assertEquals(decisao.aguardandoUnidade, false);
  assertEquals(decisao.perguntaGeralAtiva, false, "VAL-19: cortesia pura não pode mais disparar o RAG geral (resumo_rede+FAQ) à toa — mesmo padrão de decidirAguardandoUnidade");
  assertEquals(decisao.resposta, "Em que mais posso te ajudar? 😊");
});

Deno.test("VAL-19 (S-WM-50): decidirConversaEngajada — pergunta_geral=true real continua ativando perguntaGeralAtiva (regressão)", () => {
  const decisao = decidirConversaEngajada(undefined, { unidade: null, quer_sair: false, mudou_de_assunto: true, pergunta_geral: true, pedido_depende_unidade: false });
  assertEquals(decisao.unidadeSelecionada, null);
  assertEquals(decisao.aguardandoUnidade, false);
  assertEquals(decisao.perguntaGeralAtiva, true, "pergunta institucional real continua seguindo pro Passo 6 (RAG geral) — comportamento preservado");
  assertEquals(decisao.resposta, null);
});

// Testes de wiring no HANDLER — provam que o 3º branch (conversa_engajada) e a marcação da flag
// nos outros 2 branches (decidirPrimeiraMensagem, decidirAguardandoUnidade) estão conectados.
Deno.test("VAL-19 (S-WM-50): conversa_engajada=true + cortesia pura → early-return canned, NÃO chega no RAG geral (resumo_rede/FAQ)", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const supabaseMock = criarSupabaseMock(respostasBaseHandler({ conversa_engajada: true }), chamadas);
  const resp = await comFetchMockado(
    () => handler(requestFake("tudo bem?"), supabaseMock),
    JSON.stringify({ unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false }),
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  const chegouNoRag = chamadas.some((c) => c.tabela === "rpc:buscar_chunks_similares");
  assertEquals(chegouNoRag, false, "VAL-19: cortesia pura com conversa_engajada=true não pode mais chamar busca vetorial (RAG) à toa");
  const leuDocumentosRag = chamadas.some((c) => c.tabela === "documentos_rag");
  assertEquals(leuDocumentosRag, false, "VAL-19: cortesia pura não pode mais carregar resumo_rede (documentos_rag) à toa");
  const gravouUnidade = chamadas.some((c) => c.tabela === "conversas" && c.metodo === "update" && (c.payload as { metadata?: Record<string, unknown> })?.metadata?.unidade_selecionada);
  assertEquals(gravouUnidade, false, "cortesia não deveria gravar nenhuma unidade_selecionada nova");
  const body = await resp.json();
  assertEquals(body.resposta, "Em que mais posso te ajudar? 😊", "VAL-19: cortesia pura deveria responder com o canned de continuação, igual a decidirAguardandoUnidade");
});

Deno.test("S-WM-31: conversa_engajada=true + unidade detectada na mensagem → resolve a unidade, carrega visão geral", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const supabaseMock = criarSupabaseMock(respostasBaseHandler({ conversa_engajada: true }), chamadas);
  await comFetchMockado(async () => {
    const resp = await handler(requestFake("Mondubim"), supabaseMock);
    assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  });
  const gravouMondubim = chamadas.some((c) =>
    c.tabela === "conversas" && c.metodo === "update" && (c.payload as { metadata?: Record<string, unknown> })?.metadata?.unidade_selecionada === "Cuca Mondubim"
  );
  assertEquals(gravouMondubim, true, "unidade citada durante uma conversa engajada deveria ser resolvida e gravada, igual ao branch aguardando_unidade (AUD-04)");
  const carregouProgramacaoCompleta = chamadas.some((c) => c.tabela === "documentos_rag");
  assertEquals(carregouProgramacaoCompleta, true, "resolver a unidade a partir do 3º branch deveria contar como trocouUnidade e carregar a visão geral completa, mesmo tratamento já existente");
});

Deno.test("S-WM-31: conversa_engajada=true + pedido_depende_unidade=true sem unidade → pede a unidade (aguardando_unidade=true), tom de continuação", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const supabaseMock = criarSupabaseMock(respostasBaseHandler({ conversa_engajada: true }), chamadas);
  const resp = await comFetchMockado(
    () => handler(requestFake("quais cursos vocês têm?"), supabaseMock),
    JSON.stringify({ unidade: null, quer_sair: false, mudou_de_assunto: true, pergunta_geral: false, pedido_depende_unidade: true }),
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  const body = await resp.json();
  assertStringIncludes(body.resposta ?? "", MENU_UNIDADES, "deveria pedir a unidade com o menu");
  const comecaComSaudacao = SAUDACOES_ABERTURA.some((s) => (body.resposta ?? "").startsWith(s));
  assertEquals(comecaComSaudacao, false, "conversa já engajada — não pode repetir SAUDACOES_ABERTURA ao pedir a unidade");
  const gravouAguardando = chamadas.some((c) =>
    c.tabela === "conversas" && c.metodo === "update" && (c.payload as { metadata?: Record<string, unknown> })?.metadata?.aguardando_unidade === true
  );
  assertEquals(gravouAguardando, true, "deveria transicionar pro estado aguardando_unidade=true, igual ao branch de 1ª mensagem quando pedido_depende_unidade=true");
});

Deno.test("S-WM-31 item 6: cortesia pura na 1ª mensagem grava conversa_engajada=true (fecha o branch de decidirPrimeiraMensagem)", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const supabaseMock = criarSupabaseMock(respostasBaseHandler({}), chamadas);
  const resp = await comFetchMockado(
    () => handler(requestFake("bom dia"), supabaseMock),
    JSON.stringify({ unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false }),
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  const gravouEngajada = chamadas.some((c) =>
    c.tabela === "conversas" && c.metodo === "update" && (c.payload as { metadata?: Record<string, unknown> })?.metadata?.conversa_engajada === true
  );
  assertEquals(gravouEngajada, true, "cortesia pura na 1ª mensagem precisa marcar conversa_engajada=true — sem isso, a PRÓXIMA mensagem reseta pra saudação de novo (Causa raiz B)");
});

Deno.test("S-WM-31 (ampliação Task 3/4): cortesia resolvida dentro de aguardando_unidade também grava conversa_engajada=true", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const supabaseMock = criarSupabaseMock(respostasBaseHandler({ aguardando_unidade: true }), chamadas);
  const resp = await comFetchMockado(
    () => handler(requestFake("valeu!"), supabaseMock),
    JSON.stringify({ unidade: null, quer_sair: false, mudou_de_assunto: true, pergunta_geral: false, pedido_depende_unidade: false }),
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  const gravouEngajada = chamadas.some((c) =>
    c.tabela === "conversas" && c.metodo === "update" && (c.payload as { metadata?: Record<string, unknown> })?.metadata?.conversa_engajada === true
  );
  assertEquals(gravouEngajada, true, "cortesia resolvida dentro de aguardando_unidade (supera VAL-13, Task 3) também precisa marcar conversa_engajada=true — senão a PRÓXIMA mensagem cai no branch de 1ª mensagem e reseta pra saudação (Causa raiz B reaparecendo neste caminho)");
});

// ── VAL-12: pergunta institucional real já na 1ª mensagem não força o menu ──────────────────
Deno.test("VAL-12: decidirPrimeiraMensagem com pergunta_geral=true não força o menu (segue pro fluxo normal)", () => {
  const decisao = decidirPrimeiraMensagem(undefined, { unidade: null, quer_sair: false, mudou_de_assunto: true, pergunta_geral: true });
  assertEquals(decisao.unidadeSelecionada, null);
  assertEquals(decisao.aguardandoUnidade, false, "VAL-12: pergunta geral real não pode deixar a conversa aguardando unidade");
  assertEquals(decisao.resposta, null, "VAL-12: resposta=null sinaliza 'siga o fluxo normal' — não é pra responder com o menu canned");
});

// ── Item 1 (S-WM-21) / Backlog 4b: saudação de abertura no fallback de decidirPrimeiraMensagem ──
// Esse branch nunca chama GPT (nem antes, nem depois desta mudança) — a variação vem de um
// array fixo (SAUDACOES_ABERTURA) sorteado localmente, não gerado por modelo. Escolha aleatória
// em vez de rotação por índice: mais simples e os testes abaixo provam a variação de forma
// estatística (100 chamadas sem seed fixo), não determinística — trade-off aceito.
//
// Item 1 dividiu este branch em dois: `pedido_depende_unidade=false` (cortesia pura / mensagem
// aberta, ex.: "bom dia", "quero saber sobre vocês") não recebe mais o menu — só saudação +
// pergunta aberta (AC1). `pedido_depende_unidade=true` (ex.: "quais cursos vocês têm") preserva
// o comportamento antigo: saudação + MENU_UNIDADES (AC2). O teste original ("Backlog 4b") testava
// só o caso default (pedido_depende_unidade ausente/false) esperando menu — isso é exatamente o
// "engessamento" que o Item 1 corrige, por isso a expectativa mudou.
Deno.test("Item 1 / AC1: cortesia pura (pedido_depende_unidade=false) recebe saudação + pergunta aberta, SEM o menu", () => {
  const avaliacaoCortesia = { unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false };
  const respostasObservadas = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const decisao = decidirPrimeiraMensagem(undefined, avaliacaoCortesia);
    assertEquals(decisao.unidadeSelecionada, null);
    assertEquals(decisao.aguardandoUnidade, false, "AC1: cortesia pura não pode travar aguardando_unidade — a próxima mensagem precisa ser reavaliada do zero, não cair no reforço do menu (VAL-13)");
    assertEquals(
      (decisao.resposta ?? "").includes(MENU_UNIDADES),
      false,
      "AC1: cortesia pura não pode vir com o menu de unidades anexado — era exatamente esse o 'menu engessado' reportado",
    );
    const comecaComSaudacaoConhecida = SAUDACOES_ABERTURA.some((s) => decisao.resposta?.startsWith(s));
    assertEquals(comecaComSaudacaoConhecida, true, "AC1: a resposta precisa começar com uma das saudações de SAUDACOES_ABERTURA, seguida de pergunta aberta");
    respostasObservadas.add(decisao.resposta ?? "");
  }
  assertEquals(
    respostasObservadas.size > 1,
    true,
    "em 100 chamadas sem seed fixo, esperava-se mais de uma variação de saudação (probabilidade de sempre sair a mesma, com 6 opções, é (1/6)^99 — praticamente zero); se sempre igual, a escolha aleatória não está funcionando",
  );
});

Deno.test("Item 1 / AC2: pedido que depende de unidade (pedido_depende_unidade=true) continua recebendo o menu", () => {
  const avaliacaoPedidoUnidade = { unidade: null, quer_sair: false, mudou_de_assunto: true, pergunta_geral: false, pedido_depende_unidade: true };
  const decisao = decidirPrimeiraMensagem(undefined, avaliacaoPedidoUnidade);
  assertEquals(decisao.unidadeSelecionada, null);
  assertEquals(decisao.aguardandoUnidade, true, "AC2: um pedido que depende de unidade (ex.: 'quais cursos vocês têm') ainda precisa aguardar a escolha");
  assertStringIncludes(decisao.resposta ?? "", MENU_UNIDADES, "AC2: comportamento preservado — a resposta precisa conter o menu de unidades na íntegra");
  const comecaComSaudacaoConhecida = SAUDACOES_ABERTURA.some((s) => decisao.resposta?.startsWith(s));
  assertEquals(comecaComSaudacaoConhecida, true, "AC2: a saudação de abertura continua na frente do menu, comportamento preservado");
});

Deno.test("VAL-12: decidirAguardandoUnidade (branch mudou_de_assunto) com pergunta_geral=true também segue pro fluxo normal", () => {
  const decisao = decidirAguardandoUnidade(undefined, { unidade: null, quer_sair: false, mudou_de_assunto: true, pergunta_geral: true });
  assertEquals(decisao.unidadeSelecionada, null);
  assertEquals(decisao.aguardandoUnidade, false);
  assertEquals(decisao.resposta, null, "VAL-12: mesma convenção do branch de 1ª mensagem — resposta=null segue pro RAG geral");
});

// Prova a wiring no HANDLER: pergunta geral na 1ª mensagem (sem nome direto de unidade) precisa
// chegar ao Passo 6 e usar p_tipos:["FAQ"] isolado — não o conjunto misto de RAG_FONTES_POR_AGENTE
// (que incluiria monthly_program, sempre atrelado a uma unidade específica; ver diagnóstico E3/E4).
// O classificador (avaliarSelecaoUnidade) é a MESMA chamada chat/completions que o
// comFetchMockado intercepta — respostaChatCompletions aqui é o JSON que o classificador espera;
// a resposta final do GPT (chamarGPT, mais adiante no handler) reaproveita esse mesmo texto
// canned, o que é inofensivo pra esta prova (só interessa o parâmetro passado pra RPC).
Deno.test("VAL-12 (handler): pergunta geral na 1ª mensagem busca RAG com p_tipos:['FAQ'] isolado e p_unidade_cuca:null", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const supabaseMock = criarSupabaseMock(respostasBaseHandler({}), chamadas); // 1ª mensagem: sem aguardando, sem unidade_selecionada
  await comFetchMockado(
    async () => {
      const resp = await handler(requestFake("a rede CUCA é da prefeitura?"), supabaseMock);
      assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
    },
    JSON.stringify({ unidade: null, quer_sair: false, mudou_de_assunto: true, pergunta_geral: true }),
  );
  const chamadaRag = chamadas.find((c) => c.tabela === "rpc:buscar_chunks_similares");
  assertEquals(
    chamadaRag !== undefined,
    true,
    "VAL-12: pergunta geral deveria chegar ao Passo 6 e chamar buscar_chunks_similares, não fazer early-return com o menu",
  );
  const paramsRag = chamadaRag?.args?.[0] as { p_tipos?: string[]; p_unidade_cuca?: string | null } | undefined;
  assertEquals(
    paramsRag?.p_tipos,
    ["FAQ"],
    "VAL-12: pergunta geral sem unidade escolhida deve buscar SÓ em FAQ, isolado de monthly_program/eventos_pontuais — evita vazar conteúdo de uma unidade aleatória",
  );
  assertEquals(
    paramsRag?.p_unidade_cuca,
    null,
    "VAL-12: sem unidade escolhida ainda, a busca não pode filtrar por nenhuma unidade específica",
  );
});

// Prova a wiring no HANDLER, não só a função pura acima — mesma lição do AUD-04: a função
// pura podia mudar sem o call-site consumir `unidadeSelecionada`, deixando o bug real (rodada
// extra) intacto. `metadata: {}` numa conversa EXISTENTE ("ativa") isola a contribuição do
// fix — se `conversaJustCreated` fosse true (conversa nova/inserida), precisaVisaoGeral já
// daria true de qualquer jeito, mascarando se o fix realmente funciona.
Deno.test("AUD-07 (handler): unidade já citada na 1ª mensagem carrega a visão geral completa, sem rodada extra", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const supabaseMock = criarSupabaseMock(
    respostasBaseHandler({}), // conversa existente, metadata vazio — nem aguardando, nem unidade salva
    chamadas,
  );
  await comFetchMockado(async () => {
    const resp = await handler(requestFake("quero saber da Barra"), supabaseMock);
    assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  });
  const carregouProgramacaoCompleta = chamadas.some((c) => c.tabela === "documentos_rag");
  assertEquals(
    carregouProgramacaoCompleta,
    true,
    "AUD-07: unidade já citada na 1ª mensagem ('Barra') deveria carregar a programação completa (documentos_rag) na mesma resposta, sem forçar uma rodada extra de menu — mas o call-site descartava unidadeSelecionada e sempre retornava o menu cedo",
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

// ── Item 4 (S-WM-21, VAL-06): fallback semântico de troca de unidade mal formulada + pergunta
// em ambiguidade, no branch de unidade já selecionada (handler, seção 5b) ───────────────────────
Deno.test("Item 4 / AC7: mensagem indireta ('unidade que fica pertinho de casa') confirma troca via avaliação semântica", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const supabaseMock = criarSupabaseMock(respostasBaseHandler({ unidade_selecionada: "Cuca Barra" }), chamadas);
  const { linhas } = await comFetchMockado(
    () => comConsoleLogCapturado(() => handler(requestFake("quero saber de outra unidade, tipo a que fica pertinho da minha casa"), supabaseMock)),
    JSON.stringify({ unidade: "Cuca José Walter", quer_sair: false, mudou_de_assunto: true, pergunta_geral: false, pedido_depende_unidade: false }),
  );
  const logouTroca = linhas.some((l) => l.includes("Troca de unidade (semantica): Cuca Barra -> Cuca José Walter"));
  assertEquals(
    logouTroca,
    true,
    "AC7: detectarTrocaUnidade não acha nada nessa frase indireta (sem nome de unidade), mas pareceIntencaoTrocaUnidade dispara (contém 'unidade') e a avaliação semântica identifica 'Cuca José Walter' — deveria confirmar a troca, não continuar respondendo pela unidade antiga",
  );
});

Deno.test("Item 4 / AC8: intenção de trocar sem unidade identificável pergunta em vez de manter a unidade errada em silêncio", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const supabaseMock = criarSupabaseMock(respostasBaseHandler({ unidade_selecionada: "Cuca Barra" }), chamadas);
  const resp = await comFetchMockado(
    () => handler(requestFake("acho que quero mudar de unidade, mas não sei bem pra qual ainda"), supabaseMock),
    JSON.stringify({ unidade: null, quer_sair: false, mudou_de_assunto: true, pergunta_geral: false, pedido_depende_unidade: false }),
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  const body = await resp.json();
  assertStringIncludes(body.resposta ?? "", "unidade", "AC8: a pergunta de ambiguidade deveria perguntar qual unidade, não silenciosamente manter a unidade antiga");
  const carregouProgramacaoCompleta = chamadas.some((c) => c.tabela === "documentos_rag");
  assertEquals(carregouProgramacaoCompleta, false, "AC8: ambiguidade real deveria pausar em uma pergunta de confirmação, sem seguir pro Passo 6 (RAG) na mesma resposta");
});

Deno.test("Item 4: falha técnica na avaliação semântica (JSON inválido) NÃO gera pergunta de ambiguidade — cai no fallback seguro (mantém a unidade atual, mesmo comportamento de hoje)", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const supabaseMock = criarSupabaseMock(respostasBaseHandler({ unidade_selecionada: "Cuca Barra" }), chamadas);
  // comFetchMockado sem 2º argumento devolve "Resposta de teste" (não é JSON válido) para
  // QUALQUER chamada de chat/completions, incluindo avaliarSelecaoUnidade — simula uma falha
  // real de parsing/rede sem precisar derrubar o fetch inteiro.
  const resp = await comFetchMockado(() => handler(requestFake("posso escolher outra unidade?"), supabaseMock));
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  const body = await resp.json();
  assertEquals(
    (body.resposta ?? "").includes("Só pra confirmar"),
    false,
    "uma falha técnica na chamada semântica (fallback AVALIACAO_SELECAO_UNIDADE_DEFAULT, mudou_de_assunto=false) não pode virar uma pergunta de ambiguidade pro lead — precisa cair em silêncio no mesmo comportamento de hoje (manter a unidade atual)",
  );
});

// ── Item 5 (S-WM-21, cont. AUD-13): avaliarSelecaoUnidade ganha o mesmo retry/backoff que
// chamarGPT já tinha — antes, um 429/5xx aqui caía direto no fallback seguro sem tentar de novo ──
Deno.test("Item 5 / AC10: avaliarSelecaoUnidade tenta de novo após 429 e retorna a classificação real na 2ª tentativa", async () => {
  let chamadasFetch = 0;
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (() => {
    chamadasFetch++;
    if (chamadasFetch === 1) {
      // retry-after: 0 mantém o teste rápido (sem esperar de verdade) — só prova que o
      // caminho de retry foi exercitado, não a duração real do backoff (já coberta por
      // parseRetryAfterSegundos/deveTentarNovamente isoladamente).
      return Promise.resolve(new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }));
    }
    const conteudo = JSON.stringify({ unidade: "Cuca Barra", quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false });
    return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: conteudo } }] }), { status: 200 }));
  }) as typeof fetch;

  try {
    const resultado = await avaliarSelecaoUnidade("quero saber da barra", "fake-key");
    assertEquals(chamadasFetch, 2, "AC10: esperava-se exatamente 1 nova tentativa após o 429 (2 chamadas fetch no total)");
    assertEquals(resultado.unidade, "Cuca Barra", "AC10: depois do retry, a classificação real da 2ª tentativa deveria ser retornada — antes desse fix, o 429 já caía direto no fallback seguro (unidade: null) sem tentar de novo");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

Deno.test("Item 5 / AC11: erro não-transitório (400) cai direto no fallback seguro, sem tentar de novo", async () => {
  let chamadasFetch = 0;
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (() => {
    chamadasFetch++;
    return Promise.resolve(new Response("bad request", { status: 400 }));
  }) as typeof fetch;

  try {
    const resultado = await avaliarSelecaoUnidade("qualquer mensagem", "fake-key");
    assertEquals(chamadasFetch, 1, "AC11: um erro não-transitório (400) não deveria acionar nenhuma nova tentativa");
    assertEquals(
      resultado,
      { unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false },
      "AC11: mesmo comportamento de hoje pra erro não-transitório — cai no fallback seguro sem quebrar o fluxo",
    );
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

// ── AUD-13: retry cobre só 429, não 5xx transitório ─────────────────────────
Deno.test("AUD-13: um 503 transitório da OpenAI também deveria ser retentado, não só 429", () => {
  assertEquals(
    deveTentarNovamente(503, 0),
    true,
    "AUD-13: erros 5xx transitórios da OpenAI (500/502/503) também deveriam acionar o retry com backoff, mas hoje só 429 é tratado — um 503 vira 'problema técnico' imediato para o lead",
  );
});

// ── VAL-04: observabilidade — dava para confirmar o AUD-04/VAL-02 só cruzando ausência de
// log com query manual no banco. Estes testes provam que o log agora expõe a decisão
// diretamente (docs/migracao-meta/VALIDACAO-producao-institucional.md). ──────────────────────
Deno.test("VAL-04: loga precisaVisaoGeral explicitamente (pergunta de acompanhamento, unidade já salva)", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const supabaseMock = criarSupabaseMock(
    respostasBaseHandler({ unidade_selecionada: "Cuca Mondubim" }), // unidade já resolvida, sem troca/seleção nesta mensagem
    chamadas,
  );
  const { linhas } = await comFetchMockado(() =>
    comConsoleLogCapturado(() => handler(requestFake("quem é o professor de natação?"), supabaseMock))
  );
  const logouDecisao = linhas.some((l) => l.includes("precisaVisaoGeral=false") && l.includes("Cuca Mondubim"));
  assertEquals(
    logouDecisao,
    true,
    "VAL-04: uma pergunta de acompanhamento (sem troca/seleção de menu) deveria logar precisaVisaoGeral=false explicitamente — hoje só dá pra inferir isso pela AUSÊNCIA da linha 'Chunks diretos monthly_program', o que exigiu perícia manual (log + query cruzada no banco) para confirmar VAL-01/VAL-02",
  );
});

Deno.test("VAL-04: loga quantos chunks a busca vetorial de acompanhamento retornou", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Barra" });
  respostas["rpc:buscar_chunks_similares"] = { data: [{ conteudo: "a" }, { conteudo: "b" }, { conteudo: "c" }] };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);
  const { linhas } = await comFetchMockado(() =>
    comConsoleLogCapturado(() => handler(requestFake("quem é o professor de natação?"), supabaseMock))
  );
  const logouContagem = linhas.some((l) => l.includes("Busca vetorial acompanhamento: 3 chunks") && l.includes("Cuca Barra"));
  assertEquals(
    logouContagem,
    true,
    "VAL-04: a busca vetorial de acompanhamento (p_limite=5, caminho que gerou 'João Silva' em VAL-02) deveria logar quantos chunks realmente voltaram — sem isso não dá pra distinguir 'a busca não achou o chunk certo' de 'o GPT ignorou o contexto que recebeu'",
  );
});

// ── VAL-07 (corrige AUD-15): reabertura de conversa encerrada não deveria ser tratada como
// primeiro contato quando já existe unidade selecionada ─────────────────────────────────────
Deno.test("VAL-07: reabrir conversa encerrada com unidade já selecionada NÃO deveria recarregar a visão geral completa", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Barra" });
  respostas["conversas"] = { data: { id: "conv-1", status: "encerrada", metadata: { unidade_selecionada: "Cuca Barra" } } };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);
  // Tarefa "remover .limit(40)" (2026-07-16): fingerprint via log, ver comentário no guard
  // AUD-04 acima (`.limit(40)` deixou de existir em carregarProgramacaoMensal).
  const { resultado, linhas } = await comFetchMockado(() =>
    comConsoleLogCapturado(() => handler(requestFake("posso escolher outra unidade?"), supabaseMock))
  );
  assertEquals(resultado.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  const carregouProgramacaoCompleta = linhas.some((l) => l.includes("Chunks diretos monthly_program:"));
  assertEquals(
    carregouProgramacaoCompleta,
    false,
    "VAL-07/AUD-15: reabrir uma conversa encerrada que já tinha unidade selecionada não deveria recarregar a programação completa via carregarProgramacaoMensal nem tratar a mensagem como 'primeira mensagem' — é uma continuação, não um primeiro contato",
  );
});

Deno.test("VAL-07: o log de precisaVisaoGeral reflete conversaGenuinamenteNova=false na reabertura (não conversaJustCreated, que continua true para não afetar a Sofia)", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Barra" });
  respostas["conversas"] = { data: { id: "conv-1", status: "encerrada", metadata: { unidade_selecionada: "Cuca Barra" } } };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);
  const { linhas } = await comFetchMockado(() =>
    comConsoleLogCapturado(() => handler(requestFake("quem é o professor de natação?"), supabaseMock))
  );
  const logouCorreto = linhas.some((l) => l.includes("precisaVisaoGeral=false") && l.includes("conversaGenuinamenteNova=false"));
  assertEquals(logouCorreto, true, "VAL-07: a reabertura de uma conversa com unidade já salva deveria logar conversaGenuinamenteNova=false e precisaVisaoGeral=false");
});

// ── VAL-08 (variante do AUD-09): dígito solto só conta como resposta a menu se a última
// mensagem do agente realmente foi um menu numerado ─────────────────────────────────────────
Deno.test("ultimaMensagemEhMenuNumerado: reconhece MENU_UNIDADES", () => {
  assertEquals(ultimaMensagemEhMenuNumerado(MENU_UNIDADES), true);
});

Deno.test("ultimaMensagemEhMenuNumerado: reconhece um menu de categorias com linhas numeradas", () => {
  const menuCategoria = "1️⃣ Esportes\n2️⃣ Cursos e Oficinas\n3️⃣ Atividades Culturais\n4️⃣ Tecnologia";
  assertEquals(ultimaMensagemEhMenuNumerado(menuCategoria), true);
});

Deno.test("ultimaMensagemEhMenuNumerado: rejeita uma pergunta em texto livre sem nenhuma linha numerada", () => {
  assertEquals(ultimaMensagemEhMenuNumerado("Qual unidade você quer saber mais?"), false);
});

Deno.test("VAL-08: dígito respondendo pergunta improvisada do GPT (sem menu numerado) NÃO deveria recarregar a visão geral completa", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Barra" });
  respostas["mensagens"] = { data: [{ conteudo: "Qual unidade você quer saber mais?", remetente: "agente" }] };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);
  // Tarefa "remover .limit(40)" (2026-07-16): fingerprint via log, ver comentário no guard
  // AUD-04 acima (`.limit(40)` deixou de existir em carregarProgramacaoMensal).
  const { resultado, linhas } = await comFetchMockado(() =>
    comConsoleLogCapturado(() => handler(requestFake("2"), supabaseMock))
  );
  assertEquals(resultado.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  const carregouProgramacaoCompleta = linhas.some((l) => l.includes("Chunks diretos monthly_program:"));
  assertEquals(
    carregouProgramacaoCompleta,
    false,
    "VAL-08: '2' respondendo uma pergunta que o GPT improvisou em texto livre (sem nenhuma lista numerada) não deveria disparar precisaVisaoGeral — antes desse fix, qualquer dígito 1-5 sozinho contava como 'seleção de menu' independente do que a última mensagem do agente realmente foi",
  );
});

// ── Item 3 (S-WM-21, cont. VAL-08): checagem por ESTADO da conversa (metadata.menu_categoria_
// ativo), não mais por formato de texto — fecha a lacuna que o próprio VAL-08 original já
// documentava (GPT pode improvisar algo com CARA de lista numerada sem o código ter convidado
// nenhuma seleção; texto sozinho não distingue os dois casos, só o estado sabe) ─────────────────
Deno.test("Item 3 / AC5: dígito respondendo uma lista IMPROVISADA pelo GPT (sem estado de menu real) NÃO recarrega a visão geral", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  // metadata SEM menu_categoria_ativo — nenhum menu real foi convidado pelo código no turno
  // anterior, mesmo que o texto do GPT tenha "cara" de lista numerada.
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Barra" });
  respostas["mensagens"] = { data: [{ conteudo: "1. Você pode ver os horários\n2. Ou falar com a unidade", remetente: "agente" }] };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);
  // Tarefa "remover .limit(40)" (2026-07-16): fingerprint via log, ver comentário no guard
  // AUD-04 acima (`.limit(40)` deixou de existir em carregarProgramacaoMensal).
  const { resultado, linhas } = await comFetchMockado(() =>
    comConsoleLogCapturado(() => handler(requestFake("2"), supabaseMock))
  );
  assertEquals(resultado.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  const carregouProgramacaoCompleta = linhas.some((l) => l.includes("Chunks diretos monthly_program:"));
  assertEquals(
    carregouProgramacaoCompleta,
    false,
    "AC5: mesmo com uma lista numerada de aparência real na última mensagem do GPT, sem o ESTADO (metadata.menu_categoria_ativo) confirmando que o código convidou uma seleção, o dígito não pode recarregar a visão geral — essa era a lacuna que a checagem por formato de texto (VAL-08 original) não cobria",
  );
});

Deno.test("Item 3 / AC6 (regressão de VAL-08): dígito respondendo um menu de categorias REAL (estado confirmado) continua recarregando a visão geral", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  // metadata COM menu_categoria_ativo=true — representa o código tendo de fato convidado uma
  // seleção de área no turno anterior (branch precisaVisaoGeral=true).
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Barra", menu_categoria_ativo: true });
  respostas["mensagens"] = { data: [{ conteudo: "1️⃣ Esportes\n2️⃣ Cursos e Oficinas\n3️⃣ Atividades Culturais\n4️⃣ Tecnologia", remetente: "agente" }] };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);
  await comFetchMockado(async () => {
    const resp = await handler(requestFake("2"), supabaseMock);
    assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  });
  const carregouProgramacaoCompleta = chamadas.some((c) => c.tabela === "documentos_rag");
  assertEquals(
    carregouProgramacaoCompleta,
    true,
    "AC6: com o estado confirmando um menu de categorias real, '2' ainda deve carregar a área selecionada — não pode regredir o caso legítimo do VAL-08 original",
  );
});

// ── Tarefa "remover .limit(40)" (2026-07-16): carregarProgramacaoMensal deixou de truncar a
// visão geral completa — José Walter e Pici já têm 55 chunks reais em produção hoje (146 e 124
// atividades na campanha ativa, respectivamente), e o teto antigo cortava 15 desses. Sem
// substituir por outro número fixo (nenhuma constante prevê o crescimento real, que variou
// 89-146 atividades nos últimos 3 meses) — só um alerta (console.warn) bem acima de qualquer
// volume já observado, pra sinalizar import duplicado/corrompido sem depender de monitoração
// ativa (o projeto não tem nenhuma hoje). ──────────────────────────────────────────────────────

Deno.test("Tarefa 'remover limit(40)': carregarProgramacaoMensal carrega TODOS os chunks, sem truncar em 40 (José Walter/Pici já têm 55 hoje)", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Jangurussu" });
  const N_CHUNKS = 55; // contagem real de José Walter/Pici hoje — o antigo .limit(40) cortaria 15
  respostas["chunks_documentos"] = {
    data: Array.from({ length: N_CHUNKS }, (_, i) => ({ conteudo: `TURMA_MARCADOR_${i + 1}` })),
  };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("Mondubim"), supabaseMock), // nome de outra unidade -> trocouUnidade=true -> carregarProgramacaoMensal
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");

  const promptFinal = bodiesEnviados.find((b) => b.includes("PROGRAMACAO MENSAL ATUAL")) ?? "";
  const faltando = Array.from({ length: N_CHUNKS }, (_, i) => `TURMA_MARCADOR_${i + 1}`)
    .filter((marcador) => !promptFinal.includes(marcador));
  assertEquals(
    faltando,
    [],
    `carregarProgramacaoMensal precisa carregar os ${N_CHUNKS} chunks inteiros, sem .limit(40) — marcadores ausentes do prompt final: ${faltando.join(", ")}`,
  );
});

Deno.test("Tarefa 'remover limit(40)': NÃO loga alerta com volume normal (90 chunks, abaixo do teto de 100)", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Jangurussu" });
  respostas["chunks_documentos"] = { data: Array.from({ length: 90 }, () => ({ conteudo: "x" })) };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resultado, linhas } = await comFetchMockado(() =>
    comConsoleLogCapturado(() => handler(requestFake("Mondubim"), supabaseMock))
  );
  assertEquals(resultado.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  assertEquals(
    linhas.some((l) => l.includes("ALERTA")),
    false,
    "90 chunks é dentro do maior volume real já visto em produção (55) com folga — não deveria disparar alerta, só faz mais sentido ficar de olho acima de 100",
  );
});

Deno.test("Tarefa 'remover limit(40)': loga alerta (console.warn) quando o monthly_program passa de 100 chunks", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Jangurussu" });
  respostas["chunks_documentos"] = { data: Array.from({ length: 150 }, () => ({ conteudo: "x" })) };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resultado, linhas } = await comFetchMockado(() =>
    comConsoleLogCapturado(() => handler(requestFake("Mondubim"), supabaseMock))
  );
  assertEquals(resultado.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  const linhaAlerta = linhas.find((l) => l.includes("ALERTA"));
  assertEquals(
    linhaAlerta !== undefined,
    true,
    "150 chunks é quase 3x o maior volume real já visto (55) — sem monitoração ativa no projeto hoje, precisa de um sinal que não dependa de alguém checar o log no momento certo",
  );
  assertStringIncludes(linhaAlerta ?? "", "150", "o alerta deveria citar a contagem real de chunks, não só um texto genérico");
});

Deno.test("Item 3: resposta de visão geral grava o novo estado de menu_categoria_ativo pro próximo turno", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  // Mesmo cenário do AUD-04 (resolução de unidade por NOME dentro de aguardando_unidade, sem
  // menu_categoria_ativo prévio) — trocouUnidade=true força precisaVisaoGeral=true. Além do
  // update já esperado pelo AUD-04 (grava unidade_selecionada), o Item 3 deveria gravar um 2º
  // update só pro novo estado de menu_categoria_ativo (valor mudou de ausente/false pra true).
  const supabaseMock = criarSupabaseMock(respostasBaseHandler({ aguardando_unidade: true }), chamadas);
  await comFetchMockado(async () => {
    const resp = await handler(requestFake("Mondubim"), supabaseMock);
    assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  });
  const updatesDeConversas = chamadas.filter((c) => c.tabela === "conversas" && c.metodo === "update").length;
  assertEquals(
    updatesDeConversas >= 2,
    true,
    "Item 3: esperava-se pelo menos 2 updates em conversas — 1 pra salvar a unidade escolhida (AUD-04, já existente) e 1 pra registrar o novo estado de menu_categoria_ativo=true (Item 3), já que o valor mudou em relação ao anterior (ausente/false)",
  );
});

// ── Fix CRITICAL (S-WM-21, achado do @qa Quinn): 2 writes de metadata no mesmo turno não podem
// mais se pisar — o 2º (Item 3) precisa MESCLAR sobre o que o 1º (seção 5b) acabou de gravar,
// não sobre a foto de conversa.metadata de ANTES da requisição. Estes testes checam o CONTEÚDO
// do último update, não só a contagem — é exatamente a asserção que faltava e deixou o bug
// original passar despercebido. ────────────────────────────────────────────────────────────────
Deno.test("Fix CRITICAL: resolver unidade (AUD-04) + Item 3 gravando menu_categoria_ativo no mesmo turno NÃO apaga a unidade escolhida", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const supabaseMock = criarSupabaseMock(respostasBaseHandler({ aguardando_unidade: true }), chamadas);
  await comFetchMockado(async () => {
    const resp = await handler(requestFake("Mondubim"), supabaseMock);
    assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  });
  const updatesDeConversas = chamadas.filter((c) => c.tabela === "conversas" && c.metodo === "update");
  const ultimoUpdate = updatesDeConversas[updatesDeConversas.length - 1];
  const metadataFinal = (ultimoUpdate?.payload as { metadata?: Record<string, unknown> } | undefined)?.metadata;
  assertEquals(
    metadataFinal?.unidade_selecionada,
    "Cuca Mondubim",
    "CRITICAL: o último update de conversas.metadata precisa continuar tendo unidade_selecionada='Cuca Mondubim' — antes do fix, o write do Item 3 (menu_categoria_ativo) mesclava sobre a foto ANTIGA de metadata (sem a unidade recém-escolhida) e apagava esse campo, porque .update({metadata:{...}}) no Supabase substitui a coluna inteira, não faz merge no banco",
  );
  assertEquals(
    metadataFinal?.aguardando_unidade,
    false,
    "CRITICAL: aguardando_unidade precisa continuar false (unidade já resolvida) — antes do fix, o write do Item 3 revertia esse campo pra true (valor de ANTES do turno), fazendo a próxima mensagem do lead reabrir o fluxo de espera de unidade por engano",
  );
  assertEquals(metadataFinal?.menu_categoria_ativo, true, "o próprio campo que o Item 3 queria gravar também precisa estar presente, claro");
});

Deno.test("Fix CRITICAL: troca semântica de unidade (Item 4) + Item 3 gravando menu_categoria_ativo no mesmo turno NÃO reverte a troca", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const supabaseMock = criarSupabaseMock(respostasBaseHandler({ unidade_selecionada: "Cuca Barra" }), chamadas);
  await comFetchMockado(
    () => handler(requestFake("quero saber de outra unidade, tipo a que fica pertinho da minha casa"), supabaseMock),
    JSON.stringify({ unidade: "Cuca José Walter", quer_sair: false, mudou_de_assunto: true, pergunta_geral: false, pedido_depende_unidade: false }),
  );
  const updatesDeConversas = chamadas.filter((c) => c.tabela === "conversas" && c.metodo === "update");
  const ultimoUpdate = updatesDeConversas[updatesDeConversas.length - 1];
  const metadataFinal = (ultimoUpdate?.payload as { metadata?: Record<string, unknown> } | undefined)?.metadata;
  assertEquals(
    metadataFinal?.unidade_selecionada,
    "Cuca José Walter",
    "CRITICAL: o último update precisa continuar com a unidade NOVA (José Walter) — antes do fix, o write do Item 3 revertia pra 'Cuca Barra' (a foto antiga, de antes da troca), silenciosamente desfazendo a troca que acabou de ser confirmada nesta mesma resposta",
  );
});

// ── Item 2 (S-WM-22, TOM-03b): split de resposta longa/listável em múltiplas mensagens ──────
const LISTA_5_CURSOS_HANDLER = [
  "Natacao - Ter/Qui/Sex",
  "Judo - Seg/Qua",
  "Informatica - Ter/Qui",
  "Reforco Escolar - Seg/Ter/Qua/Qui/Sex",
  "Musica - Sab",
].join("\n");

Deno.test("Item 2 / AC1-AC2: resposta longa vira N partes no JSON e N linhas em `mensagens` (1 por parte)", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const supabaseMock = criarSupabaseMock(respostasBaseHandler({ unidade_selecionada: "Cuca Barra" }), chamadas);
  const respostaLonga = "Claro! Aqui está a programação completa:\n\n" + LISTA_5_CURSOS_HANDLER + "\n\nQuer saber horários de alguma modalidade específica?";

  await comFetchMockado(async () => {
    const resp = await handler(requestFake("quem é o professor de natação?"), supabaseMock);
    assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
    const body = await resp.json();
    assertEquals(body.mensagens?.length, 3, "AC1: esperava 3 partes (abertura, lista, fechamento) no campo `mensagens` do JSON");
    assertEquals(body.resposta, body.mensagens.join("\n\n"), "`resposta` precisa continuar sendo o join das partes, pra não quebrar consumidor que só lê esse campo");
  }, respostaLonga);

  const insertsDeAgente = chamadas.filter((c) =>
    c.tabela === "mensagens" && c.metodo === "insert" && (c.payload as { remetente?: string } | undefined)?.remetente === "agente"
  );
  assertEquals(
    insertsDeAgente.length,
    3,
    "AC2: cada parte efetivamente gerada precisa virar sua própria linha em `mensagens` — não 1 linha só com o texto concatenado, senão o histórico do próximo turno fica incompleto",
  );
  const conteudos = insertsDeAgente.map((c) => (c.payload as { conteudo?: string }).conteudo);
  assertEquals(conteudos[1], LISTA_5_CURSOS_HANDLER, "a 2ª linha gravada precisa ser exatamente a lista, sem concatenar com a abertura/fechamento");
});

Deno.test("Item 2 / AC4: resposta curta continua indo como 1 única mensagem/1 única linha (comportamento preservado)", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const supabaseMock = criarSupabaseMock(respostasBaseHandler({ unidade_selecionada: "Cuca Barra" }), chamadas);
  await comFetchMockado(async () => {
    const resp = await handler(requestFake("quem é o professor de natação?"), supabaseMock);
    const body = await resp.json();
    assertEquals(body.mensagens, ["Resposta de teste"], "AC4: resposta curta (texto canned padrão do mock) não pode ser fatiada");
  });
  const insertsDeAgente = chamadas.filter((c) =>
    c.tabela === "mensagens" && c.metodo === "insert" && (c.payload as { remetente?: string } | undefined)?.remetente === "agente"
  );
  assertEquals(insertsDeAgente.length, 1, "AC4: resposta curta continua gerando só 1 linha em `mensagens`");
});

Deno.test("Item 2 / AC5: split acontece DEPOIS da tag [[HANDOVER]] — a tag crua nunca aparece em nenhuma parte", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const supabaseMock = criarSupabaseMock(respostasBaseHandler({ unidade_selecionada: "Cuca Barra" }), chamadas);
  const respostaComHandoverEList = "Vou te passar pra um atendente, mas antes segue a programação:\n\n" + LISTA_5_CURSOS_HANDLER + "\n\nJá te encaminho. [[HANDOVER]]";

  await comFetchMockado(async () => {
    const resp = await handler(requestFake("quero falar com atendente"), supabaseMock);
    const body = await resp.json();
    assertEquals(body.handover, true, "handover continua sendo detectado normalmente");
    assertEquals(body.mensagens.length, 3, "a tag removida ainda deixa uma resposta listável de 3 partes");
    for (const parte of body.mensagens as string[]) {
      assertEquals(parte.includes("[[HANDOVER]]"), false, "AC5: a tag crua não pode sobreviver em NENHUMA parte — o split só pode acontecer depois da remoção da tag");
    }
  }, respostaComHandoverEList);
});

// ── VAL-02: guardrail anti-alucinação — reforço com exemplo negativo explícito ──────────────
// Mitigação de prompt, NÃO uma correção comprovada: não é possível testar de forma
// determinística se o GPT (temperatura=0.7) vai obedecer a um exemplo negativo — isso exigiria
// rodar o modelo de verdade e não seria repetível. Este teste só prova que o texto do guardrail
// contém o reforço pedido pelo relatório; a eficácia real depende de reteste manual em produção.
Deno.test("VAL-02: guardrail (regra 1) inclui exemplo negativo explícito contra inventar nome de professor", () => {
  assertStringIncludes(
    INSTRUCAO_SEGURANCA.toLowerCase(),
    "joao silva",
    "VAL-02: a regra genérica ('NUNCA invente... nomes de professores') não impediu o GPT de inventar 'João Silva' numa pergunta de acompanhamento sobre Natação — o relatório pede reforçar com um exemplo negativo explícito",
  );
});

// ── VAL-24 (achado geo, PENDENCIAS-institucional-2026-07-15): guardrail contra alucinar ────
// proximidade geografica. Mesma limitacao do teste VAL-02 acima: so prova que o texto do
// guardrail contem a proibicao explicita — a eficacia real (o GPT de fato obedecer) depende de
// reteste manual em producao, nao e testavel de forma deterministica com temperatura > 0.
Deno.test("VAL-24 (geo): guardrail (regra 7) proibe explicitamente inventar proximidade geografica sem dado real no contexto", () => {
  const texto = INSTRUCAO_SEGURANCA.toLowerCase();
  assertStringIncludes(
    texto,
    "proximidade geografica",
    "achado 2026-07-15: bot respondeu 'CUCA José Walter' e depois 'CUCA Pici' pra mesma pergunta de proximidade (Bom Jardim), com o MESMO contexto carregado (resumo_rede + FAQ, nenhum dos dois com dado de bairro/distancia) — regra 7 precisa proibir isso explicitamente, regras 1-2 (atividade/horario/professor/modalidade) nao cobrem geografia",
  );
  assertStringIncludes(
    texto,
    "mais perto",
    "a regra precisa cobrir o fraseado real que causou o achado ('qual CUCA fica mais perto'), nao so um termo tecnico generico",
  );
});

// ── Backlog 4a: fallback para outros canais da Rede CUCA ────────────────────────────────────
// Regra de segurança inegociável: o número de WhatsApp de outro canal NUNCA vem do texto que
// o GPT gerou — só a INTENÇÃO, via tag [[ENCAMINHAR:canal]]. O código busca o número real em
// `configuracoes` e monta a mensagem inteira. Estes testes provam isso nos dois sentidos: o
// número certo aparece, E um número falso que o GPT tenha tentado colar no texto não aparece.

Deno.test("extrairTagComArgumento: detecta [[ENCAMINHAR:canal]] e captura o argumento em minúsculo", () => {
  const r = extrairTagComArgumento("Isso é com outro time! [[ENCAMINHAR:Empregabilidade]]", "encaminhar");
  assertEquals(r.encontrada, true);
  assertEquals(r.argumento, "empregabilidade");
  assertEquals(r.texto, "Isso é com outro time!");
});

Deno.test("extrairTagComArgumento: tolera espaçamento dentro dos colchetes e ao redor dos dois-pontos", () => {
  const r = extrairTagComArgumento("texto [[ ENCAMINHAR : acesso_cuca ]]", "encaminhar");
  assertEquals(r.encontrada, true);
  assertEquals(r.argumento, "acesso_cuca");
});

Deno.test("extrairTagComArgumento: encontrada=false e texto inalterado quando a tag não aparece", () => {
  const r = extrairTagComArgumento("resposta normal, sem tag nenhuma", "encaminhar");
  assertEquals(r.encontrada, false);
  assertEquals(r.argumento, null);
  assertEquals(r.texto, "resposta normal, sem tag nenhuma");
});

Deno.test("validarCanalEncaminhamento: aceita os 4 canais válidos", () => {
  for (const canal of ["empregabilidade", "acesso_cuca", "ouvidoria", "academia_enem"]) {
    assertEquals(validarCanalEncaminhamento(canal), canal);
  }
});

Deno.test("validarCanalEncaminhamento: nunca confia cegamente no argumento do GPT — rejeita canal fora da lista fechada", () => {
  assertEquals(validarCanalEncaminhamento("financeiro"), null, "canal inventado pelo GPT não pode passar");
  assertEquals(validarCanalEncaminhamento(null), null);
  assertEquals(validarCanalEncaminhamento(""), null);
});

Deno.test("montarMensagemEncaminhamento: empregabilidade com número — texto exato do sócio, com link wa.me", () => {
  assertEquals(
    montarMensagemEncaminhamento("empregabilidade", "5585986332359"),
    "Que legal seu interesse! 😊 Pra vagas de emprego e oportunidades de trabalho, quem cuida disso é a equipe de Empregabilidade da Rede CUCA — chama eles direto no wa.me/5585986332359 que te atendem certinho!",
  );
});

Deno.test("montarMensagemEncaminhamento: acesso_cuca com número — texto exato do sócio", () => {
  assertEquals(
    montarMensagemEncaminhamento("acesso_cuca", "5585900000001"),
    "Entendi! Pra reservar espaços do CUCA (salas, quadras, auditório etc.), quem cuida disso é o time de Acesso CUCA — fala com eles pelo wa.me/5585900000001 😉 Eles vão te passar a disponibilidade certinho!",
  );
});

Deno.test("montarMensagemEncaminhamento: ouvidoria com número — texto exato do sócio", () => {
  assertEquals(
    montarMensagemEncaminhamento("ouvidoria", "5585900000002"),
    "Obrigada por trazer isso. Pra registrar reclamação, sugestão ou elogio formal, o canal certo é a Ouvidoria da Rede CUCA — é só chamar no wa.me/5585900000002, eles vão te dar atenção total.",
  );
});

Deno.test("montarMensagemEncaminhamento: academia_enem com número — texto exato do sócio", () => {
  assertEquals(
    montarMensagemEncaminhamento("academia_enem", "5585900000003"),
    "Oi! Pra tudo sobre a Academia Enem — inscrição, aulas, cronograma — fala direto com a equipe deles no wa.me/5585900000003 📚 Eles vão te passar tudo certinho!",
  );
});

Deno.test("montarMensagemEncaminhamento: número null (os 3 canais pendentes hoje) mantém a explicação do canal, sem wa.me nem link quebrado", () => {
  for (const canal of ["empregabilidade", "acesso_cuca", "ouvidoria", "academia_enem"] as const) {
    const msg = montarMensagemEncaminhamento(canal, null);
    assertEquals(msg.includes("wa.me"), false, "canal=" + canal + ": sem número confirmado, a mensagem NÃO pode conter 'wa.me' (viraria um link quebrado tipo wa.me/None)");
    assertStringIncludes(msg, "em breve te passo o contato certinho aqui — já estamos organizando esse canal!");
  }
});

Deno.test("montarMensagemEncaminhamento: sanitiza número com símbolos (espaço/traço/parênteses/+) antes de montar o link wa.me", () => {
  const msg = montarMensagemEncaminhamento("empregabilidade", "+55 (85) 98633-2359");
  assertStringIncludes(msg, "wa.me/5585986332359");
  assertEquals(msg.includes("+"), false, "o link wa.me não pode carregar símbolos — só dígitos, formato wa.me/55XXXXXXXXXXX");
  assertEquals(msg.includes("("), false);
  assertEquals(msg.includes("-"), false);
});

Deno.test("montarMensagemEncaminhamento: número vazio depois de sanitizar (config malformada) cai no texto sem wa.me, nunca gera link quebrado", () => {
  const msg = montarMensagemEncaminhamento("ouvidoria", "não-confirmado");
  assertEquals(msg.includes("wa.me"), false);
});

// ── Handler completo: os 4 canais, incluindo o caso número=null ────────────────────────────
const NUMEROS_CANAIS_TESTE: Record<string, string | null> = {
  empregabilidade: "5585986332359",
  acesso_cuca: null,
  ouvidoria: "5585900000001",
  academia_enem: "5585900000002",
};

for (const canal of ["empregabilidade", "acesso_cuca", "ouvidoria", "academia_enem"] as const) {
  Deno.test(`backlog 4a (handler): canal=${canal} — resposta final usa o número da config, nunca o número que o GPT tentou colar no texto`, async () => {
    const chamadas: ChamadaRegistrada[] = [];
    const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Barra" });
    respostas["configuracoes"] = { data: { valor: NUMEROS_CANAIS_TESTE } };
    const supabaseMock = criarSupabaseMock(respostas, chamadas);

    // O GPT "tenta" colar um número FALSO no texto livre, além de emitir a tag — prova que o
    // código ignora esse número e usa só o que veio da config.
    const numeroFalsoDoGpt = "5599999999999";
    const respostaGptComTagETagFalsa = "Sobre isso, pode falar com eles no " + numeroFalsoDoGpt + "! [[ENCAMINHAR:" + canal + "]]";

    const resp = await comFetchMockado(
      () => handler(requestFake("pergunta fora do escopo do RAG"), supabaseMock),
      respostaGptComTagETagFalsa,
    );
    assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
    const body = await resp.json();

    assertEquals(
      body.resposta.includes(numeroFalsoDoGpt),
      false,
      "backlog 4a: o número que o GPT tentou colar no texto livre NUNCA pode aparecer na resposta final",
    );

    const numeroEsperado = NUMEROS_CANAIS_TESTE[canal];
    if (numeroEsperado) {
      assertStringIncludes(body.resposta, "wa.me/" + numeroEsperado, "a resposta final deveria conter o link wa.me com o número real vindo de `configuracoes`");
    } else {
      assertEquals(body.resposta.includes("wa.me"), false, "canal=" + canal + " sem número confirmado na config — a resposta não pode conter link wa.me quebrado");
      assertEquals(/\d{8,}/.test(body.resposta), false, "canal=" + canal + " sem número confirmado na config — a resposta não pode conter nenhum número");
    }
  });
}

Deno.test("backlog 4a (handler): canal inválido/alucinado pelo GPT não gera encaminhamento — mantém o texto normal do GPT", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Barra" });
  respostas["configuracoes"] = { data: { valor: NUMEROS_CANAIS_TESTE } };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const resp = await comFetchMockado(
    () => handler(requestFake("pergunta qualquer"), supabaseMock),
    "Resposta normal do GPT. [[ENCAMINHAR:financeiro]]",
  );
  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.resposta, "Resposta normal do GPT.", "canal fora da lista fechada não pode gerar mensagem de encaminhamento — só remove a tag mal-formada e mantém o texto do GPT");
});

// ── S-WM-32: consumo do resumo_rede nos 3 pontos de perguntaGeralAtiva=true ─────────────────
// Helper de fetch que, além de responder chat/completions, GRAVA o body de cada requisição —
// necessário pra inspecionar o prompt final (AC8: instrução de honestidade) e não só a
// resposta, diferente de comFetchMockado (que só intercepta/responde, não registra o pedido).
function comFetchMockadoCapturandoBody(
  fn: () => Promise<Response>,
  respostaChatCompletions = "Resposta de teste",
): Promise<{ resp: Response; bodiesEnviados: string[] }> {
  const fetchOriginal = globalThis.fetch;
  const bodiesEnviados: string[] = [];
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const urlStr = String(url instanceof Request ? url.url : url);
    if (urlStr.includes("api.openai.com/v1/embeddings")) {
      return Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: [0, 0, 0] }] }), { status: 200 }));
    }
    if (urlStr.includes("api.openai.com/v1/chat/completions")) {
      if (init?.body) bodiesEnviados.push(String(init.body));
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: respostaChatCompletions } }] }), { status: 200 }));
    }
    throw new Error("fetch não-mockado nesse teste: " + urlStr);
  }) as typeof fetch;
  return fn().then((resp) => ({ resp, bodiesEnviados })).finally(() => { globalThis.fetch = fetchOriginal; });
}

Deno.test("S-WM-49 VAL-20: handler repassa histórico ao avaliarSelecaoUnidade em aguardando_unidade", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ aguardando_unidade: true });
  respostas["mensagens"] = { data: [
    { conteudo: "é sim", remetente: "lead" },
    { conteudo: "Você quer saber de qual unidade CUCA?", remetente: "agente" },
    { conteudo: "quero saber sobre natação", remetente: "lead" },
  ] };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("é sim"), supabaseMock),
    JSON.stringify({ unidade: null, quer_sair: false, mudou_de_assunto: true, pergunta_geral: false, pedido_depende_unidade: true }),
  );

  assertEquals(resp.status, 200);
  const promptClassificador = bodiesEnviados.find((body) => body.includes("Retorne SOMENTE JSON com as chaves:")) ?? "";
  assertStringIncludes(promptClassificador, "Historico recente");
  assertStringIncludes(promptClassificador, "Lead: quero saber sobre natação");
  assertStringIncludes(promptClassificador, "Maria: Você quer saber de qual unidade CUCA?");
  assertStringIncludes(promptClassificador, "Mensagem do lead: é sim");
});

Deno.test("S-WM-32 AC2/AC3: pergunta de rede na 1ª mensagem carrega resumo_rede + FAQ, nunca monthly_program/eventos_pontuais sem unidade", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({});
  respostas["documentos_rag"] = { data: { id: "doc-resumo-rede", conteudo: "Natação: Cuca Barra, Cuca Mondubim" } };
  // FAQ precisa vir com conteúdo real no mock — senão a asserção de "FAQ combinado" passaria
  // por acidente batendo só no texto da instrução de honestidade (que também cita o nome do
  // bloco "CONTEXTO (FAQ)"), não no bloco de fato. Achado durante mutation testing desta Task.
  respostas["rpc:buscar_chunks_similares"] = { data: [{ conteudo: "O CUCA funciona de seg a sáb.", fonte_tipo: "FAQ" }] };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("quais unidades têm natação?"), supabaseMock),
    JSON.stringify({ unidade: null, quer_sair: false, mudou_de_assunto: true, pergunta_geral: true }),
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");

  const promptFinal = bodiesEnviados.find((b) => b.includes("RESUMO DA REDE"));
  assertStringIncludes(promptFinal ?? "", "Natação: Cuca Barra, Cuca Mondubim", "AC2: o resumo_rede ativo deveria ser carregado por inteiro e ir pro prompt final");
  assertStringIncludes(promptFinal ?? "", "O CUCA funciona de seg a sáb.", "AC2: FAQ isolado deveria continuar sendo combinado junto com o resumo_rede (conteúdo real do chunk, não só o nome do bloco), sem 3ª classificação");

  const chamouBuscaVetorialSemUnidadeParaProgramacao = chamadas.some((c) =>
    c.tabela === "rpc:buscar_chunks_similares" &&
    (c.args?.[1] as { p_unidade_cuca?: unknown; p_tipos?: string[] })?.p_unidade_cuca === null &&
    ((c.args?.[1] as { p_tipos?: string[] })?.p_tipos ?? []).some((t) => t === "monthly_program" || t === "eventos_pontuais")
  );
  assertEquals(chamouBuscaVetorialSemUnidadeParaProgramacao, false, "AC3: buscar_chunks_similares NUNCA pode ser chamado com p_unidade_cuca:null para monthly_program/eventos_pontuais — só resumo_rede (carregamento direto) cobre pergunta de rede");
});

Deno.test("S-WM-32 AC2: pergunta de rede dentro de aguardando_unidade também carrega resumo_rede + FAQ", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ aguardando_unidade: true });
  respostas["documentos_rag"] = { data: { id: "doc-resumo-rede", conteudo: "Judô: Cuca Pici, Cuca José Walter" } };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("onde tem judô?"), supabaseMock),
    JSON.stringify({ unidade: null, quer_sair: false, mudou_de_assunto: true, pergunta_geral: true }),
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  const promptFinal = bodiesEnviados.find((b) => b.includes("RESUMO DA REDE"));
  assertStringIncludes(promptFinal ?? "", "Judô: Cuca Pici, Cuca José Walter", "resumo_rede deveria ser carregado também quando perguntaGeralAtiva vem do branch aguardando_unidade");
});

Deno.test("S-WM-32 AC2: pergunta de rede dentro de conversa_engajada (3º branch) também carrega resumo_rede + FAQ", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ conversa_engajada: true });
  respostas["documentos_rag"] = { data: { id: "doc-resumo-rede", conteudo: "Karatê: Cuca Barra, Cuca Jangurussu" } };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("quais unidades ensinam karatê?"), supabaseMock),
    // VAL-19 (S-WM-50, achado @po): pergunta_geral precisa ser true aqui — "quais unidades
    // ensinam karatê?" é pergunta de rede de verdade, mesmo padrão dos 2 testes irmãos desta
    // S-WM-32 (branches "1ª mensagem" e "aguardando_unidade", que já usam pergunta_geral:true).
    // Antes do fix do VAL-19, este mock com pergunta_geral:false "passava" só porque o
    // catch-all buggy de decidirConversaEngajada ativava perguntaGeralAtiva=true de qualquer
    // jeito — não era um comportamento real pretendido, e sim o bug mascarando o mock errado.
    JSON.stringify({ unidade: null, quer_sair: false, mudou_de_assunto: true, pergunta_geral: true, pedido_depende_unidade: false }),
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  const promptFinal = bodiesEnviados.find((b) => b.includes("RESUMO DA REDE"));
  assertStringIncludes(promptFinal ?? "", "Karatê: Cuca Barra, Cuca Jangurussu", "resumo_rede deveria ser carregado também quando perguntaGeralAtiva vem do 3º branch conversa_engajada (S-WM-31)");
});

Deno.test("S-WM-32 AC8: sem resumo_rede disponível, o prompt reforça honestidade sobre a limitação (não compor lista sem fonte)", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({});
  respostas["documentos_rag"] = { data: { id: "doc-1" } }; // sem campo `conteudo` — resumo_rede ainda não existe/não foi gerado
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("tem curso de natação?"), supabaseMock),
    JSON.stringify({ unidade: null, quer_sair: false, mudou_de_assunto: true, pergunta_geral: true }),
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  const promptFinal = bodiesEnviados.find((b) => b.includes("INSTRUCAO CRITICA"));
  assertStringIncludes(
    promptFinal ?? "",
    "nao tem a programacao consolidada da rede toda",
    "AC8: sem resumo_rede (ou sem cobertura da atividade perguntada), o prompt precisa instruir o GPT a admitir a limitação honestamente, em vez de compor uma lista de atividades sem fonte real — achado de Junior em teste ao vivo (alucinação silenciosa)",
  );
});

Deno.test("S-WM-32: pergunta de UNIDADE ESPECÍFICA (não perguntaGeralAtiva) não recebe a instrução de honestidade de rede nem tenta carregar resumo_rede", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Barra" });
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("tem natação essa semana?"), supabaseMock),
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  const contemInstrucaoDeRede = bodiesEnviados.some((b) => b.includes("INSTRUCAO CRITICA"));
  assertEquals(contemInstrucaoDeRede, false, "pergunta de acompanhamento com unidade já escolhida não é perguntaGeralAtiva — não deveria receber a instrução de honestidade de rede (só relevante pra pergunta de rede inteira)");
});

// ── S-WM-34 (VAL-23): troca de unidade com pedido específico embutido não pode suprimir o dado ──
// Cenário reproduzido ao vivo: unidade A já selecionada (turno anterior), mensagem cita a
// unidade B E já traz um pedido específico junto — cai no branch detectarTrocaUnidade
// (unidadeSalva, index.ts:1002+), o caminho sem avaliação semântica que o teste ao vivo
// reproduziu. AC3 (caso reproduzido) e AC4 (caso são, não pode regredir) são testados
// isoladamente — dono único de cada um, sem duplicar entre si (ajuste do @po na validação).
Deno.test("S-WM-34 AC3: troca de unidade citada dentro de um pedido específico NÃO dispara a instrução de resumo geral (caso reproduzido ao vivo)", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Jangurussu" });
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("e no Mondubim, tem natação de noite?"), supabaseMock),
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");

  const promptFinal = bodiesEnviados.find((b) => b.includes("PROGRAMACAO MENSAL ATUAL")) ?? "";
  assertStringIncludes(
    promptFinal,
    "responda DIRETAMENTE ao pedido especifico",
    "AC3: mensagem com pedido específico embutido na troca de unidade deveria receber a instrução de resposta direta, não a de resumo geral",
  );
  assertEquals(
    promptFinal.includes("Apresente um resumo geral"),
    false,
    "AC3: NÃO pode disparar a instrução de resumo geral quando a mensagem já tem um pedido específico embutido — essa é a causa raiz do VAL-23 (dado certo carregado, resposta suprimida pela instrução genérica)",
  );
});

Deno.test("S-WM-34 AC4 (caso são, não pode regredir): troca de unidade SEM pedido específico continua disparando o resumo geral", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Jangurussu" });
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("Mondubim"), supabaseMock),
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");

  const promptFinal = bodiesEnviados.find((b) => b.includes("PROGRAMACAO MENSAL ATUAL")) ?? "";
  assertStringIncludes(
    promptFinal,
    "Apresente um resumo geral",
    "AC4: troca de unidade sem pedido específico (só o nome, sem '?' nem conteúdo extra) deveria continuar recebendo o resumo geral — comportamento atual preservado, sem regressão do fix de VAL-23",
  );
});

// ── S-WM-34 (VAL-23): as 3 rotas que já chamam avaliarSelecaoUnidade também reaproveitam
// pedido_depende_unidade (Task 2) — testado direto nas funções puras, sem precisar do handler.
Deno.test("S-WM-34 Task 2: decidirAguardandoUnidade propaga pedidoEspecifico=true quando pedido_depende_unidade=true (resolução via avaliarSelecaoUnidade)", () => {
  const decisao = decidirAguardandoUnidade(undefined, {
    unidade: "Cuca Mondubim",
    quer_sair: false,
    mudou_de_assunto: false,
    pergunta_geral: false,
    pedido_depende_unidade: true,
  });
  assertEquals(decisao.unidadeSelecionada, "Cuca Mondubim");
  assertEquals(decisao.pedidoEspecifico, true);
});

Deno.test("S-WM-34 Task 2: decidirAguardandoUnidade propaga pedidoEspecifico=false quando pedido_depende_unidade=false", () => {
  const decisao = decidirAguardandoUnidade(undefined, {
    unidade: "Cuca Mondubim",
    quer_sair: false,
    mudou_de_assunto: false,
    pergunta_geral: false,
    pedido_depende_unidade: false,
  });
  assertEquals(decisao.pedidoEspecifico, false);
});

Deno.test("S-WM-34 Task 2: decidirAguardandoUnidade usa mensagemTemPedidoEspecifico (heurística) quando a unidade resolve por match DIRETO, não por avaliarSelecaoUnidade", () => {
  const decisaoComPergunta = decidirAguardandoUnidade("Cuca Mondubim", { unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false }, "Mondubim, tem natação de noite?");
  assertEquals(decisaoComPergunta.pedidoEspecifico, true, "match direto + '?' na mensagem deveria contar como pedido específico, mesmo sem avaliarSelecaoUnidade ter rodado");

  const decisaoSemPergunta = decidirAguardandoUnidade("Cuca Mondubim", { unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false }, "Mondubim");
  assertEquals(decisaoSemPergunta.pedidoEspecifico, false, "match direto sem conteúdo extra não deveria contar como pedido específico");
});

Deno.test("S-WM-34 Task 2: decidirConversaEngajada propaga pedidoEspecifico nos dois caminhos (semântico e direto)", () => {
  const viaSemantica = decidirConversaEngajada(undefined, { unidade: "Cuca Pici", quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: true });
  assertEquals(viaSemantica.pedidoEspecifico, true);

  const viaDireta = decidirConversaEngajada("Cuca Pici", { unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false }, "tem judô no Pici?");
  assertEquals(viaDireta.pedidoEspecifico, true);
});

Deno.test("S-WM-34/S-WM-35: decidirPrimeiraMensagem usa heurística no match direto e pedido_depende_unidade no match semântico", () => {
  const comPedido = decidirPrimeiraMensagem("Cuca Barra", { unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false }, "quero saber da Barra, tem natação de manhã?");
  assertEquals(comPedido.pedidoEspecifico, true);

  const semPedido = decidirPrimeiraMensagem("Cuca Barra", { unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false }, "quero saber da Barra");
  assertEquals(semPedido.pedidoEspecifico, false);

  const semanticoComPedido = decidirPrimeiraMensagem(undefined, { unidade: "Cuca Pici", quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: true }, "e na unidade quatro?");
  assertEquals(semanticoComPedido.unidadeSelecionada, "Cuca Pici");
  assertEquals(semanticoComPedido.pedidoEspecifico, true);
});

// ── S-WM-34 (VAL-09) — cobertura end-to-end faltante apontada pelo gate do @qa (CONCERNS) ──────
// Diferente dos testes de extrairModalidades/detectarAtividadeMencionada (index.test.ts, funções
// puras), estes exercitam buscarAtividadeEspecifica de verdade via handler + mock do Supabase —
// miniatura do cenário real do Jangurussu (natação espalhada em chunks não-contíguos, intercalada
// com outras modalidades), provando o fix ponta a ponta, não só a lógica isolada.
Deno.test("S-WM-34 AC1/AC2: branch de acompanhamento recupera TODAS as menções de uma atividade dispersa em chunks não-contíguos (miniatura do Jangurussu)", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Jangurussu" }); // sem troca neste turno -> cai no branch de acompanhamento
  respostas["chunks_documentos"] = {
    data: [
      { conteudo: "== ESPORTES == • Natação Detalhes: Esporte Modalidade: Natação - Turma Turma 1 . Professor: Daniel Reis. Dias: Ter e Qui. Horário: 7h às 8h." },
      { conteudo: "• Futsal Detalhes: Esporte Modalidade: Futsal - Turma A . Professor: Bruno Santos. Dias: Qua e Sex. Horário: 8h às 9h." },
      { conteudo: "• Natação Detalhes: Esporte Modalidade: Natação - Turma Turma 2 . Professor: Daniel Reis. Dias: Qua e Sex. Horário: 18h às 19h." },
      { conteudo: "• Judô Detalhes: Esporte Modalidade: Judô - Turma B . Professor: Vanessa Andrade. Dias: Ter e Qui. Horário: 15h às 16h." },
      { conteudo: "• Natação Detalhes: Esporte Modalidade: Natação - Turma Turma 3 . Professor: Daniel Reis. Dias: Ter e Qui. Horário: 20h às 21h." },
    ],
  };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("tem natação de noite?"), supabaseMock),
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");

  const promptFinal = bodiesEnviados.find((b) => b.includes("atividade especifica")) ?? "";
  assertStringIncludes(promptFinal, "Turma 1", "AC1: deveria incluir a Turma 1 de natação (chunk não-contíguo)");
  assertStringIncludes(promptFinal, "Turma 2", "AC1: deveria incluir a Turma 2 de natação (chunk não-contíguo)");
  assertStringIncludes(promptFinal, "Turma 3", "AC1: deveria incluir a Turma 3 de natação (chunk não-contíguo) — as 3 juntas provam que a busca não para no 1º match, recupera TODAS as menções");

  const chamouBuscaVetorial = chamadas.some((c) => c.tabela === "rpc:buscar_chunks_similares");
  assertEquals(chamouBuscaVetorial, false, "AC1: quando a busca determinística encontra a atividade, não deveria cair no fallback vetorial");
});

Deno.test("S-WM-34 AC2: branch de acompanhamento cai no fallback vetorial quando a mensagem não cita nenhuma modalidade conhecida", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Jangurussu" });
  respostas["chunks_documentos"] = {
    data: [
      { conteudo: "== ESPORTES == • Natação Detalhes: Esporte Modalidade: Natação - Turma Turma 1 . Professor: Daniel Reis." },
      { conteudo: "• Futsal Detalhes: Esporte Modalidade: Futsal - Turma A . Professor: Bruno Santos." },
    ],
  };
  respostas["rpc:buscar_chunks_similares"] = { data: [{ conteudo: "Horário de funcionamento: seg a sáb, 8h às 21h.", fonte_tipo: "FAQ" }] };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("qual o horário de funcionamento?"), supabaseMock),
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");

  // Nota (achado durante esta correção): o mock de rpc() empilha os args como `[opcoes]` (nome vai
  // separado) — o índice correto do objeto de opções é `args[0]`, não `args[1]`. Um teste
  // pré-existente (S-WM-32, "AC3: buscar_chunks_similares NUNCA pode ser chamado...") usa
  // `args?.[1]`, que é sempre `undefined` — o teste passa hoje mas não testa de fato o que diz
  // testar (vacuamente verdadeiro). Não corrigido aqui (fora do escopo desta correção de CONCERNS,
  // pertence a outra story) — registrado no Dev Agent Record como achado adjacente.
  const chamouBuscaVetorial = chamadas.some((c) =>
    c.tabela === "rpc:buscar_chunks_similares" &&
    ((c.args?.[0] as { p_tipos?: string[] })?.p_tipos ?? []).includes("monthly_program")
  );
  assertEquals(chamouBuscaVetorial, true, "AC2 (rede de segurança): sem match de atividade, o fallback pro buscar_chunks_similares precisa disparar — comportamento anterior preservado");

  const promptFinal = bodiesEnviados.find((b) => b.includes("Horário de funcionamento")) ?? "";
  assertStringIncludes(promptFinal, "Horário de funcionamento", "AC2: o conteúdo do fallback vetorial deveria chegar no prompt final");
});

// ── S-WM-35 (Frente C) — busca determinística em atividades_mensais.metadata ────────────────────
// 6 cenários planejados: dado correto pós-B3, gap conhecido → "nao informado", modalidade não
// reconhecida → cai pro fallback S-WM-34, visão geral com/sem trocaComPedidoEspecifico, e
// documentos_rag sem doc ativo. Mesmo padrão de integração via `handler` + mock já usado nos
// testes S-WM-34 AC1-AC4 acima — exercita as 3 camadas (Frente C → S-WM-34 → vetorial) de
// ponta a ponta, não só a função pura (já coberta em index.test.ts).

Deno.test("S-WM-35: dado correto pós-B3 (José Walter) — busca determinística em atividades_mensais recupera TODAS as turmas, sem cair nos fallbacks", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca José Walter" }); // sem troca neste turno -> branch de acompanhamento
  respostas["documentos_rag"] = { data: { id: "doc-1", metadados: { campanha_id: "camp-jw" } } };
  respostas["atividades_mensais"] = {
    data: [
      { titulo: "NATAÇÃO", metadata: { turma: "Turma 09", professor: "CIRILLO", vagas: "25", sexo: "MISTO", dias_semana: "TER/QUI", horario: "18h ás 19h", faixa_etaria: "15 á 29+ anos" } },
      { titulo: "NATAÇÃO", metadata: { turma: "Turma 10", professor: "CIRILLO", vagas: "25", sexo: "MISTO", dias_semana: "TER/QUI", horario: "19h ás 20h", faixa_etaria: "15 á 29+ anos" } },
      { titulo: "JUDÔ", metadata: { turma: "Turma 01", professor: "Outro Professor", vagas: "20", sexo: "MISTO", dias_semana: "SEG/QUA", horario: "17h ás 18h", faixa_etaria: "10 á 14 anos" } },
    ],
  };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("tem natação de noite?"), supabaseMock),
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");

  const promptFinal = bodiesEnviados.find((b) => b.includes("atividade especifica")) ?? "";
  assertStringIncludes(promptFinal, "Turma 09", "deveria incluir a Turma 09 de natação");
  assertStringIncludes(promptFinal, "Turma 10", "deveria incluir a Turma 10 de natação — as 2 juntas provam que não para no 1º match");
  assertStringIncludes(promptFinal, "Idade: 15 á 29+ anos", "dado corrigido pela B3 (José Walter) deveria chegar correto, não 'nao informado'");
  assertEquals(promptFinal.includes("JUDÔ"), false, "não deveria misturar outra modalidade na resposta de natação");

  const chamouFallbackTexto = chamadas.some((c) => c.tabela === "chunks_documentos");
  assertEquals(chamouFallbackTexto, false, "quando a busca determinística (metadata) encontra a atividade, não deveria cair no fallback de texto (S-WM-34)");
  const chamouBuscaVetorial = chamadas.some((c) => c.tabela === "rpc:buscar_chunks_similares");
  assertEquals(chamouBuscaVetorial, false, "nem no fallback vetorial — a 1ª camada já resolveu");
});

Deno.test("S-WM-35: gap conhecido (Barra/Jangurussu/Mondubim/Pici) — faixa_etaria idêntica ao título vira 'nao informado' na resposta, nunca repete o dado errado", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Barra" });
  respostas["documentos_rag"] = { data: { id: "doc-2", metadados: { campanha_id: "camp-barra" } } };
  respostas["atividades_mensais"] = {
    data: [
      { titulo: "Natação", metadata: { turma: "Turma 11", professor: "CIRILLO", vagas: "25", sexo: "Misto", dias_semana: "Qua e Sex", horario: "07:00 ás 08:00", faixa_etaria: "NATAÇÃO" } },
    ],
  };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("tem natação de manhã?"), supabaseMock),
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");

  const promptFinal = bodiesEnviados.find((b) => b.includes("atividade especifica")) ?? "";
  assertStringIncludes(promptFinal, "Turma 11", "deveria incluir a turma encontrada mesmo com o gap conhecido no campo faixa_etaria");
  assertStringIncludes(promptFinal, "Idade: nao informado", "gap conhecido (S-WM-35 Achado 2, Frente B1) deveria virar 'nao informado', não repetir o título como se fosse a faixa etária real");
  assertEquals(promptFinal.includes("Idade: Natação") || promptFinal.includes("Idade: NATAÇÃO"), false, "nunca deveria expor o dado corrompido pro lead");
});

Deno.test("S-WM-35: modalidade não reconhecida em atividades_mensais cai pro fallback S-WM-34 (busca de texto), sem erro", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Jangurussu" });
  respostas["documentos_rag"] = { data: { id: "doc-3", metadados: { campanha_id: "camp-jg" } } };
  // atividades_mensais só tem Futsal -> detectarAtividadeMencionada não encontra "natação" nessa
  // camada, precisa cair pro fallback de texto (chunks_documentos), que tem a modalidade certa.
  respostas["atividades_mensais"] = { data: [{ titulo: "Futsal", metadata: { turma: "A", professor: "Bruno Santos" } }] };
  respostas["chunks_documentos"] = {
    data: [
      { conteudo: "== ESPORTES == • Natação Detalhes: Esporte Modalidade: Natação - Turma Turma 1 . Professor: Daniel Reis. Dias: Ter e Qui. Horário: 7h às 8h." },
      { conteudo: "• Natação Detalhes: Esporte Modalidade: Natação - Turma Turma 2 . Professor: Daniel Reis. Dias: Qua e Sex. Horário: 18h às 19h." },
    ],
  };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("tem natação de noite?"), supabaseMock),
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");

  const tentouCamada1 = chamadas.some((c) => c.tabela === "atividades_mensais");
  assertEquals(tentouCamada1, true, "a 1ª camada (metadata) precisa ser tentada antes de cair pro fallback, não pulada");

  const promptFinal = bodiesEnviados.find((b) => b.includes("atividade especifica")) ?? "";
  assertStringIncludes(promptFinal, "Turma 1", "sem match na 1ª camada, o fallback S-WM-34 (texto) deveria recuperar a atividade normalmente");
  assertStringIncludes(promptFinal, "Turma 2", "as 2 juntas provam que o fallback funcionou por completo, não só parcialmente");

  const chamouBuscaVetorial = chamadas.some((c) => c.tabela === "rpc:buscar_chunks_similares");
  assertEquals(chamouBuscaVetorial, false, "a 2ª camada (S-WM-34) já resolveu — não deveria precisar da 3ª (vetorial)");
});

Deno.test("S-WM-35: visão geral COM trocaComPedidoEspecifico soma o bloco 'ATIVIDADE ESPECIFICA' ao resumo geral, sem substituí-lo", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  // Mesmo cenário do S-WM-34 AC3 (troca de unidade com pedido específico embutido, caso
  // reproduzido ao vivo) — reaproveitado aqui pra provar que a Frente C soma dado exato ao
  // resumo geral quando trocaComPedidoEspecifico=true.
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Jangurussu" });
  respostas["documentos_rag"] = { data: { id: "doc-4", metadados: { campanha_id: "camp-mb" } } };
  respostas["atividades_mensais"] = {
    data: [{ titulo: "Natação", metadata: { turma: "Turma 05", professor: "Vanessa Andrade", vagas: "30", sexo: "Misto", dias_semana: "Seg/Qua/Sex", horario: "19h às 20h", faixa_etaria: "6 a 12 anos" } }],
  };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("e no Mondubim, tem natação de noite?"), supabaseMock),
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");

  const promptFinal = bodiesEnviados.find((b) => b.includes("PROGRAMACAO MENSAL ATUAL")) ?? "";
  assertStringIncludes(promptFinal, "PROGRAMACAO MENSAL ATUAL", "o resumo geral continua sendo carregado — a Frente C SOMA, não substitui");
  assertStringIncludes(promptFinal, "ATIVIDADE ESPECIFICA (dado exato)", "quando há pedido específico embutido na troca, deveria somar o bloco de dado exato");
  assertStringIncludes(promptFinal, "Turma 05", "o bloco somado deveria conter o dado real da atividade pedida");
});

Deno.test("S-WM-35: visão geral SEM trocaComPedidoEspecifico NÃO soma o bloco 'ATIVIDADE ESPECIFICA' (comportamento são, sem regressão do AC4/S-WM-34)", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  // Mesmo cenário do S-WM-34 AC4 (troca de unidade sem pedido específico, só o nome).
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Jangurussu" });
  respostas["documentos_rag"] = { data: { id: "doc-5", metadados: { campanha_id: "camp-mb" } } };
  respostas["atividades_mensais"] = {
    data: [{ titulo: "Natação", metadata: { turma: "Turma 05", professor: "Vanessa Andrade" } }],
  };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("Mondubim"), supabaseMock),
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");

  const promptFinal = bodiesEnviados.find((b) => b.includes("PROGRAMACAO MENSAL ATUAL")) ?? "";
  assertStringIncludes(promptFinal, "Apresente um resumo geral", "sem pedido específico, o comportamento são (resumo geral) precisa continuar intacto");
  assertEquals(promptFinal.includes("ATIVIDADE ESPECIFICA (dado exato)"), false, "sem pedido específico atual nem modalidade recuperável do histórico, a Frente C pode consultar mas não deve somar bloco específico");
});

Deno.test("S-WM-35: documentos_rag sem doc ativo — as 2 camadas determinísticas retornam null com segurança, cai pro fallback vetorial sem quebrar", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Jangurussu" });
  respostas["documentos_rag"] = { data: null }; // sem monthly_program ativo pra essa unidade
  respostas["rpc:buscar_chunks_similares"] = { data: [{ conteudo: "Horário de funcionamento: seg a sáb, 8h às 21h.", fonte_tipo: "FAQ" }] };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("tem natação de noite?"), supabaseMock),
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500) — sem doc ativo, tem que degradar com segurança, não quebrar");

  const consultouAtividadesMensais = chamadas.some((c) => c.tabela === "atividades_mensais");
  assertEquals(consultouAtividadesMensais, false, "sem documento ativo (sem campanha_id pra correlacionar), nem deveria tentar consultar atividades_mensais");

  const chamouBuscaVetorial = chamadas.some((c) => c.tabela === "rpc:buscar_chunks_similares");
  assertEquals(chamouBuscaVetorial, true, "as 2 camadas determinísticas (metadata e texto) precisam degradar com segurança pro fallback vetorial, já que nenhuma tem documento ativo pra consultar");

  const promptFinal = bodiesEnviados.find((b) => b.includes("Horário de funcionamento")) ?? "";
  assertStringIncludes(promptFinal, "Horário de funcionamento", "o conteúdo do fallback vetorial deveria chegar no prompt final mesmo nesse cenário degradado");
});

Deno.test("S-WM-35 follow-up: unidade salva + detectarTrocaUnidade recupera modalidade do histórico ao trocar unidade", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Barra" });
  respostas["mensagens"] = { data: [
    { conteudo: "e no Jangurussu?", remetente: "lead" },
    { conteudo: "Tem sim. Quer ver em outra unidade?", remetente: "agente" },
    { conteudo: "tem natação na Barra?", remetente: "lead" },
  ] };
  respostas["documentos_rag"] = { data: { id: "doc-jg", metadados: { campanha_id: "camp-jg" } } };
  respostas["atividades_mensais"] = {
    data: [
      { titulo: "Natação", categoria: "ESPORTES", metadata: { turma: "Turma 01", professor: "Daniel", vagas: "20", sexo: "Misto", dias_semana: "Ter/Qui", horario: "18h às 19h", faixa_etaria: "15 a 29 anos" } },
      { titulo: "Judô", categoria: "ESPORTES", metadata: { turma: "Turma 02", professor: "Vanessa" } },
    ],
  };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("e no Jangurussu?"), supabaseMock),
  );
  assertEquals(resp.status, 200);

  const promptFinal = bodiesEnviados.find((b) => b.includes("ATIVIDADE ESPECIFICA")) ?? "";
  assertStringIncludes(promptFinal, "ATIVIDADE ESPECIFICA (dado exato)", "deveria somar bloco exato mesmo sem repetir 'natação' na mensagem atual");
  assertStringIncludes(promptFinal, "Turma 01", "deveria recuperar Natação do histórico recente");
  assertStringIncludes(promptFinal, "liste TODAS as turmas", "prompt precisa instruir enumeração completa quando há dado exato");
  assertEquals(promptFinal.includes("Judô"), false, "não deveria misturar outra modalidade");
});

Deno.test("S-WM-35 follow-up: aguardando_unidade via classificador olha através do menu e recupera atividade anterior", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ aguardando_unidade: true });
  respostas["mensagens"] = { data: [
    { conteudo: "e na unidade quatro?", remetente: "lead" },
    { conteudo: MENU_UNIDADES, remetente: "agente" },
    { conteudo: "tem natação?", remetente: "lead" },
  ] };
  respostas["documentos_rag"] = { data: { id: "doc-pici", metadados: { campanha_id: "camp-pici" } } };
  respostas["atividades_mensais"] = {
    data: [{ titulo: "Natação", categoria: "ESPORTES", metadata: { turma: "Turma 04", professor: "CIRILLO", dias_semana: "Seg/Qua", horario: "19h às 20h" } }],
  };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("e na unidade quatro?"), supabaseMock),
    JSON.stringify({ unidade: "Cuca Pici", quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: true }),
  );
  assertEquals(resp.status, 200);

  const promptFinal = bodiesEnviados.find((b) => b.includes("ATIVIDADE ESPECIFICA")) ?? "";
  assertStringIncludes(promptFinal, "Turma 04", "janela de histórico deve atravessar a mensagem do agente/menu de unidades");
  assertStringIncludes(promptFinal, "UNIDADE: Cuca Pici", "unidade resolvida pelo classificador precisa ser preservada");
});

Deno.test("S-WM-35 follow-up: conversa_engajada via classificador recupera modalidade do histórico", async () => {
  const respostas = respostasBaseHandler({ conversa_engajada: true });
  respostas["mensagens"] = { data: [
    { conteudo: "e na unidade quatro?", remetente: "lead" },
    { conteudo: "Posso te ajudar escolhendo uma unidade.", remetente: "agente" },
    { conteudo: "tem natação?", remetente: "lead" },
  ] };
  respostas["documentos_rag"] = { data: { id: "doc-pici-2", metadados: { campanha_id: "camp-pici-2" } } };
  respostas["atividades_mensais"] = {
    data: [{ titulo: "Natação", categoria: "ESPORTES", metadata: { turma: "Turma 07", professor: "CIRILLO", dias_semana: "Ter/Qui", horario: "20h às 21h" } }],
  };
  const supabaseMock = criarSupabaseMock(respostas, []);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("e na unidade quatro?"), supabaseMock),
    JSON.stringify({ unidade: "Cuca Pici", quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: true }),
  );
  assertEquals(resp.status, 200);

  const promptFinal = bodiesEnviados.find((b) => b.includes("ATIVIDADE ESPECIFICA")) ?? "";
  assertStringIncludes(promptFinal, "Turma 07", "conversa_engajada também deve usar a mesma recuperação de modalidade do histórico");
});

Deno.test("S-WM-35 follow-up: primeira_mensagem via classificador recupera modalidade do histórico quando a conversa ainda não tem estado salvo", async () => {
  const respostas = respostasBaseHandler({});
  respostas["mensagens"] = { data: [
    { conteudo: "e na unidade quatro?", remetente: "lead" },
    { conteudo: "Sobre qual unidade você quer saber?", remetente: "agente" },
    { conteudo: "tem natação?", remetente: "lead" },
  ] };
  respostas["documentos_rag"] = { data: { id: "doc-pici-3", metadados: { campanha_id: "camp-pici-3" } } };
  respostas["atividades_mensais"] = {
    data: [{ titulo: "Natação", categoria: "ESPORTES", metadata: { turma: "Turma 08", professor: "CIRILLO", dias_semana: "Sex", horario: "18h às 19h" } }],
  };
  const supabaseMock = criarSupabaseMock(respostas, []);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("e na unidade quatro?"), supabaseMock),
    JSON.stringify({ unidade: "Cuca Pici", quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: true }),
  );
  assertEquals(resp.status, 200);

  const promptFinal = bodiesEnviados.find((b) => b.includes("ATIVIDADE ESPECIFICA")) ?? "";
  assertStringIncludes(promptFinal, "Turma 08", "primeira_mensagem/classificador também deve passar pelo fix compartilhado");
});

Deno.test("S-WM-35 follow-up: pedido amplo não reaproveita modalidade antiga e mantém fallback seguro", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Barra" });
  respostas["mensagens"] = { data: [
    { conteudo: "quais atividades tem no Jangurussu?", remetente: "lead" },
    { conteudo: "Tem natação na Barra.", remetente: "agente" },
    { conteudo: "tem natação na Barra?", remetente: "lead" },
  ] };
  respostas["documentos_rag"] = { data: { id: "doc-jg-neg", metadados: { campanha_id: "camp-jg-neg" } } };
  respostas["atividades_mensais"] = {
    data: [{ titulo: "Natação", categoria: "ESPORTES", metadata: { turma: "Turma 99", professor: "Daniel" } }],
  };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("quais atividades tem no Jangurussu?"), supabaseMock),
  );
  assertEquals(resp.status, 200);

  const promptFinal = bodiesEnviados.find((b) => b.includes("PROGRAMACAO MENSAL ATUAL")) ?? "";
  assertEquals(promptFinal.includes("ATIVIDADE ESPECIFICA"), false, "pergunta ampla deve cair no comportamento genérico seguro, sem herdar Natação do histórico");
});

Deno.test("S-WM-35 follow-up: pergunta de localização com unidade nova não injeta atividade antiga do histórico", async () => {
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Barra" });
  respostas["mensagens"] = { data: [
    { conteudo: "ah entendi, e o Pici, fica longe daqui?", remetente: "lead" },
    { conteudo: "Tem natação na Barra.", remetente: "agente" },
    { conteudo: "tem natação na Barra?", remetente: "lead" },
  ] };
  respostas["documentos_rag"] = { data: { id: "doc-pici-distancia", metadados: { campanha_id: "camp-pici-distancia" } } };
  respostas["atividades_mensais"] = {
    data: [{ titulo: "Natação", categoria: "ESPORTES", metadata: { turma: "Turma 01", professor: "CIRILLO" } }],
  };
  const supabaseMock = criarSupabaseMock(respostas, []);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("ah entendi, e o Pici, fica longe daqui?"), supabaseMock),
  );
  assertEquals(resp.status, 200);

  const promptFinal = bodiesEnviados.find((b) => b.includes("PROGRAMACAO MENSAL ATUAL")) ?? "";
  assertEquals(promptFinal.includes("ATIVIDADE ESPECIFICA"), false, "pergunta sobre distância/localização não deve receber bloco exato de Natação só porque Natação apareceu antes");
  assertEquals(promptFinal.includes("liste TODAS as turmas"), false, "sem bloco exato, não deve entrar a instrução de enumeração de turmas");
});

Deno.test("S-WM-35 follow-up: busca determinística cobre DIA A DIA/Direitos Humanos e instrução manda listar todas as linhas", async () => {
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Barra" });
  respostas["mensagens"] = { data: [
    { conteudo: "e no José Walter?", remetente: "lead" },
    { conteudo: "Na Barra encontrei opções de Direitos Humanos.", remetente: "agente" },
    { conteudo: "tem Direitos Humanos na Barra?", remetente: "lead" },
  ] };
  respostas["documentos_rag"] = { data: { id: "doc-jw-dia", metadados: { campanha_id: "camp-jw-dia" } } };
  respostas["atividades_mensais"] = {
    data: Array.from({ length: 9 }, (_, i) => ({
      titulo: "Direitos Humanos",
      categoria: "DIA A DIA",
      metadata: { turma: "Turma " + String(i + 1).padStart(2, "0"), professor: "Educador " + (i + 1), vagas: "25", sexo: "Misto", dias_semana: "Seg/Qua", horario: (8 + i) + "h às " + (9 + i) + "h", faixa_etaria: "15 a 29 anos" },
    })),
  };
  const supabaseMock = criarSupabaseMock(respostas, []);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("e no José Walter?"), supabaseMock),
  );
  assertEquals(resp.status, 200);

  const promptFinal = bodiesEnviados.find((b) => b.includes("ATIVIDADE ESPECIFICA")) ?? "";
  assertStringIncludes(promptFinal, "Categoria DIA A DIA - Atividade: Direitos Humanos", "categoria fora de ESPORTES precisa chegar pela busca determinística");
  assertStringIncludes(promptFinal, "Turma 01", "deveria incluir a primeira linha de Direitos Humanos");
  assertStringIncludes(promptFinal, "Turma 09", "deveria incluir a nona linha de Direitos Humanos, provando que não cortou volume");
  assertStringIncludes(promptFinal, "liste TODAS as turmas", "prompt precisa generalizar a enumeração completa para fora de Esportes");
});

// ── S-WM-37 (SEC-01): conversa_id não pode pertencer a outro lead ──────────────────────────

Deno.test("S-WM-37: conversa_id de outro lead é rejeitado com 403, sem gravar nada", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({});
  respostas["conversas"] = { data: { id: "conv-999", status: "ativa", metadata: {}, lead_id: "lead-OUTRO" } };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const resp = await comFetchMockado(() => handler(requestFakeComConversaId("oi", "conv-999"), supabaseMock));

  assertEquals(resp.status, 403);
  const body = await resp.json();
  assertStringIncludes(body.error, "conversa_id");
  assertEquals(chamadas.some((c) => c.tabela === "mensagens" && (c.metodo === "insert" || c.metodo === "update")), false, "não deveria gravar mensagem nenhuma");
  assertEquals(chamadas.some((c) => c.tabela === "conversas" && (c.metodo === "insert" || c.metodo === "update")), false, "não deveria inserir/atualizar conversa");
});

Deno.test("S-WM-37: conversa_id do mesmo lead segue o fluxo normal (não regride)", async () => {
  const respostas = respostasBaseHandler({});
  respostas["conversas"] = { data: { id: "conv-1", status: "ativa", metadata: {}, lead_id: "lead-1" } };
  const supabaseMock = criarSupabaseMock(respostas, []);

  const resp = await comFetchMockado(() => handler(requestFakeComConversaId("oi", "conv-1"), supabaseMock));

  assertEquals(resp.status, 200);
});

Deno.test("S-WM-37: sem conversa_id (branch else) continua funcionando sem checagem de ownership (não regride)", async () => {
  const respostas = respostasBaseHandler({});
  respostas["conversas"] = { data: { id: "conv-1", status: "ativa", metadata: {}, lead_id: "lead-1" } };
  const supabaseMock = criarSupabaseMock(respostas, []);

  const resp = await comFetchMockado(() => handler(requestFake("oi"), supabaseMock));

  assertEquals(resp.status, 200);
});

// ── S-WM-39 (BUG-02): erro técnico no lookup do lead não pode virar "blocked" silencioso ────

Deno.test("S-WM-39: select e insert de leads falhando com erro real → 500, não blocked:true", async () => {
  const respostas = respostasBaseHandler({});
  respostas["leads"] = { data: null, error: { message: "erro simulado de conexao" } };
  const supabaseMock = criarSupabaseMock(respostas, []);

  const resp = await comFetchMockado(() => handler(requestFake("oi"), supabaseMock));

  assertEquals(resp.status, 500);
  const body = await resp.json();
  assertEquals(body.error, "Erro interno");
});

Deno.test("S-WM-39: lead genuinamente bloqueado (sem erro) continua blocked:true (não regride)", async () => {
  const respostas = respostasBaseHandler({});
  respostas["leads"] = { data: { id: "lead-1", nome: "Fulano", opt_in: true, bloqueado: true }, error: null };
  const supabaseMock = criarSupabaseMock(respostas, []);

  const resp = await comFetchMockado(() => handler(requestFake("oi"), supabaseMock));

  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.blocked, true);
});

Deno.test("S-WM-39: lead novo, insert funciona (não regride)", async () => {
  const supabaseMock = criarSupabaseMock(respostasBaseHandler({}), []);

  const resp = await comFetchMockado(() => handler(requestFake("oi"), supabaseMock));

  assertEquals(resp.status, 200);
});

// ── S-WM-38 (BUG-01): resposta de ambiguidade de unidade também usa evitarRepeticaoLiteral ──
// Teste e2e via handler() (não o unit test mais simples de evitarRepeticaoLiteral isolada —
// esse não provaria que o wrapper foi de fato aplicado no branch de ambiguidade, já que a
// função em si já existia e já funcionava antes desta story).

const TEXTO_AMBIGUIDADE_S_WM_38 = "Só pra confirmar: você quer saber sobre outra unidade CUCA? Me diz qual! 😊\n\n" + MENU_UNIDADES;

Deno.test("S-WM-38: ambiguidade repetida (mesma mensagem que a última do agente) recebe prefixo anti-repetição", async () => {
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Barra" });
  respostas["mensagens"] = { data: [
    { conteudo: "tem natação?", remetente: "lead" },
    { conteudo: TEXTO_AMBIGUIDADE_S_WM_38, remetente: "agente" },
  ] };
  const supabaseMock = criarSupabaseMock(respostas, []);

  const resp = await comFetchMockado(
    () => handler(requestFake("quero trocar de unidade"), supabaseMock),
    JSON.stringify({ unidade: null, quer_sair: false, mudou_de_assunto: true, pergunta_geral: false }),
  );

  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertStringIncludes(body.resposta, "De novo, foi mal! 😅");
});

Deno.test("S-WM-38: ambiguidade sem repetição prévia não recebe o prefixo (não regride)", async () => {
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Barra" });
  respostas["mensagens"] = { data: [
    { conteudo: "oi", remetente: "lead" },
    { conteudo: "Bem-vindo!", remetente: "agente" },
  ] };
  const supabaseMock = criarSupabaseMock(respostas, []);

  const resp = await comFetchMockado(
    () => handler(requestFake("quero trocar de unidade"), supabaseMock),
    JSON.stringify({ unidade: null, quer_sair: false, mudou_de_assunto: true, pergunta_geral: false }),
  );

  assertEquals(resp.status, 200);
  const body = await resp.json();
  assertEquals(body.resposta, TEXTO_AMBIGUIDADE_S_WM_38);
});

// ── S-WM-41 (BUG-04): retry/backoff em gerarEmbedding (mesma proteção que chamarGPT/avaliarSelecaoUnidade já têm) ──

Deno.test("S-WM-41: gerarEmbedding tenta de novo após 429 e retorna o embedding da 2ª tentativa", async () => {
  let chamadasFetch = 0;
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (() => {
    chamadasFetch++;
    if (chamadasFetch === 1) {
      return Promise.resolve(new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }));
    }
    return Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: [1, 2, 3] }] }), { status: 200 }));
  }) as typeof fetch;

  try {
    const resultado = await gerarEmbedding("texto de teste", "fake-key");
    assertEquals(chamadasFetch, 2, "esperava-se exatamente 1 nova tentativa após o 429");
    assertEquals(resultado, [1, 2, 3], "depois do retry, o embedding real da 2ª tentativa deveria ser retornado");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

Deno.test("S-WM-41: erro não-transitório (400) rejeita imediatamente, sem retry", async () => {
  let chamadasFetch = 0;
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (() => {
    chamadasFetch++;
    return Promise.resolve(new Response("bad request", { status: 400 }));
  }) as typeof fetch;

  try {
    let erro: unknown = null;
    try {
      await gerarEmbedding("texto de teste", "fake-key");
    } catch (e) {
      erro = e;
    }
    assertEquals(chamadasFetch, 1, "um erro não-transitório (400) não deveria acionar nenhuma nova tentativa");
    assertEquals(erro instanceof Error, true);
    assertStringIncludes((erro as Error).message, "Embedding error");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

Deno.test("S-WM-41: esgota as tentativas em 429 persistente e rejeita com 'Embedding error'", async () => {
  let chamadasFetch = 0;
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = (() => {
    chamadasFetch++;
    return Promise.resolve(new Response("rate limited", { status: 429, headers: { "retry-after": "0" } }));
  }) as typeof fetch;

  try {
    let erro: unknown = null;
    try {
      await gerarEmbedding("texto de teste", "fake-key");
    } catch (e) {
      erro = e;
    }
    assertEquals(chamadasFetch, 3, "GPT_MAX_TENTATIVAS=2 → 1ª chamada + 2 retries = 3 chamadas no total antes de desistir");
    assertEquals(erro instanceof Error, true);
    assertStringIncludes((erro as Error).message, "Embedding error");
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

// ── S-WM-49 (VAL-20/VAL-22): histórico e roteamento no classificador de unidade ───────────

Deno.test("S-WM-49 VAL-20: avaliarSelecaoUnidade inclui histórico recente no prompt do classificador", async () => {
  const bodiesEnviados: string[] = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    if (init?.body) bodiesEnviados.push(String(init.body));
    return Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ unidade: null, quer_sair: false, mudou_de_assunto: true, pergunta_geral: false, pedido_depende_unidade: true }) } }],
    }), { status: 200 }));
  }) as typeof fetch;

  try {
    await avaliarSelecaoUnidade("é sim", "fake-key", [
      { role: "user", content: "quero saber sobre natação" },
      { role: "assistant", content: "Você quer saber de qual unidade CUCA?" },
    ]);
  } finally {
    globalThis.fetch = fetchOriginal;
  }

  const prompt = JSON.parse(bodiesEnviados[0]).messages[0].content;
  assertStringIncludes(prompt, "Historico recente");
  assertStringIncludes(prompt, "Lead: quero saber sobre natação");
  assertStringIncludes(prompt, "Maria: Você quer saber de qual unidade CUCA?");
  assertStringIncludes(prompt, "Mensagem do lead: é sim");
});

Deno.test("S-WM-49 VAL-22: prompt diferencia pergunta de rede 'qual unidade tem X' de pedido numa unidade", async () => {
  const bodiesEnviados: string[] = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    if (init?.body) bodiesEnviados.push(String(init.body));
    return Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ unidade: null, quer_sair: false, mudou_de_assunto: true, pergunta_geral: true, pedido_depende_unidade: false }) } }],
    }), { status: 200 }));
  }) as typeof fetch;

  try {
    const resultado = await avaliarSelecaoUnidade("qual unidade tem natação?", "fake-key");
    assertEquals(resultado.pergunta_geral, true);
    assertEquals(resultado.pedido_depende_unidade, false);
  } finally {
    globalThis.fetch = fetchOriginal;
  }

  const prompt = JSON.parse(bodiesEnviados[0]).messages[0].content;
  assertStringIncludes(prompt, "\"qual unidade tem natação?\" ou \"onde tem natação?\"");
  assertStringIncludes(prompt, "pergunta_geral=true");
  assertStringIncludes(prompt, "pedido_depende_unidade=false");
});

Deno.test("S-WM-49 VAL-22: regressão 'tem natação na Barra?' continua pedido dependente de unidade", async () => {
  const bodiesEnviados: string[] = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
    if (init?.body) bodiesEnviados.push(String(init.body));
    return Promise.resolve(new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ unidade: "Cuca Barra", quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: true }) } }],
    }), { status: 200 }));
  }) as typeof fetch;

  try {
    const resultado = await avaliarSelecaoUnidade("tem natação na Barra?", "fake-key");
    assertEquals(resultado.unidade, "Cuca Barra");
    assertEquals(resultado.pergunta_geral, false);
    assertEquals(resultado.pedido_depende_unidade, true);
  } finally {
    globalThis.fetch = fetchOriginal;
  }

  const prompt = JSON.parse(bodiesEnviados[0]).messages[0].content;
  assertStringIncludes(prompt, "\"tem natação na Barra?\"");
  assertStringIncludes(prompt, "unidade=\"Cuca Barra\"");
  assertStringIncludes(prompt, "pedido_depende_unidade=true");
});

// ── S-WM-42 (SEC-04): catch top-level não repassa texto de erro upstream cru na resposta ────

Deno.test("S-WM-42: catch top-level retorna Erro interno sem o campo details", async () => {
  const respostas = respostasBaseHandler({});
  respostas["prompts_agentes"] = { data: null };
  const supabaseMock = criarSupabaseMock(respostas, []);

  const resp = await comFetchMockado(() => handler(requestFake("oi"), supabaseMock));

  assertEquals(resp.status, 500);
  const body = await resp.json();
  assertEquals(body.error, "Erro interno");
  assertEquals("details" in body, false, "a resposta HTTP não deve mais expor o texto de erro cru (details)");
});

// ── S-WM-45 (BUG-03): erro no lookup de conversa_id não deve criar conversa órfã ────────────

Deno.test("S-WM-45: conversa_id informado, select retorna erro real → 500, sem criar conversa nova", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({});
  respostas["conversas"] = { data: null, error: { message: "erro simulado de conexao" } };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const resp = await comFetchMockado(() => handler(requestFakeComConversaId("oi", "conv-999"), supabaseMock));

  assertEquals(resp.status, 500);
  assertEquals(chamadas.some((c) => c.tabela === "conversas" && c.metodo === "insert"), false, "não deveria inserir conversa nova quando o select falhou com erro real");
});

Deno.test("S-WM-45: conversa_id informado, não encontrado sem erro → cria conversa nova (não regride)", async () => {
  // criarSupabaseMock compartilha a mesma resposta configurada por tabela entre select/insert —
  // não consegue expressar "select não encontra, insert cria com sucesso" nesse cenário
  // específico (select e insert de "conversas" precisam de respostas DIFERENTES aqui). Mock
  // inline diferenciado por contagem de chamada, só para este teste, em vez de forçar o mock
  // genérico ou arriscar quebrar outros testes que dependem do comportamento compartilhado.
  const respostas = respostasBaseHandler({});
  let chamadasConversas = 0;
  const supabaseMock = criarSupabaseMock(respostas, []);
  const fromOriginal = supabaseMock.from.bind(supabaseMock);
  // deno-lint-ignore no-explicit-any
  supabaseMock.from = (tabela: string): any => {
    if (tabela !== "conversas") return fromOriginal(tabela);
    chamadasConversas++;
    const respostaConversa = chamadasConversas === 1
      ? { data: null, error: null } // 1ª chamada: select, não encontrado, sem erro
      : { data: { id: "conv-nova", status: "ativa", metadata: {}, lead_id: "lead-1" }, error: null }; // 2ª: insert, sucesso
    // deno-lint-ignore no-explicit-any
    const chain: any = {};
    for (const metodo of ["select", "eq", "order", "limit", "single", "insert", "update"]) {
      chain[metodo] = () => chain;
    }
    chain.then = (resolve: (v: { data: unknown; error: unknown }) => unknown) => resolve(respostaConversa);
    return chain;
  };

  const resp = await comFetchMockado(() => handler(requestFakeComConversaId("oi", "conv-999"), supabaseMock));

  assertEquals(resp.status, 200);
});

Deno.test("S-WM-45: conversa_id informado, encontrado com sucesso (não regride)", async () => {
  const respostas = respostasBaseHandler({});
  respostas["conversas"] = { data: { id: "conv-1", status: "ativa", metadata: {}, lead_id: "lead-1" }, error: null };
  const supabaseMock = criarSupabaseMock(respostas, []);

  const resp = await comFetchMockado(() => handler(requestFakeComConversaId("oi", "conv-1"), supabaseMock));

  assertEquals(resp.status, 200);
});

// ── S-WM-51: RAG de serviços institucionais por unidade (documento único, sempre carregado) ──
// carregarServicosRede não é exportada (mesmo padrão de carregarResumoRede) — testada via wiring
// no handler, igual aos testes de resumo_rede da S-WM-32. AC5 (concatenação) é o critério mais
// importante desta leva: prova que contextServicos sobrevive à atribuição "=" de cada branch.

Deno.test("S-WM-51 AC1: sem documento de serviços ativo ainda, contextServicos fica vazio com segurança — sem bloco no prompt, sem erro", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Jangurussu" });
  respostas["documentos_rag"] = { data: { id: "doc-1" } }; // sem `conteudo` — documento de serviços ainda não existe
  respostas["chunks_documentos"] = { data: [{ conteudo: "Natacao - Ter/Qui/Sex" }] };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("Mondubim"), supabaseMock), // troca de unidade -> precisaVisaoGeral=true -> branch A
  );
  assertEquals(resp.status, 200, "handler não deveria falhar mesmo sem documento de serviços ainda cadastrado");
  const promptFinal = bodiesEnviados.find((b) => b.includes("PROGRAMACAO MENSAL ATUAL")) ?? "";
  assertEquals(promptFinal.includes("SERVICOS DA REDE"), false, "AC1: sem documento ativo, o bloco de serviços não deveria aparecer no prompt (contextServicos='' com segurança, sem erro)");
});

Deno.test("S-WM-51 AC2: pergunta sobre serviço SEM unidade escolhida (branch perguntaGeralAtiva) — bloco de serviços aparece (caso que motivou a correção de percurso)", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({});
  respostas["documentos_rag"] = { data: { id: "doc-1", conteudo: "Defensoria Publica so no CUCA Barra." } };
  respostas["rpc:buscar_chunks_similares"] = { data: [{ conteudo: "O CUCA funciona de seg a sáb.", fonte_tipo: "FAQ" }] };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("tem defensoria publica no CUCA?"), supabaseMock),
    JSON.stringify({ unidade: null, quer_sair: false, mudou_de_assunto: true, pergunta_geral: true, pedido_depende_unidade: false }),
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");

  const promptFinal = bodiesEnviados.find((b) => b.includes("SERVICOS DA REDE")) ?? "";
  assertStringIncludes(
    promptFinal,
    "--- SERVICOS DA REDE (comuns + excecoes por unidade) ---",
    "AC2: caso motivador da correção de percurso — pergunta de serviço sem unidade escolhida precisa ter o bloco de serviços no prompt, mesmo sem nenhuma unidade definida",
  );
});

Deno.test("S-WM-51 AC3/AC5: branch A (visão geral, precisaVisaoGeral=true) — bloco de serviços sobrevive junto com a programação mensal (prova de concatenação)", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Jangurussu" });
  respostas["documentos_rag"] = { data: { id: "doc-1", conteudo: "Defensoria Publica so no CUCA Barra." } };
  respostas["chunks_documentos"] = { data: [{ conteudo: "Natacao - Ter/Qui/Sex" }] };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("Mondubim"), supabaseMock), // troca de unidade -> precisaVisaoGeral=true -> branch A
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");

  const promptFinal = bodiesEnviados.find((b) => b.includes("PROGRAMACAO MENSAL ATUAL")) ?? "";
  assertStringIncludes(promptFinal, "Natacao - Ter/Qui/Sex", "programação mensal (conteúdo próprio do branch A) precisa continuar presente");
  assertStringIncludes(
    promptFinal,
    "Defensoria Publica so no CUCA Barra",
    "AC3/AC5: bloco de serviços precisa sobreviver junto com a programação — prova que 'contextRAG = \"...\"' (atribuição, não concatenação) não sobrescreveu o pré-carregamento de contextServicos",
  );
});

Deno.test("S-WM-51 AC4/AC5: branch B (acompanhamento, sem precisaVisaoGeral) — bloco de serviços sobrevive junto com o conteúdo próprio do branch (prova de concatenação)", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Jangurussu" });
  respostas["documentos_rag"] = { data: { id: "doc-1", conteudo: "Defensoria Publica so no CUCA Barra." } };
  respostas["rpc:buscar_chunks_similares"] = { data: [{ conteudo: "Natação disponível terça e quinta às 19h.", fonte_tipo: "FAQ" }] };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("tem natação de noite?"), supabaseMock), // sem troca de unidade -> acompanhamento -> branch B
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");

  const promptFinal = bodiesEnviados.find((b) => b.includes("Natação disponível")) ?? "";
  assertStringIncludes(promptFinal, "Natação disponível", "conteúdo próprio do branch B (fallback vetorial) precisa continuar presente");
  assertStringIncludes(
    promptFinal,
    "Defensoria Publica so no CUCA Barra",
    "AC4/AC5: bloco de serviços precisa sobreviver junto com o conteúdo de acompanhamento — mesma prova de concatenação do branch A, agora no branch B",
  );
});

Deno.test("S-WM-51 AC6: agente_tipo diferente de Institucional/maria (sofia) não consulta documentos_rag em nenhum momento — contextServicos nem é buscado", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({});
  respostas["documentos_rag"] = { data: { id: "doc-1", conteudo: "SERVICOS DA REDE: nao deveria aparecer aqui." } };
  respostas["rpc:buscar_chunks_similares"] = { data: [{ conteudo: "FAQ generico da Sofia.", fonte_tipo: "FAQ" }] };
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const req = new Request("http://localhost/motor-agente", {
    method: "POST",
    body: JSON.stringify({ mensagem: "oi, tudo bem?", telefone: "5585999999999", canal_origem: "test", agente_tipo: "sofia", unidade_cuca: "Cuca Barra" }),
  });

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(() => handler(req, supabaseMock));
  assertEquals(resp.status, 200, "handler não deveria falhar pro agente Sofia");
  const consultouDocumentosRag = chamadas.some((c) => c.tabela === "documentos_rag");
  assertEquals(consultouDocumentosRag, false, "AC6: agente_tipo diferente de Institucional/maria não deveria consultar documentos_rag em nenhum momento (nem servicos_rede, nem resumo_rede/monthly_program)");
  const promptFinal = bodiesEnviados.find((b) => b.includes("FAQ generico")) ?? "";
  assertEquals((promptFinal ?? "").includes("SERVICOS DA REDE"), false, "AC6: bloco de serviços não deveria aparecer no prompt de outro agente");
});

Deno.test("S-WM-51 AC7: instrução de trocaComPedidoEspecifico menciona o bloco de serviços, não só 'dados da programação'", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Jangurussu" });
  const supabaseMock = criarSupabaseMock(respostas, chamadas);

  const { resp, bodiesEnviados } = await comFetchMockadoCapturandoBody(
    () => handler(requestFake("e no Mondubim, tem natação de noite?"), supabaseMock), // trocaComPedidoEspecifico=true (VAL-23)
  );
  assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");

  const promptFinal = bodiesEnviados.find((b) => b.includes("PROGRAMACAO MENSAL ATUAL")) ?? "";
  assertStringIncludes(
    promptFinal,
    "SERVICOS DA REDE",
    "AC7: a instrução de trocaComPedidoEspecifico precisa mencionar o bloco de serviços como fonte possível, não só 'dados da programação'",
  );
  assertStringIncludes(
    promptFinal,
    "responda DIRETAMENTE ao pedido especifico",
    "regressão: o texto original (S-WM-34/VAL-23) precisa continuar presente, só ganhando a menção nova",
  );
});
