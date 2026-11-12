// S-INST-QUAL-04 — executor do gabarito do Institucional.
//
// Roda cada caso de `eval/casos/` contra o `handler` do motor-agente, com:
//   - o cliente Supabase falso de `lib/mock_supabase.ts` (catálogo congelado, nada vai ao banco);
//   - a busca vetorial calculada localmente (`lib/busca_local.ts`);
//   - a data simulada do caso (`lib/data_simulada.ts`);
//   - `fetch` restrito a api.openai.com — qualquer outro destino (inclusive *.supabase.co) lança erro.
//
// Uso:
//   deno run --allow-all eval/run_eval.ts --rotulo baseline                 # OpenAI real (OPENAI_API_KEY)
//   deno run --allow-all eval/run_eval.ts --rotulo teste --simulado         # sem custo: OpenAI simulada
// Opções: --repeticoes N (padrão 3) · --casos <regex do id> · --teto-usd N (para ao passar do teto)
//         --comparar eval/resultados/<arquivo>.json (aplica o critério "sem piora" contra uma base)
// Saída: eval/resultados/AAAA-MM-DD-<rotulo>.md (relatório) e .json (bruto). Fora do git.

import { handler, redefinirCachePrecos } from "../index.ts";
import { avaliarExecucao, type Caso, compararComBase, minimoDeAcertos, type ResultadoCaso, type SaidaExecucao, taxaPorCategoria } from "./lib/avaliar.ts";
import { comDataSimulada } from "./lib/data_simulada.ts";
import { type Catalogo, CONVERSA_ID, criarSupabaseFalso, TELEFONE_FALSO } from "./lib/mock_supabase.ts";

// ── argumentos ───────────────────────────────────────────────────────────────────────────
function argumento(nome: string): string | undefined {
  const i = Deno.args.indexOf("--" + nome);
  return i >= 0 ? Deno.args[i + 1] : undefined;
}
const ROTULO = argumento("rotulo");
const SIMULADO = Deno.args.includes("--simulado");
const REPETICOES = Number(argumento("repeticoes") ?? 3);
const FILTRO = argumento("casos") ? new RegExp(argumento("casos")!) : null;
const TETO_USD = argumento("teto-usd") ? Number(argumento("teto-usd")) : null;
const COMPARAR = argumento("comparar");
if (!ROTULO) {
  console.error("Uso: deno run --allow-all eval/run_eval.ts --rotulo <nome> [--simulado] [--repeticoes N] [--casos regex] [--teto-usd N] [--comparar base.json]");
  Deno.exit(1);
}
const CHAVE = SIMULADO ? "chave-simulada" : Deno.env.get("OPENAI_API_KEY") ?? "";
if (!CHAVE) {
  console.error("Sem OPENAI_API_KEY. Para rodar sem custo, use --simulado.");
  Deno.exit(1);
}

// ── arquivos ─────────────────────────────────────────────────────────────────────────────
const BASE = new URL("./", import.meta.url);
const catalogo: Catalogo = JSON.parse(await Deno.readTextFile(new URL("dados/catalogo.json", BASE)));
const casos: Caso[] = [];
for await (const e of Deno.readDir(new URL("casos/", BASE))) {
  if (e.isFile && e.name.endsWith(".json")) casos.push(JSON.parse(await Deno.readTextFile(new URL("casos/" + e.name, BASE))));
}
casos.sort((a, b) => a.id.localeCompare(b.id, "pt-BR", { numeric: true }));
const selecionados = FILTRO ? casos.filter((c) => FILTRO.test(c.id)) : casos;

// Cache dos embeddings das perguntas (fora do git): repetições e rodadas futuras não pagam de novo.
const ARQUIVO_CACHE = new URL("dados/cache-embeddings.json", BASE);
let cacheEmbeddings: Record<string, unknown> = {};
try { cacheEmbeddings = JSON.parse(await Deno.readTextFile(ARQUIVO_CACHE)); } catch { /* primeira rodada */ }

// ── fetch restrito ───────────────────────────────────────────────────────────────────────
const fetchOriginal = globalThis.fetch;
type ChamadaIA = { tipo: string; corpo: Record<string, unknown> };
let chamadasDoCaso: ChamadaIA[] = [];

