// S-INST-QUAL-04 — exporta o catálogo congelado do gabarito, SÓ LEITURA (GET no PostgREST).
//
// Grava `eval/dados/catalogo.json` (fora do git): a programação de cada mês do gabarito (documentos
// `monthly_program`, seus trechos COM o embedding que já está no banco e as `atividades_mensais` da
// campanha), mais o que vale para todos os casos (servicos_rede, FAQs, eventos, prompt, unidades,
// canais e preços), no estado atual de produção. Nenhuma chamada à OpenAI: os embeddings dos
// trechos são os que a indexação já gravou (`text-embedding-3-small`).
//
// Uso (credenciais do banco por variável de ambiente; nunca escritas no arquivo):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... deno run --allow-net --allow-env --allow-read --allow-write \
//     eval/scripts/exportar_catalogo.ts
// Como cada documento foi escolhido: ver `eval/catalogo/manifesto.json`.

const URL_BASE = Deno.env.get("SUPABASE_URL");
const CHAVE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!URL_BASE || !CHAVE) {
  console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  Deno.exit(1);
}

const MANIFESTO = JSON.parse(await Deno.readTextFile(new URL("../catalogo/manifesto.json", import.meta.url)));
const SAIDA = new URL("../dados/catalogo.json", import.meta.url);
const PAGINA = 500;

/** GET paginado no PostgREST. Só leitura. */
async function ler(tabela: string, consulta: string): Promise<Record<string, unknown>[]> {
  const linhas: Record<string, unknown>[] = [];
  for (let de = 0; ; de += PAGINA) {
    const resp = await fetch(`${URL_BASE}/rest/v1/${tabela}?${consulta}`, {
      method: "GET",
      headers: { apikey: CHAVE!, Authorization: `Bearer ${CHAVE}`, Range: `${de}-${de + PAGINA - 1}`, "Range-Unit": "items" },
    });
    if (!resp.ok) throw new Error(`${tabela}: HTTP ${resp.status} ${await resp.text()}`);
    const lote = await resp.json() as Record<string, unknown>[];
    linhas.push(...lote);
    if (lote.length < PAGINA) return linhas;
  }
}

const emLista = (ids: string[]) => `in.(${ids.join(",")})`;

/** O PostgREST devolve `vector` como texto "[0.1,0.2,...]". */
function vetor(valor: unknown): number[] {
  const v = typeof valor === "string" ? JSON.parse(valor) : valor;
  if (!Array.isArray(v) || v.length !== 1536) throw new Error("embedding fora do formato esperado (1536 números)");
  return v as number[];
}

async function trechos(documentoIds: string[]) {
  if (!documentoIds.length) return [];
  const linhas = await ler("chunks_documentos", `select=id,documento_id,conteudo,chunk_index,metadados,embedding&documento_id=${emLista(documentoIds)}&order=documento_id,chunk_index`);
  return linhas.map((l) => ({ ...l, embedding: l.embedding == null ? null : vetor(l.embedding) }));
}

const meses: Record<string, unknown> = {};
for (const [mes, ids] of Object.entries(MANIFESTO.programacao_por_mes as Record<string, string[]>)) {
  const documentos = await ler("documentos_rag", `select=id,tipo,unidade_cuca,conteudo,metadados,created_at&id=${emLista(ids)}`);
  if (documentos.length !== ids.length) throw new Error(`mês ${mes}: esperava ${ids.length} documentos, vieram ${documentos.length}`);
  const campanhas = documentos.map((d) => (d.metadados as Record<string, string> | null)?.campanha_id).filter(Boolean) as string[];
  const atividades = campanhas.length ? await ler("atividades_mensais", `select=campanha_id,titulo,categoria,metadata&campanha_id=${emLista(campanhas)}`) : [];
  meses[mes] = { documentos, trechos: await trechos(ids), atividades_mensais: atividades };
  console.log(`mês ${mes}: ${documentos.length} documentos, ${atividades.length} atividades`);
}

// Comum a todos os casos: estado atual de produção (ativos).
const documentosComuns = await ler("documentos_rag", "select=id,tipo,unidade_cuca,conteudo,metadados,created_at&ativo=eq.true&tipo=in.(servicos_rede,FAQ,eventos_pontuais)");
const comum = {
  documentos: documentosComuns,
  trechos: await trechos(documentosComuns.map((d) => d.id as string)),
  prompts_agentes: await ler("prompts_agentes", "select=agente_tipo,prompt_sistema,prompt_contexto,temperatura,max_tokens,menu_boas_vindas,updated_at,ativo&ativo=eq.true&agente_tipo=eq.Institucional"),
  unidades_cuca: await ler("unidades_cuca", "select=nome,telefone,ativo&ativo=eq.true"),
  configuracoes: await ler("configuracoes", "select=chave,valor&chave=eq.numeros_canais_cuca"),
  system_config: await ler("system_config", "select=chave,valor&chave=eq.openai_precos_usd_por_milhao"),
};
console.log(`comum: ${documentosComuns.length} documentos (servicos_rede, FAQ, eventos), ${comum.trechos.length} trechos`);

await Deno.mkdir(new URL("../dados/", import.meta.url), { recursive: true });
await Deno.writeTextFile(SAIDA, JSON.stringify({ exportado_em: new Date().toISOString(), meses, comum }));
console.log("gravado: eval/dados/catalogo.json");
