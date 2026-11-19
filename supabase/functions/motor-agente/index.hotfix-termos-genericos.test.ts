// Hotfix 17/11/2026 — termos que não identificam atividade não podem virar "não tem".
// Casos reais: "Os cursos já começaram?" (17/11), "E os esportes?", "Que tipos tem disponiveis." e
// "Tem outros tipos de atividades que não citei que tem vagas." (16/11) — todos respondidos com
// "não encontrei em nenhuma unidade" com a programação de novembro ativa. Nenhum teste chama a
// OpenAI nem o banco.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  decidirRota,
  ESCOLHA_REDE,
  type EstadoRota,
  type ItemProgramacao,
  type LeituraTurno,
  montarConsultaComContexto,
  semTermosGenericos,
} from "./index.ts";

const leitura = (parcial: Partial<LeituraTurno>): LeituraTurno => ({
  tipo: "pedido_novo",
  assunto: "programacao",
  unidade_citada: null,
  escopo: "nao_disse",
  canal: null,
  atividade: null,
  termos_busca: [],
  area: null,
  idade: null,
  contexto: {},
  ...parcial,
});

const estado = (parcial: Partial<EstadoRota> = {}): EstadoRota => ({
  unidadeSalva: null,
  unidadeAnterior: null,
  escopoRedeSalvo: false,
  sessaoReaberta: false,
  primeiraRespostaDaSessao: false,
  ultimaRespostaFoiPronta: false,
  disparoRecente: false,
  contextoDeProgramacao: false,
  pedeDetalhe: false,
  atividadeNovaNaConversa: false,
  opcoesAtividade: () => [],
  ...parcial,
});

// Títulos e detalhes no formato real de novembro de 2026.
const ITENS: ItemProgramacao[] = [
  { unidade: "Cuca Mondubim", titulo: "Informática Básica: Descobrindo a Tecnologia", area: "CURSOS", detalhe: "Curso: Informática Básica: Descobrindo a Tecnologia. Educador: Del. Carga Horária: 28h. Período: 10/11/2026 a 27/11/2026 (Ter e Sex). Horário: 18:30 às 21:00. Requisitos: 15 a 29 anos." },
  { unidade: "Cuca Mondubim", titulo: "Violão para Iniciantes", area: "CURSOS", detalhe: "Curso: Violão para Iniciantes. Período: 03/11/2026 a 27/11/2026 (Seg e Qua). Horário: 14:00 às 16:00. Requisitos: 15 a 29 anos." },
  { unidade: "Cuca Barra", titulo: "NATAÇÃO", area: "ESPORTES", detalhe: "Esporte Modalidade: Natação - Turma TURMA 1. Público: Misto (Idade: 15 a 29 anos). Dias: Ter e Qui. Horário: 07:00 às 08:00." },
  { unidade: "Cuca Pici", titulo: "JIU-JITSU", area: "ESPORTES", detalhe: "Esporte Modalidade: Jiu-jitsu - Turma TURMA 1. Público: Misto (Idade: 15 a 29 anos). Dias: Seg e Qua. Horário: 19:00 às 20:00." },
];

const consulta = (l: LeituraTurno, escopo: string, texto: string) =>
  montarConsultaComContexto(ITENS, { texto, atividade: l.atividade, termos: l.termos_busca, area: l.area, contexto: l.contexto, escopo });

// ── Caso da Cibely (17/11) ───────────────────────────────────────────────────────────────────
Deno.test("Hotfix 17/11: 'Os cursos já começaram?' sem unidade — termos genéricos saem e o bot pergunta a unidade", () => {
  const lida = leitura({ termos_busca: ["cursos", "começaram"], area: "CURSOS" });
  // Antes: termos não vazios = "tem atividade" → rede inteira → "nenhuma".
  assertEquals(decidirRota(lida, estado()).acao, "programacao");
  assertEquals(consulta(lida, ESCOLHA_REDE, "Os cursos já começaram?").situacao, "nenhuma");
  // Depois:
  const limpa = semTermosGenericos(lida, ITENS);
  assertEquals(limpa.termos_busca, []);
  assertEquals(limpa.atividade, null);
  assertEquals(limpa.area, "CURSOS");
  assertEquals(decidirRota(limpa, estado()).acao, "perguntar_escopo");
});

