import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ehSelecaoMenu, extrairTextoMenu, detectarTrocaUnidade, parseRetryAfterSegundos, validarAvaliacaoSelecaoUnidade, removerTag } from "./index.ts";

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
    { unidade: "Cuca Barra", quer_sair: false, mudou_de_assunto: false },
  );
});

Deno.test("validarAvaliacaoSelecaoUnidade: rejeita unidade fora da lista válida (nunca confia cegamente no LLM)", () => {
  assertEquals(
    validarAvaliacaoSelecaoUnidade({ unidade: "Cuca Inventada", quer_sair: false, mudou_de_assunto: false }),
    { unidade: null, quer_sair: false, mudou_de_assunto: false },
  );
});

Deno.test("validarAvaliacaoSelecaoUnidade: JSON malformado/vazio cai no default seguro", () => {
  assertEquals(validarAvaliacaoSelecaoUnidade(null), { unidade: null, quer_sair: false, mudou_de_assunto: false });
  assertEquals(validarAvaliacaoSelecaoUnidade({}), { unidade: null, quer_sair: false, mudou_de_assunto: false });
  assertEquals(validarAvaliacaoSelecaoUnidade("string solta"), { unidade: null, quer_sair: false, mudou_de_assunto: false });
});

Deno.test("validarAvaliacaoSelecaoUnidade: só aceita booleano literal true, não truthy genérico", () => {
  assertEquals(
    validarAvaliacaoSelecaoUnidade({ unidade: null, quer_sair: "sim", mudou_de_assunto: 1 }),
    { unidade: null, quer_sair: false, mudou_de_assunto: false },
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
