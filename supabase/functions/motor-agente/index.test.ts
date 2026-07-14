import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ehSelecaoMenu, extrairTextoMenu, detectarTrocaUnidade, parseRetryAfterSegundos, validarAvaliacaoSelecaoUnidade, removerTag, pareceIntencaoTrocaUnidade, dividirRespostaEmPartes, normalizarTexto, extrairModalidades, detectarAtividadeMencionada, mensagemTemPedidoEspecifico } from "./index.ts";

// ── S-WM-34 (VAL-09) — normalizarTexto ──────────────────────────────────────
Deno.test("normalizarTexto: remove acento e lowercase", () => {
  assertEquals(normalizarTexto("Natação"), "natacao");
  assertEquals(normalizarTexto("JOSÉ WALTER"), "jose walter");
});

Deno.test("normalizarTexto: texto sem acento fica só lowercase", () => {
  assertEquals(normalizarTexto("Futsal Sesc"), "futsal sesc");
});

// ── S-WM-34 (VAL-09) — extrairModalidades ───────────────────────────────────
Deno.test("extrairModalidades: extrai nomes únicos do padrão 'Modalidade: X - Turma'", () => {
  const chunks = [
    "• Natação Detalhes: Esporte Modalidade: Natação - Turma Turma 11 . Professor: Daniel Reis.",
    "• Futsal Sesc Detalhes: Esporte Modalidade: Futsal Sesc - Turma 01 (sub 9) . Professor: Bruno.",
    "continuação sem match Modalidade nenhuma aqui",
    "• Natação Detalhes: Esporte Modalidade: Natação - Turma Turma 1 . Professor: Daniel Reis.",
  ];
  const modalidades = extrairModalidades(chunks);
  assertEquals(modalidades.sort(), ["Futsal Sesc", "Natação"].sort());
});

Deno.test("extrairModalidades: retorna vazio quando não há nenhum padrão no texto", () => {
  assertEquals(extrairModalidades(["texto qualquer sem o padrão esperado"]), []);
});

// ── S-WM-34 (VAL-09) — detectarAtividadeMencionada ──────────────────────────
Deno.test("detectarAtividadeMencionada: detecta com acento igual ao original", () => {
  assertEquals(detectarAtividadeMencionada("tem natação de noite?", ["Natação", "Judô"]), "Natação");
});

Deno.test("detectarAtividadeMencionada: detecta mensagem sem acento contra modalidade com acento", () => {
  assertEquals(detectarAtividadeMencionada("tem natacao de noite?", ["Natação", "Judô"]), "Natação");
});

Deno.test("detectarAtividadeMencionada: prefere nome mais específico (Futsal Sesc) sobre prefixo genérico (Futsal)", () => {
  assertEquals(detectarAtividadeMencionada("tem futsal sesc de manhã?", ["Futsal", "Futsal Sesc"]), "Futsal Sesc");
});

Deno.test("detectarAtividadeMencionada: retorna null quando nenhuma modalidade é citada", () => {
  assertEquals(detectarAtividadeMencionada("qual o horário de hoje?", ["Natação", "Judô"]), null);
});

// ── S-WM-34 (VAL-23) — mensagemTemPedidoEspecifico ──────────────────────────
// Heurística deliberadamente conservadora (só "?") — ver Dev Notes/docblock da função sobre por
// que um limiar de tamanho de texto foi tentado e descartado (falso positivo no caso são/AC4).
Deno.test("mensagemTemPedidoEspecifico: mensagem só com o nome da unidade não tem pedido específico", () => {
  assertEquals(mensagemTemPedidoEspecifico("Mondubim"), false);
});

Deno.test("mensagemTemPedidoEspecifico: AC4 (caso são) — frase vaga sem '?' não conta como pedido específico, mesmo mencionando a unidade", () => {
  assertEquals(mensagemTemPedidoEspecifico("quero saber do Mondubim agora"), false);
});

Deno.test("mensagemTemPedidoEspecifico: AC3 (caso reproduzido ao vivo) — pergunta com conteúdo específico embutido é detectada", () => {
  assertEquals(mensagemTemPedidoEspecifico("e no Mondubim, tem natação de noite?"), true);
});

Deno.test("mensagemTemPedidoEspecifico: '?' sozinho já basta, mesmo com pouco texto extra", () => {
  assertEquals(mensagemTemPedidoEspecifico("Mondubim tem vaga?"), true);
});

Deno.test("mensagemTemPedidoEspecifico: limitação conhecida — pedido específico real sem '?' não é detectado (documentado, não é regressão)", () => {
  assertEquals(mensagemTemPedidoEspecifico("manda os horarios de natacao no Mondubim"), false);
});

