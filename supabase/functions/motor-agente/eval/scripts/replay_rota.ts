// S-INST-QUAL-06 — replay offline da rota estruturada sobre turnos reais do Institucional.
//
// Para cada turno exportado por `exportar_replay.ts`, remonta o que o motor via naquele momento
// (histórico da sessão, rajada), roda SÓ a leitura do turno (`lerTurnoInstitucional`) e o
// `decidirRota`, e compara a família da decisão nova com a camada que a rota antiga registrou.
// Não chama o modelo de resposta nem o banco. O estado da conversa não é guardado no histórico; ele
// é aproximado pela unidade do turno anterior da mesma conversa (ver `estadoAproximado`).
//
// Uso:
//   deno run --allow-read --allow-write --allow-env eval/scripts/replay_rota.ts --arquivo replay-7d.json --simulado
//   OPENAI_API_KEY=... deno run --allow-all eval/scripts/replay_rota.ts --arquivo replay-7d.json --teto-usd 0.5
// Opções: --limite N (N turnos elegíveis espalhados pelo período inteiro) · --amostra N (divergências na amostra, padrão 50)
//   · --reler <resultado.json> (reaproveita as leituras de uma rodada anterior em eval/resultados/ e só
//     refaz a consolidação e o decidirRota: sem OpenAI, sem custo — confere correções de código)
// Saída: eval/resultados/AAAA-MM-DD-replay-rota.md e .json (fora do git: têm mensagens reais).

import {
  anterioresDaRajada,
  atividadeNovaNaConversa,
  completarSoUnidadeComPedidoAnterior,
  consolidarLeitura,
  conversaEmContextoDeProgramacao,
  decidirRota,
  ehSelecaoMenu,
  ESCOLHA_REDE,
  type EstadoRota,
  extrairItensProgramacao,
  historicoAntesDaRajada,
  type ItemProgramacao,
  type LeituraTurno,
  lerTurnoInstitucional,
  mensagemPedeDetalhe,
  normalizarDigitosEmoji,
  opcoesDeAtividade,
  pedidoAnteriorDoLead,
  recortarSessao,
  ROTULO_REDE,
  textoUltimoBlocoAgente,
  ultimaRespostaFoiFrasePronta,
} from "../../index.ts";

function argumento(nome: string): string | undefined {
  const i = Deno.args.indexOf("--" + nome);
  return i >= 0 ? Deno.args[i + 1] : undefined;
}
const ARQUIVO = argumento("arquivo") ?? "replay-7d.json";
const SIMULADO = Deno.args.includes("--simulado");
const TETO_USD = argumento("teto-usd") ? Number(argumento("teto-usd")) : null;
const LIMITE = argumento("limite") ? Number(argumento("limite")) : null;
const AMOSTRA = Number(argumento("amostra") ?? 50);
const RELER = argumento("reler");
const CHAVE = SIMULADO || RELER ? "sem-chamada" : Deno.env.get("OPENAI_API_KEY") ?? "";
if (!CHAVE) {
  console.error("Sem OPENAI_API_KEY. Para rodar sem custo, use --simulado.");
  Deno.exit(1);
}

const BASE = new URL("../", import.meta.url);
const leiturasSalvas: Map<string, LeituraTurno> | null = RELER
  ? new Map((JSON.parse(await Deno.readTextFile(new URL("resultados/" + RELER, BASE))).linhas as { turno: { id: string }; leitura: LeituraTurno | null }[])
    .filter((x) => x.leitura).map((x) => [x.turno.id, x.leitura as LeituraTurno]))
  : null;
type Turno = { id: string; created_at: string; conversa_id: string; unidade_cuca: string | null; camada: string; mensagem_lead: string };
type Mensagem = { id: string; conversa_id: string; remetente: string; conteudo: string | null; created_at: string };
const dados: { turnos: Turno[]; mensagens: Mensagem[] } = JSON.parse(await Deno.readTextFile(new URL("dados/" + ARQUIVO, BASE)));
const catalogo = JSON.parse(await Deno.readTextFile(new URL("dados/catalogo.json", BASE)));
const mesMaisNovo = Object.keys(catalogo.meses).sort().at(-1)!;
const itensDoMes = (mes: string): ItemProgramacao[] => (catalogo.meses[mes] ?? catalogo.meses[mesMaisNovo]).documentos
  .filter((d: { tipo: string }) => d.tipo === "monthly_program")
  .flatMap((d: { unidade_cuca: string; conteudo: string }) => extrairItensProgramacao(d.unidade_cuca, d.conteudo ?? ""));

