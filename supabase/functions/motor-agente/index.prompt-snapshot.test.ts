// Rede de segurança do registro de consumo (PLANO-023): prova que o texto enviado à OpenAI
// continua IDÊNTICO, byte a byte, depois que a montagem do contexto passou a ser feita por uma
// lista de blocos nomeados. Cada cenário força um caminho diferente da montagem (programação
// completa, atividade específica, eventos/FAQ, busca vetorial, resumo da rede, agente sem
// programação, com e sem marca de disparo) e compara o corpo de TODAS as chamadas de chat com
// a fotografia gravada em `__snapshots__/prompt-snapshot.json`, tirada antes da refatoração.
//
// Para regravar a fotografia (só quando a mudança no prompt for intencional):
//   ATUALIZAR_SNAPSHOT=1 deno test --allow-all --no-check index.prompt-snapshot.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./index.ts";

const ARQUIVO = new URL("./__snapshots__/prompt-snapshot.json", import.meta.url);
const AGORA_FIXO = Date.UTC(2026, 8, 28, 15, 0, 0); // 28/09/2026 12:00 em Fortaleza

type Resposta = { data: unknown; error?: { message: string } | null };

// deno-lint-ignore no-explicit-any
function supabaseMock(respostas: Record<string, Resposta>): any {
  function chain(tabela: string) {
    // deno-lint-ignore no-explicit-any
    const c: any = {};
    for (const m of ["select", "eq", "in", "neq", "gte", "lte", "order", "limit", "single", "maybeSingle", "insert", "update", "upsert", "delete"]) {
      c[m] = () => c;
    }
    c.then = (resolve: (v: unknown) => unknown) => resolve({ data: respostas[tabela]?.data ?? null, error: respostas[tabela]?.error ?? null });
    return c;
  }
  return {
    from: (t: string) => chain(t),
    rpc: (nome: string) => ({ then: (resolve: (v: unknown) => unknown) => resolve({ data: respostas["rpc:" + nome]?.data ?? null, error: null }) }),
  };
}

type Cenario = {
  nome: string;
  mensagem: string;
  agente_tipo?: string;
  metadata?: Record<string, unknown>;
  historico?: { conteudo: string; remetente: string }[];
  chunksBusca?: unknown[];
  semProgramacao?: boolean;
  avaliacao?: Record<string, unknown>;
};

const CHUNK_FAQ = [{ conteudo: "FAQ: o Cuca abre as 8h.", fonte_tipo: "FAQ", similaridade: 0.91, documento_id: "faq-1" }];
const CHUNK_EVENTO = [{ conteudo: "Evento: festival de dança sábado.", fonte_tipo: "eventos_pontuais", similaridade: 0.88, documento_id: "ev-1" }];

const GERAL = { unidade: null, quer_sair: false, mudou_de_assunto: true, pergunta_geral: true, pedido_depende_unidade: false };

