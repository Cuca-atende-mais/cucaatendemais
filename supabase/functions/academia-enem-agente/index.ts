import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * Edge Function EXCLUSIVA da Academia Enem (S-AE-10, reconstrução — 2026-08-23).
 *
 * Decisão do Junior: a Academia Enem é um canal totalmente desacoplado dos demais dentro do
 * cucaatendemais — NUNCA compartilha Edge Function, RAG, log de disparo, persona ou processo
 * vivo com o Institucional/Empregabilidade/Ouvidoria/Acesso CUCA. Este arquivo é uma cópia
 * adaptada da parte relevante de `supabase/functions/motor-agente/index.ts` (persona, RAG,
 * chamada GPT, tags de handover/encerramento) — deliberadamente NÃO importa nada de lá. Deploy
 * próprio, nunca acoplado ao deploy do motor-agente (que atende o Institucional em produção).
 *
 * O que é reaproveitado (única exceção, confirmada com o Junior): a RPC `get_openai_key` (só
 * lê uma credencial de `configuracoes`, não é lógica de canal) e as tabelas `leads`/
 * `conversas`/`mensagens` (arquitetura de atendimento definida na S-AE-02/03/04, anterior a
 * esta reconstrução — fora de escopo desta mudança; ver nota na resposta ao Junior).
 *
 * NUNCA implementa `[[ENCAMINHAR:canal]]` — essa tag não existe aqui, estruturalmente
 * impossível de disparar (diferente do motor-agente, que processa essa tag pra Institucional/
 * maria). Se a pergunta for sobre outro assunto/canal, a persona só diz que não trata disso
 * por aqui — nunca direciona pra lugar nenhum.
 */

const GPT_MODEL = "gpt-4o";
const EMBEDDING_MODEL = "text-embedding-3-small";
const MAX_HISTORICO = 10;
const GPT_MAX_TENTATIVAS = 2;
const GPT_ESPERA_MAX_SEGUNDOS = 10;

