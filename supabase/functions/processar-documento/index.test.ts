// Prova VAL-02 (docs/migracao-meta/VALIDACAO-producao-institucional.md): chunking por tamanho
// fixo de caractere (chunkarTexto) corta registros de monthly_program no meio, fragmentando o
// par modalidade→professor. Mesmo padrão dos testes de auditoria do motor-agente: o teste
// "reproduz o problema" usa a função ANTIGA (ainda usada para FAQ/vagas/eventos_pontuais, não
// removida) para provar que o corte acontece; o teste "prova a correção" usa a função NOVA
// (chunkarPorRegistro, roteada por chunkarDocumento quando tipo=monthly_program) sobre o MESMO
// texto sintético.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { chunkarDocumento, chunkarPorRegistro, chunkarTexto, montarChunkDeAtividade, montarChunksPorAtividade } from "./index.ts";

// Texto sintético no mesmo formato real do monthly_program (confirmado via query em produção/
// cuca-dev: "• <NOME>\n  Detalhes: ... Professor: <NOME>. Vagas: ...") — 4 registros de Natação,
// cada um com um professor diferente, tamanho comparável ao caso real (Cuca Barra teve 8+
// registros de Natação fragmentados entre os chunks 28 e 37).
const TEXTO_NATACAO = [
  "PROGRAMAÇÃO MENSAL (7/2026) - Cuca Barra",
  "",
  "== ESPORTES ==",
  "• NATAÇÃO",
  "  Detalhes: Esporte Modalidade: NATAÇÃO - Turma Turma 8. Professor: BENJAMIM. Vagas: 25. Público: Misto (Idade: NATAÇÃO). Dias: Ter e Qui. Horário: 07:00 ás 08:00.",
  "• NATAÇÃO",
  "  Detalhes: Esporte Modalidade: NATAÇÃO - Turma Turma 2. Professor: CIRILLO. Vagas: 25. Público: Misto (Idade: NATAÇÃO). Dias: Ter e Qui. Horário: 08:00 ás 09:00.",
  "• NATAÇÃO",
  "  Detalhes: Esporte Modalidade: NATAÇÃO - Turma Turma 6. Professor: SEGUNDO. Vagas: 20. Público: Misto (Idade: NATAÇÃO). Dias: Ter e Qui. Horário: 15:00 ás 16:00.",
  "• NATAÇÃO",
  "  Detalhes: Esporte Modalidade: NATAÇÃO - Turma Turma 14. Professor: CIRILLO. Vagas: 25. Público: Misto (Idade: NATAÇÃO). Dias: Qua e Sex. Horário: 10:00 ás 11:00.",
].join("\n");

const REGISTROS_PROFESSOR = [
  "Professor: BENJAMIM.",
  "Professor: CIRILLO. Vagas: 25. Público: Misto (Idade: NATAÇÃO). Dias: Ter e Qui. Horário: 08:00",
  "Professor: SEGUNDO.",
  "Professor: CIRILLO. Vagas: 25. Público: Misto (Idade: NATAÇÃO). Dias: Qua e Sex.",
];

Deno.test("VAL-02 (reproduz o problema): chunkarTexto (tamanho fixo) corta um registro de professor no meio", () => {
  // Tamanho pequeno o bastante para forçar corte no meio de pelo menos um registro, no mesmo
  // espírito do caso real de produção (CHUNK_SIZE=800 cortando um bloco de ~250 caracteres):
  // "Professor" fica no fim de um chunk e ": BENJAMIM..." começa o próximo, exatamente como
  // "...NATAÇÃO - Turm" / "a Turma 2. Professor: CIRILLO..." nos chunks 32/33 reais.
  const chunks = chunkarTexto(TEXTO_NATACAO, 130, 0);

  const algumRegistroFoiCortado = REGISTROS_PROFESSOR.some(
    (registro) => !chunks.some((c) => c.includes(registro)),
  );

  assertEquals(
    algumRegistroFoiCortado,
    true,
    "chunkarTexto deveria reproduzir o bug real (corte por tamanho fixo, sem noção de registro) — se todos os registros de professor apareceram inteiros em algum chunk, o cenário de teste não está reproduzindo o corte visto em produção (chunks 32/33 da Cuca Barra)",
  );
});

