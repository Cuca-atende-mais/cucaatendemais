import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { extractText } from "npm:unpdf";

const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;

export function chunkarTexto(texto: string, tamanho: number, overlap: number): string[] {
  const chunks: string[] = [];
  let inicio = 0;
  const textoLimpo = texto.replace(/\s+/g, " ").trim();
  while (inicio < textoLimpo.length) {
    const fim = Math.min(inicio + tamanho, textoLimpo.length);
    const chunk = textoLimpo.slice(inicio, fim).trim();
    if (chunk.length > 50) chunks.push(chunk);
    inicio += tamanho - overlap;
  }
  return chunks;
}

/**
 * VAL-02 (docs/migracao-meta/VALIDACAO-producao-institucional.md): monthly_program é gerado
 * com cada atividade/turma como um registro delimitado por "• " (ex.: "• NATAÇÃO Detalhes:
 * Esporte Modalidade: NATAÇÃO - Turma Turma 2. Professor: CIRILLO..."). chunkarTexto corta por
 * tamanho fixo de caractere, sem noção de registro — confirmado em produção (Cuca Barra,
 * chunks 32/33 do monthly_program ativo) que isso parte um registro no meio ("...NATAÇÃO -
 * Turm" | "a Turma 2. Professor: CIRILLO..."), fragmentando justamente o par
 * modalidade→professor que a busca vetorial de acompanhamento (motor-agente, p_limite=5)
 * precisa achar inteiro numa pergunta como "quem é o professor de natação". Modalidades com
 * muitas turmas (Natação teve 8+ registros só na Barra) multiplicam o risco de corte.
 * Agrupa registros completos até `tamanho`; nunca corta um registro ao meio, mesmo que isso
 * gere um chunk menor ou maior que `tamanho`.
 */
export function chunkarPorRegistro(texto: string, tamanho: number): string[] {
  const textoLimpo = texto.replace(/\s+/g, " ").trim();
  const partes = textoLimpo.split(/(?=• )/g).map((p) => p.trim()).filter((p) => p.length > 0);
  const chunks: string[] = [];
  let atual = "";
  for (const parte of partes) {
    if (atual.length > 0 && atual.length + 1 + parte.length > tamanho) {
      chunks.push(atual);
      atual = parte;
    } else {
      atual = atual.length > 0 ? atual + " " + parte : parte;
    }
  }
  if (atual.length > 0) chunks.push(atual);
  return chunks.filter((c) => c.length > 50);
}

/**
 * S-WM-AUD-004 / Plano 011: para `monthly_program`, cada atividade JÁ é um registro estruturado em
 * `atividades_mensais`. Gera 1 chunk por atividade, direto da tabela-fonte, em vez de fatiar o
 * texto concatenado — nem por tamanho fixo (`chunkarTexto`, que parte registro no meio) nem
 * agrupando vários registros (`chunkarPorRegistro`).
 *
 * DECISÃO QUE DIVERGE DO PLANO 011 — o plano mandava portar `formatarLinhaAtividadeDeterministica`
 * (motor-agente) e gerar o texto do chunk com ela. Isso QUEBRARIA a busca de cursos: para
 * categoria != ESPORTES aquela função produz "Categoria CURSOS - Atividade: ...", que não casa
 * NENHUMA das duas regexes de `extrairModalidades` (`Modalidade: X - Turma` e `Curso: X. Educador:`).
 * O padrão "Curso: ... Educador:" vive em `atividades_mensais.descricao`, montada pelo portal
 * (`lib/programacao/payload.ts`), não naquela função.
 * Confirmado em produção: 64/64 linhas de CURSOS casam a regex de curso via `descricao`, e
 * 369/377 de ESPORTES casam a de esporte. Usar `descricao` preserva as duas pontas e elimina a
 * duplicação de função entre dois deployments Deno que o próprio plano registrava como débito.
 *
 * O bloco por registro espelha EXATAMENTE o formato que `trigger_indexar_campanha_mensal` já
 * escreve em `documentos_rag.conteudo` ("• titulo / Detalhes: / Local: / Horário:") — zero drift
 * de formato em relação ao que está indexado hoje.
 */
export interface AtividadeParaChunk {
  titulo: string | null;
  categoria: string | null;
  descricao: string | null;
  local?: string | null;
  hora_inicio?: string | null;
  hora_fim?: string | null;
}

export function montarChunkDeAtividade(a: AtividadeParaChunk): string {
  const linhas: string[] = ["• " + (a.titulo ?? "").trim()];
  if (a.descricao && a.descricao.trim() !== "") linhas.push("  Detalhes: " + a.descricao.trim());
  if (a.local && a.local.trim() !== "" && a.local.trim() !== "Não informado") linhas.push("  Local: " + a.local.trim());
  if (a.hora_inicio) {
    let h = "  Horário: " + a.hora_inicio;
    if (a.hora_fim) h += " às " + a.hora_fim;
    linhas.push(h);
  }
  return linhas.join("\n");
}

