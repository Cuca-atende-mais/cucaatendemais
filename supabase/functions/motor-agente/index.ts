import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import type { Database } from "./database.types.ts";

// Modelo da resposta final (chamarGPT). Trocado de gpt-4o para gpt-4o-mini em 2026-09-28 por
// custo (diagnóstico de consumo OpenAI de 23/09) — mesmo modelo que a Empregabilidade já usa.
// Rollback = voltar para "gpt-4o" e redeployar a function.
const GPT_MODEL = "gpt-4o-mini";
const EMBEDDING_MODEL = "text-embedding-3-small";
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

// S-WM-40: derivado de UNIDADES_MAP (filtra as chaves de d\u00edgito) \u2014 elimina a duplica\u00e7\u00e3o que
// existia em detectarTrocaUnidade (literal local id\u00eantico, exceto pelas chaves num\u00e9ricas).
const NOMES_UNIDADES_POR_PALAVRA: Record<string, string> = Object.fromEntries(
  Object.entries(UNIDADES_MAP).filter(([chave]) => !/^\d$/.test(chave))
);

export const MENU_UNIDADES = "Sobre qual unidade CUCA voc\u00ea quer saber? \ud83d\ude0a\n\n1\ufe0f\u20e3 Barra\n2\ufe0f\u20e3 Jangurussu\n3\ufe0f\u20e3 Mondubim\n4\ufe0f\u20e3 Pici\n5\ufe0f\u20e3 Jos\u00e9 Walter\n6\ufe0f\u20e3 Toda a Rede CUCA";

export function ehSelecaoMenu(texto: string): boolean {
  return /^[1-5]$/.test(texto.trim());
}

/**
 * Hotfix 05/11/2026: o lead responde o menu tocando no emoji ("6️⃣", ou "6⃣" sem o seletor de
 * variação). Sem isto, nenhum teste de dígito do roteamento reconhecia a escolha e a pergunta
 * original se perdia. Vira o dígito puro antes de qualquer roteamento.
 */
export function normalizarDigitosEmoji(texto: string): string {
  return texto.replace(/([0-9#*])\uFE0F?\u20E3/g, "$1");
}

const PALAVRAS_CORTESIA = new Set([
  "oi", "oie", "oii", "oiii", "ola", "opa", "eae", "eai", "ei", "hey", "salve", "bom", "boa", "dia",
  "tarde", "noite", "bomdia", "boatarde", "boanoite", "tudo", "td", "bem", "joia", "beleza", "blz",
  "ok", "okay", "okk", "certo", "ta", "to", "tah", "entendi", "entendido", "valeu", "vlw", "obrigado",
  "obrigada", "obg", "brigado", "brigada", "grato", "grata", "show", "perfeito", "otimo", "top",
  "massa", "legal", "hum", "humm", "ah", "aham", "uhum", "kk", "kkk", "kkkk", "rs", "e", "voce", "vc",
  "como", "vai", "esta", "tranquilo", "de", "nada", "muito", "mt", "mto", "tudo", "pra", "voces",
]);

/**
 * Hotfix 05/11/2026: a resposta pronta "Em que mais posso te ajudar? 😊" só vale para cumprimento
 * puro ("oi", "bom dia", "ok", "valeu", só emoji). Antes ela valia para qualquer mensagem que o
 * classificador não marcasse como pergunta geral — e engoliu ~95 mensagens reais em 3 dias
 * ("7 anos", "link de inscrição", "Curso de fotografgia"). "sim" e "não" ficam de fora de
 * propósito: quase sempre respondem a uma pergunta do bot e precisam do modelo.
 */
export function ehCortesiaPura(texto: string): boolean {
  const palavras = normalizarTexto(texto).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  if (palavras.length === 0) {
    // S-INST-QUAL-05: só pontuação ("?", "??", "…", ".") não é cortesia. Na releitura das
    // ocorrências de 05 a 13/11, o "?" sozinho veio sempre depois de uma pergunta sem resposta
    // ("Quando aconteceram" + "?") e recebia "Em que mais posso te ajudar?". Só emoji
    // ("👍", "🙏🏻") continua cortesia.
    if (rotaUsaRajada() && /[?!.,;:…*+\-]/.test(texto) && /^[\s?!.,;:…*+\-]+$/.test(texto)) return false;
    return true;
  }
  if (palavras.length > 5) return false;
  // S-INST-QUAL-05 (releitura de 05 a 13/11): "tudo bem com você?". Atrás da chave, como o "?".
  const comRajada = rotaUsaRajada();
  return palavras.every((p) => PALAVRAS_CORTESIA.has(p) || (comRajada && PALAVRAS_CORTESIA_RAJADA.has(p)));
}

/** S-INST-QUAL-05: palavras de cortesia que só valem com a chave ROTA_USA_RAJADA ligada. */
const PALAVRAS_CORTESIA_RAJADA = new Set(["com"]);

// ── S-INST-QUAL-05: rajada inteira ──────────────────────────────────────────────────────────
// O worker espera 10 s e manda ao motor só a ÚLTIMA mensagem; as anteriores da mesma rajada já
// estão gravadas em `mensagens`. As decisões de rota (transbordo, Emprega+, unidade, frase pronta,
// busca) passam a olhar a rajada inteira: as mensagens do cidadão depois da última resposta do bot.
// O caminho da S-WM-72 (programação) não muda: ele já lê a sessão inteira.

/** Chave de reversão (`supabase secrets set ROTA_USA_RAJADA=false`). Lida a cada requisição;
 * ligada por padrão. Desligada, a rota volta a olhar só a última mensagem, como antes. */
export function rotaUsaRajada(): boolean {
  return (Deno.env.get("ROTA_USA_RAJADA") ?? "").trim().toLowerCase() !== "false";
}

/** Mensagem da rajada mais antiga que isso (em relação à última) fica de fora: sem resposta do bot
 * no meio, só por demora (atendente que devolveu a conversa sem responder, erro), não é rajada. */
export const JANELA_RAJADA_MS = 10 * 60 * 1000;

type MensagemRajada = { role: string; content: string; created_at?: string | null };

/** Marcadores que o worker grava no histórico para mídia sem texto (`_texto_historico_para_midia_vazia`).
 * Não são texto do cidadão: ficam fora da rajada ("Boa tarde" + imagem sem legenda continua cortesia). */
const MARCADOR_MIDIA_SEM_TEXTO = /^\[(Imagem enviada sem legenda|Documento enviado|Áudio enviado|Mídia enviada)\]$/;

/** Mensagens do cidadão depois da última resposta do bot (inclui a atual, que o worker já gravou),
 * da mais antiga para a mais nova, dentro de `JANELA_RAJADA_MS` da última. */
export function mensagensDaRajada(historico: MensagemRajada[], janelaMs = JANELA_RAJADA_MS): string[] {
  let inicio = historico.length;
  while (inicio > 0 && historico[inicio - 1].role === "user") inicio--;
  let rajada = historico.slice(inicio);
  const ultima = rajada.length ? Date.parse(rajada[rajada.length - 1].created_at ?? "") : NaN;
  if (!Number.isNaN(ultima)) {
    rajada = rajada.filter((m) => {
      const t = Date.parse(m.created_at ?? "");
      return Number.isNaN(t) || ultima - t <= janelaMs;
    });
  }
  return rajada.map((m) => m.content.trim()).filter((t) => t && !MARCADOR_MIDIA_SEM_TEXTO.test(t));
}

/** Separa a mensagem atual das anteriores da rajada. A atual sai do histórico pelo texto cru
 * (`mensagemLead`, como o worker gravou) ou já normalizado (`textoFinal`, ex.: "6️⃣" → "6"). */
export function anterioresDaRajada(historico: MensagemRajada[], textoFinal: string, mensagemLead = textoFinal): string[] {
  const msgs = mensagensDaRajada(historico);
  const ultima = msgs[msgs.length - 1];
  if (ultima !== undefined && (ultima === mensagemLead.trim() || normalizarDigitosEmoji(ultima).trim() === textoFinal.trim())) msgs.pop();
  return msgs;
}

/** Texto da rajada: as mensagens anteriores da rajada, uma por linha, terminando em `textoFinal`.
 * Sem mensagem anterior, é o próprio `textoFinal`. */
export function textoRajada(historico: MensagemRajada[], textoFinal: string, mensagemLead = textoFinal): string {
  return [...anterioresDaRajada(historico, textoFinal, mensagemLead), textoFinal.trim()].join("\n");
}

/** Histórico até a última resposta do bot (sem o bloco de mensagens do cidadão depois dela). Os
 * classificadores recebem a rajada como texto atual e o histórico ANTES dela — assim a rajada não
 * aparece duas vezes no prompt. */
export function historicoAntesDaRajada<T extends { role: string }>(historico: T[]): T[] {
  let fim = historico.length;
  while (fim > 0 && historico[fim - 1].role === "user") fim--;
  return historico.slice(0, fim);
}

/** No caso misto do Emprega+, a rajada inteira vira só a outra pergunta (uma mensagem do lead). */
export function trocarRajadaNoHistorico<T extends { role: string; content: string }>(historico: T[], novoTexto: string): { role: string; content: string }[] {
  return [...historicoAntesDaRajada(historico), { role: "user", content: novoTexto }];
}

/** A rajada é cortesia pura quando TODA mensagem dela é cortesia ("Olá bom dia" + "tudo bem com
 * você?" continua cortesia, mesmo passando de 5 palavras juntas). */
export function rajadaEhCortesiaPura(mensagens: string[]): boolean {
  return mensagens.length > 0 && mensagens.every((m) => ehCortesiaPura(m));
}

/** Transbordo pela rajada. A negação é avaliada mensagem por mensagem e, em qualquer uma, cancela
 * ("quero um atendente" + "não, não preciso de atendente"); juntar a rajada para a negação faria
 * "não consigo" de uma mensagem anular o pedido de outra. */
export function deveAcionarHandoverNaRajada(mensagens: string[], agenteTipo: string): boolean {
  if (agenteTipo !== "Institucional" && agenteTipo !== "maria") return false;
  const normalizadas = mensagens.map(normalizarTextoIntencao).filter(Boolean);
  if (normalizadas.some((m) => PADROES_NEGACAO_HANDOVER_INSTITUCIONAL.some((p) => p.test(m)))) return false;
  // O pedido vale numa mensagem só ou na rajada junta ("não consigo" + "acessar minha conta").
  return [...normalizadas, normalizadas.join(" ")].some((m) => PADROES_HANDOVER_INSTITUCIONAL.some((p) => p.test(m)));
}

/** Unidades citadas pelo nome (match exato, sem tolerância a erro de digitação), sem repetir. */
export function unidadesCitadas(texto: string): string[] {
  const lower = texto.toLowerCase();
  const achadas: string[] = [];
  for (const [chave, unidade] of Object.entries(NOMES_UNIDADES_POR_PALAVRA)) {
    if (contemPalavra(lower, chave) && !achadas.includes(unidade)) achadas.push(unidade);
  }
  return achadas;
}

/** Alguma mensagem ANTERIOR da rajada traz um pedido: tirando os nomes de unidade, sobra algo que
 * não é cumprimento ("Queria natação na Barra" sim; "Barra", "oi" não). Usado quando a rajada
 * resolve a unidade: o pedido escrito antes da saudação não pode virar "resumo geral". */
export function rajadaTemPedido(anteriores: string[]): boolean {
  return anteriores.some((m) => {
    let semUnidade = m.toLowerCase();
    for (const chave of Object.keys(NOMES_UNIDADES_POR_PALAVRA)) semUnidade = semUnidade.replace(new RegExp("\\b" + escaparRegex(chave) + "\\b", "g"), " ");
    semUnidade = semUnidade.replace(/\b(cuca|unidade|no|na|do|da|de|em)\b/g, " ");
    return !ehCortesiaPura(semUnidade);
  });
}

/** A última resposta do bot já foi a frase pronta ("Em que mais posso te ajudar?" ou a saudação
 * com "Em que posso te ajudar?") — não repete; segue pelo caminho de pergunta geral. */
export function ultimaRespostaFoiFrasePronta(historico: { role: string; content: string }[]): boolean {
  const ultima = [...historico].reverse().find((m) => m.role === "assistant");
  if (!ultima) return false;
  const t = ultima.content.trim();
  return t.endsWith("Em que mais posso te ajudar? 😊") || t.endsWith("Em que posso te ajudar? 😊");
}

/**
 * Extrai o texto da opção escolhida (ex.: "3" -> "Natação") num menu numerado de CATEGORIA de
 * programação enviado pelo agente. AUD-09: quando `ultimaMsgAgente` é o menu de UNIDADES
 * (MENU_UNIDADES), o dígito nunca é resposta a uma seleção de categoria — é resposta à
 * pergunta "qual unidade", já tratada em decidirAguardandoUnidade/decidirPrimeiraMensagem.
 * Sem esse guard, "3" (Mondubim) contaminava a instrução ao GPT como se fosse uma área de
 * programação selecionada.
 */
export function extrairTextoMenu(numero: string, ultimaMsgAgente: string): string {
  if (ultimaMsgAgente === MENU_UNIDADES) return '';
  for (const linha of ultimaMsgAgente.split('\n')) {
    const s = linha.trim().replace(/[\ufe0f\u20e3]/g, '');
    if (s.startsWith(numero + ' ') || s.startsWith(numero + '.') || s.startsWith(numero + ')')) {
      return linha.replace(/^[\d\ufe0f\u20e3.\)\s]+/, '').trim();
    }
  }
  return '';
}

/**
 * VAL-08 (docs/migracao-meta/VALIDACAO-producao-institucional.md), variante do AUD-09: um
 * d\u00edgito solto (`ehSelecaoMenu`) s\u00f3 \u00e9 resposta leg\u00edtima a um menu se a \u00faltima mensagem do
 * agente REALMENTE foi um menu numerado (MENU_UNIDADES ou um menu de categorias com linhas
 * numeradas) \u2014 n\u00e3o a qualquer pergunta em texto livre que o GPT tenha inventado sozinho
 * (ex.: "qual unidade voc\u00ea quer saber mais?", sem lista numerada nenhuma). Confirmado em
 * produ\u00e7\u00e3o: "2" respondendo a uma pergunta assim recarregava a vis\u00e3o geral completa (~40
 * chunks) \u00e0 toa, sem nenhuma rela\u00e7\u00e3o com o menu de unidades/categorias do c\u00f3digo.
 * Corre\u00e7\u00e3o PARCIAL do problema de fundo: cobre o caso "GPT perguntou em texto livre, sem
 * n\u00fameros"; N\u00c3O cobre o caso do GPT improvisar um menu numerado pr\u00f3prio (isso seria
 * indistingu\u00edvel de um menu real por este teste \u2014 ver VAL-06 no relat\u00f3rio).
 */
export function ultimaMensagemEhMenuNumerado(ultimaMsgAgente: string): boolean {
  if (ultimaMsgAgente === MENU_UNIDADES) return true;
  return ultimaMsgAgente.split('\n').some((linha) => {
    const s = linha.trim().replace(/[\ufe0f\u20e3]/g, '');
    return /^[1-9][.\)]?\s/.test(s);
  });
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

/**
 * Backlog 4a (fallback para outros canais): irmã de `removerTag`, mas para tags que carregam
 * um argumento — `[[ENCAMINHAR:canal]]`. Captura o valor do argumento separadamente do texto
 * limpo. Mesmo espírito de `removerTag`: tolera variação de case/espaçamento na tag em si.
 * O argumento capturado NUNCA deve ser usado como dado confiável por si só — quem chama isto
 * precisa validar contra uma lista fechada (ver `validarCanalEncaminhamento`) antes de usar,
 * mesmo princípio de "nunca confia cegamente no LLM" já aplicado a `validarAvaliacaoSelecaoUnidade`.
 */
export function extrairTagComArgumento(
  texto: string,
  nomeTag: string,
): { encontrada: boolean; argumento: string | null; texto: string } {
  const nomeEscapado = escaparRegex(nomeTag);
  const regexComGrupo = new RegExp("\\[\\[\\s*" + nomeEscapado + "\\s*:\\s*([a-z_]+)\\s*\\]\\]", "i");
  const regexGlobal = new RegExp("\\[\\[\\s*" + nomeEscapado + "\\s*:\\s*[a-z_]+\\s*\\]\\]", "gi");
  const match = texto.match(regexComGrupo);
  const textoLimpo = texto.replace(regexGlobal, "").trim();
  return {
    encontrada: !!match,
    argumento: match ? match[1].toLowerCase() : null,
    texto: textoLimpo,
  };
}

function normalizarTextoIntencao(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// S-INST-QUAL-01 (A4): quem a pessoa pede para chamar. "alguem" cobre "alguem da equipe" e
// "alguem do setor de matricula". Texto ja normalizado (sem acento, minusculo).
const ARTIGO_PESSOA = "(o |a |os |as |um |uma |algum |alguma |ao )?";
const ALVO_PESSOA = "(gerente|gerencia|coordenador|coordenadora|coordenacao|diretor|diretora|diretoria|direcao|responsavel|funcionario|funcionaria|alguem|setor|equipe)";
// So cargos (sem "alguem", "setor" e "equipe"), para os verbos "chamar" e "ligar para".
const CARGO_PESSOA = "(gerente|gerencia|coordenador|coordenadora|coordenacao|diretor|diretora|diretoria|direcao|responsavel|funcionario|funcionaria|atendente)";

const PADROES_HANDOVER_INSTITUCIONAL = [
  /\bfalar com (um |uma |o |a )?(atendente|humano|pessoa)\b/,
  /\bquero (um |uma |o |a )?(atendente|humano)\b/,
  /\bpreciso de (um |uma |o |a )?(atendente|humano|pessoa)\b/,
  /\bchamar (um |uma |o |a )?(atendente|humano)\b/,
  /\batendimento humano\b/,
  /\bpessoa real\b/,
  /\bme passa(r)? (para|pra|pro) (um |uma |o |a )?(atendente|humano|pessoa)\b/,
  /\btransfer(ir|e)? (para|pra|pro) (um |uma |o |a )?(atendente|humano|pessoa)\b/,
  // S-WM-AUD-006 (Plano 008) — recuperacao de acesso ao Portal da Juventude. A IA nao tem acesso
  // ao sistema de contas: so um humano resolve, e a colaboradora do CUCA confirmou que resolve
  // esses casos manualmente hoje. Sem isso o lead repetia o pedido varias vezes sem transbordo
  // (Violeta/9456c260 e 🧿💞/ed18367a) e so era atendido quando alguem entrava por conta propria.
  //
  // Padroes escritos a partir do TEXTO REAL das 2 conversas, nao do que o plano propunha: as
  // regexes do Plano 008 exigiam "nao consigo" colado a "acessar" e pegavam 3 das 6 falas reais.
  // Ficavam de fora as duas mais claras — "Pelo portal eu nao consigo me inscrever" (o primeiro
  // sinal da conversa) e "Gostaria de ajuda para acessar a minha conta no portal" (repetida 2x).
  //
  // Exigem SEMPRE um sinal de problema ("nao consigo", "perdi", "esqueci", "bloqueado") ou um
  // pedido explicito de ajuda. "Quero acessar o portal pra ver os cursos" — intencao normal, sem
  // problema — NAO dispara.
  /\bnao (consigo|consegui|estou conseguindo)\b.{0,40}\b(acessar|entrar|logar|inscrever|matricular|cadastrar)\b/,
  /\b(ajuda|ajudar|auxilio|me ajud\w+)\b.{0,40}\b(acessar|entrar|recuperar|resgatar)\b.{0,40}\b(conta|portal|juv|juventude|cadastro|senha|login)\b/,
  /\b(perdi|esqueci)\b.{0,25}\b(acesso|senha|conta|login|usuario|e-?mail)\b/,
  /\brecuperar\b.{0,25}\b(acesso|senha|conta|cadastro|login)\b/,
  /\b(conta|acesso|cadastro|login)\b.{0,25}\b(bloquead[oa]|travad[oa]|suspens[oa]|nao funciona|nao esta funcionando)\b/,
  // S-INST-QUAL-01 (A9): as duas frases reais de outubro ("nao consigo... diz que preciso
  // atualizar meu cadastro") nao casavam com os padroes acima: "atualizar cadastro" nao era
  // reconhecido. A base nao orienta esse caso, entao vai para o atendente. A ordem invertida
  // ("me matricular ... mas nao consigo") ficou de fora de proposito: pegaria "quero me matricular
  // no judo mas nao consigo de manha, tem a noite?", que e pergunta de horario.
  /\batualiza(r|cao)?\b.{0,20}\b(cadastro|acesso|conta|dados)\b/,
  // S-INST-QUAL-01 (A4): pedido de falar com gerente, coordenacao, direcao, responsavel,
  // funcionario, alguem da equipe ou de um setor. Exige verbo de contato: uma pergunta SOBRE um
  // setor ("o setor de esportes tem natacao?") nao e pedido de pessoa. O artigo e restrito de
  // proposito: "falar com meu responsavel" (pai/mae de menor) nao casa.
  new RegExp("\\b(falar|conversar)\\s+com\\s+" + ARTIGO_PESSOA + ALVO_PESSOA + "\\b"),
  new RegExp("\\b(passa|passe|passar|transfere|transferir|transfira|encaminha|encaminhar|encaminhe)\\s+(para|pra|pro)\\s+" + ARTIGO_PESSOA + ALVO_PESSOA + "\\b"),
  // "chamar" e "ligar para" so com cargo: "posso chamar alguem pra fazer o curso comigo?" e
  // "posso chamar uma equipe pra jogar na quadra?" nao sao pedido de atendimento.
  new RegExp("\\bchamar\\s+" + ARTIGO_PESSOA + CARGO_PESSOA + "\\b"),
  new RegExp("\\bligar\\s+(para|pra|pro)\\s+" + ARTIGO_PESSOA + CARGO_PESSOA + "\\b"),
  // S-INST-QUAL-06 (decisão do Junior, 14/11): "humano", "atendente" e "alguém" num pedido, mesmo
  // dentro de outra frase ("não tem humano aí?", "tem alguém aí pra me ajudar?", "Atendente!").
  // "humano" no singular: "recursos/direitos humanos" (plural) não casa; "ser humano" fica de fora.
  /(?<!\bser )\bhumano\b/,
  // "atendente" só como pedido (sozinho, ou com tem/cadê/chama/quero...), nunca como emprego
  // ("vaga de atendente", "quero ser atendente", "trabalhar como atendente").
  /^(?!.*\b(vagas?|emprego|empregos|trabalh\w*|curriculo|contrat\w*|cargo|ser atendente|como atendente)\b)(.*\b(tem|ha|cade|chama|chame|chamar|quero|queria|preciso|gostaria|falar|fala|me passa\w*|me transfer\w*)\b.{0,20})?\batendente\b/,
  /\b(tem|ha|existe) (algum |alguma )?alguem\b.{0,30}\b(ai|aqui|ae|ajudar|atender|responder|falar)\b/,
  /\bnao tem (ninguem|alguem)\b.{0,30}\b(ai|aqui|ae|ajudar|atender|responder|falar)\b/,
  /\bpessoa de verdade\b/,
  // plural só logo depois de tem/há/cadê ("tem humanos aí?", "cadê os humanos?"); "tem curso de
  // recursos humanos?" não casa.
  /\b(tem|ha|existe|existem|cade)\s+(os |algum |alguns |uns )?humanos\b/,
];

const PADROES_NEGACAO_HANDOVER_INSTITUCIONAL = [
  /\bnao (quero|preciso|pode|deve)\b.{0,40}\b(atendente|humano|pessoa|atendimento humano)\b/,
  /\bsem (atendente|humano|atendimento humano)\b/,
  /\bnao me passa(r)? (para|pra|pro)\b.{0,30}\b(atendente|humano|pessoa)\b/,
  // S-INST-QUAL-01 (A4): a mesma negacao para gerente, coordenacao, setor etc.
  new RegExp("\\bnao (quero|preciso|precisa|pode|deve)\\b.{0,40}\\b" + ALVO_PESSOA + "\\b"),
  new RegExp("\\bnao me (passa|passe|passar|transfere|transfira|encaminha|encaminhe)\\b.{0,30}\\b" + ALVO_PESSOA + "\\b"),
];

export function deveAcionarHandoverInstitucional(texto: string, agenteTipo: string): boolean {
  if (agenteTipo !== "Institucional" && agenteTipo !== "maria") return false;
  const normalizado = normalizarTextoIntencao(texto);
  if (!normalizado) return false;
  if (PADROES_NEGACAO_HANDOVER_INSTITUCIONAL.some((padrao) => padrao.test(normalizado))) return false;
  return PADROES_HANDOVER_INSTITUCIONAL.some((padrao) => padrao.test(normalizado));
}

// ── S-INST-QUAL-06 (decisão do Junior, 14/11): horário do atendente e falta de informação ──────
// O atendente do Institucional é o mesmo do Emprega+: mesma janela (segunda a sexta, 08:00 às 16:59,
// -03:00; feriado não é tratado, como lá) e a mesma mensagem já aprovada pelo Junior
// (`worker/empregabilidade_engine.py`, S-EMP-AUD-040). Fora da janela não transborda: avisa o
// horário e a IA segue ativa (a conversa não fica parada em `awaiting_human`).
export const MENSAGEM_FORA_HORARIO_ATENDENTE =
  "No momento nossa equipe não está disponível. 🕐\n" +
  "O atendimento humano funciona de *segunda a sexta, das 08:00 às 17:00*.\n\n" +
  "Assim que abrirmos, é só chamar aqui que a gente te atende!\n" +
  "Enquanto isso, posso te ajudar com mais alguma coisa por aqui? 😊";

let relogioAtendimento: () => Date = () => new Date();
/** Só para testes: fixa o "agora" da checagem de horário (null volta ao relógio real). O gabarito
 * não precisa: a data simulada dele troca o `Date` global. */
export function definirRelogioAtendimento(relogio: (() => Date) | null): void {
  relogioAtendimento = relogio ?? (() => new Date());
}

/** Segunda a sexta, 08:00 às 16:59 em -03:00 (Fortaleza, sem horário de verão). Às 17:00 já é fora. */
export function dentroHorarioAtendimentoHumano(agora: Date = relogioAtendimento()): boolean {
  const local = new Date(agora.getTime() - 3 * 3600000);
  const diaDaSemana = local.getUTCDay();
  if (diaDaSemana === 0 || diaDaSemana === 6) return false;
  const minutos = local.getUTCHours() * 60 + local.getUTCMinutes();
  return minutos >= 8 * 60 && minutos < 17 * 60;
}

/** Frase em que o PRÓPRIO BOT oferece ou promete atendente ("posso te conectar com um atendente",
 * "quer falar com um atendente?", "vou chamar alguém da equipe", "já te encaminho"). Orientação para
 * procurar a unidade ("entre em contato com a atendente da unidade pelo (85)...") não é oferta: frase
 * com telefone nunca sai (achado médio do @qa, 15/11). */
const ALVO_ATENDENTE = "(atendente|atendimento humano|alguem da equipe|nossa equipe|um humano)";
const OFERTAS_ATENDENTE = [
  new RegExp("\\b(posso|podemos|vou|vamos|irei|quer|queira|quiser|gostaria|deseja|desejar|prefere|preferir)\\b.{0,40}\\b" + ALVO_ATENDENTE + "\\b"),
  new RegExp("\\b(conect\\w*|cham\\w*|encaminh\\w*|transfer\\w*|acion\\w*)\\b.{0,30}\\b" + ALVO_ATENDENTE + "\\b"),
];
/** "já te encaminho", "vou te transferir": promessa de transferência sem citar atendente. */
const PROMESSA_TRANSFERENCIA = /\bte (encaminh|transfer)\w*\b/;
const TELEFONE_NO_TEXTO = /\(?\d{2}\)?\s?9?\d{4}[-\s]?\d{4}/;
export const FRASE_SEM_INFORMACAO = "Não encontrei essa informação por aqui. 😕";

/** Tira do texto do modelo as frases que oferecem ou prometem atendente (o Institucional não
 * oferece atendente: ele só entra quando a pessoa pede). Devolve o texto e se tirou alguma frase. */
export function removerOfertaDeAtendente(texto: string): { texto: string; removida: boolean } {
  let removida = false;
  const linhas = texto.split("\n").map((linha) => {
    // Cada caractere da linha cai numa frase (pontuação solta no começo, como "...", fica).
    const frases = linha.match(/[^.!?]*[.!?]+\s*(?:[\p{Extended_Pictographic}\uFE0F\u200D]+\s*)*|[^.!?]+/gu) ?? [linha];
    return frases.filter((frase) => {
      const norm = normalizarTextoIntencao(frase);
      const oferta = !TELEFONE_NO_TEXTO.test(frase) && (OFERTAS_ATENDENTE.some((p) => p.test(norm)) || PROMESSA_TRANSFERENCIA.test(norm));
      if (oferta) removida = true;
      return !oferta;
    }).join("").trimEnd();
  });
  return { texto: linhas.join("\n").replace(/\n{3,}/g, "\n\n").trim(), removida };
}

/** Contato das unidades montado pelo código (nunca pelo modelo): só a unidade da conversa quando ela
 * está definida e tem telefone; senão, todas as unidades com telefone. */
export function montarContatoUnidades(telefones: TelefoneUnidade[], unidade: string | null): string {
  const porNome = new Map(telefones.map((u) => [normalizarTextoIntencao(nomeUnidadeParaTexto(u.nome)), (u.telefone ?? "").trim()]));
  const linha = (nome: string) => {
    const telefone = porNome.get(normalizarTextoIntencao(nome));
    return telefone ? "📞 " + nome + ": " + telefone : "";
  };
  const daUnidade = unidade && UNIDADES_VALIDAS.includes(unidade) ? linha(unidade) : "";
  const linhas = daUnidade ? [daUnidade] : UNIDADES_VALIDAS.map(linha).filter(Boolean);
  if (!linhas.length) return "Para mais informações, procure a unidade CUCA mais perto de você.";
  return (daUnidade ? "Para mais informações, fale com a unidade:" : "Para mais informações, fale com as unidades CUCA:") + "\n" + linhas.join("\n");
}

/** Resposta do Institucional quando o modelo pediu transbordo ou ofereceu atendente sem a pessoa
 * pedir: sem atendente, diz que não encontrou (se sobrar pouco texto) e passa o contato da unidade. */
export function respostaSemAtendente(texto: string, telefones: TelefoneUnidade[], unidade: string | null): string {
  const limpo = removerOfertaDeAtendente(texto).texto;
  const base = limpo.replace(/[\s\p{Extended_Pictographic}️]+/gu, "").length >= 15 ? limpo : FRASE_SEM_INFORMACAO;
  return TELEFONE_NO_TEXTO.test(base) ? base : base + "\n\n" + montarContatoUnidades(telefones, unidade);
}

// ── S-INST-QUAL-01 (A8): Emprega+ ──────────────────────────────────────────────────────────
// O Institucional nao trata de emprego: quem pergunta por emprego, trabalho, estagio ou
// curriculo recebe o contato do Emprega+, montado pelo codigo (nunca pelo modelo). Roda logo
// depois da deteccao de transbordo, antes do menu e das frases prontas — em outubro 32 perguntas
// de emprego receberam frase pronta e nunca chegaram ao modelo.

// Camada 1 — termos claros. "trabalho/trabalhar" so conta com intencao ("quero trabalhar",
// "vaga de trabalho") ou sozinho: "eu trabalho de dia, tem curso a noite?" e pergunta de curso.
const PADROES_EMPREGO = [
  /\bempregos?\b/,
  /\bemprega ?(\+|mais)/,
  /\bdesempregad[oa]s?\b/,
  /\bcurriculos?\b/,
  /\b(jovem|menor) aprendiz\b/,
  /\bestagi\w*\b/,
  /\b(vagas?|oportunidades?|ofertas?) (de )?(trabalho|emprego|estagio)\b/,
  /\b(quero|queria|gostaria de|preciso( de)?|precisando( de)?|procuro|procurando|busco|buscando|arrumar|arranjar|conseguir)( um| uma| algum)? (trabalho|trabalhar|servico)\b/,
  /^((oi|ola)[\s,!.]+)?(trabalho|trabalhar)[\s?!.]*$/,
];

const PADROES_NEGACAO_EMPREGO = [
  /\bnao (quero|queria|procuro|preciso|busco|estou procurando|to procurando|estou buscando)\b.{0,25}\b(emprego|trabalho|trabalhar|estagio|vagas?)\b/,
];

// Trechos que citam curriculo sem ser pedido de emprego (conferido em mensagens reais de set-nov/2026):
// "Curriculo na Pratica" e nome de oficina, e "botar no curriculo" e sobre curso que vale no curriculo.
const TRECHOS_NAO_EMPREGO = [
  /\bcurriculo na pratica\b/g,
  /\b(colocar|botar|por|incluir)( isso)? (no|na|em|pro|para o) (meu |seu |dele |dela )?curriculo\b/g,
];

function normalizarParaEmprego(texto: string): string {
  let t = normalizarTextoIntencao(texto);
  for (const r of TRECHOS_NAO_EMPREGO) t = t.replace(r, " ");
  return t;
}

// Trechos de emprego e palavras que, sozinhas, nao formam outra pergunta. O que sobrar depois de
// tirar os dois e "outra pergunta" (caso misto, A8) ou "vagas" com atividade no texto (camada 2).
const TRECHOS_EMPREGO = [
  /\b(vagas?|oportunidades?|ofertas?) (de )?(trabalho|emprego|estagio)\b/g,
  /\bprimeiro emprego\b/g, /\b(jovem|menor) aprendiz\b/g, /\bemprega ?(\+|mais)/g,
  /\bempregos?\b/g, /\bdesempregad[oa]s?\b/g, /\bcurriculos?\b/g, /\bestagi\w*\b/g, /\btrabalh\w*\b/g,
];
const PALAVRAS_SEM_PERGUNTA = new Set([
  "oi", "ola", "bom", "boa", "dia", "tarde", "noite", "tudo", "bem", "por", "favor", "obrigado", "obrigada",
  "quero", "queria", "gostaria", "preciso", "precisando", "procuro", "procurando", "busco", "buscando",
  "arrumar", "arranjar", "conseguir", "saber", "sobre", "informacao", "informacoes", "info", "tem", "tenho",
  "ter", "voces", "vcs", "voce", "pra", "para", "pro", "como", "onde", "qual", "quais", "faco", "fazer",
  "posso", "pode", "cadastrar", "cadastro", "enviar", "mandar", "deixar", "entregar", "meu", "minha", "meus",
  "minhas", "uma", "uns", "umas", "com", "que", "vaga", "vagas", "oportunidade", "oportunidades", "alguma",
  "algum", "aqui", "ajuda", "ajudar", "servico", "alguem", "ainda", "hoje", "agora", "isso", "esse", "essa",
  "tambem", "tbm", "aberta", "abertas", "aberto", "abertos", "disponivel", "disponiveis", "nao", "sim",
]);

// S-INST-QUAL-01 (achado 1 do @qa): numa pergunta de EMPREGO, onde a pessoa quer trabalhar nao e
// outra pergunta. Sem isto, "tem vagas de emprego no cuca Pici?" ia para o fluxo normal, trocava a
// conversa para o Pici e mandava o resumo da programacao de la antes do Emprega+. So vale para a
// camada 1: na camada 2 ("tem vaga no Jangurussu?") a unidade citada e sinal de vaga de curso.
const PALAVRAS_LOCAL_EMPREGO = new Set([
  "cuca", "cucas", "rede", "unidade", "unidades", "perto", "barra", "pici", "mondubim", "jangurussu",
  "jose", "walter", "esta", "estao", "tendo", "teria", "tera", "vai",
]);

/** Palavras que sobram da mensagem depois de tirar os trechos de emprego e as palavras que, sozinhas,
 * nao formam outra pergunta. Vazio = a mensagem e so sobre emprego (ou so "tem vagas?").
 * `ignorarLocal` (camada 1) tambem tira onde a pessoa quer trabalhar (unidade, "cuca", "rede"). */
export function restoDaMensagemSemEmprego(texto: string, ignorarLocal = true): string[] {
  let t = normalizarParaEmprego(texto);
  for (const r of TRECHOS_EMPREGO) t = t.replace(r, " ");
  return t.replace(/[^a-z0-9 ]/g, " ").split(" ")
    .filter((p) => p.length >= 3 && !PALAVRAS_SEM_PERGUNTA.has(p) && !(ignorarLocal && PALAVRAS_LOCAL_EMPREGO.has(p)));
}

export type ClassificacaoEmprego = "emprego" | "emprego_misto" | "vagas_ambiguo" | null;

/**
 * Camada 1: termo claro de emprego → "emprego" (so isso) ou "emprego_misto" (tambem pede outra
 * coisa: o fluxo normal responde essa parte e o Emprega+ vai num balao a mais).
 * Camada 2: "vaga(s)" sozinho, sem atividade no texto e sem conversa de programacao em andamento →
 * "vagas_ambiguo" (o bot pergunta se e emprego ou curso). Com conversa de programacao → null.
 * So Institucional/maria: a Empregabilidade tem motor proprio e nao passa por aqui.
 */
export function classificarPerguntaEmprego(texto: string, agenteTipo: string, conversaEmProgramacao: boolean): ClassificacaoEmprego {
  if (agenteTipo !== "Institucional" && agenteTipo !== "maria") return null;
  const normalizado = normalizarParaEmprego(texto);
  if (!normalizado.trim()) return null;
  if (PADROES_NEGACAO_EMPREGO.some((p) => p.test(normalizado))) return null;
  if (PADROES_EMPREGO.some((p) => p.test(normalizado))) return restoDaMensagemSemEmprego(texto).length > 0 ? "emprego_misto" : "emprego";
  if (/\bvagas?\b/.test(normalizado) && restoDaMensagemSemEmprego(texto, false).length === 0 && !conversaEmProgramacao) return "vagas_ambiguo";
  return null;
}

/** Camada 2: a conversa recente trata de atividade ou programacao (unidade escolhida, consulta de
 * programacao em andamento, menu de area aberto, disparo recebido nas ultimas 24h, ou a ultima
 * resposta do bot foi de programacao). Ai "tem vagas?" e vaga de curso e segue o fluxo normal. O
 * disparo conta a parte porque ele nao fica em `mensagens`: quem responde "tem vaga?" ao aviso da
 * programacao do mes nao tem resposta anterior do bot no historico. */
export function conversaEmContextoDeProgramacao(metadata: Record<string, unknown>, ultimoBlocoAgente: string): boolean {
  const contexto = metadata.prog_contexto as Record<string, unknown> | null | undefined;
  if (metadata.unidade_selecionada || metadata.prog_escopo || metadata.prog_pendente || metadata.menu_categoria_ativo) return true;
  if (deveReconhecerDisparoRecente(metadata.ultimo_disparo as { enviado_em?: string } | null | undefined, false)) return true;
  if (contexto && typeof contexto === "object" && Object.keys(contexto).length > 0) return true;
  const ultimo = normalizarTextoIntencao(ultimoBlocoAgente);
  return /\b(seg|ter|qua|qui|sex|sab|dom|segunda|terca|quarta|quinta|sexta|sabado|domingo)\b|\bhorario|\bturmas?\b|\bprofessor|\bprogramacao\b|\bmodalidades?\b|\bcursos?\b|\boficinas?\b|\batividades?\b|\binscri|\bmatricul/.test(ultimo);
}

export const PERGUNTA_VAGA_AMBIGUA = "Você quer saber de vaga de emprego ou de vaga em curso ou atividade da Rede CUCA? 😊";

// S-INST-QUAL-01 (A8, decisão do Junior de 03/11): quem decide se a mensagem é de EMPREGO é o
// modelo, não a lista de palavras — a lista não pega gíria ("trampo", "bico", "tão contratando?")
// nem separa "curso de planilhas para o mercado de trabalho" de pedido de emprego. A lista acima
// (`classificarPerguntaEmprego`) fica só como reserva, quando a chamada ao modelo falha.

export type ResultadoEmprego = { classificacao: ClassificacaoEmprego; outraPergunta: string | null; fonte: "modelo" | "lista" | "sem_chamada" };

/** Marcador do prompt do classificador (os testes usam para separar esta chamada da resposta). */
export const MARCADOR_CLASSIFICADOR_EMPREGO = "CLASSIFICADOR DE EMPREGO";
const CLASSIFICADOR_EMPREGO_TIMEOUT_MS = 6000;
const OUTRA_PERGUNTA_MAX = 400;

/** Valida o JSON do modelo. Qualquer coisa fora do formato → null (o chamador usa a lista).
 * O modelo responde 3 perguntas simples sobre a MENSAGEM ATUAL; quem junta as respostas é o
 * código. A conversa de programação em andamento (que inclui o disparo das últimas 24h, fora do
 * histórico) também é conferida aqui, não pelo modelo: com ela, "vaga" sem tipo é vaga de curso.
 * Primeira versão (um campo só, com o modelo decidindo tudo) errou no replay de 03/11: "Vagas de
 * emprego" virou vaga ambígua e "ok"/"só isso" depois de conversa de emprego viraram emprego. */
/** Trava do caso misto: a "outra pergunta" que ainda e de emprego (tem termo claro de emprego, ou
 * e praticamente a mensagem inteira) nao e outra pergunta — no replay de 03/11 o modelo devolveu,
 * por exemplo, "o que e o cuca emprega+?" como outra pergunta da propria mensagem. */
export function outraPerguntaAindaEEmprego(outra: string, texto: string): boolean {
  if (classificarPerguntaEmprego(outra, "Institucional", false) !== null && classificarPerguntaEmprego(outra, "Institucional", false) !== "vagas_ambiguo") return true;
  if (/\bempregabilidade\b|\bvagas?\b|\boportunidades?\b|\bcandidat|\bprocesso seletivo\b|\bcontrat/.test(normalizarTextoIntencao(outra))) return true;
  const palavras = (t: string) => new Set(normalizarTextoIntencao(t).replace(/[^a-z0-9 ]/g, " ").split(" ").filter((p) => p.length >= 3));
  const daOutra = palavras(outra);
  const doTexto = palavras(texto);
  if (daOutra.size === 0) return true;
  const comuns = [...daOutra].filter((p) => doTexto.has(p)).length;
  return comuns === daOutra.size && daOutra.size >= doTexto.size * 0.8;
}

export function validarClassificacaoEmpregoModelo(data: unknown, conversaEmProgramacao: boolean, texto = ""): Omit<ResultadoEmprego, "fonte"> | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (typeof d.fala_de_emprego !== "boolean" || typeof d.vaga_sem_tipo !== "boolean") return null;
  const outra = typeof d.outra_pergunta === "string" ? d.outra_pergunta.trim().slice(0, OUTRA_PERGUNTA_MAX) : "";
  if (d.fala_de_emprego) {
    return outra && !outraPerguntaAindaEEmprego(outra, texto)
      ? { classificacao: "emprego_misto", outraPergunta: outra }
      : { classificacao: "emprego", outraPergunta: null };
  }
  // "emprego ou curso?" so quando a mensagem fala mesmo de vaga ("tem" sozinho nao e pergunta de vaga).
  if (d.vaga_sem_tipo && !conversaEmProgramacao && /\bvagas?\b/.test(normalizarTextoIntencao(texto))) return { classificacao: "vagas_ambiguo", outraPergunta: null };
  return { classificacao: null, outraPergunta: null };
}

export function montarPromptClassificadorEmprego(texto: string, historico: { role: string; content: string }[]): string {
  return [
    MARCADOR_CLASSIFICADOR_EMPREGO + ".",
    "Você analisa mensagens recebidas pelo WhatsApp institucional da Rede CUCA (centros de juventude da Prefeitura de Fortaleza: cursos, esportes, cultura, eventos e serviços).",
    "Assunto de EMPREGO não é atendido aqui: vai para o Emprega+, o canal de emprego da Rede CUCA.",
    "Analise SÓ a MENSAGEM ATUAL do lead. A conversa anterior serve apenas para entender o que a mensagem atual quer dizer.",
    "",
    "1) \"fala_de_emprego\": true se a MENSAGEM ATUAL pede ou fala de emprego, com qualquer jeito de falar:",
    "   emprego, trabalho remunerado, trampo, bico, freela, renda extra, estágio, jovem aprendiz, primeiro emprego, SINE; o próprio currículo ou cv (mandar, cadastrar, deixar, \"esse é meu currículo\", \"vocês têm meu currículo?\", banco de talentos); vaga de emprego ou de trabalho; vaga de um cargo (atendente, porteiro, motoboy, assistente social…); CLT, carteira assinada, processo seletivo para trabalhar; \"estão contratando?\", \"vocês contratam?\"; estar desempregado; o próprio Emprega+ ou \"empregabilidade\"; trabalhar na própria Rede CUCA (ser contratado, ser funcionário, dar aula como profissional); empresa que quer divulgar vaga ou se cadastrar como empregadora.",
    "   Também true quando a mensagem atual só completa uma conversa de emprego com conteúdo novo (ex.: depois de falar de emprego, \"para porteiro e vigilante\").",
    "   false para:",
    "   - mensagem sem conteúdo próprio: \"ok\", \"sim\", \"só isso\", \"obrigada\", \"por favor\", \"como faço?\", \"pode me ajudar?\", [Imagem enviada], [Documento enviado] — mesmo que a conversa antes fosse sobre emprego;",
    "   - curso, oficina ou atividade, mesmo com nome ligado a trabalho (\"Planilhas eletrônicas para o mercado de trabalho\", \"Currículo na Prática\", qualificação profissional);",
    "   - vaga em curso, esporte, modalidade, oficina ou turma, inclusive quando a vaga vem junto do nome da atividade ou de inscrição/matrícula (\"tem vaga na natação?\", \"vagas para CrossCuca\", \"as vagas dos cursos abrem quando?\", \"não encontro vaga para me inscrever\");",
    "   - quem cita o próprio trabalho só para explicar horário, rotina ou saúde (\"eu trabalho de dia, tem curso à noite?\", \"por causa do meu trabalho não consigo ir\", \"não estou podendo trabalhar\");",
    "   - pedido para falar com atendente ou humano;",
    "   - \"serviço\" no sentido de atendimento da Rede (psicossocial, Defensoria, saúde);",
    "   - o Programa Jovens Monitores, inclusive seleção ou edital de monitores (programa da própria Rede CUCA, respondido aqui);",
    "   - artista ou grupo que quer se apresentar ou propor atração, e proposta de parceria institucional.",
    "",
    "2) \"vaga_sem_tipo\": true só se a palavra vaga(s) está na MENSAGEM ATUAL sem dizer se é de emprego/trabalho e sem citar curso, atividade, modalidade, turma, idade, inscrição ou matrícula (ex.: \"tem vagas?\", \"vagas\", \"sobre vagas disponíveis\"). false se a conversa anterior fala de alguma atividade, curso, modalidade (natação, vôlei, judô…) ou inscrição, porque aí a vaga é dessa atividade. Se fala_de_emprego = true, vaga_sem_tipo = false.",
    "",
    "3) \"outra_pergunta\": só quando fala_de_emprego = true E a MENSAGEM ATUAL também pergunta outra coisa que NÃO é emprego (curso, atividade, endereço…): copie essa outra pergunta, com as palavras do lead, tirada da MENSAGEM ATUAL (nunca da conversa anterior). A outra pergunta NUNCA pode falar de emprego, vagas, oportunidades, currículo, estágio, Emprega+, processo seletivo ou como se candidatar — isso tudo é a parte de emprego. Cumprimento, agradecimento e pedido de contato não contam. Nos outros casos, null.",
    "",
    "Retorne SOMENTE JSON: {\"fala_de_emprego\": true|false, \"vaga_sem_tipo\": true|false, \"outra_pergunta\": string|null}",
    "",
    "Exemplos:",
    "- \"Vagas de emprego\", \"Tem emprego?\", \"tô procurando um trampo\", \"tão contratando?\", \"quero mandar meu cv\", \"como trabalho na Rede Cuca?\", \"quero cadastrar uma vaga da minha empresa\", \"como funciona o Emprega+?\" => fala_de_emprego=true, outra_pergunta=null.",
    "- \"Gostaria de saber sobre os cursos e vaga de emprego no cuca do Pici\" => fala_de_emprego=true, outra_pergunta=\"quais cursos tem no cuca do Pici?\".",
    "- \"tem curso de fotografia? se tem vaga?\", \"tem aula de muay thai? e se tem vaga\", \"criança de 7 anos tem vaga?\" => fala_de_emprego=false, vaga_sem_tipo=false.",
    "- \"tem vagas?\" sem conversa anterior => fala_de_emprego=false, vaga_sem_tipo=true.",
    "- conversa sobre emprego e agora \"obrigada\" ou \"só isso\" => fala_de_emprego=false, vaga_sem_tipo=false.",
    "- \"o que é o emprega+?\", \"como funciona essa parte de empregabilidade?\", \"quero deixar meu currículo e saber das vagas\" => fala_de_emprego=true, outra_pergunta=null.",
    "- conversa sobre natação e agora \"ainda tem vaga?\" ou \"tem\" => fala_de_emprego=false, vaga_sem_tipo=false.",
    "",
    montarContextoSessaoParaInterpretacao(historico, texto),
    "",
    "MENSAGEM ATUAL do lead: " + texto,
  ].join("\n");
}

/** Chama o modelo. Nunca lança: erro, tempo esgotado ou JSON fora do formato → null. Sem a
 * espera longa do 429 (até 10 s) de propósito: este passo roda em toda mensagem e tem reserva. */
export async function classificarEmpregoComModelo(
  texto: string,
  openaiKey: string,
  historico: { role: string; content: string }[],
  conversaEmProgramacao: boolean,
  aoConsumir?: (corpo: RespostaOpenAIUso, latenciaMs: number) => void,
): Promise<Omit<ResultadoEmprego, "fonte"> | null> {
  const inicio = Date.now();
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + openaiKey, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(CLASSIFICADOR_EMPREGO_TIMEOUT_MS),
      body: JSON.stringify({
        model: GPT_MODEL,
        temperature: 0,
        max_tokens: 120,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: montarPromptClassificadorEmprego(texto, historico) }],
      }),
    });
    if (!resp.ok) {
      console.error("[motor-agente v18] Classificador de emprego: HTTP " + resp.status + ", usando a lista de palavras");
      return null;
    }
    const corpo = await resp.json();
    if (aoConsumir && corpo?.usage) {
      try { aoConsumir(corpo, Date.now() - inicio); } catch (e) { console.error("[motor-agente v18] Falha ao preparar registro de consumo do classificador:", e); }
    }
    const resultado = validarClassificacaoEmpregoModelo(JSON.parse(corpo.choices[0].message.content), conversaEmProgramacao, texto);
    if (!resultado) console.error("[motor-agente v18] Classificador de emprego: resposta fora do formato, usando a lista de palavras");
    return resultado;
  } catch (exc) {
    console.error("[motor-agente v18] Classificador de emprego falhou, usando a lista de palavras:", exc);
    return null;
  }
}

/** Decide se a mensagem é de emprego: o modelo primeiro; a lista de palavras só se ele falhar.
 * Só Institucional/maria. Mensagem sem nenhuma letra (dígito de menu, emoji) não chama o modelo. */
export async function decidirEmprego(
  texto: string,
  agenteTipo: string,
  conversaEmProgramacao: boolean,
  classificar: () => Promise<Omit<ResultadoEmprego, "fonte"> | null>,
): Promise<ResultadoEmprego> {
  if (agenteTipo !== "Institucional" && agenteTipo !== "maria") return { classificacao: null, outraPergunta: null, fonte: "sem_chamada" };
  if (!/\p{L}/u.test(texto)) return { classificacao: null, outraPergunta: null, fonte: "sem_chamada" };
  const doModelo = await classificar();
  if (doModelo) return { ...doModelo, fonte: "modelo" };
  return { classificacao: classificarPerguntaEmprego(texto, agenteTipo, conversaEmProgramacao), outraPergunta: null, fonte: "lista" };
}

/** Caso misto: a última mensagem do lead no histórico (gravada pelo worker antes desta chamada)
 * vira só a outra pergunta, para o modelo e os classificadores não verem a parte de emprego. */
export function trocarUltimaMensagemDoLead(
  historico: { role: string; content: string }[],
  original: string,
  novoTexto: string,
): { role: string; content: string }[] {
  for (let i = historico.length - 1; i >= 0; i--) {
    if (historico[i].role !== "user") continue;
    if (historico[i].content.trim() !== original.trim()) return historico;
    return historico.map((m, j) => (j === i ? { ...m, content: novoTexto } : m));
  }
  return historico;
}

/**
 * Backlog 4a: canais da Rede CUCA fora do escopo do RAG do Institucional, pra onde a Maria
 * pode encaminhar o lead via [[ENCAMINHAR:canal]]. Lista fechada de propósito — é o que
 * `validarCanalEncaminhamento` usa pra nunca confiar cegamente no argumento que o GPT emitiu.
 */
const CANAIS_ENCAMINHAMENTO = ["empregabilidade", "acesso_cuca", "ouvidoria", "academia_enem"] as const;
export type CanalEncaminhamento = typeof CANAIS_ENCAMINHAMENTO[number];

/** Nunca confia cegamente no argumento capturado da tag — só aceita um dos 4 valores fechados
 * (mesmo princípio de `validarAvaliacaoSelecaoUnidade`: o LLM pode alucinar um canal que não
 * existe, ex. "financeiro"). */
export function validarCanalEncaminhamento(valor: string | null): CanalEncaminhamento | null {
  if (valor && (CANAIS_ENCAMINHAMENTO as readonly string[]).includes(valor)) {
    return valor as CanalEncaminhamento;
  }
  return null;
}

/**
 * Textos exatos do sócio, um por canal (tom próprio de cada um, não uma fórmula genérica
 * única). `comNumero` recebe o número JÁ SANITIZADO (só dígitos, formato wa.me/55XXXXXXXXXXX);
 * `semNumero` é o texto pros 3 canais ainda sem contato confirmado — mantém a parte que explica
 * o que o canal faz, só troca o trecho do wa.me por "em breve te passo o contato".
 */
const MENSAGENS_CANAL: Record<CanalEncaminhamento, { comNumero: (numero: string) => string; semNumero: string }> = {
  empregabilidade: {
    comNumero: (numero) =>
      "Que legal seu interesse! 😊 Pra vagas de emprego e oportunidades de trabalho, quem cuida disso é a equipe de Empregabilidade da Rede CUCA — chama eles direto no wa.me/" + numero + " que te atendem certinho!",
    semNumero:
      "Que legal seu interesse! 😊 Pra vagas de emprego e oportunidades de trabalho, quem cuida disso é a equipe de Empregabilidade da Rede CUCA — em breve te passo o contato certinho aqui — já estamos organizando esse canal!",
  },
  acesso_cuca: {
    comNumero: (numero) =>
      "Entendi! Pra reservar espaços do CUCA (salas, quadras, auditório etc.), quem cuida disso é o time de Acesso CUCA — fala com eles pelo wa.me/" + numero + " 😉 Eles vão te passar a disponibilidade certinho!",
    // S-INST-QUAL-01 (A10): o canal Acesso CUCA nao tem numero, e o texto antigo prometia um
    // contato que nao existe. Resposta da gestao (02/11): falar com a unidade, por telefone ou
    // pessoalmente. Os telefones entram pelo `montarMensagemEncaminhamento` (vindos de
    // `unidades_cuca`); este texto e o de reserva, quando a leitura dos telefones falha.
    semNumero:
      "Entendi! Pra reservar espaços do CUCA (salas, quadras, auditório etc.), é só falar direto com a unidade, por telefone ou pessoalmente 😉 Eles vão te passar a disponibilidade certinho!",
  },
  ouvidoria: {
    comNumero: (numero) =>
      "Obrigada por trazer isso. Pra registrar reclamação, sugestão ou elogio formal, o canal certo é a Ouvidoria da Rede CUCA — é só chamar no wa.me/" + numero + ", eles vão te dar atenção total.",
    semNumero:
      "Obrigada por trazer isso. Pra registrar reclamação, sugestão ou elogio formal, o canal certo é a Ouvidoria da Rede CUCA — em breve te passo o contato certinho aqui — já estamos organizando esse canal!",
  },
  academia_enem: {
    comNumero: (numero) =>
      "Oi! Pra tudo sobre a Academia Enem — inscrição, aulas, cronograma — fala direto com a equipe deles no wa.me/" + numero + " 📚 Eles vão te passar tudo certinho!",
    semNumero:
      "Oi! Pra tudo sobre a Academia Enem — inscrição, aulas, cronograma — em breve te passo o contato certinho aqui — já estamos organizando esse canal!",
  },
};

/**
 * Monta a mensagem final de encaminhamento — SEMPRE a partir de dados do código/config, NUNCA
 * do texto que o GPT gerou. É essa a garantia de segurança pedida: o GPT só sinaliza a
 * INTENÇÃO via tag; o número real (ou a ausência dele) vem exclusivamente do parâmetro
 * `numero`, buscado na tabela `configuracoes` por quem chama esta função.
 * Sanitiza `numero` pra só dígitos antes de montar o link wa.me — nunca gera "wa.me/None" nem
 * variação quebrada; se sobrar vazio depois de sanitizar (config malformada), cai no texto
 * `semNumero` da mesma forma que `numero === null`.
 */
export function montarMensagemEncaminhamento(
  canal: CanalEncaminhamento,
  numero: string | null,
  telefonesUnidades: TelefoneUnidade[] = [],
): string {
  const mensagens = MENSAGENS_CANAL[canal];
  const numeroLimpo = numero ? numero.replace(/\D/g, "") : "";
  if (numeroLimpo) return mensagens.comNumero(numeroLimpo);
  if (canal === "acesso_cuca") return montarMensagemAcessoCucaPelaUnidade(telefonesUnidades);
  return mensagens.semNumero;
}

/** S-INST-QUAL-01 (A10): telefone de uma unidade, lido de `unidades_cuca`. */
export type TelefoneUnidade = { nome: string; telefone: string | null };

/** Nome da unidade como o bot escreve ("CUCA Barra" no cadastro vira "Cuca Barra"). */
function nomeUnidadeParaTexto(nome: string): string {
  return nome.trim().replace(/^cuca\b/i, "Cuca");
}

/**
 * S-INST-QUAL-01 (A10): Acesso CUCA sem numero → falar com a unidade, com os telefones das unidades
 * montados pelo codigo (nunca pelo modelo). Ordem fixa de `UNIDADES_VALIDAS`; unidade sem telefone
 * fica de fora. Sem nenhum telefone (leitura falhou), usa o texto de reserva, que tambem manda
 * falar com a unidade.
 */
export function montarMensagemAcessoCucaPelaUnidade(telefonesUnidades: TelefoneUnidade[]): string {
  const porNome = new Map(telefonesUnidades.map((u) => [normalizarTextoIntencao(nomeUnidadeParaTexto(u.nome)), u]));
  const linhas: string[] = [];
  for (const unidade of UNIDADES_VALIDAS) {
    const registro = porNome.get(normalizarTextoIntencao(unidade));
    const telefone = (registro?.telefone ?? "").trim();
    if (telefone) linhas.push("📞 " + unidade + ": " + telefone);
  }
  if (linhas.length === 0) return MENSAGENS_CANAL.acesso_cuca.semNumero;
  return "Entendi! Pra reservar espaços do CUCA (salas, quadras, auditório etc.), é só falar direto com a unidade, por telefone ou pessoalmente 😉\n\n" +
    linhas.join("\n") + "\n\nEles vão te passar a disponibilidade certinho!";
}

/** S-INST-QUAL-01 (A10): telefones das unidades ativas. Nunca propaga erro: qualquer falha vira
 * lista vazia, e o texto de reserva continua mandando falar com a unidade. */
async function buscarTelefonesUnidades(supabase: ReturnType<typeof createClient<Database>>): Promise<TelefoneUnidade[]> {
  try {
    const { data, error } = await supabase.from("unidades_cuca").select("nome,telefone").eq("ativo", true);
    if (error || !Array.isArray(data)) return [];
    return (data as { nome?: unknown; telefone?: unknown }[])
      .filter((u) => typeof u.nome === "string")
      .map((u) => ({ nome: u.nome as string, telefone: typeof u.telefone === "string" ? u.telefone : null }));
  } catch (exc) {
    console.error("[motor-agente v18] buscarTelefonesUnidades erro, segue sem telefones:", exc);
    return [];
  }
}

/** Busca os 4 números de encaminhamento em `configuracoes` (chave='numeros_canais_cuca').
 * Nunca propaga exceção — linha ausente, JSON malformado ou erro de rede caem no default
 * seguro (todos os canais null), que `montarMensagemEncaminhamento` já trata sem número. */
async function buscarNumeroCanal(
  supabase: ReturnType<typeof createClient<Database>>,
  canal: CanalEncaminhamento,
): Promise<string | null> {
  try {
    const { data } = await supabase.from("configuracoes").select("valor").eq("chave", "numeros_canais_cuca").single();
    const numeros = (data?.valor ?? {}) as Record<string, unknown>;
    const numero = numeros[canal];
    return typeof numero === "string" && numero.length > 0 ? numero : null;
  } catch (exc) {
    console.error("[motor-agente v18] buscarNumeroCanal erro, fallback sem número:", exc);
    return null;
  }
}

/**
 * Testa se `chave` aparece em `texto` como palavra inteira (n\u00e3o substring solta, ex.: "barra"
 * em "barra de chocolate"). Exce\u00e7\u00e3o (AUD-05): quando `chave` \u00e9 um d\u00edgito 1-5 (as chaves
 * num\u00e9ricas de UNIDADES_MAP), um d\u00edgito solto em qualquer parte da frase ("...maiores de 3
 * anos?") n\u00e3o pode contar como escolha de unidade \u2014 s\u00f3 conta quando a mensagem inteira \u00e9
 * o d\u00edgito (mesmo padr\u00e3o de ehSelecaoMenu, ^[1-5]$). Nomes por extenso continuam via match de
 * palavra inteira normal.
 */
export function contemPalavra(texto: string, chave: string): boolean {
  if (/^[1-5]$/.test(chave)) return ehSelecaoMenu(texto) && texto.trim() === chave;
  return new RegExp("\\b" + escaparRegex(chave) + "\\b").test(texto);
}

/** Dist\u00e2ncia de edi\u00e7\u00e3o cl\u00e1ssica (Levenshtein) \u2014 usada s\u00f3 por contemNomeUnidadeComTypo abaixo. */
function distanciaLevenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/**
 * Item 4 (S-WM-21, VAL-06): fallback tolerante a erro de digita\u00e7\u00e3o de UM nome de unidade de
 * palavra \u00fanica (ex.: "mondubi" por "mondubim") \u2014 nunca para os d\u00edgitos 1-5 (esses continuam s\u00f3
 * via contemPalavra/ehSelecaoMenu). Compara PALAVRA A PALAVRA (split por n\u00e3o-letra, n\u00e3o
 * substring livre) com dist\u00e2ncia de edi\u00e7\u00e3o <= 1 \u2014 substring livre quebraria a prote\u00e7\u00e3o \u00a74 j\u00e1
 * testada ('barragem' n\u00e3o pode disparar Cuca Barra: "barragem".includes("barra") seria true,
 * mas a palavra inteira tem dist\u00e2ncia 3, n\u00e3o 1). Chaves curtas (<5 chars) e chaves com espa\u00e7o
 * (nomes compostos, j\u00e1 bem cobertos pelo match exato) ficam de fora do fallback \u2014 risco de
 * falso positivo alto demais pro ganho.
 */
function contemNomeUnidadeComTypo(texto: string, chave: string): boolean {
  if (chave.length < 5 || chave.includes(' ')) return false;
  const palavras = texto.split(/[^\p{L}]+/u).filter(Boolean);
  return palavras.some((p) => Math.abs(p.length - chave.length) <= 1 && distanciaLevenshtein(p, chave) <= 1);
}

/**
 * Item 4 (S-WM-21, VAL-06): pr\u00e9-filtro barato (sem custo de LLM) pra decidir quando vale a pena
 * chamar avaliarSelecaoUnidade dentro do branch de unidade j\u00e1 selecionada (handler, se\u00e7\u00e3o 5b) \u2014
 * sem isso, toda mensagem de acompanhamento normal (a maioria de uma conversa j\u00e1 em andamento,
 * com unidade escolhida) pagaria uma chamada extra \u00e0 OpenAI a cada turno. S\u00f3 dispara quando a
 * mensagem sugere inten\u00e7\u00e3o de trocar de unidade.
 */
export function pareceIntencaoTrocaUnidade(texto: string): boolean {
  const lower = texto.toLowerCase();
  // S-WM-71: plural ("unidades", "cucas") e "outras unidades/cucas" também contam. Sempre com o
  // substantivo — "tem em outro horário?" não pode virar troca de unidade.
  return /\bunidades?\b/.test(lower) || /\btrocar\b|\btroca\b|\bmudar\b/.test(lower) || /\boutr[ao]s?\s+cucas?\b|\bcucas\b/.test(lower);
}

/**
 * S-WM-71 (Item 3): pedido explícito para procurar em OUTRAS unidades, sem dizer qual
 * ("procure em outras unidades", "tem nos outros cucas?", "em quais unidades tem?"). Sempre com o
 * substantivo unidade/cuca — "outro horário" não conta.
 */
export function pedeOutrasUnidades(texto: string): boolean {
  const lower = normalizarTexto(texto);
  // Hotfix 05/11/2026: "em outra rede cuca?" / "em outra rede?" (caso real da Glória) também conta.
  return /\b(outr[ao]s?|demais)\s+(redes?\s+)?(unidades?|cucas?|redes?)\b/.test(lower) || /\b(em|nas|de)\s+quais\s+(unidades|cucas)\b/.test(lower);
}

/** Detecta se a mensagem menciona uma unidade diferente da atual */
export function detectarTrocaUnidade(texto: string, unidadeAtual: string): string | null {
  const lower = texto.toLowerCase().trim();
  for (const [chave, unidade] of Object.entries(NOMES_UNIDADES_POR_PALAVRA)) {
    if (contemPalavra(lower, chave) && unidade !== unidadeAtual) {
      return unidade;
    }
  }
  // Item 4 (S-WM-21): s\u00f3 entra se nenhum match exato foi encontrado acima.
  for (const [chave, unidade] of Object.entries(NOMES_UNIDADES_POR_PALAVRA)) {
    if (contemNomeUnidadeComTypo(lower, chave) && unidade !== unidadeAtual) {
      return unidade;
    }
  }
  return null;
}

/**
 * S-WM-34 (VAL-09): normaliza acento e caixa pra compara\u00e7\u00e3o determin\u00edstica de texto \u2014 Postgres
 * n\u00e3o tem a extens\u00e3o `unaccent` instalada neste banco (confirmado via `pg_extension` antes desta
 * story) e `ilike` n\u00e3o trata acento sozinho, ent\u00e3o "natacao" (sem cedilha) n\u00e3o bateria com
 * "Nata\u00e7\u00e3o" sem essa normaliza\u00e7\u00e3o acontecer aqui, em TS.
 */
export function normalizarTexto(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/**
 * S-WM-34 (VAL-09): extrai os nomes de modalidade j\u00e1 presentes no texto indexado do
 * `monthly_program` \u2014 padr\u00e3o "Modalidade: X - Turma", confirmado em produ\u00e7\u00e3o como o formato
 * usado em toda a se\u00e7\u00e3o "== ESPORTES ==" (ex.: "Esporte Modalidade: Nata\u00e7\u00e3o - Turma Turma 11").
 * N\u00e3o inventa nem hardcoda nomes de atividade \u2014 o vocabul\u00e1rio vem inteiramente do texto real j\u00e1
 * indexado pra aquela unidade (Constitution Art. IV, No Invention).
 */
export function extrairModalidades(chunks: string[]): string[] {
  const nomes = new Set<string>();
  const regexEsporte = /Modalidade:\s*([^-]+?)\s*-\s*Turma/g;
  const regexCurso = /Curso:\s*([^.]+?)\.\s*Educador:/g;
  for (const conteudo of chunks) {
    for (const match of conteudo.matchAll(regexEsporte)) {
      const nome = match[1].trim();
      if (nome) nomes.add(nome);
    }
    for (const match of conteudo.matchAll(regexCurso)) {
      const nome = match[1].trim();
      if (nome) nomes.add(nome);
    }
  }
  return [...nomes];
}

/**
 * S-WM-34 (VAL-09): detecta se a mensagem do lead cita alguma modalidade conhecida do
 * `monthly_program` ativo da unidade. Ordena por tamanho decrescente antes de comparar pra
 * nomes mais espec\u00edficos ("Futsal Sesc") n\u00e3o perderem pra um prefixo mais gen\u00e9rico que tamb\u00e9m
 * seja um nome v\u00e1lido ("Futsal") quando ambos aparecem na lista de modalidades.
 */
/**
 * Plano 001 (auditoria de conversas 09-10/09/2026): `normalizarTexto` remove acento mas PRESERVA
 * pontuação — "hidro-ginastica" (hífen digitado pelo lead) não batia contra "HIDROGINÁSTICA"
 * (título cadastrado, sem hífen), e o bot negou em produção que o Pici tem hidroginástica (tem,
 * 11 turmas cadastradas). Mesmo bug confirmado numa 2ª conversa real com "Muay -Thai" (hífen
 * sujo vindo da planilha de origem).
 * Normalizador SEPARADO de `normalizarTexto` de propósito: aquele é usado em ~15 outros pontos
 * do arquivo pra fins diferentes (nome de unidade, faixa etária) que não foram avaliados aqui.
 * O colapso de espaço NÃO estava no plano e foi acrescentado por necessidade: ao trocar "/" por
 * espaço, um título real como "HIDROGINÁSTICA/ ESCOLA DE SAÚDE" viraria "hidroginastica  escola
 * de saude" (espaço duplo) e deixaria de casar com a mesma frase digitada sem a barra.
 */
export function normalizarParaMatchDeAtividade(texto: string): string {
  return normalizarTexto(texto).replace(/[-_/]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Plano 001, forma COMPACTA — usada só nas comparações de substring (Fases 1 e 2 de
 * `detectarAtividadeMencionada`). Remove tudo que não é letra/dígito, inclusive espaço.
 * Duas formas são necessárias porque os dois sentidos do erro existem no dado real e se
 * contradizem se houver só uma:
 *   - lead digita hífen onde o título não tem: "hidro-ginastica" x "HIDROGINÁSTICA";
 *   - título tem hífen onde o lead digita espaço: "Muay -Thai" x "muay thai".
 * Trocar pontuação por espaço resolve só o 2º caso; remover pontuação resolve só o 1º. Comparar
 * sem espaço nenhum resolve os dois ("hidroginastica", "muaythai" dos dois lados).
 * A forma COM espaço continua sendo a usada pelo guard base/variante (que precisa enxergar o
 * separador de palavra) e pelo match por palavra inteira da Fase 3.
 */
function compactarParaMatchDeAtividade(texto: string): string {
  return normalizarParaMatchDeAtividade(texto).replace(/[^a-z0-9]/g, "");
}

/**
 * Plano 009 (varredura sistêmica do catálogo real — 15 pares base/variante confirmados nas 3
 * unidades ativas em 2026-09-11): quando a unidade tem uma atividade "base" ("NATAÇÃO") E uma
 * variante mais específica ("NATAÇÃO INFANTIL"), uma pergunta que cita só a palavra base
 * resolvia SILENCIOSAMENTE pra base — devolvendo turma/professor/faixa etária de uma atividade
 * possivelmente diferente da perguntada, com confiança total. Preferir `null` (o fallback seguro
 * que qualquer título desconhecido já tem hoje) a arriscar a atividade errada.
 * O separador de palavra logo após o prefixo comum evita falso positivo do tipo "judo" ser
 * prefixo de "judoca" — palavra diferente colada, não uma variante qualificada.
 */
function ehBaseDeVarianteMaisEspecifica(modalidadeNorm: string, todasNormalizadas: string[]): boolean {
  if (!modalidadeNorm) return false;
  return todasNormalizadas.some((outraNorm) => {
    if (outraNorm === modalidadeNorm) return false;
    if (outraNorm.length <= modalidadeNorm.length) return false;
    if (!outraNorm.startsWith(modalidadeNorm)) return false;
    return !/[a-z0-9]/.test(outraNorm[modalidadeNorm.length]);
  });
}

/**
 * Plano 005: mensagem que cita só a 1ª palavra de um título composto ("violão" pra "Violão para
 * Iniciantes") não batia em nenhuma das condições de substring — nem a mensagem contém o título
 * inteiro, nem o título contém a mensagem inteira. Último recurso, e conservador: só resolve
 * quando EXATAMENTE 1 modalidade bate pela palavra significativa; 0 ou 2+ devolvem `null`
 * (ex.: "Violão para Iniciantes" e "Violão Fácil" na mesma unidade — nunca adivinha).
 * Compara por palavra inteira (`\b`), não substring solta — "vela" não pode casar "novela".
 */
/**
 * @qa FAIL-2 (gate S-WM-AUD-002): `normalizarParaMatchDeAtividade` remove só `-_/`, então o resto
 * da pontuação sobrevivia grudado na palavra — `"Dança: Integração"` virava `"danca:"` e
 * `"(Oficina) Canva..."` virava `"(oficina)"`, palavras que NUNCA casam `\bdanca\b`/`\boficina\b`.
 * Efeito duplo: o guard de ambiguidade enxergava 1 candidato onde havia 2+ (falsa unicidade), E o
 * próprio caso principal do Plano 005 falhava nesses títulos. Limpar aqui conserta os dois.
 */
function primeiraPalavraSignificativa(modalidadeNorm: string): string | null {
  return modalidadeNorm
    .split(" ")
    .map((palavra) => palavra.replace(/[^a-z0-9]/g, ""))
    .find((palavra) => palavra.length >= 4 && !PALAVRAS_NAO_DISCRIMINANTES.has(palavra)) ?? null;
}

/**
 * @qa FAIL-1 (gate S-WM-AUD-002): a Fase 3 casa a 1ª palavra do título contra a mensagem — e
 * títulos reais começam com palavras comuns do português. Medido contra o catálogo real das 5
 * unidades: 28 de 85 frases genéricas resolviam pra uma atividade. O caso mais grave era
 * `"Hora Pintada"` (existe em 4 das 5 unidades): `"qual a hora?"` resolvia pra ela com
 * `origem=mensagem_atual`, **sequestrando a mensagem antes de a continuação do Plano 003 rodar** —
 * o bot respondia sobre a oficina "Hora Pintada" a quem perguntou o horário da natação. Mesmo
 * padrão do achado 009, reintroduzido por outra porta.
 *
 * Esta lista NÃO é um dicionário de stopwords do português: é o conjunto fechado de palavras que
 * (a) são vocabulário de ATRIBUTO do Plano 003 — o conflito direto — ou (b) são verbo/saudação de
 * conversa comum. Uma palavra aqui só deixa de servir como GATILHO da Fase 3; o título que começa
 * com ela continua sendo encontrado normalmente pelas Fases 1 e 2 quando citado de verdade
 * (ex.: "Venha Jogar" citado por inteiro resolve na Fase 1).
 * Não é exaustiva por construção — a bateria de frases genéricas em `index.test.ts` é o que
 * protege contra a próxima palavra problemática aparecer num título novo.
 *
 * ATENÇÃO (@qa Revisão 2) — comportamento não óbvio: quando a 1ª palavra é descartada,
 * `primeiraPalavraSignificativa` NÃO descarta o título — ela avança para a PRÓXIMA palavra, que
 * pode ser igualmente comum. Foi assim que "Venha Jogar" (com "venha" na lista) passou a ser
 * disparada por "jogar". Ao acrescentar palavra aqui, confira qual vira o novo gatilho do título.
 */
const PALAVRAS_NAO_DISCRIMINANTES = new Set([
  // (a) vocabulário de atributo — colide de frente com o Plano 003
  "hora", "horas", "horario", "horarios", "dia", "dias", "professor", "professora",
  "educador", "educadora", "idade", "publico", "turma", "turmas", "vaga", "vagas",
  "aula", "aulas", "horarios",
  // (b) verbo/saudação de conversa comum
  "venha", "vamos", "quero", "queria", "gostaria", "preciso", "tudo", "bom", "boa",
  // @qa Revisao 2: "Venha Jogar" tem "venha" descartada, entao o gatilho migrou pra "jogar" —
  // "quero jogar bola" resolvia pra ela em 4 unidades. Verbo comum, mesmo caso de "venha".
  "jogar",
  "onde", "quando", "como", "qual", "quais", "para", "pela", "pelo", "sobre", "tem",
]);

function detectarPorPalavraUnicaSemAmbiguidade(msgNorm: string, modalidades: string[], normalizadas: string[]): DeteccaoAtividade {
  const candidatos = new Set<string>();
  for (let i = 0; i < modalidades.length; i++) {
    const palavra = primeiraPalavraSignificativa(normalizadas[i]);
    if (!palavra) continue;
    if (new RegExp("\\b" + escaparRegex(palavra) + "\\b").test(msgNorm)) candidatos.add(modalidades[i]);
  }
  if (candidatos.size === 1) return { atividade: [...candidatos][0], ambigua: false };
  return { atividade: null, ambigua: candidatos.size > 1 };
}

/** S-INST-QUAL-03: além da atividade, diz se o `null` foi por ambiguidade (2+ títulos casaram). */
export type DeteccaoAtividade = { atividade: string | null; ambigua: boolean };

export function detectarAtividadeMencionada(mensagem: string, modalidades: string[]): string | null {
  return detectarAtividadeComDiagnostico(mensagem, modalidades).atividade;
}

/** S-INST-QUAL-03: mesma lógica de `detectarAtividadeMencionada` (que só repassa `atividade`),
 * dizendo também se o `null` foi "não achei" ou "ambíguo". Só registro; quem trata a
 * ambiguidade é a S-INST-QUAL-06. */
export function detectarAtividadeComDiagnostico(mensagem: string, modalidades: string[]): DeteccaoAtividade {
  const msgNorm = normalizarParaMatchDeAtividade(mensagem);
  if (!msgNorm) return { atividade: null, ambigua: false };
  const msgCompacta = compactarParaMatchDeAtividade(mensagem);
  const normalizadas = modalidades.map((m) => normalizarParaMatchDeAtividade(m));
  const compactas = modalidades.map((m) => compactarParaMatchDeAtividade(m));

  // Fase 1 — o título aparece por inteiro dentro da mensagem. Do mais específico pro mais
  // genérico, pra "Futsal Sesc" não perder pro prefixo "Futsal" quando os dois existem.
  const porTamanho = modalidades.map((_, i) => i).sort((a, b) => compactas[b].length - compactas[a].length);
  for (const i of porTamanho) {
    if (!compactas[i]) continue;
    if (!msgCompacta.includes(compactas[i])) continue;
    if (ehBaseDeVarianteMaisEspecifica(normalizadas[i], normalizadas)) continue; // Plano 009
    return { atividade: modalidades[i], ambigua: false };
  }

  // Fase 2 — a mensagem inteira é um TRECHO de um título (achado 2026-08-09: curso tem nome
  // longo e o lead cita um pedaço, ex.: "Fotografia" pra "FUNDAMENTOS DA FOTOGRAFIA: ...").
  // Guarda de tamanho mínimo (4) evita casar palavra trivial ("de", "a", "no").
  //
  // AMPLIAÇÃO DO PLANO 009 — furo encontrado na implementação, NÃO previsto no plano: o plano
  // só protegia a Fase 1. Uma mensagem que é exatamente a palavra base (o lead digitando só
  // "natação") entrava por aqui e resolvia pra "NATAÇÃO INFANTIL" — o título mais longo é
  // tentado primeiro e contém a base — que é exatamente o bug que o plano quer impedir. O teste
  // proposto no plano usa frase longa e por isso não pegava esse caminho.
  // Correção: só resolve quando UM ÚNICO título contém o trecho; 2+ é ambiguidade real → null.
  if (msgCompacta.length >= 4) {
    const contendoOTrecho = [...new Set(modalidades.filter((_, i) => compactas[i].includes(msgCompacta)))];
    if (contendoOTrecho.length === 1) return { atividade: contendoOTrecho[0], ambigua: false };
    if (contendoOTrecho.length > 1) return { atividade: null, ambigua: true };
  }

  // Fase 3 — Plano 005, último recurso por palavra significativa única.
  return detectarPorPalavraUnicaSemAmbiguidade(msgNorm, modalidades, normalizadas);
}

/**
 * S-WM-35 follow-up: perguntas elípticas de troca/resolução de unidade ("e no Jangurussu?",
 * "Pici", "e lá?") podem carregar a modalidade no histórico, não na mensagem atual. O motor
 * tenta a mensagem atual primeiro; só usa histórico recente de LEAD quando a atual parece uma
 * continuação curta. Se encontrar mais de uma atividade distinta no histórico, não chuta:
 * retorna null e preserva o fallback seguro atual (visão geral/busca vetorial).
 */
export function mensagemPareceContinuacaoDeAtividade(texto: string): boolean {
  const norm = normalizarTexto(texto).trim();
  if (!norm) return false;
  if (/\b(quais|qual|lista|listar|mostra|mostrar|manda|enviar|ver)\b.*\b(atividades|programacao|cursos|oficinas|modalidades|opcoes)\b/.test(norm)) return false;
  if (/\b(longe|perto|proxim[ao]s?|distancia|distante|bairro|endereco|localizacao|chegar|fica)\b/.test(norm)) return false;
  if (/^(e\s+)?(la|ai|nessa unidade|nessa cuca|nesse cuca)\??$/.test(norm)) return true;
  if (/^(e\s+)?(no|na|em|do|da|o|a)\s+[\p{L}\s0-9]+[?!.\s]*$/u.test(norm) && norm.split(/\s+/).length <= 6) return true;
  // Plano 003 (auditoria + confirmação de campo, caso Claudiana/48bbf2f2, 10/09): pergunta curta
  // sobre um ATRIBUTO da atividade recém-discutida ("qual horário", "que horas", "quais os
  // dias", "quem é o professor") não cita o nome da modalidade e não batia em nenhum padrão
  // acima — resolverAtividadeMencionadaComHistorico nunca olhava o histórico e o bot dizia "não
  // encontrei" com o dado disponível (Voleibol na Barra tinha horário cadastrado).
  // Os dois guards de cima continuam tendo precedência: "quais atividades tem no Jangurussu?"
  // (pedido amplo) e "o Pici fica longe?" (localização) já retornaram false antes de chegar aqui.
  if (/^(qual|quais|que)\s+(e\s+)?(o\s+|a\s+|os\s+|as\s+)?(horario|horarios|hora|horas|dia|dias|professor|professora|educador|educadora|idade|faixa etaria|publico)\b/.test(norm)) return true;
  // "quem e o professor?" / "quem da a aula?" — variante com pronome interrogativo diferente,
  // não coberta pela regex acima (que exige qual/quais/que no início).
  if (/^quem\s+(e\s+)?(o\s+|a\s+)?(professor|professora|educador|educadora|da a aula|ministra|ensina)\b/.test(norm)) return true;
  // Mensagem de uma palavra só ("horario?", "dias?") — o lead responde telegraficamente.
  if (/^(horario|horarios|hora|horas|dias?|professor|professora)[?!.\s]*$/.test(norm)) return true;
  // S-WM-AUD-010 (CONCERN-5): mensagem de elegibilidade ("meu filho tem 15 anos", "tenho 12")
  // qualifica a atividade do turno anterior sem nomeá-la. Sem isso, o histórico nunca era
  // consultado e o turno caía na busca vetorial com um embedding que não tem relação semântica
  // nenhuma com a modalidade — condição que produziu o Plano 010.
  if (extrairIdadeDaMensagem(texto) !== null) return true;
  // "para criança", "é para adulto?" — elegibilidade sem número
  if (/\b(para|pra|e para|e pra)\s+(crianca|criancas|adolescente|adolescentes|adulto|adultos|idoso|idosos)\b/.test(norm)) return true;
  return false;
}

/**
 * S-WM-AUD-010 (CONCERN-4): mensagem composta SÓ de um qualificador. Cenário real levantado pelo
 * Junior: lead digita "natação" e, no turno seguinte, só "infantil".
 *
 * Hoje isso é um bug grave, da mesma família do achado 009. A janela de debounce do worker NÃO
 * concatena — ela descarta: cada mensagem cancela o dispatch anterior e só a última vira
 * `textoFinal`. Então o motor-agente recebe "infantil" sozinho, tenta casar contra o catálogo, e
 * em Jangurussu resolvia pra "Ballet Infantil" — o lead pergunta de natação e recebe ballet.
 *
 * O qualificador NUNCA pode ser casado sozinho contra o catálogo. Ele só faz sentido colado à
 * atividade do turno anterior: "natação" + "infantil" → "NATAÇÃO INFANTIL" (caminho que já
 * funciona quando o lead escreve tudo junto).
 *
 * Lista fechada de propósito: são os qualificadores que aparecem nos títulos reais das 5 unidades
 * (INFANTIL, SELEÇÃO, INICIANTE, PARALIMPICA, VIVER +, FEMININO, INFANTO JUVENIL, BABY CLASS).
 * Acrescentar aqui exige acrescentar caso na bateria de testes — o mesmo contrato de
 * PALAVRAS_NAO_DISCRIMINANTES.
 */
const QUALIFICADORES_DE_ATIVIDADE = [
  "infantil", "infantis", "infanto juvenil", "infanto-juvenil", "baby", "baby class",
  "adulto", "adultos", "iniciante", "iniciantes", "avancado", "avancada",
  "selecao", "paralimpica", "paralimpico", "feminino", "feminina", "masculino", "masculina",
  "viver +", "viver mais", "intermediario", "intermediaria", "sesc", "integracao",
];

/** `true` só quando a mensagem INTEIRA é o qualificador (com pontuação/artigo trivial em volta) —
 * nunca quando ele aparece no meio de uma frase maior, que já é caso das Fases 1/2. */
export function ehQualificadorSozinho(texto: string): string | null {
  const norm = normalizarParaMatchDeAtividade(texto)
    .replace(/[?!.,;]/g, " ")
    .replace(/^(e|o|a|os|as|de|do|da|pra|para|tem|quero|queria)\s+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!norm) return null;
  return QUALIFICADORES_DE_ATIVIDADE.includes(norm) ? norm : null;
}

/**
 * S-WM-AUD-010: procura, no histórico recente do lead, a atividade que o qualificador está
 * qualificando, e resolve a CONCATENAÇÃO contra o catálogo. Devolve `null` — nunca a atividade
 * base nem o qualificador solto — quando a concatenação não existe no catálogo daquela unidade.
 * Ex.: lead falou de natação e diz "infantil" numa unidade sem natação infantil → `null` e o
 * fallback seguro, em vez de oferecer outra coisa com "infantil" no nome.
 */
function resolverQualificadorContraHistorico(
  qualificador: string,
  atividadesConhecidas: string[],
  historico: { role: string; content: string }[],
  mensagemAtual: string,
): string | null {
  const mensagensLead = [...historico]
    .reverse()
    .filter((m) => m.role === "user" && m.content.trim() !== "" && m.content.trim() !== mensagemAtual.trim())
    .slice(0, 5);

  for (const msg of mensagensLead) {
    // Base mencionada no turno anterior. Aqui interessa a BASE, mesmo que ela tenha variantes —
    // o guard do Plano 009 devolveria null justamente porque existe variante, e é exatamente a
    // variante que o lead está pedindo agora. Por isso a busca é direta, contra o texto.
    for (const base of [...atividadesConhecidas].sort((a, b) => b.length - a.length)) {
      const baseNorm = normalizarParaMatchDeAtividade(base);
      if (!baseNorm) continue;
      if (!normalizarParaMatchDeAtividade(msg.content).includes(baseNorm)) continue;
      const combinada = detectarAtividadeMencionada(base + " " + qualificador, atividadesConhecidas);
      if (combinada && normalizarParaMatchDeAtividade(combinada) !== baseNorm) return combinada;
      // Achou a base no histórico mas a variante não existe no catálogo: não tenta outra base,
      // e não devolve a base — o lead pediu a variante, não a geral.
      return null;
    }
  }
  return null;
}

/**
 * S-WM-AUD-010 (CONCERN-5): extrai a idade de uma mensagem de elegibilidade — "meu filho tem 15
 * anos", "tenho 12", "ela tem 9 aninhos". Devolve `null` quando não há idade clara: o chamador
 * trata isso como "não filtrar", nunca como "filtrar por zero".
 * Guarda de faixa plausível (1-120) porque "tem 2026" (ano) e "turma 15" não são idade.
 */
export function extrairIdadeDaMensagem(texto: string): number | null {
  const norm = normalizarTexto(texto);
  const plausivel = (n: number): number | null => (n >= 1 && n <= 120 ? n : null);

  // Caminho 1 — a palavra "anos" é o sinal forte. O lookbehind descarta expressão de TEMPO
  // DECORRIDO ("faço natação há 2 anos", "faz 3 anos que treino"), que tem "anos" mas não é
  // idade — achado meu ao revisar, não estava na bateria do @qa.
  const comAnos = norm.match(/(?<!\b(?:ha|faz|desde|por|durante)\s{1,3})\b(\d{1,3})\s*(?:anos?|aninhos?)\b/);
  if (comAnos) return plausivel(Number(comAnos[1]));

  // Caminho 2 — sem a palavra "anos", exige o VERBO adjacente ao número.
  // @qa FAIL (gate S-WM-AUD-010): a versão anterior aceitava o pronome solto com até 20
  // caracteres até o número, e 8 de 10 frases comuns viravam idade — "eu quero 2 vagas" -> 2,
  // "eu quero a turma 3" -> 3, "ela custa 50 reais" -> 50. Pior: a idade falsa CASAVA com uma
  // turma real (Ballet Baby Class, "2 á 4 anos") e as turmas infantil e adulta sumiam da
  // resposta. Nenhuma das duas redes de segurança pega esse caso, porque uma turma aceita.
  // Esconder turma do cidadão é o pior erro possível aqui — e a versão anterior fazia
  // exatamente isso, contrariando o que este próprio comentário promete.
  const comVerbo = norm.match(
    /\b(?:filho|filha|neto|neta|sobrinho|sobrinha|crianca|menino|menina|ele|ela)\s+(?:tem|faz|vai fazer|completou|fez)\s+(\d{1,3})\b(?!\s*(?:filhos?|filhas?|vagas?|turmas?|pessoas?|reais|irmaos?|meses|quadras?|minutos?|horas?))/,
  );
  if (comVerbo) return plausivel(Number(comVerbo[1]));

  // "tenho 12" — 1ª pessoa, mesmo rigor.
  const primeiraPessoa = norm.match(
    /\btenho\s+(\d{1,3})\b(?!\s*(?:filhos?|filhas?|vagas?|turmas?|pessoas?|reais|irmaos?|meses|quadras?|minutos?|horas?))/,
  );
  if (primeiraPessoa) return plausivel(Number(primeiraPessoa[1]));

  return null;
}

/**
 * S-WM-AUD-010 (CONCERN-5): a idade cabe na faixa etária cadastrada?
 *
 * Devolve `null` — "não sei dizer" — sempre que não consegue interpretar com segurança, e o
 * chamador traduz isso como NÃO FILTRAR. A assimetria é deliberada: `faixa_etaria` é texto livre
 * digitado por pessoas ("15 a 29 e 29+", "8 a 14", "a partir de 15 anos"), e o pior resultado
 * possível seria esconder do cidadão uma turma que ele poderia fazer. Errar para "mostro demais"
 * é recuperável; errar para "escondi" não é.
 */
export function faixaAceitaIdade(faixa: unknown, idade: number): boolean | null {
  if (typeof faixa !== "string") return null;
  const norm = normalizarTexto(faixa).trim();
  if (!norm || norm === "nao informado") return null;

  // O "+" de teto aberto aparece em 4 grafias no dado real: "29+", "29+ anos", "29 anos +" e
  // "15 a 29 e 29+". O `(?:anos?)?` no meio cobre as duas últimas — sem ele, "15 a 29 anos +"
  // perdia o teto aberto e um adulto de 35 seria filtrado PRA FORA da turma dele.
  const aPartirDe = norm.match(/(?:a partir de|acima de|maiores de)\s*(\d{1,3})/) ?? norm.match(/\b(\d{1,3})\s*(?:anos?)?\s*\+/);
  const intervalo = norm.match(/\b(\d{1,3})\s*(?:a|ate|-)\s*(\d{1,3})\b/);

  if (intervalo) {
    const de = Number(intervalo[1]);
    const ate = Number(intervalo[2]);
    if (de > ate) return null;
    if (idade >= de && idade <= ate) return true;
    // "15 a 29 e 29+" — intervalo E teto aberto; o aberto pode salvar quem passou do topo
    if (aPartirDe && idade >= Number(aPartirDe[1])) return true;
    return false;
  }

  if (aPartirDe) return idade >= Number(aPartirDe[1]);

  return null;
}

/**
 * S-WM-AUD-010 (CONCERN-5): filtra turmas por idade, com duas saídas de segurança.
 *  - nenhuma linha com faixa interpretável → devolve tudo;
 *  - dá pra interpretar mas nenhuma turma aceita → devolve tudo, pro agente ter o dado real e
 *    poder dizer quais faixas existem, em vez de receber vazio e cair na busca vetorial, que é
 *    onde nasce a resposta inventada (Plano 010).
 */
export function filtrarLinhasPorIdade<T extends { metadata: Record<string, unknown> | null }>(
  linhas: T[],
  idade: number | null,
): T[] {
  if (idade === null || linhas.length === 0) return linhas;
  const compativeis = linhas.filter((l) => faixaAceitaIdade((l.metadata ?? {}).faixa_etaria, idade) === true);
  return compativeis.length > 0 ? compativeis : linhas;
}

export function resolverAtividadeMencionadaComHistorico(
  mensagemAtual: string,
  atividadesConhecidas: string[],
  historico: { role: string; content: string }[] = [],
): { atividade: string | null; origem: "mensagem_atual" | "historico" | null } {
  const { atividade, origem } = resolverAtividadeComDiagnostico(mensagemAtual, atividadesConhecidas, historico);
  return { atividade, origem };
}

/** S-INST-QUAL-03: mesma lógica de `resolverAtividadeMencionadaComHistorico` (que só repassa
 * `atividade` e `origem`), dizendo também se o `null` veio de ambiguidade — 2+ títulos na
 * mensagem atual, ou 2+ atividades distintas no histórico recente. Só registro. */
export function resolverAtividadeComDiagnostico(
  mensagemAtual: string,
  atividadesConhecidas: string[],
  historico: { role: string; content: string }[] = [],
): { atividade: string | null; origem: "mensagem_atual" | "historico" | null; ambigua: boolean } {
  // S-WM-AUD-010 (CONCERN-4): ANTES de tentar casar a mensagem atual contra o catálogo. Um
  // qualificador sozinho ("infantil") casaria com qualquer título que o contenha — foi assim que
  // "natação" seguido de "infantil" devolvia "Ballet Infantil" em Jangurussu.
  const qualificador = ehQualificadorSozinho(mensagemAtual);
  if (qualificador) {
    const combinada = resolverQualificadorContraHistorico(qualificador, atividadesConhecidas, historico, mensagemAtual);
    return combinada ? { atividade: combinada, origem: "historico", ambigua: false } : { atividade: null, origem: null, ambigua: false };
  }

  const deteccaoAtual = detectarAtividadeComDiagnostico(mensagemAtual, atividadesConhecidas);
  if (deteccaoAtual.atividade) return { atividade: deteccaoAtual.atividade, origem: "mensagem_atual", ambigua: false };
  if (!mensagemPareceContinuacaoDeAtividade(mensagemAtual)) return { atividade: null, origem: null, ambigua: deteccaoAtual.ambigua };

  const encontradas = new Map<string, string>();
  const mensagensUsuarioRecentes = [...historico]
    .reverse()
    .filter((m) => m.role === "user" && m.content.trim() !== "" && m.content.trim() !== mensagemAtual.trim())
    .slice(0, 5);

  for (const msg of mensagensUsuarioRecentes) {
    const atividade = detectarAtividadeMencionada(msg.content, atividadesConhecidas);
    if (atividade) encontradas.set(normalizarTexto(atividade), atividade);
  }

  if (encontradas.size === 1) return { atividade: [...encontradas.values()][0], origem: "historico", ambigua: false };
  return { atividade: null, origem: null, ambigua: deteccaoAtual.ambigua || encontradas.size > 1 };
}

/**
 * S-WM-34 (VAL-23): sinal barato (sem chamada de LLM) de que a mensagem que citou o nome de uma
 * unidade CUCA tambem carrega um pedido especifico junto - nao e so o nome da unidade sozinho
 * nem uma frase vaga tipo "quero saber do Mondubim agora". Usado no caminho detectarTrocaUnidade
 * (branch unidadeSalva, sem avaliacao semantica por design/custo, mesmo espirito de
 * pareceIntencaoTrocaUnidade) e em qualquer resolucao de unidade por match DIRETO (nome/digito)
 * nas outras 3 rotas de decisao - nesses casos avaliarSelecaoUnidade nunca roda, entao
 * pedido_depende_unidade nunca e calculado de verdade, e este e o "sinal equivalente" que
 * substitui ele.
 * Decisao registrada no Dev Agent Record da S-WM-34 (Task 3): heuristica deliberadamente
 * conservadora - so a presenca de "?" conta como pedido especifico. Um limiar por tamanho de
 * texto sobrando (depois de remover o nome da unidade) foi tentado durante a implementacao e
 * descartado: classificava incorretamente frases vagas e longas ("quero saber do Mondubim
 * agora") como pedido especifico - falso positivo, o pior tipo de erro aqui, porque troca o
 * comportamento so (resumo geral) por um pior (resumo suprimido sem pedido real pra responder).
 * "?" sozinho cobre o cenario reproduzido ao vivo sem esse risco. Mensagens sem "?" mas com
 * pedido especifico de verdade (ex.: "manda os horarios de natacao no Mondubim") continuam
 * recebendo o resumo geral atual - sem regressao em relacao a hoje, so ainda sem a melhoria
 * (limitacao conhecida, registrada, nao um bug desta story).
 */
export function mensagemTemPedidoEspecifico(texto: string): boolean {
  return /\?/.test(texto);
}

/**
 * S-WM-35 (Frente C): formata uma linha de `atividades_mensais.metadata`
 * no mesmo template usado na importação/criação (`import-planilha-modal.tsx`/
 * `criar-programacao-modal.tsx`: "Esporte Modalidade: X - Turma Y. Professor: ...") — dado
 * estruturado direto da tabela-fonte, sem depender do texto já chunkeado/embeddado.
 * Guarda o gap conhecido (S-WM-35, Achado 2, Frente B1): em 4 das 5 unidades (Barra,
 * Jangurussu, Mondubim, Pici), `faixa_etaria` está sistematicamente gravado como o próprio
 * `titulo` da modalidade (nunca uma faixa etária real) — confirmado 558/558 linhas, gap
 * permanente na planilha de origem, não um bug do parser recuperável por remap. Repetir esse
 * valor pro usuário seria pior que omitir (dado obviamente errado, não só ausente). José
 * Walter não bate nessa condição depois da correção da Frente B3 (migration
 * `20260716000000_swm35_corrige_rotacao_metadata_jose_walter.sql`).
 * Qualquer outro campo ausente/vazio também vira "nao informado" — nunca quebra (undefined
 * vazando pro prompt) nem inventa (Constitution Art. IV).
 */
export function formatarLinhaAtividadeDeterministica(titulo: string, metadata: Record<string, unknown> | null, categoria = "ESPORTES"): string {
  const campo = (valor: unknown): string => (typeof valor === "string" && valor.trim() !== "" ? valor : "nao informado");
  const meta = metadata ?? {};
  const turma = campo(meta.turma);
  const professor = campo(meta.professor);
  const sexo = campo(meta.sexo);
  const diasSemana = campo(meta.dias_semana);
  const horario = campo(meta.horario);
  const faixaEtariaBruta = meta.faixa_etaria;
  const faixaEtaria = typeof faixaEtariaBruta === "string" && faixaEtariaBruta.trim() !== "" && normalizarTexto(faixaEtariaBruta) !== normalizarTexto(titulo)
    ? faixaEtariaBruta
    : "nao informado";
  const prefixo = normalizarTexto(categoria) === "esportes" ? "Esporte Modalidade" : "Categoria " + categoria + " - Atividade";
  // S-PROG-03 (item 2.1): "Vagas: N" saiu daqui de proposito — ver AVISO_VAGAS.
  return prefixo + ": " + titulo + " - Turma " + turma + ". Professor: " + professor + ". Publico: " + sexo + " (Idade: " + faixaEtaria + "). Dias: " + diasSemana + ". Horario: " + horario + ". " + AVISO_VAGAS;
}

/**
 * VAL-02 (docs/migracao-meta/VALIDACAO-producao-institucional.md): guardrail anti-alucinação
 * do código. Extraído para módulo (era inline em `handler`) para permitir teste automatizado
 * do texto exato — sem isso, uma regressão na regra 1 (ex.: perder o exemplo negativo abaixo)
 * não seria pega por nenhum teste. Regra 1 ganhou um exemplo negativo explícito depois que a
 * regra genérica ("NUNCA invente... nomes de professores") não impediu o GPT de inventar
 * "João Silva" como professor de Natação numa pergunta de acompanhamento (contexto vindo só da
 * busca vetorial de 5 chunks, sem o registro real do professor) — reforço de prompt, não uma
 * correção comprovada (não é testável se o GPT vai obedecer; ver relatório).
 */
export const INSTRUCAO_SEGURANCA = [
  "REGRAS OBRIGATORIAS (nao negocie estas regras):",
  "",
  // S-INST-QUAL-01 (A3): a regra antiga citava so 2 blocos e deixava de fora o texto
  // institucional e os blocos de programacao mais novos — o bot podia achar proibido usar o
  // telefone ou o endereco que estavam no contexto.
  "1. FONTES: atividades, cursos, modalidades, turmas, dias, horarios e professores so vem dos",
  "   blocos de programacao desta resposta (programacao mensal atual, programacao vigente,",
  "   programacao vigente da rede, atividade especifica com dado exato, eventos e faq, e os",
  "   trechos de contexto da programacao).",
  "   Assuntos institucionais (endereco, telefone, matricula, documentos, funcionamento, servicos)",
  "   vem do bloco de servicos da rede e do contexto de faq: use esses dados normalmente, eles",
  "   fazem parte da base.",
  "   NUNCA invente atividades, horarios, nomes de professores ou modalidades.",
  "   Exemplo do que NAO fazer: se o contexto nao trouxer o nome do professor de uma",
  "   modalidade, NUNCA gere um nome plausivel (ex.: 'Joao Silva') so para parecer",
  "   completo. Nesse caso, siga a regra 2 abaixo (diga que nao encontrou).",
  // S-WM-AUD-003 / Plano 004 (Rafael, conversa e7c22796): perguntado se podia se matricular em
  // mais de uma turma, o bot respondeu "sim, desde que os horarios nao conflitem e haja vagas".
  // Confirmado por SQL que NENHUMA fonte RAG ativa contem regra de matricula — foi inferencia do
  // GPT a partir de senso comum sobre "como costuma funcionar". A regra 1 enumerava atividades,
  // horarios, professores e modalidades; REGRA ADMINISTRATIVA nao estava coberta.
  "   Isso vale tambem para REGRAS ADMINISTRATIVAS: quantas modalidades ou turmas uma pessoa",
  "   pode cursar ao mesmo tempo, requisitos de matricula, prazos, documentos exigidos, valores.",
  "   Se o contexto nao trouxer a regra explicitamente, NAO responda com base no que costuma ser",
  "   comum em outras instituicoes — siga a regra 2.",
  // S-WM-AUD-003 / Plano 010 (Ari C., conversa a5ffd5c8, Mondubim): perguntada sobre "natacao
  // infantil", a resposta apresentou a programacao de "Carimba" como se fosse natacao infantil.
  // Os FATOS eram reais (dias, faixa 7-10 anos, professora) — mas de Carimba. As 29 turmas de
  // natacao em Mondubim sao todas "15 a 29+"; nao existe variante infantil. O que foi inventado
  // foi a CONEXAO. O exemplo negativo acima so cobria "inventar um fato ausente"; nao cobria
  // "pegar um fato real e trocar o rotulo dele".
  "   NUNCA apresente uma atividade REAL do contexto como se fosse a resposta para uma modalidade",
  "   DIFERENTE que a pessoa perguntou, mesmo que pareca a mais proxima ou a mais adequada",
  "   disponivel — por exemplo, NAO diga que 'Carimba' e a programacao de 'natacao infantil' so",
  "   porque as duas atendem criancas. Se a modalidade exata pedida nao estiver no contexto, siga",
  "   a regra 2 e diga que nao encontrou ESSA modalidade especifica. NUNCA substitua pelo nome de",
  "   outra atividade, mesmo oferecendo os dados reais dela.",
  "",
  // S-INST-QUAL-01 (A9): "atividade que nao existe no mes" e resposta; "fato institucional que
  // falta" segue a regra do agente (no Institucional, chama o atendente).
  "2. Se a ATIVIDADE ou modalidade perguntada nao estiver na programacao carregada, diga com suas",
  "   proprias palavras e no seu tom que nao encontrou essa atividade na programacao deste mes —",
  "   isso ja e uma resposta. Para outra informacao que nao esteja no contexto, nunca invente nem",
  "   complete com suposicao: siga a regra 'SEM RESPOSTA NA BASE', quando ela vier abaixo; sem ela,",
  "   diga que nao encontrou essa informacao e sugira falar com a unidade.",
  "",
  "3. NUNCA peca desculpas por informacoes corretas. Se o usuario disser que uma",
  "   informacao esta errada, verifique o contexto antes de concordar. Se o contexto",
  "   confirma sua resposta anterior, mantenha-a com seguranca: diga 'Verificando",
  "   minha base, [informacao do contexto]'.",
  "",
  "4. Use a DATA ATUAL para referencias temporais.",
  "",
  // S-INST-QUAL-01 (A4): a regra antiga ("NUNCA HANDOVER quando citar uma unidade") brigava com
  // a regra de handover do prompt do agente, que manda gerente e coordenador para humano.
  "5. O nome de uma unidade CUCA SOZINHO (Barra, Jangurussu, Mondubim, Pici, Jose Walter) nunca",
  "   e pedido de atendimento humano: e consulta de programacao, NAO use [[HANDOVER]] por isso.",
  "   Ja o pedido de FALAR COM UMA PESSOA — atendente, gerente, coordenador(a), diretor(a),",
  "   responsavel, funcionario(a), alguem da equipe ou de um setor — e pedido de atendimento",
  "   humano mesmo citando a unidade: use [[HANDOVER]]. Uma pergunta SOBRE um setor (ex.: 'o",
  "   setor de esportes tem natacao?') nao e pedido de pessoa.",
  "",
  "6. FORMATO DE LISTAGEM — REGRA CRITICA:",
  "   Quando apresentar TODAS as modalidades/cursos/atividades de uma area, liste",
  "   APENAS o nome de cada item + dias da semana de forma compacta (ex: 'Natacao - Ter/Qui/Sex').",
  "   NAO inclua horarios completos, professores ou vagas na listagem geral.",
  "   Ao final, diga: 'Quer saber horarios e detalhes de alguma modalidade especifica?'",
  "   So mostre horarios completos quando o usuario perguntar sobre uma modalidade especifica.",
  "   ISSO GARANTE que TODAS as modalidades aparecem e nenhuma fica de fora.",
  "",
  "7. NUNCA invente proximidade geografica, distancia ou tempo de deslocamento entre um bairro",
  "   e uma unidade CUCA. Isso inclui responder qual unidade e 'mais perto' ou 'mais proxima' de",
  "   um bairro/endereco informado pelo usuario. So afirme isso se o CONTEXTO trouxer, de forma",
  "   explicita, dado real de bairro/endereco/distancia das unidades. Sem esse dado no contexto,",
  "   diga com suas proprias palavras que nao tem essa informacao pra comparar e sugira que a",
  "   pessoa informe qual unidade prefere, ou confirme a distancia direto com a unidade.",
  "",
  "8. NUNCA informe a QUANTIDADE de vagas de um curso, modalidade ou atividade — nem numa",
  "   listagem, nem quando perguntarem de uma atividade especifica (ex.: 'tem vaga para",
  "   natacao?'). Mesmo que apareca um numero no contexto, NAO repita esse numero. Responda",
  "   que a atividade existe, de os detalhes dela (dias, horario, publico) e diga que a",
  "   quantidade de vagas muda com frequencia, orientando a pessoa a procurar a unidade CUCA",
  "   (com o telefone dela, quando estiver no contexto) para verificar a disponibilidade.",
  "   NUNCA afirme que ha vaga. A regra 6 ja proibia vagas na listagem geral; esta",
  "   regra fecha tambem o caso da pergunta sobre uma atividade especifica.",
  // Achado 2026-10-09 (conversa 1657d9b0): com a programacao da Barra carregada e o historico
  // falando de Libras no Mondubim, o GPT inventou "Seg e Qua 18:00 as 20:00" — horario que nao
  // existe em nenhum documento. E a lista inicial veio de um resumo de julho ja vencido.
  "",
  "9. FONTE UNICA DE PROGRAMACAO — REGRA CRITICA:",
  "   Atividades, cursos, modalidades, turmas, dias, horarios, faixa etaria, professor e QUAIS",
  "   UNIDADES oferecem cada atividade so podem vir dos blocos de programacao mensal carregados",
  "   NESTA resposta (programacao mensal atual da unidade, atividade especifica com dado exato,",
  "   trechos de contexto da programacao, ou programacao vigente da rede).",
  "   O FAQ e o bloco de servicos da rede servem para assuntos que nao sao programacao",
  "   (matricula, documentos, funcionamento, servicos) e NUNCA sao fonte de atividade, dia ou horario.",
  "   Suas proprias mensagens anteriores no historico NAO sao fonte: se elas citarem atividade,",
  "   dia, horario ou unidade que nao estejam nos blocos desta resposta, NAO repita — podem estar",
  "   desatualizadas.",
  "   A programacao carregada e da UNIDADE informada no fim deste prompt. Se a pessoa perguntar de",
  "   uma atividade que nao esta nessa programacao, diga que nao encontrou essa atividade na",
  "   programacao deste mes dessa unidade — nunca complete com dia ou horario de cabeca.",
  "   NUNCA diga que OUTRAS unidades ou a rede nao tem uma atividade se nao houver, NESTA resposta,",
  "   um bloco com a programacao da rede ('PROGRAMACAO VIGENTE DA REDE' ou 'PROGRAMACAO VIGENTE'",
  "   com varias unidades) ou uma instrucao desta resposta dizendo que a busca foi feita em todas as",
  "   unidades. Sem isso, fale so da unidade carregada e ofereca procurar nas outras.",
  "   Ao oferecer unidades como opcoes numeradas, escreva SEMPRE o nome da unidade em cada linha",
  "   (ex.: '1️⃣ Cuca Mondubim').",
].join("\n");

/**
 * S-INST-QUAL-01 (A6, A7, A9): regras so do Institucional/maria — vai no prompt logo depois de
 * `INSTRUCAO_SEGURANCA`. Sofia e ana (que tambem passam por este motor) nao recebem.
 * - A9 (Junior, 02/11): sem a informacao na base, chama o atendente; nunca inventa. Substitui o
 *   "transbordo depois de 3 tentativas" do prompt do agente.
 * - A6/A7 (Mariana, 19/10): telefone da unidade sempre que mandar procurar a unidade, e "ligar
 *   antes" para quem vai se inscrever presencialmente (natacao e hidroginastica lotam no 1o dia).
 *   O telefone vem do bloco de servicos da rede, nunca de cabeca.
 */
export const INSTRUCAO_INSTITUCIONAL = [
  "REGRAS DO ATENDIMENTO INSTITUCIONAL (obrigatorias):",
  "",
  "A. SEM RESPOSTA NA BASE: se, depois de consultar todos os blocos desta resposta (programacao,",
  "   servicos da rede, contexto de faq e o historico), a informacao pedida NAO estiver la, nao",
  "   suponha nem complete: diga com suas palavras que nao encontrou essa informacao e passe o",
  "   telefone da unidade da conversa (regra B) — se a unidade nao estiver definida, os telefones",
  "   de todas as unidades — para a pessoa confirmar direto com a unidade. NUNCA ofereca falar com",
  "   atendente nem diga que vai chamar alguem, e NAO use [[HANDOVER]] por falta de informacao: o",
  "   atendente so entra quando a propria pessoa pede para falar com alguem. Esta regra vale acima",
  "   de qualquer outra instrucao de chamar atendente por falta de informacao.",
  "   NAO e falta de informacao: (1) quando a base da uma orientacao, inclusive 'ligar ou ir a",
  "   unidade' — ai responda com essa orientacao (regra B); (2) quando a programacao mostra que a",
  "   atividade nao existe naquele mes ou naquela unidade — 'nao tem natacao no Pici em novembro'",
  "   ja e a resposta (regra 2); (3) quando outra regra deste prompt ja diz como responder (ex.:",
  "   unidade mais perto, quantidade de vagas, menores de 15 anos) — siga essa regra.",
  "",
  "B. TELEFONE DA UNIDADE: sempre que a resposta mandar a pessoa procurar, ligar ou ir a uma",
  "   unidade, inclua o telefone dessa unidade, copiado do bloco de servicos da rede (lista",
  "   'Telefones das unidades'). Se a unidade nao estiver definida, pergunte de qual unidade a",
  "   pessoa quer o contato. NUNCA invente um telefone.",
  "",
  "C. INSCRICAO PRESENCIAL: se a pessoa disser que vai a unidade se inscrever ou se matricular",
  "   pessoalmente (ex.: 'posso ir amanha me inscrever?'), passe o telefone da unidade e recomende",
  "   ligar antes para confirmar se ainda ha vaga, porque algumas atividades lotam logo no primeiro",
  "   dia. NUNCA afirme que ha vaga.",
].join("\n");

const UNIDADES_VALIDAS = ['Cuca Barra', 'Cuca Jangurussu', 'Cuca Mondubim', 'Cuca Pici', 'Cuca José Walter'];

export type AvaliacaoSelecaoUnidade = {
  unidade: string | null;
  quer_sair: boolean;
  mudou_de_assunto: boolean;
  pergunta_geral: boolean;
  /** Item 1 (S-WM-21): true quando a mensagem pede algo cujo conteúdo real depende de saber
   * qual unidade CUCA (cursos, horários, programação) — usado só por decidirPrimeiraMensagem
   * pra decidir entre mostrar o menu ou só uma pergunta aberta. Campo opcional pra não quebrar
   * os literais de teste já existentes que constroem este tipo sem ele (decidirAguardandoUnidade
   * não consome este sinal). */
  pedido_depende_unidade?: boolean;
};

const AVALIACAO_SELECAO_UNIDADE_DEFAULT: AvaliacaoSelecaoUnidade = { unidade: null, quer_sair: false, mudou_de_assunto: false, pergunta_geral: false, pedido_depende_unidade: false };

/** Valida o JSON retornado pelo GPT contra o contrato esperado — nunca confia cegamente no LLM */
export function validarAvaliacaoSelecaoUnidade(data: unknown): AvaliacaoSelecaoUnidade {
  const obj = (data && typeof data === "object") ? data as Record<string, unknown> : {};
  const unidade = (typeof obj.unidade === "string" && UNIDADES_VALIDAS.includes(obj.unidade)) ? obj.unidade : null;
  return {
    unidade,
    quer_sair: obj.quer_sair === true,
    mudou_de_assunto: obj.mudou_de_assunto === true,
    // VAL-12: só tem sentido quando mudou_de_assunto=true — diferencia pergunta institucional
    // real ("a rede CUCA é da prefeitura?") de cortesia pura ("bom dia"), ver avaliarSelecaoUnidade.
    pergunta_geral: obj.pergunta_geral === true,
    // Item 1 (S-WM-21): só tem sentido quando pergunta_geral=false — ver decidirPrimeiraMensagem.
    pedido_depende_unidade: obj.pedido_depende_unidade === true,
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
/**
 * Item 5 (S-WM-21, cont. AUD-13): mesma lógica de retry/backoff de chamarGPT
 * (deveTentarNovamente/parseRetryAfterSegundos/GPT_MAX_TENTATIVAS/GPT_ESPERA_MAX_SEGUNDOS,
 * definidas mais abaixo no arquivo — referência tardia é segura aqui porque só é lida em tempo
 * de chamada, depois do módulo inteiro já ter sido avaliado). Antes, um 429/5xx transitório
 * aqui caía direto no fallback seguro sem tentar de novo, silenciando a classificação semântica
 * por uma falha temporária da OpenAI (roteamento de unidade errado sem nenhum sinal de erro).
 */
export function montarContextoHistoricoSelecaoUnidade(historico: { role: string; content: string }[] = [], textoAtual = ""): string {
  const textoAtualTrim = textoAtual.trim();
  const mensagensRecentes = [...historico]
    .reverse()
    .filter((m) => {
      const content = m.content.trim();
      return (m.role === "assistant" || m.role === "user") && content !== "" && content !== textoAtualTrim;
    })
    .slice(0, 2)
    .reverse()
    .map((m) => (m.role === "assistant" ? "Maria" : "Lead") + ": " + m.content.replace(/[\r\n]+/g, " ").trim());

  if (mensagensRecentes.length === 0) return "Historico recente: nenhum.";
  return "Historico recente (use apenas para entender respostas curtas/elipticas):\n" + mensagensRecentes.join("\n");
}

/**
 * S-WM-72: contexto do interpretador = TODAS as mensagens do lead na sessão atual (o histórico já
 * vem recortado pela S-WM-71) + a última resposta da Maria, truncada. É assim que "minha filha tem
 * 7 anos", dito duas mensagens antes, chega à interpretação de "tem balé?".
 */
export function montarContextoSessaoParaInterpretacao(historico: { role: string; content: string }[] = [], textoAtual = ""): string {
  const atual = textoAtual.trim();
  const anteriores = historico.filter((m) => m.content.trim() !== "");
  if (anteriores.length && anteriores[anteriores.length - 1].role === "user" && anteriores[anteriores.length - 1].content.trim() === atual) anteriores.pop();
  const linhas = anteriores.slice(-10).map((m) => (m.role === "assistant" ? "Maria: " + m.content.replace(/[\r\n]+/g, " ").trim().slice(0, 300) : "Lead: " + m.content.replace(/[\r\n]+/g, " ").trim()));
  return linhas.length ? "Conversa desta sessão (mais antiga primeiro):\n" + linhas.join("\n") : "Conversa desta sessão: nenhuma mensagem anterior.";
}

/** S-INST-QUAL-03: `aoConsumir` (opcional) registra o consumo (`feature = 'classificacao_rota'`). */
export async function avaliarSelecaoUnidade(texto: string, openaiKey: string, historico: { role: string; content: string }[] = [], aoConsumir?: (corpo: RespostaOpenAIUso, latenciaMs: number) => void, tentativa = 0): Promise<AvaliacaoSelecaoUnidade> {
  const inicio = Date.now();
  try {
    const contextoHistorico = montarContextoHistoricoSelecaoUnidade(historico, texto);
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + openaiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 90,
        response_format: { type: "json_object" },
        messages: [{
          role: "user",
          content: [
            "Um lead da rede CUCA está conversando com a Maria (assistente da Rede CUCA). Ele pode",
            "estar respondendo a este menu de unidades ou simplesmente mandando uma mensagem livre:",
            MENU_UNIDADES,
            "",
            "Unidades válidas (use o nome EXATO): Cuca Barra, Cuca Jangurussu, Cuca Mondubim, Cuca Pici, Cuca José Walter.",
            "",
            "Retorne SOMENTE JSON com as chaves:",
            "- \"unidade\": o nome exato de uma das 5 unidades válidas se o lead mencionou uma (mesmo com erro de digitação ou de forma indireta), ou null se não deu pra identificar.",
            "- \"quer_sair\": true se o lead claramente não quer continuar / não vai escolher uma unidade agora (ex.: agradecimento de despedida, \"deixa pra lá\", \"depois eu vejo\").",
            "- \"mudou_de_assunto\": true se a mensagem não é uma tentativa de escolher unidade nem de sair (ex.: cortesia como \"obrigado pela mensagem\", pergunta sobre outro assunto).",
            "- \"pergunta_geral\": true SOMENTE se mudou_de_assunto=true E a mensagem for uma pergunta real sobre o CUCA que não depende de saber qual unidade (ex.: \"a rede CUCA é da prefeitura?\", \"tem curso pago?\"). false se for só cortesia/cumprimento sem pergunta de verdade (ex.: \"bom dia\", \"tudo bem?\", \"obrigado\").",
            "- \"pedido_depende_unidade\": true se a mensagem pede algo cujo conteúdo real depende de saber qual unidade CUCA (ex.: \"tem natação na Barra?\", cursos, horários, programação, atividades, vagas em alguma modalidade numa unidade específica). false se for só cortesia/saudação, um pedido vago sem conteúdo concreto (ex.: \"quero saber sobre vocês\"), ou já for pergunta_geral=true.",
            "",
            "Exemplos importantes:",
            "- \"tem natação na Barra?\" => unidade=\"Cuca Barra\", pedido_depende_unidade=true, pergunta_geral=false.",
            "- \"qual unidade tem natação?\" ou \"onde tem natação?\" => unidade=null, mudou_de_assunto=true, pergunta_geral=true, pedido_depende_unidade=false.",
            "",
            contextoHistorico,
            "",
            "Mensagem do lead: " + texto,
          ].join("\n"),
        }],
      }),
    });

    if (deveTentarNovamente(resp.status, tentativa)) {
      const corpoErro = await resp.text();
      const esperaSegundos = Math.min(parseRetryAfterSegundos(resp.headers.get("retry-after"), corpoErro), GPT_ESPERA_MAX_SEGUNDOS);
      console.log("[motor-agente v18] Rate limit OpenAI em avaliarSelecaoUnidade (tentativa " + (tentativa + 1) + "/" + GPT_MAX_TENTATIVAS + "), aguardando " + esperaSegundos + "s antes de tentar de novo");
      await new Promise((resolve) => setTimeout(resolve, esperaSegundos * 1000));
      return avaliarSelecaoUnidade(texto, openaiKey, historico, aoConsumir, tentativa + 1);
    }

    if (!resp.ok) return AVALIACAO_SELECAO_UNIDADE_DEFAULT;
    const body = await resp.json();
    notificarConsumo(aoConsumir, body, inicio);
    const parsed = JSON.parse(body.choices[0].message.content);
    return validarAvaliacaoSelecaoUnidade(parsed);
  } catch (exc) {
    console.error("[motor-agente v18] avaliarSelecaoUnidade erro, fallback seguro:", exc);
    return AVALIACAO_SELECAO_UNIDADE_DEFAULT;
  }
}

/**
 * S-WM-72 (R1): interpretador semântico do turno. Lê as mensagens do lead NA SESSÃO ATUAL (o
 * histórico já vem recortado pela S-WM-71) e devolve o tipo da mensagem, a atividade (com variações
 * de grafia para buscar no título), a área REAL da programação, o contexto citado em qualquer
 * mensagem da sessão (sem lista fechada) e o escopo que a própria mensagem já define. Só é chamado
 * quando o filtro barato (`temSinalDeProgramacao`) vê cara de programação. Qualquer falha cai em
 * `INTERPRETACAO_PADRAO` (nao_programacao) — o fluxo de hoje segue, nunca um palpite.
 */
export async function interpretarTurnoProgramacao(texto: string, openaiKey: string, historico: { role: string; content: string }[] = [], aoConsumir?: (corpo: RespostaOpenAIUso, latenciaMs: number) => void, tentativa = 0): Promise<InterpretacaoTurno> {
  // S-INST-QUAL-03: `aoConsumir` (opcional) registra o consumo (`feature = 'interpretacao_programacao'`).
  const inicio = Date.now();
  try {
    const contextoHistorico = montarContextoSessaoParaInterpretacao(historico, texto);
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": "Bearer " + openaiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 220,
        response_format: { type: "json_object" },
        messages: [{
          role: "user",
          content: [
            "Você interpreta mensagens de leads da Rede CUCA (centros de juventude de Fortaleza) para um atendente virtual.",
            "A programação mensal tem EXATAMENTE 3 áreas (use o código exato):",
            "- CURSOS = Cursos e Oficinas: dança (balé/ballet, jazz, danças urbanas, k-pop, ritmos), teatro, música (violão, canto), Libras, fotografia, informática/tecnologia, design, yoga, currículo.",
            "- ESPORTES = natação, lutas (judô, jiu-jitsu, karatê, muay thai, boxe, MMA, capoeira), futsal, vôlei, basquete, handebol, hidroginástica, funcional, pilates, ginástica, corrida, triathlon.",
            "- DIA A DIA = eventos e atividades abertas (Dia da Criança, ensaios abertos, Hora Pintada, Venha Jogar).",
            "Não existem outras áreas (não existe 'Atividades Culturais' nem 'Tecnologia' como área).",
            "",
            "Retorne SOMENTE JSON com as chaves:",
            "- \"tipo\": \"pergunta_programacao\" (pede informação sobre atividade/curso/esporte/evento, o que tem, ou o que É uma atividade: 'o que é jazz?'), \"continuacao\" (pergunta sobre a MESMA atividade já em conversa: horário, turno, idade, vaga, professor), \"afirmacao\" (conta algo, não pergunta: 'minha filha vai ficar no balé'), \"nao_programacao\" (matrícula, documentos, endereço, outro assunto) ou \"cortesia_ou_saida\".",
            "- \"atividade\": a atividade de que a pessoa está falando AGORA (pode ter sido citada em mensagem anterior da conversa, no caso de continuação), ou null.",
            "- \"termos_busca\": 1 a 4 palavras para buscar a atividade no título, com variações de grafia (ex.: balé -> [\"bale\",\"ballet\"]; futebol -> [\"futsal\",\"futebol\"]). [] se não houver atividade.",
            "- \"area\": \"CURSOS\", \"ESPORTES\", \"DIA A DIA\" ou null. A palavra 'curso(s)'/'oficina(s)' sem atividade = CURSOS. Se houver atividade, a área é a da atividade, mesmo que a pessoa diga 'curso de natação' (natação = ESPORTES).",
            "- \"contexto\": objeto com TODA condição relevante citada nas mensagens do lead nesta conversa, INCLUSIVE na mensagem atual (idade em número, genero 'feminino'/'masculino' — ex.: 'futsal feminino' => genero feminino, turno 'manha'/'tarde'/'noite' — ex.: 'à noite' => turno noite, dia, nivel, deficiencia, dificuldade, local, para quem é). {} se nada.",
            "- \"escopo\": SOMENTE se a MENSAGEM ATUAL DO LEAD disser onde: nome exato da unidade (Cuca Barra, Cuca Jangurussu, Cuca Mondubim, Cuca Pici, Cuca José Walter) ou \"REDE\" se pedir toda a rede/todas as unidades/'em quais unidades'. NUNCA deduza a unidade das mensagens da Maria nem de mensagens anteriores: se a mensagem atual não disser, escopo=null.",
            "",
            "Exemplos:",
            "- 'olá, quero saber sobre capoeira e como faço a matrícula' => tipo=pergunta_programacao, atividade=capoeira, area=ESPORTES, escopo=null.",
            "- 'quais cursos tem?' => tipo=pergunta_programacao, atividade=null, area=CURSOS.",
            "- 'tem curso de natação?' => atividade=natação, area=ESPORTES.",
            "- 'minha filha vai ficar no balé' => tipo=afirmacao.",
            "- 'o que é jazz?' => tipo=pergunta_programacao, atividade=jazz, area=CURSOS.",
            "- 'tem futsal feminino?' => atividade=futsal, area=ESPORTES, contexto={genero:'feminino'}.",
            "- Maria falou do Cuca Barra e o lead responde 'de vôlei' => escopo=null (o lead não disse a unidade).",
            "- conversa sobre libras e agora 'e tem à noite?' => tipo=continuacao, atividade=libras, contexto.turno=noite.",
            "- 'minha filha tem 7 anos' antes e agora 'tem balé?' => tipo=pergunta_programacao, atividade=balé, contexto={idade:7, genero:'feminino', para:'filha'}.",
            "- 'quero capoeira no Pici' => escopo='Cuca Pici'. 'tem capoeira em toda a rede?' => escopo='REDE'.",
            "",
            contextoHistorico,
            "",
            "Mensagem do lead: " + texto,
          ].join("\n"),
        }],
      }),
    });

    if (deveTentarNovamente(resp.status, tentativa)) {
      const corpoErro = await resp.text();
      const esperaSegundos = Math.min(parseRetryAfterSegundos(resp.headers.get("retry-after"), corpoErro), GPT_ESPERA_MAX_SEGUNDOS);
      await new Promise((resolve) => setTimeout(resolve, esperaSegundos * 1000));
      return interpretarTurnoProgramacao(texto, openaiKey, historico, aoConsumir, tentativa + 1);
    }
    if (!resp.ok) return INTERPRETACAO_PADRAO;
    const body = await resp.json();
    notificarConsumo(aoConsumir, body, inicio);
    return validarInterpretacaoTurno(JSON.parse(body.choices[0].message.content));
  } catch (exc) {
    console.error("[motor-agente v18] interpretarTurnoProgramacao erro, fallback seguro:", exc);
    return INTERPRETACAO_PADRAO;
  }
}

export function sanitizarNomeLead(nome: string | null | undefined): string {
  if (!nome) return "Nao informado";
  const sanitizado = nome
    .replace(/[\[\]]/g, "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 80);
  return sanitizado || "Nao informado";
}

export type DecisaoAguardandoUnidade = {
  unidadeSelecionada: string | null;
  aguardandoUnidade: boolean;
  resposta: string | null;
  /** S-WM-34 (VAL-23): true quando a mensagem que resolveu a unidade já trazia um pedido
   * específico junto (ex.: "e no Mondubim, tem natação de noite?") — o caller usa isso pra NÃO
   * disparar a instrução de "resumo geral" quando trocouUnidade=true, que hoje suprime o dado
   * específico mesmo com o contexto certo carregado. Ver mensagemTemPedidoEspecifico. Opcional
   * (default implícito false no caller) — só é setado nos branches que resolvem unidadeSelecionada;
   * irrelevante nos demais (nenhuma troca de unidade acontece, nada pra suprimir). */
  pedidoEspecifico?: boolean;
};

/**
 * Achado 2026-07-24 (INVESTIGACAO-breadcrumb-nao-usado-primeira-mensagem): as 3 funções de
 * roteamento (decidirAguardandoUnidade, decidirConversaEngajada, decidirPrimeiraMensagem) têm
 * um branch de "cortesia pura" que devolve uma resposta pronta (sem chamar GPT) e o caller
 * retorna imediatamente — antes mesmo de CONTEXTO_DISPARO (breadcrumb do disparo institucional,
 * ver seção 9 do handler) ser montado. Resultado: um lead que acabou de receber um disparo e
 * responde só "ok"/"obrigado" nunca tem o disparo reconhecido, mesmo com o dado correto em
 * metadata (achado isolado do bug do PR #53/#54, que era o dado nunca chegar a ser gravado).
 * Esta função decide se essa resposta canned deve ser IGNORADA (deixando `resposta` virar null
 * no caller, mesmo padrão que pergunta_geral já usa pra cair no fluxo normal de GPT):
 * - `ehOptOut=true` nunca é sobrescrito: o lead só quer parar de receber mensagem, reconhecer o
 *   disparo não ajuda em nada e ainda gastaria uma chamada de GPT à toa.
 * - Janela de 24h: `ultimo_disparo` nunca é limpo depois de reconhecido (nenhum mecanismo grava
 *   isso) — sem o corte de tempo, o campo ficaria "ativo" pra sempre, forçando o fluxo de GPT em
 *   toda cortesia futura do lead, não só na mensagem seguinte ao disparo.
 */
export function deveReconhecerDisparoRecente(
  ultimoDisparo: { enviado_em?: string } | null | undefined,
  ehOptOut: boolean,
): boolean {
  if (ehOptOut) return false;
  const enviadoEmStr = ultimoDisparo?.enviado_em;
  if (!enviadoEmStr) return false;
  const enviadoEm = new Date(enviadoEmStr).getTime();
  if (Number.isNaN(enviadoEm)) return false;
  return (Date.now() - enviadoEm) < 24 * 60 * 60 * 1000;
}

/**
 * Decide o que fazer quando a conversa está em `aguardando_unidade=true` e chega uma nova
 * mensagem. `resposta !== null` significa "responda isto e encerre a requisição agora";
 * `resposta === null` significa "resolvido, siga o fluxo normal" — cobre tanto unidade
 * escolhida quanto pergunta_geral=true (VAL-12, ver abaixo).
 * Extraído do handler só para permitir teste automatizado (auditoria AUD-01 em
 * docs/qa/AUDITORIA-motor-agente-institucional-2026-07-07.md) — comportamento idêntico ao
 * inline anterior, nenhuma correção aplicada nesta extração.
 * `textoOriginal` (S-WM-34, VAL-23, opcional/default "" pra não quebrar chamadas de teste
 * existentes que não exercitam pedidoEspecifico): necessário porque quando a unidade resolve via
 * `unidadeDetectadaDireta` (match direto de nome/dígito), `avaliacaoSemantica` nunca foi
 * calculada de verdade pelo caller (avaliarSelecaoUnidade só roda quando não há match direto) —
 * `pedido_depende_unidade` não é um sinal confiável nesse caso, por isso cai pro sinal
 * equivalente (mensagemTemPedidoEspecifico) em vez de reaproveitar um campo que nunca foi
 * avaliado de verdade.
 */
export function decidirAguardandoUnidade(
  unidadeDetectadaDireta: string | undefined,
  avaliacaoSemantica: AvaliacaoSelecaoUnidade,
  textoOriginal = "",
  cortesia?: boolean,
): DecisaoAguardandoUnidade {
  const unidadeDetectada = unidadeDetectadaDireta ?? avaliacaoSemantica.unidade ?? undefined;

  if (unidadeDetectada) {
    const pedidoEspecifico = unidadeDetectadaDireta
      ? mensagemTemPedidoEspecifico(textoOriginal)
      : avaliacaoSemantica.pedido_depende_unidade === true;
    return { unidadeSelecionada: unidadeDetectada, aguardandoUnidade: false, resposta: null, pedidoEspecifico };
  }
  if (avaliacaoSemantica.quer_sair) {
    return {
      unidadeSelecionada: null,
      aguardandoUnidade: false,
      resposta: "Sem problemas! Quando quiser saber sobre alguma unidade CUCA, é só chamar. 😊",
    };
  }
  if (avaliacaoSemantica.pergunta_geral) {
    // VAL-12: pergunta institucional real — resolve o estado de espera e segue pro fluxo
    // normal (Passo 6, RAG geral) em vez de reabrir o menu.
    return { unidadeSelecionada: null, aguardandoUnidade: false, resposta: null };
  }
  if (!avaliacaoSemantica.pedido_depende_unidade) {
    // S-WM-31 Task 3 (AC5): critério unificado com decidirPrimeiraMensagem — só reapresenta o
    // menu quando pedido_depende_unidade=true. Supera VAL-13 (cortesia pura reapresentava o
    // menu indefinidamente): decisão revista nesta story após as duas funções decidirem de
    // forma inconsistente quando pedir a unidade. Tom de CONTINUAÇÃO (item 6 do Escopo) — nunca
    // SAUDACOES_ABERTURA aqui, a conversa já está em andamento.
    // Hotfix 05/11/2026: só cumprimento puro recebe a resposta pronta; o resto segue pro fluxo
    // normal (mesmo caminho de pergunta_geral), que responde de verdade.
    // S-INST-QUAL-05: `cortesia` vem do handler (rajada inteira avaliada mensagem por mensagem, e
    // false quando a última resposta do bot já foi a frase pronta). Sem ele, vale só `textoOriginal`.
    if (!(cortesia ?? ehCortesiaPura(textoOriginal))) return { unidadeSelecionada: null, aguardandoUnidade: false, resposta: null };
    return {
      unidadeSelecionada: null,
      aguardandoUnidade: false,
      resposta: "Em que mais posso te ajudar? 😊",
    };
  }
  return {
    unidadeSelecionada: null,
    aguardandoUnidade: true,
    resposta: "Não consegui identificar a unidade 😊\n\n" + MENU_UNIDADES,
  };
}

export type DecisaoConversaEngajada = {
  unidadeSelecionada: string | null;
  aguardandoUnidade: boolean;
  perguntaGeralAtiva: boolean;
  resposta: string | null;
  /** S-WM-34 (VAL-23): ver DecisaoAguardandoUnidade.pedidoEspecifico — mesmo contrato. */
  pedidoEspecifico?: boolean;
  /** S-WM-70: true quando `resposta` é uma despedida e a conversa deve ser marcada como
   * encerrada (mesmo efeito que a tag `[[ENCERRAR]]` já produz no fluxo com GPT — ver handler).
   * Opcional pra não quebrar nenhum literal de teste existente que constrói este tipo sem ele. */
  encerrar?: boolean;
};

/**
 * S-WM-31 (item 6 do Escopo, Causa raiz B): 3º branch de roteamento pra conversas com
 * `conversa_engajada=true` (já passaram por cortesia/pergunta_geral, nem `unidade_selecionada`
 * nem `aguardando_unidade` bateram). Reavalia a mensagem com a MESMA detecção usada nos outros
 * branches, mas NUNCA repete `SAUDACOES_ABERTURA` nem o texto de boas-vindas do menu inicial —
 * a conversa já está em andamento. Desenho novo desta story, não adaptado de nenhuma função
 * existente: diferente de `decidirAguardandoUnidade`, aqui "nenhum dos dois" (nem unidade, nem
 * pedido que dependa dela) não devolve uma resposta canned — sinaliza `perguntaGeralAtiva` e
 * deixa o Passo 6 (RAG geral) responder de verdade, mesmo comportamento que `pergunta_geral=true`
 * já dispara nos outros 2 branches.
 */
export function decidirConversaEngajada(
  unidadeDetectadaDireta: string | undefined,
  avaliacaoSemantica: AvaliacaoSelecaoUnidade,
  textoOriginal = "",
  cortesia?: boolean,
): DecisaoConversaEngajada {
  const unidadeDetectada = unidadeDetectadaDireta ?? avaliacaoSemantica.unidade ?? undefined;

  if (unidadeDetectada) {
    const pedidoEspecifico = unidadeDetectadaDireta
      ? mensagemTemPedidoEspecifico(textoOriginal)
      : avaliacaoSemantica.pedido_depende_unidade === true;
    return { unidadeSelecionada: unidadeDetectada, aguardandoUnidade: false, perguntaGeralAtiva: false, resposta: null, pedidoEspecifico };
  }
  if (avaliacaoSemantica.pedido_depende_unidade) {
    return {
      unidadeSelecionada: null,
      aguardandoUnidade: true,
      perguntaGeralAtiva: false,
      resposta: "Pra te ajudar certinho com isso, me diz qual unidade CUCA:\n\n" + MENU_UNIDADES,
    };
  }
  if (avaliacaoSemantica.quer_sair) {
    // S-WM-70: antes deste branch, `quer_sair` nunca era lido aqui — uma despedida numa conversa
    // já engajada caía direto no catch-all "Em que mais posso te ajudar? 😊" (achado real: lead
    // Nívea pediu pra encerrar 3x e recebeu o mesmo canned nas 3). Precisa vir DEPOIS de
    // `pedido_depende_unidade` (um pedido que dependa de unidade ganha de uma despedida na mesma
    // frase) e ANTES de `!pergunta_geral` (que é o catch-all que hoje engolia a despedida).
    return {
      unidadeSelecionada: null,
      aguardandoUnidade: false,
      perguntaGeralAtiva: false,
      resposta: "Que bom poder ajudar! 😊 Se precisar de mais alguma coisa, é só chamar por aqui. Até logo! 👋",
      encerrar: true,
    };
  }
  if (!avaliacaoSemantica.pergunta_geral) {
    // VAL-19 (S-WM-50): sem esta checagem, cortesia pura ("tudo bem?", pergunta_geral=false) caía
    // no mesmo catch-all abaixo que uma pergunta_geral=true real — gastava uma chamada de GPT
    // (resumo_rede + FAQ carregados no prompt) à toa. Mesmo padrão/mesmo texto que
    // decidirAguardandoUnidade já usa pra esse caso (linha 658-663) — tom de continuação, nunca
    // SAUDACOES_ABERTURA aqui (a conversa já está engajada).
    // Hotfix 05/11/2026: só cumprimento puro recebe a resposta pronta (ver ehCortesiaPura).
    // S-INST-QUAL-05: `cortesia` vem do handler (rajada inteira avaliada mensagem por mensagem, e
    // false quando a última resposta do bot já foi a frase pronta). Sem ele, vale só `textoOriginal`.
    if (!(cortesia ?? ehCortesiaPura(textoOriginal))) return { unidadeSelecionada: null, aguardandoUnidade: false, perguntaGeralAtiva: true, resposta: null };
    return {
      unidadeSelecionada: null,
      aguardandoUnidade: false,
      perguntaGeralAtiva: false,
      resposta: "Em que mais posso te ajudar? 😊",
    };
  }
  return { unidadeSelecionada: null, aguardandoUnidade: false, perguntaGeralAtiva: true, resposta: null };
}

/**
 * Extraído do handler para permitir teste automatizado (auditoria AUD-04) — mesma fórmula
 * usada hoje, nenhuma correção aplicada.
 */
export function calcularPrecisaVisaoGeral(params: { conversaJustCreated: boolean; trocouUnidade: boolean; isSelecaoMenu: boolean }): boolean {
  return params.conversaJustCreated || params.trocouUnidade || params.isSelecaoMenu;
}

/**
 * Detecção direta de unidade por nome/dígito exato (contemPalavra + UNIDADES_MAP). Usada tanto
 * na resolução dentro de `aguardando_unidade` quanto na 1ª mensagem de uma conversa nova
 * (decidirPrimeiraMensagem) — extraída pra não duplicar a mesma lógica nos dois lugares (AUD-07).
 */
export function detectarUnidadeDireta(texto: string, ultimoBlocoAgente?: string): string | undefined {
  const msgLower = texto.toLowerCase().trim();
  // Achado 2026-10-09 (conversa 1657d9b0): o GPT montou uma lista própria "1️⃣ Cuca Mondubim /
  // 2️⃣ Cuca Pici", o lead respondeu "1" e o UNIDADES_MAP fixo gravou Cuca Barra. Quando o
  // caller passa o bloco anterior do agente, o dígito solto é resolvido pela LINHA daquele
  // número no que o agente realmente mostrou — nunca pelo menu fixo às cegas.
  if (ehSelecaoMenu(msgLower) && ultimoBlocoAgente !== undefined) {
    return resolverDigitoPelaListaDoAgente(msgLower, ultimoBlocoAgente);
  }
  return Object.entries(UNIDADES_MAP).find(([k]) => contemPalavra(msgLower, k))?.[1];
}

/**
 * Resolve um dígito solto (1-5) contra a lista numerada que o agente mostrou no turno anterior:
 * pega a linha daquele número e procura NOME de unidade nela. Linha sem nome de unidade (ex.:
 * menu de categoria "1️⃣ Esportes") ou número inexistente na lista → `undefined` (o dígito não
 * vira unidade). O MENU_UNIDADES do código resolve pelo mesmo caminho ("1️⃣ Barra").
 */
export function resolverDigitoPelaListaDoAgente(digito: string, ultimoBlocoAgente: string): string | undefined {
  const numero = digito.trim();
  if (!/^[1-5]$/.test(numero) || !ultimoBlocoAgente) return undefined;
  const blocoSemMenuFixo = ultimoBlocoAgente.includes(MENU_UNIDADES) ? MENU_UNIDADES + "\n" : ultimoBlocoAgente;
  let linha = "";
  for (const l of blocoSemMenuFixo.split("\n")) {
    const s = l.trim().replace(/[️⃣*]/g, "");
    if (s.startsWith(numero + " ") || s.startsWith(numero + ".") || s.startsWith(numero + ")")) {
      linha = l;
      break;
    }
  }
  if (!linha) return undefined;
  const linhaLower = linha.toLowerCase();
  return Object.entries(NOMES_UNIDADES_POR_PALAVRA).find(([k]) => contemPalavra(linhaLower, k))?.[1];
}

/**
 * Texto do último bloco de mensagens do agente ANTES da mensagem atual do lead (o histórico já
 * inclui a mensagem atual, gravada pelo worker). Junta as partes consecutivas do agente porque
 * uma resposta longa é enviada dividida em várias mensagens (dividirRespostaEmPartes).
 */
export function textoUltimoBlocoAgente(historico: { role: string; content: string }[]): string {
  let i = historico.length - 1;
  while (i >= 0 && historico[i].role !== "assistant") i--;
  const partes: string[] = [];
  while (i >= 0 && historico[i].role === "assistant") {
    partes.unshift(historico[i].content);
    i--;
  }
  return partes.join("\n");
}

/**
 * S-WM-71 (Item 1): intervalo entre duas mensagens seguidas que separa uma sessão da outra.
 * Decisão do Junior (09/10/2026): 2h, o mesmo prazo da rotina que encerra a conversa.
 */
export const LIMITE_SESSAO_MS = 2 * 60 * 60 * 1000;

/** Chaves de `conversas.metadata` que descrevem "onde o lead está agora" — zeradas em sessão nova.
 * `ultimo_disparo` e qualquer outra chave ficam intactas. */
export const LIMPEZA_ESTADO_SESSAO: {
  unidade_selecionada: null; aguardando_unidade: boolean; menu_categoria_ativo: boolean; conversa_engajada: boolean;
  prog_pendente: null; prog_escopo: null; prog_contexto: null; prog_ultima_consulta: null;
} = {
  unidade_selecionada: null,
  aguardando_unidade: false,
  menu_categoria_ativo: false,
  conversa_engajada: false,
  // S-WM-72: pergunta pendente, escopo "toda a rede" e contexto da sessão também não atravessam sessões.
  prog_pendente: null,
  prog_escopo: null,
  prog_contexto: null,
  // S-INST-QUAL-14: a consulta que montou a lista de unidades ("2") também não atravessa sessões.
  prog_ultima_consulta: null,
};

/**
 * S-WM-71 (Item 1): recorta o histórico (ordem cronológica) na última quebra de sessão — um
 * intervalo MAIOR que `limiteMs` entre duas mensagens seguidas. `sessaoNova` é true quando a quebra
 * fica logo antes da última mensagem (a mensagem atual do lead abre a sessão). O critério é só o
 * tempo, independente de `conversas.status` (o cron de encerramento roda a cada 30 min, e a
 * conversa da campanha do simulado fica `ativa` de propósito). Mensagem sem `created_at` não
 * quebra a sessão.
 */
export function recortarSessao<T extends { created_at?: string | null }>(mensagensAsc: T[], limiteMs = LIMITE_SESSAO_MS): { mensagens: T[]; sessaoNova: boolean } {
  let inicio = 0;
  for (let i = mensagensAsc.length - 1; i > 0; i--) {
    const anterior = Date.parse(mensagensAsc[i - 1].created_at ?? "");
    const atual = Date.parse(mensagensAsc[i].created_at ?? "");
    if (!Number.isNaN(anterior) && !Number.isNaN(atual) && atual - anterior > limiteMs) {
      inicio = i;
      break;
    }
  }
  return { mensagens: mensagensAsc.slice(inicio), sessaoNova: inicio > 0 && inicio === mensagensAsc.length - 1 };
}

// Palavras comuns em pergunta de programação que não identificam atividade nenhuma — ficam fora
// do filtro de títulos (normalizadas, sem acento).
const PALAVRAS_NAO_ATIVIDADE = new Set([
  "gostaria", "informacoes", "informacao", "sobre", "curso", "cursos", "quero", "queria", "saber",
  "posso", "pode", "podem", "inscrever", "inscricao", "inscricoes", "matricula", "matricular", "fazer",
  "para", "como", "qual", "quais", "onde", "quando", "unidade", "unidades", "cuca", "cucas", "rede",
  "horario", "horarios", "vaga", "vagas", "noite", "manha", "tarde", "dias", "semana", "atividade",
  "atividades", "oficina", "oficinas", "aula", "aulas", "tenho", "anos", "ainda", "tambem", "voces",
  "voce", "existe", "existem", "algum", "alguma", "alguns", "algumas", "mais", "esse", "essa", "isso",
  "aqui", "obrigado", "obrigada", "tudo", "gente", "programacao", "turma", "turmas", "basico", "basica",
  "intermediario", "avancado", "quanto", "valor", "gratis", "gratuito", "preciso",
  "trabalho", "trabalhar", "trabalha", "depois", "antes", "favor", "entao", "sabado", "domingo",
  "segunda", "terca", "quarta", "quinta", "sexta", "disponivel", "disponiveis", "oferece", "oferecem",
  "tendo", "esta", "estao", "vcs", "pra", "pro", "nao", "sim", "dia", "hoje", "amanha", "mes",
  "outubro", "novembro", "dezembro", "proximo", "proxima", "filho", "filha", "esporte", "esportes",
  "esportiva", "esportivas", "gratuitos", "gratuitas", "gratuita", "ofertados", "ofertadas",
  "funciona", "funcionam", "funcionamento", "processo", "area", "areas", "acontece", "acontecem",
  "quem", "pois", "mandar", "respeito", "principalmente", "realmente", "relacionadas", "relacionados",
  "oferecer", "beneficios", "abertas", "abertos", "aberto", "aberta", "consultar", "disponibilidade",
  // 3 letras (entram no filtro desde que siglas como MMA passaram a contar)
  "tem", "que", "uma", "uns", "bom", "boa", "ola", "sou", "meu", "seu", "sua", "dos", "das", "nos",
  "nas", "por", "com", "sem", "ate", "ver", "ser", "faz", "vai", "ter", "ano", "mae", "pai", "ela",
  "ele", "eles", "elas", "aos", "num", "nem", "mas", "foi", "vou", "sei", "quer", "tbm", "obg", "mim",
  "teu", "tua", "ali", "isso", "rua", "tchau", "aula", "via", "voc", "qto", "qnd", "pfv", "blz",
  "sao", "faco", "estao",
  // S-WM-71: verbos e pronomes de "procure em outras unidades"
  // Hotfix 05/11/2026 (revisão do @qa): com a raiz do singular, "horas" virava "hora" e casava com
  // "HORA PINTADA"; "adultos"/"iniciantes" puxavam "JAZZ DANCE ADULTO - INICIANTE" para perguntas de
  // natação e informática. Mesma escolha da lista da busca determinística (PALAVRAS_GENERICAS).
  "hora", "horas", "adulto", "adultos", "iniciante", "iniciantes",
  "procure", "procura", "procurar", "procurem", "verifique", "verificar", "veja", "olhe", "outra",
  "outras", "outro", "outros", "demais", "nelas", "neles", "tambem",
  // S-WM-72: cortesia e verbos comuns que não identificam atividade (o filtro barato não pode
  // consultar a programação por causa deles)
  "tudo", "bem", "acho", "mudar", "trocar", "ainda", "certo", "beleza", "entendi", "otimo", "legal",
  "obrigada", "valeu", "sabe", "pode", "seria", "gostei", "queria", "preciso", "minha", "meu", "sua",
]);

/**
 * Palavras da mensagem que podem identificar uma atividade (>= 3 letras, fora da lista acima).
 * 3 letras é o mínimo de propósito: siglas como MMA entram, "de"/"no" não. "k-pop" vira "kpop"
 * antes de quebrar em palavras.
 */
export function palavrasChaveProgramacao(mensagem: string): string[] {
  const palavras = normalizarTexto(mensagem).replace(/([a-z0-9])-([a-z0-9])/g, "$1$2").split(/[^a-z0-9]+/).filter((p) => p.length >= 3 && !PALAVRAS_NAO_ATIVIDADE.has(p));
  // S-WM-72: variações de grafia que aparecem nos títulos reais ("Balé" e "Ballet" no mesmo mês,
  // "Viollão"), para o casamento por título não depender de como a pessoa escreveu.
  // Hotfix 05/11/2026: a palavra entra pela raiz do singular ("tecnicas vocais" → "tecnica voca"),
  // porque o título é casado pelo começo da palavra e o plural é maior que o singular do título.
  const comVariantes = palavras.flatMap((p) => {
    const raiz = raizSingular(p);
    if (PALAVRAS_NAO_ATIVIDADE.has(raiz)) return [];
    return [raiz, ...(VARIANTES_GRAFIA_ATIVIDADE[p] ?? []), ...(VARIANTES_GRAFIA_ATIVIDADE[raiz] ?? [])];
  });
  return [...new Set(comVariantes)];
}

/**
 * Hotfix 05/11/2026: raiz do singular de uma palavra no plural, sempre um PREFIXO da palavra
 * original — então casa com o título no singular e no plural ("dancas" → "danca" pega "Dança" e
 * "Danças"; "vocais" → "voca" pega "vocal"; "cancoes" → "canc"). Raiz com menos de 4 letras não
 * vale (fica a palavra original).
 */
export function raizSingular(p: string): string {
  let raiz = p;
  if (p.endsWith("oes")) raiz = p.slice(0, -3);
  else if (/[aeou]is$/.test(p)) raiz = p.slice(0, -2);
  else if (/[rzs]es$/.test(p)) raiz = p.slice(0, -2);
  else if (p.endsWith("s")) raiz = p.slice(0, -1);
  return raiz.length >= 4 ? raiz : p;
}

const VARIANTES_GRAFIA_ATIVIDADE: Record<string, string[]> = {
  bale: ["ballet"],
  ballet: ["bale"],
  bales: ["ballet"],
  futebol: ["futsal"],
  violao: ["viollao"],
};

export type AreaProgramacao = "CURSOS" | "ESPORTES" | "DIA A DIA";
export type ItemProgramacao = { unidade: string; titulo: string; detalhe: string; area?: AreaProgramacao | null };

/**
 * Quebra o `conteudo` de um `monthly_program` em itens ("• TÍTULO" + linha "Detalhes:").
 * O detalhe sai sem ementa, sem a frase padrão de vagas e sem "Vagas: N".
 */
export function extrairItensProgramacao(unidade: string, conteudo: string): ItemProgramacao[] {
  const itens: ItemProgramacao[] = [];
  const linhas = conteudo.split("\n");
  // S-WM-72: a seção ("== CURSOS ==", "== ESPORTES ==", "== DIA A DIA ==") vira a área do item —
  // é a área real do dado, usada para "quais cursos tem?" e para as alternativas da mesma área.
  let area: AreaProgramacao | null = null;
  for (let i = 0; i < linhas.length; i++) {
    const secao = linhas[i].match(/^==\s*(.+?)\s*==$/);
    if (secao) {
      const nome = normalizarTexto(secao[1]);
      area = nome.startsWith("curso") ? "CURSOS" : nome.startsWith("esporte") ? "ESPORTES" : nome.startsWith("dia a dia") ? "DIA A DIA" : null;
      continue;
    }
    const m = linhas[i].match(/^•\s+(.+)$/);
    if (!m) continue;
    const linhaDetalhe = (linhas[i + 1] ?? "").trim();
    let detalhe = linhaDetalhe.startsWith("Detalhes:") ? linhaDetalhe.slice("Detalhes:".length).trim() : "";
    detalhe = detalhe.split(/\s*Ementa:/)[0];
    detalhe = detalhe.replace(/\s*A quantidade de vagas muda[^.]*\./gi, "");
    detalhe = removerVagasDoTexto(detalhe).trim();
    itens.push({ unidade, titulo: m[1].trim(), detalhe, area });
  }
  return itens;
}

const UNIDADES_ORDEM = ["Cuca Barra", "Cuca Jangurussu", "Cuca Mondubim", "Cuca Pici", "Cuca José Walter"];

/**
 * S-WM-71 (Item 3): quando o lead pede "procure em outras unidades" sem citar a atividade, usa a
 * atividade da sessão — tenta a mensagem atual e depois as mensagens anteriores DO LEAD na sessão,
 * da mais recente para a mais antiga, e fica com o primeiro bloco que casar com algum título.
 */
export function montarBlocoRedeComAtividadeDaSessao(itens: ItemProgramacao[], textoAtual: string, historico: { role: string; content: string }[]): string {
  const mensagensLead = historico.filter((m) => m.role === "user").map((m) => m.content).reverse();
  const anteriores = mensagensLead[0] === textoAtual ? mensagensLead.slice(1) : mensagensLead;
  for (const texto of [textoAtual, ...anteriores]) {
    const bloco = montarBlocoProgramacaoRede(itens, palavrasChaveProgramacao(texto));
    if (bloco) return bloco;
  }
  return "";
}

// ── S-WM-72: escopo (unidade ou rede), área e contexto ───────────────────────────────────────
export const ROTULO_REDE = "Toda a Rede CUCA";
/** Valor especial para "toda a rede" — nunca vai para `unidade_selecionada`. */
export const ESCOLHA_REDE = "REDE";
export const ROTULO_AREA: Record<AreaProgramacao, string> = {
  CURSOS: "Cursos e Oficinas",
  ESPORTES: "Esportes",
  "DIA A DIA": "Dia a Dia (eventos e atividades abertas)",
};
export const PERGUNTA_AREA = "Qual área te interessa? 😊\n\n1️⃣ Cursos e Oficinas\n2️⃣ Esportes\n3️⃣ Dia a Dia (eventos e atividades abertas)";
const UNIDADES_MENU_ESCOPO = ["Cuca Barra", "Cuca Jangurussu", "Cuca Mondubim", "Cuca Pici", "Cuca José Walter"];

/** Pergunta de escopo: as 5 unidades pelo nome + "Toda a Rede CUCA". */
export function montarPerguntaEscopo(introducao: string): string {
  const linhas = UNIDADES_MENU_ESCOPO.map((u, i) => (i + 1) + "️⃣ " + u);
  linhas.push((UNIDADES_MENU_ESCOPO.length + 1) + "️⃣ " + ROTULO_REDE);
  return introducao + "\n\n" + linhas.join("\n");
}

/** Texto limpo da linha N de uma lista numerada (sem o número, o emoji e o negrito). */
export function textoDaLinhaNumerada(numero: string, bloco: string): string {
  return linhaNumeradaDaLista(numero, bloco).replace(/^[\s\d\ufe0f\u20e3.)*]+/, "").replace(/\*\*/g, "").split(/\s+[—–-]\s+/)[0].trim();
}

/**
 * S-INST-QUAL-14 (V4): a consulta de programação cuja resposta mostrou uma lista de unidades
 * (`outras_unidades`, `dia_outras_unidades`), guardada para o número que vier a seguir. `marca` é o
 * começo da resposta do bot: o número só vale se a última resposta for essa mesma.
 */
export type UltimaConsultaProgramacao = { texto: string; atividade: string | null; termos: string[]; area: AreaProgramacao | null; contexto: Record<string, unknown>; tituloExato?: string | null; marca: string };

/** Situações da consulta cuja resposta traz a lista numerada de unidades. */
export const SITUACOES_COM_LISTA_DE_UNIDADES = ["outras_unidades", "dia_outras_unidades"];

/** Começo da resposta usado como marca (sem espaços repetidos, sem emoji de número). */
export function marcaDaResposta(resposta: string): string {
  return normalizarTexto(resposta).replace(/\s+/g, " ").trim().slice(0, 60);
}

/** Unidade da linha N da lista, se a última resposta do bot for a da consulta guardada; null senão. */
export function unidadeDaListaDaConsulta(numero: string, blocoAnterior: string, consulta: UltimaConsultaProgramacao): string | null {
  if (!consulta.marca || !normalizarTexto(blocoAnterior).replace(/\s+/g, " ").includes(consulta.marca)) return null;
  const linha = linhaNumeradaDaLista(numero, blocoAnterior);
  if (!linha) return null;
  const unidades = unidadesCitadas(linha);
  if (unidades.length === 1) return unidades[0];
  if (unidades.length > 1) return null;
  return unidadeDoTituloAcima(blocoAnterior, linha);
}

/** Linha de item de lista: numerada (1️⃣, "1.", "1)") ou com marcador ("•", "-"). */
function ehLinhaDeItemNumeradoOuMarcado(linha: string): boolean {
  const t = linha.trim().replace(/\*\*/g, "").trim();
  return /^\d{1,2}(?:️?⃣|[.)])/.test(t) || /^[•\-–]\s/.test(t);
}

/**
 * S-INST-QUAL-15 (achado 1): lista numerada por curso, com a unidade como título ("**Cuca Pici:**" e,
 * embaixo, "2️⃣ Tech Start…"). Sobe a partir da linha do número, passando por outros itens e linhas
 * vazias, até o primeiro título: linha curta, sem número, que cita exatamente uma unidade. Qualquer
 * outra frase no caminho (ex.: "Porém, em outras unidades, temos:" ou a abertura "No Cuca José Walter
 * não há…", que cita a unidade CONSULTADA) encerra a busca sem unidade.
 */
function unidadeDoTituloAcima(bloco: string, linhaDoNumero: string): string | null {
  const linhas = bloco.split("\n");
  const i = linhas.indexOf(linhaDoNumero);
  for (let k = i - 1; k >= 0; k--) {
    const l = linhas[k].trim();
    if (!l || ehLinhaDeItemNumeradoOuMarcado(l)) continue;
    const titulo = l.replace(/\*\*/g, "").replace(/[:：]\s*$/, "").trim();
    const unidades = unidadesCitadas(titulo);
    const curto = titulo.length <= 40 && titulo.split(/\s+/).length <= 5 && !/[.?!]/.test(titulo);
    return curto && unidades.length === 1 ? unidades[0] : null;
  }
  return null;
}

/** Texto da linha N de uma lista numerada (1️⃣, "1.", "1)", com ou sem negrito). */
function linhaNumeradaDaLista(numero: string, bloco: string): string {
  for (const l of bloco.split("\n")) {
    const t = l.trim().replace(/[️⃣*]/g, "");
    if (t.startsWith(numero + " ") || t.startsWith(numero + ".") || t.startsWith(numero + ")")) return l;
  }
  return "";
}

/**
 * S-WM-72: resolve a resposta à pergunta de escopo — unidade (nome exato) ou `ESCOLHA_REDE`.
 * Dígito vale pela linha da lista que o bot mostrou; "toda a rede"/"todas" valem por texto; "aqui
 * mesmo"/"essa mesmo" valem a unidade atual. `undefined` quando não deu para resolver.
 */
export function resolverEscolhaDeEscopo(texto: string, blocoAnterior: string, unidadeAtual?: string | null): string | undefined {
  const norm = normalizarTexto(texto).trim();
  if (/^[1-9]$/.test(norm)) {
    const linha = linhaNumeradaDaLista(norm, blocoAnterior);
    if (!linha) return undefined;
    if (normalizarTexto(linha).includes(normalizarTexto(ROTULO_REDE))) return ESCOLHA_REDE;
    const linhaLower = linha.toLowerCase();
    return Object.entries(NOMES_UNIDADES_POR_PALAVRA).find(([k]) => contemPalavra(linhaLower, k))?.[1];
  }
  if (/\b(toda a rede|rede toda|rede inteira|toda rede|todas as unidades|em todas|todas|qualquer unidade|qualquer uma)\b/.test(norm)) return ESCOLHA_REDE;
  const porNome = Object.entries(NOMES_UNIDADES_POR_PALAVRA).find(([k]) => contemPalavra(norm, normalizarTexto(k)))?.[1];
  if (porNome) return porNome;
  if (unidadeAtual && /\b(aqui mesmo|essa mesmo|essa mesma|nessa mesmo|nessa|nesta|a mesma|mesma unidade)\b/.test(norm)) return unidadeAtual;
  return undefined;
}

/** S-WM-72 (R6): quando uma resposta pronta mostra o menu de unidades, guarda a mensagem do lead
 * como pergunta pendente — é ela que vai ser respondida quando a pessoa escolher (inclusive "6"). */
export function pendenteSeMenuDeUnidades(resposta: string, textoLead: string): Record<string, unknown> {
  return resposta.includes(ROTULO_REDE) ? { prog_pendente: { texto: textoLead, atividade: null, termos: [], area: areaPeloVocabulario(textoLead), contexto: {} } } : {};
}

/** S-WM-72: resolve a resposta à pergunta de área (dígito pela lista ou palavra). */
export function resolverEscolhaDeArea(texto: string, blocoAnterior: string): AreaProgramacao | undefined {
  const norm = normalizarTexto(texto).trim();
  const alvo = /^[1-9]$/.test(norm) ? normalizarTexto(linhaNumeradaDaLista(norm, blocoAnterior)) : norm;
  if (!alvo) return undefined;
  if (/\b(cursos?|oficinas?)\b/.test(alvo)) return "CURSOS";
  if (/\b(esportes?|modalidades?)\b/.test(alvo)) return "ESPORTES";
  if (/\b(dia a dia|eventos?)\b/.test(alvo)) return "DIA A DIA";
  return undefined;
}

/** S-WM-72: área pelo vocabulário do lead ("quais cursos" = Cursos e Oficinas). */
export function areaPeloVocabulario(texto: string): AreaProgramacao | null {
  const norm = normalizarTexto(texto);
  if (/\b(cursos?|oficinas?)\b/.test(norm)) return "CURSOS";
  if (/\b(esportes?|modalidades?|treinos?|lutas?)\b/.test(norm)) return "ESPORTES";
  if (/\b(eventos?)\b/.test(norm)) return "DIA A DIA";
  return null;
}

/** S-WM-72: pergunta geral de programação ("o que tem", "quais atividades"). */
export function ehPerguntaGeralDeProgramacao(texto: string): boolean {
  const norm = normalizarTexto(texto);
  return /\b(o que tem|o que (o )?cuca (tem|oferece)|o que voces (tem|oferecem)|quais (sao )?(as |os )?(atividades|cursos|oficinas|esportes|modalidades|opcoes)|que (cursos|atividades|esportes)|programacao)\b/.test(norm);
}

/**
 * S-WM-72 (filtro barato, sem LLM): a mensagem tem cara de programação? Título casado na
 * programação ativa, vocabulário de área ou pergunta geral. Só quando é true o interpretador
 * semântico é chamado.
 */
export function temSinalDeProgramacao(texto: string, itens: ItemProgramacao[]): boolean {
  if (areaPeloVocabulario(texto) || ehPerguntaGeralDeProgramacao(texto)) return true;
  const palavras = palavrasChaveProgramacao(texto);
  if (itensQueCasamComPalavras(itens, palavras).length > 0) return true;
  // Atividade que NÃO está na programação deste mês ("tem xadrez?") também precisa passar pelo
  // interpretador — senão cai no fluxo antigo e vira só "não tem" (decisão do Junior, 09/10).
  return palavras.length > 0 && pareceProcurarAtividade(texto);
}

/** Pergunta ou pedido de atividade ("tem ...?", "aula de", "turma de", "quero fazer/aprender"). */
export function pareceProcurarAtividade(texto: string): boolean {
  const norm = normalizarTexto(texto);
  return /\b(tem|tera|existe|existem|ha|oferece|oferecem)\b|\b(aulas?|turmas?|curso|cursos) de\b|\b(fazer|praticar|aprender|treinar|jogar|dancar|lutar)\b/.test(norm);
}

/** Faixa etária escrita no detalhe do item ("Idade: 15 a 29 anos", "Requisitos: Crianças de 07 à 12 anos"). */
export function faixaEtariaDoDetalhe(detalhe: string): string | null {
  // S-INST-QUAL-06 (item 6): fronteira de palavra — sem ela, o "idade:" de "Modalidade:" (todo item de
  // Esportes começa com "Esporte Modalidade: ...") casava antes do "(Idade: 15 a 29 anos)" real, e
  // datas como "05/11 a 25/11" viravam faixa etária.
  const idade = detalhe.match(/\bIdade:\s*([^)]+)\)/i);
  const req = detalhe.match(/Requisitos:\s*([^.]*(?:\.\d[^.]*)?)/i);
  const bruto = idade?.[1] ?? req?.[1] ?? null;
  if (!bruto) return null;
  return normalizarTexto(bruto).replace(/entre\s+(\d{1,3})\s+e\s+(\d{1,3})/, "$1 a $2");
}

/** S-WM-72 (R5): só os nomes (sem repetição) por unidade — resposta curta para "quais cursos tem?". */
export function listarNomesPorUnidade(itens: ItemProgramacao[]): string {
  return UNIDADES_ORDEM
    .map((u) => ({ u, nomes: [...new Set(itens.filter((it) => it.unidade === u).map((it) => it.titulo))] }))
    .filter((x) => x.nomes.length > 0)
    .map((x) => x.u + ": " + x.nomes.join("; "))
    .join("\n");
}

/**
 * S-WM-72 (R4): monta o bloco e a situação da consulta de programação com contexto.
 * - atividade casada: filtra pelo contexto; com escopo de unidade, procura nela, depois nas outras;
 * - só área: lista os nomes da área no escopo (com o contexto aplicado);
 * - nada: "sem_atividade".
 */
export type ConsultaComContexto = { texto: string; atividade: string | null; termos: string[]; area: AreaProgramacao | null; contexto: Record<string, unknown>; escopo: string; listarPorIdade?: boolean; tituloExato?: string | null; filtroHerdado?: string[] };
export type ResultadoConsultaComContexto = { situacao: "na_unidade" | "outras_unidades" | "nenhuma" | "rede" | "area" | "sem_atividade" | "idade" | "contexto" | "filtro_herdado" | ResultadoConsultaDia["situacao"]; bloco: string; area: AreaProgramacao | null; dia?: string; foraDoContexto?: string; filtro?: string; outrasAtividades?: OutrasAtividadesDoDia };

/**
 * S-INST-QUAL-14 (decisão c): dia ou turno que vieram da conversa (não da mensagem atual) e deixam a
 * resposta vazia → refaz sem eles e devolve `filtro_herdado`: a resposta diz que filtrou e mostra o
 * que existe nos outros dias/horários, nunca só "não tem".
 */
export function montarConsultaComContexto(itensRede: ItemProgramacao[], consulta: ConsultaComContexto): ResultadoConsultaComContexto {
  const r = montarConsultaComContextoSemHeranca(itensRede, consulta);
  const herdado = consulta.filtroHerdado ?? [];
  if (!herdado.length || (r.situacao !== "nenhuma" && r.situacao !== "dia_nenhuma")) return r;
  const contextoSemFiltro: Record<string, unknown> = { ...consulta.contexto };
  const doFiltro: Record<string, unknown> = {};
  for (const k of herdado) {
    doFiltro[k] = consulta.contexto[k];
    delete contextoSemFiltro[k];
    if (k === "dia") delete contextoSemFiltro.data;
  }
  const r2 = montarConsultaComContextoSemHeranca(itensRede, { ...consulta, contexto: contextoSemFiltro });
  if (!r2.bloco || r2.situacao === "nenhuma" || r2.situacao === "dia_nenhuma" || r2.situacao === "sem_atividade") return r;
  const filtro = descreverContexto(doFiltro);
  return { situacao: "filtro_herdado", bloco: "Com o filtro da conversa (" + filtro + ") nao ha nada. Sem esse filtro, tem:\n" + r2.bloco, area: r2.area, filtro };
}

function montarConsultaComContextoSemHeranca(itensRede: ItemProgramacao[], consulta: ConsultaComContexto): ResultadoConsultaComContexto {
  // S-INST-QUAL-13: com dia da semana na pergunta, as palavras de dia ("sábados", "fim de semana") não
  // são atividade. Sem nenhuma palavra que identifique atividade, a consulta é pelo dia (antes caía em
  // "nenhuma" quando o modelo punha "sábados" em termos_busca — 15/11, Jangurussu e sem unidade).
  const dias = diasDoContexto(consulta.contexto);
  if (dias && !consulta.tituloExato) {
    const uteis = (fontes: string[]) => [...new Set(fontes.flatMap((t) => palavrasChaveProgramacao(t)))].filter((p) => !PALAVRAS_DE_DIA.has(p) && !PALAVRAS_DE_UNIDADE.has(p));
    const daLeitura = consulta.atividade || consulta.termos.length ? uteis([consulta.atividade ?? "", ...consulta.termos]) : [];
    if (daLeitura.length) {
      // Atividade lida junto com o dia ("natação no sábado", "tem xadrez no sábado?"): caminho da
      // atividade, só com as palavras que não são de dia nem de unidade (sem casar = "nenhuma", como antes).
      consulta = { ...consulta, atividade: null, termos: daLeitura };
    } else {
      // Sem atividade na leitura: palavra que sobra do texto ("walter", "funcionando") só vira atividade
      // se casar com um título; senão, é consulta pelo dia.
      const doTexto = uteis([consulta.texto]);
      if (itensQueCasamComPalavras(itensRede, doTexto).length === 0) return consultaPorDia(itensRede, consulta, dias);
      consulta = { ...consulta, atividade: null, termos: doTexto };
    }
  }
  // S-INST-QUAL-06 (só a rota estruturada preenche os dois campos opcionais; sem eles, nada muda):
  // idade sem atividade → lista o que serve para a idade no escopo, pela faixa do texto da programação.
  if (consulta.listarPorIdade && !consulta.atividade && !consulta.termos.length && !consulta.area) {
    const daIdade = filtrarItensPorContexto(itensRede.filter((it) => consulta.escopo === ESCOLHA_REDE || it.unidade === consulta.escopo), consulta.contexto);
    // S-INST-QUAL-14: a mesma lista serve para o turno da conversa ("o que tem de noite?"), sem idade.
    const situacaoLista = consulta.contexto.idade !== undefined && consulta.contexto.idade !== null ? "idade" : "contexto";
    return daIdade.length ? { situacao: situacaoLista, bloco: listarNomesPorUnidade(daIdade), area: null } : { situacao: "nenhuma", bloco: "", area: null };
  }
  const fontesDePalavras = consulta.atividade || consulta.termos.length ? [consulta.atividade ?? "", ...consulta.termos] : [consulta.texto];
  const palavras = [...new Set(fontesDePalavras.flatMap((t) => palavrasChaveProgramacao(t)))];
  const casados = itensQueCasamComPalavras(itensRede, palavras);
  // S-INST-QUAL-06: a pessoa escolheu uma das opções da atividade ambígua — só aquele título.
  const candidatos = consulta.tituloExato ? casados.filter((it) => chaveTitulo(it.titulo) === chaveTitulo(consulta.tituloExato as string)) : casados;
  if (candidatos.length > 0) {
    const area = candidatos.find((it) => it.area)?.area ?? consulta.area;
    const filtrados = filtrarItensPorContexto(candidatos, consulta.contexto);
    // Unidades que TÊM a atividade pelo nome, mas não para o contexto informado (ex.: balé só de 15 a
    // 29 anos na Barra, para uma criança de 7). Nunca dizer que essas unidades não têm a atividade.
    const foraDoContexto = candidatos.filter((it) => !filtrados.includes(it));
    const notaForaDoContexto = foraDoContexto.length
      ? "\nTem pelo nome, mas NAO para o contexto informado (" + descreverContexto(consulta.contexto) + ") — nao diga que essas unidades nao tem a atividade:\n" + formatarItensPorUnidade(foraDoContexto, foraDoContexto)
      : "";
    if (consulta.escopo === ESCOLHA_REDE) {
      return filtrados.length ? { situacao: "rede", bloco: formatarItensPorUnidade(filtrados, filtrados) + notaForaDoContexto, area } : { situacao: "nenhuma", bloco: notaForaDoContexto.trim(), area };
    }
    const naUnidade = filtrados.filter((it) => it.unidade === consulta.escopo);
    if (naUnidade.length) return { situacao: "na_unidade", bloco: formatarItensPorUnidade(naUnidade, naUnidade), area };
    if (filtrados.length) return { situacao: "outras_unidades", bloco: formatarItensPorUnidade(filtrados, filtrados) + notaForaDoContexto, area };
    return { situacao: "nenhuma", bloco: notaForaDoContexto.trim(), area };
  }
  // Atividade identificada (pelo interpretador) que não casa com nenhum título da rede: nenhuma
  // unidade tem — o bot oferece a mesma área, nunca só "não tem". (Hotfix 17/11/2026: termos que não
  // identificam atividade já saem antes, em `semTermosGenericos`, nos dois caminhos que montam a consulta.)
  if (consulta.atividade || consulta.termos.length) return { situacao: "nenhuma", bloco: "", area: consulta.area };
  if (consulta.area) {
    const daArea = filtrarItensPorContexto(itensRede.filter((it) => it.area === consulta.area && (consulta.escopo === ESCOLHA_REDE || it.unidade === consulta.escopo)), consulta.contexto);
    return { situacao: "area", bloco: listarNomesPorUnidade(daArea), area: consulta.area };
  }
  return { situacao: "sem_atividade", bloco: "", area: null };
}

/** Contexto que a programação NÃO traz — nunca vira filtro nem afirmação de adequação. */
export const CONTEXTO_SEM_DADO = ["deficiencia", "acessibilidade", "dificuldade", "local", "bairro", "saude", "condicao"];

// ── S-INST-QUAL-13: dia da semana ───────────────────────────────────────────────────────────
// "Quais cursos tem aos sábados?" respondia "não encontrei" porque o dia não filtrava nada. O dia
// está escrito no detalhe de cada item, em três formatos: "Período: 07/11/2026 a 28/11/2026 (Sáb)"
// (cursos), "Dias: Ter e Qui" (esportes) e "Data: 07/11 a 28/11 (Sábado)" / "(Quinta-feira)" (Dia a Dia).
export type DiaSemana = "seg" | "ter" | "qua" | "qui" | "sex" | "sab" | "dom";
const DIAS_ORDEM: DiaSemana[] = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];
export const NOME_DIA: Record<DiaSemana, string> = { seg: "segunda", ter: "terça", qua: "quarta", qui: "quinta", sex: "sexta", sab: "sábado", dom: "domingo" };
// Palavras de dia que não identificam atividade — só saem das palavras-chave quando há dia na pergunta
// (fora disso a lista geral não muda: "FIM DE ANO" ou "FEIRA DE CIÊNCIAS" continuam casando).
const PALAVRAS_DE_DIA = new Set(["fds", "seg", "segunda", "ter", "terca", "qua", "quarta", "qui", "quinta", "sex", "sexta", "sab", "sabado", "dom", "domingo", "fim", "fins", "final", "finais", "semana", "feira", "feiras"]);
const RE_FIM_DE_SEMANA = /\b(fim|fins|final|finais) de semana\b|\bfds\b/;
const RE_DIA_EXTENSO = "(segunda|terca|quarta|quinta|sexta|sabado|domingo)s?(?:[- ]feiras?)?";

function diaPelaPalavra(p: string): DiaSemana | null {
  const d = p.slice(0, 3) as DiaSemana;
  return DIAS_ORDEM.includes(d) ? d : null;
}

/** "segunda a sexta" → seg, ter, qua, qui, sex (na ordem da semana). */
function diasDoIntervalo(de: DiaSemana, ate: DiaSemana): DiaSemana[] {
  const i = DIAS_ORDEM.indexOf(de);
  const j = DIAS_ORDEM.indexOf(ate);
  return i <= j ? DIAS_ORDEM.slice(i, j + 1) : [];
}

/** Dias citados num texto curto (o campo de dia do item ou o `contexto.dia` do modelo): abreviados ou por extenso. */
function diasNoTextoCurto(texto: string): Set<DiaSemana> {
  const norm = normalizarTexto(texto);
  const dias = new Set<DiaSemana>();
  if (RE_FIM_DE_SEMANA.test(norm)) { dias.add("sab"); dias.add("dom"); }
  for (const m of norm.matchAll(/\b(segunda|terca|quarta|quinta|sexta|sabado|domingo|seg|ter|qua|qui|sex|sab|dom)s?\b/g)) {
    const d = diaPelaPalavra(m[1]);
    if (d) dias.add(d);
  }
  return dias;
}

/** Dias em que o item acontece, lidos só dos campos de data/dia do detalhe (nunca de "Informações"); null = sem dia legível. */
export function diasDoItem(detalhe: string): Set<DiaSemana> | null {
  const dias = new Set<DiaSemana>();
  for (const m of normalizarTexto(detalhe).matchAll(/\b(?:periodo|data|dias?)\s*:\s*([^.]*)/g)) {
    for (const d of diasNoTextoCurto(m[1])) dias.add(d);
  }
  return dias.size ? dias : null;
}

/** Dias pedidos no contexto (`contexto.dia`, texto ou lista); null = sem dia. */
export function diasDoContexto(contexto: Record<string, unknown>): Set<DiaSemana> | null {
  const v = contexto.dia;
  const texto = Array.isArray(v) ? v.map(String).join(" e ") : typeof v === "string" ? v : "";
  const dias = texto ? diasNoTextoCurto(texto) : new Set<DiaSemana>();
  return dias.size ? dias : null;
}

/**
 * S-INST-QUAL-15 (achado 3): palavras que, logo depois de "segunda"/"2ª"…, fazem dele ordinal e não dia
 * ("2ª via", "2º grau", "na segunda semana", "de segunda mão"). Uma lista só para as duas regras.
 */
const EXCECOES_ORDINAL_DIA = "serie|series|ano|anos|vez|vezes|opcao|opcoes|turma|turmas|etapa|etapas|parte|partes|fase|fases|lugar|colocad\\w*|mao|maos|via|vias|grau|graus|semana|semanas|chamada|chamadas|edicao|edicoes";

/**
 * Dias citados na MENSAGEM do lead. Mais rígido que o texto curto: sábado e domingo valem sozinhos,
 * mas segunda a sexta só com "-feira" ou depois de "na/nas/às/aos/de/toda/todas/e/ou/até" — "a segunda
 * opção" e "quinta série" não são dia. Abreviação só "sáb"/"sab". "segunda a sexta" vira o intervalo.
 */
export function diasDaMensagem(texto: string, agora: Date = new Date()): Set<DiaSemana> {
  const norm = normalizarTexto(texto);
  const dias = new Set<DiaSemana>();
  if (RE_FIM_DE_SEMANA.test(norm)) { dias.add("sab"); dias.add("dom"); }
  // S-INST-QUAL-14: "hoje"/"amanhã" pela data de Fortaleza; "durante a semana", "dias de semana" e
  // "dia útil" = segunda a sexta; "sabadão"; "2ª/3ª… feira" (o NFD não decompõe "ª"/"º").
  const dataRelativa = dataRelativaDaMensagem(texto, agora);
  if (dataRelativa) dias.add(diaDaSemanaDaData(dataRelativa));
  if (/\bdurante a semana\b|\bdias? de semana\b|\bdias? ute?is\b|\bdia util\b|\bem dia de semana\b/.test(norm)) for (const d of diasDoIntervalo("seg", "sex")) dias.add(d);
  if (/\bsabadao\b/.test(norm)) dias.add("sab");
  const ORDINAL_DIA: Record<string, DiaSemana> = { "2": "seg", "3": "ter", "4": "qua", "5": "qui", "6": "sex" };
  for (const m of norm.matchAll(/(?:^|[^\d])([2-6])\s*[ªº°ao]?\s*-?\s*feiras?\b/g)) dias.add(ORDINAL_DIA[m[1]]);
  for (const m of norm.matchAll(new RegExp("\\b(?:na|nas|as|aos|de|toda|todas|e|ou|ate)\\s+([2-6])\\s*[ªº°](?!\\s*(?:" + EXCECOES_ORDINAL_DIA + ")\\b)", "g"))) dias.add(ORDINAL_DIA[m[1]]);
  // Dia útil solto no fim da pergunta ou junto do turno ("tem natação segunda?", "quarta à tarde"):
  // nunca depois de artigo ("a segunda?", "quero a quinta" = opção da lista).
  for (const m of norm.matchAll(/\b(segunda|terca|quarta|quinta|sexta)s?\b(?=\s*(?:[?!.,]|$|(?:a|de|pela|no|na)\s+(?:tarde|noite|manha)\b))/g)) {
    const antes = norm.slice(0, m.index ?? 0);
    if (/\b(a|o|da|do|essa|esta|aquela|uma|um)\s+$/.test(antes)) continue;
    const d = diaPelaPalavra(m[1]);
    if (d) dias.add(d);
  }
  for (const m of norm.matchAll(new RegExp("\\b" + RE_DIA_EXTENSO + "\\s+(?:a|ate)\\s+" + RE_DIA_EXTENSO + "\\b", "g"))) {
    const de = diaPelaPalavra(m[1]);
    const ate = diaPelaPalavra(m[2]);
    if (de && ate) for (const d of diasDoIntervalo(de, ate)) dias.add(d);
  }
  for (const m of norm.matchAll(/\b(sabado|domingo|sab)s?\b/g)) {
    const d = diaPelaPalavra(m[1]);
    if (d) dias.add(d);
  }
  for (const m of norm.matchAll(/\b(segunda|terca|quarta|quinta|sexta)s?[- ]feiras?\b/g)) {
    const d = diaPelaPalavra(m[1]);
    if (d) dias.add(d);
  }
  // "na quinta série", "na segunda vez", "a terça parte": ordinal, não dia.
  for (const m of norm.matchAll(new RegExp("\\b(?:na|nas|as|aos|de|toda|todas|e|ou|ate)\\s+(segunda|terca|quarta|quinta|sexta)s?\\b(?!\\s+(?:" + EXCECOES_ORDINAL_DIA + "))", "g"))) {
    const d = diaPelaPalavra(m[1]);
    if (d) dias.add(d);
  }
  return dias;
}

/**
 * Contexto do modelo com o dia só quando a mensagem ATUAL fala de dia ("tem curso sexta?", "e quarta?",
 * "fds"): aí o modelo pega formas que `diasDaMensagem` recusa de propósito. Sem palavra de dia na
 * mensagem, o dia do modelo veio de mensagens anteriores e sai.
 */
export function contextoDoModeloComDiaDaMensagem<T extends Record<string, unknown>>(contextoModelo: T, texto: string): T {
  const falaDeDia = diasDaMensagem(texto).size > 0 || /\b(fds|seg|qua|qui|sex|sab|segunda|terca|quarta|quinta|sexta|sabado|domingo|hoje|amanha|sabadao)s?\b/.test(normalizarTexto(texto));
  return falaDeDia ? contextoModelo : semDia(contextoModelo);
}

/** "sábado", "sábado e domingo", "terça, quarta e quinta" (na ordem da semana). */
export function descreverDias(dias: Set<DiaSemana>): string {
  const nomes = DIAS_ORDEM.filter((d) => dias.has(d)).map((d) => NOME_DIA[d]);
  return nomes.length <= 1 ? (nomes[0] ?? "") : nomes.slice(0, -1).join(", ") + " e " + nomes[nomes.length - 1];
}

/**
 * Contexto sem o dia (e sem a data de "hoje"/"amanhã"). S-INST-QUAL-14: o dia agora fica guardado na
 * conversa (`prog_contexto`); `semDia` só tira o dia que o MODELO leu de mensagens anteriores (o da
 * conversa vem do que foi gravado, não do modelo) e descreve o contexto que não é dia.
 */
export function semDia<T extends Record<string, unknown>>(contexto: T | null | undefined): T {
  const { dia: _dia, data: _data, ...resto } = (contexto ?? {}) as Record<string, unknown>;
  return resto as T;
}

// ── S-INST-QUAL-14: datas dos itens, "hoje"/"amanhã" e filtro da conversa ─────────────────────
const DATA_ISO_CONTEXTO = /^\d{4}-\d{2}-\d{2}$/;

function isoDe(ano: number, mes: number, dia: number): string {
  return String(ano).padStart(4, "0") + "-" + String(mes).padStart(2, "0") + "-" + String(dia).padStart(2, "0");
}

/** Dia da semana de uma data AAAA-MM-DD (meio-dia UTC: sem risco de fuso). */
export function diaDaSemanaDaData(iso: string): DiaSemana {
  const d = new Date(iso + "T12:00:00Z").getUTCDay(); // 0 = domingo
  return (["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as DiaSemana[])[d];
}

function somarDias(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Datas (AAAA-MM-DD) escritas nos campos `Período:` e `Data:` do detalhe, em ordem. Sem ano
 * ("Data: 12/11"), vale o ano que deixa a data mais perto de hoje — na virada do ano, "02/01" visto
 * em 20/12 é do ano seguinte e "20/12" visto em 05/01 é do ano anterior.
 */
export function datasDoItem(detalhe: string, hojeISO: string): string[] {
  const anoHoje = Number(hojeISO.slice(0, 4));
  const hoje = Date.parse(hojeISO + "T12:00:00Z");
  const datas: string[] = [];
  for (const campo of normalizarTexto(detalhe).matchAll(/\b(?:periodo|data)\s*:\s*([^.]*)/g)) {
    for (const m of campo[1].matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/g)) {
      const dia = Number(m[1]);
      const mes = Number(m[2]);
      if (dia < 1 || dia > 31 || mes < 1 || mes > 12) continue;
      if (m[3]) {
        datas.push(isoDe(Number(m[3]), mes, dia));
        continue;
      }
      const candidatos = [anoHoje - 1, anoHoje, anoHoje + 1].map((a) => isoDe(a, mes, dia));
      candidatos.sort((a, b) => Math.abs(Date.parse(a + "T12:00:00Z") - hoje) - Math.abs(Date.parse(b + "T12:00:00Z") - hoje));
      datas.push(candidatos[0]);
    }
  }
  return datas;
}

/** Item cuja data inteira já passou (todas as datas antes de hoje). Item sem data nunca vence. */
export function itemVencido(detalhe: string, hojeISO: string): boolean {
  const datas = datasDoItem(detalhe, hojeISO);
  return datas.length > 0 && datas.every((d) => d < hojeISO);
}

/** Itens que ainda valem hoje (decisão a do Junior, 16/11: atividade com data passada não é oferecida). */
export function itensVigentes<T extends { detalhe: string }>(itens: T[], hojeISO: string): T[] {
  return itens.filter((it) => !itemVencido(it.detalhe, hojeISO));
}

/**
 * O item acontece na data pedida ("hoje"/"amanhã")? `null` = item sem data escrita (só o dia da
 * semana decide). Intervalo ("07/11 a 28/11") vale se a data estiver dentro dele; datas soltas
 * ("12/11 e 19/11"), só se uma delas for a data. O dia da semana do item é conferido à parte.
 */
export function itemAconteceNaData(detalhe: string, dataISO: string): boolean | null {
  const datas = datasDoItem(detalhe, dataISO);
  if (!datas.length) return null;
  const temIntervalo = /\b\d{1,2}\/\d{1,2}(?:\/\d{4})?\s+a\s+\d{1,2}\/\d{1,2}/.test(normalizarTexto(detalhe));
  if (temIntervalo) return dataISO >= datas[0] && dataISO <= datas[datas.length - 1];
  return datas.includes(dataISO);
}

/** Data de "hoje" ou "amanhã" (Fortaleza) quando a mensagem pede por ela; null sem pedido. */
export function dataRelativaDaMensagem(texto: string, agora: Date = new Date()): string | null {
  const norm = normalizarTexto(texto).trim();
  const hoje = hojeFortalezaISO(agora);
  // Só quando a palavra pede a programação do dia: no fim da pergunta ("tem natação hoje?"), depois de
  // "tem/acontece/pra..." ("o que tem amanhã") ou antes de "tem"/turno ("hoje à noite"). "Queria saber
  // hoje sobre natação", "hoje em dia", "até hoje" e "até amanhã" (despedida) não filtram nada.
  const pede = (p: string) =>
    new RegExp("\\b" + p + "\\s*[?!.]*$").test(norm) ||
    new RegExp("\\b(tem|teve|acontece|rola|abre|aberto|aberta|funciona|programacao|pra|para|de)\\s+" + p + "\\b").test(norm) ||
    new RegExp("\\b" + p + "\\s+(tem|acontece|rola|abre|funciona|a tarde|a noite|de manha|pela manha|de tarde|de noite)\\b").test(norm);
  if (/\bate amanha\b|\bhoje em dia\b|\bate hoje\b|\bde hoje em diante\b/.test(norm)) return null;
  if (pede("amanha")) return somarDias(hoje, 1);
  if (pede("hoje")) return hoje;
  return null;
}

/** Data AAAA-MM-DD do contexto (`contexto.data`, gravada com "hoje"/"amanhã"); null sem data. */
export function dataDoContexto(contexto: Record<string, unknown>): string | null {
  return typeof contexto.data === "string" && DATA_ISO_CONTEXTO.test(contexto.data) ? contexto.data : null;
}

/** "hoje"/"amanhã" de um dia que já passou não valem mais: sai o dia e a data (ex.: conversa retomada). */
export function semDataVencida<T extends Record<string, unknown>>(contexto: T, hojeISO: string): T {
  const data = dataDoContexto(contexto);
  if (!data || data >= hojeISO) return contexto;
  const { dia: _dia, data: _data, ...resto } = contexto as Record<string, unknown>;
  return resto as T;
}

/** Turno válido do contexto ("manha" | "tarde" | "noite"); null sem turno. */
function turnoDoContexto(contexto: Record<string, unknown>): string | null {
  const t = typeof contexto.turno === "string" ? normalizarTexto(contexto.turno) : "";
  return t === "manha" || t === "tarde" || t === "noite" ? t : null;
}

/** O contexto filtra por dia ou turno (o "filtro da conversa" da S-INST-QUAL-14). */
export function temFiltroDeDiaOuTurno(contexto: Record<string, unknown>): boolean {
  return diasDoContexto(contexto) !== null || turnoDoContexto(contexto) !== null;
}

const RE_PALAVRA_DE_DIA = /\b(dia|dias|data|semana|fds|hoje|amanha|segunda|terca|quarta|quinta|sexta|sabado|sabados|domingo|domingos)\b/;
const RE_PALAVRA_DE_TURNO = /\b(horario|horarios|hora|horas|turno|turnos|periodo|manha|tarde|noite)\b/;

/** Última pergunta da resposta do bot (o trecho que termina no último "?"). */
function ultimaPerguntaDoBot(bloco: string): string {
  const norm = normalizarTexto(bloco);
  const fim = norm.lastIndexOf("?");
  if (fim < 0) return "";
  const antes = norm.slice(0, fim);
  const inicio = Math.max(antes.lastIndexOf("."), antes.lastIndexOf("!"), antes.lastIndexOf("\n"), antes.lastIndexOf("?"));
  return antes.slice(inicio + 1);
}

/**
 * Pedido para tirar o filtro de dia e/ou de turno (decisão c do Junior, 16/11):
 * - "qualquer dia", "todos os dias", "não importa o dia" tiram o dia; "qualquer horário/turno" tiram o
 *   turno; "qualquer dia e horário", os dois;
 * - "tanto faz"/"não importa"/"pode ser qualquer" só tiram o que a PRÓPRIA mensagem cita (dia ou
 *   horário): "não importa a idade" e "pode ser qualquer unidade" não mexem no filtro;
 * - "tanto faz" sozinho só vale como resposta a uma pergunta do bot sobre dia ou horário ("quer ver
 *   outro dia?", "de manhã ou à tarde?"). Responder à lista de unidades ou à pergunta de unidade não
 *   tira nada — a lista sempre cita o dia, mas não pergunta por ele.
 */
export function pedidoDeTirarFiltro(texto: string, ultimoBlocoBot: string): { dia: boolean; turno: boolean } {
  const norm = normalizarTexto(texto);
  let dia = /\bqualquer (dia|data)\b|\btodos os dias\b|\bnao importa o dia\b|\btanto faz o dia\b/.test(norm);
  let turno = /\bqualquer (horario|hora|turno|periodo)\b|\bqualquer dia (e|ou) (horario|hora|turno)\b|\btodos os horarios\b|\bnao importa o (horario|turno)\b|\btanto faz o (horario|turno)\b/.test(norm);
  if (/\btanto faz\b|\bnao importa\b|\bpode ser qualquer\b/.test(norm)) {
    const resto = norm.replace(/\b(tanto faz|nao importa|pode ser|qualquer|o|a|os|as|pra|para|mim|por|isso|entao|sim|ok)\b|[^a-z0-9\s]/g, " ").trim();
    if (RE_PALAVRA_DE_DIA.test(resto)) dia = true;
    if (RE_PALAVRA_DE_TURNO.test(resto)) turno = true;
    if (!resto) {
      const pergunta = ultimaPerguntaDoBot(ultimoBlocoBot);
      if (/\b(qual|que|outro|outros|algum|em qual|em que) (dia|dias|data)\b|\bque dia\b|\bdia da semana\b/.test(pergunta)) dia = true;
      if (/\b(qual|que|outro|outros|algum|em qual|em que) (horario|horarios|turno|turnos|periodo)\b|\bmanha ou (a )?tarde\b|\btarde ou (a )?noite\b|\bmanha, tarde ou noite\b/.test(pergunta)) turno = true;
    }
  }
  return { dia, turno };
}

/**
 * Contexto da conversa depois desta mensagem (S-INST-QUAL-14, decisões do Junior de 16/11):
 * - o dia e o turno guardados continuam valendo (mudar de atividade não tira o filtro);
 * - dia ou turno novos substituem os guardados (não somam); dia novo sem data tira a data de "hoje";
 * - o pedido de tirar o filtro apaga o dia/turno guardados e também o que o modelo repetiu de
 *   mensagens anteriores — só fica o que a própria mensagem escreveu.
 */
export function mesclarContextoDaConversa(
  sessao: Record<string, unknown>,
  novo: Record<string, unknown>,
  tirar: { dia: boolean; turno: boolean } = { dia: false, turno: false },
  daMensagem: Record<string, unknown> = {},
): Record<string, unknown> {
  const base: Record<string, unknown> = { ...sessao };
  const doTurno: Record<string, unknown> = { ...novo };
  if (tirar.dia) {
    delete base.dia;
    delete base.data;
    if (daMensagem.dia === undefined) { delete doTurno.dia; delete doTurno.data; }
  }
  if (tirar.turno) {
    delete base.turno;
    if (daMensagem.turno === undefined) delete doTurno.turno;
  }
  const r: Record<string, unknown> = { ...base, ...doTurno };
  if (doTurno.dia !== undefined && doTurno.data === undefined) delete r.data;
  return r;
}

/** Chaves do filtro (dia, turno) que vieram da conversa e não da mensagem atual. */
export function filtroHerdadoDoContexto(contexto: Record<string, unknown>, daMensagem: Record<string, unknown>, leituraDoTurno: Record<string, unknown> = {}): string[] {
  const herdado: string[] = [];
  // O dia do modelo só fica quando a mensagem atual fala de dia (contextoDoModeloComDiaDaMensagem): é da mensagem.
  if (diasDoContexto(contexto) && daMensagem.dia === undefined && leituraDoTurno.dia === undefined) herdado.push("dia");
  if (turnoDoContexto(contexto) && daMensagem.turno === undefined) herdado.push("turno");
  return herdado;
}

/** Item que acontece num dos dias pedidos (dia confirmado no detalhe) e, com "hoje"/"amanhã", na data. */
function itemNoDia(it: ItemProgramacao, dias: Set<DiaSemana>, dataISO: string | null = null): boolean {
  const d = diasDoItem(it.detalhe);
  if (d === null || ![...dias].some((x) => d.has(x))) return false;
  return dataISO === null || itemAconteceNaData(it.detalhe, dataISO) !== false;
}

/** Resumo de uma linha: título, área, quando e horário — para citar as outras áreas do mesmo dia (P2). */
function resumoItemNoDia(it: ItemProgramacao): string {
  const quando = it.detalhe.match(/\b(?:Per[ií]odo|Data|Dias?)\s*:\s*([^.]*)/i)?.[1]?.trim();
  const horario = it.detalhe.match(/Hor[aá]rio:\s*(\d{1,2}:\d{2}(?::\d{2})?\s*(?:as|às|a)\s*\d{1,2}:\d{2}(?::\d{2})?)/i)?.[1]?.trim();
  // Dia a Dia: o título é o programa ("COMUNIDADE EM PAUTA") e a atividade do dia vem em "Atividade:".
  const atividade = it.detalhe.match(/\bAtividade:\s*([^.]*)/)?.[1]?.trim();
  const nome = atividade && normalizarTexto(atividade) !== normalizarTexto(it.titulo) ? it.titulo + ": " + atividade : it.titulo;
  return nome + (it.area ? " (" + ROTULO_AREA[it.area] + ")" : "") + (quando ? " — " + quando : "") + (horario ? ", " + horario : "");
}

const PALAVRAS_MINUSCULAS_NO_NOME = new Set(["de", "da", "do", "das", "dos", "e", "em", "com", "para", "a", "o", "as", "os", "no", "na"]);

/** "VENHA JOGAR" → "Venha Jogar"; nome já em caixa mista fica como está. */
export function nomeLegivelDaAtividade(nome: string): string {
  const limpo = nome.replace(/\s+/g, " ").trim();
  if (limpo !== limpo.toUpperCase()) return limpo;
  return limpo.toLowerCase().split(" ").map((p, i) => (i > 0 && PALAVRAS_MINUSCULAS_NO_NOME.has(p) ? p : p.charAt(0).toUpperCase() + p.slice(1))).join(" ");
}

/** Nomes das atividades do P2, sem repetir turmas do mesmo título; no Dia a Dia vale a atividade do dia. */
function nomesDasAtividades(itens: ItemProgramacao[], comUnidade: boolean): string[] {
  const nomes: string[] = [];
  for (const it of itens) {
    // "Atividade:" só vale como nome quando é curta (no Dia a Dia, "Aulão de Capoeira"); nos Especiais
    // ela traz a descrição inteira ("A TEMPORADA DE DANÇA NA REDE CUCA É UMA AÇÃO…") e vale o título.
    const atividade = it.detalhe.match(/\bAtividade:\s*([^.]*)/)?.[1]?.trim();
    const atividadeCurta = atividade && atividade.length <= 50 && atividade.split(/\s+/).length <= 6 && !atividade.includes(",") ? atividade : null;
    const base = nomeLegivelDaAtividade(atividadeCurta && normalizarTexto(atividadeCurta) !== normalizarTexto(it.titulo) ? atividadeCurta : it.titulo);
    const nome = comUnidade ? base + " (" + it.unidade + ")" : base;
    if (base && !nomes.some((n) => chaveTitulo(n) === chaveTitulo(nome))) nomes.push(nome);
  }
  return nomes;
}

/** A resposta já cita alguma das atividades do P2 (pelo nome, sem acento nem caixa)? */
function respostaCitaAlguma(resposta: string, nomes: string[]): boolean {
  const norm = normalizarTexto(resposta).replace(/\s+/g, " ");
  return nomes.some((n) => {
    // Sem a unidade entre parênteses e sem o número do fim ("Temporada da Dança 2026" = "temporada da
    // danca"); só as três primeiras palavras, para aceitar o nome citado de forma mais curta.
    const chave = normalizarTexto(n.replace(/\s*\([^)]*\)\s*$/, "")).replace(/[^a-z0-9\s]/g, " ").replace(/(\s+\d+)+\s*$/, "").trim().split(/\s+/).slice(0, 3).join(" ");
    return chave.length >= 3 && norm.replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").includes(chave);
  });
}

/**
 * S-INST-QUAL-15 (achado 2, escolha b): o P2 da S-13 ("o que a unidade tem no dia em outras áreas")
 * deixa de depender do modelo. Se a resposta não citar nenhuma das atividades, o código acrescenta uma
 * frase com os nomes, antes da pergunta final (ou no fim, se não houver pergunta no último parágrafo).
 */
export function garantirOutrasAtividadesDoDia(resposta: string, p2: OutrasAtividadesDoDia | null | undefined): string {
  if (!p2 || !p2.nomes.length || !resposta.trim() || respostaCitaAlguma(resposta, p2.nomes)) return resposta;
  const limite = 4;
  const lista = p2.nomes.slice(0, limite);
  const nomes = lista.length === 1 ? lista[0] : lista.slice(0, -1).join(", ") + " e " + lista[lista.length - 1];
  const frase = (p2.onde === "na rede" ? "Na rede" : p2.onde.charAt(0).toUpperCase() + p2.onde.slice(1)) + ", no " + p2.dia + ", também tem: " + nomes + (p2.nomes.length > limite ? ", entre outras" : "") + ".";
  // Entra antes do fechamento: o último parágrafo curto com pergunta, exclamação, emoji no fim ou
  // despedida ("Se precisar de mais alguma informação…"). Sem fechamento, vai no fim.
  const paragrafos = resposta.trimEnd().split(/\n\s*\n/);
  const ultimo = paragrafos[paragrafos.length - 1].trim();
  const ehFechamento = ultimo.length <= 200 && (ultimo.includes("?") || /[!\u{1F300}-\u{1FAFF}\u2600-\u27BF]\s*$/u.test(ultimo) || /^(se |qualquer |caso )/i.test(ultimo));
  if (paragrafos.length > 1 && ehFechamento) {
    return [...paragrafos.slice(0, -1), frase, ultimo].join("\n\n");
  }
  return resposta.trimEnd() + "\n\n" + frase;
}

/** S-INST-QUAL-15 (achado 2): o P2 em forma de dado — onde, em que dia e os nomes das atividades. */
export type OutrasAtividadesDoDia = { onde: string; dia: string; nomes: string[] };

type ResultadoConsultaDia = { situacao: "dia_na_unidade" | "dia_outras_unidades" | "dia_rede" | "dia_fora_do_contexto" | "dia_nenhuma"; bloco: string; area: AreaProgramacao | null; dia: string; foraDoContexto?: string; outrasAtividades?: OutrasAtividadesDoDia };

/**
 * S-INST-QUAL-13 (P1 e P2, Junior, 16/11): pergunta por dia da semana sem atividade ("quais cursos tem aos
 * sábados?", "o que tem no domingo?"). Só entram itens com o dia confirmado no detalhe — afirmar "tem no
 * sábado" exige o dado. O resto do contexto (idade, gênero, turno) também vale.
 * - unidade com a área no dia: lista;
 * - unidade sem, outras com (P1): diz que a unidade não tem e lista as outras unidades;
 * - em todos os casos com área, as outras áreas da unidade no mesmo dia vão numa linha (P2).
 */
export function consultaPorDia(
  itensRede: ItemProgramacao[],
  consulta: { area: AreaProgramacao | null; contexto: Record<string, unknown>; escopo: string },
  dias: Set<DiaSemana>,
): ResultadoConsultaDia {
  const area = consulta.area;
  const dia = descreverDias(dias);
  const rotulo = area ? ROTULO_AREA[area] : "atividades";
  const doDia = itensRede.filter((it) => itemNoDia(it, dias, dataDoContexto(consulta.contexto)));
  const comContexto = filtrarItensPorContexto(doDia, consulta.contexto);
  const daArea = (it: ItemProgramacao) => !area || it.area === area;
  const alvo = comContexto.filter(daArea);
  const outroContexto = descreverContexto(semDia(consulta.contexto));
  const foraDoContexto = doDia.filter(daArea).filter((it) => !comContexto.includes(it));
  const nota = (itens: ItemProgramacao[]) => itens.length && outroContexto
    ? "\n\nTem " + rotulo + " no " + dia + ", mas NAO para o contexto informado (" + outroContexto + ") — nao diga que essas unidades nao tem:\n" + formatarItensPorUnidade(itens, itens)
    : "";
  // S-INST-QUAL-15 (achado 2): além do texto do bloco, guarda os nomes do P2 para o código garantir a
  // frase na resposta quando o modelo não os citar.
  let outrasAtividades: OutrasAtividadesDoDia | undefined;
  const outrasAreas = (pred: (it: ItemProgramacao) => boolean, titulo: string, onde: string) => {
    if (!area) return "";
    const itens = comContexto.filter((it) => it.area !== area && pred(it));
    if (!itens.length) return "";
    outrasAtividades = { onde, dia, nomes: nomesDasAtividades(itens, consulta.escopo === ESCOLHA_REDE) };
    return "\n\n" + titulo + ":\n" + itens.map((it) => "• " + (consulta.escopo === ESCOLHA_REDE ? it.unidade + ": " : "") + resumoItemNoDia(it)).join("\n");
  };
  const comP2 = (r: ResultadoConsultaDia): ResultadoConsultaDia => (outrasAtividades ? { ...r, outrasAtividades } : r);

  // Tem no dia, mas nada serve para o resto do contexto (ex.: "turno: noite" da conversa): nunca "nenhuma".
  const soForaDoContexto = (itens: ItemProgramacao[], extra: string): ResultadoConsultaDia => comP2({
    situacao: "dia_fora_do_contexto",
    bloco: "Tem " + rotulo + " no " + dia + ", mas NAO para o contexto informado (" + outroContexto + "):\n" + formatarItensPorUnidade(itens, itens) + extra,
    area,
    dia,
    foraDoContexto: outroContexto,
  });
  if (consulta.escopo === ESCOLHA_REDE) {
    if (alvo.length) return { situacao: "dia_rede", bloco: rotulo + " no " + dia + ", por unidade:\n" + formatarItensPorUnidade(alvo, alvo) + nota(foraDoContexto), area, dia };
    const p2Rede = outrasAreas(() => true, "Outras atividades no " + dia + " na rede (outras areas)", "na rede");
    if (foraDoContexto.length && outroContexto) return soForaDoContexto(foraDoContexto, p2Rede);
    return comP2({ situacao: "dia_nenhuma", bloco: p2Rede.trim(), area, dia });
  }
  const unidade = consulta.escopo;
  const naUnidade = alvo.filter((it) => it.unidade === unidade);
  const p2 = outrasAreas((it) => it.unidade === unidade, "Outras atividades no " + unidade + " no " + dia + " (outras areas)", "no " + unidade);
  if (naUnidade.length) {
    return comP2({ situacao: "dia_na_unidade", bloco: rotulo + " no " + dia + " no " + unidade + ":\n" + formatarItensPorUnidade(naUnidade, naUnidade) + p2, area, dia });
  }
  const outras = alvo.filter((it) => it.unidade !== unidade);
  const foraNaUnidade = foraDoContexto.filter((it) => it.unidade === unidade);
  if (outras.length) {
    return comP2({
      situacao: "dia_outras_unidades",
      bloco: "No " + unidade + " NAO ha " + rotulo + " no " + dia + " na programacao deste mes.\n\n" + rotulo + " no " + dia + " em outras unidades:\n" + formatarItensPorUnidade(outras, outras) + p2 + nota(foraNaUnidade),
      area,
      dia,
    });
  }
  if (foraDoContexto.length && outroContexto) return soForaDoContexto(foraDoContexto, p2);
  return comP2({ situacao: "dia_nenhuma", bloco: p2.trim(), area, dia });
}

/**
 * S-WM-72 (R4): aplica o contexto que EXISTE nos dados — idade (faixa no detalhe), gênero
 * ("Público: Feminino/Masculino/Misto") e turno (primeiro horário do detalhe). Item sem o dado
 * correspondente fica (não esconder turma por falta de informação). Diferente de
 * `filtrarLinhasPorIdade`, aqui o vazio é um resultado válido: é ele que dispara a busca nas outras
 * unidades.
 */
export function filtrarItensPorContexto(itens: ItemProgramacao[], contexto: Record<string, unknown>): ItemProgramacao[] {
  const idade = typeof contexto.idade === "number" ? contexto.idade : typeof contexto.idade === "string" && /^\d{1,3}$/.test(contexto.idade.trim()) ? Number(contexto.idade) : null;
  const genero = typeof contexto.genero === "string" ? normalizarTexto(contexto.genero) : "";
  const turno = typeof contexto.turno === "string" ? normalizarTexto(contexto.turno) : "";
  // S-INST-QUAL-13: dia da semana. Item sem dia legível fica, como na idade e no turno.
  const dias = diasDoContexto(contexto);
  // S-INST-QUAL-14: "hoje"/"amanhã" gravam a data; item com data escrita só fica se acontecer nela.
  const data = dataDoContexto(contexto);
  return itens.filter((it) => {
    if (dias) {
      const diasItem = diasDoItem(it.detalhe);
      if (diasItem && ![...dias].some((d) => diasItem.has(d))) return false;
    }
    if (data && itemAconteceNaData(it.detalhe, data) === false) return false;
    if (idade !== null) {
      const faixa = faixaEtariaDoDetalhe(it.detalhe);
      if (faixa && faixaAceitaIdade(faixa, idade) === false) return false;
    }
    // Gênero só separa turma em Esportes (limitação física/psicossocial); curso e Dia a Dia não têm
    // essa distinção. Misto e Público vazio continuam aparecendo (não foi determinado).
    if ((genero.startsWith("fem") || genero.startsWith("masc")) && (!it.area || it.area === "ESPORTES")) {
      const publico = it.detalhe.match(/P[uú]blico:\s*(Feminino|Masculino|Misto)/i)?.[1]?.toLowerCase();
      if (publico && publico !== "misto" && !publico.startsWith(genero.slice(0, 3))) return false;
    }
    if (turno === "manha" || turno === "tarde" || turno === "noite") {
      const h = it.detalhe.match(/(\d{1,2}):\d{2}\s*(?:as|às|a)\s*\d{1,2}:\d{2}/i);
      if (h) {
        const hora = Number(h[1]);
        const turnoItem = hora < 12 ? "manha" : hora < 18 ? "tarde" : "noite";
        if (turnoItem !== turno) return false;
      }
    }
    return true;
  });
}

/** Descrição curta do contexto para as instruções do prompt ("idade: 7, genero: feminino"). */
export function descreverContexto(contexto: Record<string, unknown>): string {
  return Object.entries(contexto)
    .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
    .map(([k, v]) => k + ": " + String(v))
    .join(", ");
}

/**
 * S-WM-72 (avaliação com o modelo real, 10/10): o que a MENSAGEM ATUAL diz, extraído sem LLM.
 * - escopo: unidade citada pelo nome ou pedido de rede — o interpretador chegou a deduzir a unidade
 *   pela resposta da Maria; aqui só vale o que o lead escreveu;
 * - contexto: idade, turno e gênero ditos na própria mensagem (o modelo às vezes não os põe).
 */
export function lerMensagemAtual(texto: string, agora: Date = new Date()): { escopo: string | null; contexto: Record<string, string | number> } {
  const norm = normalizarTexto(texto);
  const unidade = /^\s*\d{1,2}\s*$/.test(norm) ? undefined : detectarUnidadeDireta(texto);
  const rede = /\b(toda a rede|rede toda|rede inteira|toda rede|todas as unidades|em todas|em quais (unidades|cucas)|nas outras unidades|outros cucas|qualquer unidade)\b/.test(norm);
  const contexto: Record<string, string | number> = {};
  const idade = extrairIdadeDaMensagem(texto);
  if (idade !== null) contexto.idade = idade;
  if (/\b(a|de|pela|durante a) noite\b|\bnoturno|\bnoturna/.test(norm)) contexto.turno = "noite";
  else if (/\b(a|de|pela) tarde\b|\bvespertin/.test(norm)) contexto.turno = "tarde";
  else if (/\b(de|pela|a) manha\b|\bmatutin|\bcedo\b/.test(norm)) contexto.turno = "manha";
  if (/\bfeminin|\bmeninas\b|\bmulheres\b/.test(norm)) contexto.genero = "feminino";
  else if (/\bmasculin|\bmeninos\b|\bhomens\b/.test(norm)) contexto.genero = "masculino";
  // S-INST-QUAL-13: dia da semana escrito na mensagem ("aos sábados", "no domingo", "fim de semana").
  const dias = diasDaMensagem(texto, agora);
  if (dias.size) contexto.dia = descreverDias(dias);
  // S-INST-QUAL-14: "hoje"/"amanhã" gravam também a data, para o item de data marcada (Dia a Dia).
  const data = dataRelativaDaMensagem(texto, agora);
  if (data && dias.size === 1) contexto.data = data;
  return { escopo: unidade ?? (rede ? ESCOLHA_REDE : null), contexto };
}

/** Junta a interpretação do modelo com o que a mensagem atual diz: o escopo é SÓ o da mensagem;
 * o contexto da mensagem atual entra por cima do que o modelo inferiu. */
export function consolidarInterpretacao(interp: InterpretacaoTurno, texto: string): InterpretacaoTurno {
  const lido = lerMensagemAtual(texto);
  // O modelo às vezes devolve a atividade sem as variações de grafia — a busca usa a própria atividade.
  const termos = interp.termos_busca.length || !interp.atividade ? interp.termos_busca : palavrasChaveProgramacao(interp.atividade);
  // S-INST-QUAL-13: o dia vem só da mensagem atual (o modelo lê a sessão inteira e repetiria o de antes).
  const base = { ...interp, termos_busca: termos, escopo: lido.escopo, contexto: { ...contextoDoModeloComDiaDaMensagem(interp.contexto, texto), ...lido.contexto } };
  // "quais cursos tem?" no meio da conversa de natação: a palavra "curso" define a área — não existe
  // curso de modalidade esportiva. Só quando a atividade NÃO está escrita na mensagem (veio da
  // conversa) e não é ela mesma um curso; "tem curso de natação?" continua natação (Esportes).
  if (areaPeloVocabulario(texto) === "CURSOS" && interp.atividade && interp.area !== "CURSOS" && !atividadeEscritaNaMensagem(interp.atividade, texto)) {
    return { ...base, atividade: null, termos_busca: [], area: "CURSOS" };
  }
  return base;
}

/** A atividade (ou uma das palavras dela) aparece escrita na própria mensagem. */
export function atividadeEscritaNaMensagem(atividade: string, texto: string): boolean {
  const naMensagem = new Set(palavrasChaveProgramacao(texto));
  return palavrasChaveProgramacao(atividade).some((p) => naMensagem.has(p));
}

const PALAVRAS_DE_UNIDADE = new Set(Object.keys(NOMES_UNIDADES_POR_PALAVRA).flatMap((k) => normalizarTexto(k).split(/[^a-z0-9]+/)).filter(Boolean));

/**
 * S-WM-72 (C1): com o menu de unidades na tela, a mensagem é uma pergunta NOVA (e não a escolha)
 * quando traz atividade da programação diferente da pendente ("tem natação no Pici?" depois de
 * perguntar de capoeira) ou outra área pelo vocabulário ("quais cursos tem no Pici?"). Número,
 * nome de unidade, "toda a rede" e a mesma atividade com a unidade continuam sendo a escolha.
 */
export function respostaTrazPerguntaNova(texto: string, pendente: { atividade?: string | null; termos?: string[]; area?: AreaProgramacao | null }, itens: ItemProgramacao[]): boolean {
  if (/^\s*\d{1,2}\s*$/.test(texto)) return false;
  const area = areaPeloVocabulario(texto);
  if (area && area !== pendente.area) return true;
  const doPendente = new Set([...(pendente.termos ?? []).map(normalizarTexto), ...(pendente.atividade ? palavrasChaveProgramacao(pendente.atividade) : [])]);
  const novas = palavrasChaveProgramacao(texto).filter((p) => !PALAVRAS_DE_UNIDADE.has(p) && !doPendente.has(p));
  return novas.length > 0 && itensQueCasamComPalavras(itens, novas).length > 0;
}

export type InterpretacaoTurno = {
  tipo: "pergunta_programacao" | "continuacao" | "afirmacao" | "nao_programacao" | "cortesia_ou_saida";
  atividade: string | null;
  termos_busca: string[];
  area: AreaProgramacao | null;
  contexto: Record<string, string | number | boolean>;
  /** unidade exata (uma das 5), `ESCOLHA_REDE`, ou null quando a mensagem não diz. */
  escopo: string | null;
};

export const INTERPRETACAO_PADRAO: InterpretacaoTurno = { tipo: "nao_programacao", atividade: null, termos_busca: [], area: null, contexto: {}, escopo: null };

/** Valida o JSON do interpretador — nunca confia cegamente no LLM (mesmo padrão de validarAvaliacaoSelecaoUnidade). */
export function validarInterpretacaoTurno(data: unknown): InterpretacaoTurno {
  const obj = (data && typeof data === "object") ? data as Record<string, unknown> : {};
  const tipos = ["pergunta_programacao", "continuacao", "afirmacao", "nao_programacao", "cortesia_ou_saida"];
  const tipo = (typeof obj.tipo === "string" && tipos.includes(obj.tipo) ? obj.tipo : "nao_programacao") as InterpretacaoTurno["tipo"];
  const areas: AreaProgramacao[] = ["CURSOS", "ESPORTES", "DIA A DIA"];
  const area = typeof obj.area === "string" && (areas as string[]).includes(obj.area) ? obj.area as AreaProgramacao : null;
  const atividade = typeof obj.atividade === "string" && obj.atividade.trim() ? obj.atividade.trim().slice(0, 80) : null;
  const termos = Array.isArray(obj.termos_busca) ? obj.termos_busca.filter((t): t is string => typeof t === "string" && t.trim() !== "").slice(0, 6).map((t) => t.slice(0, 40)) : [];
  const contexto: Record<string, string | number | boolean> = {};
  if (obj.contexto && typeof obj.contexto === "object") {
    for (const [k, v] of Object.entries(obj.contexto as Record<string, unknown>).slice(0, 12)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") contexto[normalizarTexto(k).slice(0, 30)] = typeof v === "string" ? v.slice(0, 80) : v;
    }
  }
  const escopoBruto = typeof obj.escopo === "string" ? obj.escopo : null;
  const escopo = escopoBruto === ESCOLHA_REDE ? ESCOLHA_REDE : (escopoBruto && UNIDADES_VALIDAS.includes(escopoBruto) ? escopoBruto : null);
  return { tipo, atividade, termos_busca: termos, area, contexto, escopo };
}

/**
 * Monta o bloco de programação da rede inteira filtrado pela pergunta, a partir SÓ dos
 * `monthly_program` ativos (uma por unidade). Retorna "" quando nenhuma palavra da mensagem
 * casa com título de atividade — o caller trata como "não é pergunta de programação / não
 * encontrado". Acima de `limiteCaracteres`, cai para só os títulos por unidade.
 */
export function montarBlocoProgramacaoRede(itens: ItemProgramacao[], palavras: string[], limiteCaracteres = 12000): string {
  return formatarItensPorUnidade(itensQueCasamComPalavras(itens, palavras), itens, limiteCaracteres);
}

/**
 * Itens cujo título casa com as palavras da pergunta (ver regras abaixo). Vazio quando nenhuma
 * palavra casa. Separado de `formatarItensPorUnidade` para a S-WM-72 poder filtrar por contexto
 * (idade, gênero, turno) entre o casamento e a formatação.
 */
export function itensQueCasamComPalavras(itens: ItemProgramacao[], palavras: string[]): ItemProgramacao[] {
  if (palavras.length === 0) return [];
  // Compara em forma compacta (sem espaço nem hífen), sempre a partir do INÍCIO de uma palavra
  // do título: "jiujitsu", "jiu-jitsu" e "jiu jitsu" casam com "JIU-JITSU", "JIU JITSU" e
  // "JIUJITSU"; "danca" pega "Danças"; "arte" não pega "Karatê". Duas palavras vizinhas da
  // pergunta que casam juntas ("muay"+"thai" → "MUAYTHAI") contam como as duas. Ficam só os
  // itens com mais pontos ("natação infantil" → só NATAÇÃO INFANTIL, não toda a natação).
  const pontos = (it: ItemProgramacao) => {
    const palavrasTitulo = normalizarTexto(it.titulo).split(/[^a-z0-9]+/).filter(Boolean);
    const sufixos = palavrasTitulo.map((_, i) => palavrasTitulo.slice(i).join(""));
    const casa = (p: string) => sufixos.some((sx) => sx.startsWith(p));
    let total = 0;
    for (let j = 0; j < palavras.length; j++) {
      if (j + 1 < palavras.length && casa(palavras[j] + palavras[j + 1])) {
        total += 2;
        j++;
      } else if (casa(palavras[j])) {
        total += 1;
      }
    }
    return total;
  };
  const melhor = itens.reduce((m, it) => Math.max(m, pontos(it)), 0);
  if (melhor === 0) return [];
  return itens.filter((it) => pontos(it) === melhor);
}

/** Formata itens já escolhidos, agrupados por unidade, com o rodapé das unidades (de `todosItens`)
 * onde nada foi encontrado pelo nome. Acima do limite, só os títulos. */
export function formatarItensPorUnidade(encontrados: ItemProgramacao[], todosItens: ItemProgramacao[], limiteCaracteres = 12000): string {
  if (encontrados.length === 0) return "";
  const itens = todosItens;

  const unidadesComProgramacao = [...new Set(itens.map((it) => it.unidade))];
  const unidadesComMatch = UNIDADES_ORDEM.filter((u) => encontrados.some((it) => it.unidade === u));
  const unidadesSemMatch = UNIDADES_ORDEM.filter((u) => unidadesComProgramacao.includes(u) && !unidadesComMatch.includes(u));
  const rodape = unidadesSemMatch.length > 0
    // Não afirma ausência: a programação pode trazer a mesma atividade com outro nome ou com erro
    // de digitação ("Balé" x "Ballet", "Viollão"). O bot só pode dizer que não encontrou pelo nome.
    ? "\nNao encontrada pelo nome na programacao de: " + unidadesSemMatch.join(", ") + " — se a pessoa se interessar por uma dessas unidades, NAO afirme que ela nao tem a atividade; diga que nao encontrou pelo nome e sugira confirmar direto com a unidade."
    : "";

  const completo = unidadesComMatch.map((u) =>
    u + ":\n" + encontrados.filter((it) => it.unidade === u).map((it) => "• " + it.titulo + (it.detalhe ? " — " + it.detalhe : "")).join("\n")
  ).join("\n\n");
  if (completo.length <= limiteCaracteres) return completo + rodape;

  const resumido = unidadesComMatch.map((u) => {
    const contagem = new Map<string, number>();
    for (const it of encontrados.filter((e) => e.unidade === u)) contagem.set(it.titulo, (contagem.get(it.titulo) ?? 0) + 1);
    return u + ": " + [...contagem.entries()].map(([t, n]) => n > 1 ? t + " (" + n + " turmas)" : t).join("; ");
  }).join("\n");
  return resumido + "\n(Lista resumida: para dias e horarios, pergunte de qual unidade a pessoa quer saber.)" + rodape;
}

export type DecisaoPrimeiraMensagem = {
  unidadeSelecionada: string | null;
  aguardandoUnidade: boolean;
  /** null significa "unidade resolvida, siga o fluxo normal" — mesma convenção de
   * DecisaoAguardandoUnidade.resposta. */
  resposta: string | null;
  /** S-WM-34 (VAL-23): ver DecisaoAguardandoUnidade.pedidoEspecifico — mesmo contrato. */
  pedidoEspecifico?: boolean;
};

/**
 * Backlog 4b: saudação de abertura pro fallback de decidirPrimeiraMensagem (1ª mensagem sem
 * nome direto de unidade E sem pergunta_geral) — hoje esse branch nunca chama GPT (retorna só
 * texto fixo) e não deve passar a chamar só por causa da saudação. Mesmo espírito do TOM-05
 * (fixas rotativas): aqui vale o custo de manter variações porque é o primeiro contato do lead
 * com a Maria — ao contrário dos ramos genéricos de TOM-05, que preferiram o approach mais
 * barato (evitarRepeticaoLiteral) por serem muitos ramos diferentes.
 */
export const SAUDACOES_ABERTURA: string[] = [
  "Oi! Que bom te ver por aqui! 😊",
  "Olá! Seja muito bem-vindo(a) à Rede CUCA! 🎉",
  "E aí! Fico super feliz com seu interesse no CUCA! 😊",
  "Oi, oi! Bora conhecer tudo que o CUCA tem pra você? 🎉",
  "Olá! Que legal ter você aqui com a gente! ✨",
  "Oi! Bem-vindo(a)! Vamos descobrir o CUCA juntos? 😊",
];

/**
 * Decide o que fazer na 1ª mensagem de uma conversa em unidade_cuca='Geral' (sem
 * aguardando_unidade nem unidade_selecionada em metadata ainda).
 * AUD-07: se o lead já citar a unidade na própria 1ª mensagem ("quero saber da Barra"),
 * resolve direto (reaproveitando detectarUnidadeDireta, a mesma detecção usada em
 * decidirAguardandoUnidade) em vez de sempre pedir o menu de novo, evitando uma rodada extra.
 * VAL-12: assinatura espelha decidirAguardandoUnidade (recebe a detecção direta E a avaliação
 * semântica já prontas, em vez do texto cru) — o caller (handler) chama avaliarSelecaoUnidade
 * antes, mesmo padrão de duas etapas já usado no branch aguardando_unidade, mantendo esta
 * função pura e testável sem mock de fetch.
 */
export function decidirPrimeiraMensagem(
  unidadeDetectadaDireta: string | undefined,
  avaliacaoSemantica: AvaliacaoSelecaoUnidade,
  textoOriginal = "",
  cortesia?: boolean,
): DecisaoPrimeiraMensagem {
  if (unidadeDetectadaDireta) {
    return { unidadeSelecionada: unidadeDetectadaDireta, aguardandoUnidade: false, resposta: null, pedidoEspecifico: mensagemTemPedidoEspecifico(textoOriginal) };
  }
  if (avaliacaoSemantica.unidade) {
    return { unidadeSelecionada: avaliacaoSemantica.unidade, aguardandoUnidade: false, resposta: null, pedidoEspecifico: avaliacaoSemantica.pedido_depende_unidade === true };
  }
  if (avaliacaoSemantica.pergunta_geral) {
    // VAL-12: pergunta institucional real já na 1ª mensagem — não força o menu, segue pro
    // fluxo normal (Passo 6, RAG geral) pra responder de verdade.
    return { unidadeSelecionada: null, aguardandoUnidade: false, resposta: null };
  }
  const saudacao = SAUDACOES_ABERTURA[Math.floor(Math.random() * SAUDACOES_ABERTURA.length)];
  if (!avaliacaoSemantica.pedido_depende_unidade) {
    // Item 1 (S-WM-21): nem unidade direta, nem pergunta_geral, nem um pedido que realmente
    // dependa de saber a unidade (cursos/horários/programação) — é cortesia pura ou mensagem
    // aberta ("oi", "quero saber sobre vocês"). Responde só com saudação + pergunta aberta,
    // SEM o menu — o menu engessado em cima de toda saudação era exatamente o comportamento
    // reportado em produção. aguardandoUnidade=false: a próxima mensagem volta a cair neste
    // mesmo branch (não trava esperando dígito de menu) e é reavaliada do zero — pode virar
    // pedido unit-dependente, pergunta_geral ou unidade direta a qualquer momento.
    // Hotfix 05/11/2026: mensagem que não é cumprimento puro ("não consigo acessar o portal") segue
    // pro fluxo normal em vez de receber só a saudação.
    // S-INST-QUAL-05: `cortesia` vem do handler (rajada inteira avaliada mensagem por mensagem, e
    // false quando a última resposta do bot já foi a frase pronta). Sem ele, vale só `textoOriginal`.
    if (!(cortesia ?? ehCortesiaPura(textoOriginal))) return { unidadeSelecionada: null, aguardandoUnidade: false, resposta: null };
    return { unidadeSelecionada: null, aguardandoUnidade: false, resposta: saudacao + "\n\nEm que posso te ajudar? 😊" };
  }
  // Backlog 4b / Item 1: pedido que depende de unidade (ex.: "quais cursos vocês têm"), sem
  // dizer qual — aí sim mostra o menu, comportamento já existente preservado. NÃO mexe no
  // branch de unidadeDetectadaDireta acima, que já cai no fluxo de GPT (que já combina saudação
  // e menu sozinho, ver prompt_sistema "PRIMEIRA INTERAÇÃO").
  return { unidadeSelecionada: null, aguardandoUnidade: true, resposta: saudacao + "\n\n" + MENU_UNIDADES };
}

// ── S-INST-QUAL-06: rota estruturada (um classificador só, decisão em código) ─────────────────
// Uma leitura por IA (`lerTurnoInstitucional`) devolve um objeto estruturado; `decidirRota`, função
// pura, decide o que fazer. Só Institucional/maria no número Geral, e só com a chave
// `rota_estruturada = 'on'` em `system_config`. Se a leitura falhar (erro, mais de 5 s ou JSON
// inválido), a rota antiga roda sem nenhuma mudança e o turno é registrado com `rota_fallback`.
// Com a chave em `off` (ou sem a linha), nada desta seção é chamado.

export const CHAVE_ROTA_ESTRUTURADA = "rota_estruturada";
// 5 s (decisão do Junior, 14/11): com 3 s, numa lentidão da OpenAI durante o gabarito, 36 de 77
// turnos caíram no plano B.
export const LEITURA_TIMEOUT_MS = 5000;
export const MARCADOR_LEITURA_TURNO = "LEITURA DO TURNO (rota estruturada)";
const CHAVE_ROTA_TTL_MS = 60 * 1000;
let chaveRotaCache: { valor: boolean; expiraEm: number } = { valor: false, expiraEm: 0 };

export function redefinirCacheRotaEstruturada(): void { chaveRotaCache = { valor: false, expiraEm: 0 }; }

/** `true` só com `system_config.rota_estruturada = 'on'`. Linha ausente, outro valor ou erro de
 * leitura = `false` (rota antiga). Cache de 60 s em produção, para não somar uma ida ao banco por
 * mensagem; sem cache nos testes e no gabarito (`usarCache = false`). */
export async function lerChaveRotaEstruturada(supabase: ReturnType<typeof createClient<Database>>, usarCache = true): Promise<boolean> {
  if (usarCache && Date.now() < chaveRotaCache.expiraEm) return chaveRotaCache.valor;
  let valor = false;
  try {
    // deno-lint-ignore no-explicit-any
    const { data } = await (supabase as any).from("system_config").select("valor").eq("chave", CHAVE_ROTA_ESTRUTURADA).maybeSingle();
    valor = typeof data?.valor === "string" && data.valor.trim().toLowerCase() === "on";
  } catch (exc) {
    console.error("[motor-agente v18] leitura da chave rota_estruturada falhou, rota antiga:", exc);
  }
  if (usarCache) chaveRotaCache = { valor, expiraEm: Date.now() + CHAVE_ROTA_TTL_MS };
  return valor;
}

export type TipoLeitura = "saudacao" | "cortesia" | "despedida" | "pedido_humano" | "outro_canal" | "vagas_ambiguo" | "so_unidade" | "continuacao" | "pedido_novo";
export type AssuntoLeitura = "programacao" | "o_que_tem" | "institucional";
export type LeituraTurno = {
  tipo: TipoLeitura;
  assunto: AssuntoLeitura | null;
  /** uma das 5 unidades, "varias" (duas ou mais, sem escolher) ou null. */
  unidade_citada: string | null;
  /** uma das 5 unidades, `ESCOLHA_REDE` ou "nao_disse". */
  escopo: string;
  canal: CanalEncaminhamento | null;
  atividade: string | null;
  termos_busca: string[];
  area: AreaProgramacao | null;
  idade: number | null;
  contexto: Record<string, string | number | boolean>;
};

const TIPOS_LEITURA: TipoLeitura[] = ["saudacao", "cortesia", "despedida", "pedido_humano", "outro_canal", "vagas_ambiguo", "so_unidade", "continuacao", "pedido_novo"];
const ASSUNTOS_LEITURA: AssuntoLeitura[] = ["programacao", "o_que_tem", "institucional"];
export const UNIDADE_VARIAS = "varias";
export const ESCOPO_NAO_DISSE = "nao_disse";

/** Valida o JSON da leitura. `null` = leitura inválida (o caller cai na rota antiga, plano B). Nunca
 * confia cegamente no modelo: tipo fora da lista invalida tudo; os outros campos viram vazio. */
export function validarLeituraTurno(data: unknown): LeituraTurno | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const obj = data as Record<string, unknown>;
  if (typeof obj.tipo !== "string" || !(TIPOS_LEITURA as string[]).includes(obj.tipo)) return null;
  const tipo = obj.tipo as TipoLeitura;
  const base = validarInterpretacaoTurno({ tipo: "nao_programacao", atividade: obj.atividade, termos_busca: obj.termos_busca, area: obj.area, contexto: obj.contexto, escopo: null });
  let assunto = typeof obj.assunto === "string" && (ASSUNTOS_LEITURA as string[]).includes(obj.assunto) ? obj.assunto as AssuntoLeitura : null;
  const idadeBruta = typeof obj.idade === "number" ? obj.idade : typeof obj.idade === "string" && /^\d{1,3}$/.test(obj.idade.trim()) ? Number(obj.idade) : null;
  const idade = idadeBruta !== null && Number.isInteger(idadeBruta) && idadeBruta > 0 && idadeBruta < 120 ? idadeBruta : null;
  if (!assunto && (tipo === "pedido_novo" || tipo === "continuacao")) assunto = base.atividade || base.area || idade !== null ? "programacao" : "institucional";
  const unidadeBruta = typeof obj.unidade_citada === "string" ? obj.unidade_citada : null;
  const unidade_citada = unidadeBruta === UNIDADE_VARIAS ? UNIDADE_VARIAS : unidadeBruta && UNIDADES_VALIDAS.includes(unidadeBruta) ? unidadeBruta : null;
  const escopoBruto = typeof obj.escopo === "string" ? obj.escopo : "";
  const escopo = escopoBruto === ESCOLHA_REDE ? ESCOLHA_REDE : UNIDADES_VALIDAS.includes(escopoBruto) ? escopoBruto : ESCOPO_NAO_DISSE;
  const canal = validarCanalEncaminhamento(typeof obj.canal === "string" ? obj.canal : null);
  // Encaminhamento sem canal válido não tem o que encaminhar: vira pedido comum.
  if (tipo === "outro_canal" && !canal) return { tipo: "pedido_novo", assunto: assunto ?? "institucional", unidade_citada, escopo, canal: null, atividade: base.atividade, termos_busca: base.termos_busca, area: base.area, idade, contexto: base.contexto };
  return { tipo, assunto, unidade_citada, escopo, canal, atividade: base.atividade, termos_busca: base.termos_busca, area: base.area, idade, contexto: base.contexto };
}

/** Prompt da leitura do turno. O texto é a rajada inteira (story 05); o histórico, só até a última
 * resposta do bot, para o modelo entender o contexto imediato. */
export function montarPromptLeituraTurno(texto: string, historico: { role: string; content: string }[] = []): string {
  return [
    MARCADOR_LEITURA_TURNO + ".",
    "Você lê a mensagem de um lead da Rede CUCA (centros de juventude de Fortaleza, 5 unidades: Cuca Barra, Cuca Jangurussu, Cuca Mondubim, Cuca Pici, Cuca José Walter) para decidir como a atendente virtual (Maria) responde.",
    "Leia a mensagem JUNTO com a conversa: o contexto imediato muda o sentido (ex.: 'vagas' logo depois de falar de natação é vaga de natação, não de emprego).",
    "A programação mensal tem 3 áreas: CURSOS (cursos e oficinas: dança, teatro, música, Libras, informática, fotografia, yoga...), ESPORTES (natação, lutas, futsal, vôlei, basquete, hidroginástica, ginástica...) e DIA A DIA (eventos e atividades abertas).",
    "",
    "Retorne SOMENTE JSON com as chaves:",
    "- \"tipo\": um destes valores:",
    "  \"saudacao\" (só cumprimento: oi, bom dia, tudo bem?);",
    "  \"cortesia\" (só agradecimento ou confirmação, sem pedido: ok, obrigado, entendi, 👍);",
    "  \"despedida\" (quer encerrar: tchau, era só isso, depois eu vejo, deixa pra lá);",
    "  \"pedido_humano\" (pede EXPLICITAMENTE para falar com uma pessoa: atendente, humano, gerente, coordenação, funcionário, algum setor). Reclamar da resposta ou dizer que não entendeu NÃO é pedido_humano;",
    "  \"outro_canal\" (assunto atendido por outro canal, ver \"canal\");",
    "  \"vagas_ambiguo\" (pergunta de vaga(s) sem dar para saber, nem pela conversa, se é vaga de emprego ou de curso/atividade);",
    "  \"so_unidade\" (só diz uma unidade ou 'toda a rede', sem pedir mais nada: 'Barra', 'no Pici', 'pode ser em qualquer uma');",
    "  \"continuacao\" (continua o MESMO assunto que já está na conversa: horário, idade, turno, vaga, documentos daquela atividade);",
    "  \"pedido_novo\" (qualquer outro pedido ou pergunta).",
    "  Cumprimento junto com pedido: o tipo é o do pedido.",
    "- \"assunto\": \"programacao\" (atividade, curso, esporte, evento, turma, horário, idade para participar, vaga de atividade), \"o_que_tem\" (quer saber o que tem / a programação em geral, sem atividade nem área), \"institucional\" (matrícula, inscrição, documentos, endereço, funcionamento, telefone, serviços, outro assunto do CUCA) ou null (saudacao, cortesia, despedida, pedido_humano, outro_canal).",
    "- \"unidade_citada\": nome exato da unidade que o LEAD escreveu na mensagem atual, \"varias\" se ele citar duas ou mais unidades diferentes sem escolher uma, ou null. NUNCA deduza das mensagens da Maria.",
    "- \"escopo\": nome exato da unidade que o lead pediu na mensagem atual, \"REDE\" se pedir toda a rede / todas as unidades / 'em quais unidades', ou \"nao_disse\".",
    "- \"canal\" (só com tipo outro_canal): \"empregabilidade\" (vaga de emprego, estágio, jovem aprendiz, currículo, trabalho), \"acesso_cuca\" (cadastro, carteirinha, acesso aos espaços/equipamentos), \"ouvidoria\" (reclamação, sugestão ou elogio formal) ou \"academia_enem\" (preparatório, aulas de Enem, redação). Senão, null.",
    "- \"atividade\": a atividade de que a pessoa fala AGORA (pode vir da conversa, se for continuação), ou null.",
    "- \"termos_busca\": 1 a 4 palavras para buscar a atividade no título, com variações de grafia (balé -> [\"bale\",\"ballet\"]). [] sem atividade.",
    "- \"area\": \"CURSOS\", \"ESPORTES\", \"DIA A DIA\" ou null. Se houver atividade, a área é a dela (natação = ESPORTES, mesmo em 'curso de natação').",
    "- \"idade\": idade em número de quem vai participar, se foi dita nesta mensagem ou antes na conversa; senão null.",
    "- \"contexto\": objeto com outras condições citadas (genero 'feminino'/'masculino', turno 'manha'/'tarde'/'noite', dia, nivel, deficiencia, para quem é). {} se nada.",
    "",
    "Exemplos:",
    "- 'boa tarde' => tipo=saudacao. 'ok, obrigado' => tipo=cortesia. 'valeu, era só isso' => tipo=despedida.",
    "- 'quero falar com a gerente' => tipo=pedido_humano.",
    "- 'tem vaga de estágio?' => tipo=outro_canal, canal=empregabilidade.",
    "- 'tem vaga?' sem conversa antes => tipo=vagas_ambiguo. Conversa sobre natação e agora 'ainda tem vaga?' => tipo=continuacao, assunto=programacao, atividade=natação.",
    "- 'tem natação?' => tipo=pedido_novo, assunto=programacao, atividade=natação, area=ESPORTES, escopo=nao_disse.",
    "- 'o que tem no Pici?' => tipo=pedido_novo, assunto=o_que_tem, unidade_citada='Cuca Pici', escopo='Cuca Pici'.",
    "- 'quais documentos para a matrícula?' => tipo=pedido_novo, assunto=institucional.",
    "- 'minha filha tem 8 anos, o que ela pode fazer?' => tipo=pedido_novo, assunto=programacao, atividade=null, idade=8, contexto={genero:'feminino', para:'filha'}.",
    "- 'Barra' (respondendo de qual unidade) => tipo=so_unidade, unidade_citada='Cuca Barra', escopo='Cuca Barra'.",
    "- 'tem na Barra e no Pici?' => unidade_citada='varias'.",
    "- Maria falou do Cuca Barra e o lead responde 'e de vôlei?' => tipo=continuacao, escopo=nao_disse (o lead não disse a unidade).",
    "",
    montarContextoSessaoParaInterpretacao(historico, texto),
    "",
    "Mensagem do lead (pode ter várias linhas, mandadas em sequência): " + texto,
  ].join("\n");
}

/**
 * Leitura do turno por IA. Devolve `null` em qualquer falha — erro de rede, status não-OK, JSON
 * inválido ou mais de `timeoutMs` (o `AbortController` cobre a chamada inteira; não há nova
 * tentativa, para o plano B disparar dentro do prazo). Nunca propaga exceção.
 */
export async function lerTurnoInstitucional(
  texto: string,
  openaiKey: string,
  historico: { role: string; content: string }[] = [],
  aoConsumir?: (corpo: RespostaOpenAIUso, latenciaMs: number) => void,
  timeoutMs = LEITURA_TIMEOUT_MS,
): Promise<LeituraTurno | null> {
  const inicio = Date.now();
  const controle = new AbortController();
  const relogio = setTimeout(() => controle.abort(), timeoutMs);
  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controle.signal,
      headers: { "Authorization": "Bearer " + openaiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        max_tokens: 250,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: montarPromptLeituraTurno(texto, historico) }],
      }),
    });
    if (!resp.ok) {
      console.error("[motor-agente v18] leitura do turno: status " + resp.status + ", plano B (rota antiga)");
      return null;
    }
    const body = await resp.json();
    notificarConsumo(aoConsumir, body, inicio);
    const leitura = validarLeituraTurno(JSON.parse(body.choices[0].message.content));
    if (!leitura) console.error("[motor-agente v18] leitura do turno: JSON fora do contrato, plano B (rota antiga)");
    return leitura;
  } catch (exc) {
    console.error("[motor-agente v18] leitura do turno falhou (" + (controle.signal.aborted ? "mais de " + timeoutMs + " ms" : String(exc)) + "), plano B (rota antiga)");
    return null;
  } finally {
    clearTimeout(relogio);
  }
}

/**
 * Junta a leitura do modelo com o que o código lê do texto (mesmo princípio da S-WM-72):
 * - unidade: o nome escrito pelo lead manda; unidade que o modelo citou sem estar escrita (nem com
 *   erro de digitação) é descartada — o modelo chegou a deduzir a unidade pela resposta da Maria;
 * - duas unidades em mensagens diferentes da rajada = "varias" (regra da story 05);
 * - idade, turno e gênero escritos na mensagem entram por cima do que o modelo inferiu;
 * - "quais cursos" no meio de outra atividade = área CURSOS (regra da S-WM-72).
 */
export function consolidarLeitura(leituraModelo: LeituraTurno, texto: string, mensagensRajada: string[] = [texto]): LeituraTurno {
  // Transbordo só com apoio no texto (a mesma regra fixa da rota antiga): o transbordo põe a conversa em
  // awaiting_human, que só volta pelo atendente. No replay de 7 dias o modelo marcou pedido_humano em
  // "Quero sim", "No cuca barra?", nome solto... — sem apoio, segue como pergunta institucional.
  const pedeAtendente = mensagensRajada.length > 1
    ? deveAcionarHandoverNaRajada(mensagensRajada, "Institucional")
    : deveAcionarHandoverInstitucional(texto, "Institucional");
  const leitura: LeituraTurno = leituraModelo.tipo === "pedido_humano" && !pedeAtendente
    ? { ...leituraModelo, tipo: "pedido_novo", assunto: leituraModelo.assunto ?? "institucional" }
    : leituraModelo;
  const lido = lerMensagemAtual(texto);
  const escritas = /^\s*\d{1,2}\s*$/.test(texto) ? [] : unidadesCitadas(texto);
  const comTypo = (u: string) => Object.entries(NOMES_UNIDADES_POR_PALAVRA).some(([k, v]) => v === u && contemNomeUnidadeComTypo(normalizarTexto(texto), normalizarTexto(k)));
  let unidade_citada = leitura.unidade_citada;
  let escopo = leitura.escopo;
  if (mensagensRajada.length > 1 && escritas.length >= 2) unidade_citada = UNIDADE_VARIAS;
  else if (escritas.length === 1) unidade_citada = escritas[0];
  else if (unidade_citada && unidade_citada !== UNIDADE_VARIAS && !comTypo(unidade_citada)) unidade_citada = null;
  if (unidade_citada === UNIDADE_VARIAS) escopo = ESCOPO_NAO_DISSE;
  else if (unidade_citada) escopo = unidade_citada;
  else if (lido.escopo === ESCOLHA_REDE) escopo = ESCOLHA_REDE;
  // "toda a rede" do modelo só vale com apoio no texto ("onde tem", "cada unidade"...): "quais cursos
  // tem?" não diz rede, e com unidade salva o escopo tem que vir dela (ou da confirmação).
  else if (escopo !== ESCOLHA_REDE || !textoPedeRede(texto)) escopo = ESCOPO_NAO_DISSE;
  // S-INST-QUAL-13: o dia vem só da mensagem atual (o modelo lê a sessão inteira e repetiria o de antes).
  const contexto = { ...contextoDoModeloComDiaDaMensagem(leitura.contexto, texto), ...lido.contexto };
  const idade = typeof lido.contexto.idade === "number" ? lido.contexto.idade : leitura.idade;
  if (idade !== null) contexto.idade = idade;
  const termos = leitura.termos_busca.length || !leitura.atividade ? leitura.termos_busca : palavrasChaveProgramacao(leitura.atividade);
  // Área escrita na mensagem mais recente da rajada manda ("curso pro meu filho" + "Algum esporte" =
  // Esportes); sem área escrita nela, vale a do texto inteiro; o modelo só completa o que falta.
  const ultima = mensagensRajada.at(-1) ?? texto;
  const areaEscrita = areaPeloVocabulario(ultima) ?? areaPeloVocabulario(texto);
  const area = areaPeloVocabulario(ultima) ?? leitura.area ?? areaEscrita;
  const base: LeituraTurno = { ...leitura, unidade_citada, escopo, contexto, idade, termos_busca: termos, area };
  if (areaEscrita === "CURSOS" && base.atividade && base.area !== "CURSOS" && !atividadeEscritaNaMensagem(base.atividade, texto)) {
    return { ...base, atividade: null, termos_busca: [], area: "CURSOS" };
  }
  return base;
}

/**
 * Hotfix 17/11/2026: tira da leitura o que não identifica atividade. "Os cursos já começaram?" vinha
 * com termos ["cursos","começaram"]: a lista não vazia fazia o bot pular a pergunta da unidade, ir
 * para a rede inteira e responder que não havia cursos em nenhuma unidade. Mesmo defeito em "E os
 * esportes?" e "Que tipos tem disponiveis." (16/11).
 * - atividade feita só de palavras genéricas ("esportes", "cursos") vira sem atividade, e a área sai
 *   dela quando o modelo não deu;
 * - sem atividade, termo só fica se casar com algum título da programação (a mesma regra da
 *   S-INST-QUAL-13 para a palavra que sobra do texto).
 * Atividade com nome de verdade não muda: "forró" sem título na rede continua "não tem". Com dia
 * na pergunta nada muda (a consulta por dia já trata as palavras que sobram). Sem itens carregados,
 * os termos ficam como estão.
 */
export function semTermosGenericos<T extends { atividade: string | null; termos_busca: string[]; area: AreaProgramacao | null; contexto: Record<string, unknown> }>(leitura: T, itens: ItemProgramacao[]): T {
  if (!leitura.atividade && !leitura.termos_busca.length) return leitura;
  if (diasDoContexto(leitura.contexto)) return leitura;
  let { atividade, area } = leitura;
  if (atividade && palavrasChaveProgramacao(atividade).length === 0) {
    area = area ?? areaPeloVocabulario(atividade);
    atividade = null;
  }
  if (atividade) return leitura;
  const termos = itens.length
    ? leitura.termos_busca.filter((t) => {
      const palavras = palavrasChaveProgramacao(t);
      return palavras.length > 0 && itensQueCasamComPalavras(itens, palavras).length > 0;
    })
    : leitura.termos_busca.filter((t) => palavrasChaveProgramacao(t).length > 0);
  if (atividade === leitura.atividade && area === leitura.area && termos.length === leitura.termos_busca.length) return leitura;
  return { ...leitura, atividade, area, termos_busca: termos };
}

/** O texto pede a rede: "toda a rede" (lerMensagemAtual) ou "onde tem", "em qual unidade", "cada unidade". */
export function textoPedeRede(texto: string): boolean {
  if (lerMensagemAtual(texto).escopo === ESCOLHA_REDE) return true;
  return /\b(onde|em qual unidade|em que unidade|quais unidades|que unidades|qual unidade tem|cada unidade|todas as unidades|todos os cucas|qualquer unidade)\b/.test(normalizarTexto(texto));
}

/**
 * A mensagem pede um detalhe da atividade (horário, dia, idade, onde, vaga, regra de inscrição). Aí
 * a resposta traz todas as opções com o detalhe, sem perguntar "qual dessas opções" antes: a pergunta
 * de atividade ambígua é para o interesse genérico ("tem natação no Pici?").
 */
export function mensagemPedeDetalhe(texto: string): boolean {
  return /\b(horarios?|hora|horas|que dias?|quais dias|dias|quando|idade|faixa|onde|qual unidade|quais unidades|cada unidade|vagas?|inscri\w*|matricul\w*|posso|pode|podem|duas|mais de uma|professor\w*|valor|preco|custa|pagar|pago)\b/.test(normalizarTexto(texto));
}

/** Mensagens do lead entre as duas últimas respostas do bot: o pedido que a última resposta atendeu. */
export function pedidoAnteriorDoLead(historico: { role: string; content: string }[]): string {
  const ultimoBot = historico.map((m) => m.role).lastIndexOf("assistant");
  const partes: string[] = [];
  for (let i = ultimoBot - 1; i >= 0 && historico[i].role !== "assistant"; i--) {
    if (historico[i].role === "user" && !historico[i].content.startsWith("[CONTEXTO INTERNO")) partes.unshift(historico[i].content);
  }
  return partes.join("\n");
}

/**
 * "Só a unidade" logo depois de um pedido de atividade ("natação infantil?" → "tem no JW e no Pici"
 * → "barra do Ceará") = a mesma pergunta nessa unidade. Pela tabela da story, unidade resolvida com
 * pedido responde o pedido, não a programação inteira. Só vale com palavra do pedido que existe no
 * catálogo; sem isso, segue como "só a unidade".
 */
export function completarSoUnidadeComPedidoAnterior(leitura: LeituraTurno, pedidoAnterior: string, itens: ItemProgramacao[]): LeituraTurno {
  if (leitura.tipo !== "so_unidade" || leitura.atividade || leitura.termos_busca.length || !pedidoAnterior.trim()) return leitura;
  if (leitura.escopo === ESCOPO_NAO_DISSE || leitura.unidade_citada === UNIDADE_VARIAS) return leitura;
  const termos = palavrasChaveProgramacao(pedidoAnterior).filter((p) => !PALAVRAS_DE_UNIDADE.has(p) && itensQueCasamComPalavras(itens, [p]).length > 0);
  if (!termos.length) {
    // S-INST-QUAL-13: "quais cursos tem aos sábados?" → "não tem no JW; tem no Mondubim e no Pici" →
    // "Pici" = cursos aos sábados no Pici (a pergunta anterior traz o dia e a área).
    const dias = diasDaMensagem(pedidoAnterior);
    if (!dias.size) return leitura;
    return { ...leitura, tipo: "continuacao", assunto: "programacao", area: areaPeloVocabulario(pedidoAnterior) ?? leitura.area, contexto: { ...leitura.contexto, dia: descreverDias(dias) } };
  }
  return { ...leitura, tipo: "continuacao", assunto: "programacao", atividade: termos.join(" "), termos_busca: termos };
}

/** Título normalizado para comparar variantes ("NATAÇÃO  SELEÇÃO" = "Natação Seleção"). */
function chaveTitulo(titulo: string): string {
  return normalizarTexto(titulo).replace(/\s+/g, " ").trim();
}

/**
 * Atividade ambígua: títulos DIFERENTES que casam com a atividade no escopo (unidade ou rede), já
 * filtrados pelo contexto (idade antes de perguntar). `[]` quando não há ambiguidade (0 ou 1
 * título) ou quando são tantos que a palavra é ampla demais para virar pergunta (mais de 6).
 * Cada opção sai com a faixa etária do texto da programação, quando todas as turmas dela têm a mesma.
 */
export function opcoesDeAtividade(itens: ItemProgramacao[], leitura: Pick<LeituraTurno, "atividade" | "termos_busca" | "contexto">, escopo: string): string[] {
  if (!leitura.atividade && !leitura.termos_busca.length) return [];
  const palavras = [...new Set([leitura.atividade ?? "", ...leitura.termos_busca].flatMap((t) => palavrasChaveProgramacao(t)))];
  const doEscopo = itens.filter((it) => escopo === ESCOLHA_REDE || it.unidade === escopo);
  const candidatos = filtrarItensPorContexto(itensQueCasamComPalavras(doEscopo, palavras), leitura.contexto);
  const porTitulo = new Map<string, ItemProgramacao[]>();
  for (const it of candidatos) {
    const k = chaveTitulo(it.titulo);
    porTitulo.set(k, [...(porTitulo.get(k) ?? []), it]);
  }
  if (porTitulo.size < 2 || porTitulo.size > 6) return [];
  return [...porTitulo.values()].map((grupo) => {
    const titulo = grupo[0].titulo.replace(/\s+/g, " ").trim();
    const faixas = [...new Set(grupo.map((it) => faixaEtariaDoDetalhe(it.detalhe)))];
    return faixas.length === 1 && faixas[0] ? titulo + " (" + faixas[0] + ")" : titulo;
  });
}

/** Tira a faixa etária que `opcoesDeAtividade` acrescenta, para voltar ao título. */
export function tituloDaOpcao(opcao: string): string {
  return opcao.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export const MARCA_CONFIRMAR_ESCOPO = "de outra unidade ou da rede toda?";
export const MARCA_PERGUNTA_ATIVIDADE = "Qual dessas opções te interessa?";

/** Confirmar o escopo quando a conversa é retomada com unidade salva (tabela da story, linha 7). */
export function montarPerguntaConfirmarEscopo(unidade: string, sobre?: string): string {
  return (sobre ? "Sobre " + sobre + ": você" : "Você") + " quer saber do " + unidade + ", " + MARCA_CONFIRMAR_ESCOPO + " Responda 1, 2 ou 3. 😊\n\n1️⃣ " + unidade + "\n2️⃣ Outra unidade\n3️⃣ " + ROTULO_REDE;
}

/** A atividade pedida é assunto novo na sessão: nenhum termo dela aparece nas mensagens do lead desta
 * sessão nem na última resposta do bot (quem escolhe da lista que o bot acabou de mostrar não é
 * assunto novo). Sem conversa antes, não é assunto novo. */
export function atividadeNovaNaConversa(leitura: LeituraTurno, historico: { role: string; content: string }[]): boolean {
  const termos = (leitura.termos_busca.length ? leitura.termos_busca : palavrasChaveProgramacao(leitura.atividade ?? ""))
    .map((t) => normalizarTexto(t).trim().replace(/s$/, ""))
    .filter((t) => t.length >= 3);
  if (!termos.length) return false;
  // Só a conversa ANTES desta mensagem: até a última resposta do bot (o histórico pode já trazer a
  // mensagem atual e a rajada).
  const ultimaPosicaoBot = historico.map((m) => m.role).lastIndexOf("assistant");
  const anteriores = historico.slice(0, ultimaPosicaoBot + 1);
  const doLead = anteriores.filter((m) => m.role === "user" && !m.content.startsWith("[CONTEXTO INTERNO")).map((m) => m.content);
  const ultimaDoBot = ultimaPosicaoBot >= 0 ? historico[ultimaPosicaoBot].content : "";
  if (!doLead.length && !ultimaDoBot) return false;
  const conversa = normalizarTexto([...doLead, ultimaDoBot].join("\n"));
  return !termos.some((t) => conversa.includes(t));
}

/** Perguntar qual atividade, com as opções numeradas (tabela da story, linha 12). */
export function montarPerguntaAtividade(opcoes: string[], escopo: string): string {
  const onde = escopo === ESCOLHA_REDE ? "na Rede CUCA" : "no " + escopo;
  return "Encontrei mais de uma opção " + onde + ":\n\n" + opcoes.map((o, i) => (i + 1) + "️⃣ " + o).join("\n") + "\n\n" + MARCA_PERGUNTA_ATIVIDADE + " 😊";
}

/**
 * Resposta à confirmação de escopo ("Você quer saber do X, de outra unidade ou da rede toda?") — os
 * dois caminhos pedidos pelo Junior em 14/11:
 * - `mesma`: "1", "sim", "o mesmo", "mesmo Cuca X", "pode ser" → segue no X com o contexto anterior;
 * - `outra_unidade`: "2", "não", "outra", "não é o X" → abre a partir da negativa (menu de unidades,
 *   sem o X e sem o contexto anterior);
 * - `escopo`: "3"/"rede toda" ou o nome de outra unidade ("não, do Pici") → vai direto para ela.
 * `null` quando a mensagem não responde à pergunta ("não, obrigado", pergunta nova sem sim/não): a
 * pendência cai e a mensagem segue como mensagem nova.
 */
export type RespostaConfirmacao = { tipo: "mesma" } | { tipo: "outra_unidade" } | { tipo: "escopo"; escopo: string };
export function resolverRespostaConfirmacao(texto: string, unidadeOferecida: string): RespostaConfirmacao | null {
  const norm = normalizarTexto(texto).trim().replace(/[\s.!?,😊👍🙏]+$/u, "").trim();
  if (norm === "1") return { tipo: "mesma" };
  if (norm === "2") return { tipo: "outra_unidade" };
  if (norm === "3") return { tipo: "escopo", escopo: ESCOLHA_REDE };
  const negativa = /^(nao|n|nem|negativo)\b/.test(norm);
  if (negativa && /^(nao|n)\b[\s,]*(obrigad|valeu|vlw|precisa|quero mais|e nada|nada|tchau)/.test(norm)) return null;
  if (/\b(toda a rede|rede toda|rede inteira|toda rede|todas as unidades|em todas|todas|qualquer unidade|qualquer uma)\b/.test(norm)) return { tipo: "escopo", escopo: ESCOLHA_REDE };
  const citadas = unidadesCitadas(norm);
  const outras = citadas.filter((u) => u !== unidadeOferecida);
  // "Pici ou Barra?" (o X e outra, sem negar o X) ou duas outras: não dá para escolher por ela.
  if (outras.length > 1 || (outras.length === 1 && citadas.length > 1 && !negativa)) return null;
  if (outras.length === 1) return { tipo: "escopo", escopo: outras[0] };
  const reafirma = /\bmesm[oa]\b/.test(norm);
  if (citadas.length === 1) return negativa && !reafirma ? { tipo: "outra_unidade" } : { tipo: "mesma" };
  if (/\boutr[oa]s?\b/.test(norm) || negativa) return { tipo: "outra_unidade" };
  if (reafirma || /^(sim|s|ss|isso|essa|esse|pode|claro|ok|okay|beleza|blz|exato|exatamente|perfeito|certo|com certeza|quero|continua|aqui|nessa|nesse)\b/.test(norm)) return { tipo: "mesma" };
  return null;
}

/** Resolve a resposta à pergunta de atividade: número da lista ou texto que casa com uma opção. */
export function resolverEscolhaDeAtividade(texto: string, opcoes: string[]): string | undefined {
  const norm = normalizarTexto(texto).trim();
  if (/^\d{1,2}$/.test(norm)) {
    const i = Number(norm) - 1;
    return i >= 0 && i < opcoes.length ? tituloDaOpcao(opcoes[i]) : undefined;
  }
  const titulos = opcoes.map(tituloDaOpcao);
  const exata = titulos.find((t) => chaveTitulo(t) === norm);
  if (exata) return exata;
  const itens = titulos.map((t) => ({ unidade: "", titulo: t, detalhe: "" }));
  const casados = itensQueCasamComPalavras(itens, palavrasChaveProgramacao(texto));
  return casados.length === 1 ? casados[0].titulo : undefined;
}

export type EstadoRota = {
  /** `unidade_selecionada` depois do corte de sessão. */
  unidadeSalva: string | null;
  /** `unidade_selecionada` de antes do corte de sessão (a S-WM-71 zera em sessão nova). */
  unidadeAnterior: string | null;
  /** escopo "toda a rede" salvo na sessão (`prog_escopo`). */
  escopoRedeSalvo: boolean;
  /** sessão nova (mais de 2h) ou conversa encerrada reaberta. */
  sessaoReaberta: boolean;
  primeiraRespostaDaSessao: boolean;
  ultimaRespostaFoiPronta: boolean;
  /** disparo institucional recebido há menos de 24h (e não é despedida). */
  disparoRecente: boolean;
  /** conversa em contexto de programação (regra da S-INST-QUAL-01): unidade/escopo/contexto salvo ou
   * última resposta do bot falando de programação. Com ele, "vaga" não é ambígua. */
  contextoDeProgramacao: boolean;
  /** a mensagem pede um detalhe (horário, idade, onde...): sem pergunta de atividade ambígua. */
  pedeDetalhe: boolean;
  /** a atividade pedida não apareceu na conversa desta sessão (ver `atividadeNovaNaConversa`). */
  atividadeNovaNaConversa: boolean;
  /** opções de atividade ambígua para o escopo (ver `opcoesDeAtividade`). */
  opcoesAtividade: (escopo: string) => string[];
  /** S-INST-QUAL-14: a conversa (ou a mensagem) filtra por dia ou turno. Sem o campo, nada muda. */
  filtroDaConversa?: boolean;
};

export type AcaoRota =
  | { acao: "handover" }
  | { acao: "menu_unidades"; unidades: string[] }
  | { acao: "saudacao" }
  | { acao: "cortesia" }
  | { acao: "despedida" }
  | { acao: "encaminhar"; canal: CanalEncaminhamento }
  | { acao: "perguntar_vaga" }
  | { acao: "confirmar_escopo"; unidade: string; sobre?: string }
  | { acao: "perguntar_escopo" }
  | { acao: "perguntar_area"; escopo: string; escopoDaMensagem: boolean }
  | { acao: "perguntar_atividade"; escopo: string; escopoDaMensagem: boolean; opcoes: string[] }
  | { acao: "programacao"; escopo: string; escopoDaMensagem: boolean; listarPorIdade: boolean }
  | { acao: "unidade"; unidade: string; pedido: boolean; troca: boolean }
  | { acao: "pergunta_geral" }
  | { acao: "gpt_livre" };

/**
 * Decide a rota a partir da leitura (já consolidada) e do estado da conversa. Função pura: cada
 * linha da tabela da story vira um teste em `index.inst-qual-06.test.ts`.
 */
export function decidirRota(leitura: LeituraTurno, estado: EstadoRota): AcaoRota {
  const { tipo } = leitura;
  if (tipo === "pedido_humano") return { acao: "handover" };
  if (leitura.unidade_citada === UNIDADE_VARIAS) return { acao: "menu_unidades", unidades: [] };
  if (tipo === "outro_canal" && leitura.canal) return { acao: "encaminhar", canal: leitura.canal };
  if (tipo === "vagas_ambiguo") {
    // Só pergunta "emprego ou curso?" sem contexto nenhum (nem atividade, nem unidade/conversa de
    // programação) — como a regra fixa da 01. Com contexto, segue como pedido.
    const temAtividadeNaVaga = Boolean(leitura.atividade || leitura.termos_busca.length);
    if (!temAtividadeNaVaga && !estado.contextoDeProgramacao) return { acao: "perguntar_vaga" };
    return decidirRota({ ...leitura, tipo: "pedido_novo", assunto: temAtividadeNaVaga ? "programacao" : (leitura.assunto ?? "institucional") }, estado);
  }

  if (tipo === "saudacao" || tipo === "cortesia" || tipo === "despedida") {
    if (tipo === "despedida") return { acao: "despedida" };
    // Disparo recente ainda não reconhecido: o modelo responde, com o aviso no prompt (como hoje).
    if (estado.disparoRecente) return { acao: "gpt_livre" };
    if (estado.primeiraRespostaDaSessao) return { acao: "saudacao" };
    // Não repete a frase pronta (story 05): segue pela unidade salva ou pela pergunta geral.
    if (estado.ultimaRespostaFoiPronta) return estado.unidadeSalva ? { acao: "unidade", unidade: estado.unidadeSalva, pedido: true, troca: false } : { acao: "pergunta_geral" };
    return { acao: "cortesia" };
  }

  const escopoDaMensagem = leitura.escopo !== ESCOPO_NAO_DISSE;
  const candidataSalva = estado.unidadeSalva ?? estado.unidadeAnterior;
  // Só para programação: pergunta institucional ("quais documentos?") vale para a rede toda e não
  // precisa de uma rodada a mais para confirmar a unidade.
  const ehProgramacao = leitura.assunto === "programacao" || leitura.assunto === "o_que_tem";
  if (!escopoDaMensagem && tipo === "pedido_novo" && ehProgramacao && candidataSalva && estado.sessaoReaberta) {
    return { acao: "confirmar_escopo", unidade: candidataSalva };
  }
  // Assunto novo na mesma sessão (decisão do Junior, 14/11): conversa de futsal no Cuca Barra e a
  // pessoa pergunta de natação → pergunta, como um atendente faria, se é do Cuca Barra ou de outro
  // lugar. Atividade que já apareceu na conversa (pedida antes ou escolhida da lista) segue direto.
  // Só com atividade de verdade num pedido de programação: "como faço pra me inscrever?" (institucional)
  // ou "atividade para 8 anos" (sem atividade) não perguntam.
  if (!escopoDaMensagem && tipo === "pedido_novo" && leitura.assunto === "programacao" && leitura.atividade && estado.unidadeSalva && estado.atividadeNovaNaConversa) {
    return { acao: "confirmar_escopo", unidade: estado.unidadeSalva, sobre: leitura.atividade };
  }
  const escopo: string | null = escopoDaMensagem
    ? leitura.escopo
    : estado.unidadeSalva ?? (estado.escopoRedeSalvo ? ESCOLHA_REDE : null);

  // S-INST-QUAL-14: com dia ou turno na conversa, a pergunta sem atividade nem área numa unidade vai
  // para a lista filtrada (consulta por dia, ou lista pelo contexto), nunca para a programação inteira.
  const listaFiltrada = (unidade: string): AcaoRota => ({ acao: "programacao", escopo: unidade, escopoDaMensagem, listarPorIdade: true });

  if (tipo === "so_unidade") {
    if (escopo === ESCOLHA_REDE) return { acao: "perguntar_area", escopo, escopoDaMensagem };
    if (escopo && estado.filtroDaConversa) return listaFiltrada(escopo);
    if (escopo) return { acao: "unidade", unidade: escopo, pedido: false, troca: true };
    return { acao: "perguntar_escopo" };
  }

  const assunto = leitura.assunto ?? "institucional";
  if (assunto === "institucional") {
    if (escopo && escopo !== ESCOLHA_REDE) return { acao: "unidade", unidade: escopo, pedido: true, troca: escopo !== estado.unidadeSalva };
    return { acao: "pergunta_geral" };
  }
  // assunto = programacao a partir daqui (o_que_tem com idade = listar o que serve para a idade)
  const temAtividade = Boolean(leitura.atividade || leitura.termos_busca.length);
  const comIdade = leitura.idade !== null;
  if (assunto === "o_que_tem" && !comIdade) {
    if (escopo === ESCOLHA_REDE) return leitura.area ? { acao: "programacao", escopo, escopoDaMensagem, listarPorIdade: false } : { acao: "perguntar_area", escopo, escopoDaMensagem };
    if (escopo && estado.filtroDaConversa) return leitura.area ? { acao: "programacao", escopo, escopoDaMensagem, listarPorIdade: false } : listaFiltrada(escopo);
    if (escopo) return { acao: "unidade", unidade: escopo, pedido: false, troca: true };
    return { acao: "perguntar_escopo" };
  }

  if (temAtividade) {
    const escopoBusca = escopo ?? ESCOLHA_REDE;
    if (tipo === "pedido_novo" && !estado.pedeDetalhe) {
      const opcoes = estado.opcoesAtividade(escopoBusca);
      if (opcoes.length >= 2) return { acao: "perguntar_atividade", escopo: escopoBusca, escopoDaMensagem, opcoes };
    }
    return { acao: "programacao", escopo: escopoBusca, escopoDaMensagem, listarPorIdade: false };
  }
  if (comIdade && !leitura.area) return { acao: "programacao", escopo: escopo ?? ESCOLHA_REDE, escopoDaMensagem, listarPorIdade: true };
  if (escopo === ESCOLHA_REDE) return leitura.area ? { acao: "programacao", escopo, escopoDaMensagem, listarPorIdade: false } : { acao: "perguntar_area", escopo, escopoDaMensagem };
  if (escopo && leitura.area) return { acao: "programacao", escopo, escopoDaMensagem, listarPorIdade: false };
  // Continuação sem atividade ("me manda os dias e horários") pede algo do que já foi falado: segue com
  // o pedido na unidade (o modelo responde com a programação e a conversa), nunca o resumo geral.
  if (escopo && escopo !== ESCOLHA_REDE && tipo !== "continuacao" && estado.filtroDaConversa) return listaFiltrada(escopo);
  if (escopo) return tipo === "continuacao" ? { acao: "unidade", unidade: escopo, pedido: true, troca: escopo !== estado.unidadeSalva } : { acao: "unidade", unidade: escopo, pedido: false, troca: true };
  return { acao: "perguntar_escopo" };
}

async function getOpenAIKey(supabase: ReturnType<typeof createClient<Database>>): Promise<string> {
  const { data } = await supabase.rpc("get_openai_key");
  return data || Deno.env.get("OPENAI_API_KEY") || "";
}

/** S-INST-QUAL-03: `aoConsumir` (opcional) recebe o corpo da resposta para o registro de consumo
 * (`feature = 'embedding'`). A resposta de embeddings só traz `usage.prompt_tokens`. */
export async function gerarEmbedding(texto: string, apiKey: string, aoConsumir?: (corpo: RespostaOpenAIUso, latenciaMs: number) => void, tentativa = 0): Promise<number[]> {
  const inicio = Date.now();
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST", headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texto.slice(0, 8000) }),
  });

  if (deveTentarNovamente(resp.status, tentativa)) {
    const corpoErro = await resp.text();
    const esperaSegundos = Math.min(parseRetryAfterSegundos(resp.headers.get("retry-after"), corpoErro), GPT_ESPERA_MAX_SEGUNDOS);
    console.log("[motor-agente v18] Rate limit OpenAI/embeddings (tentativa " + (tentativa + 1) + "/" + GPT_MAX_TENTATIVAS + "), aguardando " + esperaSegundos + "s antes de tentar de novo");
    await new Promise((resolve) => setTimeout(resolve, esperaSegundos * 1000));
    return gerarEmbedding(texto, apiKey, aoConsumir, tentativa + 1);
  }

  if (!resp.ok) throw new Error("Embedding error: " + await resp.text());
  const corpo = await resp.json();
  notificarConsumo(aoConsumir, corpo, inicio);
  return corpo.data[0].embedding;
}

/** S-INST-QUAL-03: entrega o corpo ao callback de consumo, só quando há `usage` (429/5xx não
 * cobra token). Erro ao preparar o registro nunca chega ao cidadão. */
function notificarConsumo(aoConsumir: ((corpo: RespostaOpenAIUso, latenciaMs: number) => void) | undefined, corpo: RespostaOpenAIUso | null | undefined, inicio: number): void {
  if (!aoConsumir || !corpo?.usage) return;
  try { aoConsumir(corpo, Date.now() - inicio); } catch (e) { console.error("[motor-agente v18] Falha ao preparar registro de consumo:", e); }
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
 * AUD-13: retry com backoff cobre 429 (rate limit) E os erros 5xx transitórios mais comuns da
 * OpenAI (500/502/503) — antes só 429 era tratado, e um 503 em pico de carga virava "problema
 * técnico" imediato pro lead sem nenhuma tentativa de repetição.
 */
export function deveTentarNovamente(status: number, tentativa: number): boolean {
  const statusTransitorio = status === 429 || status === 500 || status === 502 || status === 503;
  return statusTransitorio && tentativa < GPT_MAX_TENTATIVAS;
}

/** Corpo da resposta de chat/completions que interessa ao registro de consumo (PLANO-023). */
export type RespostaOpenAIUso = {
  id?: string;
  model?: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number } };
};

async function chamarGPT(prompt_sistema: string, historico: { role: string; content: string }[], apiKey: string, temperatura: number, max_tokens: number, tentativa = 0, aoConsumir?: (corpo: RespostaOpenAIUso, latenciaMs: number) => void): Promise<{ texto: string }> {
  const inicio = Date.now();
  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST", headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ model: GPT_MODEL, temperature: temperatura, max_tokens: max_tokens, messages: [{ role: "system", content: prompt_sistema }, ...historico] }),
  });

  if (deveTentarNovamente(resp.status, tentativa)) {
    const corpoErro = await resp.text();
    const esperaSegundos = Math.min(parseRetryAfterSegundos(resp.headers.get("retry-after"), corpoErro), GPT_ESPERA_MAX_SEGUNDOS);
    console.log("[motor-agente v18] Rate limit OpenAI (tentativa " + (tentativa + 1) + "/" + GPT_MAX_TENTATIVAS + "), aguardando " + esperaSegundos + "s antes de tentar de novo");
    await new Promise((resolve) => setTimeout(resolve, esperaSegundos * 1000));
    return chamarGPT(prompt_sistema, historico, apiKey, temperatura, max_tokens, tentativa + 1, aoConsumir);
  }

  if (!resp.ok) throw new Error("GPT-4o error: " + await resp.text());
  const corpo = await resp.json();
  // PLANO-023: registra o consumo ANTES de ler a resposta — se algo falhar depois, o gasto já
  // ficou anotado. Só quando há `usage` (um 429/5xx não cobra token). Falha no registro nunca
  // chega ao cidadão.
  if (aoConsumir && corpo?.usage) {
    try { aoConsumir(corpo, Date.now() - inicio); } catch (e) { console.error("[motor-agente v18] Falha ao preparar registro de consumo:", e); }
  }
  return { texto: corpo.choices[0].message.content };
}

// ── PLANO-023: registro de consumo por chamada em `ai_usage_logs` ─────────────────────────
// Preço por modelo vem de system_config (`openai_precos_usd_por_milhao`, JSON em texto), com
// cache por isolate — muda preço sem deploy e sem uma consulta extra por turno. Sem preço
// configurado, o custo fica NULL (nunca um valor chutado).
type PrecosModelo = Record<string, { in: number; cached_in: number; out: number }>;
const PRECOS_TTL_MS = 10 * 60 * 1000;
let precosCache: { valor: PrecosModelo | null; expiraEm: number } = { valor: null, expiraEm: 0 };
/** Só para testes: esquece o preço em cache. */
export function redefinirCachePrecos(): void { precosCache = { valor: null, expiraEm: 0 }; }

async function carregarPrecosOpenAI(supabase: ReturnType<typeof createClient<Database>>): Promise<PrecosModelo | null> {
  if (Date.now() < precosCache.expiraEm) return precosCache.valor;
  let valor: PrecosModelo | null = null;
  try {
    // deno-lint-ignore no-explicit-any
    const { data } = await (supabase as any).from("system_config").select("valor").eq("chave", "openai_precos_usd_por_milhao").single();
    if (data?.valor) valor = JSON.parse(String(data.valor));
  } catch (e) {
    console.error("[motor-agente v18] Tabela de preços OpenAI ilegível — custo fica NULL:", e);
  }
  precosCache = { valor, expiraEm: Date.now() + PRECOS_TTL_MS };
  return valor;
}

/** Custo em US$ de uma chamada. O modelo devolvido pela OpenAI vem com data
 * ("gpt-4o-mini-2024-07-18"): usa a chave de preço mais longa que casa como prefixo. */
export function calcularCustoUsd(modelo: string, tokensPrompt: number, tokensCached: number, tokensCompletion: number, precos: PrecosModelo | null): number | null {
  if (!precos) return null;
  const chave = Object.keys(precos)
    .filter((k) => modelo === k || modelo.startsWith(k + "-"))
    .sort((a, b) => b.length - a.length)[0];
  if (!chave) return null;
  const p = precos[chave];
  return ((tokensPrompt - tokensCached) * p.in + tokensCached * p.cached_in + tokensCompletion * p.out) / 1_000_000;
}

async function registrarUsoLLM(supabase: ReturnType<typeof createClient<Database>>, linha: Record<string, unknown>): Promise<void> {
  try {
    // `tokens_total` e `custo_estimado_usd` são colunas GERADAS no banco — não podem ser enviadas.
    // deno-lint-ignore no-explicit-any
    const { error } = await (supabase as any).from("ai_usage_logs").insert(linha);
    if (error) console.error("[motor-agente v18] Falha ao gravar ai_usage_logs:", error.message ?? error);
  } catch (e) {
    console.error("[motor-agente v18] Exceção ao gravar ai_usage_logs:", e);
  }
}

async function salvarMensagemAgente(supabase: ReturnType<typeof createClient<Database>>, conversa_id: string, lead_id: string, conteudo: string) {
  await supabase.from("mensagens").insert({ conversa_id, lead_id, tipo: "text", conteudo, remetente: "agente" });
}

/**
 * Item 2 (S-WM-22, TOM-03b): reconhece uma linha no formato compacto que a regra 6 de
 * `INSTRUCAO_SEGURANCA` já exige do GPT ao listar modalidades/cursos — "Nome - Dias" (ex.:
 * "Natacao - Ter/Qui/Sex"). Não é um formato novo inventado por esta story, é o formato que o
 * guardrail já pede; esta função só detecta se o GPT seguiu a regra.
 */
/**
 * S-WM-AUD-007 / Plano 012: registra QUAL camada de RAG respondeu o turno, e com que similaridade
 * quando foi vetorial. Hoje isso so existe em console.log — nao consultavel por SQL, sem retencao,
 * e a `similaridade` que `buscar_chunks_similares` ja devolve era simplesmente descartada.
 *
 * NUNCA propaga excecao e NUNCA e aguardada — mesmo padrao defensivo de `buscarNumeroCanal`. Um
 * log que falha nao pode derrubar nem atrasar a resposta ao cidadao. Se o insert quebrar, o turno
 * segue exatamente como seguiria sem esta funcao existir.
 */
/**
 * @qa (LOW, gate S-WM-AUD-007): o insert do log e fire-and-forget de proposito — a latencia dele
 * nao pode entrar no tempo de resposta ao cidadao. Hoje ele completa porque sobram ~150 linhas de
 * trabalho assincrono depois (chamada ao GPT, gravacao das mensagens) mantendo o isolate vivo.
 * Isso e garantia por ACIDENTE: se um refactor aproximar o `return`, os logs somem em silencio.
 * `EdgeRuntime.waitUntil` e a garantia por desenho. Acessado via `globalThis` porque o global so
 * existe no runtime do Supabase — em teste local vira no-op, sem `ts-ignore`.
 */
function manterVivoAposResposta(promessa: Promise<unknown>): void {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt && typeof rt.waitUntil === "function") rt.waitUntil(promessa);
}

async function registrarBuscaRAG(
  supabase: ReturnType<typeof createClient<Database>>,
  params: {
    conversa_id: string | null;
    agente_tipo: string;
    unidade_cuca: string | null;
    camada: string;
    atividade_resolvida?: string | null;
    chunks_retornados?: unknown;
    mensagem_lead: string;
    // S-INST-QUAL-03
    resolucao_atividade?: ResolucaoAtividade | null;
    resultado_busca?: ResultadoBusca;
    p_limite?: number | null;
    erro?: string | null;
    // S-INST-QUAL-06
    rota_fallback?: boolean | null;
  },
): Promise<void> {
  try {
    // `rag_retrieval_logs` e nova e ainda nao esta em `database.types.ts` (arquivo gerado,
    // commitado). O cast fica no CLIENT, nao no resultado — `.from()` valida o nome da tabela
    // contra o tipo gerado, entao castar depois nao resolve. Regenerar os types e o caminho
    // limpo e esta registrado como pendencia; nao foi feito aqui pra nao misturar um diff de
    // 3700 linhas geradas com a mudanca desta story.
    // deno-lint-ignore no-explicit-any
    const { error } = await (supabase as any).from("rag_retrieval_logs").insert(params) ?? {};
    // S-INST-QUAL-03: o erro do insert vinha sendo descartado — uma coluna faltando no banco
    // apagava o registro de todos os turnos sem ninguém saber.
    if (error) console.error("[motor-agente v18] registrarBuscaRAG: insert recusado (nao afeta a resposta):", error.message ?? error);
  } catch (exc) {
    console.error("[motor-agente v18] registrarBuscaRAG erro (nao afeta a resposta):", exc);
  }
}

function ehLinhaDeItemLista(linha: string): boolean {
  const l = linha.trim();
  if (!l || l.endsWith('?') || l.length > 80) return false;
  return l.includes(' - ');
}

/**
 * Item 2 (S-WM-22, TOM-03b): divide uma resposta longa/listável em 2-3 partes lógicas — uma
 * mensagem de abertura, a lista em si, e um fechamento — em vez de um único bloco de texto
 * corrido. Critério de "listável": 3 ou mais linhas no formato de item de lista (ver
 * `ehLinhaDeItemLista`) — abaixo disso, retorna a resposta inteira como 1 única parte
 * (comportamento atual preservado, AC4). Localiza o bloco CONTÍGUO da 1ª à última linha-item;
 * texto antes do bloco vira "abertura", o bloco vira a "lista", texto depois vira "fechamento"
 * — qualquer uma das 3 partes que ficar vazia depois de trim() é descartada, nunca retorna
 * string vazia como parte. Pura e determinística: chamada só DEPOIS do processamento de tags
 * (handover/encerrar/encaminhar) no handler, nunca antes (AC5) — recebe sempre o texto final já
 * limpo dessas tags.
 */
export function dividirRespostaEmPartes(texto: string): string[] {
  const linhas = texto.split('\n');
  const indicesItem = linhas.map((l, i) => (ehLinhaDeItemLista(l) ? i : -1)).filter((i) => i >= 0);

  if (indicesItem.length < 3) return [texto];

  const primeiroIndice = indicesItem[0];
  const ultimoIndice = indicesItem[indicesItem.length - 1];

  const abertura = linhas.slice(0, primeiroIndice).join('\n').trim();
  const lista = linhas.slice(primeiroIndice, ultimoIndice + 1).join('\n').trim();
  const fechamento = linhas.slice(ultimoIndice + 1).join('\n').trim();

  const partes = [abertura, lista, fechamento].filter((p) => p.length > 0);
  return partes.length > 0 ? partes : [texto];
}

/**
 * TOM-05: os textos fixos dos ramos early-return (menu de unidades, "não consegui identificar"
 * etc.) não passam pelo GPT — se o mesmo ramo disparar duas vezes seguidas, o lead recebe
 * literalmente o mesmo texto, palavra por palavra, um dos sinais mais fortes de "isso é um
 * robô". Opção mais simples que variação rotativa (que exigiria escrever e manter 2-3 textos
 * por situação): detecta se a resposta candidata é idêntica à última mensagem do agente no
 * histórico e, nesse caso, complementa com uma frase curta antes de repetir.
 */
export function evitarRepeticaoLiteral(respostaCandidata: string, historico: { role: string; content: string }[]): string {
  const ultimaDoAgente = [...historico].reverse().find((m) => m.role === "assistant");
  if (ultimaDoAgente && ultimaDoAgente.content === respostaCandidata) {
    return "De novo, foi mal! 😅\n\n" + respostaCandidata;
  }
  return respostaCandidata;
}

// Acima deste número de chunks, algo mudou de forma anormal (import duplicado, bug) — não é
// mais só "o mês teve mais atividade que o normal". 100 chunks equivale a ~200+ atividades no
// mês (medido em produção: proporção real de ~2,2-2,65 atividades por chunk nas 5 unidades,
// José Walter hoje com 146 atividades = 55 chunks, o maior já visto). Não trunca nada — só torna
// visível um caso que hoje passaria batido em `console.log`, já que este projeto não tem
// nenhuma monitoração ativa (tudo checagem manual no EasyPanel) e um `warn` pelo menos aparece
// destacado no dashboard de logs do Supabase.
const CHUNKS_MONTHLY_PROGRAM_LIMITE_ALERTA = 100;

/**
 * S-WM-46 (TD-03): formatação de chunk RAG (prefixo de fonte, se houver) — extraída porque a
 * mesma expressão aparecia verbatim em 4 pontos do Passo 6 (visão geral, acompanhamento,
 * pergunta geral, genérico), com drift já observável entre eles (só 1 dos 4 logava contagem).
 */
/**
 * S-PROG-03 (item 2): a quantidade de vagas NUNCA e informada ao cidadao. O numero continua
 * gravado em `atividades_mensais.metadata.vagas` e continua saindo na exportacao para a grafica
 * (contrato externo, `handleExportarXLSX`) — sai apenas do que o agente conta pra pessoa, porque
 * o valor muda com frequencia e informar um numero desatualizado gera deslocamento perdido.
 */
export const AVISO_VAGAS = "A quantidade de vagas muda com frequencia; oriente a pessoa a procurar a unidade CUCA para verificar a disponibilidade.";

/**
 * S-PROG-03 (item 2.2): remove o trecho "Vagas: <valor>." do texto JA EMBEDDADO dos chunks.
 *
 * Por que existe: mudar so as funcoes que montam a descricao (item 2.1) corrige o caminho
 * deterministico — que le `atividades_mensais` ao vivo — mas NAO corrige a busca vetorial, cujo
 * texto foi congelado no momento do embedding. Medicao em producao (2026-09-08): 168 dos 222
 * chunks ativos de `monthly_program` contem "Vagas:" (Pici 41/41). Sem esta sanitizacao, a regra
 * so valeria pra programacao criada dali pra frente, e setembro/2026 — ativo nas 5 unidades e
 * ainda sem disparo publico — continuaria informando o numero.
 *
 * Nao gera divida tecnica: quando os chunks novos nascerem sem "Vagas:" (S-PROG-01/02), o regex
 * deixa de encontrar qualquer coisa e a funcao vira um no-op. Nao precisa ser removida depois.
 *
 * O aviso NAO e concatenado aqui — seria repetido dezenas de vezes num bloco de ~40 chunks.
 * Ele entra uma vez por bloco, em quem monta o contexto.
 */
export function removerVagasDoTexto(texto: string): string {
  if (!texto) return texto;
  // "Vagas: 25." / "Vagas: 20 por turma." / "Vagas: nao informado." — para no primeiro ponto ou
  // fim de linha. Nao usa \s* no fim pra nao colar a frase seguinte na anterior.
  return texto.replace(/\s*Vagas:[^.\n]*\.?/gi, "");
}

/** S-INST-QUAL-14: tira os trechos (programação, eventos) cuja data inteira já passou. Trecho sem data fica. */
export function semTrechosVencidos<T extends { conteudo: string }>(chunks: T[] | null | undefined, hojeISO: string = hojeFortalezaISO()): T[] {
  return (chunks ?? []).filter((c) => !itemVencido(c.conteudo, hojeISO));
}

function formatarChunks(chunks: { conteudo: string; fonte_tipo?: string }[]): string {
  return chunks.map((c) => {
    const conteudo = removerVagasDoTexto(c.conteudo);
    return c.fonte_tipo ? "[" + c.fonte_tipo + "] " + conteudo : conteudo;
  }).join("\n");
}

/**
 * Carrega todos os chunks do monthly_program ativo para uma unidade diretamente (sem embedding).
 * Sem `.limit()` — o teto fixo de 40 truncava a visão geral completa das 5 unidades (todas já
 * ultrapassam 40 chunks hoje: José Walter/Pici em 55, Jangurussu/Mondubim em 47, Barra em 42).
 * Removido sem substituir por outro número fixo: qualquer chute (80, 100...) sofre do mesmo
 * problema — não há tendência estável de quantas atividades um mês vai ter (varia 89-146 nas 5
 * unidades, sem teto prático). Seguro sem limite: `gpt-4o-mini` (GPT_MODEL) tem janela de 128k
 * tokens; o pior caso real hoje (~64k caracteres somando prompt_sistema + guardrail +
 * prompt_contexto + este documento + histórico) fica em ~16k tokens — folga de >100k tokens
 * antes de qualquer risco de estourar o contexto, mesmo com o dado crescendo várias vezes o
 * teto já observado.
 * IMPORTANTE: remover o limite sozinho não corrige o bug de rótulo trocado (VAL-09, José
 * Walter) documentado em S-WM-35 — é complementar, não substituto. Sem o fix do rótulo, mais
 * dado chega ao prompt, mas o dado errado (idade lida como horário etc.) continua errado.
 */
/**
 * PLANO-026: cada trecho da programação traz o mesmo cabeçalho (mês/ano/unidade + título) — ele
 * existe de propósito para a busca vetorial, onde um trecho chega sozinho e precisa dizer de que
 * mês é (`processar-documento`, `montarChunksPorAtividade`). Quando a programação INTEIRA de uma
 * unidade é carregada, todos os trechos são do mesmo documento e o cabeçalho se repetia até 137
 * vezes (~21% do bloco). Aqui ele sai uma vez só, no topo.
 *
 * Segurança: o cabeçalho é o conjunto de linhas iniciais idênticas nos dois primeiros trechos,
 * parando na primeira linha de atividade ("• ...") — títulos se repetem entre turmas da mesma
 * atividade e nunca podem ser tomados por cabeçalho. Só é removido de trechos que começam
 * EXATAMENTE com ele; trecho com formato diferente fica intacto. Com menos de 2 trechos, ou sem
 * cabeçalho comum, o texto sai igual ao de antes.
 */
export function consolidarCabecalhoProgramacao(conteudos: string[]): string {
  if (conteudos.length < 2) return conteudos.join("\n");
  const a = conteudos[0].split("\n");
  const b = conteudos[1].split("\n");
  let n = 0;
  while (n < a.length - 1 && n < b.length - 1 && a[n] === b[n] && !a[n].startsWith("•")) n++;
  if (n === 0) return conteudos.join("\n");
  const cabecalho = a.slice(0, n).join("\n") + "\n";
  return cabecalho + conteudos.map((c) => (c.startsWith(cabecalho) ? c.slice(cabecalho.length) : c)).join("\n");
}

async function carregarProgramacaoMensal(supabase: ReturnType<typeof createClient<Database>>, unidade: string): Promise<string> {
  const { data: doc } = await supabase.from("documentos_rag").select("id").eq("tipo", "monthly_program").eq("unidade_cuca", unidade).eq("ativo", true).order("created_at", { ascending: false }).limit(1).single();
  if (!doc) return "";
  const { data: chunks } = await supabase.from("chunks_documentos").select("conteudo").eq("documento_id", doc.id).order("chunk_index", { ascending: true });
  if (!chunks || chunks.length === 0) return "";
  console.log("[motor-agente v18] Chunks diretos monthly_program: " + chunks.length + " para " + unidade);
  if (chunks.length > CHUNKS_MONTHLY_PROGRAM_LIMITE_ALERTA) {
    console.warn("[motor-agente v18] ALERTA: monthly_program de " + unidade + " tem " + chunks.length + " chunks (> " + CHUNKS_MONTHLY_PROGRAM_LIMITE_ALERTA + ") — checar se não é import duplicado/corrompido antes de assumir que é só crescimento normal.");
  }
  // S-PROG-03 (item 2.2): este caminho NAO passa por formatarChunks — sanitiza aqui tambem,
  // senao a visao geral da programacao (o maior bloco de contexto que vai ao GPT) continuaria
  // trazendo "Vagas: N" de todos os ~40 chunks.
  // PLANO-026: cabeçalho repetido sai dos trechos e aparece uma vez no topo (ver
  // consolidarCabecalhoProgramacao). Só neste caminho — a busca vetorial continua com o cabeçalho.
  // S-INST-QUAL-14 (decisão a): cada trecho do monthly_program traz um item só (conferido nas 5 unidades
  // em 16/11): o trecho com a data inteira passada sai. Antes do cabeçalho, que é lido dos 2 primeiros.
  const hoje = hojeFortalezaISO();
  const vigentes = chunks.filter((c: { conteudo: string }) => !itemVencido(c.conteudo, hoje));
  if (vigentes.length < chunks.length) console.log("[motor-agente v18] Programacao: " + (chunks.length - vigentes.length) + " itens com data passada fora (" + unidade + ")");
  if (vigentes.length === 0) return "";
  return consolidarCabecalhoProgramacao(vigentes.map((c: { conteudo: string }) => removerVagasDoTexto(c.conteudo)));
}

// S-PROG-10 (item 3): nomes de mês por extenso, em português. Array JS/TS é indexado a partir de
// 0 — diferente do array PL/pgSQL da migration desta mesma story (item 2), onde o índice-base-1
// causou um bug real (mês 8 virando "julho"). Aqui o acesso é sempre `NOMES_MES_EXTENSO[mes - 1]`
// com `mes` 1-12 — testado nos dois extremos (1 e 12) pra não repetir o mesmo tipo de erro.
const NOMES_MES_EXTENSO = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * S-PROG-10 (item 3): pura, sem I/O — decide a diretiva de vigência do mês a partir do
 * `mes`/`ano` gravados em `documentos_rag.metadados` (S-PROG-10 item 1) comparados com o
 * `mes`/`ano` de hoje (America/Fortaleza, calculado pelo caller). Calculada em código, nunca
 * deduzida pelo modelo (exigência explícita da story).
 *
 * Devolve "" (nada é acrescentado ao prompt) em três casos:
 *  - `mes`/`ano` ausentes ou de tipo errado — documento gravado antes desta story (AC5): cai no
 *    comportamento atual, nunca quebra;
 *  - `mes` fora de 1-12 — dado corrompido, mesma postura de nunca inventar;
 *  - `mes`/`ano` batem com o mês corrente (AC3: o prompt final fica byte-a-byte igual ao de
 *    antes desta story — @po reescreveu o AC assim porque "a resposta não muda" não é
 *    verificável sem rodar o LLM, e o prompt montado é, determinístico).
 *
 * Só devolve a diretiva de alerta quando a programação carregada é de um mês estritamente
 * ANTERIOR ao atual (AC4). Mês "futuro" (metadados à frente do calendário real, não deveria
 * acontecer no fluxo normal) também devolve "" — por segurança, nunca inventa uma diretiva pra
 * uma situação que não foi especificada.
 */
export function montarDiretivaVigenciaMes(
  mes: unknown,
  ano: unknown,
  mesAtual: number,
  anoAtual: number,
): string {
  if (typeof mes !== "number" || typeof ano !== "number") return "";
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return "";
  if (mes === mesAtual && ano === anoAtual) return "";

  const ehMesPassado = ano < anoAtual || (ano === anoAtual && mes < mesAtual);
  if (!ehMesPassado) return "";

  const nomeMes = NOMES_MES_EXTENSO[mes - 1];
  const nomeMesAtual = NOMES_MES_EXTENSO[mesAtual - 1];
  return "\n\nATENCAO: a programacao carregada e de " + nomeMes + " de " + ano + ", que ja passou. " +
    "A programacao de " + nomeMesAtual + " de " + anoAtual + " ainda nao foi publicada. " +
    "NAO apresente estes horarios como vigentes, oriente a pessoa a confirmar na unidade.";
}

/**
 * S-PROG-10 (item 3): busca o `metadados` do `monthly_program` ativo da unidade (mesma consulta
 * base de `carregarProgramacaoMensal`/`buscarAtividadeDeterministica`, só que pedindo
 * `metadados` em vez de `id`) e delega a decisão pra `montarDiretivaVigenciaMes` (pura, testada
 * isoladamente). "Hoje" calculado via `Intl.DateTimeFormat` em vez de parsing de string — mesmo
 * fuso (`America/Fortaleza`) que `DATA_ATUAL`, já usado no resto do prompt.
 */
async function calcularDiretivaVigenciaMes(supabase: ReturnType<typeof createClient<Database>>, unidade: string): Promise<string> {
  const { data: doc } = await supabase.from("documentos_rag").select("metadados").eq("tipo", "monthly_program").eq("unidade_cuca", unidade).eq("ativo", true).order("created_at", { ascending: false }).limit(1).single();
  const metadados = doc?.metadados as Record<string, unknown> | null;
  const mes = metadados && typeof metadados === "object" ? metadados["mes"] : null;
  const ano = metadados && typeof metadados === "object" ? metadados["ano"] : null;

  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza", year: "numeric", month: "numeric" }).formatToParts(new Date());
  const anoAtual = Number(partes.find((p) => p.type === "year")?.value);
  const mesAtual = Number(partes.find((p) => p.type === "month")?.value);

  return montarDiretivaVigenciaMes(mes, ano, mesAtual, anoAtual);
}

// ── S-INST-QUAL-03: resultado das buscas, para `rag_retrieval_logs` ───────────────────────
/** Por que a busca determinística de atividade devolveu (ou não) conteúdo. */
export type ResolucaoAtividade = "encontrada" | "nao_encontrada" | "ambigua" | "sem_documento";
export type BuscaAtividade = { conteudo: string | null; resolucao: ResolucaoAtividade };

/** Turno com as duas camadas determinísticas (metadata e texto): vale a que achou; se nenhuma
 * achou, vale o motivo mais informativo — ambígua > não encontrada > sem documento. */
export function combinarResolucaoAtividade(...resolucoes: (ResolucaoAtividade | null | undefined)[]): ResolucaoAtividade | null {
  const vistas = resolucoes.filter((r): r is ResolucaoAtividade => !!r);
  for (const r of ["encontrada", "ambigua", "nao_encontrada", "sem_documento"] as const) {
    if (vistas.includes(r)) return r;
  }
  return null;
}

/** Resultado da chamada a `buscar_chunks_similares`. Antes o `error` era ignorado e uma busca
 * que falhou ficava igual a uma vazia (`sem_match_rag`). */
export type ResultadoBusca = "sucesso_com_resultado" | "sucesso_vazio" | "erro" | "nao_aplicavel";
export type RegistroBusca = { resultado_busca: ResultadoBusca; p_limite: number | null; erro: string | null };
export const BUSCA_NAO_APLICAVEL: RegistroBusca = { resultado_busca: "nao_aplicavel", p_limite: null, erro: null };

/** Classifica a resposta da RPC sem mudar o que o motor faz com ela: o fluxo segue tratando erro
 * como "sem chunks", como antes — esta story só registra. */
export function classificarResultadoBusca(data: unknown, error: unknown, pLimite: number): RegistroBusca {
  if (error) {
    const msg = typeof error === "object" && error !== null && "message" in error ? String((error as { message: unknown }).message) : String(error);
    console.error("[motor-agente v18] buscar_chunks_similares devolveu erro (p_limite=" + pLimite + "): " + msg);
    return { resultado_busca: "erro", p_limite: pLimite, erro: msg.slice(0, 500) };
  }
  const temResultado = Array.isArray(data) && data.length > 0;
  return { resultado_busca: temResultado ? "sucesso_com_resultado" : "sucesso_vazio", p_limite: pLimite, erro: null };
}

/**
 * S-WM-34 (VAL-09): busca determinística por nome de atividade no `monthly_program` ativo da
 * unidade — evita o limite de `p_limite: 5` chunks da busca vetorial (`buscar_chunks_similares`)
 * no branch de acompanhamento, quando uma atividade está dispersa em muitos chunks
 * não-contíguos (confirmado em produção: natação no Jangurussu aparece em 14 chunks
 * não-contíguos, intercalados com outras modalidades, porque a seção "== ESPORTES ==" é
 * indexada por horário do dia, não por modalidade — busca por similaridade nunca teria como
 * trazer as 14 de uma vez).
 * Busca todos os chunks do documento (não usa `.limit(40)` de `carregarProgramacaoMensal` —
 * aqui o filtro relevante já reduz o volume antes de compor o contexto, então não há o mesmo
 * risco de truncar a lista final).
 * Retorna `null` quando a mensagem não cita nenhuma modalidade conhecida do `monthly_program`
 * ativo — o caller cai de volta pra busca vetorial (rede de segurança, comportamento hoje
 * existente preservado).
 */
async function buscarAtividadeEspecifica(supabase: ReturnType<typeof createClient<Database>>, unidade: string, mensagem: string, historico: { role: string; content: string }[] = []): Promise<BuscaAtividade> {
  const { data } = await supabase.from("documentos_rag").select("id").eq("tipo", "monthly_program").eq("unidade_cuca", unidade).eq("ativo", true).order("created_at", { ascending: false }).limit(1).single();
  const doc = data as { id: string } | null;
  if (!doc) return { conteudo: null, resolucao: "sem_documento" };
  const { data: chunks } = await supabase.from("chunks_documentos").select("conteudo").eq("documento_id", doc.id).order("chunk_index", { ascending: true });
  if (!chunks || chunks.length === 0) return { conteudo: null, resolucao: "sem_documento" };

  const conteudos = chunks.map((c: { conteudo: string }) => c.conteudo);
  const modalidades = extrairModalidades(conteudos);
  const resolucao = resolverAtividadeComDiagnostico(mensagem, modalidades, historico);
  const atividade = resolucao.atividade;
  if (!atividade) return { conteudo: null, resolucao: resolucao.ambigua ? "ambigua" : "nao_encontrada" };

  const atividadeNorm = normalizarTexto(atividade);
  // S-INST-QUAL-14: trecho com a data inteira passada não entra.
  const hoje = hojeFortalezaISO();
  const relevantes = conteudos.filter((c) => normalizarTexto(c).includes(atividadeNorm) && !itemVencido(c, hoje));
  if (relevantes.length === 0) return { conteudo: null, resolucao: "nao_encontrada" };

  console.log("[motor-agente v18] Busca deterministica de atividade: \"" + atividade + "\" (" + relevantes.length + " chunks, unidade=" + unidade + ", origem=" + resolucao.origem + ")");
  // S-PROG-03 (item 2.2, achado do @qa): esta e a 2a camada de fallback (S-WM-34) — entra
  // exatamente quando buscarAtividadeDeterministica (ja sanitizada) nao reconhece a modalidade
  // contra os titulos de atividades_mensais. Sem sanitizar aqui tambem, "tem vaga pra natacao?"
  // vazava o numero de volta pelo texto cru do chunk. Filtra por atividadeNorm ANTES de
  // sanitizar (linha acima) — remover "Vagas: N" não deveria nunca afetar o match do nome da
  // modalidade, mas por segurança o filtro roda sobre o texto original, não o sanitizado.
  return { conteudo: relevantes.map(removerVagasDoTexto).join("\n"), resolucao: "encontrada" };
}

/**
 * S-WM-35 (Frente C): busca determinística por atividade direto em `atividades_mensais.metadata`
 * (categoria ESPORTES) — dado estruturado na tabela-fonte, sem depender do texto já
 * chunkeado/embeddado (`buscarAtividadeEspecifica`, S-WM-34, continua existindo como 2ª camada
 * de fallback). Correlação com o `monthly_program` ativo da unidade via
 * `documentos_rag.metadados->>'campanha_id'` — mesmo campo que `trigger_indexar_campanha_mensal`
 * grava (`supabase/migrations`, confirmado via `execute_sql` contra o `pg_proc` real em
 * produção nesta sessão); o trigger também desativa o `monthly_program` de campanhas antigas da
 * mesma unidade ao aprovar uma nova, então "documento ativo" já garante "campanha aprovada mais
 * recente", sem filtro de status adicional aqui.
 * Escopo follow-up S-WM-35: todas as categorias da campanha em `atividades_mensais` — a
 * limitação anterior a ESPORTES deixava atividades volumosas de DIA A DIA (ex.: Direitos
 * Humanos) fora da camada determinística.
 * Reconhecimento de modalidade reusa `detectarAtividadeMencionada` (S-WM-34, já validado contra
 * erro de digitação — retorna `null` com segurança, nunca confunde modalidades parecidas, ver
 * Dev Agent Record) contra os `titulo`s distintos da própria tabela (não do texto chunkeado).
 * Comparação de igualdade usa `normalizarTexto` dos dois lados (não `===` sobre string crua) —
 * protege contra variação de caixa/acento entre linhas da MESMA modalidade (planilhas de origem
 * não são 100% consistentes, confirmado na auditoria B1).
 * Retorna `null` quando não há documento ativo, não há `campanha_id` no `documentos_rag`, não há
 * nenhuma linha ESPORTES pra essa campanha, ou a modalidade não é reconhecida — em todos os
 * casos o caller cai pra próxima camada (rede de segurança preservada, mesmo padrão do S-WM-34).
 */
async function buscarAtividadeDeterministica(supabase: ReturnType<typeof createClient<Database>>, unidade: string, mensagem: string, historico: { role: string; content: string }[] = []): Promise<BuscaAtividade> {
  const { data } = await supabase.from("documentos_rag").select("id, metadados").eq("tipo", "monthly_program").eq("unidade_cuca", unidade).eq("ativo", true).order("created_at", { ascending: false }).limit(1).single();
  const doc = data as { id: string; metadados: Record<string, unknown> | null } | null;
  if (!doc) return { conteudo: null, resolucao: "sem_documento" };

  const campanhaId = doc.metadados && typeof doc.metadados === "object" ? doc.metadados["campanha_id"] : null;
  if (typeof campanhaId !== "string" || !campanhaId) return { conteudo: null, resolucao: "sem_documento" };

  const { data: atividades } = await supabase.from("atividades_mensais").select("titulo, categoria, metadata").eq("campanha_id", campanhaId);
  const linhas = atividades as { titulo: string; categoria?: string | null; metadata: Record<string, unknown> | null }[] | null;
  if (!linhas || linhas.length === 0) return { conteudo: null, resolucao: "sem_documento" };

  const titulosDistintos = [...new Set(linhas.map((l) => l.titulo).filter((t): t is string => typeof t === "string" && t.trim() !== ""))];
  const resolucao = resolverAtividadeComDiagnostico(mensagem, titulosDistintos, historico);
  const atividade = resolucao.atividade;
  if (!atividade) return { conteudo: null, resolucao: resolucao.ambigua ? "ambigua" : "nao_encontrada" };

  const atividadeNorm = normalizarTexto(atividade);
  const linhasRelevantes = linhas.filter((l) => typeof l.titulo === "string" && normalizarTexto(l.titulo) === atividadeNorm);
  if (linhasRelevantes.length === 0) return { conteudo: null, resolucao: "nao_encontrada" };

  // S-WM-AUD-010 (CONCERN-5): "meu filho tem 15 anos" depois de perguntar de futsal deve devolver
  // só as turmas compatíveis, em vez de despejar todas. O dado existe em metadata.faixa_etaria e
  // nada o usava pra filtrar. `filtrarLinhasPorIdade` devolve TUDO quando não consegue
  // interpretar com segurança — esconder turma do cidadão é o pior erro possível aqui.
  const idade = extrairIdadeDaMensagem(mensagem);
  const linhasFiltradas = filtrarLinhasPorIdade(linhasRelevantes, idade);

  console.log("[motor-agente v18] Busca deterministica (metadata) de atividade: \"" + atividade + "\" (" + linhasFiltradas.length + "/" + linhasRelevantes.length + " turmas, unidade=" + unidade + ", origem=" + resolucao.origem + (idade !== null ? ", idade=" + idade : "") + ")");
  return { conteudo: linhasFiltradas.map((l) => formatarLinhaAtividadeDeterministica(l.titulo, l.metadata, l.categoria || "nao informado")).join("\n"), resolucao: "encontrada" };
}

/**
 * Achado 2026-10-09: programação de atividades sai SOMENTE do `monthly_program` ativo de cada
 * unidade. O antigo `resumo_rede` (documento à parte, inserido à mão em julho e nunca trocado)
 * deixou de ser lido aqui — mandava lista de cursos de julho para leads em outubro. Carrega o
 * `conteudo` dos documentos ativos (1 por unidade; se houver mais de um, vale o mais recente)
 * e devolve os itens já separados.
 */
// S-WM-72: o roteamento consulta a programação da rede em muitos turnos (~190 KB por carga). Cache
// curto no isolate (o cliente do banco é criado por requisição, então o cache fica no módulo) —
// desligado quando o handler recebe um cliente de teste.
const TTL_CACHE_PROGRAMACAO_MS = 90 * 1000;
let cacheItensProgramacao: { em: number; itens: ItemProgramacao[] } | null = null;

async function carregarItensProgramacaoRede(supabase: ReturnType<typeof createClient<Database>>, usarCache = false): Promise<ItemProgramacao[]> {
  // S-INST-QUAL-14 (decisão a): item com a data inteira passada sai. O corte é feito a cada chamada,
  // fora do cache, para o "hoje" nunca ficar congelado no cache.
  if (usarCache && cacheItensProgramacao && Date.now() - cacheItensProgramacao.em < TTL_CACHE_PROGRAMACAO_MS) return itensVigentes(cacheItensProgramacao.itens, hojeFortalezaISO());
  const itens = await carregarItensProgramacaoRedeSemCache(supabase);
  if (usarCache) cacheItensProgramacao = { em: Date.now(), itens };
  return itensVigentes(itens, hojeFortalezaISO());
}

async function carregarItensProgramacaoRedeSemCache(supabase: ReturnType<typeof createClient<Database>>): Promise<ItemProgramacao[]> {
  const { data: docs } = await supabase.from("documentos_rag").select("unidade_cuca, conteudo, created_at").eq("tipo", "monthly_program").eq("ativo", true).order("created_at", { ascending: false });
  const vistos = new Set<string>();
  const itens: ItemProgramacao[] = [];
  for (const d of (Array.isArray(docs) ? docs : []) as { unidade_cuca: string | null; conteudo: string | null }[]) {
    if (!d.unidade_cuca || !d.conteudo || vistos.has(d.unidade_cuca)) continue;
    vistos.add(d.unidade_cuca);
    itens.push(...extrairItensProgramacao(d.unidade_cuca, d.conteudo));
  }
  return itens;
}

/**
 * S-WM-51: carrega o documento de servicos institucionais ("servicos_rede") ativo por INTEIRO,
 * carregado por inteiro direto de `documentos_rag.conteudo` — nunca via `chunks_documentos`/
 * `buscar_chunks_similares` (ver migration `20260720000000_swm51_servicos_rede_skip_indexacao.sql`,
 * que estende no trigger `tr_indexar_documento` a mesma exceção já aplicada ao `resumo_rede`,
 * evitando chunk/embedding à toa). `unidade_cuca=null` por definição — é um documento único com o
 * padrão comum a todas as unidades + exceções já nomeando qual unidade tem cada uma, não um
 * documento por unidade. Retorna "" quando ainda não existe nenhum documento ativo desse tipo — o
 * caller trata isso como "sem dado", nunca como erro.
 */
async function carregarServicosRede(supabase: ReturnType<typeof createClient<Database>>): Promise<string> {
  const { data: doc } = await supabase.from("documentos_rag").select("conteudo").eq("tipo", "servicos_rede").eq("ativo", true).order("created_at", { ascending: false }).limit(1).single();
  return doc?.conteudo || "";
}

// ── S-INST-QUAL-08: avisos da rede com data de validade ───────────────────────────────────
/** Data de hoje em Fortaleza (AAAA-MM-DD). Nunca `toISOString()`: depois das 21h em Fortaleza o UTC
 * já está no dia seguinte. */
export function hojeFortalezaISO(agora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(agora);
  const p = (tipo: string) => partes.find((x) => x.type === tipo)?.value ?? "";
  return `${p("year")}-${p("month")}-${p("day")}`;
}

export type AvisoValido = { titulo: string; conteudo: string; valido_ate: string };
const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Avisos que vão ao bot hoje: categoria `geral` (sem categoria conta como geral; `matricula` é da
 * S-INST-QUAL-10), sem unidade, `valido_de <= hoje <= valido_ate` (datas inclusivas, AAAA-MM-DD).
 * Fim ausente ou mal formado: fora (na dúvida, o aviso não vai). Início ausente: já começou; início
 * mal formado: fora. Não depende do cron que desativa os vencidos (ele só arruma a tela). Qualquer
 * resultado que não seja lista vira lista vazia.
 */
export function avisosValidos(lista: unknown, hoje: string): AvisoValido[] {
  if (!Array.isArray(lista)) return [];
  const validos: AvisoValido[] = [];
  for (const item of lista) {
    if (!item || typeof item !== "object") continue;
    const d = item as { titulo?: unknown; conteudo?: unknown; metadados?: unknown; unidade_cuca?: unknown };
    if (d.unidade_cuca) continue;
    const m = (d.metadados && typeof d.metadados === "object" ? d.metadados : {}) as Record<string, unknown>;
    const categoria = typeof m.categoria === "string" && m.categoria ? m.categoria : "geral";
    if (categoria !== "geral") continue;
    const ate = m.valido_ate;
    if (typeof ate !== "string" || !DATA_ISO.test(ate) || ate < hoje) continue;
    const de = m.valido_de;
    if (de !== undefined && de !== null && de !== "") {
      if (typeof de !== "string" || !DATA_ISO.test(de) || de > hoje) continue;
    }
    const conteudo = typeof d.conteudo === "string" ? d.conteudo.trim() : "";
    if (!conteudo) continue;
    validos.push({ titulo: typeof d.titulo === "string" ? d.titulo.trim() : "", conteudo, valido_ate: ate });
  }
  return validos;
}

/** Bloco "AVISOS" do contexto: vai inteiro, logo depois da base institucional. "" sem aviso válido. */
export function montarBlocoAvisos(avisos: AvisoValido[]): string {
  if (!avisos.length) return "";
  const linhas = avisos.map((a) => {
    const [ano, mes, dia] = a.valido_ate.split("-");
    return `- ${a.titulo ? a.titulo + ": " : ""}${a.conteudo} (válido até ${dia}/${mes}/${ano})`;
  });
  return "\n\n--- AVISOS DA REDE (valem hoje para todas as unidades; num mesmo assunto, o aviso vale mais que os serviços da rede acima) ---\n" + linhas.join("\n");
}

async function carregarAvisos(supabase: ReturnType<typeof createClient<Database>>, hoje: string): Promise<AvisoValido[]> {
  const { data } = await supabase.from("documentos_rag").select("titulo, conteudo, metadados, unidade_cuca").eq("tipo", "aviso").eq("ativo", true).order("created_at", { ascending: true });
  return avisosValidos(data, hoje);
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
  Deno.serve((req: Request) => handler(req));
}

// `supabaseOverride` existe só para permitir teste automatizado do handler completo (AUD-04 —
// prova que a resolução de unidade por nome/dígito, na wiring real do call-site, gera o
// precisaVisaoGeral correto). Comportamento em produção idêntico: Deno.serve(handler) nunca
// passa esse 2º argumento, então o client real é sempre criado normalmente.
/** S-INST-QUAL-01 (A8): mensagem que vai num balao a mais no fim da resposta, qualquer que seja o
 * caminho que respondeu o resto (modelo, frase pronta, menu). Hoje so o Emprega+ do caso misto. */
type ExtrasResposta = { balaoFinal: { mensagem: string; salvar: () => Promise<void> } | null };

export async function handler(req: Request, supabaseOverride?: ReturnType<typeof createClient<Database>>): Promise<Response> {
  const extras: ExtrasResposta = { balaoFinal: null };
  const resp = await processarMensagem(req, supabaseOverride, extras);
  return extras.balaoFinal ? await acrescentarBalaoFinal(resp, extras.balaoFinal) : resp;
}

/** Acrescenta o balao no fim de `mensagens` (e de `resposta`, que e a juncao) e o grava no
 * historico, depois das mensagens que o fluxo ja gravou. Nunca quebra a resposta: qualquer falha
 * devolve a resposta original, sem o balao. */
async function acrescentarBalaoFinal(resp: Response, balao: NonNullable<ExtrasResposta["balaoFinal"]>): Promise<Response> {
  try {
    if (resp.status !== 200) return resp;
    const corpo = await resp.clone().json();
    if (corpo?.success !== true || typeof corpo.resposta !== "string" || !corpo.resposta) return resp;
    const base: string[] = Array.isArray(corpo.mensagens) && corpo.mensagens.length > 0 ? corpo.mensagens : [corpo.resposta];
    if (base.includes(balao.mensagem)) return resp;
    await balao.salvar();
    const mensagens = [...base, balao.mensagem];
    return new Response(JSON.stringify({ ...corpo, resposta: mensagens.join("\n\n"), mensagens }), { status: 200, headers: resp.headers });
  } catch (exc) {
    console.error("[motor-agente v18] Falha ao acrescentar o balao final, segue sem ele:", exc);
    return resp;
  }
}

async function processarMensagem(req: Request, supabaseOverride: ReturnType<typeof createClient<Database>> | undefined, extras: ExtrasResposta): Promise<Response> {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  console.log("[motor-agente v18] Recebendo requisicao...");

  try {
    const body = await req.json();
    const { mensagem, midia_url, midia_tipo, telefone, canal_origem, agente_tipo, unidade_cuca, conversa_id } = body;
    console.log("[motor-agente v18] Agente: " + agente_tipo + ", Unidade: " + unidade_cuca);

    if (!telefone || !agente_tipo) return new Response(JSON.stringify({ error: "telefone e agente_tipo sao obrigatorios" }), { status: 400 });

    const supabase = supabaseOverride ?? createClient<Database>(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    // S-WM-43 (PERF-02, Par 1): getOpenAIKey e o select de lead não têm dependência de dado
    // entre si (depois da S-WM-44 remover transcreverAudio, não sobra nenhuma chamada
    // assíncrona entre os dois que precisasse de openaiKey antes do lead) — paralelizados
    // para reduzir 1 round-trip de latência por mensagem.
    const [openaiKey, leadSelectResult] = await Promise.all([
      getOpenAIKey(supabase),
      supabase.from("leads").select("id,nome,opt_in,bloqueado").eq("telefone", telefone).single(),
    ]);
    if (!openaiKey) throw new Error("OPENAI_API_KEY nao encontrada");

    // S-INST-QUAL-01 (A8): `mensagemLead` e o texto como o lead mandou (vai para os registros).
    // `textoFinal` e o que o fluxo responde: no caso misto do Emprega+ vira so a outra pergunta.
    const mensagemLead: string = mensagem || "";
    let textoFinal = normalizarDigitosEmoji(mensagemLead);
    if (!textoFinal) return new Response(JSON.stringify({ error: "Nenhuma mensagem" }), { status: 400 });

    // 1. Lead
    let { data: lead, error: leadSelectError } = leadSelectResult;
    if (!lead) {
      const { data, error: leadInsertError } = await supabase.from("leads").insert({ telefone, unidade_cuca, origem: "whatsapp", opt_in: true }).select("id,nome,opt_in,bloqueado").single();
      lead = data;
      if (!lead && leadInsertError) {
        throw new Error("Falha ao resolver lead (select: " + (leadSelectError?.message ?? "sem linha") + "; insert: " + leadInsertError.message + ")");
      }
    }
    if (!lead || lead.bloqueado) return new Response(JSON.stringify({ blocked: true }), { status: 200 });

    // 2. Conversa
    let conversaJustCreated = false;
    // VAL-07 (docs/migracao-meta/VALIDACAO-producao-institucional.md), corrige AUD-15:
    // `conversaJustCreated` continua true tanto para inserção nova quanto para reabertura de
    // conversa encerrada — preservado de propósito, é o que o branch da Sofia (isSofia &&
    // menu_boas_vindas, logo abaixo) usa pra decidir se reenvia o menu de boas-vindas; mudar
    // isso mudaria o comportamento da Sofia, decisão que não é desta auditoria (comentário
    // original abaixo). `conversaGenuinamenteNova` é o flag novo, true SÓ na inserção de fato —
    // usado mais abaixo (precisaVisaoGeral, isAgenteProgramacao) pra não tratar reabertura como
    // "primeiro contato" só para Institucional/maria, sem tocar no fluxo de outros agentes.
    let conversaGenuinamenteNova = false;
    // S-WM-31 (Task 3, item 4 do Escopo): quando o caller manda conversa_id (worker já fez o
    // get-or-create atômico via upsert, Task 2), resolve por PK — evita re-derivar por
    // lead_id+origem_id e cai fora de qualquer corrida. Fallback pro método antigo quando
    // ausente (robustez pra qualquer caller futuro que não mande; hoje só existe 1 caller,
    // worker/meta_adapter_inbound.py).
    let { data: conversa, error: conversaSelectError } = conversa_id
      ? await supabase.from("conversas").select("id, status, metadata, lead_id").eq("id", conversa_id).single()
      : await supabase.from("conversas").select("id, status, metadata, lead_id").eq("lead_id", lead.id).eq("origem_id", canal_origem || "test").single();

    if (conversa_id && conversa && conversa.lead_id !== lead.id) {
      return new Response(JSON.stringify({ error: "conversa_id nao pertence ao lead informado" }), { status: 403 });
    }

    // S-WM-45 (BUG-03): erro real na busca de conversa_id não pode cair silenciosamente em criar
    // conversa nova (órfã) — só quando conversa_id foi explicitamente informado (o caller estava
    // confiante de que essa conversa existe) E há um error real (não "não encontrado").
    if (conversa_id && !conversa && conversaSelectError) {
      throw new Error("Falha ao buscar conversa_id=" + conversa_id + ": " + conversaSelectError.message);
    }

    if (!conversa) {
      const { data } = await supabase.from("conversas").insert({ lead_id: lead.id, origem_id: canal_origem || "test", agente_tipo, canal_ativo: "meta", status: "ativa" }).select("id, status, metadata, lead_id").single();
      conversa = data; conversaJustCreated = true; conversaGenuinamenteNova = true;
    } else if (conversa.status === "encerrada") {
      // AUD-15/VAL-07: reabrir uma conversa encerrada tratava o lead como contato novo
      // (conversaJustCreated=true) só pela ausência da distinção acima — confirmado em
      // produção que isso recarrega os ~40 chunks do monthly_program e diz ao GPT "esta é a
      // primeira mensagem" para quem já conversou minutos antes (17min no caso real). motor-
      // agente é compartilhado por outros agente_tipo (Sofia/Ouvidoria); `conversaJustCreated`
      // continua true aqui de propósito (Sofia decide sozinha, fora de escopo mudar), só
      // `conversaGenuinamenteNova` fica false — o que muda é escopado a Institucional/maria
      // via isAgenteProgramacao mais abaixo.
      await supabase.from("conversas").update({ status: "ativa", updated_at: new Date().toISOString() }).eq("id", conversa.id);
      conversaJustCreated = true;
    }

    // 3. Mensagem do lead — NÃO gravar aqui (S-WM-17). Quem chama esta function (hoje,
    // sempre worker/meta_adapter_inbound.py::processar_webhook_meta) já persiste lead,
    // conversa e a mensagem do lead antes de invocar este endpoint. Gravar de novo aqui
    // duplicava cada mensagem do lead (worker + function), causando registro e resposta
    // dobrados no canal Institucional/Ouvidoria/Acesso CUCA. O histórico (passo 4 abaixo)
    // já encontra a mensagem, gravada pelo chamador, sem precisar reinseri-la.

    // 4. Histórico + 5. Prompt — S-WM-43 (PERF-02, Par 2): sem dependência de dado entre si,
    // paralelizados.
    const [{ data: hist }, { data: prompt }] = await Promise.all([
      supabase.from("mensagens").select("conteudo,remetente,created_at").eq("conversa_id", conversa.id).order("created_at", { ascending: false }).limit(MAX_HISTORICO),
      supabase.from("prompts_agentes").select("prompt_sistema,prompt_contexto,temperatura,max_tokens,menu_boas_vindas,updated_at").eq("agente_tipo", agente_tipo).eq("ativo", true).single(),
    ]);
    // S-WM-71 (Item 1): no Institucional/maria o histórico que vai para o modelo e para os
    // classificadores é só o da sessão atual (corte em intervalo > LIMITE_SESSAO_MS). As mensagens
    // antigas continuam no banco. Outros agente_tipo seguem com o histórico completo, como antes.
    const histAsc = ((hist || []) as { conteudo: string; remetente: string; created_at?: string | null }[]).reverse();
    const ehAgenteDeProgramacao = agente_tipo === 'Institucional' || agente_tipo === 'maria';
    const recorteSessao = ehAgenteDeProgramacao ? recortarSessao(histAsc) : { mensagens: histAsc, sessaoNova: false };
    const sessaoNova = recorteSessao.sessaoNova;
    let historico = recorteSessao.mensagens.map((m) => ({ role: m.remetente === "lead" ? "user" : "assistant", content: m.conteudo || "" }));
    if (!prompt) throw new Error("Prompt nao encontrado para: " + agente_tipo);

    // S-INST-QUAL-05: rajada inteira (mensagens do cidadão depois da última resposta do bot). Só
    // Institucional/maria e só com a chave ROTA_USA_RAJADA ligada; sem mensagem anterior na rajada,
    // tudo abaixo fica idêntico ao de antes (textoRota = textoFinal, historicoRota = historico).
    const usaRajada = ehAgenteDeProgramacao && rotaUsaRajada();
    const historicoComData = recorteSessao.mensagens.map((m) => ({ role: m.remetente === "lead" ? "user" : "assistant", content: m.conteudo || "", created_at: m.created_at }));
    let rajadaAnteriores = usaRajada ? anterioresDaRajada(historicoComData, textoFinal, mensagemLead) : [];
    let mensagensRajada = [...rajadaAnteriores, textoFinal.trim()];
    let textoRota = rajadaAnteriores.length ? mensagensRajada.join("\n") : textoFinal;
    let historicoRota = rajadaAnteriores.length ? historicoAntesDaRajada(historico) : historico;
    if (rajadaAnteriores.length) console.log("[motor-agente v18] Rajada: " + mensagensRajada.length + " mensagens decidem a rota");

    // S-WM-AUD-007 (@qa FAIL-1 + LOW da Revisao 2): os turnos que retornam ANTES do Passo 6 nao
    // chegavam ao insert, e o comentario do Passo 6 afirmava o contrario. Cada saida registra a
    // sua PROPRIA camada — dado melhor que um `nao_aplicavel` generico: permite separar "nao
    // buscou porque era handover" de "buscou e nao achou".
    //
    // `unidadeEfetiva` foi PROMOVIDA pra ca (antes do handover) por dois motivos: o handover
    // retorna antes do ponto onde ela era declarada, e o helper precisa ler o valor CORRENTE —
    // nas saidas posteriores a unidade pode ter sido trocada no mesmo turno, e gravar o parametro
    // cru registraria a unidade ANTERIOR (@qa Revisao 2, LOW). Sendo closure sobre a variavel, le
    // o valor no momento da chamada, nao no da definicao.
    let unidadeEfetiva = unidade_cuca;
    // S-INST-QUAL-06: true = a leitura do turno falhou e a rota antiga decidiu (plano B); false = a
    // rota estruturada decidiu; null = rota antiga por escolha (chave desligada, dígito da lista,
    // resposta a pergunta pendente). Lida no momento de cada registro.
    let rotaFallback: boolean | null = null;

    const logarTurnoSemBusca = (camada: string) =>
      manterVivoAposResposta(registrarBuscaRAG(supabase, {
        conversa_id: conversa?.id ?? null,
        agente_tipo,
        unidade_cuca: (unidadeEfetiva as string | null) ?? null,
        camada,
        atividade_resolvida: null,
        chunks_retornados: null,
        mensagem_lead: mensagemLead,
        rota_fallback: rotaFallback,
        ...BUSCA_NAO_APLICAVEL,
      }));

    // S-WM-71 (Item 1): sessão nova (mais de 2h desde a mensagem anterior) zera o estado de "onde
    // o lead está" — unidade, espera por unidade, menu de categoria, engajamento. `ultimo_disparo`
    // fica. Roda ANTES de qualquer retorno antecipado (ex.: handover logo abaixo) — senão uma sessão
    // aberta com pedido de atendente humano nunca seria zerada (achado C1 do @qa).
    let metadataInicialDaSessao: Record<string, unknown> = (conversa?.metadata as Record<string, unknown>) || {};
    // S-INST-QUAL-06: unidade salva ANTES do corte de sessão (a S-WM-71 zera logo abaixo) — a rota
    // estruturada usa para confirmar o escopo quando a conversa é retomada.
    const unidadeAntesDaSessao = (metadataInicialDaSessao.unidade_selecionada as string | null | undefined) ?? null;
    // Contexto da conversa de antes do corte (idade, interesse...): volta a valer se a pessoa confirmar
    // a mesma unidade; com "não", a conversa recomeça sem ele.
    // S-INST-QUAL-14: o dia volta junto com o turno; "hoje"/"amanhã" de um dia que já passou, não.
    const contextoAntesDaSessao = semDataVencida((metadataInicialDaSessao.prog_contexto ?? {}) as Record<string, unknown>, hojeFortalezaISO());
    if (sessaoNova) {
      await supabase.rpc('merge_conversa_metadata', { p_conversa_id: conversa!.id, p_patch: LIMPEZA_ESTADO_SESSAO });
      metadataInicialDaSessao = { ...metadataInicialDaSessao, ...LIMPEZA_ESTADO_SESSAO };
      console.log("[motor-agente v18] Sessao nova (intervalo > " + (LIMITE_SESSAO_MS / 3600000) + "h): estado da conversa zerado");
    }

    const pedeTransbordo = rajadaAnteriores.length
      ? deveAcionarHandoverNaRajada(mensagensRajada, agente_tipo)
      : deveAcionarHandoverInstitucional(textoFinal, agente_tipo);
    // S-INST-QUAL-06 (decisão do Junior, 14/11): fora do horário do atendente (o mesmo do Emprega+),
    // o pedido de atendente recebe o horário e a IA segue ativa — sem `awaiting_human`.
    const responderForaDoHorario = async (): Promise<Response> => {
      const resposta = MENSAGEM_FORA_HORARIO_ATENDENTE;
      await salvarMensagemAgente(supabase, conversa!.id, lead.id, resposta);
      logarTurnoSemBusca("handover_fora_horario");
      return new Response(JSON.stringify({ success: true, agente_usado: agente_tipo, handover: false, encerrado: false, resposta, mensagens: [resposta] }), { headers: { "Content-Type": "application/json" } });
    };
    if (pedeTransbordo) {
      if (!dentroHorarioAtendimentoHumano()) return await responderForaDoHorario();
      const resposta = "Vou te encaminhar para um atendente humano, só um momento!";
      await salvarMensagemAgente(supabase, conversa.id, lead.id, resposta);
      const { error: handoverError } = await supabase.from("conversas").update({ status: "awaiting_human", updated_at: new Date().toISOString() }).eq("id", conversa.id);
      if (handoverError) {
        console.error("[motor-agente v18] Falha ao marcar conversa como awaiting_human conversa_id=" + conversa.id + " agente_tipo=" + agente_tipo + " erro=" + handoverError.message);
      }
      logarTurnoSemBusca("handover");
      return new Response(JSON.stringify({ success: true, agente_usado: agente_tipo, handover: true, encerrado: false, resposta, mensagens: [resposta] }), { headers: { "Content-Type": "application/json" } });
    }

    // S-INST-QUAL-01 (A8): Emprega+, antes do menu e das frases prontas. So emprego → contato do
    // Emprega+ e fim. "Vagas" sem contexto → pergunta se e emprego ou curso (sem estado novo: a
    // resposta "emprego" cai aqui de novo; "curso"/"atividade" segue o fluxo normal). Emprego
    // junto com outra pergunta → o fluxo normal responde a outra parte e o Emprega+ vai num balao a
    // mais no fim (`extras.balaoFinal`), qualquer que seja o caminho que responder.
    // Decisao do Junior (03/11): quem decide se e emprego e o modelo (`classificarEmpregoComModelo`);
    // a lista de palavras so entra se a chamada falhar. No caso misto, o modelo devolve a outra
    // pergunta separada, e o resto do fluxo (classificadores, busca e resposta) recebe so ela.
    const conversaEmProgramacaoEmprego = conversaEmContextoDeProgramacao(metadataInicialDaSessao, textoUltimoBlocoAgente(historico));
    const conversaIdClassificador = conversa?.id ?? null;
    // S-INST-QUAL-03: o mesmo registro do classificador de emprego, agora para toda chamada de IA
    // do turno (classificador de rota, interpretador da S-WM-72, embeddings). Em segundo plano
    // (`manterVivoAposResposta`), sem atrasar a resposta; falha no registro nunca chega ao cidadão.
    const criarRegistroConsumo = (feature: string, modeloPadrao: string) => (corpo: RespostaOpenAIUso, latenciaMs: number) => {
      manterVivoAposResposta((async () => {
        const u = corpo.usage ?? {};
        const modelo = corpo.model ?? modeloPadrao;
        await registrarUsoLLM(supabase, {
          agente_tipo,
          feature,
          modelo,
          tokens_prompt: u.prompt_tokens ?? 0,
          tokens_completion: u.completion_tokens ?? 0,
          tokens_prompt_cached: u.prompt_tokens_details?.cached_tokens ?? 0,
          custo_usd: calcularCustoUsd(modelo, u.prompt_tokens ?? 0, u.prompt_tokens_details?.cached_tokens ?? 0, u.completion_tokens ?? 0, await carregarPrecosOpenAI(supabase)),
          conversa_id: conversaIdClassificador,
          latencia_ms: latenciaMs,
          openai_request_id: corpo.id ?? null,
        });
      })());
    };
    const registrarConsumoClassificador = criarRegistroConsumo("classificador_emprego", GPT_MODEL);
    const registrarConsumoRota = criarRegistroConsumo("classificacao_rota", "gpt-4o-mini");
    const registrarConsumoInterpretacao = criarRegistroConsumo("interpretacao_programacao", "gpt-4o-mini");
    const registrarConsumoEmbedding = criarRegistroConsumo("embedding", EMBEDDING_MODEL);
    const registrarConsumoLeitura = criarRegistroConsumo("leitura_rota", "gpt-4o-mini");
    // S-INST-QUAL-06: rota estruturada — só Institucional/maria no número Geral, com a chave ligada.
    // A leitura é feita no máximo uma vez por turno (memorizada) e sobre a rajada (story 05).
    const rotaNovaLigada = ehAgenteDeProgramacao && unidade_cuca === 'Geral' && await lerChaveRotaEstruturada(supabase, !supabaseOverride);
    let leituraPromessa: Promise<LeituraTurno | null> | null = null;
    const obterLeitura = (): Promise<LeituraTurno | null> => leituraPromessa ??= lerTurnoInstitucional(textoRota, openaiKey, historicoRota, registrarConsumoLeitura)
      .then((l) => {
        rotaFallback = l === null;
        return l ? consolidarLeitura(l, textoRota, mensagensRajada) : null;
      });
    const decisaoEmprego = await decidirEmprego(
      textoRota,
      agente_tipo,
      conversaEmProgramacaoEmprego,
      () => classificarEmpregoComModelo(textoRota, openaiKey, historicoRota, conversaEmProgramacaoEmprego, registrarConsumoClassificador),
    );
    const classificacaoEmprego = decisaoEmprego.classificacao;
    if (decisaoEmprego.fonte === "lista") console.log("[motor-agente v18] Emprego decidido pela lista de reserva: " + classificacaoEmprego);
    // S-INST-QUAL-06: com a rota estruturada, "vagas" sem contexto é decidido pela leitura (que lê a
    // conversa: "vagas" depois de natação é vaga de natação). Se a leitura falhar, vale o de antes.
    const vagasPelaLeitura = classificacaoEmprego === "vagas_ambiguo" && rotaNovaLigada && (await obterLeitura()) !== null;
    if (classificacaoEmprego === "emprego" || (classificacaoEmprego === "vagas_ambiguo" && !vagasPelaLeitura)) {
      const resposta = classificacaoEmprego === "emprego"
        ? montarMensagemEncaminhamento("empregabilidade", await buscarNumeroCanal(supabase, "empregabilidade"))
        : PERGUNTA_VAGA_AMBIGUA;
      await salvarMensagemAgente(supabase, conversa!.id, lead.id, resposta);
      logarTurnoSemBusca(classificacaoEmprego === "emprego" ? "emprega_mais" : "vagas_ambiguo");
      return new Response(JSON.stringify({ success: true, agente_usado: agente_tipo, handover: false, encerrado: false, resposta, mensagens: [resposta] }), { headers: { "Content-Type": "application/json" } });
    }
    const empregaMisto = classificacaoEmprego === "emprego_misto";
    if (empregaMisto) {
      const mensagemEmprega = montarMensagemEncaminhamento("empregabilidade", await buscarNumeroCanal(supabase, "empregabilidade"));
      const conversaIdEmprega = conversa!.id;
      const leadIdEmprega = lead.id;
      extras.balaoFinal = { mensagem: mensagemEmprega, salvar: () => salvarMensagemAgente(supabase, conversaIdEmprega, leadIdEmprega, mensagemEmprega) };
      if (decisaoEmprego.outraPergunta) {
        // S-INST-QUAL-05: com rajada, a rajada inteira vira só a outra pergunta (o modelo separou a
        // outra pergunta da rajada toda); a rajada não é recalculada depois disso.
        historico = rajadaAnteriores.length
          ? trocarRajadaNoHistorico(historico, decisaoEmprego.outraPergunta)
          : trocarUltimaMensagemDoLead(historico, mensagemLead, decisaoEmprego.outraPergunta);
        textoFinal = decisaoEmprego.outraPergunta;
        textoRota = textoFinal;
        mensagensRajada = [textoFinal];
        rajadaAnteriores = [];
        historicoRota = historico;
      }
    }


    const isSofia = agente_tipo === "sofia" || agente_tipo === "sofia_global" || agente_tipo === "sofia_unidade";
    if (conversaJustCreated && isSofia && prompt.menu_boas_vindas) {
      await salvarMensagemAgente(supabase, conversa.id, lead.id, prompt.menu_boas_vindas);
      logarTurnoSemBusca("menu_abertura");
      return new Response(JSON.stringify({ success: true, agente_usado: agente_tipo, handover: false, resposta: prompt.menu_boas_vindas, menu_boas_vindas: true }), { headers: { "Content-Type": "application/json" } });
    }

    // 5b. Seleção / troca de unidade (instância Geral)
    // `unidadeEfetiva` foi declarada mais acima (antes do handover) — ver S-WM-AUD-007.
    let trocouUnidade = false;
    // S-WM-34 (VAL-23): true quando a mensagem que causou trocouUnidade=true JÁ trazia um pedido
    // específico junto (ex.: "e no Mondubim, tem natação de noite?") — usado no Passo 6 pra NÃO
    // disparar a instrução de "resumo geral", que hoje suprime esse dado específico mesmo com o
    // contexto certo carregado (achado ao vivo, causa raiz confirmada em código). Setado em cada
    // um dos 4 pontos que podem levar trocouUnidade a true, logo abaixo.
    let trocaComPedidoEspecifico = false;
    // VAL-12: true quando o lead fez uma pergunta institucional real sem unidade escolhida
    // (1ª mensagem ou dentro de aguardando_unidade) — sinaliza pro Passo 6 buscar RAG geral
    // (FAQ isolado) em vez de early-return com o menu.
    let perguntaGeralAtiva = false;
    // S-INST-QUAL-06: true quando a rota estruturada decidiu o turno — pula o interpretador da
    // S-WM-72 (B) e a seção 5b; o Passo 6 lê as mesmas variáveis que a 5b preencheria.
    let rotaDecidida = false;
    // Fix CRITICAL (S-WM-21, achado do @qa Quinn): `conversa.metadata` é a foto de ANTES desta
    // requisição — nunca é atualizada em memória depois de um `.update()`. `.update({metadata:
    // {...}})` no Supabase SUBSTITUI a coluna JSONB inteira (não faz merge no banco). Um turno
    // pode gravar `metadata` mais de uma vez (seção 5b resolve/troca unidade E, no mesmo turno,
    // o Passo 6 grava `menu_categoria_ativo`) — se o 2º write mesclar sobre a foto ANTIGA, ele
    // apaga o que o 1º acabou de gravar. `metadataAtual` é o tracker único, em memória, do
    // estado mais recente: TODO write de metadata neste turno tem que mesclar sobre ele (nunca
    // sobre `conversa.metadata` direto) e atualizá-lo logo em seguida. Escopo no nível de
    // `unidadeEfetiva` (fora do `if` abaixo) de propósito — o Passo 6 (fora deste `if`) também
    // precisa ler/escrever o mesmo tracker.
    let metadataAtual: Record<string, unknown> = metadataInicialDaSessao;
    // S-WM-71 (Item 3): "procure em outras unidades" sem dizer qual — busca na rede no Passo 6.
    const pedidoOutrasUnidades = ehAgenteDeProgramacao && pedeOutrasUnidades(textoFinal);
    // Achado 2026-10-09: dígito solto é resolvido contra a lista que o agente REALMENTE mostrou
    // no turno anterior (ver resolverDigitoPelaListaDoAgente), não contra o menu fixo.
    const blocoAnteriorAgente = textoUltimoBlocoAgente(historico);

    // ── S-WM-72: roteamento de programação (Institucional/maria, número Geral) ─────────────────
    // Roda antes da seção 5b e só assume o turno quando tem certeza: resposta à pergunta de
    // escopo/área que ELE fez, ou mensagem com cara de programação que o interpretador semântico
    // classifica como pergunta/continuação. Em qualquer outro caso, a seção 5b de hoje segue igual.
    type ConsultaProgramacao = { texto: string; atividade: string | null; termos: string[]; area: AreaProgramacao | null; contexto: Record<string, unknown>; escopo: string; perguntaOriginal: boolean; listarPorIdade?: boolean; tituloExato?: string | null; filtroHerdado?: string[] };
    // S-INST-QUAL-06: `leitura`, `confirmar_escopo` e `aguardando_atividade` só são gravados pela rota estruturada.
    type PendenteProgramacao = { texto: string; atividade: string | null; termos?: string[]; area: AreaProgramacao | null; contexto?: Record<string, unknown>; aguardando_area?: boolean; leitura?: LeituraTurno; confirmar_escopo?: string; contexto_anterior?: Record<string, unknown>; aguardando_atividade?: { opcoes: string[]; escopo: string } };
    let consultaProgramacao: ConsultaProgramacao | null = null;
    const usarCacheProgramacao = !supabaseOverride;
    if (ehAgenteDeProgramacao && unidade_cuca === 'Geral') {
      const pendente = (metadataAtual.prog_pendente ?? null) as PendenteProgramacao | null;
      const escopoSessao: string | null = (metadataAtual.unidade_selecionada as string | null) || (metadataAtual.prog_escopo === ESCOLHA_REDE ? ESCOLHA_REDE : null);
      // S-INST-QUAL-14 (decisões do Junior, 16/11): o dia e o turno guardados continuam valendo nas
      // perguntas seguintes; "hoje"/"amanhã" de um dia que já passou saem; "qualquer dia/horário" e
      // "tanto faz" (sobre dia ou horário) tiram o filtro — e isso é gravado já, em qualquer caminho.
      const contextoGravado = (metadataAtual.prog_contexto ?? {}) as Record<string, unknown>;
      const tirarFiltro = pedidoDeTirarFiltro(textoRota, blocoAnteriorAgente);
      const contextoSessao = mesclarContextoDaConversa(semDataVencida(contextoGravado, hojeFortalezaISO()), {}, tirarFiltro);
      /** Contexto da conversa depois da leitura desta mensagem (ver `mesclarContextoDaConversa`). */
      const contextoDoTurno = (novo: Record<string, unknown>, textoPedido: string = textoRota) => mesclarContextoDaConversa(contextoSessao, novo, tirarFiltro, lerMensagemAtual(textoPedido).contexto);
      const gravarMetadata = async (patch: Record<string, unknown>) => {
        metadataAtual = { ...metadataAtual, ...patch };
        await supabase.rpc('merge_conversa_metadata', { p_conversa_id: conversa!.id, p_patch: metadataAtual as unknown as Database["public"]["Functions"]["merge_conversa_metadata"]["Args"]["p_patch"] });
      };
      // R9: mesmo contrato dos outros retornos antecipados.
      if (JSON.stringify(contextoSessao) !== JSON.stringify(contextoGravado)) {
        console.log("[motor-agente v18] Filtro da conversa: " + (tirarFiltro.dia || tirarFiltro.turno ? "pedido para tirar " + [tirarFiltro.dia ? "dia" : "", tirarFiltro.turno ? "turno" : ""].filter(Boolean).join(" e ") : "data de hoje/amanha vencida"));
        await gravarMetadata({ prog_contexto: contextoSessao });
      }
      const responderPerguntaPronta = async (resposta: string, patch: Record<string, unknown>, camada: string) => {
        const respostaFinal = evitarRepeticaoLiteral(resposta, historico);
        await gravarMetadata({ ...patch, conversa_engajada: true, aguardando_unidade: false });
        await salvarMensagemAgente(supabase, conversa!.id, lead.id, respostaFinal);
        logarTurnoSemBusca(camada);
        return new Response(JSON.stringify({ success: true, resposta: respostaFinal, handover: false }), { headers: { "Content-Type": "application/json" } });
      };
      const patchEscopo = (escopo: string): Record<string, unknown> => escopo === ESCOLHA_REDE
        ? { unidade_selecionada: null, prog_escopo: ESCOLHA_REDE }
        : { unidade_selecionada: escopo, prog_escopo: null };
      const primeiraRespostaDaSessao = !historico.some((m) => m.role === "assistant");
      const introducaoPergunta = (sobre: string) => {
        const nome = sanitizarNomeLead(lead.nome);
        const primeiroNome = nome === "Nao informado" ? "" : nome.split(" ")[0];
        const saudacao = primeiraRespostaDaSessao ? (primeiroNome ? "Olá, " + primeiroNome + "! " : "Olá! ") : "";
        const disparo = metadataAtual.ultimo_disparo as { titulo?: string; enviado_em?: string } | undefined;
        // R2/decisão 3: resposta a disparo reconhece o aviso na mesma mensagem.
        const aviso = primeiraRespostaDaSessao && disparo?.titulo && deveReconhecerDisparoRecente(disparo, false) ? "Vi que você recebeu nosso aviso sobre " + disparo.titulo + ". " : "";
        return saudacao + aviso + "De qual unidade você quer saber" + (sobre ? " sobre " + sobre : "") + "? Se preferir, vejo em toda a Rede CUCA 😊";
      };

      // ── S-INST-QUAL-06: rota estruturada — executa a ação de `decidirRota` ─────────────────────
      // Respostas prontas voltam como Response (fim do turno). As outras ações preenchem as mesmas
      // variáveis que a 5b e a S-WM-72 preenchem, e o Passo 6 segue como sempre.
      const estadoRota = (l: LeituraTurno, itens: ItemProgramacao[], textoDoPedido: string = textoRota): EstadoRota => ({
        unidadeSalva: (metadataAtual.unidade_selecionada as string | null | undefined) ?? null,
        unidadeAnterior: unidadeAntesDaSessao,
        escopoRedeSalvo: metadataAtual.prog_escopo === ESCOLHA_REDE,
        sessaoReaberta: sessaoNova || (conversaJustCreated && !conversaGenuinamenteNova),
        primeiraRespostaDaSessao,
        ultimaRespostaFoiPronta: ultimaRespostaFoiFrasePronta(historico),
        disparoRecente: deveReconhecerDisparoRecente(metadataAtual.ultimo_disparo as { enviado_em?: string } | undefined, false),
        contextoDeProgramacao: conversaEmProgramacaoEmprego,
        pedeDetalhe: mensagemPedeDetalhe(textoDoPedido),
        atividadeNovaNaConversa: atividadeNovaNaConversa(l, historicoRota),
        opcoesAtividade: (escopo: string) => opcoesDeAtividade(itens, l, escopo),
        filtroDaConversa: temFiltroDeDiaOuTurno(contextoDoTurno(l.contexto, textoDoPedido)), // S-INST-QUAL-14
      });
      const itensParaLeitura = async (l: LeituraTurno) => l.atividade || l.termos_busca.length ? await carregarItensProgramacaoRede(supabase, usarCacheProgramacao) : [];
      const pendenteDaLeitura = (l: LeituraTurno, textoPedido: string, extra: Record<string, unknown> = {}) => ({ texto: textoPedido, atividade: l.atividade, termos: l.termos_busca, area: l.area, contexto: contextoDoTurno(l.contexto, textoPedido), leitura: l, ...extra });
      const responderJson = (corpo: Record<string, unknown>) => new Response(JSON.stringify({ success: true, ...corpo }), { headers: { "Content-Type": "application/json" } });
      const executarAcao = async (acao: AcaoRota, l: LeituraTurno, textoPedido: string): Promise<Response | null> => {
        const contexto = contextoDoTurno(l.contexto, textoPedido);
        const comEscopo = (escopo: string, daMensagem: boolean) => daMensagem ? patchEscopo(escopo) : {};
        switch (acao.acao) {
          case "handover": {
            if (!dentroHorarioAtendimentoHumano()) return await responderForaDoHorario();
            const resposta = "Vou te encaminhar para um atendente humano, só um momento!";
            await salvarMensagemAgente(supabase, conversa!.id, lead.id, resposta);
            const { error: handoverError } = await supabase.from("conversas").update({ status: "awaiting_human", updated_at: new Date().toISOString() }).eq("id", conversa!.id);
            if (handoverError) console.error("[motor-agente v18] Falha ao marcar conversa como awaiting_human conversa_id=" + conversa!.id + " erro=" + handoverError.message);
            logarTurnoSemBusca("handover");
            return responderJson({ agente_usado: agente_tipo, handover: true, encerrado: false, resposta, mensagens: [resposta] });
          }
          case "menu_unidades": {
            const unidades = unidadesCitadas(textoPedido);
            const resposta = evitarRepeticaoLiteral((unidades.length >= 2 ? "Vi que você citou mais de uma unidade (" + unidades.join(" e ") + ").\n\n" : "") + MENU_UNIDADES, historico);
            await gravarMetadata({ prog_pendente: pendenteDaLeitura(l, textoPedido), prog_contexto: contexto, aguardando_unidade: true, conversa_engajada: true });
            await salvarMensagemAgente(supabase, conversa!.id, lead.id, resposta);
            logarTurnoSemBusca("ambiguidade_unidade");
            return responderJson({ resposta, handover: false });
          }
          case "saudacao":
            return await responderPerguntaPronta(SAUDACOES_ABERTURA[Math.floor(Math.random() * SAUDACOES_ABERTURA.length)] + "\n\nEm que posso te ajudar? 😊", {}, "resposta_canned");
          case "cortesia":
            return await responderPerguntaPronta("Em que mais posso te ajudar? 😊", {}, "resposta_canned");
          case "despedida": {
            const resposta = "Que bom poder ajudar! 😊 Se precisar de mais alguma coisa, é só chamar por aqui. Até logo! 👋";
            await gravarMetadata({ conversa_engajada: true, aguardando_unidade: false, prog_pendente: null });
            await salvarMensagemAgente(supabase, conversa!.id, lead.id, resposta);
            await supabase.from("conversas").update({ status: "encerrada", updated_at: new Date().toISOString() }).eq("id", conversa!.id);
            logarTurnoSemBusca("encerramento");
            return responderJson({ resposta, handover: false, encerrado: true });
          }
          case "encaminhar": {
            const numero = await buscarNumeroCanal(supabase, acao.canal);
            const telefones = acao.canal === "acesso_cuca" && !numero ? await buscarTelefonesUnidades(supabase) : [];
            return await responderPerguntaPronta(montarMensagemEncaminhamento(acao.canal, numero, telefones), {}, acao.canal === "empregabilidade" ? "emprega_mais" : "encaminhamento");
          }
          case "perguntar_vaga":
            return await responderPerguntaPronta(PERGUNTA_VAGA_AMBIGUA, {}, "vagas_ambiguo");
          case "confirmar_escopo":
            // A pergunta é uma bifurcação: o contexto de antes fica guardado à parte e só volta se a
            // pessoa confirmar a mesma unidade. Enquanto isso, vale só o que a mensagem atual disse.
            return await responderPerguntaPronta(montarPerguntaConfirmarEscopo(acao.unidade, acao.sobre), {
              prog_pendente: { ...pendenteDaLeitura(l, textoPedido, { confirmar_escopo: acao.unidade, contexto_anterior: { ...contextoAntesDaSessao, ...contextoSessao } }), contexto: { ...l.contexto } },
              prog_contexto: { ...l.contexto },
            }, "confirmar_escopo");
          case "perguntar_escopo":
            return await responderPerguntaPronta(montarPerguntaEscopo(introducaoPergunta(l.atividade ?? (l.area ? ROTULO_AREA[l.area] : ""))), { prog_pendente: pendenteDaLeitura(l, textoPedido), prog_contexto: contexto }, "pergunta_escopo");
          case "perguntar_area":
            return await responderPerguntaPronta(PERGUNTA_AREA, { ...comEscopo(acao.escopo, acao.escopoDaMensagem), prog_pendente: { ...pendenteDaLeitura(l, textoPedido), aguardando_area: true }, prog_contexto: contexto }, "pergunta_area");
          case "perguntar_atividade":
            return await responderPerguntaPronta(montarPerguntaAtividade(acao.opcoes, acao.escopo), { ...comEscopo(acao.escopo, acao.escopoDaMensagem), prog_pendente: pendenteDaLeitura(l, textoPedido, { aguardando_atividade: { opcoes: acao.opcoes, escopo: acao.escopo } }), prog_contexto: contexto }, "atividade_ambigua");
          case "programacao":
            await gravarMetadata({ ...comEscopo(acao.escopo, acao.escopoDaMensagem), prog_pendente: null, conversa_engajada: true, aguardando_unidade: false, ...(descreverContexto(l.contexto) ? { prog_contexto: contexto } : {}) });
            consultaProgramacao = { texto: textoPedido, atividade: l.atividade, termos: l.termos_busca, area: l.area, contexto, escopo: acao.escopo, perguntaOriginal: textoPedido !== textoRota, listarPorIdade: acao.listarPorIdade, filtroHerdado: filtroHerdadoDoContexto(contexto, lerMensagemAtual(textoPedido).contexto, l.contexto) };
            rotaDecidida = true;
            return null;
          case "unidade":
            await gravarMetadata({ ...patchEscopo(acao.unidade), prog_pendente: null, conversa_engajada: true, aguardando_unidade: false });
            unidadeEfetiva = acao.unidade;
            // Programação inteira (resumo geral) só quando a pessoa só escolheu a unidade ou pediu "o
            // que tem"; com pedido, o Passo 6 responde o pedido (nunca a programação inteira).
            trocouUnidade = acao.troca || !acao.pedido;
            trocaComPedidoEspecifico = acao.pedido;
            rotaDecidida = true;
            return null;
          case "pergunta_geral":
            await gravarMetadata({ prog_pendente: null, conversa_engajada: true, aguardando_unidade: false });
            perguntaGeralAtiva = true;
            rotaDecidida = true;
            return null;
          case "gpt_livre":
            await gravarMetadata({ conversa_engajada: true, aguardando_unidade: false });
            rotaDecidida = true;
            return null;
        }
      };

      // Escopo escolhido para a pergunta pendente (menu de unidades ou confirmação de escopo): grava e
      // responde a pergunta que ficou esperando.
      const seguirComEscopo = async (escolha: string, pend: PendenteProgramacao, patchExtra: Record<string, unknown> = {}): Promise<Response | null> => {
        await gravarMetadata({ ...patchEscopo(escolha), ...patchExtra, prog_pendente: null, conversa_engajada: true, aguardando_unidade: false });
        // S-INST-QUAL-06: pergunta pendente da rota estruturada — decide de novo com o escopo escolhido
        // (atividade ambígua, idade, programação). Só esses três desfechos; os outros seguem como antes.
        if (pend.leitura && rotaNovaLigada) {
          const l: LeituraTurno = { ...pend.leitura, escopo: escolha, unidade_citada: null };
          const acao = decidirRota(l, estadoRota(l, await itensParaLeitura(l), pend.texto));
          if (acao.acao === "programacao" || acao.acao === "perguntar_atividade" || acao.acao === "perguntar_area") {
            const r = await executarAcao(acao, l, pend.texto);
            if (r) return r;
          }
        }
        const semAtividadeNemArea = !pend.atividade && !(pend.termos?.length) && !pend.area;
        if (!consultaProgramacao && escolha === ESCOLHA_REDE && semAtividadeNemArea && ehPerguntaGeralDeProgramacao(pend.texto)) {
          // R5: pergunta geral sem área + toda a rede → pergunta a área (3 áreas reais).
          return await responderPerguntaPronta(PERGUNTA_AREA, { prog_pendente: { ...pend, aguardando_area: true } }, "pergunta_area");
        }
        if (!consultaProgramacao) consultaProgramacao = { texto: pend.texto, atividade: pend.atividade, termos: pend.termos ?? [], area: pend.area, contexto: pend.contexto ?? contextoSessao, escopo: escolha, perguntaOriginal: true };
        return null;
      };

      // A) resposta à pergunta pronta do turno anterior
      if (pendente) {
        if (pendente.aguardando_atividade && blocoAnteriorAgente.includes(MARCA_PERGUNTA_ATIVIDADE)) {
          // S-INST-QUAL-06: resposta à pergunta de atividade ambígua (número da lista ou nome).
          const escolhida = resolverEscolhaDeAtividade(textoFinal, pendente.aguardando_atividade.opcoes);
          if (escolhida) {
            consultaProgramacao = { texto: pendente.texto, atividade: escolhida, termos: palavrasChaveProgramacao(escolhida), area: pendente.area, contexto: pendente.contexto ?? contextoSessao, escopo: pendente.aguardando_atividade.escopo, perguntaOriginal: true, tituloExato: escolhida };
            await gravarMetadata({ prog_pendente: null, conversa_engajada: true, aguardando_unidade: false });
          } else {
            await gravarMetadata({ prog_pendente: null });
          }
        } else if (pendente.confirmar_escopo && blocoAnteriorAgente.includes(MARCA_CONFIRMAR_ESCOPO)) {
          // S-INST-QUAL-06: resposta à confirmação de escopo — bifurcação (decisão do Junior, 14/11).
          const { confirmar_escopo: oferecida, contexto_anterior: contextoAnterior, ...semConfirmacao } = pendente;
          const r = resolverRespostaConfirmacao(textoFinal, oferecida);
          if (r?.tipo === "outra_unidade") {
            // "não"/"outra": abre a partir da negativa — sai a unidade de antes e o contexto de antes;
            // a pergunta continua pendente e é respondida quando a pessoa escolher no menu.
            const resposta = evitarRepeticaoLiteral(MENU_UNIDADES, historico);
            await gravarMetadata({ unidade_selecionada: null, prog_escopo: null, prog_contexto: semConfirmacao.contexto ?? {}, prog_pendente: semConfirmacao, aguardando_unidade: true, conversa_engajada: true });
            await salvarMensagemAgente(supabase, conversa!.id, lead.id, resposta);
            logarTurnoSemBusca("pergunta_escopo");
            return responderJson({ resposta, handover: false });
          }
          if (r) {
            // "sim"/"o mesmo": a conversa de antes continua valendo (unidade + contexto); outra unidade
            // ou a rede: só o que a pessoa disse agora.
            const escolha = r.tipo === "mesma" ? oferecida : r.escopo;
            const contextoEscolhido = r.tipo === "mesma" ? { ...(contextoAnterior ?? {}), ...(semConfirmacao.contexto ?? {}) } : { ...(semConfirmacao.contexto ?? {}) };
            const pend: PendenteProgramacao = { ...semConfirmacao, contexto: contextoEscolhido, ...(semConfirmacao.leitura ? { leitura: { ...semConfirmacao.leitura, contexto: contextoEscolhido as LeituraTurno["contexto"] } } : {}) };
            const temPerguntaNova = palavrasChaveProgramacao(textoFinal).length > 0 && respostaTrazPerguntaNova(textoFinal, pend, await carregarItensProgramacaoRede(supabase, usarCacheProgramacao));
            if (temPerguntaNova) {
              // "sim, e tem judô?": vale a unidade escolhida e a pergunta nova segue como mensagem nova.
              await gravarMetadata({ ...patchEscopo(escolha), prog_pendente: null, prog_contexto: contextoEscolhido, conversa_engajada: true, aguardando_unidade: false });
            } else {
              const resposta = await seguirComEscopo(escolha, pend, { prog_contexto: contextoEscolhido });
              if (resposta) return resposta;
            }
          } else {
            // Não respondeu à pergunta: a pendência cai e a mensagem segue como mensagem nova. A unidade
            // de antes também sai (só voltaria com o "sim"), igual à conversa retomada depois de 2h.
            await gravarMetadata({ prog_pendente: null, unidade_selecionada: null, prog_escopo: null });
          }
        } else if (pendente.aguardando_area && blocoAnteriorAgente.includes("Qual área te interessa")) {
          const area = resolverEscolhaDeArea(textoFinal, blocoAnteriorAgente);
          if (area) {
            consultaProgramacao = { texto: pendente.texto, atividade: null, termos: [], area, contexto: pendente.contexto ?? contextoSessao, escopo: escopoSessao ?? ESCOLHA_REDE, perguntaOriginal: true };
            await gravarMetadata({ prog_pendente: null, conversa_engajada: true, aguardando_unidade: false });
          }
        } else if (blocoAnteriorAgente.includes(ROTULO_REDE) && (palavrasChaveProgramacao(textoFinal).length > 0 || areaPeloVocabulario(textoFinal) !== null) && respostaTrazPerguntaNova(textoFinal, pendente, await carregarItensProgramacaoRede(supabase, usarCacheProgramacao))) {
          // C1: o lead ignorou o menu e fez outra pergunta — a antiga sai, a nova segue como mensagem nova (B).
          await gravarMetadata({ prog_pendente: null });
        } else if (blocoAnteriorAgente.includes(ROTULO_REDE)) {
          const escolha = resolverEscolhaDeEscopo(textoFinal, blocoAnteriorAgente, metadataAtual.unidade_selecionada as string | null | undefined);
          if (escolha) {
            const resposta = await seguirComEscopo(escolha, pendente);
            if (resposta) return resposta;
          }
        } else {
          // A última mensagem do bot já não é a pergunta pronta — pendência velha não vale mais.
          await gravarMetadata({ prog_pendente: null });
        }
      }

      // A2) escopo "rede" na sessão + número respondendo à lista que o bot mandou ("3") → a linha
      // escolhida vira a consulta (o roteamento normal pula dígitos, e sem unidade salva o "3" cairia
      // no classificador antigo).
      if (!consultaProgramacao && !pendente && escopoSessao === ESCOLHA_REDE && /^\d{1,2}$/.test(textoFinal.trim())) {
        const linha = textoDaLinhaNumerada(textoFinal.trim(), blocoAnteriorAgente);
        if (linha) consultaProgramacao = { texto: linha, atividade: linha, termos: [], area: null, contexto: contextoSessao, escopo: ESCOLHA_REDE, perguntaOriginal: true };
      }

      // S-INST-QUAL-06) rota estruturada: leitura única do turno + `decidirRota`. Fica de fora o
      // número que responde a uma lista mostrada pelo bot (resolvido pelo código, como antes) e o que
      // a pendência (A/A2) já resolveu. Leitura que falha → rota antiga (B e 5b), `rota_fallback`.
      // S-INST-QUAL-14 (V4): número que responde à lista de unidades de uma consulta de programação
      // ("não tem no JW; tem no 1️⃣ Mondubim 2️⃣ Pici") repete a MESMA consulta na unidade da linha —
      // dia, turno, área e atividade —, em vez de cair na lista antiga e mandar a programação inteira.
      const ultimaConsulta = (metadataAtual.prog_ultima_consulta ?? null) as UltimaConsultaProgramacao | null;
      if (!consultaProgramacao && !pendente && ultimaConsulta && /^\d{1,2}$/.test(textoFinal.trim())) {
        const unidadeDaLinha = unidadeDaListaDaConsulta(textoFinal.trim(), blocoAnteriorAgente, ultimaConsulta);
        if (unidadeDaLinha) {
          consultaProgramacao = { texto: ultimaConsulta.texto, atividade: ultimaConsulta.atividade, termos: ultimaConsulta.termos, area: ultimaConsulta.area, contexto: ultimaConsulta.contexto, escopo: unidadeDaLinha, perguntaOriginal: true, tituloExato: ultimaConsulta.tituloExato ?? null };
          await gravarMetadata({ ...patchEscopo(unidadeDaLinha), prog_pendente: null, conversa_engajada: true, aguardando_unidade: false });
          console.log("[motor-agente v18] Numero da lista de unidades da consulta: " + unidadeDaLinha + " (repete a consulta anterior)");
        }
      }

      const digitoDaLista = /^\d{1,2}$/.test(textoFinal.trim()) && linhaNumeradaDaLista(textoFinal.trim(), blocoAnteriorAgente) !== "";
      if (!consultaProgramacao && rotaNovaLigada && !digitoDaLista) {
        const lida = await obterLeitura();
        if (lida) {
          const pedidoAnterior = lida.tipo === "so_unidade" && !lida.atividade ? pedidoAnteriorDoLead(historicoRota) : "";
          const completada = pedidoAnterior ? completarSoUnidadeComPedidoAnterior(lida, pedidoAnterior, await carregarItensProgramacaoRede(supabase, usarCacheProgramacao)) : lida;
          const textoDoPedido = completada !== lida ? pedidoAnterior + "\n" + textoRota : textoRota;
          // Hotfix 17/11/2026: termos que não identificam atividade saem antes de decidir a rota.
          const leitura = semTermosGenericos(completada, await itensParaLeitura(completada));
          const acao = decidirRota(leitura, estadoRota(leitura, await itensParaLeitura(leitura), textoDoPedido));
          console.log("[motor-agente v18] Rota estruturada: tipo=" + leitura.tipo + " assunto=" + leitura.assunto + " escopo=" + leitura.escopo + " atividade=" + leitura.atividade + " termos=" + leitura.termos_busca.join("|") + " idade=" + leitura.idade + " -> " + acao.acao);
          const resposta = await executarAcao(acao, leitura, textoDoPedido);
          if (resposta) return resposta;
        }
      }

      // B) mensagem nova com cara de programação → interpretador semântico
      if (!consultaProgramacao && !rotaDecidida && !ehSelecaoMenu(textoFinal) && !pedidoOutrasUnidades) {
        const podeTerSinal = palavrasChaveProgramacao(textoFinal).length > 0 || areaPeloVocabulario(textoFinal) !== null || ehPerguntaGeralDeProgramacao(textoFinal);
        const itensRede = podeTerSinal ? await carregarItensProgramacaoRede(supabase, usarCacheProgramacao) : [];
        if ((podeTerSinal && temSinalDeProgramacao(textoFinal, itensRede)) || escopoSessao === ESCOLHA_REDE) {
          const interpConsolidada = consolidarInterpretacao(await interpretarTurnoProgramacao(textoFinal, openaiKey, historico, registrarConsumoInterpretacao), textoFinal);
          // Hotfix 17/11/2026: mesma limpeza da rota estruturada (termos que não identificam atividade).
          const itensLimpeza = interpConsolidada.atividade || interpConsolidada.termos_busca.length ? (itensRede.length ? itensRede : await carregarItensProgramacaoRede(supabase, usarCacheProgramacao)) : [];
          const interp = semTermosGenericos(interpConsolidada, itensLimpeza);
          const contexto = contextoDoTurno(interp.contexto); // S-INST-QUAL-14: mesma regra da rota estruturada
          console.log("[motor-agente v18] Interpretacao S-WM-72: tipo=" + interp.tipo + " atividade=" + interp.atividade + " area=" + interp.area + " escopo=" + interp.escopo + " contexto=" + descreverContexto(contexto));
          if (interp.tipo === "pergunta_programacao" || interp.tipo === "continuacao") {
            const area = interp.area ?? areaPeloVocabulario(textoFinal);
            const escopoNaMensagem = interp.escopo; // já consolidado: só o que a mensagem atual diz
            const escopo = escopoNaMensagem ?? escopoSessao;
            if (!escopo) {
              const sobre = interp.atividade ?? (area ? ROTULO_AREA[area] : "");
              const pendenteNovo: PendenteProgramacao = { texto: textoFinal, atividade: interp.atividade, termos: interp.termos_busca, area, contexto };
              return await responderPerguntaPronta(montarPerguntaEscopo(introducaoPergunta(sobre)), { prog_pendente: pendenteNovo, prog_contexto: contexto }, "pergunta_escopo");
            }
            if (escopoNaMensagem) await gravarMetadata({ ...patchEscopo(escopoNaMensagem), conversa_engajada: true, aguardando_unidade: false });
            if (escopo === ESCOLHA_REDE && !interp.atividade && !interp.termos_busca.length && !area) {
              return await responderPerguntaPronta(PERGUNTA_AREA, { prog_pendente: { texto: textoFinal, atividade: null, area: null, contexto, aguardando_area: true }, prog_contexto: contexto }, "pergunta_area");
            }
            consultaProgramacao = { texto: textoFinal, atividade: interp.atividade, termos: interp.termos_busca, area, contexto, escopo, perguntaOriginal: false, filtroHerdado: filtroHerdadoDoContexto(contexto, lerMensagemAtual(textoFinal).contexto, interp.contexto) };
          }
          if (descreverContexto(interp.contexto)) await gravarMetadata({ prog_contexto: contexto });
        }
      }
      if (consultaProgramacao) unidadeEfetiva = consultaProgramacao.escopo === ESCOLHA_REDE ? ROTULO_REDE : consultaProgramacao.escopo;
    }

    if (unidade_cuca === 'Geral' && !consultaProgramacao && !rotaDecidida) {
      const unidadeSalva = metadataAtual.unidade_selecionada as string | undefined;
      const aguardando = metadataAtual.aguardando_unidade as boolean | undefined;
      // S-INST-QUAL-05: dígito solto continua resolvido pela lista mostrada (só a mensagem atual);
      // o resto da detecção de unidade olha a rajada inteira.
      const textoUnidade = ehSelecaoMenu(textoFinal) ? textoFinal : textoRota;
      // `undefined` sem a chave: as decisões usam ehCortesiaPura(texto), como antes.
      const cortesiaRota = usaRajada ? rajadaEhCortesiaPura(mensagensRajada) && !ultimaRespostaFoiFrasePronta(historico) : undefined;

      // S-INST-QUAL-05: duas unidades diferentes em mensagens da mesma rajada ("Barra" + "Pici")
      // → menu de unidades, sem escolher uma. Só com mais de uma mensagem na rajada: "tem na Barra
      // ou no Pici?" numa mensagem só segue como antes.
      const unidadesDaRajada = rajadaAnteriores.length ? unidadesCitadas(textoRota) : [];
      if (unidadesDaRajada.length >= 2) {
        const respostaDuas = evitarRepeticaoLiteral("Vi que você citou mais de uma unidade (" + unidadesDaRajada.join(" e ") + ").\n\n" + MENU_UNIDADES, historico);
        metadataAtual = { ...metadataAtual, ...pendenteSeMenuDeUnidades(respostaDuas, textoRota), aguardando_unidade: true };
        await supabase.rpc('merge_conversa_metadata', { p_conversa_id: conversa!.id, p_patch: metadataAtual as unknown as Database["public"]["Functions"]["merge_conversa_metadata"]["Args"]["p_patch"] });
        await salvarMensagemAgente(supabase, conversa!.id, lead.id, respostaDuas);
        logarTurnoSemBusca("ambiguidade_unidade");
        return new Response(JSON.stringify({ success: true, resposta: respostaDuas, handover: false }), { headers: { "Content-Type": "application/json" } });
      }

      if (unidadeSalva) {
        const unidadePorDigito = ehSelecaoMenu(textoFinal) ? resolverDigitoPelaListaDoAgente(textoFinal, blocoAnteriorAgente) : undefined;
        const novaUnidade = detectarTrocaUnidade(textoRota, unidadeSalva) ?? (unidadePorDigito && unidadePorDigito !== unidadeSalva ? unidadePorDigito : null);
        if (novaUnidade) {
          metadataAtual = { ...metadataAtual, unidade_selecionada: novaUnidade, aguardando_unidade: false };
          await supabase.rpc('merge_conversa_metadata', { p_conversa_id: conversa.id, p_patch: metadataAtual });
          unidadeEfetiva = novaUnidade;
          trocouUnidade = true;
          // S-WM-34 (VAL-23, Task 3): este é o caminho reproduzido ao vivo — detectarTrocaUnidade
          // é match direto de nome, sem avaliação semântica (nunca chama avaliarSelecaoUnidade),
          // por isso usa o sinal equivalente (heurística "?", ver mensagemTemPedidoEspecifico).
          trocaComPedidoEspecifico = mensagemTemPedidoEspecifico(textoRota);
          console.log("[motor-agente v18] Troca de unidade: " + unidadeSalva + " -> " + novaUnidade);
        } else if (pareceIntencaoTrocaUnidade(textoRota)) {
          // Item 4 (S-WM-21, VAL-06): detectarTrocaUnidade (match exato/typo) não achou nada,
          // mas a mensagem sugere intenção de trocar ("unidade", "trocar", "mudar" etc.) — só
          // AQUI vale a chamada semântica (avaliarSelecaoUnidade), pra não pagar uma chamada
          // extra de LLM em toda mensagem de acompanhamento comum de uma conversa já em
          // andamento (a maioria delas não menciona nada sobre trocar de unidade).
          const avaliacaoTroca = await avaliarSelecaoUnidade(textoRota, openaiKey, historicoRota, registrarConsumoRota);
          if (avaliacaoTroca.unidade && avaliacaoTroca.unidade !== unidadeSalva) {
            metadataAtual = { ...metadataAtual, unidade_selecionada: avaliacaoTroca.unidade, aguardando_unidade: false };
            await supabase.rpc('merge_conversa_metadata', { p_conversa_id: conversa.id, p_patch: metadataAtual });
            unidadeEfetiva = avaliacaoTroca.unidade;
            trocouUnidade = true;
            // S-WM-34 (VAL-23): este caminho JÁ chama avaliarSelecaoUnidade — reaproveita
            // pedido_depende_unidade direto, mesmo achado/mesma correção dos outros 3 pontos de
            // entrada que usam essa função (não estava no escopo original da story, mas é a
            // mesma classe de bug: trocouUnidade=true aqui também dispara "resumo geral" hoje).
            trocaComPedidoEspecifico = avaliacaoTroca.pedido_depende_unidade === true;
            console.log("[motor-agente v18] Troca de unidade (semantica): " + unidadeSalva + " -> " + avaliacaoTroca.unidade);
          } else if (pedidoOutrasUnidades) {
            // S-WM-71 (Item 3): "procure em outras unidades" sem descrever nenhuma — o classificador
            // não achou unidade, então mantém a salva e o Passo 6 procura a atividade da sessão na
            // rede, em vez do menu de ambiguidade ou da recusa.
            unidadeEfetiva = unidadeSalva;
          } else if (avaliacaoTroca.mudou_de_assunto && !avaliacaoTroca.pergunta_geral && !avaliacaoTroca.quer_sair) {
            // Ambiguidade real: o sinal semântico indica que o lead mudou de assunto (não é
            // cortesia, nem pergunta geral, nem despedida) mas não deu pra identificar qual
            // unidade — pergunta em vez de continuar respondendo pela unidade antiga em
            // silêncio. Qualquer falha técnica da chamada (rate limit esgotado, JSON inválido,
            // erro de rede) cai no fallback seguro (mudou_de_assunto=false) e NÃO entra aqui —
            // mantém a unidade atual, mesmo comportamento de hoje pra erros transitórios.
            const respostaAmbiguidade = evitarRepeticaoLiteral("Só pra confirmar: você quer saber sobre outra unidade CUCA? Me diz qual! 😊\n\n" + MENU_UNIDADES, historico);
            await salvarMensagemAgente(supabase, conversa.id, lead.id, respostaAmbiguidade);
            logarTurnoSemBusca("ambiguidade_unidade");
            return new Response(JSON.stringify({ success: true, resposta: respostaAmbiguidade, handover: false }), { headers: { "Content-Type": "application/json" } });
          } else {
            unidadeEfetiva = unidadeSalva;
          }
        } else {
          unidadeEfetiva = unidadeSalva;
        }
      } else if (aguardando) {
        // aguardando_unidade só é gravado junto com o MENU_UNIDADES do código, então aqui (e só
        // aqui) o mapa fixo 1-5 continua valendo como fallback.
        const unidadeDetectadaDireta = detectarUnidadeDireta(textoUnidade, blocoAnteriorAgente) ?? detectarUnidadeDireta(textoUnidade);
        let avaliacaoSemantica: AvaliacaoSelecaoUnidade = AVALIACAO_SELECAO_UNIDADE_DEFAULT;

        if (!unidadeDetectadaDireta) {
          avaliacaoSemantica = await avaliarSelecaoUnidade(textoRota, openaiKey, historicoRota, registrarConsumoRota);
        }

        const decisao = decidirAguardandoUnidade(unidadeDetectadaDireta, avaliacaoSemantica, textoRota, cortesiaRota);

        if (decisao.unidadeSelecionada) {
          metadataAtual = { ...metadataAtual, unidade_selecionada: decisao.unidadeSelecionada, aguardando_unidade: decisao.aguardandoUnidade };
          await supabase.rpc('merge_conversa_metadata', { p_conversa_id: conversa.id, p_patch: metadataAtual });
          unidadeEfetiva = decisao.unidadeSelecionada;
          // AUD-04: resolução inicial de unidade dentro de aguardando_unidade (por nome OU
          // dígito) conta como equivalente a trocouUnidade — sem isso, só quem escolhe por
          // dígito (isSelecaoMenu) recebia a visão geral completa da programação.
          trocouUnidade = true;
          trocaComPedidoEspecifico = decisao.pedidoEspecifico === true; // S-WM-34 (VAL-23)
          console.log("[motor-agente v18] Unidade salva: " + unidadeEfetiva);
        } else if (
          decisao.resposta !== null && !decisao.aguardandoUnidade &&
          deveReconhecerDisparoRecente(metadataAtual.ultimo_disparo as { enviado_em?: string } | undefined, avaliacaoSemantica.quer_sair === true)
        ) {
          // Achado 2026-07-24: cortesia pura (aguardandoUnidade=false aqui, não é o caso de
          // "não consegui identificar a unidade" que mostra o menu de novo) com disparo
          // institucional recente ainda não reconhecido — ignora a resposta canned e cai pro
          // fluxo normal (GPT + CONTEXTO_DISPARO, seção 9), mesmo padrão que pergunta_geral já
          // usa no branch abaixo. quer_sair fica de fora via deveReconhecerDisparoRecente — lead
          // só quer parar, reconhecer o disparo não ajuda.
          metadataAtual = { ...metadataAtual, aguardando_unidade: false, conversa_engajada: true };
          await supabase.rpc('merge_conversa_metadata', { p_conversa_id: conversa.id, p_patch: metadataAtual });
          console.log("[motor-agente v18] Disparo recente não reconhecido (aguardando_unidade) — ignora resposta canned, segue pro GPT");
        } else if (decisao.resposta !== null) {
          const respostaFinal = evitarRepeticaoLiteral(decisao.resposta, historico);
          // Ampliação de escopo (S-WM-31, autorizada por Junior na Task 3 — ver Dev Agent
          // Record): quando este branch resolve SEM aguardar unidade (quer_sair ou cortesia
          // pura, aguardandoUnidade=false aqui), marca conversa_engajada=true — sem isso, a
          // PRÓXIMA mensagem cairia no branch de 1ª mensagem e sortearia uma SAUDACOES_ABERTURA
          // nova (Causa raiz B reaparecendo neste caminho). Quando aguardandoUnidade=true
          // (pedido_depende_unidade, mostra o menu), o próprio aguardando_unidade já evita cair
          // no branch de 1ª mensagem de novo — não precisa da flag.
          metadataAtual = {
            ...metadataAtual,
            ...pendenteSeMenuDeUnidades(respostaFinal, textoRota),
            aguardando_unidade: decisao.aguardandoUnidade,
            ...(decisao.aguardandoUnidade ? {} : { conversa_engajada: true }),
          };
          await supabase.rpc('merge_conversa_metadata', { p_conversa_id: conversa.id, p_patch: metadataAtual });
          await salvarMensagemAgente(supabase, conversa.id, lead.id, respostaFinal);
          logarTurnoSemBusca("resposta_canned");
          return new Response(JSON.stringify({ success: true, resposta: respostaFinal, handover: false }), { headers: { "Content-Type": "application/json" } });
        } else {
          // VAL-12: pergunta_geral=true — nem unidade escolhida, nem resposta canned. Grava
          // aguardando_unidade=false e segue pro fluxo normal (Passo 6 responde de verdade).
          // Ampliação (S-WM-31): também marca conversa_engajada=true, mesmo motivo do branch acima.
          metadataAtual = { ...metadataAtual, aguardando_unidade: decisao.aguardandoUnidade, conversa_engajada: true };
          await supabase.rpc('merge_conversa_metadata', { p_conversa_id: conversa.id, p_patch: metadataAtual });
          perguntaGeralAtiva = true;
          console.log("[motor-agente v18] Pergunta geral identificada (aguardando_unidade): segue pro RAG geral (FAQ isolado)");
        }
      } else if (metadataAtual.conversa_engajada === true) {
        // S-WM-31 (item 6 do Escopo): 3º branch — conversa já engajada (passou por cortesia ou
        // pergunta_geral antes), sem unidade_selecionada nem aguardando_unidade pendentes.
        // Reavalia com a MESMA detecção usada nos outros branches, sem repetir saudação.
        const unidadeDetectadaDiretaEngajada = detectarUnidadeDireta(textoUnidade, blocoAnteriorAgente);
        let avaliacaoSemanticaEngajada: AvaliacaoSelecaoUnidade = AVALIACAO_SELECAO_UNIDADE_DEFAULT;

        if (!unidadeDetectadaDiretaEngajada) {
          avaliacaoSemanticaEngajada = await avaliarSelecaoUnidade(textoRota, openaiKey, historicoRota, registrarConsumoRota);
        }

        const decisaoEngajada = decidirConversaEngajada(unidadeDetectadaDiretaEngajada, avaliacaoSemanticaEngajada, textoRota, cortesiaRota);

        if (decisaoEngajada.unidadeSelecionada) {
          metadataAtual = { ...metadataAtual, unidade_selecionada: decisaoEngajada.unidadeSelecionada, aguardando_unidade: false };
          await supabase.rpc('merge_conversa_metadata', { p_conversa_id: conversa.id, p_patch: metadataAtual });
          unidadeEfetiva = decisaoEngajada.unidadeSelecionada;
          trocouUnidade = true;
          trocaComPedidoEspecifico = decisaoEngajada.pedidoEspecifico === true; // S-WM-34 (VAL-23)
          console.log("[motor-agente v18] Unidade salva (conversa engajada): " + unidadeEfetiva);
        } else if (
          decisaoEngajada.resposta !== null && !decisaoEngajada.aguardandoUnidade &&
          deveReconhecerDisparoRecente(metadataAtual.ultimo_disparo as { enviado_em?: string } | undefined, avaliacaoSemanticaEngajada.quer_sair === true)
        ) {
          // Achado 2026-07-24: mesmo ajuste do branch aguardando_unidade — cortesia pura numa
          // conversa já engajada, com disparo recente não reconhecido. decidirConversaEngajada
          // não distingue quer_sair internamente (cai no mesmo canned de continuação hoje) — a
          // exclusão de opt-out acontece aqui, via avaliacaoSemanticaEngajada.quer_sair.
          metadataAtual = { ...metadataAtual, aguardando_unidade: false };
          await supabase.rpc('merge_conversa_metadata', { p_conversa_id: conversa.id, p_patch: metadataAtual });
          console.log("[motor-agente v18] Disparo recente não reconhecido (conversa engajada) — ignora resposta canned, segue pro GPT");
        } else if (decisaoEngajada.resposta !== null) {
          const respostaFinal = evitarRepeticaoLiteral(decisaoEngajada.resposta, historico);
          metadataAtual = { ...metadataAtual, ...pendenteSeMenuDeUnidades(respostaFinal, textoRota), aguardando_unidade: decisaoEngajada.aguardandoUnidade };
          await supabase.rpc('merge_conversa_metadata', { p_conversa_id: conversa.id, p_patch: metadataAtual });
          await salvarMensagemAgente(supabase, conversa.id, lead.id, respostaFinal);
          // S-WM-70: este early-return não passava pelo trecho que processa a tag [[ENCERRAR]]
          // (linha ~1810 em diante) — então uma despedida decidida aqui (decisaoEngajada.encerrar)
          // nunca marcava conversas.status nem devolvia `encerrado` no JSON, mesmo com o texto de
          // despedida certo. Reproduz os DOIS efeitos que a tag já produz noutro caminho: status
          // 'encerrada' no banco e o campo `encerrado` na resposta (consumido pelo worker em
          // meta_adapter_inbound.py:666).
          if (decisaoEngajada.encerrar) {
            await supabase.from("conversas").update({ status: "encerrada", updated_at: new Date().toISOString() }).eq("id", conversa.id);
          }
          logarTurnoSemBusca(decisaoEngajada.encerrar ? "encerramento" : "resposta_canned");
          return new Response(
            JSON.stringify({ success: true, resposta: respostaFinal, handover: false, encerrado: decisaoEngajada.encerrar === true }),
            { headers: { "Content-Type": "application/json" } },
          );
        } else {
          perguntaGeralAtiva = true;
          console.log("[motor-agente v18] Pergunta geral identificada (conversa engajada): segue pro RAG geral (FAQ isolado)");
        }
      } else {
        const unidadeDetectadaDireta1a = detectarUnidadeDireta(textoUnidade, blocoAnteriorAgente);
        let avaliacaoSemantica1a: AvaliacaoSelecaoUnidade = AVALIACAO_SELECAO_UNIDADE_DEFAULT;

        if (!unidadeDetectadaDireta1a) {
          avaliacaoSemantica1a = await avaliarSelecaoUnidade(textoRota, openaiKey, historicoRota, registrarConsumoRota);
        }

        const decisaoPrimeira = decidirPrimeiraMensagem(unidadeDetectadaDireta1a, avaliacaoSemantica1a, textoRota, cortesiaRota);
        if (decisaoPrimeira.unidadeSelecionada) {
          // AUD-07: unidade já citada na própria 1ª mensagem — resolve direto e segue pro
          // fluxo normal (RAG/GPT) em vez de mandar o menu e forçar uma rodada extra.
          metadataAtual = { ...metadataAtual, unidade_selecionada: decisaoPrimeira.unidadeSelecionada, aguardando_unidade: decisaoPrimeira.aguardandoUnidade };
          await supabase.rpc('merge_conversa_metadata', { p_conversa_id: conversa.id, p_patch: metadataAtual });
          unidadeEfetiva = decisaoPrimeira.unidadeSelecionada;
          trocouUnidade = true;
          trocaComPedidoEspecifico = decisaoPrimeira.pedidoEspecifico === true; // S-WM-34 (VAL-23)
          console.log("[motor-agente v18] Unidade salva (1a mensagem): " + unidadeEfetiva);
        } else if (
          decisaoPrimeira.resposta !== null && !decisaoPrimeira.aguardandoUnidade &&
          deveReconhecerDisparoRecente(metadataAtual.ultimo_disparo as { enviado_em?: string } | undefined, avaliacaoSemantica1a.quer_sair === true)
        ) {
          // Achado 2026-07-24: 1ª mensagem real do lead (nenhuma flag de engajamento gravada
          // ainda), cortesia pura, mas com disparo institucional recente ainda não reconhecido —
          // mesmo ajuste dos outros 2 branches. Note que `ultimo_disparo` só existe em metadata
          // quando o worker (_gravar_breadcrumb_disparo) já criou esta linha de `conversas` antes
          // desta mensagem chegar — ou seja, na prática este branch nunca coincide com
          // conversaGenuinamenteNova=true (a linha já existia), então não há conflito com a
          // INSTRUCAO "Esta e a primeira mensagem" (seção 10, gated em conversaGenuinamenteNova).
          // decidirPrimeiraMensagem não distingue quer_sair (não faz sentido pedir pra sair na
          // 1ª mensagem) — a exclusão de opt-out acontece aqui, via avaliacaoSemantica1a.quer_sair.
          metadataAtual = { ...metadataAtual, aguardando_unidade: false, conversa_engajada: true };
          await supabase.rpc('merge_conversa_metadata', { p_conversa_id: conversa.id, p_patch: metadataAtual });
          console.log("[motor-agente v18] Disparo recente não reconhecido (1a mensagem) — ignora resposta canned, segue pro GPT");
        } else if (decisaoPrimeira.resposta !== null) {
          const respostaFinal = evitarRepeticaoLiteral(decisaoPrimeira.resposta, historico);
          // Item 6 (S-WM-31, Causa raiz B): cortesia pura (aguardandoUnidade=false aqui) marca
          // conversa_engajada=true — sem isso, a PRÓXIMA mensagem cairia de novo neste mesmo
          // branch de 1ª mensagem e sortearia outra SAUDACOES_ABERTURA. Quando aguardandoUnidade
          // =true (pedido_depende_unidade, mostra o menu), o próprio aguardando_unidade já evita
          // cair aqui de novo — não precisa da flag.
          metadataAtual = {
            ...metadataAtual,
            ...pendenteSeMenuDeUnidades(respostaFinal, textoRota),
            aguardando_unidade: decisaoPrimeira.aguardandoUnidade,
            ...(decisaoPrimeira.aguardandoUnidade ? {} : { conversa_engajada: true }),
          };
          await supabase.rpc('merge_conversa_metadata', { p_conversa_id: conversa.id, p_patch: metadataAtual });
          await salvarMensagemAgente(supabase, conversa.id, lead.id, respostaFinal);
          logarTurnoSemBusca("resposta_canned");
          return new Response(JSON.stringify({ success: true, resposta: respostaFinal, handover: false }), { headers: { "Content-Type": "application/json" } });
        } else {
          // VAL-12: pergunta_geral=true já na 1ª mensagem — segue pro fluxo normal (Passo 6).
          // Item 6: também marca conversa_engajada=true, mesmo motivo do branch acima.
          metadataAtual = { ...metadataAtual, aguardando_unidade: decisaoPrimeira.aguardandoUnidade, conversa_engajada: true };
          await supabase.rpc('merge_conversa_metadata', { p_conversa_id: conversa.id, p_patch: metadataAtual });
          perguntaGeralAtiva = true;
          console.log("[motor-agente v18] Pergunta geral identificada (1a mensagem): segue pro RAG geral (FAQ isolado)");
        }
      }
    }

    // S-INST-QUAL-05: a rajada resolveu a unidade e um pedido veio numa mensagem ANTERIOR ("Queria
    // natação na Barra" + "Oi boa tarde") — responde o pedido, não o resumo geral da unidade.
    if (trocouUnidade && !trocaComPedidoEspecifico && rajadaAnteriores.length && rajadaTemPedido(rajadaAnteriores)) trocaComPedidoEspecifico = true;

    // 6. Contexto RAG
    let contextRAG = "";
    // PLANO-023: o contexto é montado como uma lista de blocos nomeados, e `contextRAG` é
    // derivado dela (mesma ordem, mesmos separadores) logo antes do prompt final. A mesma lista
    // alimenta o registro de consumo (`ai_usage_logs.blocos_contexto`) — o que é registrado nunca
    // diverge do que foi enviado. Cada branch abaixo começa com `reiniciarBlocos(...)`, que faz o
    // papel do antigo `contextRAG = contextServicos` (S-WM-51) e nunca apaga o bloco de serviços
    // por engano.
    const blocosContexto: { nome: string; texto: string }[] = [];
    const adicionarBloco = (nome: string, texto: string) => { if (texto) blocosContexto.push({ nome, texto }); };
    const reiniciarBlocos = (comServicos: boolean) => {
      blocosContexto.length = 0;
      if (comServicos) {
        adicionarBloco("servicos_rede", contextServicos);
        adicionarBloco("avisos", contextAvisos);
      }
    };
    // S-WM-AUD-007 / Plano 012: os pontos abaixo SO escrevem nesta variavel — nenhum deles muda
    // `contextRAG`, condicao ou fluxo. O insert acontece uma unica vez, no fim do Passo 6.5.
    // Default `nao_aplicavel`: turno que nao chega a fazer busca de atividade (handover,
    // encerramento, saudacao de abertura) tambem vira linha, senao o denominador fica errado.
    let logRAG: {
      camada: string;
      atividadeResolvida?: string | null;
      chunksRetornados?: { documento_id: string; fonte_tipo: string; similaridade: number | null }[];
    } = { camada: "nao_aplicavel" };
    // S-INST-QUAL-03: resultado da chamada a `buscar_chunks_similares` do turno (cada ramo faz no
    // maximo uma) e o motivo das buscas deterministicas de atividade. Vao no mesmo insert unico.
    let buscaRAG: RegistroBusca = BUSCA_NAO_APLICAVEL;
    let resolucaoAtividade: ResolucaoAtividade | null = null;
    // @qa (LOW): `similaridade` ausente vira `null`, nao `-1`. Sentinela numerica entra em media
    // sem ninguem perceber; `null` e o valor honesto pra "nao veio" e a coluna e jsonb.
    const mapearChunks = (cs: { documento_id: string; fonte_tipo?: string; similaridade?: number }[]) =>
      cs.map((c) => ({ documento_id: c.documento_id, fonte_tipo: c.fonte_tipo ?? "desconhecido", similaridade: c.similaridade ?? null }));
    const temUnidadeDefinida = unidadeEfetiva && unidadeEfetiva !== 'Geral';
    // S-WM-71: sinal para a instrução do prompt do Item 3. (O Item 2 — mostrar sozinho onde a
    // atividade existe — foi retirado por decisão do Junior em 09/10: vira "perguntar a unidade" na S-WM-72.)
    let outrasUnidadesComAtividade: boolean | null = null; // null = não houve pedido de outras unidades
    const blocoProgramacaoRedeTexto = (bloco: string) => "\n\n--- PROGRAMACAO VIGENTE DA REDE (programacao mensal ativa de cada unidade, filtrada pela pergunta) ---\n" + bloco;
    const isAgenteProgramacao = agente_tipo === 'Institucional' || agente_tipo === 'maria';
    // S-WM-51: gateado em isAgenteProgramacao (não literal 'Institucional') por consistência com
    // todos os outros gates deste Passo 6 — 'maria' não tem número WhatsApp ativo hoje
    // (meta_phone_numbers só tem 'Institucional' e 'Empregabilidade'), então a diferença é um
    // no-op no tráfego real. Carregado 1x, ANTES da cadeia if/else abaixo, porque é pequeno
    // (algumas linhas — padrão comum + exceções por unidade) e relevante com ou sem unidade
    // conhecida, ao contrário de monthly_program/resumo_rede que são mutuamente exclusivos entre
    // si. Cada branch da cadeia abaixo começa com `reiniciarBlocos(true)` (PLANO-023; antes era
    // "contextRAG = contextServicos"), que recoloca este bloco antes do conteúdo do branch — só o
    // branch de agentes sem programação usa `reiniciarBlocos(false)`, como antes.
    const servicosRedeConteudo = isAgenteProgramacao ? await carregarServicosRede(supabase) : "";
    const contextServicos = servicosRedeConteudo ? "\n\n--- SERVICOS DA REDE (comuns + excecoes por unidade) ---\n" + servicosRedeConteudo : "";
    // S-INST-QUAL-08: avisos `geral` válidos hoje (Fortaleza), inteiros, sempre junto da base institucional.
    const contextAvisos = isAgenteProgramacao ? montarBlocoAvisos(await carregarAvisos(supabase, hojeFortalezaISO())) : "";
    const ultimaMsgAgente = [...historico].reverse().find((m) => m.role === 'assistant');
    // Item 3 (S-WM-21, cont. VAL-08): dígito solto só conta como seleção de menu de categorias
    // se o ESTADO da conversa confirma que a resposta anterior do agente foi de fato um menu de
    // categorias (metadata.menu_categoria_ativo, setado pelo próprio código mais abaixo neste
    // mesmo Passo 6) — não o formato do texto (ultimaMensagemEhMenuNumerado, VAL-08 original),
    // que o GPT pode improvisar (ex.: uma lista numerada respondendo a outra pergunta qualquer)
    // sem o código ter convidado nenhuma seleção. MENU_UNIDADES nunca chega aqui: sempre causa
    // early-return na seção 5b, antes deste Passo 6. Lê de `metadataAtual` (fix CRITICAL, não
    // de `conversa.metadata` direto) — os writes da seção 5b nunca tocam `menu_categoria_ativo`,
    // então o valor aqui continua sendo fielmente o do turno ANTERIOR, só que através do tracker
    // que já reflete corretamente qualquer write que a seção 5b tenha feito neste turno.
    const menuCategoriaAtivoAnterior = metadataAtual.menu_categoria_ativo === true;
    const isSelecaoMenu = ehSelecaoMenu(textoFinal) && menuCategoriaAtivoAnterior;

    const precisaVisaoGeral = calcularPrecisaVisaoGeral({ conversaJustCreated: conversaGenuinamenteNova, trocouUnidade, isSelecaoMenu });
    // VAL-04: sem esta linha não dava para saber, pelo log, se a visão geral completa
    // (~40 chunks direto do monthly_program) foi carregada ou se a resposta dependeu só da
    // busca vetorial de acompanhamento — confirmar isso exigia cruzar ausência de log com
    // query manual no banco (ver VAL-01/VAL-02 no relatório).
    console.log("[motor-agente v18] precisaVisaoGeral=" + precisaVisaoGeral + " (unidade=" + unidadeEfetiva + ", conversaGenuinamenteNova=" + conversaGenuinamenteNova + ", trocouUnidade=" + trocouUnidade + ", isSelecaoMenu=" + isSelecaoMenu + ")");

    // Item 3 (S-WM-21): registra pro PRÓXIMO turno se ESTA resposta vai ser um menu de
    // categorias (visão geral / área de programação) — só grava quando o valor muda, pra não
    // gerar update desnecessário em toda mensagem de acompanhamento comum. Fix CRITICAL: mescla
    // sobre `metadataAtual` (o tracker), nunca sobre `conversa.metadata` puro — senão este write
    // apaga `unidade_selecionada`/`aguardando_unidade` que a seção 5b acabou de gravar no mesmo
    // turno (achado do @qa Quinn, reproduzido: update apagava a unidade recém-escolhida).
    if (isAgenteProgramacao) {
      const menuCategoriaAtivoNovo = !consultaProgramacao && Boolean(temUnidadeDefinida) && precisaVisaoGeral;
      if (menuCategoriaAtivoNovo !== menuCategoriaAtivoAnterior) {
        metadataAtual = { ...metadataAtual, menu_categoria_ativo: menuCategoriaAtivoNovo };
        await supabase.rpc('merge_conversa_metadata', { p_conversa_id: conversa.id, p_patch: metadataAtual });
      }
    }

    // S-WM-72: instrução da consulta de programação com contexto (vazia fora desse ramo).
    let instrucaoConsultaProgramacao = "";
    // S-INST-QUAL-14 (V4): consulta cuja resposta mostra a lista de unidades — guardada no fim do turno.
    let consultaComListaDeUnidades: Omit<UltimaConsultaProgramacao, "marca"> | null = null;
    // S-INST-QUAL-15 (achado 2): o P2 da consulta por dia, garantido na resposta depois do modelo.
    let outrasAtividadesDoDia: OutrasAtividadesDoDia | null = null;
    if (consultaProgramacao) {
      const c = consultaProgramacao;
      reiniciarBlocos(true);
      const itensRede = await carregarItensProgramacaoRede(supabase, usarCacheProgramacao);
      const r = montarConsultaComContexto(itensRede, c);
      const nomeEscopo = c.escopo === ESCOLHA_REDE ? ROTULO_REDE : c.escopo;
      const contextoTxt = descreverContexto(c.contexto);
      const sobre = c.atividade ?? (r.area ? ROTULO_AREA[r.area] : "o que a pessoa perguntou");
      if (r.bloco) adicionarBloco("programacao_contexto", "\n\n--- PROGRAMACAO VIGENTE (programacao mensal ativa, filtrada pela pergunta" + (contextoTxt ? " e pelo contexto: " + contextoTxt : "") + ") ---\n" + r.bloco);
      // Parte que não é programação (matrícula, documentos, inscrição): FAQ, pela pergunta original.
      const embeddingConsulta = await gerarEmbedding(c.texto, openaiKey, registrarConsumoEmbedding);
      const { data: chunksFaqConsulta, error: erroFaqConsulta } = await supabase.rpc("buscar_chunks_similares", {
        query_embedding: "[" + embeddingConsulta.join(",") + "]",
        p_tipos: ["FAQ"], // FAQ é geral (sem unidade); p_unidade_cuca omitido = NULL no banco
        p_limite: 3,
      });
      buscaRAG = classificarResultadoBusca(chunksFaqConsulta, erroFaqConsulta, 3);
      if (chunksFaqConsulta && chunksFaqConsulta.length > 0) adicionarBloco("faq", "\n\n--- CONTEXTO (FAQ) ---\n" + formatarChunks(chunksFaqConsulta));
      const opcoesNumeradas = "com as opcoes numeradas e o nome da unidade em cada linha (ex.: '1️⃣ Cuca Mondubim')";
      const porSituacao: Record<string, string> = {
        na_unidade: "Responda usando o bloco '--- PROGRAMACAO VIGENTE ---' (programacao do " + nomeEscopo + ").",
        rede: "Responda usando o bloco '--- PROGRAMACAO VIGENTE ---', dizendo em quais unidades da rede tem.",
        outras_unidades: "No " + nomeEscopo + " nao ha essa atividade" + (contextoTxt ? " para esse contexto (" + contextoTxt + "); se o bloco mostrar que ela existe la para outro publico, diga isso tambem" : "") + ". Diga isso e informe, usando so o bloco '--- PROGRAMACAO VIGENTE ---', em quais unidades tem; pergunte se a pessoa quer saber de alguma delas, " + opcoesNumeradas + ".",
        nenhuma: "Nao foi encontrado(a) " + sobre + (contextoTxt ? " para esse contexto (" + contextoTxt + ")" : "") + " em nenhuma unidade na programacao deste mes (a busca foi feita em todas as unidades). Diga isso com suas palavras e pergunte se e onde a pessoa quer saber de outras opcoes de " + (r.area ? ROTULO_AREA[r.area] : "programacao") + (contextoTxt ? " para esse contexto" : "") + " — no " + (c.escopo === ESCOLHA_REDE ? "uma unidade especifica" : nomeEscopo + ", em outra unidade") + " ou em toda a Rede CUCA. NUNCA responda so 'nao tem'.",
        area: "Liste so os nomes das atividades do bloco '--- PROGRAMACAO VIGENTE ---' (area " + (r.area ? ROTULO_AREA[r.area] : "") + ", " + nomeEscopo + "), de forma compacta, e pergunte qual interessa para mostrar dias e horarios. Nao liste atividades de outras areas.",
        sem_atividade: "Responda a pergunta usando o FAQ e os servicos da rede, se cobrirem; para programacao, pergunte qual atividade ou area a pessoa procura. Nao invente atividades.",
        // S-INST-QUAL-13 (P1 e P2): pergunta por dia da semana, conferida na programação do mês.
        dia_na_unidade: "Responda usando o bloco '--- PROGRAMACAO VIGENTE ---': liste o que o " + nomeEscopo + " tem de " + (r.area ? ROTULO_AREA[r.area] : "atividades") + " no " + r.dia + ", com dias e horarios. Se o bloco trouxer 'Outras atividades', cite-as em uma linha no fim.",
        dia_outras_unidades: "O " + nomeEscopo + " nao tem " + (r.area ? ROTULO_AREA[r.area] : "atividades") + " no " + r.dia + " na programacao deste mes. Diga isso e informe, usando so o bloco '--- PROGRAMACAO VIGENTE ---', quais unidades tem " + (r.area ? ROTULO_AREA[r.area] : "atividades") + " no " + r.dia + "; pergunte se a pessoa quer saber de alguma delas, " + opcoesNumeradas + ". Se o bloco trouxer 'Outras atividades no " + nomeEscopo + "', cite-as em uma linha. NUNCA diga que a rede nao tem " + (r.area ? ROTULO_AREA[r.area] : "atividades") + " no " + r.dia + ".",
        dia_fora_do_contexto: "No " + r.dia + " tem " + (r.area ? ROTULO_AREA[r.area] : "atividades") + ", mas nada para o contexto da conversa (" + (r.foraDoContexto ?? "") + "). Diga isso e mostre, usando so o bloco '--- PROGRAMACAO VIGENTE ---', o que tem no " + r.dia + " (unidade, dias e horarios); pergunte se algum desses serve. NUNCA diga que nao tem " + (r.area ? ROTULO_AREA[r.area] : "atividades") + " no " + r.dia + ".",
        dia_rede: "Responda usando o bloco '--- PROGRAMACAO VIGENTE ---', dizendo em quais unidades tem " + (r.area ? ROTULO_AREA[r.area] : "atividades") + " no " + r.dia + ", com dias e horarios.",
        dia_nenhuma: "Nenhuma unidade " + (c.escopo === ESCOLHA_REDE ? "da rede" : "(conferido no " + nomeEscopo + " e nas outras)") + " tem " + (r.area ? ROTULO_AREA[r.area] : "atividades") + " no " + r.dia + " na programacao deste mes. Diga isso com suas palavras; se o bloco '--- PROGRAMACAO VIGENTE ---' trouxer outras atividades no " + r.dia + ", cite-as em uma linha. Pergunte se a pessoa quer saber de " + (r.area ? ROTULO_AREA[r.area] : "atividades") + " em outros dias. A programacao e a do mes atual: nao fale de meses anteriores.",
        // S-INST-QUAL-06: só a rota estruturada chega aqui (listarPorIdade).
        idade: "Liste, de forma compacta, os nomes das atividades do bloco '--- PROGRAMACAO VIGENTE ---' (" + nomeEscopo + "), que ja foram filtradas pela idade informada, e pergunte qual interessa para mostrar dias e horarios. Nao liste atividades fora do bloco.",
        // S-INST-QUAL-14: lista pelo turno/dia da conversa, sem idade; e filtro herdado que esvaziou a resposta.
        contexto: "Liste, de forma compacta, os nomes das atividades do bloco '--- PROGRAMACAO VIGENTE ---' (" + nomeEscopo + "), que ja foram filtradas pelo contexto da conversa (" + contextoTxt + "), e pergunte qual interessa para mostrar dias e horarios. Nao liste atividades fora do bloco.",
        filtro_herdado: "Nesta conversa a pessoa tinha pedido " + (r.filtro ?? "") + ", e com esse filtro nao ha " + sobre + " no " + nomeEscopo + ". Diga isso com suas palavras (ex.: 'nesse dia nao tem') e mostre, usando so o bloco '--- PROGRAMACAO VIGENTE ---', o que tem fora desse filtro, com dias e horarios; pergunte se algum serve. NUNCA diga que nao tem " + sobre + " na rede.",
      };
      const semDado = Object.keys(c.contexto).filter((k) => CONTEXTO_SEM_DADO.some((x) => k.startsWith(x)));
      instrucaoConsultaProgramacao = "INSTRUCAO CRITICA (programacao com contexto): " + porSituacao[r.situacao]
        + (contextoTxt ? " Considere o contexto da conversa: " + contextoTxt + "." : "")
        + (semDado.length ? " A programacao NAO informa adequacao para: " + semDado.join(", ") + " — nunca afirme que a atividade e adequada; diga que a programacao nao traz essa informacao e sugira confirmar com a unidade." : "")
        + " Se a pergunta tambem tiver uma parte que nao e programacao (ex.: matricula, documentos), responda essa parte com o FAQ e os servicos da rede.";
      logRAG = { camada: "programacao_contexto", atividadeResolvida: c.atividade };
      outrasAtividadesDoDia = r.outrasAtividades ?? null;
      if (SITUACOES_COM_LISTA_DE_UNIDADES.includes(r.situacao)) consultaComListaDeUnidades = { texto: c.texto, atividade: c.atividade, termos: c.termos, area: c.area ?? r.area, contexto: c.contexto, tituloExato: c.tituloExato ?? null };
      console.log("[motor-agente v18] Consulta S-WM-72: situacao=" + r.situacao + " escopo=" + nomeEscopo + " atividade=" + c.atividade + " contexto=" + contextoTxt + (r.dia ? " dia=" + r.dia : ""));
    } else if (temUnidadeDefinida && isAgenteProgramacao && precisaVisaoGeral) {
      // S-WM-43 (PERF-02, Par 3): carregarProgramacaoMensal e gerarEmbedding não dependem de
      // dado um do outro (o embedding usa textoFinal, não conteudoPrograma) — paralelizados.
      // `buscarAtividadeDeterministica` (abaixo, condicional a trocaComPedidoEspecifico ||
      // trocouUnidade) foi deliberadamente deixado FORA deste Promise.all: é uma chamada
      // condicional (nem sempre roda) e a S-WM-35 a introduziu depois do plano original desta
      // story — incluí-la aumentaria a superfície de risco (mais uma chamada de rede concorrente
      // no mesmo trecho) para um ganho marginal, já que ela só dispara numa fração dos turnos.
      const [conteudoPrograma, embedding] = await Promise.all([
        carregarProgramacaoMensal(supabase, unidadeEfetiva),
        gerarEmbedding(textoRota, openaiKey, registrarConsumoEmbedding),
      ]);

      let instrucaoArea = "";
      // S-WM-34 (VAL-23): trocouUnidade sozinho n\u00e3o basta mais \u2014 quando a mensagem que causou a
      // troca j\u00e1 trazia um pedido espec\u00edfico junto (ex.: "e no Mondubim, tem nata\u00e7\u00e3o de noite?"),
      // a instru\u00e7\u00e3o de "resumo geral" suprimia esse pedido mesmo com o dado certo carregado logo
      // abaixo (conteudoPrograma). Sem trocaComPedidoEspecifico, o GPT segue livre pra responder
      // ao pedido usando o contexto completo que j\u00e1 foi carregado de qualquer forma.
      if (trocouUnidade && !trocaComPedidoEspecifico) {
        instrucaoArea = "\nO usu\u00e1rio acabou de trocar para esta unidade. Apresente um resumo geral do que tem na programa\u00e7\u00e3o.";
      } else if (isSelecaoMenu) {
        const textoOpcao = ultimaMsgAgente ? extrairTextoMenu(textoFinal.trim(), ultimaMsgAgente.content) : '';
        if (textoOpcao) instrucaoArea = "\nO usu\u00e1rio selecionou a \u00e1rea: " + textoOpcao + ". Foque APENAS nessa \u00e1rea.";
      }

      // S-WM-51: contextRAG inicializado com contextServicos (nunca "" direto) — ver comentário
      // na declaração de contextServicos, acima. Sem isso, "if (conteudoPrograma)" falso (mês sem
      // programação carregada) deixaria contextRAG em "" de novo, perdendo o bloco de serviços.
      reiniciarBlocos(true);
      if (conteudoPrograma) {
        adicionarBloco("programacao_completa", "\n\n--- PROGRAMACAO MENSAL ATUAL (" + unidadeEfetiva + ") ---" + instrucaoArea + "\n" + conteudoPrograma);
        // @qa FAIL-2: este e o caminho MAIS COMUM do Institucional (carrega os 85-137 chunks da
        // unidade direto, sem embedding) e nao era contado como camada nenhuma — o turno virava
        // `nao_aplicavel`, e a metrica diria que quase nao ha RAG acontecendo.
        logRAG = { camada: "programacao_completa" };
      }

      // S-WM-35 (Frente C): quando a mensagem que causou a troca de unidade ja trazia um pedido
      // especifico junto (trocaComPedidoEspecifico), SOMA um bloco de dado exato
      // (atividades_mensais.metadata) ao resumo geral acima - nao substitui. O resumo geral
      // continua sendo a base da resposta (a bifurcacao de instrucao do S-WM-34, mais abaixo no
      // promptFinal, ja cuida de pedir uma resposta direta ao pedido quando esse bloco existe);
      // este bloco so garante que o dado exato da atividade pedida esta disponivel com certeza,
      // em vez de depender so do que sobrar nos ~40+ chunks do resumo geral.
      if (trocaComPedidoEspecifico || trocouUnidade) {
        const buscaEspecifica = await buscarAtividadeDeterministica(supabase, unidadeEfetiva as string, textoRota, historico);
        const conteudoAtividadeEspecifica = buscaEspecifica.conteudo;
        resolucaoAtividade = buscaEspecifica.resolucao;
        if (conteudoAtividadeEspecifica) {
          adicionarBloco("atividade_especifica", "\n\n--- ATIVIDADE ESPECIFICA (dado exato) ---\n" + conteudoAtividadeEspecifica);
          // Sobrescreve `programacao_completa` de proposito: quando a camada deterministica
          // respondeu, e ELA a fonte do dado exato — o resumo geral e so pano de fundo.
          logRAG = { camada: "deterministica_metadata" };
        }
      }

      // Complementa com eventos pontuais via busca vetorial (embedding já resolvido acima, no Promise.all do Par 3)
      const { data: chunksEventos, error: erroEventos } = await supabase.rpc("buscar_chunks_similares", {
        query_embedding: "[" + embedding.join(",") + "]",
        p_tipos: ["eventos_pontuais", "FAQ"],
        p_unidade_cuca: unidadeEfetiva,
        p_limite: 3,
      });
      buscaRAG = classificarResultadoBusca(chunksEventos, erroEventos, 3);
      const chunksEventosVigentes = semTrechosVencidos(chunksEventos); // S-INST-QUAL-14
      if (chunksEventosVigentes.length > 0) {
        adicionarBloco("eventos_faq", "\n\n--- EVENTOS E FAQ ---\n" + formatarChunks(chunksEventosVigentes));
        // So marca vetorial se a camada deterministica nao tiver respondido antes — o que manda
        // e a fonte da ATIVIDADE, nao o complemento de eventos.
        if (logRAG.camada === "nao_aplicavel") logRAG = { camada: "vetorial", chunksRetornados: mapearChunks(chunksEventosVigentes) };
      }
    } else if (temUnidadeDefinida && isAgenteProgramacao && pedidoOutrasUnidades) {
      // S-WM-71 (Item 3): "procure em outras unidades" — busca a atividade da sessão na rede
      // inteira (só monthly_program ativo). Sem atividade identificável, o prompt manda perguntar
      // o que a pessoa procura, nunca a frase de recusa de assunto fora do CUCA.
      reiniciarBlocos(true);
      // S-WM-72 (R8): aplica também o contexto da sessão (idade, gênero, turno).
      const itensComContexto = filtrarItensPorContexto(await carregarItensProgramacaoRede(supabase, !supabaseOverride), (metadataAtual.prog_contexto ?? {}) as Record<string, unknown>); // S-INST-QUAL-14: com o dia
      const blocoRede = montarBlocoRedeComAtividadeDaSessao(itensComContexto, textoRota, historico);
      outrasUnidadesComAtividade = blocoRede !== "";
      if (blocoRede) {
        adicionarBloco("programacao_rede", blocoProgramacaoRedeTexto(blocoRede));
        logRAG = { camada: "programacao_rede" };
      } else {
        logRAG = { camada: "sem_match_rag" };
      }
      console.log("[motor-agente v18] Pedido de outras unidades: atividade da sessao " + (blocoRede ? "encontrada na rede" : "nao identificada"));
    } else if (temUnidadeDefinida && isAgenteProgramacao) {
      // Pergunta de acompanhamento (conversa em andamento, mesma unidade, sem selecao de menu):
      // 3 camadas, cada uma cai pra proxima automaticamente quando retorna null (mesmo padrao
      // if/else que o S-WM-34 ja usava pra cair da busca deterministica por texto pra busca
      // vetorial - nenhuma condicao extra foi adicionada aqui):
      // 1) S-WM-35 (Frente C) - busca deterministica em atividades_mensais.metadata (dado
      //    estruturado na tabela-fonte, categoria ESPORTES).
      // 2) S-WM-34 (VAL-09) - busca deterministica por texto nos chunks do monthly_program
      //    (evita o limite de 5 chunks da busca vetorial quando a atividade esta dispersa em
      //    muitos chunks nao-contiguos).
      // 3) Busca vetorial (comportamento original, rede de seguranca) - so quando a mensagem
      //    nao cita nenhuma modalidade conhecida em nenhuma das duas camadas deterministicas.
      // S-WM-AUD-007: o `??` foi aberto em duas linhas SO pra saber qual camada respondeu.
      // Semantica identica — `buscarAtividadeEspecifica` continua so sendo chamada quando a
      // primeira devolve null (short-circuit do `??` preservado pelo `?? await`).
      // S-INST-QUAL-03: as duas funcoes devolvem tambem o motivo do null; o `??` continua
      // garantindo que a segunda so roda quando a primeira nao achou.
      const buscaMetadata = await buscarAtividadeDeterministica(supabase, unidadeEfetiva as string, textoRota, historico);
      const conteudoAtividadeMetadata = buscaMetadata.conteudo;
      const buscaTexto = conteudoAtividadeMetadata ? null : await buscarAtividadeEspecifica(supabase, unidadeEfetiva as string, textoRota, historico);
      const conteudoAtividade = conteudoAtividadeMetadata ?? buscaTexto?.conteudo ?? null;
      resolucaoAtividade = combinarResolucaoAtividade(buscaMetadata.resolucao, buscaTexto?.resolucao);
      if (conteudoAtividadeMetadata) logRAG = { camada: "deterministica_metadata" };
      else if (conteudoAtividade) logRAG = { camada: "deterministica_texto" };
      // S-WM-51: mesma inicialização com contextServicos que o branch anterior — ver comentário
      // na declaração de contextServicos.
      reiniciarBlocos(true);
      if (conteudoAtividade) {
        adicionarBloco("atividade_contexto", "\n\n--- CONTEXTO (atividade especifica) ---\n" + conteudoAtividade);
      } else {
        const embedding = await gerarEmbedding(textoRota, openaiKey, registrarConsumoEmbedding);
        const { data: chunksPrograma, error: erroPrograma } = await supabase.rpc("buscar_chunks_similares", {
          query_embedding: "[" + embedding.join(",") + "]",
          p_tipos: ["monthly_program", "eventos_pontuais", "FAQ"],
          p_unidade_cuca: unidadeEfetiva,
          p_limite: 5,
        });
        buscaRAG = classificarResultadoBusca(chunksPrograma, erroPrograma, 5);
        // VAL-02/VAL-04: quantos chunks a busca de acompanhamento realmente trouxe - sem isso,
        // "o GPT respondeu errado" e "a busca nao trouxe o chunk certo" eram indistinguiveis no log.
        console.log("[motor-agente v18] Busca vetorial acompanhamento: " + (chunksPrograma?.length ?? 0) + " chunks (unidade=" + unidadeEfetiva + ")");
        // S-INST-QUAL-14: trecho de programação ou evento com a data inteira passada não vai ao modelo.
        const chunksProgramaVigentes = semTrechosVencidos(chunksPrograma);
        if (chunksProgramaVigentes.length > 0) {
          adicionarBloco("contexto_vetorial", "\n\n--- CONTEXTO ---\n" + formatarChunks(chunksProgramaVigentes));
          logRAG = { camada: "vetorial", chunksRetornados: mapearChunks(chunksProgramaVigentes) };
        } else {
          logRAG = { camada: "sem_match_rag" };
        }
      }
    } else if (isAgenteProgramacao && perguntaGeralAtiva) {
      // VAL-12: pergunta institucional real sem unidade escolhida ainda — busca só em FAQ.
      // documentos_rag confirma (produção, 2026-07-10): FAQ é 4/4 documentos sem unidade_cuca
      // (sempre geral), monthly_program é 5/5 SEMPRE atrelado a uma unidade — misturar tipos
      // aqui (como RAG_FONTES_POR_AGENTE faz) vazaria conteúdo de uma unidade aleatória (a mais
      // parecida por embedding) numa resposta que ainda não tem unidade definida.
      // Achado 2026-10-09: pergunta de programação sem unidade (ex.: "tem curso de libras?") é
      // respondida SÓ com o monthly_program ativo das unidades, filtrado pelas palavras da
      // mensagem — nunca mais pelo resumo_rede. Sem match de título = não é pergunta de
      // programação (ou a atividade não existe neste mês): segue só com FAQ, e a instrução de
      // pergunta geral proíbe citar atividade/dia/horário sem esse bloco.
      const palavrasProgramacao = palavrasChaveProgramacao(textoRota);
      const [itensRede, embedding] = await Promise.all([
        palavrasProgramacao.length > 0 ? carregarItensProgramacaoRede(supabase) : Promise.resolve([] as ItemProgramacao[]),
        gerarEmbedding(textoRota, openaiKey, registrarConsumoEmbedding),
      ]);
      const blocoProgramacaoRede = montarBlocoProgramacaoRede(itensRede, palavrasProgramacao);
      const { data: chunksFaq, error: erroFaq } = await supabase.rpc("buscar_chunks_similares", {
        query_embedding: "[" + embedding.join(",") + "]",
        p_tipos: ["FAQ"],
        p_unidade_cuca: null,
        p_limite: 5,
      });
      buscaRAG = classificarResultadoBusca(chunksFaq, erroFaq, 5);
      console.log("[motor-agente v18] perguntaGeralAtiva: programacao_rede " + (blocoProgramacaoRede ? "encontrada" : "sem match") + " (palavras=" + palavrasProgramacao.join(",") + "), " + (chunksFaq?.length ?? 0) + " chunks FAQ");
      const blocosRede: { nome: string; texto: string }[] = [];
      if (blocoProgramacaoRede) blocosRede.push({ nome: "programacao_rede", texto: "--- PROGRAMACAO VIGENTE DA REDE (programacao mensal ativa de cada unidade, filtrada pela pergunta) ---\n" + blocoProgramacaoRede });
      if (chunksFaq && chunksFaq.length > 0) {
        blocosRede.push({ nome: "faq", texto: "--- CONTEXTO (FAQ) ---\n" + formatarChunks(chunksFaq) });
      }
      if (blocoProgramacaoRede) {
        logRAG = { camada: "programacao_rede", chunksRetornados: chunksFaq && chunksFaq.length > 0 ? mapearChunks(chunksFaq) : undefined };
      } else if (chunksFaq && chunksFaq.length > 0) {
        logRAG = { camada: "vetorial", chunksRetornados: mapearChunks(chunksFaq) };
      } else {
        logRAG = { camada: "sem_match_rag" };
      }
      // S-WM-51: mesma inicialização com contextServicos dos outros 2 branches.
      reiniciarBlocos(true);
      // Mesmo texto de antes: "\n\n" + A + "\n\n" + B == ("\n\n" + A) + ("\n\n" + B).
      for (const b of blocosRede) adicionarBloco(b.nome, "\n\n" + b.texto);
    } else {
      const fontes = RAG_FONTES_POR_AGENTE[agente_tipo] || ["FAQ"];
      const embedding = await gerarEmbedding(textoRota, openaiKey, registrarConsumoEmbedding);
      const { data: chunks, error: erroChunks } = await supabase.rpc("buscar_chunks_similares", {
        query_embedding: "[" + embedding.join(",") + "]",
        p_tipos: fontes,
        p_unidade_cuca: temUnidadeDefinida ? unidadeEfetiva : null,
        p_limite: 5,
      });
      buscaRAG = classificarResultadoBusca(chunks, erroChunks, 5);
      reiniciarBlocos(false);
      if (chunks && chunks.length > 0) {
        adicionarBloco("contexto_vetorial", "\n\n--- CONTEXTO ---\n" + formatarChunks(chunks));
        logRAG = { camada: "vetorial", chunksRetornados: mapearChunks(chunks) };
      }
    }

    // S-INST-QUAL-14 (V6): fora da consulta filtrada (programação inteira, acompanhamento), o dia e o
    // turno da conversa vão como instrução — o modelo recebe o texto inteiro e filtra por ele.
    if (!consultaProgramacao && isAgenteProgramacao && temUnidadeDefinida && unidade_cuca === "Geral") {
      const ctx = (metadataAtual.prog_contexto ?? {}) as Record<string, unknown>;
      if (temFiltroDeDiaOuTurno(ctx)) {
        const filtro = descreverContexto({ dia: ctx.dia, data: ctx.data, turno: ctx.turno });
        instrucaoConsultaProgramacao = "INSTRUCAO (filtro da conversa): nesta conversa a pessoa pediu " + filtro + ". Se a pergunta for sobre programacao, considere so as atividades desse dia/horario; se nao houver nenhuma, diga isso e mostre o que tem em outros dias ou horarios — nunca responda so que nao tem.";
      }
    }

    // 6.5 Diretiva de vigência do mês (S-PROG-10, item 3) — computada UMA vez, fora da cadeia de
    // branches acima, porque se aplica independente de qual delas carregou o monthly_program (a
    // pergunta pode vir tanto na visão geral quanto no acompanhamento). "" (nenhuma mudança no
    // prompt) na grande maioria dos casos hoje: documento sem mes/ano (dado anterior a esta
    // story, AC5) ou mês corrente (AC3) — só os dois `if`s abaixo tocam `contextRAG`.
    if (temUnidadeDefinida && isAgenteProgramacao) {
      const diretivaVigenciaMes = await calcularDiretivaVigenciaMes(supabase, unidadeEfetiva as string);
      if (diretivaVigenciaMes) adicionarBloco("diretiva_vigencia", diretivaVigenciaMes);
    }
    contextRAG = blocosContexto.map((b) => b.texto).join("");

    // S-WM-AUD-007 / Plano 012: UM insert por turno, aqui — nao um por ponto de busca (seriam 6).
    // Sem `await` de proposito: a latencia do insert nao pode entrar no tempo de resposta ao
    // cidadao, e `registrarBuscaRAG` ja engole qualquer excecao internamente.
    manterVivoAposResposta(registrarBuscaRAG(supabase, {
      // `conversa?.id` em vez de `conversa.id`: a coluna e nullable (FK com on delete set null)
      // e este e o unico lugar novo que tocaria `conversa` — nao aumento o baseline de 29 erros
      // de "conversa possibly null" por causa de um log. Se `conversa` fosse null aqui, a linha
      // e gravada sem vinculo em vez de estourar.
      conversa_id: conversa?.id ?? null,
      agente_tipo,
      unidade_cuca: (unidadeEfetiva as string | null) ?? null,
      camada: logRAG.camada,
      atividade_resolvida: logRAG.atividadeResolvida ?? null,
      chunks_retornados: logRAG.chunksRetornados ?? null,
      mensagem_lead: mensagemLead,
      resolucao_atividade: resolucaoAtividade,
      rota_fallback: rotaFallback,
      ...buscaRAG,
    }));

    // 7. Data/hora
    const agora = new Date();
    const DATA_ATUAL = "DATA E HORA ATUAL: " + agora.toLocaleDateString("pt-BR", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "America/Fortaleza" }) + ", " + agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Fortaleza" }) + " (Fortaleza/CE).";

    // 8. Guardrail (definido em nível de módulo — ver INSTRUCAO_SEGURANCA acima)

    // 9. Breadcrumb
    let CONTEXTO_DISPARO = "";
    const ultimoDisparo = conversa?.metadata?.ultimo_disparo;
    if (ultimoDisparo) {
      CONTEXTO_DISPARO = "ULTIMO DISPARO: Lead recebeu '" + ultimoDisparo.titulo + "' (" + new Date(ultimoDisparo.enviado_em).toLocaleDateString("pt-BR") + ")";
    }

    // 10. Prompt final
    // PLANO-023: cada parte tem nome — o texto enviado é a junção das partes, e os tamanhos vão
    // para `ai_usage_logs.blocos_contexto`. `contextRAG` entra desmembrado nos blocos de
    // `blocosContexto`, só no registro.
    // PLANO-025: ordem pensada para o cache da OpenAI, que só reaproveita o PREFIXO idêntico entre
    // chamadas. O que não muda de uma mensagem para outra vem primeiro — sistema, segurança,
    // contexto do agente e `contextRAG`, que sempre começa pelo bloco de serviços da rede — e o
    // que muda a cada mensagem vem depois: `DATA_ATUAL` (tem hora:minuto) e `CONTEXTO_DISPARO`.
    // Antes, a data ficava na 2ª posição e quebrava o prefixo logo depois do prompt de sistema.
    // Mesmo conteúdo, só a posição mudou.
    const partesPrompt: [string, string][] = [
      ["prompt_sistema", prompt.prompt_sistema], ["instrucao_seguranca", INSTRUCAO_SEGURANCA],
      // S-INST-QUAL-01: so Institucional/maria. Texto fixo, entao fica no prefixo (cache).
      ["instrucao_institucional", isAgenteProgramacao ? INSTRUCAO_INSTITUCIONAL : ""],
      ["prompt_contexto", prompt.prompt_contexto || ""], ["contexto_rag", contextRAG],
      ["data_atual", DATA_ATUAL], ["contexto_disparo", CONTEXTO_DISPARO],
      ["unidade", "UNIDADE: " + (unidadeEfetiva || "Nao informada")],
      // TOM-04: regra genérica, sem dado do usuário — o dado (nome) vai isolado no turno
      // "user" (contextoNomeLead), sem diretiva junto. Separar dado de instrução fecha a
      // superfície de prompt injection (lead.nome é controlado pelo próprio usuário) e mantém
      // a regra comportamental no prompt de sistema, onde é seguida de forma confiável — uma
      // instrução de moderação num turno "user" antecipado, longe do ponto de geração, é
      // seguida com muito menos confiabilidade.
      ["regra_nome", "Se o contexto informar o nome do lead, use-o com moderacao (1-2x, em momentos naturais da conversa)."],
      // S-WM-34 (VAL-23): trocaComPedidoEspecifico bifurca a instrução — resumo geral (comportamento
      // atual preservado, AC4) quando a troca foi "pelada" (só o nome da unidade ou pedido vago);
      // resposta direta ao pedido (sem resumo geral) quando a mensagem que trocou de unidade já
      // trazia um pedido específico junto (AC3) — o contexto de programação já foi carregado de
      // qualquer forma (conteudoPrograma, acima), então a resposta direta tem o dado disponível.
      ["instrucao_troca_unidade", trocouUnidade && !trocaComPedidoEspecifico
        ? "INSTRUCAO: O cidadao acabou de trocar para esta unidade. Inicie com uma mensagem de transicao amigavel (ex: 'Claro! Vou te mostrar o que tem no [unidade] 😊') e apresente um resumo geral da programacao usando formato compacto."
        : ""],
      ["instrucao_troca_com_pedido", trocouUnidade && trocaComPedidoEspecifico
        ? "INSTRUCAO: O cidadao acabou de trocar para esta unidade E ja fez um pedido especifico na mesma mensagem. Inicie com uma mensagem de transicao amigavel curta (ex: 'Claro! Vou verificar isso no [unidade] 😊') e responda DIRETAMENTE ao pedido especifico usando os dados disponiveis acima — programacao mensal e/ou o bloco '--- SERVICOS DA REDE (comuns + excecoes por unidade) ---' (se presente) — NAO apresente um resumo geral da programacao."
        : ""],
      ["instrucao_atividade", contextRAG.includes("ATIVIDADE ESPECIFICA") || contextRAG.includes("atividade especifica")
        ? "INSTRUCAO CRITICA: existe um bloco de atividade especifica com dado exato no contexto. Use esse bloco como fonte principal e liste TODAS as turmas/linhas compatíveis presentes nele. Nao resuma, nao escolha só algumas e nao omita opcoes. Preserve quando existir: categoria, titulo/modalidade, turma, professor/responsavel, dias, horario, sexo, faixa etaria/idade e local."
        : ""],
      // VAL-07: para Institucional/maria, só dizer "primeira mensagem" quando for de fato
      // conversaGenuinamenteNova (não reabertura) — evita mandar essa instrução pro GPT numa
      // conversa retomada minutos depois. Outros agente_tipo (Sofia/Ouvidoria) continuam no
      // conversaJustCreated original, sem mudança — decisão sobre eles fica fora deste escopo.
      ["instrucao_primeira_mensagem", !consultaProgramacao && (isAgenteProgramacao ? conversaGenuinamenteNova : conversaJustCreated) ? "INSTRUCAO: Esta e a primeira mensagem. Combine saudacao e menu em uma unica resposta." : ""],
      // Achado 2026-07-24: CONTEXTO_DISPARO (acima) era só um fato passivo no meio do prompt,
      // sem nenhuma diretiva de uso — diferente dos outros blocos deste array, que sempre vêm
      // com uma INSTRUCAO explícita dizendo como reagir. Gated no mesmo `ultimoDisparo` de
      // CONTEXTO_DISPARO (nunca aparece sem o fato correspondente). Não conflita com a INSTRUCAO
      // de "primeira mensagem" acima: `ultimo_disparo` só existe quando o worker já criou a linha
      // de `conversas` antes desta mensagem chegar (breadcrumb do disparo) — nesse caso
      // conversaGenuinamenteNova/conversaJustCreated já são false, então as duas nunca disparam
      // juntas pro mesmo turno.
      ["instrucao_disparo", ultimoDisparo
        ? "INSTRUCAO: O lead recebeu recentemente o aviso institucional citado em ULTIMO DISPARO. Reconheca isso de forma natural e breve na resposta (ex: 'Vi que voce recebeu nosso aviso sobre...') antes de seguir com o resto — NAO trate esta mensagem como se fosse a primeira interacao da conversa, mesmo que pareca uma saudacao."
        : ""],
      // S-WM-32 (AC8, achado de Junior em teste ao vivo): pergunta de rede inteira sem unidade
      // ja gerou alucinacao silenciosa antes desta story ("tem curso de natacao?" respondido com
      // uma lista de modalidades sem fonte real verificavel) — vale tanto enquanto o
      // resumo_rede ainda nao existe/nao foi gerado quanto depois, se o resumo_rede ativo nao
      // cobrir a atividade perguntada. Reforco condicional (so quando perguntaGeralAtiva=true),
      // nao generico em INSTRUCAO_SEGURANCA, pra nao confundir respostas de 1 unidade especifica.
      // S-WM-71 (Item 3): pedido de procurar em outras unidades.
      ["instrucao_outras_unidades", outrasUnidadesComAtividade === null ? "" : outrasUnidadesComAtividade
        ? "INSTRUCAO: a pessoa pediu para procurar em outras unidades. Responda com base no bloco '--- PROGRAMACAO VIGENTE DA REDE ---': em quais unidades a atividade aparece e os dados delas, e pergunte de qual unidade quer saber mais, com as opcoes numeradas e o nome da unidade em cada linha (ex.: '1️⃣ Cuca Mondubim')."
        : "INSTRUCAO: a pessoa pediu para procurar em outras unidades, mas nao deu para identificar qual atividade ela procura. Pergunte com suas palavras qual atividade ela quer encontrar ou de qual unidade quer saber. NAO diga que nao pode ajudar e NAO use a frase de recusa de assunto fora do CUCA."],
      // S-WM-72 (R3/R4): pergunta original (no turno da escolha o lead mandou só "3") + instrução da consulta.
      ["pergunta_original", consultaProgramacao?.perguntaOriginal ? "PERGUNTA DO LEAD QUE VOCE ESTA RESPONDENDO AGORA (ele acabou de escolher onde quer saber): " + consultaProgramacao.texto : ""],
      ["instrucao_programacao_contexto", instrucaoConsultaProgramacao],
      // S-INST-QUAL-01 (A8): caso misto — o Emprega+ ja vai num balao separado, montado pelo codigo.
      ["instrucao_emprega_mista", empregaMisto ? "INSTRUCAO: a parte desta mensagem sobre emprego, trabalho, estagio ou curriculo ja foi respondida pelo sistema com o contato do Emprega+, que vai numa mensagem separada logo depois da sua. Responda SO a outra parte da pergunta e NAO use [[ENCAMINHAR:empregabilidade]]." : ""],
      ["instrucao_pergunta_geral", perguntaGeralAtiva ? "INSTRUCAO CRITICA: esta pergunta e sobre a rede CUCA inteira, sem unidade especifica. Para qualquer informacao de programacao (quais atividades existem, em quais unidades, dias, horarios, turmas), use EXCLUSIVAMENTE o bloco '--- PROGRAMACAO VIGENTE DA REDE ---' (se presente acima); o '--- CONTEXTO (FAQ) ---' serve so para assuntos que nao sao programacao. Se esse bloco NAO estiver presente ou nao trouxer a atividade perguntada, NUNCA componha ou invente uma lista de atividades, unidades, dias ou horarios: se a pessoa citou uma atividade, diga com suas proprias palavras que nao encontrou essa atividade na programacao deste mes; se a pergunta for geral (ex.: 'quais cursos tem?'), nao liste nada de cabeca. Nos dois casos, pergunte de qual unidade a pessoa quer saber para mostrar a programacao dela." : ""],
    ];
    const promptFinal = partesPrompt.map(([, texto]) => texto).filter(Boolean).join("\n\n");

    // TOM-04: o worker já captura e grava lead.nome (push_name do WhatsApp), mas esse dado
    // nunca chegava ao prompt do GPT. Aqui vai só o FATO, sem diretiva — a regra de como usar
    // fica no promptFinal (system) acima. lead.nome é o nome de exibição do WhatsApp,
    // controlado pelo próprio usuário; marcado explicitamente como contexto interno pra não
    // ser lido como fala do lead.
    const contextoNomeLead = {
      role: "user",
      content: "[CONTEXTO INTERNO — nao e mensagem do lead] NOME DO LEAD: " + sanitizarNomeLead(lead.nome),
    };

    // 11. GPT
    // PLANO-023: tamanho (caracteres) de cada bloco que foi no prompt — mesma fonte que gerou o texto.
    const blocosUso: Record<string, number> = {};
    for (const [nome, texto] of partesPrompt) if (nome !== "contexto_rag" && texto) blocosUso[nome] = (blocosUso[nome] ?? 0) + texto.length;
    for (const b of blocosContexto) blocosUso[b.nome] = (blocosUso[b.nome] ?? 0) + b.texto.length;
    blocosUso.historico = [contextoNomeLead, ...historico].reduce((n, m) => n + m.content.length, 0);
    const conversaIdUso = conversa?.id ?? null;
    const registrarConsumo = (corpo: RespostaOpenAIUso, latenciaMs: number) => {
      manterVivoAposResposta((async () => {
        const u = corpo.usage ?? {};
        const tokensPrompt = u.prompt_tokens ?? 0;
        const tokensCached = u.prompt_tokens_details?.cached_tokens ?? 0;
        const tokensCompletion = u.completion_tokens ?? 0;
        const modelo = corpo.model ?? GPT_MODEL;
        await registrarUsoLLM(supabase, {
          agente_tipo,
          feature: "chat",
          modelo,
          tokens_prompt: tokensPrompt,
          tokens_completion: tokensCompletion,
          tokens_prompt_cached: tokensCached,
          custo_usd: calcularCustoUsd(modelo, tokensPrompt, tokensCached, tokensCompletion, await carregarPrecosOpenAI(supabase)),
          conversa_id: conversaIdUso,
          latencia_ms: latenciaMs,
          prompt_versao: (prompt as { updated_at?: string | null }).updated_at ?? null,
          blocos_contexto: blocosUso,
          openai_request_id: corpo.id ?? null,
          camada_rag: logRAG.camada,
        });
      })());
    };
    const { texto: respostaGerada } = await chamarGPT(promptFinal, [contextoNomeLead, ...historico], openaiKey, prompt.temperatura, prompt.max_tokens, 0, registrarConsumo);
    let resposta = respostaGerada;
    let handover = false; let encerrado = false;
    const avaliacaoHandover = removerTag(resposta, "handover");
    if (avaliacaoHandover.encontrada) { handover = true; resposta = avaliacaoHandover.texto; }
    // S-INST-QUAL-06 (decisão do Junior, 14/11): no Institucional o atendente só entra por pedido
    // explícito da pessoa (que já transbordou lá em cima, com a checagem de horário). Falta de
    // informação não transborda nem oferece atendente: o modelo diz que não encontrou e o código
    // passa o contato da unidade. Vale também quando o modelo oferece atendente sem a tag.
    if (isAgenteProgramacao && (handover || removerOfertaDeAtendente(resposta).removida)) {
      if (handover) console.log("[motor-agente v18] [[HANDOVER]] do modelo sem pedido explicito: sem transbordo, contato da unidade");
      handover = false;
      resposta = respostaSemAtendente(resposta, await buscarTelefonesUnidades(supabase), unidadeEfetiva ?? null);
    }
    const avaliacaoEncerrar = removerTag(resposta, "encerrar");
    if (avaliacaoEncerrar.encontrada) { encerrado = true; resposta = avaliacaoEncerrar.texto; }

    // Backlog 4a: encaminhamento pra outro canal da Rede CUCA (Empregabilidade/Acesso CUCA/
    // Ouvidoria/Academia Enem) — fora do escopo do RAG do Institucional. Regra de segurança
    // inegociável: a resposta final é INTEIRAMENTE construída pelo código a partir do número
    // buscado em `configuracoes`, nunca a partir do texto que o GPT gerou — o GPT só sinaliza
    // a intenção via tag. Substitui `resposta` por completo quando a tag é válida (não
    // complementa o texto do GPT), fechando de vez a superfície de um número inventado
    // aparecer em qualquer lugar da mensagem.
    const avaliacaoEncaminhar = extrairTagComArgumento(resposta, "encaminhar");
    if (avaliacaoEncaminhar.encontrada) {
      const canal = validarCanalEncaminhamento(avaliacaoEncaminhar.argumento);
      if (canal === "empregabilidade" && empregaMisto && extras.balaoFinal) {
        // S-INST-QUAL-01 (A8): o Emprega+ ja vai no balao final; mantem so o texto do modelo. Se o
        // modelo respondeu so com a tag, o Emprega+ vira a resposta e o balao sai (sem duplicar).
        resposta = avaliacaoEncaminhar.texto;
        if (!resposta) { resposta = extras.balaoFinal.mensagem; extras.balaoFinal = null; }
      } else if (canal) {
        const numeroCanal = await buscarNumeroCanal(supabase, canal);
        const telefonesUnidades = canal === "acesso_cuca" && !numeroCanal ? await buscarTelefonesUnidades(supabase) : [];
        resposta = montarMensagemEncaminhamento(canal, numeroCanal, telefonesUnidades);
      } else {
        // Canal fora da lista fechada (GPT alucinou um valor) — remove só a tag mal-formada,
        // mantém o texto do GPT como resposta normal em vez de inventar um encaminhamento.
        resposta = avaliacaoEncaminhar.texto;
      }
    }

    // S-INST-QUAL-15 (achado 2): se o modelo não citou o que a unidade (ou a rede) tem no dia em outras
    // áreas, o código acrescenta a frase — só na resposta normal (sem transbordo, encerramento ou encaminhamento).
    if (outrasAtividadesDoDia && !handover && !encerrado && !avaliacaoEncaminhar.encontrada) {
      const comP2 = garantirOutrasAtividadesDoDia(resposta, outrasAtividadesDoDia);
      if (comP2 !== resposta) console.log("[motor-agente v18] P2 acrescentado pelo codigo (" + outrasAtividadesDoDia.onde + ", " + outrasAtividadesDoDia.dia + ")");
      resposta = comP2;
    }

    // GPT pode responder só com a tag, sem texto (ex.: "[[ENCERRAR]]"). resposta="" nesse ponto
    // vira None no worker (data.get("resposta") or None), que hoje interpreta None como falha
    // técnica e reenvia "tivemos um problema técnico" — mensagem errada para um encerramento/
    // handover legítimo. Garantir texto sempre não-vazio quando success=true.
    if (!resposta) {
      if (handover) resposta = "Vou te encaminhar para um atendente humano, só um momento!";
      else if (encerrado) resposta = "Tudo certo! Qualquer coisa, é só chamar novamente. 😊";
    }

    // 12. Item 2 (S-WM-22): divide em 2-3 partes se a resposta for longa/listável — SEMPRE
    // depois das tags acima (handover/encerrar/encaminhar já resolvidas, AC5). `mensagens`
    // tem sempre >=1 elemento; `resposta` continua igual ao texto único de sempre (join),
    // pra nenhum consumidor que só lê `resposta` quebrar.
    const mensagens = dividirRespostaEmPartes(resposta);
    resposta = mensagens.join("\n\n");

    // S-INST-QUAL-14 (V4): guarda a consulta que montou a lista de unidades, com o começo desta resposta
    // como marca, para o número do próximo turno ("2"). Qualquer outra resposta apaga a anterior.
    if (isAgenteProgramacao && unidade_cuca === "Geral") {
      const anterior = metadataAtual.prog_ultima_consulta ?? null;
      const nova = consultaComListaDeUnidades && !handover && !encerrado ? { ...consultaComListaDeUnidades, marca: marcaDaResposta(resposta) } : null;
      if (nova || anterior) {
        metadataAtual = { ...metadataAtual, prog_ultima_consulta: nova };
        await supabase.rpc("merge_conversa_metadata", { p_conversa_id: conversa!.id, p_patch: metadataAtual as unknown as Database["public"]["Functions"]["merge_conversa_metadata"]["Args"]["p_patch"] });
      }
    }

    // 13. Salvar — 1 linha por parte efetivamente gerada, preservando a ordem. Sem isso, o
    // histórico lido no próximo turno (Passo 4, linha ~645) ficaria com 1 linha concatenada
    // em vez de refletir exatamente o que foi (ou vai ser) enviado turno por turno.
    // S-WM-47 (PERF-03): Sequencial de propósito: a ordem das partes (abertura/lista/fechamento)
    // precisa bater com created_at na leitura de histórico (linha ~1123) — um Promise.all aqui
    // arriscaria embaralhar a ordem lógica. Não há coluna de sequência explícita em `mensagens`
    // (confirmado em supabase/migrations/, 2026-07-18) que garantisse ordem determinística num
    // insert em lote. Custo aceito: até 2 round-trips extras por resposta dividida (máx. 3
    // partes, dividirRespostaEmPartes). Ver docs/stories/S-WM-47-*.md para o raciocínio completo.
    for (const parte of mensagens) {
      await salvarMensagemAgente(supabase, conversa.id, lead.id, parte);
    }
    if (handover) {
      const { error: handoverError } = await supabase.from("conversas").update({ status: "awaiting_human", updated_at: new Date().toISOString() }).eq("id", conversa.id);
      if (handoverError) {
        console.error("[motor-agente v18] Falha ao marcar conversa como awaiting_human conversa_id=" + conversa.id + " agente_tipo=" + agente_tipo + " erro=" + handoverError.message);
      }
    } else if (encerrado) await supabase.from("conversas").update({ status: "encerrada", updated_at: new Date().toISOString() }).eq("id", conversa.id);

    return new Response(JSON.stringify({ success: true, agente_usado: agente_tipo, handover, encerrado, resposta, mensagens }), { headers: { "Content-Type": "application/json" } });

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[motor-agente v18]", errMsg);
    return new Response(JSON.stringify({ error: "Erro interno" }), { status: 500 });
  }
}