const CENARIOS: Cenario[] = [
  { nome: "conversa nova, sem unidade", mensagem: "oi, quais cursos tem?" },
  { nome: "escolhe unidade pelo nome", mensagem: "Mondubim", metadata: { aguardando_unidade: true } },
  { nome: "conversa engajada, pergunta especifica", mensagem: "tem natação de manhã?", metadata: { unidade_selecionada: "Cuca Barra", conversa_engajada: true }, chunksBusca: CHUNK_EVENTO },
  { nome: "conversa engajada, busca vazia", mensagem: "e xadrez?", metadata: { unidade_selecionada: "Cuca Barra", conversa_engajada: true }, chunksBusca: [] },
  { nome: "troca de unidade com pedido", mensagem: "e no Pici, tem judô à noite?", metadata: { unidade_selecionada: "Cuca Barra", conversa_engajada: true }, chunksBusca: CHUNK_EVENTO },
  { nome: "troca de unidade sem pedido", mensagem: "Pici", metadata: { unidade_selecionada: "Cuca Barra", conversa_engajada: true } },
  { nome: "selecao de menu", mensagem: "2", metadata: { unidade_selecionada: "Cuca Barra", conversa_engajada: true, menu_categoria_ativo: true }, historico: [{ conteudo: "Escolha uma área:\n1. Cursos\n2. Esportes\n3. Dia a Dia", remetente: "agente" }] },
  { nome: "pergunta geral da rede", mensagem: "a rede cuca é da prefeitura?", metadata: { aguardando_unidade: true }, chunksBusca: CHUNK_FAQ, avaliacao: GERAL },
  { nome: "pergunta geral sem faq", mensagem: "quantas unidades existem?", metadata: { aguardando_unidade: true }, chunksBusca: [], avaliacao: GERAL },
  { nome: "pergunta geral, conversa engajada", mensagem: "tem curso pago?", metadata: { conversa_engajada: true }, chunksBusca: CHUNK_FAQ, avaliacao: GERAL },
  { nome: "atividade estruturada (judo)", mensagem: "qual horário do judô?", metadata: { unidade_selecionada: "Cuca Barra", conversa_engajada: true }, chunksBusca: CHUNK_FAQ },
  { nome: "com marca de disparo", mensagem: "qual o horário?", metadata: { unidade_selecionada: "Cuca Barra", conversa_engajada: true, ultimo_disparo: { titulo: "Simulado", enviado_em: "2026-09-17T14:00:00-03:00" } }, chunksBusca: CHUNK_FAQ },
  { nome: "mes sem programacao", mensagem: "o que tem hoje?", metadata: { unidade_selecionada: "Cuca Barra", conversa_engajada: true }, chunksBusca: [], semProgramacao: true },
  { nome: "agente sem programacao (sofia)", mensagem: "quero fazer uma reclamação", agente_tipo: "sofia", chunksBusca: CHUNK_FAQ },
  { nome: "agente sem programacao, engajado", mensagem: "o banheiro estava sujo", agente_tipo: "sofia", metadata: { conversa_engajada: true }, chunksBusca: CHUNK_FAQ },
];

async function rodar(c: Cenario, agora = AGORA_FIXO): Promise<{ chat: unknown[]; camadas: unknown[] }> {
  const chat: unknown[] = [];
  const fetchOriginal = globalThis.fetch;
  const DateOriginal = globalThis.Date;
  class DataFixa extends DateOriginal {
    // deno-lint-ignore no-explicit-any
    constructor(...args: any[]) {
      // deno-lint-ignore no-explicit-any
      if (args.length === 0) super(agora); else super(...(args as [any]));
    }
    static override now() { return agora; }
  }
  globalThis.Date = DataFixa as DateConstructor;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const u = String(url instanceof Request ? url.url : url);
    if (u.includes("/v1/embeddings")) return Promise.resolve(new Response(JSON.stringify({ data: [{ embedding: [0, 0, 0] }] }), { status: 200 }));
    if (u.includes("/v1/chat/completions")) {
      const corpo = JSON.parse(String(init?.body ?? "{}"));
      chat.push(corpo);
      const ehAvaliacao = corpo?.temperature === 0;
      const conteudo = ehAvaliacao ? JSON.stringify(c.avaliacao ?? { unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false }) : "Resposta de teste";
      return Promise.resolve(new Response(JSON.stringify({ id: "chatcmpl-x", choices: [{ message: { content: conteudo } }], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } }), { status: 200 }));
    }
    return Promise.resolve(new Response("{}", { status: 200 }));
  }) as typeof fetch;

  const camadas: unknown[] = [];
  const sb = supabaseMock({
    "rpc:get_openai_key": { data: "fake" },
    "leads": { data: { id: "lead-1", nome: "Fulano", opt_in: true, bloqueado: false } },
    "conversas": { data: { id: "conv-1", status: "ativa", metadata: c.metadata ?? {}, lead_id: "lead-1", primeira_interacao_lead_em: "2026-09-01T00:00:00Z" } },
    "mensagens": { data: (c.historico ?? []).map((m, i) => ({ ...m, created_at: new DateOriginal(agora - 60000 * (i + 1)).toISOString() })) },
    "prompts_agentes": { data: { prompt_sistema: "SISTEMA DO AGENTE", prompt_contexto: "CONTEXTO DO AGENTE", temperatura: 0.7, max_tokens: 500, menu_boas_vindas: null, updated_at: "2026-09-08T13:52:12Z" } },
    "documentos_rag": { data: c.semProgramacao ? null : { id: "doc-1", conteudo: "TEXTO DO DOCUMENTO", metadados: { vigencia_mes: 9, vigencia_ano: 2026, campanha_id: "camp-1" } } },
    "atividades_mensais": { data: [{ titulo: "Judô Infantil", categoria: "ESPORTES", metadata: { horario: "ter e qui 18h", faixa_etaria: "7 a 14" } }] },
    "chunks_documentos": { data: c.semProgramacao ? [] : [{ conteudo: "PROGRAMAÇÃO MENSAL (9/2026) - Cuca Barra\nTítulo: Programação Mensal - 9/2026\n• Natação Infantil\n  Detalhes: seg e qua 8h" }] },
    "rpc:buscar_chunks_similares": { data: c.chunksBusca ?? [] },
    "system_config": { data: null },
  });
  const origInsert = sb.from;
  sb.from = (t: string) => {
    const ch = origInsert(t);
    if (t === "rag_retrieval_logs") ch.insert = (p: { camada?: unknown }) => { camadas.push(p?.camada); return ch; };
    return ch;
  };
  try {
    await handler(new Request("http://localhost/motor-agente", {
      method: "POST",
      body: JSON.stringify({ mensagem: c.mensagem, telefone: "5585999999999", canal_origem: "test", agente_tipo: c.agente_tipo ?? "Institucional", unidade_cuca: "Geral", conversa_id: "conv-1" }),
    }), sb);
    await new Promise((r) => setTimeout(r, 20)); // deixa os registros em segundo plano terminarem
  } finally {
    globalThis.fetch = fetchOriginal;
    globalThis.Date = DateOriginal;
  }
  return { chat, camadas };
}