// ── ehSelecaoMenu ────────────────────────────────────────────────────────────
Deno.test("ehSelecaoMenu: aceita dígitos 1-5 isolados", () => {
  for (const n of ["1", "2", "3", "4", "5"]) {
    assertEquals(ehSelecaoMenu(n), true, `esperava true para "${n}"`);
  }
});

Deno.test("ehSelecaoMenu: aceita dígito com espaços em volta", () => {
  assertEquals(ehSelecaoMenu("  3  "), true);
});

Deno.test("ehSelecaoMenu: rejeita 0, 6+ e texto livre", () => {
  for (const texto of ["0", "6", "10", "opção 1", "1 barra", ""]) {
    assertEquals(ehSelecaoMenu(texto), false, `esperava false para "${texto}"`);
  }
});

// ── extrairTextoMenu ─────────────────────────────────────────────────────────
Deno.test("extrairTextoMenu: extrai texto da linha correspondente ao número", () => {
  const menu = "1️⃣ Natação\n2️⃣ Judô\n3️⃣ Informática";
  assertEquals(extrairTextoMenu("2", menu), "Judô");
});

Deno.test("extrairTextoMenu: aceita separadores '.', ')' e espaço", () => {
  assertEquals(extrairTextoMenu("1", "1. Natação"), "Natação");
  assertEquals(extrairTextoMenu("1", "1) Natação"), "Natação");
  assertEquals(extrairTextoMenu("1", "1 Natação"), "Natação");
});

Deno.test("extrairTextoMenu: retorna vazio quando número não está no menu", () => {
  assertEquals(extrairTextoMenu("9", "1️⃣ Natação\n2️⃣ Judô"), "");
});

// ── detectarTrocaUnidade ─────────────────────────────────────────────────────
Deno.test("detectarTrocaUnidade: detecta nome de unidade explícito", () => {
  assertEquals(detectarTrocaUnidade("quero saber sobre a Mondubim", "Cuca Pici"), "Cuca Mondubim");
});

Deno.test("detectarTrocaUnidade: retorna null quando já é a unidade atual", () => {
  assertEquals(detectarTrocaUnidade("fala sobre pici", "Cuca Pici"), null);
});

Deno.test("detectarTrocaUnidade: retorna null sem menção a unidade", () => {
  assertEquals(detectarTrocaUnidade("qual o horário de hoje?", "Cuca Pici"), null);
});

// §4 (corrigido): "barra" como substring DENTRO de outra palavra não dispara mais troca de unidade.
// Isso é o que match de palavra inteira resolve — "barragem" contém "barra" como substring,
// mas não é a mesma palavra.
Deno.test("detectarTrocaUnidade: §4 — substring dentro de outra palavra ('barragem') não dispara Cuca Barra", () => {
  assertEquals(detectarTrocaUnidade("tem barragem perto daqui?", "Cuca Pici"), null);
});

Deno.test("detectarTrocaUnidade: §4 — 'barra' como palavra inteira ainda dispara Cuca Barra", () => {
  assertEquals(detectarTrocaUnidade("quero saber da barra", "Cuca Pici"), "Cuca Barra");
});

// Residual conhecido, NÃO resolvido por match de palavra inteira: "barra" é homônimo real
// (unidade CUCA vs. "barra de chocolate"/"barra de progresso") — mesma palavra em ambos os
// casos, então nenhum regex de fronteira de palavra distingue um do outro. Isso exige entendimento
// semântico (mesma classe de problema do §5), e §5 hoje só cobre o branch aguardando_unidade
// (seleção inicial), não este branch de troca de unidade em conversa já em andamento. Deixado
// como `ignore` propositalmente — ver relatório de progresso sobre a decisão de escopo.
Deno.test({
  name: "detectarTrocaUnidade: residual — 'barra de chocolate' é homônimo, requer camada semântica (fora do escopo §4)",
  ignore: true,
  fn: () => {
    assertEquals(detectarTrocaUnidade("quero uma barra de chocolate", "Cuca Pici"), null);
  },
});

// ── Item 4 (S-WM-21, VAL-06) — typo-tolerância em detectarTrocaUnidade ──────────────────────
Deno.test("Item 4: detectarTrocaUnidade tolera erro de digitação de 1 caractere ('mondubi' por 'mondubim')", () => {
  assertEquals(detectarTrocaUnidade("quero saber da mondubi", "Cuca Pici"), "Cuca Mondubim");
});

