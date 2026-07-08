import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const GPT_MODEL = "gpt-4o";
const EMBEDDING_MODEL = "text-embedding-3-small";
const WHISPER_MODEL = "whisper-1";
const MAX_HISTORICO = 10;

const RAG_FONTES_POR_AGENTE: Record<string, string[]> = {
  maria: ["FAQ", "eventos_pontuais", "monthly_program"],
  julia: ["FAQ", "vagas"],
  ana: ["FAQ", "espacos_disponiveis"],
  sofia: ["FAQ"],
  Institucional: ["FAQ", "eventos_pontuais", "monthly_program"],
};

const UNIDADES_MAP: Record<string, string> = {
  'barra': 'Cuca Barra', 'jangurussu': 'Cuca Jangurussu', 'mondubim': 'Cuca Mondubim',
  'pici': 'Cuca Pici', 'jos\u00e9 walter': 'Cuca Jos\u00e9 Walter',
  'jose walter': 'Cuca Jos\u00e9 Walter', 'walter': 'Cuca Jos\u00e9 Walter',
  '1': 'Cuca Barra', '2': 'Cuca Jangurussu', '3': 'Cuca Mondubim', '4': 'Cuca Pici', '5': 'Cuca Jos\u00e9 Walter',
};

export const MENU_UNIDADES = "Sobre qual unidade CUCA voc\u00ea quer saber? \ud83d\ude0a\n\n1\ufe0f\u20e3 Barra\n2\ufe0f\u20e3 Jangurussu\n3\ufe0f\u20e3 Mondubim\n4\ufe0f\u20e3 Pici\n5\ufe0f\u20e3 Jos\u00e9 Walter";

export function ehSelecaoMenu(texto: string): boolean {
  return /^[1-5]$/.test(texto.trim());
}

export function extrairTextoMenu(numero: string, ultimaMsgAgente: string): string {
  for (const linha of ultimaMsgAgente.split('\n')) {
    const s = linha.trim().replace(/[\ufe0f\u20e3]/g, '');
    if (s.startsWith(numero + ' ') || s.startsWith(numero + '.') || s.startsWith(numero + ')')) {
      return linha.replace(/^[\d\ufe0f\u20e3.\)\s]+/, '').trim();
    }
  }
  return '';
}

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * §6 (débito parcial): endurece o parsing de tags de controle contra variação de case e
 * espaçamento (ex.: "[[handover]]", "[[ HANDOVER ]]"). NÃO resolve paráfrase — se o GPT
 * comunicar a intenção sem emitir a tag literal, isso ainda escapa. Resolver isso exigiria
 * structured output real (campo booleano via response_format), o que por sua vez exige
 * reescrever as instruções em prompts_agentes (4 personas, hoje instruídas a emitir a tag
 * como texto) coordenado com a mudança de parsing — decisão adiada, ver relatório.
 */
export function removerTag(texto: string, nomeTag: string): { encontrada: boolean; texto: string } {
  const nomeEscapado = escaparRegex(nomeTag);
  const encontrada = new RegExp("\\[\\[\\s*" + nomeEscapado + "\\s*\\]\\]", "i").test(texto);
  const textoLimpo = texto.replace(new RegExp("\\[\\[\\s*" + nomeEscapado + "\\s*\\]\\]", "gi"), "").trim();
  return { encontrada, texto: textoLimpo };
}

/** Testa se `chave` aparece em `texto` como palavra inteira (n\u00e3o substring solta, ex.: "barra" em "barra de chocolate") */
export function contemPalavra(texto: string, chave: string): boolean {
  return new RegExp("\\b" + escaparRegex(chave) + "\\b").test(texto);
}

/** Detecta se a mensagem menciona uma unidade diferente da atual */
export function detectarTrocaUnidade(texto: string, unidadeAtual: string): string | null {
  const lower = texto.toLowerCase().trim();
  const nomesUnidades: Record<string, string> = {
    'barra': 'Cuca Barra', 'jangurussu': 'Cuca Jangurussu', 'mondubim': 'Cuca Mondubim',
    'pici': 'Cuca Pici', 'jos\u00e9 walter': 'Cuca Jos\u00e9 Walter', 'jose walter': 'Cuca Jos\u00e9 Walter', 'walter': 'Cuca Jos\u00e9 Walter',
  };
  for (const [chave, unidade] of Object.entries(nomesUnidades)) {
    if (contemPalavra(lower, chave) && unidade !== unidadeAtual) {
      return unidade;
    }
  }
  return null;
}