// ─── Persona "Duda" — hardcoded aqui, sem depender de nenhuma tabela compartilhada ─────────
const PROMPT_SISTEMA = `REGRA CRÍTICA DE HANDOVER: Sempre que o usuário pedir para falar com um atendente humano, gerente, coordenador ou pessoa real (ex.: "quero falar com humano", "atendente", "pessoa real"), OU se você não conseguir resolver uma dúvida complexa depois de 3 tentativas, você DEVE concordar gentilmente E incluir OBRIGATORIAMENTE a tag [[HANDOVER]] no FINAL da sua resposta — sem exceção. Exemplo: "Com certeza, vou te passar para um humano. [[HANDOVER]]"

GUARDRAIL DE ESCOPO — REGRA ABSOLUTA:
Você é um assistente exclusivo do módulo Academia Enem da Rede CUCA. Responda APENAS sobre:
- Preparatório e aulas para o Enem, cronograma de conteúdo, presença nos encontros
- Inscrição no Enem, prazos, documentação, locais de prova
- Dúvidas gerais sobre o vestibular/Enem cobertas pela base de conhecimento própria deste módulo

Se a pergunta não tiver relação com o Enem/Academia Enem (ex.: perguntas sobre programação do
CUCA, vagas de emprego, outros assuntos da Rede CUCA), recuse educadamente:
"Não consigo te ajudar com isso por aqui, mas posso tirar qualquer dúvida sobre o Enem e a Academia Enem! 😊 O que você quer saber?"

REGRA ABSOLUTA — NUNCA ENCAMINHE PARA OUTROS CANAIS DA REDE CUCA:
Você NUNCA deve mencionar, indicar, comparar ou direcionar o usuário para nenhum outro canal da
Rede CUCA (Institucional/programação, Empregabilidade, Acesso CUCA, Ouvidoria) — nem por nome,
nem por telefone. A Academia Enem é um canal totalmente independente: se a pergunta for sobre
outro assunto, apenas diga que não trata desse assunto por aqui (frase do guardrail acima), sem
citar nenhum outro canal ou contato.

DROGAS E SUBSTÂNCIAS — REGRA ABSOLUTA:
Nunca compare, opine, explique efeitos ou dê qualquer informação sobre substâncias psicoativas.
Se o jovem trouxer esse tema, redirecione com acolhimento: "Esse é um assunto delicado e prefiro
não opinar. Mas saiba que o CUCA tem atendimento psicossocial gratuito — posso te passar mais
informações?" e ofereça transbordo com [[HANDOVER]] se ele quiser.

CRISE EMOCIONAL — PROTOCOLO OBRIGATÓRIO:
Se o usuário expressar sofrimento grave ("não quero mais viver", "pensei em me machucar", "estou
desesperado", "não aguento mais", "quero sumir" ou expressões similares):
1. Demonstre acolhimento genuíno e humano
2. Indique OBRIGATORIAMENTE o CVV: "Liga no 188 (gratuito, 24 horas) ou acessa cvv.org.br — lá
   tem pessoas preparadas para te ouvir."
3. Mencione o atendimento psicossocial gratuito do CUCA na unidade
4. NÃO tente resolver o problema — apenas acolha e direcione para apoio profissional

ANTI-ALUCINAÇÃO — REGRA CRÍTICA:
NUNCA invente, suponha ou infira datas, horários, locais de prova, cronogramas, regras de
inscrição ou qualquer dado do Enem que não esteja explicitamente no CONTEXTO (aviso recebido ou
RAG) fornecido pelo sistema.
Se não encontrar a informação, diga: "Não tenho essa informação aqui, quer que eu te transfira
para nossa equipe?" — se o lead disser sim, use a tag [[HANDOVER]]; se disser não, encerre
educadamente. É PROIBIDO inventar qualquer dado sobre o Enem que não esteja no contexto.

Você é Duda, a assistente da Academia Enem da Rede CUCA de Fortaleza.

PERSONALIDADE:
- Jovem, acolhedora, direta e focada em ajudar de verdade quem está se preparando para o Enem
- Usa linguagem informal mas respeitosa, nunca demasiado formal
- Usa emojis com moderação (1-2 por mensagem)
- Nunca usa termos técnicos como "RAG", "embedding", "banco de dados" ou similares

MISSÃO:
Tirar dúvidas dos jovens sobre o preparatório do Enem oferecido pela Academia Enem e sobre o
próprio Enem (inscrição, cronograma, locais de prova) — usando SEMPRE e SOMENTE o que está
disponível no contexto (aviso recebido pelo lead ou base de conhecimento própria deste módulo).

ENCERRAMENTO DE CONVERSA:
Se o usuário disser "obrigado", "valeu", "até mais", "tchau", "foi isso", "ok obrigado", "tá bom
obrigado" ou similar (despedida clara combinada com agradecimento), responda com uma mensagem
calorosa de despedida e inclua [[ENCERRAR]] ao final.
ATENÇÃO: NÃO encerre por um simples "obrigado" no meio de uma conversa ativa. Só encerre quando
for claramente uma despedida final.

REGRAS TÉCNICAS (invisíveis ao usuário):
1. USO DO AVISO RECEBIDO — PRIORIDADE MÁXIMA: se o contexto trouxer um bloco "ULTIMO DISPARO"
   (o aviso que o lead recebeu), verifique primeiro se a pergunta se refere a esse aviso. Se a
   resposta estiver lá, responda com base nele. Se a pergunta claramente NÃO se refere ao aviso,
   ignore esse bloco e use o CONTEXTO (base de conhecimento) normalmente.
2. USO DO RAG — só responda com dado que estiver explicitamente no bloco "--- CONTEXTO ---".
   Nunca complete uma informação parcial com suposição.
3. FORMATO DE RESPOSTA: no WhatsApp, seja direto — no máximo 3 parágrafos curtos por resposta.
4. ÁUDIO: o sistema já transcreve mensagens de voz automaticamente. Responda ao conteúdo
   transcrito normalmente, como se fosse texto. NÃO mencione que foi um áudio.
5. OPT-OUT: se receber "SAIR", "PARAR", "CANCELAR" → confirme saída.
6. IDIOMA: responda sempre em português brasileiro. Nunca em inglês.
7. INSCRIÇÃO: se perguntarem como se inscrever no Enem, use apenas o que estiver no CONTEXTO —
   nunca invente um site ou prazo que não esteja lá.`;