/**
 * Devolve `null` (e o caller cai no chunking por texto) quando não há atividade utilizável —
 * nunca indexa vazio, nunca falha silenciosamente.
 */
export function montarChunksPorAtividade(
  cabecalho: string,
  atividades: AtividadeParaChunk[],
): { conteudo: string; titulo: string; categoria: string }[] | null {
  const uteis = atividades.filter((a) => typeof a.titulo === "string" && a.titulo.trim() !== "");
  if (uteis.length === 0) return null;
  // O cabeçalho (mês/ano/unidade + frase de vigência, S-PROG-10 item 2) entra em CADA chunk: sem
  // isso, um chunk isolado recuperado pela busca vetorial não carrega a que mês ele pertence —
  // era o que o cabeçalho garantia quando existia um documento corrido só.
  const prefixo = cabecalho.trim() !== "" ? cabecalho.trim() + "\n" : "";
  return uteis.map((a) => ({
    conteudo: prefixo + montarChunkDeAtividade(a),
    titulo: (a.titulo as string).trim(),
    categoria: (a.categoria ?? "nao informado").trim(),
  }));
}

/** Decide a estratégia de chunking por tipo de documento — monthly_program usa
 * chunkarPorRegistro (registro completo); os demais tipos (FAQ, vagas, eventos_pontuais etc.)
 * mantêm chunkarTexto (tamanho fixo), sem mudança de comportamento. */
export function chunkarDocumento(tipo: string, texto: string, tamanho: number, overlap: number): string[] {
  if (tipo === "monthly_program") return chunkarPorRegistro(texto, tamanho);
  return chunkarTexto(texto, tamanho, overlap);
}

async function gerarEmbedding(texto: string, apiKey: string): Promise<number[]> {
  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: OPENAI_EMBEDDING_MODEL, input: texto }),
  });
  if (!response.ok) throw new Error(`OpenAI Embeddings Error: ${await response.text()}`);
  const data = await response.json();
  return data.data[0].embedding;
}

async function extrairTextoPdf(supabase: ReturnType<typeof createClient>, pdfPath: string): Promise<string> {
  const { data: blob, error } = await supabase.storage
    .from("rag-documentos")
    .download(pdfPath);
  if (error || !blob) {
    throw new Error(`Erro ao baixar PDF do Storage: ${error?.message ?? "blob vazio"}`);
  }
  const arrayBuffer = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const { text } = await extractText(uint8Array, { mergePages: true });
  if (!text || text.trim().length < 20) {
    throw new Error("PDF sem texto extraível. Verifique se o arquivo não é escaneado/imagem.");
  }
  return text;
}