const UNIDADES_VALIDAS = ['Cuca Barra', 'Cuca Jangurussu', 'Cuca Mondubim', 'Cuca Pici', 'Cuca José Walter'];

export type AvaliacaoSelecaoUnidade = { unidade: string | null; quer_sair: boolean; mudou_de_assunto: boolean };

const AVALIACAO_SELECAO_UNIDADE_DEFAULT: AvaliacaoSelecaoUnidade = { unidade: null, quer_sair: false, mudou_de_assunto: false };

/** Valida o JSON retornado pelo GPT contra o contrato esperado — nunca confia cegamente no LLM */
export function validarAvaliacaoSelecaoUnidade(data: unknown): AvaliacaoSelecaoUnidade {
  const obj = (data && typeof data === "object") ? data as Record<string, unknown> : {};
  const unidade = (typeof obj.unidade === "string" && UNIDADES_VALIDAS.includes(obj.unidade)) ? obj.unidade : null;
  return {
    unidade,
    quer_sair: obj.quer_sair === true,
    mudou_de_assunto: obj.mudou_de_assunto === true,
  };
}

/**
 * Fallback semântico (padrão S-WM-20 `avaliar_mensagem_contextual`, portado de Python/worker
 * para TS/Deno) para quando o lead não escolheu a unidade por nome/número exato — cobre
 * erro de digitação ("jangurusu"), referência indireta ("a do José Walter mesmo") e permite
 * diferenciar "não entendi qual unidade" (ambíguo, tentando escolher) de "não estava tentando
 * escolher uma unidade" (cortesia/mudança de assunto/saída), pra não empurrar o menu de novo
 * em cima de uma mensagem tipo "Obrigado pela mensagem".
 * Nunca propaga exceção — qualquer falha cai no default seguro (equivalente a "não identifiquei").
 */
async function avaliarSelecaoUnidade(texto: string, openaiKey: string): Promise<AvaliacaoSelecaoUnidade> {
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + openaiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 60,
        response_format: { type: "json_object" },
        messages: [{
          role: "user",
          content: [
            "Um lead da rede CUCA recebeu este menu e está respondendo:",
            MENU_UNIDADES,
            "",
            "Unidades válidas (use o nome EXATO): Cuca Barra, Cuca Jangurussu, Cuca Mondubim, Cuca Pici, Cuca José Walter.",
            "",
            "Retorne SOMENTE JSON com as chaves:",
            "- \"unidade\": o nome exato de uma das 5 unidades válidas se o lead mencionou uma (mesmo com erro de digitação ou de forma indireta), ou null se não deu pra identificar.",
            "- \"quer_sair\": true se o lead claramente não quer continuar / não vai escolher uma unidade agora (ex.: agradecimento de despedida, \"deixa pra lá\", \"depois eu vejo\").",
            "- \"mudou_de_assunto\": true se a mensagem não é uma tentativa de escolher unidade nem de sair (ex.: cortesia como \"obrigado pela mensagem\", pergunta sobre outro assunto).",
            "",
            "Mensagem do lead: " + texto,
          ].join("\n"),
        }],
      }),
    });
    if (!resp.ok) return AVALIACAO_SELECAO_UNIDADE_DEFAULT;
    const body = await resp.json();
    const parsed = JSON.parse(body.choices[0].message.content);
    return validarAvaliacaoSelecaoUnidade(parsed);
  } catch (exc) {
    console.error("[motor-agente v18] avaliarSelecaoUnidade erro, fallback seguro:", exc);
    return AVALIACAO_SELECAO_UNIDADE_DEFAULT;
  }
}

export type DecisaoAguardandoUnidade = {
  unidadeSelecionada: string | null;
  aguardandoUnidade: boolean;
  resposta: string | null;
};