const TEMPERATURA = 0.7;
const MAX_TOKENS = 1800;

function removerTag(texto: string, nomeTag: string): { encontrada: boolean; texto: string } {
  const regex = new RegExp("\\[\\[\\s*" + nomeTag + "\\s*\\]\\]", "gi");
  const encontrada = regex.test(texto);
  return { encontrada, texto: texto.replace(regex, "").trim() };
}

function deveTentarNovamente(status: number, tentativa: number): boolean {
  const transitorio = status === 429 || status === 500 || status === 502 || status === 503;
  return transitorio && tentativa < GPT_MAX_TENTATIVAS;
}

function parseRetryAfterSegundos(header: string | null, corpo: string): number {
  if (header) {
    const s = Number(header);
    if (!Number.isNaN(s) && s >= 0) return s;
  }
  const m = corpo.match(/try again in ([\d.]+)s/i);
  return m ? Number(m[1]) : 1;
}

async function getOpenAIKey(supabase: ReturnType<typeof createClient>): Promise<string> {
  const { data } = await supabase.rpc("get_openai_key");
  return data || Deno.env.get("OPENAI_API_KEY") || "";
}

async function gerarEmbedding(texto: string, apiKey: string, tentativa = 0): Promise<number[]> {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texto.slice(0, 8000) }),
  });
  if (deveTentarNovamente(resp.status, tentativa)) {
    const corpo = await resp.text();
    const espera = Math.min(parseRetryAfterSegundos(resp.headers.get("retry-after"), corpo), GPT_ESPERA_MAX_SEGUNDOS);
    await new Promise((r) => setTimeout(r, espera * 1000));
    return gerarEmbedding(texto, apiKey, tentativa + 1);
  }
  if (!resp.ok) throw new Error("Embedding error: " + await resp.text());
  return (await resp.json()).data[0].embedding;
}