Deno.test("Item 4: detectarTrocaUnidade typo NÃO regride a proteção §4 ('barragem' continua não disparando Cuca Barra)", () => {
  // "barragem" (8 chars) vs "barra" (5 chars): diferença de tamanho > 1, filtrado antes mesmo
  // de calcular distância de edição — garante que o fallback de typo não reabre o bug §4.
  assertEquals(detectarTrocaUnidade("tem barragem perto daqui?", "Cuca Pici"), null);
});

Deno.test("Item 4: detectarTrocaUnidade typo não dispara pra chave curta (pici, <5 chars) nem composta (com espaço)", () => {
  // Chaves curtas/compostas ficam de fora do fallback de typo (risco de falso positivo alto
  // demais) — comportamento seguro documentado, não uma lacuna a fechar nesta story.
  assertEquals(detectarTrocaUnidade("quero saber da pic", "Cuca Barra"), null);
});

// ── Item 4 (S-WM-21, VAL-06) — pareceIntencaoTrocaUnidade (pré-filtro de custo) ──────────────
Deno.test("Item 4: pareceIntencaoTrocaUnidade reconhece menções explícitas a trocar de unidade", () => {
  for (const texto of ["quero saber de outra unidade", "posso trocar de unidade?", "queria mudar pra outra unidade", "me tira dessa e bota na outra cuca"]) {
    assertEquals(pareceIntencaoTrocaUnidade(texto), true, `esperava true para "${texto}"`);
  }
});

Deno.test("Item 4: pareceIntencaoTrocaUnidade NÃO dispara em mensagens de acompanhamento comuns (evita custo de LLM desnecessário)", () => {
  for (const texto of ["quem é o professor de natação?", "tem outra atividade além de natação?", "qual o horário de hoje?", "obrigado pela ajuda"]) {
    assertEquals(pareceIntencaoTrocaUnidade(texto), false, `esperava false para "${texto}" — AC9: sem palavra-chave de troca, não deveria acionar o pré-filtro`);
  }
});

// ── parseRetryAfterSegundos (§3) ─────────────────────────────────────────────
Deno.test("parseRetryAfterSegundos: usa header retry-after quando presente", () => {
  assertEquals(parseRetryAfterSegundos("3", "qualquer corpo"), 3);
});

Deno.test("parseRetryAfterSegundos: extrai tempo do corpo do erro quando header ausente", () => {
  const corpo = "Rate limit reached for gpt-4o. Please try again in 1.234s.";
  assertEquals(parseRetryAfterSegundos(null, corpo), 1.234);
});

Deno.test("parseRetryAfterSegundos: header inválido cai para o corpo do erro", () => {
  const corpo = "Please try again in 2s.";
  assertEquals(parseRetryAfterSegundos("not-a-number", corpo), 2);
});

Deno.test("parseRetryAfterSegundos: retorna fallback de 1s sem header nem tempo no corpo", () => {
  assertEquals(parseRetryAfterSegundos(null, "erro genérico sem tempo sugerido"), 1);
});

// ── validarAvaliacaoSelecaoUnidade (§5) ──────────────────────────────────────
Deno.test("validarAvaliacaoSelecaoUnidade: aceita unidade válida e sinais true", () => {
  assertEquals(
    validarAvaliacaoSelecaoUnidade({ unidade: "Cuca Barra", quer_sair: false, mudou_de_assunto: false }),
    { unidade: "Cuca Barra", quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false },
  );
});

Deno.test("validarAvaliacaoSelecaoUnidade: rejeita unidade fora da lista válida (nunca confia cegamente no LLM)", () => {
  assertEquals(
    validarAvaliacaoSelecaoUnidade({ unidade: "Cuca Inventada", quer_sair: false, mudou_de_assunto: false }),
    { unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false },
  );
});

Deno.test("validarAvaliacaoSelecaoUnidade: JSON malformado/vazio cai no default seguro", () => {
  assertEquals(validarAvaliacaoSelecaoUnidade(null), { unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false });
  assertEquals(validarAvaliacaoSelecaoUnidade({}), { unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false });
  assertEquals(validarAvaliacaoSelecaoUnidade("string solta"), { unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false });
});

Deno.test("validarAvaliacaoSelecaoUnidade: só aceita booleano literal true, não truthy genérico", () => {
  assertEquals(
    validarAvaliacaoSelecaoUnidade({ unidade: null, quer_sair: "sim", mudou_de_assunto: 1 }),
    { unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false },
  );
});

// ── removerTag (§6 — endurecimento parcial, não resolve paráfrase) ──────────
Deno.test("removerTag: detecta tag no formato exato original", () => {
  const r = removerTag("Vou te transferir. [[HANDOVER]]", "handover");
  assertEquals(r.encontrada, true);
  assertEquals(r.texto, "Vou te transferir.");
});