Deno.test("VAL-02 (corrige o problema): chunkarPorRegistro nunca corta um registro de professor no meio", () => {
  // Mesmo tamanho-alvo pequeno do teste anterior (130) — a diferença de resultado vem só da
  // estratégia (registro completo vs. tamanho fixo), não de um tamanho mais generoso.
  const chunks = chunkarPorRegistro(TEXTO_NATACAO, 130);

  for (const registro of REGISTROS_PROFESSOR) {
    const apareceInteiroEmAlgumChunk = chunks.some((c) => c.includes(registro));
    assertEquals(
      apareceInteiroEmAlgumChunk,
      true,
      "cada registro de professor deveria aparecer completo dentro de um único chunk — " + registro + " não foi encontrado inteiro em nenhum chunk",
    );
  }
});

Deno.test("VAL-02 (wiring): chunkarDocumento roteia monthly_program para chunkarPorRegistro", () => {
  const porTipo = chunkarDocumento("monthly_program", TEXTO_NATACAO, 130, 0);
  const porRegistroDireto = chunkarPorRegistro(TEXTO_NATACAO, 130);
  assertEquals(porTipo, porRegistroDireto, "chunkarDocumento('monthly_program', ...) deveria produzir exatamente o mesmo resultado que chamar chunkarPorRegistro diretamente");
});

Deno.test("VAL-02 (não regride outros tipos): chunkarDocumento mantém chunkarTexto (tamanho fixo) para FAQ/vagas/eventos_pontuais", () => {
  for (const tipo of ["FAQ", "vagas", "eventos_pontuais"]) {
    const porTipo = chunkarDocumento(tipo, TEXTO_NATACAO, 130, 0);
    const porTamanhoFixoDireto = chunkarTexto(TEXTO_NATACAO, 130, 0);
    assertEquals(porTipo, porTamanhoFixoDireto, "tipo=" + tipo + " deveria continuar usando chunkarTexto sem nenhuma mudança de comportamento");
  }
});

Deno.test("chunkarPorRegistro: nunca produz um chunk maior que o texto de um único registro quando um registro isolado excede o tamanho-alvo", () => {
  const registroGigante = "• X\n  Detalhes: " + "a".repeat(500);
  const chunks = chunkarPorRegistro(registroGigante, 100);
  assertEquals(chunks.length, 1, "um registro sozinho maior que o tamanho-alvo deve virar um chunk único, nunca ser cortado no meio");
  assertEquals(chunks[0].includes("Detalhes:"), true);
});

// ═══════════════════════════════════════════════════════════════════════════════
// S-WM-AUD-004 / Plano 011 — 1 chunk por atividade
// ═══════════════════════════════════════════════════════════════════════════════

// Regexes REAIS de extrairModalidades (motor-agente/index.ts). Copiadas aqui de proposito: e o
// contrato entre as duas Edge Functions, e o que quebra silenciosamente se o formato divergir.
const REGEX_ESPORTE = /Modalidade:\s*([^-]+?)\s*-\s*Turma/;
const REGEX_CURSO = /Curso:\s*([^.]+?)\.\s*Educador:/;

const CABECALHO = "PROGRAMAÇÃO MENSAL DE SETEMBRO DE 2026 — Cuca Pici\nEsta programação vale para o mês de setembro de 2026.";

Deno.test("Plano 011: 1 chunk por atividade, um para cada linha utilizavel", () => {
  const chunks = montarChunksPorAtividade(CABECALHO, [
    { titulo: "NATAÇÃO", categoria: "ESPORTES", descricao: "Esporte Modalidade: NATAÇÃO - Turma Turma 1. Professor: CIRILLO." },
    { titulo: "NATAÇÃO", categoria: "ESPORTES", descricao: "Esporte Modalidade: NATAÇÃO - Turma Turma 2. Professor: ANA." },
    { titulo: "  ", categoria: "ESPORTES", descricao: "sem titulo, deve ser descartada" },
    { titulo: null, categoria: "ESPORTES", descricao: "titulo null, deve ser descartada" },
  ]);
  assertEquals(chunks?.length, 2);
});