async function chamarGPT(
  historico: { role: string; content: string }[],
  apiKey: string,
  tentativa = 0,
): Promise<string> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: GPT_MODEL, temperature: TEMPERATURA, max_tokens: MAX_TOKENS,
      messages: [{ role: "system", content: PROMPT_SISTEMA }, ...historico],
    }),
  });
  if (deveTentarNovamente(resp.status, tentativa)) {
    const corpo = await resp.text();
    const espera = Math.min(parseRetryAfterSegundos(resp.headers.get("retry-after"), corpo), GPT_ESPERA_MAX_SEGUNDOS);
    await new Promise((r) => setTimeout(r, espera * 1000));
    return chamarGPT(historico, apiKey, tentativa + 1);
  }
  if (!resp.ok) throw new Error("GPT-4o error: " + await resp.text());
  return (await resp.json()).choices[0].message.content;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  try {
    const body = await req.json();
    const { mensagem, telefone, conversa_id, lead_id } = body;
    if (!mensagem || !telefone || !conversa_id) {
      return new Response(JSON.stringify({ error: "mensagem, telefone e conversa_id sao obrigatorios" }), { status: 400 });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const [openaiKey, { data: conversa }, { data: hist }] = await Promise.all([
      getOpenAIKey(supabase),
      supabase.from("conversas").select("id, metadata").eq("id", conversa_id).single(),
      supabase.from("mensagens").select("conteudo, remetente").eq("conversa_id", conversa_id)
        .order("created_at", { ascending: false }).limit(MAX_HISTORICO),
    ]);
    if (!openaiKey) throw new Error("OPENAI_API_KEY nao encontrada");

    const historico = (hist || []).reverse().map((m: { conteudo: string; remetente: string }) => ({
      role: m.remetente === "lead" ? "user" : "assistant",
      content: m.conteudo || "",
    }));

    // Breadcrumb do último aviso — texto completo (S-AE-09), não só o título.
    let contextoDisparo = "";
    const ultimoDisparo = conversa?.metadata?.ultimo_disparo;
    if (ultimoDisparo) {
      contextoDisparo = "ULTIMO DISPARO: Lead recebeu '" + ultimoDisparo.titulo + "' (" +
        new Date(ultimoDisparo.enviado_em).toLocaleDateString("pt-BR") + ")";
      if (ultimoDisparo.texto) contextoDisparo += "\nTEXTO DO AVISO: " + ultimoDisparo.texto;
    }

    // RAG isolado — RPC própria (ae_buscar_chunks_similares), tabelas próprias
    // (ae_documentos_rag/ae_chunks_documentos), NUNCA a busca compartilhada.
    let contextoRag = "";
    try {
      const embedding = await gerarEmbedding(mensagem, openaiKey);
      const { data: chunks } = await supabase.rpc("ae_buscar_chunks_similares", {
        query_embedding: "[" + embedding.join(",") + "]",
        p_tipos: null,
        p_limite: 5,
      });
      if (chunks && chunks.length > 0) {
        contextoRag = "\n\n--- CONTEXTO ---\n" + chunks.map((c: { conteudo: string }) => c.conteudo).join("\n---\n");
      }
    } catch (embErr) {
      console.error("[academia-enem-agente] Erro ao buscar RAG:", embErr);
    }

    const dataAtual = "DATA E HORA ATUAL: " + new Date().toLocaleDateString("pt-BR", {
      weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/Fortaleza",
    });

    const promptUsuario = [dataAtual, contextoDisparo, contextoRag].filter(Boolean).join("\n\n");
    const historicoCompleto = [...historico, { role: "user", content: promptUsuario + "\n\nMENSAGEM DO LEAD: " + mensagem }];

    let resposta = await chamarGPT(historicoCompleto, openaiKey);

    let handover = false;
    let encerrado = false;
    const avHandover = removerTag(resposta, "handover");
    if (avHandover.encontrada) { handover = true; resposta = avHandover.texto; }
    const avEncerrar = removerTag(resposta, "encerrar");
    if (avEncerrar.encontrada) { encerrado = true; resposta = avEncerrar.texto; }

    if (!resposta) {
      if (handover) resposta = "Vou te encaminhar para um atendente humano, só um momento!";
      else if (encerrado) resposta = "Tudo certo! Qualquer coisa, é só chamar novamente. 😊";
    }

    // Grava a resposta da IA no histórico (tabela compartilhada `mensagens` — arquitetura de
    // atendimento definida na S-AE-02/03/04, fora do escopo desta reconstrução).
    await supabase.from("mensagens").insert({
      conversa_id, lead_id: lead_id || null, tipo: "text", conteudo: resposta, remetente: "agente",
    });

    if (encerrado) {
      await supabase.from("conversas").update({ status: "encerrada", updated_at: new Date().toISOString() }).eq("id", conversa_id);
    }
    // handover=true NÃO marca awaiting_human aqui — quem aciona o transbordo de verdade
    // (worker/academia_enem_engine.py::acionar_transbordo, já isolado por `modulo='academia_enem'`)
    // é o worker, que também notifica o responsável. Esta function só sinaliza a intenção.

    return new Response(JSON.stringify({ success: true, resposta, handover, encerrado }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[academia-enem-agente] Erro:", err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "erro desconhecido" }), { status: 500 });
  }
});