function tipoDaChamada(url: string, corpo: string): string {
  if (url.includes("/v1/embeddings")) return "embedding";
  if (corpo.includes("CLASSIFICADOR DE EMPREGO")) return "classificador_emprego";
  if (corpo.includes("Você interpreta mensagens de leads")) return "interpretacao_programacao";
  if (corpo.includes("Um lead da rede CUCA está conversando com a Maria")) return "classificacao_rota";
  return "chat";
}

/** Vetor determinístico para o modo simulado (só exercita o encanamento, não mede qualidade). */
function vetorSimulado(texto: string): number[] {
  let h = 2166136261;
  for (const ch of texto) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return Array.from({ length: 1536 }, (_, i) => Math.sin(h + i * 12.9898) * 0.5);
}

function respostaSimulada(tipo: string, corpo: Record<string, unknown>): Response {
  const uso = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };
  const chat = (conteudo: string) => new Response(JSON.stringify({ id: "sim-" + tipo, model: "gpt-4o-mini-2024-07-18", choices: [{ message: { content: conteudo } }], usage: uso }), { status: 200 });
  switch (tipo) {
    case "embedding": return new Response(JSON.stringify({ model: "text-embedding-3-small", data: [{ embedding: vetorSimulado(String(corpo.input)) }], usage: { prompt_tokens: 10, total_tokens: 10 } }), { status: 200 });
    case "classificador_emprego": return chat(JSON.stringify({ fala_de_emprego: false, vaga_sem_tipo: false, outra_pergunta: null }));
    case "interpretacao_programacao": return chat(JSON.stringify({ tipo: "nao_programacao", atividade: null, termos_busca: [], area: null, contexto: {}, escopo: null }));
    case "classificacao_rota": return chat(JSON.stringify({ unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false }));
    default: return chat("[simulado] resposta do modelo");
  }
}

globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
  const url = String(entrada instanceof Request ? entrada.url : entrada);
  if (!url.startsWith("https://api.openai.com/")) throw new Error("gabarito: chamada de rede bloqueada para " + url);
  const corpoTexto = String(init?.body ?? "");
  const corpo = corpoTexto ? JSON.parse(corpoTexto) : {};
  const tipo = tipoDaChamada(url, corpoTexto);
  chamadasDoCaso.push({ tipo, corpo });
  if (SIMULADO) return respostaSimulada(tipo, corpo);
  if (tipo === "embedding") {
    const chave = String(corpo.model) + "|" + String(corpo.input);
    // Resposta do cache sem `usage`: o motor não registra consumo de uma chamada que não aconteceu.
    if (cacheEmbeddings[chave]) return new Response(JSON.stringify({ model: corpo.model, data: [{ embedding: cacheEmbeddings[chave] }] }), { status: 200 });
    const resp = await fetchOriginal(entrada, init);
    const json = await resp.clone().json().catch(() => null);
    if (resp.ok && json?.data?.[0]?.embedding) cacheEmbeddings[chave] = json.data[0].embedding;
    return resp;
  }
  return fetchOriginal(entrada, init);
}) as typeof fetch;

// ── execução ─────────────────────────────────────────────────────────────────────────────
type Execucao = SaidaExecucao & { passou: boolean; falhas: string[]; custo_usd: number; data_atual_no_prompt: string | null; buscas: unknown[]; chamadas: Record<string, number>; erro?: string };

function montarHistorico(caso: Caso, agora: number) {
  const linhas = caso.historico.map((m) => ({ remetente: m.remetente, conteudo: m.conteudo, created_at: new Date(agora - m.minutos_antes * 60000).toISOString() }));
  // O worker grava a mensagem atual antes de chamar o motor; o motor a reconhece e tira do histórico.
  linhas.push({ remetente: "lead", conteudo: caso.mensagem, created_at: new Date(agora - 2000).toISOString() });
  return linhas;
}