// import.meta.main evita que o import deste arquivo por um teste (Deno.test) suba um listener
// HTTP real — mesmo padrão do motor-agente (index.ts). Sem isso, importar as funções puras de
// chunking (chunkarTexto/chunkarPorRegistro/chunkarDocumento) para teste dispararia o servidor.
async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), { status: 405 });
  }
  try {
    const body = await req.json();
    const { documento_id, source_type, cuca_unit_id, pdf_path: pdfPathBody } = body;
    if (!documento_id) {
      return new Response(JSON.stringify({ error: "documento_id é obrigatório" }), { status: 400 });
    }
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    const { data: keyData } = await supabase.rpc("get_openai_key");
    const openaiKey = keyData || Deno.env.get("OPENAI_API_KEY") || "";
    if (!openaiKey) throw new Error("OPENAI_API_KEY não encontrada. Verifique o Supabase Vault.");
    const { data: documento, error: docError } = await supabase
      .from("documentos_rag")
      .select("*")
      .eq("id", documento_id)
      .single();
    if (docError || !documento) {
      return new Response(JSON.stringify({ error: "Documento não encontrado", details: docError }), { status: 404 });
    }
    const pdfPath: string | null = pdfPathBody || (documento.metadados?.pdf_path as string | null) || null;
    let textoPrincipal: string;
    if (pdfPath) {
      textoPrincipal = await extrairTextoPdf(supabase, pdfPath);
      await supabase.from("documentos_rag").update({ conteudo: textoPrincipal }).eq("id", documento_id);
    } else {
      textoPrincipal = documento.conteudo ?? "";
      if (textoPrincipal.trim().length < 20) {
        throw new Error("Documento sem conteúdo para indexar.");
      }
    }
    const textoCompleto = `${documento.titulo}\n\n${textoPrincipal}`;
    await supabase.from("chunks_documentos").delete().eq("documento_id", documento_id);

    // S-WM-AUD-004 / Plano 011: caminho por ATIVIDADE, só para monthly_program com campanha_id.
    // Qualquer outra coisa (FAQ, PDF, evento, monthly_program legado sem vínculo) segue por
    // chunkarDocumento — fallback defensivo, nunca deixa de indexar.
    let chunks: string[];
    let metaPorChunk: { titulo: string; categoria: string }[] | null = null;
    const campanhaId = documento.tipo === "monthly_program"
      ? (documento.metadados?.campanha_id as string | undefined)
      : undefined;

    if (campanhaId) {
      const { data: atividades } = await supabase
        .from("atividades_mensais")
        .select("titulo, categoria, descricao, local, hora_inicio, hora_fim")
        .eq("campanha_id", campanhaId)
        .order("categoria", { ascending: true })
        .order("data_atividade", { ascending: true })
        .order("hora_inicio", { ascending: true });
      // Cabeçalho = tudo antes da 1ª linha em branco do conteúdo montado pelo trigger
      // (mês por extenso + frase de vigência + título, S-PROG-10 item 2).
      const cabecalho = (documento.conteudo ?? "").split("\n\n")[0] ?? "";
      const porAtividade = montarChunksPorAtividade(cabecalho, (atividades ?? []) as AtividadeParaChunk[]);
      if (porAtividade) {
        chunks = porAtividade.map((c) => c.conteudo);
        metaPorChunk = porAtividade.map((c) => ({ titulo: c.titulo, categoria: c.categoria }));
        console.log(`[processar-documento] monthly_program por atividade: ${chunks.length} chunks (1 por atividade)`);
      } else {
        chunks = chunkarDocumento(documento.tipo, textoCompleto, CHUNK_SIZE, CHUNK_OVERLAP);
        console.warn(`[processar-documento] campanha ${campanhaId} sem atividade utilizavel — caiu no chunking por texto`);
      }
    } else {
      chunks = chunkarDocumento(documento.tipo, textoCompleto, CHUNK_SIZE, CHUNK_OVERLAP);
    }

    const chunksSalvos: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await gerarEmbedding(chunks[i], openaiKey);
      const { data: salvo } = await supabase
        .from("chunks_documentos")
        .insert({
          documento_id,
          chunk_index: i,
          conteudo: chunks[i],
          embedding: `[${embedding.join(",")}]`,
          metadados: {
            tipo: documento.tipo,
            unidade_cuca: cuca_unit_id ?? documento.unidade_cuca,
            source_type: source_type ?? documento.metadados?.source_type ?? "rede_cuca_global",
            titulo: documento.titulo,
            // Plano 011: título e categoria da ATIVIDADE daquele chunk (não do documento inteiro)
            // — serve pra depuração e pra um filtro futuro por categoria.
            ...(metaPorChunk ? { atividade_titulo: metaPorChunk[i].titulo, atividade_categoria: metaPorChunk[i].categoria } : {}),
          },
        })
        .select("id")
        .single();
      if (salvo) chunksSalvos.push(salvo.id);
      if (i < chunks.length - 1) await new Promise(r => setTimeout(r, 200));
    }
    await supabase
      .from("documentos_rag")
      .update({
        metadados: {
          ...(documento.metadados ?? {}),
          indexado_em: new Date().toISOString(),
          total_chunks: chunksSalvos.length,
          source_type: source_type ?? documento.metadados?.source_type ?? "rede_cuca_global",
          ...(pdfPath && { pdf_path: pdfPath, pdf_nome: documento.metadados?.pdf_nome }),
        },
      })
      .eq("id", documento_id);
    // S-WM-AUD-004 (AC5): a troca do monthly_program ativo acontece AQUI — depois de os chunks
    // existirem de verdade —, não na aprovação da campanha. O RPC confere `chunks > 0` do seu
    // lado também (não confia no caller) e faz ativa-este/desativa-os-outros num statement só.
    // Nunca derruba a resposta: se o RPC falhar, o mês anterior simplesmente continua no ar.
    let ativado = false;
    if (documento.tipo === "monthly_program" && chunksSalvos.length > 0) {
      const { data: trocou, error: erroAtivacao } = await supabase
        .rpc("ativar_monthly_program_indexado", { p_documento_id: documento_id });
      if (erroAtivacao) {
        console.error("[processar-documento] Falha ao ativar monthly_program indexado:", erroAtivacao);
      } else {
        ativado = trocou === true;
        console.log(`[processar-documento] monthly_program ativado apos indexacao: ${ativado}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        documento_id,
        titulo: documento.titulo,
        total_chunks: chunksSalvos.length,
        fonte: pdfPath ? "pdf" : "texto",
        ativado,
      }),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    );
  } catch (error) {
    console.error("[processar-documento] Erro:", error);
    return new Response(
      JSON.stringify({ error: "Erro interno", details: error instanceof Error ? error.message : String(error) }),
      { status: 500 }
    );
  }
}

if (import.meta.main) {
  Deno.serve((req: Request) => handler(req));
}