/**
 * Decide o que fazer quando a conversa está em `aguardando_unidade=true` e chega uma nova
 * mensagem. `resposta !== null` significa "responda isto e encerre a requisição agora";
 * `resposta === null` significa "unidade resolvida, siga o fluxo normal".
 * Extraído do handler só para permitir teste automatizado (auditoria AUD-01 em
 * docs/qa/AUDITORIA-motor-agente-institucional-2026-07-07.md) — comportamento idêntico ao
 * inline anterior, nenhuma correção aplicada nesta extração.
 */
export function decidirAguardandoUnidade(
  unidadeDetectadaDireta: string | undefined,
  avaliacaoSemantica: AvaliacaoSelecaoUnidade,
): DecisaoAguardandoUnidade {
  const unidadeDetectada = unidadeDetectadaDireta ?? avaliacaoSemantica.unidade ?? undefined;

  if (unidadeDetectada) {
    return { unidadeSelecionada: unidadeDetectada, aguardandoUnidade: false, resposta: null };
  }
  if (avaliacaoSemantica.quer_sair) {
    return {
      unidadeSelecionada: null,
      aguardandoUnidade: true,
      resposta: "Sem problemas! Quando quiser saber sobre alguma unidade CUCA, é só chamar. 😊",
    };
  }
  if (avaliacaoSemantica.mudou_de_assunto) {
    return {
      unidadeSelecionada: null,
      aguardandoUnidade: true,
      resposta: "Claro! 😊 Quando quiser saber sobre alguma unidade CUCA, escolha uma:\n\n" + MENU_UNIDADES,
    };
  }
  return {
    unidadeSelecionada: null,
    aguardandoUnidade: true,
    resposta: "Não consegui identificar a unidade 😊\n\n" + MENU_UNIDADES,
  };
}

/**
 * Extraído do handler para permitir teste automatizado (auditoria AUD-04) — mesma fórmula
 * usada hoje, nenhuma correção aplicada.
 */
export function calcularPrecisaVisaoGeral(params: { conversaJustCreated: boolean; trocouUnidade: boolean; isSelecaoMenu: boolean }): boolean {
  return params.conversaJustCreated || params.trocouUnidade || params.isSelecaoMenu;
}

export type DecisaoPrimeiraMensagem = {
  unidadeSelecionada: string | null;
  aguardandoUnidade: boolean;
  resposta: string;
};

/**
 * Decide o que fazer na 1ª mensagem de uma conversa em unidade_cuca='Geral' (sem
 * aguardando_unidade nem unidade_selecionada em metadata ainda). Extraído para permitir
 * teste automatizado (AUD-07) — comportamento idêntico ao inline anterior: ignora o
 * conteúdo de `textoFinal` e sempre pede o menu, mesmo que o lead já tenha citado uma
 * unidade nessa mesma mensagem. Nenhuma correção aplicada nesta extração.
 */
export function decidirPrimeiraMensagem(_textoFinal: string): DecisaoPrimeiraMensagem {
  return { unidadeSelecionada: null, aguardandoUnidade: true, resposta: MENU_UNIDADES };
}

async function getOpenAIKey(supabase: ReturnType<typeof createClient>): Promise<string> {
  const { data } = await supabase.rpc("get_openai_key");
  return data || Deno.env.get("OPENAI_API_KEY") || "";
}

async function transcreverAudio(audioUrl: string, apiKey: string): Promise<string> {
  const audioResp = await fetch(audioUrl);
  if (!audioResp.ok) throw new Error("Falha ao baixar audio");
  const audioBlob = await audioResp.blob();
  const formData = new FormData();
  formData.append("file", audioBlob, "audio.ogg");
  formData.append("model", WHISPER_MODEL);
  formData.append("language", "pt");
  const resp = await fetch("https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { "Authorization": "Bearer " + apiKey }, body: formData });
  if (!resp.ok) throw new Error("Whisper error: " + await resp.text());
  return (await resp.json()).text;
}

async function gerarEmbedding(texto: string, apiKey: string): Promise<number[]> {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST", headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texto.slice(0, 8000) }),
  });
  if (!resp.ok) throw new Error("Embedding error: " + await resp.text());
  return (await resp.json()).data[0].embedding;
}

const GPT_MAX_TENTATIVAS = 2; // tentativas extras além da 1ª, só para 429/rate_limit_exceeded
const GPT_ESPERA_MAX_SEGUNDOS = 10; // teto de espera por tentativa (worker chama com timeout=60s)