Deno.test("prompt enviado à OpenAI continua idêntico em todos os caminhos de montagem", async () => {
  const atual: Record<string, unknown> = {};
  for (const c of CENARIOS) atual[c.nome] = await rodar(c);
  if (Deno.env.get("ATUALIZAR_SNAPSHOT") === "1") {
    await Deno.mkdir(new URL("./__snapshots__/", import.meta.url), { recursive: true });
    await Deno.writeTextFile(ARQUIVO, JSON.stringify(atual, null, 1) + "\n");
    return;
  }
  const gravado = JSON.parse(await Deno.readTextFile(ARQUIVO));
  for (const c of CENARIOS) assertEquals(atual[c.nome], gravado[c.nome], "cenário mudou: " + c.nome);
});

// PLANO-025: o cache da OpenAI só reaproveita o prefixo idêntico entre chamadas. Duas mensagens da
// mesma conversa em horários diferentes (data/hora diferentes no prompt) precisam compartilhar o
// começo do prompt até o fim do bloco de serviços da rede — antes, a data na 2ª posição quebrava
// o prefixo logo depois do prompt de sistema.
Deno.test("PLANO-025: prompt de horários diferentes compartilha o prefixo até o fim dos serviços", async () => {
  const cenario = CENARIOS.find((c) => c.nome === "conversa engajada, pergunta especifica")!;
  const sistema = (r: { chat: unknown[] }) =>
    String((r.chat[r.chat.length - 1] as { messages: { content: string }[] }).messages[0].content);
  const a = sistema(await rodar(cenario, AGORA_FIXO));
  const b = sistema(await rodar(cenario, AGORA_FIXO + 3 * 60 * 60 * 1000 + 17 * 60 * 1000));
  let comum = 0;
  while (comum < a.length && a[comum] === b[comum]) comum++;
  const fimServicos = a.indexOf("TEXTO DO DOCUMENTO", a.indexOf("--- SERVICOS DA REDE")) + "TEXTO DO DOCUMENTO".length;
  assertEquals(a === b, false, "a data precisa aparecer no prompt (senão o teste não prova nada)");
  assertEquals(comum >= fimServicos, true, `prefixo comum (${comum}) termina antes do fim dos serviços (${fimServicos})`);
  assertEquals(a.indexOf("DATA E HORA ATUAL") > fimServicos, true, "a data deve vir depois dos serviços");
});