const porConversa = new Map<string, Mensagem[]>();
for (const m of dados.mensagens) porConversa.set(m.conversa_id, [...(porConversa.get(m.conversa_id) ?? []), m]);
for (const lista of porConversa.values()) lista.sort((a, b) => a.created_at.localeCompare(b.created_at));
const turnosPorConversa = new Map<string, Turno[]>();
for (const t of dados.turnos) turnosPorConversa.set(t.conversa_id, [...(turnosPorConversa.get(t.conversa_id) ?? []), t]);

// ── famílias de decisão (rota antiga × nova) ─────────────────────────────────────────────────
const UNIDADES = new Set(["Cuca Barra", "Cuca Jangurussu", "Cuca Mondubim", "Cuca Pici", "Cuca José Walter"]);
function familiaAntiga(t: Turno): string {
  switch (t.camada) {
    case "resposta_canned": return "pronta";
    case "encerramento": return "despedida";
    case "ambiguidade_unidade": return "menu";
    case "pergunta_escopo": case "pergunta_area": return "pergunta";
    case "vagas_ambiguo": return "perguntar_vaga";
    case "programacao_contexto": case "programacao_rede": return "programacao";
    default: return t.unidade_cuca && UNIDADES.has(t.unidade_cuca) ? "unidade" : "geral";
  }
}
function familiaNova(acao: string): string {
  switch (acao) {
    case "saudacao": case "cortesia": return "pronta";
    case "despedida": return "despedida";
    case "menu_unidades": return "menu";
    case "perguntar_escopo": case "perguntar_area": case "confirmar_escopo": case "perguntar_atividade": return "pergunta";
    case "perguntar_vaga": return "perguntar_vaga";
    case "programacao": return "programacao";
    case "unidade": return "unidade";
    case "handover": return "handover";
    case "encaminhar": return "encaminhar";
    default: return "geral";
  }
}

/** Divergência que a própria tabela da story prevê (linha da tabela) — o resto vai para revisão. */
function divergenciaEsperada(antiga: string, nova: string, acao: string): string | null {
  if (nova === "encaminhar") return "linha 4 (outro canal sem passar pelo modelo de resposta)";
  if (nova === "menu") return "linha 1 (várias unidades)";
  if (nova === "despedida") return "linha 2 (despedida encerra)";
  if (antiga === "unidade" && nova === "pronta") return "linha 2 (cortesia com unidade salva vira frase pronta)";
  if (antiga === "unidade" && nova === "programacao") return "linha 8 (continuação de programação pela consulta com contexto)";
  if ((antiga === "geral" || antiga === "pergunta") && nova === "programacao" && acao.endsWith(":rede")) return "linha 9 (rede filtrada pela atividade, sem perguntar a unidade)";
  if (acao.startsWith("confirmar_escopo")) return "linha 7 (conversa retomada: confirmar o escopo)";
  if (acao.startsWith("perguntar_atividade")) return "linha 12 (atividade ambígua)";
  return null;
}

// ── remontagem do turno ──────────────────────────────────────────────────────────────────────
type Remontado = { texto: string; historico: { role: string; content: string }[]; historicoRota: { role: string; content: string }[]; mensagensRajada: string[]; sessaoNova: boolean; ultimoBloco: string };
function remontar(t: Turno): Remontado | null {
  const lista = porConversa.get(t.conversa_id) ?? [];
  // A mensagem do turno é a última do lead com o mesmo texto até o registro (o worker grava antes).
  let fim = -1;
  for (let k = lista.length - 1; k >= 0; k--) {
    if (lista[k].created_at <= t.created_at && lista[k].remetente === "lead" && (lista[k].conteudo ?? "") === t.mensagem_lead) { fim = k; break; }
  }
  if (fim < 0) return null;
  const ate = lista.slice(0, fim + 1).slice(-10);
  const recorte = recortarSessao(ate);
  const historico = recorte.mensagens.map((m) => ({ role: m.remetente === "lead" ? "user" : "assistant", content: m.conteudo ?? "" }));
  const comData = recorte.mensagens.map((m) => ({ role: m.remetente === "lead" ? "user" : "assistant", content: m.conteudo ?? "", created_at: m.created_at }));
  const texto = normalizarDigitosEmoji(t.mensagem_lead);
  const anteriores = anterioresDaRajada(comData, texto, t.mensagem_lead);
  const mensagensRajada = [...anteriores, texto.trim()];
  return {
    texto: anteriores.length ? mensagensRajada.join("\n") : texto,
    historico,
    historicoRota: anteriores.length ? historicoAntesDaRajada(historico) : historico,
    mensagensRajada,
    sessaoNova: recorte.sessaoNova,
    ultimoBloco: textoUltimoBlocoAgente(historico),
  };
}