/** Extrai o tempo de espera sugerido pela própria OpenAI (header retry-after ou corpo do erro) */
export function parseRetryAfterSegundos(retryAfterHeader: string | null, corpoErro: string): number {
  if (retryAfterHeader) {
    const segundos = Number(retryAfterHeader);
    if (!Number.isNaN(segundos) && segundos >= 0) return segundos;
  }
  const match = corpoErro.match(/try again in ([\d.]+)s/i);
  if (match) return Number(match[1]);
  return 1; // fallback se a API não informar tempo (ex.: 429 sem detalhe)
}

/**
 * Extraído para permitir teste automatizado (AUD-13) — mesma condição usada hoje
 * (só 429), nenhuma correção aplicada.
 */
export function deveTentarNovamente(status: number, tentativa: number): boolean {
  return status === 429 && tentativa < GPT_MAX_TENTATIVAS;
}

async function chamarGPT(prompt_sistema: string, historico: { role: string; content: string }[], apiKey: string, temperatura: number, max_tokens: number, tentativa = 0): Promise<{ texto: string }> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ model: GPT_MODEL, temperature: temperatura, max_tokens: max_tokens, messages: [{ role: "system", content: prompt_sistema }, ...historico] }),
  });

  if (deveTentarNovamente(resp.status, tentativa)) {
    const corpoErro = await resp.text();
    const esperaSegundos = Math.min(parseRetryAfterSegundos(resp.headers.get("retry-after"), corpoErro), GPT_ESPERA_MAX_SEGUNDOS);
    console.log("[motor-agente v18] Rate limit OpenAI (tentativa " + (tentativa + 1) + "/" + GPT_MAX_TENTATIVAS + "), aguardando " + esperaSegundos + "s antes de tentar de novo");
    await new Promise((resolve) => setTimeout(resolve, esperaSegundos * 1000));
    return chamarGPT(prompt_sistema, historico, apiKey, temperatura, max_tokens, tentativa + 1);
  }

  if (!resp.ok) throw new Error("GPT-4o error: " + await resp.text());
  return { texto: (await resp.json()).choices[0].message.content };
}

async function salvarMensagemAgente(supabase: ReturnType<typeof createClient>, conversa_id: string, lead_id: string, conteudo: string) {
  await supabase.from("mensagens").insert({ conversa_id, lead_id, tipo: "text", conteudo, remetente: "agente" });
}

/** Carrega todos os chunks do monthly_program ativo para uma unidade diretamente (sem embedding) */
async function carregarProgramacaoMensal(supabase: ReturnType<typeof createClient>, unidade: string): Promise<string> {
  const { data: doc } = await supabase.from("documentos_rag").select("id").eq("tipo", "monthly_program").eq("unidade_cuca", unidade).eq("ativo", true).order("created_at", { ascending: false }).limit(1).single();
  if (!doc) return "";
  const { data: chunks } = await supabase.from("chunks_documentos").select("conteudo").eq("documento_id", doc.id).order("chunk_index", { ascending: true }).limit(40);
  if (!chunks || chunks.length === 0) return "";
  console.log("[motor-agente v18] Chunks diretos monthly_program: " + chunks.length + " para " + unidade);
  return chunks.map((c: { conteudo: string }) => c.conteudo).join("\n");
}

// PREMISSA (S-WM-17): esta function espera ser chamada DEPOIS que o lead, a conversa e a
// mensagem do lead já foram persistidos por quem a invoca (hoje, só o worker Meta —
// worker/meta_adapter_inbound.py::_chamar_motor_agente). A busca de lead/conversa abaixo
// (passos 1-2) é mantida como fallback defensivo (encontra o que o worker já criou; só cria
// do zero se chamada de outro jeito), mas esta function NÃO grava mais a mensagem do lead —
// isso é responsabilidade exclusiva de quem chama. Se um novo consumidor precisar chamar esta
// function de forma isolada (sem persistência prévia), ele passa a ser responsável por gravar
// a mensagem do lead antes, ou este contrato precisa ser revisto explicitamente.
// import.meta.main evita que o import deste arquivo por um teste (Deno.test) suba um
// listener HTTP real — Supabase invoca este módulo como entrypoint direto (main=true);
// um teste que importa as funções puras (ehSelecaoMenu etc.) não deve disparar o servidor.
if (import.meta.main) {
  Deno.serve(handler);
}

