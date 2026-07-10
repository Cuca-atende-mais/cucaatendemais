// Testes de auditoria — NÃO faz parte da suíte original do Valmir (index.test.ts).
// Cada teste aqui prova, de forma automatizada, um dos achados de
// docs/qa/AUDITORIA-motor-agente-institucional-2026-07-07.md. Eles descrevem o
// comportamento DESEJADO/correto — se o bug ainda não foi corrigido, o teste FALHA.
// Isso é intencional: é uma suíte "vermelha" servindo de checklist executável.
import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  contemPalavra,
  decidirAguardandoUnidade,
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
type ChamadaRegistrada = { tabela: string; metodo: string; args?: unknown[] };

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
    rpc: (nome: string, ...args: unknown[]) => {
      chamadas.push({ tabela: "rpc:" + nome, metodo: "rpc", args });
      const resposta = respostasPorTabela["rpc:" + nome];
      return { then: (resolve: (v: { data: unknown; error: null }) => unknown) => resolve({ data: resposta?.data ?? null, error: null }) };
    },
  };
}

/** Base comum aos cenários de handler (AUD-04, AUD-07) abaixo — só muda `conversas.metadata` e
 * a mensagem do lead. */
function respostasBaseHandler(metadataConversa: Record<string, unknown>): Record<string, { data: unknown }> {
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
    // deno-lint-ignore no-explicit-any
  }) as any;
  return fn().finally(() => { globalThis.fetch = fetchOriginal; });
}

/** Captura as chamadas de console.log durante `fn`, restaurando o original ao final (mesmo
 * espírito de comFetchMockado acima) — usado pelos testes VAL-04 (observabilidade) abaixo. */
function comConsoleLogCapturado<T>(fn: () => Promise<T>): Promise<{ resultado: T; linhas: string[] }> {
  const originalLog = console.log;
  const linhas: string[] = [];
  // deno-lint-ignore no-explicit-any
  console.log = ((...args: any[]) => { linhas.push(args.map(String).join(" ")); }) as any;
  return fn()
    .then((resultado) => ({ resultado, linhas }))
    .finally(() => { console.log = originalLog; });
}

