// S-INST-QUAL-04 — testes do gabarito (sem custo: nada chama a OpenAI nem o banco).
import { assert, assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { avaliarExecucao, type Caso, compararComBase, dadosPessoaisEm, minimoDeAcertos, normalizar, type ResultadoCaso, taxaPorCategoria } from "./lib/avaliar.ts";
import { buscarChunksSimilaresLocal, similaridadeCosseno } from "./lib/busca_local.ts";
import { comDataSimulada } from "./lib/data_simulada.ts";
import { type Catalogo, criarSupabaseFalso } from "./lib/mock_supabase.ts";

const CATEGORIAS = new Set(["F1", "F3", "F4", "F5", "F6", "busca_unidade", "conteudo_fixo", "seguranca_encaminhamento", "atendente"]);

async function lerCasos(): Promise<Caso[]> {
  const casos: Caso[] = [];
  for await (const e of Deno.readDir(new URL("./casos/", import.meta.url))) {
    if (e.isFile && e.name.endsWith(".json")) casos.push(JSON.parse(await Deno.readTextFile(new URL("./casos/" + e.name, import.meta.url))));
  }
  return casos;
}

// ── casos ────────────────────────────────────────────────────────────────────────────────
Deno.test("casos: estrutura completa, ids únicos, todas as categorias cobertas e padrões válidos (AC1)", async () => {
  const casos = await lerCasos();
  assert(casos.length >= 60, "esperava os 50 da prévia + os do item 3");
  assertEquals(new Set(casos.map((c) => c.id)).size, casos.length, "id repetido");
  for (const c of casos) {
    assert(CATEGORIAS.has(c.categoria), `${c.id}: categoria ${c.categoria}`);
    assert(!Number.isNaN(Date.parse(c.data_simulada)), `${c.id}: data_simulada`);
    assert(/^\d{4}-\d{2}$/.test(c.mes_catalogo), `${c.id}: mes_catalogo`);
    assert(c.mensagem.trim() !== "", `${c.id}: mensagem vazia`);
    const e = c.esperado;
    assert(e.rota || e.handover !== undefined || e.deve_conter?.length || e.nao_deve_conter?.length, `${c.id}: sem nada esperado`);
    for (const p of [...(e.deve_conter ?? []), ...(e.nao_deve_conter ?? [])]) new RegExp(normalizar(p), "i");
  }
  for (const cat of CATEGORIAS) assert(casos.some((c) => c.categoria === cat), "categoria sem caso: " + cat);
  const previa = new Set(casos.map((c) => c.previa).filter(Boolean));
  for (let i = 1; i <= 50; i++) assert(previa.has(i), `caso ${i} da prévia de 22/10 ausente`);
});

Deno.test("casos: nenhum dado pessoal (telefone, e-mail) e só o id curto da conversa (AC6)", async () => {
  for (const c of await lerCasos()) {
    const texto = JSON.stringify(c);
    assertEquals(dadosPessoaisEm(texto), [], `${c.id} tem dado pessoal`);
    if (c.conversa_curta) assert(/^[0-9a-f]{8}$/.test(c.conversa_curta), `${c.id}: conversa_curta deve ter 8 caracteres`);
    assert(!/[0-9a-f]{8}-[0-9a-f]{4}-/.test(texto), `${c.id}: id completo de conversa ou lead`);
  }
});

// ── correção e critério ──────────────────────────────────────────────────────────────────
Deno.test("avaliar: compara sem acento e sem caixa; rota, transbordo, deve e não deve conter", () => {
  const ok = avaliarExecucao({ rota: ["vetorial"], handover: false, deve_conter: ["natacao", "15 a 29"], nao_deve_conter: ["em que mais posso"] }, { resposta: "A NATAÇÃO é de 15 a 29 anos.", handover: false, camada: "vetorial" });
  assertEquals(ok, { passou: true, falhas: [] });
  const falha = avaliarExecucao({ rota: ["emprega_mais"], handover: true, deve_conter: ["empreg"], nao_deve_conter: ["em que mais posso"] }, { resposta: "Em que mais posso te ajudar?", handover: false, camada: "resposta_canned" });
  assertEquals(falha.passou, false);
  assertEquals(falha.falhas.length, 4);
});

Deno.test("critério: passa com 2 de 3; 'sem piora' sem queda de categoria nem caso que piorou", () => {
  assertEquals(minimoDeAcertos(3), 2);
  assertEquals(minimoDeAcertos(1), 1);
  const r = (id: string, categoria: string, passou: boolean, depois_da_07 = false): ResultadoCaso => ({ id, categoria, depois_da_07, acertos: passou ? 3 : 0, execucoes: 3, passou });
  const base = [r("a", "F1", true), r("b", "F1", false), r("c", "F4", true), r("d", "conteudo_fixo", false, true)];
  assertEquals(taxaPorCategoria(base), { F1: { passaram: 1, total: 2, taxa: 0.5 }, F4: { passaram: 1, total: 1, taxa: 1 } });
  assertEquals(compararComBase([r("a", "F1", true), r("b", "F1", true), r("c", "F4", true)], base).sem_piora, true);
  const piorou = compararComBase([r("a", "F1", false), r("b", "F1", true), r("c", "F4", false)], base);
  assertEquals(piorou, { sem_piora: false, categorias_que_cairam: ["F4"], casos_que_pioraram: ["a", "c"] });
});

Deno.test("dados pessoais: pega telefone e e-mail, libera os telefones públicos das unidades e datas", () => {
  assertEquals(dadosPessoaisEm("liga no (85) 99796-0256 ou 98976-3733 em 2026-09-28"), []);
  assertEquals(dadosPessoaisEm("meu número é 85 98888-1234"), ["85 98888-1234"]);
  assertEquals(dadosPessoaisEm("fulano@gmail.com"), ["fulano@gmail.com"]);
});

// ── busca local ──────────────────────────────────────────────────────────────────────────
Deno.test("busca local: mesmos filtros e ordem de buscar_chunks_similares", () => {
  const docs = [
    { id: "d-pici", tipo: "monthly_program", unidade_cuca: "Cuca Pici", ativo: true },
    { id: "d-barra", tipo: "monthly_program", unidade_cuca: "Cuca Barra", ativo: true },
    { id: "d-faq", tipo: "FAQ", unidade_cuca: null, ativo: true },
    { id: "d-velho", tipo: "FAQ", unidade_cuca: null, ativo: false },
  ];
  const t = (id: string, documento_id: string, embedding: number[] | null) => ({ id, documento_id, conteudo: id, metadados: null, embedding });
  const trechos = [t("pici", "d-pici", [1, 0]), t("barra", "d-barra", [1, 0]), t("faq", "d-faq", [0.7, 0.7]), t("velho", "d-velho", [1, 0]), t("sem", "d-faq", null)];
  const ids = (r: { chunk_id: string }[]) => r.map((x) => x.chunk_id);
  // unidade: a pedida + documentos sem unidade; inativo e sem embedding ficam fora
  assertEquals(ids(buscarChunksSimilaresLocal(docs, trechos, { query_embedding: "[1,0]", p_unidade_cuca: "Cuca Pici", p_limite: 5 })), ["pici", "faq"]);
  // tipo e limite
  assertEquals(ids(buscarChunksSimilaresLocal(docs, trechos, { query_embedding: [1, 0], p_tipos: ["FAQ"], p_limite: 3 })), ["faq"]);
  assertEquals(buscarChunksSimilaresLocal(docs, trechos, { query_embedding: [1, 0], p_limite: 1 }).length, 1);
  assert(Math.abs(similaridadeCosseno([1, 0], [0.7, 0.7]) - Math.SQRT1_2) < 1e-9);
});

const ARQUIVO_CATALOGO = new URL("./dados/catalogo.json", import.meta.url);
const temCatalogo = await Deno.stat(ARQUIVO_CATALOGO).then(() => true).catch(() => false);

Deno.test({
  name: "busca local com o catálogo real: o vetor de um trecho de natação do Pici devolve ele mesmo em 1º",
  ignore: !temCatalogo,
  fn: async () => {
    const catalogo: Catalogo = JSON.parse(await Deno.readTextFile(ARQUIVO_CATALOGO));
    const mes = catalogo.meses["2026-09"];
    const docPici = mes.documentos.find((d) => d.unidade_cuca === "Cuca Pici")!;
    const trecho = mes.trechos.find((t) => t.documento_id === docPici.id && /nata/i.test(t.conteudo) && t.embedding)!;
    const docs = mes.documentos.map((d) => ({ id: d.id as string, tipo: d.tipo as string, unidade_cuca: d.unidade_cuca as string | null, ativo: true }));
    const r = buscarChunksSimilaresLocal(docs, mes.trechos, { query_embedding: JSON.stringify(trecho.embedding), p_unidade_cuca: "Cuca Pici", p_limite: 5 });
    assertEquals(r[0].chunk_id, trecho.id);
    assert(r[0].similaridade > 0.999);
    assert(r.every((x) => x.fonte_tipo === "monthly_program"));
  },
});

// ── mock do Supabase ─────────────────────────────────────────────────────────────────────
const CATALOGO_MINIMO: Catalogo = {
  exportado_em: "teste",
  meses: { "2026-09": { documentos: [{ id: "d1", tipo: "monthly_program", unidade_cuca: "Cuca Pici", conteudo: "PICI", metadados: { campanha_id: "c1" }, created_at: "2026-08-31" }], trechos: [{ id: "t2", documento_id: "d1", conteudo: "b", metadados: null, embedding: [0, 1] }, { id: "t1", documento_id: "d1", conteudo: "a", metadados: null, embedding: [1, 0] }].map((t, i) => ({ ...t, chunk_index: 2 - i })), atividades_mensais: [{ campanha_id: "c1", titulo: "NATAÇÃO" }, { campanha_id: "c2", titulo: "OUTRA" }] } },
  comum: { documentos: [], trechos: [], prompts_agentes: [{ agente_tipo: "Institucional", prompt_sistema: "S" }], unidades_cuca: [], configuracoes: [], system_config: [] },
};

Deno.test("mock: aplica filtros, ordem, limite e single; grava inserções; recusa tabela e RPC desconhecidas", async () => {
  const { cliente, captura, conversa } = criarSupabaseFalso(CATALOGO_MINIMO, "2026-09", { metadata: { a: 1 }, status: "ativa", historico: [] }, "k");
  const doc = await cliente.from("documentos_rag").select("id").eq("tipo", "monthly_program").eq("unidade_cuca", "Cuca Pici").eq("ativo", true).order("created_at", { ascending: false }).limit(1).single();
  assertEquals((doc as { data: { id: string } }).data.id, "d1");
  const nada = await cliente.from("documentos_rag").select("id").eq("unidade_cuca", "Cuca Barra").single();
  assertEquals((nada as { data: unknown }).data, null);
  const chunks = await cliente.from("chunks_documentos").select("conteudo").eq("documento_id", "d1").order("chunk_index", { ascending: true });
  assertEquals((chunks as { data: { conteudo: string }[] }).data.map((c) => c.conteudo), ["a", "b"]);
  const ativ = await cliente.from("atividades_mensais").select("titulo").eq("campanha_id", "c1");
  assertEquals((ativ as { data: unknown[] }).data.length, 1);
  await cliente.from("rag_retrieval_logs").insert({ camada: "vetorial" });
  assertEquals(captura.insercoes.at(-1), { tabela: "rag_retrieval_logs", linha: { camada: "vetorial" } });
  await cliente.rpc("merge_conversa_metadata", { p_conversa_id: "x", p_patch: { b: 2 } });
  assertEquals(conversa().metadata, { a: 1, b: 2 });
  const busca = await cliente.rpc("buscar_chunks_similares", { query_embedding: "[1,0]", p_limite: 1 }) as { data: { chunk_id: string }[] };
  assertEquals(busca.data.map((b) => b.chunk_id), ["t1"]);
  assertThrows(() => cliente.from("tabela_que_nao_existe"));
  await assertRejects(async () => { await cliente.rpc("rpc_desconhecida"); });
  await assertRejects(async () => { await cliente.from("ai_usage_logs").select("x"); });
});

// ── data simulada ────────────────────────────────────────────────────────────────────────
Deno.test("data simulada: new Date() e Date.now() devolvem o agora do caso e são restaurados depois", async () => {
  const agora = Date.UTC(2026, 8, 21, 18, 0, 0);
  const visto = await comDataSimulada(agora, () => Promise.resolve({ novo: new Date().getTime(), now: Date.now(), comArg: new Date("2026-01-01T00:00:00Z").getTime() }));
  assertEquals(visto, { novo: agora, now: agora, comArg: Date.UTC(2026, 0, 1) });
  assert(Math.abs(Date.now() - new Date().getTime()) < 1000 && Date.now() > Date.UTC(2026, 10, 1));
});