Deno.test("removerTag: tolera minúsculas e case misto", () => {
  assertEquals(removerTag("ok [[handover]]", "handover").encontrada, true);
  assertEquals(removerTag("ok [[Handover]]", "handover").encontrada, true);
});

Deno.test("removerTag: tolera espaçamento dentro dos colchetes", () => {
  const r = removerTag("Até mais! [[ ENCERRAR ]]", "encerrar");
  assertEquals(r.encontrada, true);
  assertEquals(r.texto, "Até mais!");
});

Deno.test("removerTag: retorna encontrada=false e texto inalterado sem a tag", () => {
  const r = removerTag("Resposta normal, sem tags.", "handover");
  assertEquals(r.encontrada, false);
  assertEquals(r.texto, "Resposta normal, sem tags.");
});

// Débito conhecido: paráfrase sem a tag literal não é detectada — requer structured output
// real (fora de escopo aqui, ver relatório: exige reescrever prompts_agentes coordenado).
Deno.test({
  name: "removerTag: débito conhecido — paráfrase sem tag não é detectada",
  ignore: true,
  fn: () => {
    const r = removerTag("Vou te transferir para um atendente humano.", "handover");
    assertEquals(r.encontrada, true);
  },
});

// ── Item 2 (S-WM-22, TOM-03b): dividirRespostaEmPartes ───────────────────────
const LISTA_5_CURSOS = [
  "Natacao - Ter/Qui/Sex",
  "Judo - Seg/Qua",
  "Informatica - Ter/Qui",
  "Reforco Escolar - Seg/Ter/Qua/Qui/Sex",
  "Musica - Sab",
].join("\n");

Deno.test("dividirRespostaEmPartes: AC4 — resposta curta/normal (sem formato de lista) não é dividida", () => {
  const texto = "Claro! Temos aulas de natação às terças e quintas. Quer saber mais algum detalhe?";
  assertEquals(dividirRespostaEmPartes(texto), [texto]);
});

Deno.test("dividirRespostaEmPartes: AC4 — menos de 3 linhas-item não é considerado listável", () => {
  const texto = "Temos 2 opções:\nNatacao - Ter/Qui\nJudo - Seg\nEspero ter ajudado!";
  assertEquals(dividirRespostaEmPartes(texto), [texto]);
});

Deno.test("dividirRespostaEmPartes: AC1 — abertura + lista (5 cursos) + fechamento vira 3 partes", () => {
  const texto = "Claro! Aqui está a programação completa:\n\n" + LISTA_5_CURSOS + "\n\nQuer saber horários de alguma modalidade específica?";
  const partes = dividirRespostaEmPartes(texto);
  assertEquals(partes.length, 3, "esperava 3 partes: abertura, lista, fechamento");
  assertEquals(partes[0], "Claro! Aqui está a programação completa:");
  assertEquals(partes[1], LISTA_5_CURSOS);
  assertEquals(partes[2], "Quer saber horários de alguma modalidade específica?");
});

Deno.test("dividirRespostaEmPartes: resposta sem abertura (começa direto na lista) vira 2 partes", () => {
  const texto = LISTA_5_CURSOS + "\n\nQuer saber mais?";
  const partes = dividirRespostaEmPartes(texto);
  assertEquals(partes.length, 2);
  assertEquals(partes[0], LISTA_5_CURSOS);
  assertEquals(partes[1], "Quer saber mais?");
});

Deno.test("dividirRespostaEmPartes: resposta sem fechamento (termina na lista) vira 2 partes", () => {
  const texto = "Segue a programação:\n\n" + LISTA_5_CURSOS;
  const partes = dividirRespostaEmPartes(texto);
  assertEquals(partes.length, 2);
  assertEquals(partes[0], "Segue a programação:");
  assertEquals(partes[1], LISTA_5_CURSOS);
});

Deno.test("dividirRespostaEmPartes: resposta 100% lista (sem abertura nem fechamento) não força split artificial — 1 parte", () => {
  const partes = dividirRespostaEmPartes(LISTA_5_CURSOS);
  assertEquals(partes, [LISTA_5_CURSOS]);
});

Deno.test("dividirRespostaEmPartes: uma pergunta com hífen não é confundida com item de lista (linha termina em '?')", () => {
  const texto = "Oi! Você quer saber - de forma rápida - qual o horário de hoje?";
  assertEquals(dividirRespostaEmPartes(texto), [texto]);
});