/** Estado aproximado: a unidade salva é a do turno anterior da mesma conversa (o motor registra a
 * unidade efetiva de cada turno); em sessão nova, ela vira a "unidade de antes". */
function estadoAproximado(t: Turno, r: Remontado, l: LeituraTurno, itens: ItemProgramacao[], textoDoPedido: string): EstadoRota {
  const anteriores = (turnosPorConversa.get(t.conversa_id) ?? []).filter((x) => x.created_at < t.created_at);
  const ultimo = anteriores.at(-1);
  const unidadeUltimo = ultimo?.unidade_cuca && UNIDADES.has(ultimo.unidade_cuca) ? ultimo.unidade_cuca : null;
  return {
    unidadeSalva: r.sessaoNova ? null : unidadeUltimo,
    unidadeAnterior: unidadeUltimo,
    escopoRedeSalvo: !r.sessaoNova && ultimo?.unidade_cuca === ROTULO_REDE,
    sessaoReaberta: r.sessaoNova,
    primeiraRespostaDaSessao: !r.historico.some((m) => m.role === "assistant"),
    ultimaRespostaFoiPronta: ultimaRespostaFoiFrasePronta(r.historico),
    disparoRecente: false,
    // metadata aproximado pela unidade do turno anterior (o motor não registra o metadata do turno)
    contextoDeProgramacao: conversaEmContextoDeProgramacao(r.sessaoNova || !unidadeUltimo ? {} : { unidade_selecionada: unidadeUltimo }, r.ultimoBloco),
    pedeDetalhe: mensagemPedeDetalhe(textoDoPedido),
    atividadeNovaNaConversa: atividadeNovaNaConversa(l, r.historicoRota),
    opcoesAtividade: (escopo: string) => opcoesDeAtividade(itens, l, escopo),
  };
}

/** Turnos que a rota estruturada não lê: decididos antes da leitura (transbordo fixo, Emprega+) ou
 * resolvidos pelo código (número respondendo a uma lista, resposta à pergunta de escopo/área). */
function foraDaLeitura(t: Turno, r: Remontado): string | null {
  if (t.camada === "handover") return "transbordo_fixo";
  if (t.camada === "emprega_mais") return "emprega_mais";
  if (/^\d{1,2}$/.test(r.texto.trim()) && /(^|\n)\s*\**\d/.test(r.ultimoBloco)) return "digito_da_lista";
  if (ehSelecaoMenu(r.texto) && r.ultimoBloco.includes(ROTULO_REDE)) return "digito_da_lista";
  return null;
}

// ── OpenAI simulada (só encanamento) ──────────────────────────────────────────────────────────
const fetchOriginal = globalThis.fetch;
if (SIMULADO) {
  globalThis.fetch = ((_u: string | URL | Request, init?: RequestInit) => {
    const corpo = JSON.parse(String(init?.body ?? "{}"));
    const texto = String(corpo.messages?.[0]?.content ?? "");
    const msg = texto.slice(texto.lastIndexOf("sequência): ") + 12);
    const leitura = /^(oi|ola|bom dia|boa tarde|boa noite)\b/i.test(msg) ? { tipo: "saudacao" } : /obrigad|valeu|^ok/i.test(msg) ? { tipo: "cortesia" } : { tipo: "pedido_novo", assunto: "institucional", escopo: "nao_disse" };
    return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(leitura) } }], usage: { prompt_tokens: 1400, completion_tokens: 60 } }), { status: 200 }));
  }) as typeof fetch;
}

