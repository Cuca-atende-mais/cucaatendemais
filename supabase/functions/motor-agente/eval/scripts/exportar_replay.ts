// S-INST-QUAL-06 — exporta, SÓ LEITURA, os turnos do Institucional registrados em
// `rag_retrieval_logs` (mensagem do cidadão + camada que a rota antiga escolheu) e o histórico
// dessas conversas (`mensagens` + `mensagens_arquivo`, da S-INST-QUAL-11), para o replay offline da
// rota estruturada (`replay_rota.ts`). Sem OpenAI, sem custo. A saída fica em `eval/dados/`, que está
// fora do git (tem mensagens reais).
//
// Uso:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... deno run --allow-net --allow-env --allow-read --allow-write \
//     eval/scripts/exportar_replay.ts --dias 7

import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_BASE = Deno.env.get("SUPABASE_URL");
const CHAVE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!URL_BASE || !CHAVE) {
  console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  Deno.exit(1);
}
const i = Deno.args.indexOf("--dias");
const DIAS = i >= 0 ? Number(Deno.args[i + 1]) : 7;
const desde = new Date(Date.now() - DIAS * 86400000).toISOString();
const banco = createClient(URL_BASE, CHAVE, { auth: { persistSession: false } });

type Turno = { id: string; created_at: string; conversa_id: string | null; unidade_cuca: string | null; camada: string; mensagem_lead: string | null };
type Mensagem = { id: string; conversa_id: string; remetente: string; conteudo: string | null; created_at: string };

async function paginar<T>(consulta: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const todos: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw new Error(error.message);
    todos.push(...(data ?? []));
    if (!data || data.length < 1000) return todos;
  }
}

const turnos = await paginar<Turno>((de, ate) =>
  banco.from("rag_retrieval_logs").select("id,created_at,conversa_id,unidade_cuca,camada,mensagem_lead")
    .eq("agente_tipo", "Institucional").gte("created_at", desde).not("mensagem_lead", "is", null).not("conversa_id", "is", null)
    .order("created_at", { ascending: true }).range(de, ate)
);
const conversas = [...new Set(turnos.map((t) => t.conversa_id as string))];
// A janela de histórico vai até 12h antes do primeiro turno (o motor só usa a sessão, corte de 2h).
const desdeHistorico = new Date(Date.parse(desde) - 12 * 3600000).toISOString();
const mensagens = new Map<string, Mensagem>();
for (let k = 0; k < conversas.length; k += 100) {
  const lote = conversas.slice(k, k + 100);
  for (const tabela of ["mensagens", "mensagens_arquivo"]) {
    const linhas = await paginar<Mensagem>((de, ate) =>
      banco.from(tabela).select("id,conversa_id,remetente,conteudo,created_at").in("conversa_id", lote).gte("created_at", desdeHistorico)
        .order("created_at", { ascending: true }).range(de, ate)
    );
    for (const m of linhas) if (!mensagens.has(m.id)) mensagens.set(m.id, m);
  }
}
const saida = new URL(`../dados/replay-${DIAS}d.json`, import.meta.url);
await Deno.writeTextFile(saida, JSON.stringify({ exportado_em: new Date().toISOString(), desde, turnos, mensagens: [...mensagens.values()] }));
console.log(`turnos: ${turnos.length} · conversas: ${conversas.length} · mensagens: ${mensagens.size} -> ${saida.pathname}`);
