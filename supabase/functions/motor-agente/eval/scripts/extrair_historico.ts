// S-INST-QUAL-04 — preenche o histórico real dos casos que vieram de conversas (item 4).
//
// Para cada caso com `conversa_curta` e `extrair.alvo`, lê a conversa no arquivo permanente
// (`mensagens_arquivo`, S-INST-QUAL-11), acha a mensagem do cidadão que contém o `alvo` (e, se
// houver, do dia `extrair.dia`) e grava no caso:
//   - `mensagem`: o texto real dessa mensagem;
//   - `historico`: até 12 mensagens anteriores, com `minutos_antes` em relação a ela;
//   - `data_simulada`: o horário real dela.
// SÓ LEITURA no banco. Sem dado pessoal no resultado: o nome do cidadão vira "Fulano", e telefone,
// e-mail e CPF viram marcadores. Os casos guardam só o id curto da conversa (8 caracteres).
//
// Uso: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... deno run --allow-net --allow-env --allow-read --allow-write \
//        eval/scripts/extrair_historico.ts

import { dadosPessoaisEm, normalizar } from "../lib/avaliar.ts";

const URL_BASE = Deno.env.get("SUPABASE_URL");
const CHAVE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
if (!URL_BASE || !CHAVE) {
  console.error("Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.");
  Deno.exit(1);
}
const MAX_HISTORICO = 12;
const PASTA = new URL("../casos/", import.meta.url);

async function ler(tabela: string, consulta: string): Promise<Record<string, unknown>[]> {
  const resp = await fetch(`${URL_BASE}/rest/v1/${tabela}?${consulta}`, { headers: { apikey: CHAVE!, Authorization: `Bearer ${CHAVE}` } });
  if (!resp.ok) throw new Error(`${tabela}: HTTP ${resp.status} ${await resp.text()}`);
  return await resp.json();
}

/** Troca o nome do cidadão e qualquer dado pessoal por marcadores. */
export function limpar(texto: string, nome: string | null): string {
  let t = texto;
  for (const parte of (nome ?? "").split(/\s+/).filter((p) => p.length >= 3)) {
    t = t.replace(new RegExp(`\\b${parte.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), "Fulano");
  }
  for (const achado of dadosPessoaisEm(t)) t = t.split(achado).join(/@/.test(achado) ? "[email]" : "[telefone]");
  return t;
}

let alterados = 0;
for await (const e of Deno.readDir(PASTA)) {
  if (!e.isFile || !e.name.endsWith(".json")) continue;
  const arquivo = new URL(e.name, PASTA);
  const caso = JSON.parse(await Deno.readTextFile(arquivo));
  if (!caso.conversa_curta || !caso.extrair?.alvo) continue;
  const curta = String(caso.conversa_curta).toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(curta)) throw new Error(`${caso.id}: conversa_curta inválida`);
  // uuid não aceita "like": o intervalo [curta-0000..., curta-ffff...] pega a conversa pelo prefixo.
  const de = `${curta}-0000-0000-0000-000000000000`;
  const ate = `${curta}-ffff-ffff-ffff-ffffffffffff`;
  const msgs = await ler("mensagens_arquivo", `select=conversa_id,lead_id,remetente,conteudo,created_at&conversa_id=gte.${de}&conversa_id=lte.${ate}&order=created_at.asc&limit=2000`);
  const conversas = new Set(msgs.map((m) => m.conversa_id));
  if (conversas.size !== 1) {
    console.warn(`${caso.id}: ${conversas.size} conversas com o prefixo ${curta} — mantido o histórico do esqueleto`);
    continue;
  }
  const alvo = normalizar(caso.extrair.alvo);
  const i = msgs.findIndex((m) => m.remetente === "lead" && normalizar(String(m.conteudo ?? "")).includes(alvo) && (!caso.extrair.dia || String(m.created_at).startsWith(caso.extrair.dia)));
  if (i < 0) {
    console.warn(`${caso.id}: mensagem "${caso.extrair.alvo}" não encontrada — mantido o histórico do esqueleto`);
    continue;
  }
  const leadId = msgs[i].lead_id as string | null;
  const nome = leadId ? ((await ler("leads", `select=nome&id=eq.${leadId}`))[0]?.nome as string | null ?? null) : null;
  const t0 = Date.parse(String(msgs[i].created_at));
  caso.mensagem = limpar(String(msgs[i].conteudo ?? ""), nome);
  caso.data_simulada = new Date(t0).toISOString();
  caso.historico = msgs.slice(Math.max(0, i - MAX_HISTORICO), i).map((m) => ({
    remetente: m.remetente === "lead" ? "lead" : "agente",
    conteudo: limpar(String(m.conteudo ?? ""), nome),
    minutos_antes: Number(((t0 - Date.parse(String(m.created_at))) / 60000).toFixed(2)),
  }));
  caso.extrair = { ...caso.extrair, extraido_em: new Date().toISOString().slice(0, 10) };
  await Deno.writeTextFile(arquivo, JSON.stringify(caso, null, 1) + "\n");
  alterados++;
  console.log(`${caso.id}: ${caso.historico.length} mensagens anteriores`);
}
console.log(`${alterados} casos atualizados`);