// ── execução ─────────────────────────────────────────────────────────────────────────────────
type Linha = { turno: Turno; familiaAntiga: string; familiaNova: string | null; acao: string | null; leitura: LeituraTurno | null; latencia_ms: number; fora?: string; texto?: string; ultimoBloco?: string };
const linhas: Linha[] = [];
let custo = 0;
let parouNoTeto = false;
const elegiveis: { t: Turno; r: Remontado }[] = [];
let semHistorico = 0;
for (const t of dados.turnos) {
  const r = remontar(t);
  if (!r) { semHistorico++; continue; }
  const fora = foraDaLeitura(t, r);
  if (fora) { linhas.push({ turno: t, familiaAntiga: familiaAntiga(t), familiaNova: null, acao: null, leitura: null, latencia_ms: 0, fora }); continue; }
  elegiveis.push({ t, r });
}
// --limite: turnos espalhados por igual pelo período (não só os primeiros dias).
const alvo = leiturasSalvas ? elegiveis.filter(({ t }) => leiturasSalvas.has(t.id)) : LIMITE && LIMITE < elegiveis.length ? Array.from({ length: LIMITE }, (_, i) => elegiveis[Math.floor((i * elegiveis.length) / LIMITE)]) : elegiveis;
console.log(`Replay: ${dados.turnos.length} turnos · ${alvo.length} lidos${SIMULADO ? " (SIMULADO)" : RELER ? " (leituras de " + RELER + ", sem custo)" : ""} · ${linhas.length} fora da leitura · ${semHistorico} sem histórico`);
const errOriginal = console.error;
console.error = () => {};
const CONCORRENCIA = 5;
for (let k = 0; k < alvo.length; k += CONCORRENCIA) {
  if (TETO_USD !== null && custo >= TETO_USD) { parouNoTeto = true; break; }
  await Promise.all(alvo.slice(k, k + CONCORRENCIA).map(async ({ t, r }) => {
    const inicio = Date.now();
    const bruta = leiturasSalvas ? leiturasSalvas.get(t.id)! : await lerTurnoInstitucional(r.texto, CHAVE, r.historicoRota, (corpo) => {
      const u = corpo.usage ?? {};
      const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
      custo += ((u.prompt_tokens ?? 0) - cached) * 0.15e-6 + cached * 0.075e-6 + (u.completion_tokens ?? 0) * 0.6e-6;
    });
    const latencia = Date.now() - inicio;
    const base = { turno: t, familiaAntiga: familiaAntiga(t), latencia_ms: latencia, texto: r.texto, ultimoBloco: r.ultimoBloco.slice(0, 300) };
    if (!bruta) { linhas.push({ ...base, familiaNova: null, acao: "plano_b", leitura: null }); return; }
    const lida = consolidarLeitura(bruta, r.texto, r.mensagensRajada);
    // mesmo passo do handler: "só a unidade" logo depois de um pedido de atividade = o mesmo pedido
    const pedidoAnterior = lida.tipo === "so_unidade" && !lida.atividade ? pedidoAnteriorDoLead(r.historicoRota) : "";
    const l = pedidoAnterior ? completarSoUnidadeComPedidoAnterior(lida, pedidoAnterior, itensDoMes(t.created_at.slice(0, 7))) : lida;
    const textoDoPedido = l !== lida ? pedidoAnterior + "\n" + r.texto : r.texto;
    const itens = l.atividade || l.termos_busca.length ? itensDoMes(t.created_at.slice(0, 7)) : [];
    const acao = decidirRota(l, estadoAproximado(t, r, l, itens, textoDoPedido));
    linhas.push({ ...base, familiaNova: familiaNova(acao.acao), acao: acao.acao + ("escopo" in acao ? ":" + (acao.escopo === ESCOLHA_REDE ? "rede" : "unidade") : ""), leitura: l });
  }));
}
console.error = errOriginal;
globalThis.fetch = fetchOriginal;

