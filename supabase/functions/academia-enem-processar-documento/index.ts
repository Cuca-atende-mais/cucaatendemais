import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { extractText } from "npm:unpdf";

/**
 * Ingestão de RAG EXCLUSIVA da Academia Enem (S-AE-10, reconstrução — 2026-08-23).
 *
 * Cópia adaptada de `supabase/functions/processar-documento/index.ts`, escrevendo em
 * `ae_documentos_rag`/`ae_chunks_documentos` (tabelas próprias) em vez de
 * `documentos_rag`/`chunks_documentos` (compartilhadas). Deliberadamente NÃO importa nada de
 * lá — deploy próprio, nunca acoplado ao pipeline de ingestão dos outros módulos.
 */

const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const CHUNK_SIZE = 800;
const CHUNK_OVERLAP = 100;

// CORS: esta function é chamada direto do navegador (portal cliente). Sem tratar o preflight
// OPTIONS e sem devolver Access-Control-*, o navegador bloqueia a chamada cross-origin e o
// portal recebe "TypeError: Failed to fetch" antes de o POST sequer ser enviado.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

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
  const { data: blob, error } = await supabase.storage.from("rag-documentos").download(pdfPath);
  if (error || !blob) throw new Error(`Erro ao baixar PDF do Storage: ${error?.message ?? "blob vazio"}`);
  const arrayBuffer = await blob.arrayBuffer();
  const { text } = await extractText(new Uint8Array(arrayBuffer), { mergePages: true });
  if (!text || text.trim().length < 20) throw new Error("PDF sem texto extraível. Verifique se o arquivo não é escaneado/imagem.");
  return text;
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  try {
    const body = await req.json();
    const { documento_id, pdf_path: pdfPathBody } = body;
    if (!documento_id) return jsonResponse({ error: "documento_id é obrigatório" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: keyData } = await supabase.rpc("get_openai_key");
    const openaiKey = keyData || Deno.env.get("OPENAI_API_KEY") || "";
    if (!openaiKey) throw new Error("OPENAI_API_KEY não encontrada.");

    const { data: documento, error: docError } = await supabase
      .from("ae_documentos_rag").select("*").eq("id", documento_id).single();
    if (docError || !documento) {
      return jsonResponse({ error: "Documento não encontrado", details: docError }, 404);
    }

    const pdfPath: string | null = pdfPathBody || (documento.metadados?.pdf_path as string | null) || null;
    let textoPrincipal: string;
    if (pdfPath) {
      textoPrincipal = await extrairTextoPdf(supabase, pdfPath);
      await supabase.from("ae_documentos_rag").update({ conteudo: textoPrincipal }).eq("id", documento_id);
    } else {
      textoPrincipal = documento.conteudo ?? "";
      if (textoPrincipal.trim().length < 20) throw new Error("Documento sem conteúdo para indexar.");
    }

    const textoCompleto = `${documento.titulo}\n\n${textoPrincipal}`;
    await supabase.from("ae_chunks_documentos").delete().eq("documento_id", documento_id);
    const chunks = chunkarTexto(textoCompleto, CHUNK_SIZE, CHUNK_OVERLAP);
    const chunksSalvos: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const embedding = await gerarEmbedding(chunks[i], openaiKey);
      const { data: salvo } = await supabase
        .from("ae_chunks_documentos")
        .insert({
          documento_id, chunk_index: i, conteudo: chunks[i],
          embedding: `[${embedding.join(",")}]`,
          metadados: { tipo: documento.tipo, titulo: documento.titulo },
        })
        .select("id").single();
      if (salvo) chunksSalvos.push(salvo.id);
      if (i < chunks.length - 1) await new Promise((r) => setTimeout(r, 200));
    }

    await supabase.from("ae_documentos_rag").update({
      metadados: {
        ...(documento.metadados ?? {}),
        indexado_em: new Date().toISOString(),
        total_chunks: chunksSalvos.length,
        ...(pdfPath && { pdf_path: pdfPath, pdf_nome: documento.metadados?.pdf_nome }),
      },
    }).eq("id", documento_id);

    return jsonResponse({
      success: true, documento_id, titulo: documento.titulo,
      total_chunks: chunksSalvos.length, fonte: pdfPath ? "pdf" : "texto",
    }, 200);
  } catch (error) {
    console.error("[academia-enem-processar-documento] Erro:", error);
    return jsonResponse({
      error: "Erro interno", details: error instanceof Error ? error.message : String(error),
    }, 500);
  }
}

if (import.meta.main) {
  Deno.serve((req: Request) => handler(req));
}