async function executar(caso: Caso): Promise<Execucao> {
  const agora = Date.parse(caso.data_simulada);
  if (Number.isNaN(agora)) throw new Error(`${caso.id}: data_simulada inválida`);
  const falso = criarSupabaseFalso(catalogo, caso.mes_catalogo, { metadata: caso.estado.metadata, status: caso.estado.status ?? "ativa", historico: montarHistorico(caso, agora) }, CHAVE);
  chamadasDoCaso = [];
  redefinirCachePrecos();
  const logOriginal = console.log;
  console.log = () => {};
  let corpo: { resposta?: string; mensagens?: string[]; handover?: boolean } = {};
  let erro: string | undefined;
  try {
    const resp = await comDataSimulada(agora, () => handler(new Request("http://localhost/motor-agente", {
      method: "POST",
      body: JSON.stringify({ mensagem: caso.mensagem, telefone: TELEFONE_FALSO, canal_origem: "eval", agente_tipo: "Institucional", unidade_cuca: "Geral", conversa_id: CONVERSA_ID }),
      // deno-lint-ignore no-explicit-any
    }), falso.cliente as any));
    corpo = await resp.json();
    await new Promise((r) => setTimeout(r, 50)); // registros em segundo plano
  } catch (e) {
    erro = String(e);
  } finally {
    console.log = logOriginal;
  }
  const insercoes = falso.captura.insercoes;
  const logsBusca = insercoes.filter((i) => i.tabela === "rag_retrieval_logs").map((i) => i.linha);
  const saida: SaidaExecucao = {
    resposta: (corpo.mensagens?.length ? corpo.mensagens : [corpo.resposta ?? ""]).join("\n\n"),
    handover: corpo.handover === true,
    camada: (logsBusca.at(-1)?.camada as string | undefined) ?? null,
  };
  const avaliacao = erro ? { passou: false, falhas: ["erro: " + erro] } : avaliarExecucao(caso.esperado, saida);
  const custo = insercoes.filter((i) => i.tabela === "ai_usage_logs").reduce((s, i) => s + (Number(i.linha.custo_usd) || 0), 0);
  const promptChat = chamadasDoCaso.filter((c) => c.tipo === "chat").map((c) => JSON.stringify(c.corpo)).join("\n");
  const dataAtual = promptChat.match(/DATA E HORA ATUAL: [^"\\]+/)?.[0] ?? null;
  const chamadas: Record<string, number> = {};
  for (const c of chamadasDoCaso) chamadas[c.tipo] = (chamadas[c.tipo] ?? 0) + 1;
  const buscas = falso.captura.buscas.map((b) => ({ ...b.params, trechos: b.resultado.map((r) => ({ chunk_id: r.chunk_id, fonte_tipo: r.fonte_tipo, similaridade: Number(r.similaridade.toFixed(4)), inicio: r.conteudo.slice(0, 80) })) }));
  return { ...saida, ...avaliacao, custo_usd: custo, data_atual_no_prompt: dataAtual, buscas, chamadas, erro };
}

const bruto: { caso: Caso; execucoes: Execucao[]; resultado: ResultadoCaso }[] = [];
let custoTotal = 0;
let parouNoTeto = false;
console.log(`Gabarito: ${selecionados.length} casos × ${REPETICOES} execuções${SIMULADO ? " (SIMULADO, sem custo)" : ""}`);
casosLoop:
for (const caso of selecionados) {
  const execucoes: Execucao[] = [];
  for (let i = 0; i < REPETICOES; i++) {
    if (TETO_USD !== null && custoTotal >= TETO_USD) { parouNoTeto = true; break casosLoop; }
    const e = await executar(caso);
    custoTotal += e.custo_usd;
    execucoes.push(e);
  }
  const acertos = execucoes.filter((e) => e.passou).length;
  const resultado: ResultadoCaso = { id: caso.id, categoria: caso.categoria, depois_da_07: caso.depois_da_07 === true, acertos, execucoes: execucoes.length, passou: acertos >= minimoDeAcertos(execucoes.length) };
  bruto.push({ caso, execucoes, resultado });
  console.log(`${resultado.passou ? "✔" : "✘"} ${caso.id} (${acertos}/${execucoes.length})`);
}
globalThis.fetch = fetchOriginal;
if (!SIMULADO) await Deno.writeTextFile(ARQUIVO_CACHE, JSON.stringify(cacheEmbeddings));

// ── relatório ────────────────────────────────────────────────────────────────────────────
const resultados = bruto.map((b) => b.resultado);
const taxas = taxaPorCategoria(resultados);
let comparacao = null;
if (COMPARAR) {
  const base = JSON.parse(await Deno.readTextFile(COMPARAR)) as { resultados: ResultadoCaso[] };
  comparacao = compararComBase(resultados, base.resultados);
}
const hoje = new Date().toISOString().slice(0, 10);
const nome = `${hoje}-${ROTULO}`;
await Deno.mkdir(new URL("resultados/", BASE), { recursive: true });
await Deno.writeTextFile(new URL(`resultados/${nome}.json`, BASE), JSON.stringify({ rotulo: ROTULO, data: new Date().toISOString(), simulado: SIMULADO, repeticoes: REPETICOES, custo_usd: custoTotal, parou_no_teto: parouNoTeto, catalogo_exportado_em: catalogo.exportado_em, resultados, taxas, comparacao, detalhes: bruto }, null, 1));

const linhas: string[] = [];
linhas.push(`# Gabarito do Institucional — ${ROTULO} (${hoje})`, "");
linhas.push(`- Modo: ${SIMULADO ? "**SIMULADO** (OpenAI falsa, sem custo; mede só o encanamento)" : "OpenAI real"}`);
linhas.push(`- Casos: ${resultados.length} · execuções por caso: ${REPETICOES} · um caso passa com ${minimoDeAcertos(REPETICOES)} de ${REPETICOES} acertos`);
linhas.push(`- Custo da rodada (registrado pelo próprio motor): US$ ${custoTotal.toFixed(4)}${parouNoTeto ? ` — **parou no teto de US$ ${TETO_USD}**` : ""}`);
linhas.push(`- Catálogo exportado em: ${catalogo.exportado_em}`, "");
linhas.push("## Taxa de acerto por categoria", "", "| Categoria | Passaram | Total | Taxa |", "|---|---:|---:|---:|");
for (const [k, v] of Object.entries(taxas).sort()) linhas.push(`| ${k} | ${v.passaram} | ${v.total} | ${(v.taxa * 100).toFixed(0)}% |`);
const depois07 = resultados.filter((r) => r.depois_da_07);
if (depois07.length) linhas.push("", `Casos que dependem da base nova (story 07), fora das taxas: ${depois07.filter((r) => r.passou).length}/${depois07.length} passaram.`);
if (comparacao) {
  linhas.push("", "## Comparação com a base (critério da story)", "", `- Resultado: **${comparacao.sem_piora ? "sem piora" : "PIOROU"}**`);
  if (comparacao.categorias_que_cairam.length) linhas.push(`- Categorias que caíram: ${comparacao.categorias_que_cairam.join(", ")}`);
  if (comparacao.casos_que_pioraram.length) linhas.push(`- Casos que passavam e falharam: ${comparacao.casos_que_pioraram.join(", ")}`);
}
linhas.push("", "## Caso a caso", "", "| Caso | Categoria | Acertos | Resultado | Rota | Falhas (1ª execução que falhou) |", "|---|---|---:|---|---|---|");
for (const b of bruto) {
  const falha = b.execucoes.find((e) => !e.passou);
  linhas.push(`| ${b.caso.id} | ${b.caso.categoria}${b.caso.depois_da_07 ? " (07)" : ""} | ${b.resultado.acertos}/${b.resultado.execucoes} | ${b.resultado.passou ? "passou" : "**falhou**"} | ${b.execucoes[0]?.camada ?? "-"} | ${falha ? falha.falhas.join("; ").replace(/\|/g, "\\|") : ""} |`);
}
await Deno.writeTextFile(new URL(`resultados/${nome}.md`, BASE), linhas.join("\n") + "\n");
console.log(`\nRelatório: eval/resultados/${nome}.md · custo US$ ${custoTotal.toFixed(4)}`);