// ── relatório ────────────────────────────────────────────────────────────────────────────────
const lidas = linhas.filter((x) => !x.fora);
const decididas = lidas.filter((x) => x.familiaNova);
const divergentesTodas = decididas.filter((x) => x.familiaNova !== x.familiaAntiga);
const esperadas = divergentesTodas.filter((x) => divergenciaEsperada(x.familiaAntiga, x.familiaNova!, x.acao!));
const divergentes = divergentesTodas.filter((x) => !divergenciaEsperada(x.familiaAntiga, x.familiaNova!, x.acao!));
const contar = (xs: string[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
const latencias = lidas.map((x) => x.latencia_ms).sort((a, b) => a - b);
const pct = (p: number) => latencias.length ? latencias[Math.min(latencias.length - 1, Math.floor(p * latencias.length))] : 0;
// Amostra determinística: espalhada pela lista de divergências.
const passo = Math.max(1, divergentes.length / AMOSTRA);
const amostra = Array.from({ length: Math.min(AMOSTRA, divergentes.length) }, (_, k) => divergentes[Math.floor(k * passo)]);

const md: string[] = [];
md.push(`# Replay da rota estruturada (S-INST-QUAL-06)${SIMULADO ? " — SIMULADO" : RELER ? " — releitura de " + RELER + " (sem custo)" : ""}`, "");
md.push(`- Arquivo: \`${ARQUIVO}\` · turnos: ${dados.turnos.length} · lidos: ${lidas.length} · fora da leitura: ${linhas.length - lidas.length} · sem histórico: ${semHistorico}`);
md.push(`- Plano B (leitura falhou): ${lidas.length - decididas.length} · latência da leitura p50 ${pct(0.5)} ms · p95 ${pct(0.95)} ms · acima de 3 s: ${latencias.filter((x) => x > 3000).length} · acima de 5 s (limite): ${latencias.filter((x) => x > 5000).length}`);
md.push(`- Custo da leitura: US$ ${custo.toFixed(4)}${parouNoTeto ? " (parou no teto)" : ""}`);
md.push(`- Divergências de família (antiga × nova): ${divergentesTodas.length} de ${decididas.length} · previstas pela tabela: ${esperadas.length} · **a revisar: ${divergentes.length}** (${decididas.length ? (100 * divergentes.length / decididas.length).toFixed(1) : "0"}%)`, "");
md.push("## Divergências previstas pela tabela", "", "| Linha da tabela | Turnos |", "|---|---:|", ...contar(esperadas.map((x) => divergenciaEsperada(x.familiaAntiga, x.familiaNova!, x.acao!)!)).map(([k, n]) => `| ${k} | ${n} |`), "");
md.push("## Fora da leitura", "", "| Motivo | Turnos |", "|---|---:|", ...contar(linhas.filter((x) => x.fora).map((x) => x.fora!)).map(([k, n]) => `| ${k} | ${n} |`), "");
md.push("## Divergências a revisar, por tipo (antiga → nova)", "", "| Antiga → nova | Turnos |", "|---|---:|", ...contar(divergentes.map((x) => x.familiaAntiga + " → " + x.familiaNova)).map(([k, n]) => `| ${k} | ${n} |`), "");
md.push("## Ações novas (todas as lidas)", "", "| Ação | Turnos |", "|---|---:|", ...contar(decididas.map((x) => x.acao!)).map(([k, n]) => `| ${k} | ${n} |`), "");
md.push(`## Amostra de ${amostra.length} divergências a revisar (revisão à mão)`, "", "| # | Camada antiga | Ação nova | Leitura (tipo/assunto/escopo/atividade/idade) | Mensagem | Última resposta do bot |", "|---|---|---|---|---|---|");
amostra.forEach((x, k) => {
  const l = x.leitura!;
  const limpa = (s: string, n: number) => s.replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, n);
  md.push(`| ${k + 1} | ${x.turno.camada} (${x.turno.unidade_cuca ?? "-"}) | ${x.acao} | ${l.tipo}/${l.assunto}/${l.escopo}/${l.atividade ?? "-"}/${l.idade ?? "-"} | ${limpa(x.texto ?? "", 140)} | ${limpa(x.ultimoBloco ?? "", 120)} |`);
});
const hoje = new Date().toISOString().slice(0, 10);
const nome = `${hoje}-replay-rota${SIMULADO ? "-simulado" : RELER ? "-releitura" : ""}`;
await Deno.mkdir(new URL("resultados/", BASE), { recursive: true });
await Deno.writeTextFile(new URL(`resultados/${nome}.md`, BASE), md.join("\n") + "\n");
await Deno.writeTextFile(new URL(`resultados/${nome}.json`, BASE), JSON.stringify({ simulado: SIMULADO, custo_usd: custo, parou_no_teto: parouNoTeto, linhas }, null, 1));
console.log(`Relatório: eval/resultados/${nome}.md · custo US$ ${custo.toFixed(4)} · divergências ${divergentesTodas.length}/${decididas.length} (a revisar: ${divergentes.length})`);