async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  console.log("[motor-agente v18] Recebendo requisicao...");

  try {
    const body = await req.json();
    const { mensagem, midia_url, midia_tipo, telefone, canal_origem, agente_tipo, unidade_cuca } = body;
    console.log("[motor-agente v18] Agente: " + agente_tipo + ", Unidade: " + unidade_cuca);

    if (!telefone || !agente_tipo) return new Response(JSON.stringify({ error: "telefone e agente_tipo sao obrigatorios" }), { status: 400 });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const openaiKey = await getOpenAIKey(supabase);
    if (!openaiKey) throw new Error("OPENAI_API_KEY nao encontrada");

    let textoFinal = mensagem || "";
    if (midia_url && (midia_tipo === "audio" || midia_tipo === "ptt")) textoFinal = await transcreverAudio(midia_url, openaiKey);
    if (!textoFinal) return new Response(JSON.stringify({ error: "Nenhuma mensagem" }), { status: 400 });

    // 1. Lead
    let { data: lead } = await supabase.from("leads").select("id,nome,opt_in,bloqueado").eq("telefone", telefone).single();
    if (!lead) {
      const { data } = await supabase.from("leads").insert({ telefone, unidade_cuca, origem: "whatsapp", opt_in: true }).select("id,nome,opt_in,bloqueado").single();
      lead = data;
    }
    if (!lead || lead.bloqueado) return new Response(JSON.stringify({ blocked: true }), { status: 200 });

    // 2. Conversa
    let conversaJustCreated = false;
    let { data: conversa } = await supabase.from("conversas").select("id, status, metadata").eq("lead_id", lead.id).eq("origem_id", canal_origem || "test").single();
    if (!conversa) {
      const { data } = await supabase.from("conversas").insert({ lead_id: lead.id, origem_id: canal_origem || "test", agente_tipo, canal_ativo: "meta", status: "ativa" }).select("id, status, metadata").single();
      conversa = data; conversaJustCreated = true;
    } else if (conversa.status === "encerrada") {
      await supabase.from("conversas").update({ status: "ativa", updated_at: new Date().toISOString() }).eq("id", conversa.id);
      conversaJustCreated = true;
    }

    // 3. Mensagem do lead — NÃO gravar aqui (S-WM-17). Quem chama esta function (hoje,
    // sempre worker/meta_adapter_inbound.py::processar_webhook_meta) já persiste lead,
    // conversa e a mensagem do lead antes de invocar este endpoint. Gravar de novo aqui
    // duplicava cada mensagem do lead (worker + function), causando registro e resposta
    // dobrados no canal Institucional/Ouvidoria/Acesso CUCA. O histórico (passo 4 abaixo)
    // já encontra a mensagem, gravada pelo chamador, sem precisar reinseri-la.

    // 4. Histórico
    const { data: hist } = await supabase.from("mensagens").select("conteudo,remetente").eq("conversa_id", conversa.id).order("created_at", { ascending: false }).limit(MAX_HISTORICO);
    const historico = (hist || []).reverse().map((m: { conteudo: string; remetente: string }) => ({ role: m.remetente === "lead" ? "user" : "assistant", content: m.conteudo || "" }));

    // 5. Prompt
    const { data: prompt } = await supabase.from("prompts_agentes").select("prompt_sistema,prompt_contexto,temperatura,max_tokens,menu_boas_vindas").eq("agente_tipo", agente_tipo).eq("ativo", true).single();
    if (!prompt) throw new Error("Prompt nao encontrado para: " + agente_tipo);

    const isSofia = agente_tipo === "sofia" || agente_tipo === "sofia_global" || agente_tipo === "sofia_unidade";
    if (conversaJustCreated && isSofia && prompt.menu_boas_vindas) {
      await salvarMensagemAgente(supabase, conversa.id, lead.id, prompt.menu_boas_vindas);
      return new Response(JSON.stringify({ success: true, agente_usado: agente_tipo, handover: false, resposta: prompt.menu_boas_vindas, menu_boas_vindas: true }), { headers: { "Content-Type": "application/json" } });
    }

    // 5b. Seleção / troca de unidade (instância Geral)
    let unidadeEfetiva = unidade_cuca;
    let trocouUnidade = false;

    if (unidade_cuca === 'Geral') {
      const metadata = conversa?.metadata || {};
      const unidadeSalva = metadata.unidade_selecionada as string | undefined;
      const aguardando = metadata.aguardando_unidade as boolean | undefined;

      if (unidadeSalva) {
        const novaUnidade = detectarTrocaUnidade(textoFinal, unidadeSalva);
        if (novaUnidade) {
          await supabase.from('conversas').update({ metadata: { ...metadata, unidade_selecionada: novaUnidade, aguardando_unidade: false } }).eq('id', conversa.id);
          unidadeEfetiva = novaUnidade;
          trocouUnidade = true;
          console.log("[motor-agente v18] Troca de unidade: " + unidadeSalva + " -> " + novaUnidade);
        } else {
          unidadeEfetiva = unidadeSalva;
        }
      } else if (aguardando) {
        const msgLower = textoFinal.toLowerCase().trim();
        const unidadeDetectadaDireta = Object.entries(UNIDADES_MAP).find(([k]) => contemPalavra(msgLower, k))?.[1];
        let avaliacaoSemantica: AvaliacaoSelecaoUnidade = AVALIACAO_SELECAO_UNIDADE_DEFAULT;

        if (!unidadeDetectadaDireta) {
          avaliacaoSemantica = await avaliarSelecaoUnidade(textoFinal, openaiKey);
        }

        const decisao = decidirAguardandoUnidade(unidadeDetectadaDireta, avaliacaoSemantica);

        if (decisao.unidadeSelecionada) {
          await supabase.from('conversas').update({ metadata: { ...metadata, unidade_selecionada: decisao.unidadeSelecionada, aguardando_unidade: decisao.aguardandoUnidade } }).eq('id', conversa.id);
          unidadeEfetiva = decisao.unidadeSelecionada;
          console.log("[motor-agente v18] Unidade salva: " + unidadeEfetiva);
        } else {
          await salvarMensagemAgente(supabase, conversa.id, lead.id, decisao.resposta!);
          return new Response(JSON.stringify({ success: true, resposta: decisao.resposta, handover: false }), { headers: { "Content-Type": "application/json" } });
        }
      } else {
        const decisaoPrimeira = decidirPrimeiraMensagem(textoFinal);
        await supabase.from('conversas').update({ metadata: { ...(conversa?.metadata || {}), aguardando_unidade: decisaoPrimeira.aguardandoUnidade } }).eq('id', conversa.id);
        await salvarMensagemAgente(supabase, conversa.id, lead.id, decisaoPrimeira.resposta);
        return new Response(JSON.stringify({ success: true, resposta: decisaoPrimeira.resposta, handover: false }), { headers: { "Content-Type": "application/json" } });
      }
    }

    // 6. Contexto RAG
    let contextRAG = "";
    const temUnidadeDefinida = unidadeEfetiva && unidadeEfetiva !== 'Geral';
    const isAgenteProgramacao = agente_tipo === 'Institucional' || agente_tipo === 'maria';
    const isSelecaoMenu = ehSelecaoMenu(textoFinal);

    const precisaVisaoGeral = calcularPrecisaVisaoGeral({ conversaJustCreated, trocouUnidade, isSelecaoMenu });

    if (temUnidadeDefinida && isAgenteProgramacao && precisaVisaoGeral) {
      const conteudoPrograma = await carregarProgramacaoMensal(supabase, unidadeEfetiva);

      let instrucaoArea = "";
      if (trocouUnidade) {
        instrucaoArea = "\nO usu\u00e1rio acabou de trocar para esta unidade. Apresente um resumo geral do que tem na programa\u00e7\u00e3o.";
      } else if (isSelecaoMenu) {
        const ultimaMsgAgente = [...historico].reverse().find(m => m.role === 'assistant');
        const textoOpcao = ultimaMsgAgente ? extrairTextoMenu(textoFinal.trim(), ultimaMsgAgente.content) : '';
        if (textoOpcao) instrucaoArea = "\nO usu\u00e1rio selecionou a \u00e1rea: " + textoOpcao + ". Foque APENAS nessa \u00e1rea.";
      }

      if (conteudoPrograma) {
        contextRAG = "\n\n--- PROGRAMACAO MENSAL ATUAL (" + unidadeEfetiva + ") ---" + instrucaoArea + "\n" + conteudoPrograma;
      }

      // Complementa com eventos pontuais via busca vetorial
      const embedding = await gerarEmbedding(textoFinal, openaiKey);
      const { data: chunksEventos } = await supabase.rpc("buscar_chunks_similares", {
        query_embedding: "[" + embedding.join(",") + "]",
        p_tipos: ["eventos_pontuais", "FAQ"],
        p_unidade_cuca: unidadeEfetiva,
        p_limite: 3,
      });
      if (chunksEventos && chunksEventos.length > 0) {
        contextRAG += "\n\n--- EVENTOS E FAQ ---\n" + chunksEventos.map((c: { conteudo: string; fonte_tipo?: string }) =>
          c.fonte_tipo ? "[" + c.fonte_tipo + "] " + c.conteudo : c.conteudo
        ).join("\n");
      }
    } else if (temUnidadeDefinida && isAgenteProgramacao) {
      // Pergunta de acompanhamento (conversa em andamento, mesma unidade, sem sele\u00e7\u00e3o de menu):
      // busca vetorial de poucos chunks em vez de carregar toda a programa\u00e7\u00e3o mensal (~40 chunks).
      const embedding = await gerarEmbedding(textoFinal, openaiKey);
      const { data: chunksPrograma } = await supabase.rpc("buscar_chunks_similares", {
        query_embedding: "[" + embedding.join(",") + "]",
        p_tipos: ["monthly_program", "eventos_pontuais", "FAQ"],
        p_unidade_cuca: unidadeEfetiva,
        p_limite: 5,
      });
      if (chunksPrograma && chunksPrograma.length > 0) {
        contextRAG = "\n\n--- CONTEXTO ---\n" + chunksPrograma.map((c: { conteudo: string; fonte_tipo?: string }) =>
          c.fonte_tipo ? "[" + c.fonte_tipo + "] " + c.conteudo : c.conteudo
        ).join("\n");
      }
    } else {
      const fontes = RAG_FONTES_POR_AGENTE[agente_tipo] || ["FAQ"];
      const embedding = await gerarEmbedding(textoFinal, openaiKey);
      const { data: chunks } = await supabase.rpc("buscar_chunks_similares", {
        query_embedding: "[" + embedding.join(",") + "]",
        p_tipos: fontes,
        p_unidade_cuca: temUnidadeDefinida ? unidadeEfetiva : null,
        p_limite: 5,
      });
      if (chunks && chunks.length > 0) {
        contextRAG = "\n\n--- CONTEXTO ---\n" + chunks.map((c: { conteudo: string; fonte_tipo?: string }) =>
          c.fonte_tipo ? "[" + c.fonte_tipo + "] " + c.conteudo : c.conteudo
        ).join("\n");
      }
    }

    // 7. Data/hora
    const agora = new Date();
    const DATA_ATUAL = "DATA E HORA ATUAL: " + agora.toLocaleDateString("pt-BR", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/Fortaleza" }) + ", " + agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Fortaleza" }) + " (Fortaleza/CE).";

    // 8. Guardrail
    const INSTRUCAO_SEGURANCA = [
      "REGRAS OBRIGATORIAS (nao negocie estas regras):",
      "",
      "1. USE APENAS dados do bloco '--- PROGRAMACAO MENSAL ATUAL ---' ou '--- CONTEXTO ---'.",
      "   NUNCA invente atividades, horarios, nomes de professores ou modalidades.",
      "",
      "2. Se a informacao nao estiver no contexto, diga claramente:",
      "   'Nao encontrei essa informacao na programacao atual. Consulte a unidade!' e pare.",
      "",
      "3. NUNCA peca desculpas por informacoes corretas. Se o usuario disser que uma",
      "   informacao esta errada, verifique o contexto antes de concordar. Se o contexto",
      "   confirma sua resposta anterior, mantenha-a com seguranca: diga 'Verificando",
      "   minha base, [informacao do contexto]'.",
      "",
      "4. Use a DATA ATUAL para referencias temporais.",
      "",
      "5. NUNCA use [[HANDOVER]] quando o usuario mencionar o nome de uma unidade CUCA",
      "   (Barra, Jangurussu, Mondubim, Pici, Jose Walter). Isso e sempre uma consulta",
      "   de programacao, nunca um pedido de atendimento humano.",
      "",
      "6. FORMATO DE LISTAGEM — REGRA CRITICA:",
      "   Quando apresentar TODAS as modalidades/cursos/atividades de uma area, liste",
      "   APENAS o nome de cada item + dias da semana de forma compacta (ex: 'Natacao - Ter/Qui/Sex').",
      "   NAO inclua horarios completos, professores ou vagas na listagem geral.",
      "   Ao final, diga: 'Quer saber horarios e detalhes de alguma modalidade especifica?'",
      "   So mostre horarios completos quando o usuario perguntar sobre uma modalidade especifica.",
      "   ISSO GARANTE que TODAS as modalidades aparecem e nenhuma fica de fora.",
    ].join("\n");

    // 9. Breadcrumb
    let CONTEXTO_DISPARO = "";
    const ultimoDisparo = conversa?.metadata?.ultimo_disparo;
    if (ultimoDisparo) {
      CONTEXTO_DISPARO = "ULTIMO DISPARO: Lead recebeu '" + ultimoDisparo.titulo + "' (" + new Date(ultimoDisparo.enviado_em).toLocaleDateString("pt-BR") + ")";
    }

    // 10. Prompt final
    const promptFinal = [
      prompt.prompt_sistema, DATA_ATUAL, INSTRUCAO_SEGURANCA,
      prompt.prompt_contexto || "", CONTEXTO_DISPARO, contextRAG,
      "UNIDADE: " + (unidadeEfetiva || "Nao informada"),
      trocouUnidade ? "INSTRUCAO: O cidadao acabou de trocar para esta unidade. Inicie com uma mensagem de transicao amigavel (ex: 'Claro! Vou te mostrar o que tem no [unidade] 😊') e apresente um resumo geral da programacao usando formato compacto." : "",
      conversaJustCreated ? "INSTRUCAO: Esta e a primeira mensagem. Combine saudacao e menu em uma unica resposta." : "",
    ].filter(Boolean).join("\n\n");

    // 11. GPT
    const { texto: respostaGerada } = await chamarGPT(promptFinal, historico, openaiKey, prompt.temperatura, prompt.max_tokens);
    let resposta = respostaGerada;
    let handover = false; let encerrado = false;
    const avaliacaoHandover = removerTag(resposta, "handover");
    if (avaliacaoHandover.encontrada) { handover = true; resposta = avaliacaoHandover.texto; }
    const avaliacaoEncerrar = removerTag(resposta, "encerrar");
    if (avaliacaoEncerrar.encontrada) { encerrado = true; resposta = avaliacaoEncerrar.texto; }
    // GPT pode responder só com a tag, sem texto (ex.: "[[ENCERRAR]]"). resposta="" nesse ponto
    // vira None no worker (data.get("resposta") or None), que hoje interpreta None como falha
    // técnica e reenvia "tivemos um problema técnico" — mensagem errada para um encerramento/
    // handover legítimo. Garantir texto sempre não-vazio quando success=true.
    if (!resposta) {
      if (handover) resposta = "Vou te encaminhar para um atendente humano, só um momento!";
      else if (encerrado) resposta = "Tudo certo! Qualquer coisa, é só chamar novamente. 😊";
    }

    // 12. Salvar
    await salvarMensagemAgente(supabase, conversa.id, lead.id, resposta);
    if (handover) await supabase.from("conversas").update({ status: "awaiting_human", updated_at: new Date().toISOString() }).eq("id", conversa.id);
    else if (encerrado) await supabase.from("conversas").update({ status: "encerrada", updated_at: new Date().toISOString() }).eq("id", conversa.id);

    return new Response(JSON.stringify({ success: true, agente_usado: agente_tipo, handover, encerrado, resposta }), { headers: { "Content-Type": "application/json" } });

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[motor-agente v18]", errMsg);
    return new Response(JSON.stringify({ error: "Erro interno", details: errMsg }), { status: 500 });
  }
}