Deno.test("Plano 011 (AC4 — contrato com extrairModalidades): formato de ESPORTES continua casando a regex", () => {
  const chunks = montarChunksPorAtividade(CABECALHO, [
    { titulo: "NATAÇÃO", categoria: "ESPORTES", descricao: "Esporte Modalidade: NATAÇÃO - Turma Turma 1. Professor: CIRILLO. Publico: Misto (Idade: 15 a 29). Dias: Ter e Qui. Horário: 08:00 às 09:00." },
  ])!;
  const m = chunks[0].conteudo.match(REGEX_ESPORTE);
  assertEquals(m?.[1], "NATAÇÃO", "extrairModalidades precisa continuar extraindo a modalidade do chunk novo");
});

Deno.test("Plano 011 (AC4 — o caso que o plano original quebraria): CURSOS continua casando a regex de curso", () => {
  // Se o chunk fosse gerado por formatarLinhaAtividadeDeterministica, viria
  // "Categoria CURSOS - Atividade: ..." e NENHUMA regex casaria — a busca de curso morreria.
  const chunks = montarChunksPorAtividade(CABECALHO, [
    { titulo: "Curso de Libras Básico I", categoria: "CURSOS", descricao: "Curso: Curso de Libras Básico I. Educador: MARIA. Carga Horária: 40h. Período: 01/09/2026 a 30/09/2026 (Seg e Qua)." },
  ])!;
  const m = chunks[0].conteudo.match(REGEX_CURSO);
  assertEquals(m?.[1], "Curso de Libras Básico I");
});

Deno.test("Plano 011: cabecalho de vigencia entra em CADA chunk", () => {
  // Um chunk isolado recuperado pela busca vetorial tem que carregar a que mes pertence —
  // antes isso vinha de o documento ser um texto corrido unico.
  const chunks = montarChunksPorAtividade(CABECALHO, [
    { titulo: "JUDO", categoria: "ESPORTES", descricao: "Esporte Modalidade: JUDO - Turma Turma 1. Professor: X." },
    { titulo: "CAPOEIRA", categoria: "ESPORTES", descricao: "Esporte Modalidade: CAPOEIRA - Turma Turma 1. Professor: Y." },
  ])!;
  for (const c of chunks) {
    assertEquals(c.conteudo.includes("setembro de 2026"), true);
  }
});

Deno.test("Plano 011: metadados por chunk trazem titulo e categoria da atividade", () => {
  const chunks = montarChunksPorAtividade(CABECALHO, [
    { titulo: "Carimba", categoria: "DIA A DIA", descricao: "Programa (DIA A DIA): Carimba." },
  ])!;
  assertEquals(chunks[0].titulo, "Carimba");
  assertEquals(chunks[0].categoria, "DIA A DIA");
});

Deno.test("Plano 011: local e horario entram quando existem, no formato do trigger", () => {
  const c = montarChunkDeAtividade({
    titulo: "Carimba", categoria: "DIA A DIA", descricao: "detalhe",
    local: "Quadra", hora_inicio: "08:00:00", hora_fim: "09:00:00",
  });
  assertEquals(c.includes("  Local: Quadra"), true);
  assertEquals(c.includes("  Horário: 08:00:00 às 09:00:00"), true);
});

Deno.test("Plano 011: 'Não informado' em local nao vira linha (mesmo guard do trigger)", () => {
  const c = montarChunkDeAtividade({ titulo: "X", categoria: "ESPORTES", descricao: "d", local: "Não informado" });
  assertEquals(c.includes("Local:"), false);
});

Deno.test("Plano 011: sem atividade utilizavel devolve null — caller cai no chunking por texto", () => {
  assertEquals(montarChunksPorAtividade(CABECALHO, []), null);
  assertEquals(montarChunksPorAtividade(CABECALHO, [{ titulo: "", categoria: null, descricao: null }]), null);
});
