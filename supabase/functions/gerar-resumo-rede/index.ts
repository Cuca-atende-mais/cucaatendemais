import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GPT_MODEL = "gpt-4o";

export type ProgramaUnidade = { unidade: string; conteudo: string };

/**
 * S-WM-32 (Escopo item 3): monta o prompt do passo de LLM que lê o monthly_program ativo de
 * cada unidade e normaliza nomes de atividade equivalentes (ex.: "futsal" e "futebol de salão")
 * numa única entrada do índice "atividade → unidades". Pura e testável sem mock de fetch —
 * mesmo espírito de montarMensagemEncaminhamento/INSTRUCAO_SEGURANCA no motor-agente.
 */
export function montarPromptResumoRede(programas: ProgramaUnidade[]): string {
  const blocos = programas.map((p) => "--- " + p.unidade + " ---\n" + p.conteudo).join("\n\n");
  return [
    "Você vai gerar um ÍNDICE CONSOLIDADO de atividades da Rede CUCA a partir da programação",
    "mensal de cada unidade abaixo.",
    "",
    "REGRAS OBRIGATÓRIAS:",
    "1. Para cada atividade/modalidade REAL mencionada em pelo menos uma unidade (ex.: Natação,",
    "   Futebol, Judô), liste quais unidades oferecem — normalize nomes equivalentes entre",
    "   unidades (ex.: 'futsal' e 'futebol de salão' viram a mesma entrada; use o nome mais comum).",
    "2. NUNCA invente uma atividade que não apareça no texto de nenhuma unidade abaixo.",
    "3. Se uma atividade só existe em 1 unidade, ainda assim liste — não omita.",
    "4. Formato de saída: uma linha por atividade, no formato exato",
    "   'Nome da atividade: Unidade A, Unidade B, Unidade C'.",
    "5. Não inclua horários, professores ou vagas — só o índice atividade → unidades.",
    "",
    blocos,
  ].join("\n");
}

async function chamarLLMResumoRede(prompt: string, apiKey: string): Promise<string> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GPT_MODEL,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!resp.ok) throw new Error("GPT error: " + await resp.text());
  const body = await resp.json();
  return body.choices[0].message.content as string;
}

// `supabaseOverride` existe só pra permitir teste automatizado do handler completo (mesmo
// padrão já usado em motor-agente/index.ts e processar-documento) — em produção nunca é
// passado, então os 2 clients reais (usuário/service role) são sempre criados normalmente.
export async function handler(req: Request, supabaseOverride?: ReturnType<typeof createClient>): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    // S-WM-32 (AC7): has_permission depende de auth.uid(), que só resolve corretamente quando
    // o client Supabase carrega o JWT de quem fez a requisição — nunca o service role key aqui,
    // senão a checagem de permissão vira um no-op (auth.uid() resolveria null/service role).
    const authHeader = req.headers.get("Authorization") || "";
    const supabaseUsuario = supabaseOverride ?? createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: permitido } = await supabaseUsuario.rpc("has_permission", {
      p_recurso: "programacao_rag_global",
      p_acao: "update",
    });
    if (!permitido) {
      return new Response(JSON.stringify({ error: "Sem permissão para atualizar o resumo de rede" }), { status: 403 });
    }

    // Service role pra ler monthly_program de todas as unidades e escrever o novo resumo_rede
    // — bypassa RLS de propósito (mesmo padrão de processar-documento/motor-agente), a
    // autorização real já foi feita acima via has_permission.
    const supabase = supabaseOverride ?? createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: keyData } = await supabase.rpc("get_openai_key");
    const openaiKey = keyData || Deno.env.get("OPENAI_API_KEY") || "";
    if (!openaiKey) throw new Error("OPENAI_API_KEY não encontrada.");

    const { data: docs } = await supabase
      .from("documentos_rag")
      .select("unidade_cuca, conteudo")
      .eq("tipo", "monthly_program")
      .eq("ativo", true);

    const programas: ProgramaUnidade[] = (docs || [])
      .filter((d: { unidade_cuca: string | null; conteudo: string }) => !!d.unidade_cuca)
      .map((d: { unidade_cuca: string | null; conteudo: string }) => ({ unidade: d.unidade_cuca as string, conteudo: d.conteudo }));

    if (programas.length === 0) {
      return new Response(JSON.stringify({ error: "Nenhum monthly_program ativo encontrado para gerar o resumo de rede" }), { status: 422 });
    }

    const prompt = montarPromptResumoRede(programas);
    const resumo = await chamarLLMResumoRede(prompt, openaiKey);

    // S-WM-32 (Escopo item 1/4): detecta e substitui — nunca duas versões ativo=true
    // simultâneas. Cobre tanto gerações automáticas anteriores quanto o registro manual do
    // stopgap (id=8b0b4157-7024-421d-bdc3-a7d5ec944d6a), sem distinção — qualquer resumo_rede
    // ativo é desativado antes do novo entrar.
    await supabase.from("documentos_rag").update({ ativo: false }).eq("tipo", "resumo_rede").eq("ativo", true);

    const agora = new Date();
    const titulo = "Resumo de Rede - Atividades por Unidade - " + (agora.getMonth() + 1) + "/" + agora.getFullYear();
    const { data: novo, error } = await supabase
      .from("documentos_rag")
      .insert({
        titulo,
        tipo: "resumo_rede",
        conteudo: resumo,
        unidade_cuca: null,
        ativo: true,
        metadados: { source_type: "resumo_rede_auto", unidades_incluidas: programas.map((p) => p.unidade) },
      })
      .select("id")
      .single();
    if (error) throw error;

    return new Response(
      JSON.stringify({ success: true, documento_id: novo.id, unidades: programas.length }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[gerar-resumo-rede] Erro:", error);
    return new Response(
      JSON.stringify({ error: "Erro interno", details: error instanceof Error ? error.message : String(error) }),
      { status: 500 },
    );
  }
}

if (import.meta.main) {
  Deno.serve((req: Request) => handler(req));
}