Deno.test("Hotfix 17/11: 'Os cursos já começaram?' com unidade salva — lista os cursos da unidade, nunca 'nenhuma'", () => {
  const limpa = semTermosGenericos(leitura({ termos_busca: ["cursos", "começaram"], area: "CURSOS" }), ITENS);
  const acao = decidirRota(limpa, estado({ unidadeSalva: "Cuca Mondubim" }));
  assertEquals(acao, { acao: "programacao", escopo: "Cuca Mondubim", escopoDaMensagem: false, listarPorIdade: false });
  const r = consulta(limpa, "Cuca Mondubim", "Os cursos já começaram?");
  assertEquals(r.situacao, "area");
  assert(r.bloco.includes("Informática Básica"));
});

// ── Casos de 16/11 ───────────────────────────────────────────────────────────────────────────
Deno.test("Hotfix 17/11: 'E os esportes?' na rede — atividade genérica vira a área Esportes e lista por unidade", () => {
  const lida = leitura({ atividade: "esportes", termos_busca: ["esportes"], escopo: ESCOLHA_REDE });
  const limpa = semTermosGenericos(lida, ITENS);
  assertEquals(limpa.atividade, null);
  assertEquals(limpa.termos_busca, []);
  assertEquals(limpa.area, "ESPORTES");
  assertEquals(decidirRota(limpa, estado()).acao, "programacao");
  const r = consulta(limpa, ESCOLHA_REDE, "E os esportes?");
  assertEquals(r.situacao, "area");
  assert(r.bloco.includes("NATAÇÃO") && r.bloco.includes("JIU-JITSU"));
});

Deno.test("Hotfix 17/11: 'Que tipos tem disponiveis.' e 'outros tipos de atividades' — palavra solta sem título sai", () => {
  assertEquals(semTermosGenericos(leitura({ termos_busca: ["tipos"] }), ITENS).termos_busca, []);
  assertEquals(semTermosGenericos(leitura({ termos_busca: ["tipos", "atividades", "citei"] }), ITENS).termos_busca, []);
});

// ── O que NÃO pode mudar ─────────────────────────────────────────────────────────────────────
Deno.test("Hotfix 17/11: atividade com nome de verdade fora da programação continua 'nenhuma' (forró)", () => {
  const lida = leitura({ atividade: "forró", termos_busca: ["forro"], escopo: ESCOLHA_REDE });
  const limpa = semTermosGenericos(lida, ITENS);
  assertEquals(limpa, lida);
  assertEquals(consulta(limpa, ESCOLHA_REDE, "Que dia tem aula de forro?").situacao, "nenhuma");
});

Deno.test("Hotfix 17/11: termo que casa com título fica (continuação sem atividade)", () => {
  const lida = leitura({ tipo: "continuacao", termos_busca: ["natação", "cursos"] });
  assertEquals(semTermosGenericos(lida, ITENS).termos_busca, ["natação"]);
});

Deno.test("Hotfix 17/11: com dia na pergunta nada muda (a consulta por dia já trata as palavras)", () => {
  const lida = leitura({ termos_busca: ["sabados"], contexto: { dia: "sábado" } });
  assertEquals(semTermosGenericos(lida, ITENS), lida);
});

Deno.test("Hotfix 17/11: sem itens carregados, só as palavras genéricas saem", () => {
  assertEquals(semTermosGenericos(leitura({ termos_busca: ["cursos", "xadrez"] }), []).termos_busca, ["xadrez"]);
});

Deno.test("Hotfix 17/11: leitura sem atividade e sem termos volta igual (mesmo objeto)", () => {
  const lida = leitura({ area: "CURSOS" });
  assert(semTermosGenericos(lida, ITENS) === lida);
});

Deno.test("Hotfix 17/11: 'quais cursos?' com atividade genérica — depois da limpeza a consulta segue pela área", () => {
  const limpa = semTermosGenericos(leitura({ atividade: "cursos", termos_busca: ["cursos"], escopo: ESCOLHA_REDE }), ITENS);
  assertEquals(limpa.area, "CURSOS");
  assertEquals(consulta(limpa, ESCOLHA_REDE, "quais cursos?").situacao, "area");
});