function requestFake(mensagem: string): Request {
  return new Request("http://localhost/motor-agente", {
    method: "POST",
    body: JSON.stringify({ mensagem, telefone: "5585999999999", canal_origem: "test", agente_tipo: "Institucional", unidade_cuca: "Geral" }),
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

// ── VAL-13: cortesia pura (ex.: "bom dia") NÃO pode abandonar o fluxo de escolha de unidade —
// diferente do AUD-01 acima (pergunta real), aqui não há pergunta_geral nenhuma pra responder.
Deno.test("VAL-13: cortesia pura (mudou_de_assunto sem pergunta_geral) mantém aguardandoUnidade=true", () => {
  const decisao = decidirAguardandoUnidade(undefined, { unidade: null, quer_sair: false, mudou_de_assunto: true, pergunta_geral: false });
  assertEquals(
    decisao.aguardandoUnidade,
    true,
    "VAL-13: um cumprimento/cortesia no meio do fluxo (ex.: 'bom dia') não pode resetar aguardando_unidade — o lead ainda não escolheu unidade nenhuma, e a resposta já reapresenta o menu",
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

// ── VAL-12: pergunta institucional real já na 1ª mensagem não força o menu ──────────────────
Deno.test("VAL-12: decidirPrimeiraMensagem com pergunta_geral=true não força o menu (segue pro fluxo normal)", () => {
  const decisao = decidirPrimeiraMensagem(undefined, { unidade: null, quer_sair: false, mudou_de_assunto: true, pergunta_geral: true });
  assertEquals(decisao.unidadeSelecionada, null);
  assertEquals(decisao.aguardandoUnidade, false, "VAL-12: pergunta geral real não pode deixar a conversa aguardando unidade");
  assertEquals(decisao.resposta, null, "VAL-12: resposta=null sinaliza 'siga o fluxo normal' — não é pra responder com o menu canned");
});

// ── Backlog 4b: saudação de abertura no fallback puro de decidirPrimeiraMensagem ────────────
// Esse branch nunca chama GPT (nem antes, nem depois desta mudança) — a variação vem de um
// array fixo (SAUDACOES_ABERTURA) sorteado localmente, não gerado por modelo. Escolha aleatória
// em vez de rotação por índice: mais simples (não exige plumbar um contador/estado por lead
// através do handler só pra alternar 6 frases fixas) e o teste abaixo prova a variação de forma
// estatística (100 chamadas sem seed fixo), não determinística — trade-off aceito pela mesma
// razão de simplicidade.
Deno.test("Backlog 4b: 1ª mensagem sem unidade nem pergunta geral recebe uma saudação de abertura antes do menu", () => {
  const avaliacaoDefault = { unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false };
  const respostasObservadas = new Set<string>();
  for (let i = 0; i < 100; i++) {
    const decisao = decidirPrimeiraMensagem(undefined, avaliacaoDefault);
    assertEquals(decisao.unidadeSelecionada, null);
    assertEquals(decisao.aguardandoUnidade, true);
    assertStringIncludes(decisao.resposta ?? "", MENU_UNIDADES, "a resposta precisa conter o menu de unidades na íntegra");
    const comecaComSaudacaoConhecida = SAUDACOES_ABERTURA.some((s) => decisao.resposta?.startsWith(s));
    assertEquals(
      comecaComSaudacaoConhecida,
      true,
      "Backlog 4b: a resposta desse branch precisa começar com uma das saudações de SAUDACOES_ABERTURA, antes do menu",
    );
    respostasObservadas.add(decisao.resposta ?? "");
  }
  assertEquals(
    respostasObservadas.size > 1,
    true,
    "Backlog 4b: em 100 chamadas sem seed fixo, esperava-se mais de uma variação de saudação (probabilidade de sempre sair a mesma, com 6 opções, é (1/6)^99 — praticamente zero); se sempre igual, a escolha aleatória não está funcionando",
  );
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
  await comFetchMockado(async () => {
    const resp = await handler(requestFake("posso escolher outra unidade?"), supabaseMock);
    assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  });
  const carregouProgramacaoCompleta = chamadas.some((c) => c.tabela === "documentos_rag");
  assertEquals(
    carregouProgramacaoCompleta,
    false,
    "VAL-07/AUD-15: reabrir uma conversa encerrada que já tinha unidade selecionada não deveria recarregar os ~40 chunks da programação completa nem tratar a mensagem como 'primeira mensagem' — é uma continuação, não um primeiro contato",
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
  await comFetchMockado(async () => {
    const resp = await handler(requestFake("2"), supabaseMock);
    assertEquals(resp.status, 200, "handler não deveria falhar nesse cenário (ver body em caso de 500)");
  });
  const carregouProgramacaoCompleta = chamadas.some((c) => c.tabela === "documentos_rag");
  assertEquals(
    carregouProgramacaoCompleta,
    false,
    "VAL-08: '2' respondendo uma pergunta que o GPT improvisou em texto livre (sem nenhuma lista numerada) não deveria disparar precisaVisaoGeral — antes desse fix, qualquer dígito 1-5 sozinho contava como 'seleção de menu' independente do que a última mensagem do agente realmente foi",
  );
});

Deno.test("VAL-08 (regressão): dígito respondendo um menu de categorias numerado de verdade continua recarregando a visão geral", async () => {
  const chamadas: ChamadaRegistrada[] = [];
  const respostas = respostasBaseHandler({ unidade_selecionada: "Cuca Barra" });
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
    "VAL-08 não pode quebrar o caso legítimo: '2' respondendo um menu de categorias numerado de verdade ainda deve carregar a área selecionada",
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
