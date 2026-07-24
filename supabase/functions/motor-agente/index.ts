import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import type { Database } from "./database.types.ts";

const GPT_MODEL = "gpt-4o";
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

export const MENU_UNIDADES = "Sobre qual unidade CUCA voc\u00ea quer saber? \ud83d\ude0a\n\n1\ufe0f\u20e3 Barra\n2\ufe0f\u20e3 Jangurussu\n3\ufe0f\u20e3 Mondubim\n4\ufe0f\u20e3 Pici\n5\ufe0f\u20e3 Jos\u00e9 Walter";

export function ehSelecaoMenu(texto: string): boolean {
  return /^[1-5]$/.test(texto.trim());
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
    semNumero:
      "Entendi! Pra reservar espaços do CUCA (salas, quadras, auditório etc.), quem cuida disso é o time de Acesso CUCA — em breve te passo o contato certinho aqui — já estamos organizando esse canal!",
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
export function montarMensagemEncaminhamento(canal: CanalEncaminhamento, numero: string | null): string {
  const mensagens = MENSAGENS_CANAL[canal];
  const numeroLimpo = numero ? numero.replace(/\D/g, "") : "";
  if (!numeroLimpo) return mensagens.semNumero;
  return mensagens.comNumero(numeroLimpo);
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
  return /\bunidade\b/.test(lower) || /\btrocar\b|\btroca\b|\bmudar\b/.test(lower) || /\boutra\s+cuca\b|\boutro\s+cuca\b/.test(lower);
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
  const regex = /Modalidade:\s*([^-]+?)\s*-\s*Turma/g;
  for (const conteudo of chunks) {
    for (const match of conteudo.matchAll(regex)) {
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
export function detectarAtividadeMencionada(mensagem: string, modalidades: string[]): string | null {
  const msgNorm = normalizarTexto(mensagem);
  const ordenadas = [...modalidades].sort((a, b) => b.length - a.length);
  for (const modalidade of ordenadas) {
    if (msgNorm.includes(normalizarTexto(modalidade))) return modalidade;
  }
  return null;
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
  return false;
}

export function resolverAtividadeMencionadaComHistorico(
  mensagemAtual: string,
  atividadesConhecidas: string[],
  historico: { role: string; content: string }[] = [],
): { atividade: string | null; origem: "mensagem_atual" | "historico" | null } {
  const atividadeAtual = detectarAtividadeMencionada(mensagemAtual, atividadesConhecidas);
  if (atividadeAtual) return { atividade: atividadeAtual, origem: "mensagem_atual" };
  if (!mensagemPareceContinuacaoDeAtividade(mensagemAtual)) return { atividade: null, origem: null };

  const encontradas = new Map<string, string>();
  const mensagensUsuarioRecentes = [...historico]
    .reverse()
    .filter((m) => m.role === "user" && m.content.trim() !== "" && m.content.trim() !== mensagemAtual.trim())
    .slice(0, 5);

  for (const msg of mensagensUsuarioRecentes) {
    const atividade = detectarAtividadeMencionada(msg.content, atividadesConhecidas);
    if (atividade) encontradas.set(normalizarTexto(atividade), atividade);
  }

  if (encontradas.size === 1) return { atividade: [...encontradas.values()][0], origem: "historico" };
  return { atividade: null, origem: null };
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
  const vagas = campo(meta.vagas);
  const sexo = campo(meta.sexo);
  const diasSemana = campo(meta.dias_semana);
  const horario = campo(meta.horario);
  const faixaEtariaBruta = meta.faixa_etaria;
  const faixaEtaria = typeof faixaEtariaBruta === "string" && faixaEtariaBruta.trim() !== "" && normalizarTexto(faixaEtariaBruta) !== normalizarTexto(titulo)
    ? faixaEtariaBruta
    : "nao informado";
  const prefixo = normalizarTexto(categoria) === "esportes" ? "Esporte Modalidade" : "Categoria " + categoria + " - Atividade";
  return prefixo + ": " + titulo + " - Turma " + turma + ". Professor: " + professor + ". Vagas: " + vagas + ". Publico: " + sexo + " (Idade: " + faixaEtaria + "). Dias: " + diasSemana + ". Horario: " + horario + ".";
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
  "1. USE APENAS dados do bloco '--- PROGRAMACAO MENSAL ATUAL ---' ou '--- CONTEXTO ---'.",
  "   NUNCA invente atividades, horarios, nomes de professores ou modalidades.",
  "   Exemplo do que NAO fazer: se o contexto nao trouxer o nome do professor de uma",
  "   modalidade, NUNCA gere um nome plausivel (ex.: 'Joao Silva') so para parecer",
  "   completo. Nesse caso, siga a regra 2 abaixo (diga que nao encontrou).",
  "",
  "2. Se a informacao nao estiver no contexto, diga com suas proprias palavras e no seu",
  "   tom que nao encontrou essa informacao na programacao atual e sugira falar com a",
  "   unidade. Nunca invente um dado que nao esteja no contexto.",
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
  "",
  "7. NUNCA invente proximidade geografica, distancia ou tempo de deslocamento entre um bairro",
  "   e uma unidade CUCA. Isso inclui responder qual unidade e 'mais perto' ou 'mais proxima' de",
  "   um bairro/endereco informado pelo usuario. So afirme isso se o CONTEXTO trouxer, de forma",
  "   explicita, dado real de bairro/endereco/distancia das unidades. Sem esse dado no contexto,",
  "   diga com suas proprias palavras que nao tem essa informacao pra comparar e sugira que a",
  "   pessoa informe qual unidade prefere, ou confirme a distancia direto com a unidade.",
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

export async function avaliarSelecaoUnidade(texto: string, openaiKey: string, historico: { role: string; content: string }[] = [], tentativa = 0): Promise<AvaliacaoSelecaoUnidade> {
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
      return avaliarSelecaoUnidade(texto, openaiKey, historico, tentativa + 1);
    }

    if (!resp.ok) return AVALIACAO_SELECAO_UNIDADE_DEFAULT;
    const body = await resp.json();
    const parsed = JSON.parse(body.choices[0].message.content);
    return validarAvaliacaoSelecaoUnidade(parsed);
  } catch (exc) {
    console.error("[motor-agente v18] avaliarSelecaoUnidade erro, fallback seguro:", exc);
    return AVALIACAO_SELECAO_UNIDADE_DEFAULT;
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
  if (!avaliacaoSemantica.pergunta_geral) {
    // VAL-19 (S-WM-50): sem esta checagem, cortesia pura ("tudo bem?", pergunta_geral=false) caía
    // no mesmo catch-all abaixo que uma pergunta_geral=true real — gastava uma chamada de GPT
    // (resumo_rede + FAQ carregados no prompt) à toa. Mesmo padrão/mesmo texto que
    // decidirAguardandoUnidade já usa pra esse caso (linha 658-663) — tom de continuação, nunca
    // SAUDACOES_ABERTURA aqui (a conversa já está engajada).
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
export function detectarUnidadeDireta(texto: string): string | undefined {
  const msgLower = texto.toLowerCase().trim();
  return Object.entries(UNIDADES_MAP).find(([k]) => contemPalavra(msgLower, k))?.[1];
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
    return { unidadeSelecionada: null, aguardandoUnidade: false, resposta: saudacao + "\n\nEm que posso te ajudar? 😊" };
  }
  // Backlog 4b / Item 1: pedido que depende de unidade (ex.: "quais cursos vocês têm"), sem
  // dizer qual — aí sim mostra o menu, comportamento já existente preservado. NÃO mexe no
  // branch de unidadeDetectadaDireta acima, que já cai no fluxo de GPT (que já combina saudação
  // e menu sozinho, ver prompt_sistema "PRIMEIRA INTERAÇÃO").
  return { unidadeSelecionada: null, aguardandoUnidade: true, resposta: saudacao + "\n\n" + MENU_UNIDADES };
}

async function getOpenAIKey(supabase: ReturnType<typeof createClient<Database>>): Promise<string> {
  const { data } = await supabase.rpc("get_openai_key");
  return data || Deno.env.get("OPENAI_API_KEY") || "";
}

export async function gerarEmbedding(texto: string, apiKey: string, tentativa = 0): Promise<number[]> {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST", headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texto.slice(0, 8000) }),
  });

  if (deveTentarNovamente(resp.status, tentativa)) {
    const corpoErro = await resp.text();
    const esperaSegundos = Math.min(parseRetryAfterSegundos(resp.headers.get("retry-after"), corpoErro), GPT_ESPERA_MAX_SEGUNDOS);
    console.log("[motor-agente v18] Rate limit OpenAI/embeddings (tentativa " + (tentativa + 1) + "/" + GPT_MAX_TENTATIVAS + "), aguardando " + esperaSegundos + "s antes de tentar de novo");
    await new Promise((resolve) => setTimeout(resolve, esperaSegundos * 1000));
    return gerarEmbedding(texto, apiKey, tentativa + 1);
  }

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
 * AUD-13: retry com backoff cobre 429 (rate limit) E os erros 5xx transitórios mais comuns da
 * OpenAI (500/502/503) — antes só 429 era tratado, e um 503 em pico de carga virava "problema
 * técnico" imediato pro lead sem nenhuma tentativa de repetição.
 */
export function deveTentarNovamente(status: number, tentativa: number): boolean {
  const statusTransitorio = status === 429 || status === 500 || status === 502 || status === 503;
  return statusTransitorio && tentativa < GPT_MAX_TENTATIVAS;
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

async function salvarMensagemAgente(supabase: ReturnType<typeof createClient<Database>>, conversa_id: string, lead_id: string, conteudo: string) {
  await supabase.from("mensagens").insert({ conversa_id, lead_id, tipo: "text", conteudo, remetente: "agente" });
}

/**
 * Item 2 (S-WM-22, TOM-03b): reconhece uma linha no formato compacto que a regra 6 de
 * `INSTRUCAO_SEGURANCA` já exige do GPT ao listar modalidades/cursos — "Nome - Dias" (ex.:
 * "Natacao - Ter/Qui/Sex"). Não é um formato novo inventado por esta story, é o formato que o
 * guardrail já pede; esta função só detecta se o GPT seguiu a regra.
 */
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
function formatarChunks(chunks: { conteudo: string; fonte_tipo?: string }[]): string {
  return chunks.map((c) => c.fonte_tipo ? "[" + c.fonte_tipo + "] " + c.conteudo : c.conteudo).join("\n");
}

/**
 * Carrega todos os chunks do monthly_program ativo para uma unidade diretamente (sem embedding).
 * Sem `.limit()` — o teto fixo de 40 truncava a visão geral completa das 5 unidades (todas já
 * ultrapassam 40 chunks hoje: José Walter/Pici em 55, Jangurussu/Mondubim em 47, Barra em 42).
 * Removido sem substituir por outro número fixo: qualquer chute (80, 100...) sofre do mesmo
 * problema — não há tendência estável de quantas atividades um mês vai ter (varia 89-146 nas 5
 * unidades, sem teto prático). Seguro sem limite: `gpt-4o` (GPT_MODEL) tem janela de 128k
 * tokens; o pior caso real hoje (~64k caracteres somando prompt_sistema + guardrail +
 * prompt_contexto + este documento + histórico) fica em ~16k tokens — folga de >100k tokens
 * antes de qualquer risco de estourar o contexto, mesmo com o dado crescendo várias vezes o
 * teto já observado.
 * IMPORTANTE: remover o limite sozinho não corrige o bug de rótulo trocado (VAL-09, José
 * Walter) documentado em S-WM-35 — é complementar, não substituto. Sem o fix do rótulo, mais
 * dado chega ao prompt, mas o dado errado (idade lida como horário etc.) continua errado.
 */
async function carregarProgramacaoMensal(supabase: ReturnType<typeof createClient<Database>>, unidade: string): Promise<string> {
  const { data: doc } = await supabase.from("documentos_rag").select("id").eq("tipo", "monthly_program").eq("unidade_cuca", unidade).eq("ativo", true).order("created_at", { ascending: false }).limit(1).single();
  if (!doc) return "";
  const { data: chunks } = await supabase.from("chunks_documentos").select("conteudo").eq("documento_id", doc.id).order("chunk_index", { ascending: true });
  if (!chunks || chunks.length === 0) return "";
  console.log("[motor-agente v18] Chunks diretos monthly_program: " + chunks.length + " para " + unidade);
  if (chunks.length > CHUNKS_MONTHLY_PROGRAM_LIMITE_ALERTA) {
    console.warn("[motor-agente v18] ALERTA: monthly_program de " + unidade + " tem " + chunks.length + " chunks (> " + CHUNKS_MONTHLY_PROGRAM_LIMITE_ALERTA + ") — checar se não é import duplicado/corrompido antes de assumir que é só crescimento normal.");
  }
  return chunks.map((c: { conteudo: string }) => c.conteudo).join("\n");
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
async function buscarAtividadeEspecifica(supabase: ReturnType<typeof createClient<Database>>, unidade: string, mensagem: string, historico: { role: string; content: string }[] = []): Promise<string | null> {
  const { data } = await supabase.from("documentos_rag").select("id").eq("tipo", "monthly_program").eq("unidade_cuca", unidade).eq("ativo", true).order("created_at", { ascending: false }).limit(1).single();
  const doc = data as { id: string } | null;
  if (!doc) return null;
  const { data: chunks } = await supabase.from("chunks_documentos").select("conteudo").eq("documento_id", doc.id).order("chunk_index", { ascending: true });
  if (!chunks || chunks.length === 0) return null;

  const conteudos = chunks.map((c: { conteudo: string }) => c.conteudo);
  const modalidades = extrairModalidades(conteudos);
  const resolucao = resolverAtividadeMencionadaComHistorico(mensagem, modalidades, historico);
  const atividade = resolucao.atividade;
  if (!atividade) return null;

  const atividadeNorm = normalizarTexto(atividade);
  const relevantes = conteudos.filter((c) => normalizarTexto(c).includes(atividadeNorm));
  if (relevantes.length === 0) return null;

  console.log("[motor-agente v18] Busca deterministica de atividade: \"" + atividade + "\" (" + relevantes.length + " chunks, unidade=" + unidade + ", origem=" + resolucao.origem + ")");
  return relevantes.join("\n");
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
async function buscarAtividadeDeterministica(supabase: ReturnType<typeof createClient<Database>>, unidade: string, mensagem: string, historico: { role: string; content: string }[] = []): Promise<string | null> {
  const { data } = await supabase.from("documentos_rag").select("id, metadados").eq("tipo", "monthly_program").eq("unidade_cuca", unidade).eq("ativo", true).order("created_at", { ascending: false }).limit(1).single();
  const doc = data as { id: string; metadados: Record<string, unknown> | null } | null;
  if (!doc) return null;

  const campanhaId = doc.metadados && typeof doc.metadados === "object" ? doc.metadados["campanha_id"] : null;
  if (typeof campanhaId !== "string" || !campanhaId) return null;

  const { data: atividades } = await supabase.from("atividades_mensais").select("titulo, categoria, metadata").eq("campanha_id", campanhaId);
  const linhas = atividades as { titulo: string; categoria?: string | null; metadata: Record<string, unknown> | null }[] | null;
  if (!linhas || linhas.length === 0) return null;

  const titulosDistintos = [...new Set(linhas.map((l) => l.titulo).filter((t): t is string => typeof t === "string" && t.trim() !== ""))];
  const resolucao = resolverAtividadeMencionadaComHistorico(mensagem, titulosDistintos, historico);
  const atividade = resolucao.atividade;
  if (!atividade) return null;

  const atividadeNorm = normalizarTexto(atividade);
  const linhasRelevantes = linhas.filter((l) => typeof l.titulo === "string" && normalizarTexto(l.titulo) === atividadeNorm);
  if (linhasRelevantes.length === 0) return null;

  console.log("[motor-agente v18] Busca deterministica (metadata) de atividade: \"" + atividade + "\" (" + linhasRelevantes.length + " turmas, unidade=" + unidade + ", origem=" + resolucao.origem + ")");
  return linhasRelevantes.map((l) => formatarLinhaAtividadeDeterministica(l.titulo, l.metadata, l.categoria || "nao informado")).join("\n");
}

/**
 * S-WM-32 (Escopo item 2/5): carrega o `resumo_rede` ativo por INTEIRO, direto de
 * `documentos_rag.conteudo` — nunca via `chunks_documentos`/`buscar_chunks_similares`
 * (`resumo_rede` nunca é chunkeado nem embeddado, ver migration
 * `20260713200000_swm32_resumo_rede_skip_indexacao.sql`). `unidade_cuca=null` por definição
 * (é um índice de rede inteira, não de 1 unidade) — não recebe parâmetro de unidade.
 * Retorna "" quando ainda não existe nenhum `resumo_rede` ativo (ex.: antes da 1ª geração via
 * botão do portal) — o caller trata isso como "sem dado consolidado", nunca como erro.
 */
async function carregarResumoRede(supabase: ReturnType<typeof createClient<Database>>): Promise<string> {
  const { data: doc } = await supabase.from("documentos_rag").select("conteudo").eq("tipo", "resumo_rede").eq("ativo", true).order("created_at", { ascending: false }).limit(1).single();
  return doc?.conteudo || "";
}

/**
 * S-WM-51: carrega o documento de servicos institucionais ("servicos_rede") ativo por INTEIRO,
 * mesmo padrão de `carregarResumoRede` acima — nunca via `chunks_documentos`/
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
export async function handler(req: Request, supabaseOverride?: ReturnType<typeof createClient<Database>>): Promise<Response> {
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

    const textoFinal = mensagem || "";
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
      supabase.from("mensagens").select("conteudo,remetente").eq("conversa_id", conversa.id).order("created_at", { ascending: false }).limit(MAX_HISTORICO),
      supabase.from("prompts_agentes").select("prompt_sistema,prompt_contexto,temperatura,max_tokens,menu_boas_vindas").eq("agente_tipo", agente_tipo).eq("ativo", true).single(),
    ]);
    const historico = (hist || []).reverse().map((m: { conteudo: string; remetente: string }) => ({ role: m.remetente === "lead" ? "user" : "assistant", content: m.conteudo || "" }));
    if (!prompt) throw new Error("Prompt nao encontrado para: " + agente_tipo);

    const isSofia = agente_tipo === "sofia" || agente_tipo === "sofia_global" || agente_tipo === "sofia_unidade";
    if (conversaJustCreated && isSofia && prompt.menu_boas_vindas) {
      await salvarMensagemAgente(supabase, conversa.id, lead.id, prompt.menu_boas_vindas);
      return new Response(JSON.stringify({ success: true, agente_usado: agente_tipo, handover: false, resposta: prompt.menu_boas_vindas, menu_boas_vindas: true }), { headers: { "Content-Type": "application/json" } });
    }

    // 5b. Seleção / troca de unidade (instância Geral)
    let unidadeEfetiva = unidade_cuca;
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
    let metadataAtual: Record<string, unknown> = conversa?.metadata || {};

    if (unidade_cuca === 'Geral') {
      const unidadeSalva = metadataAtual.unidade_selecionada as string | undefined;
      const aguardando = metadataAtual.aguardando_unidade as boolean | undefined;

      if (unidadeSalva) {
        const novaUnidade = detectarTrocaUnidade(textoFinal, unidadeSalva);
        if (novaUnidade) {
          metadataAtual = { ...metadataAtual, unidade_selecionada: novaUnidade, aguardando_unidade: false };
          await supabase.from('conversas').update({ metadata: metadataAtual }).eq('id', conversa.id);
          unidadeEfetiva = novaUnidade;
          trocouUnidade = true;
          // S-WM-34 (VAL-23, Task 3): este é o caminho reproduzido ao vivo — detectarTrocaUnidade
          // é match direto de nome, sem avaliação semântica (nunca chama avaliarSelecaoUnidade),
          // por isso usa o sinal equivalente (heurística "?", ver mensagemTemPedidoEspecifico).
          trocaComPedidoEspecifico = mensagemTemPedidoEspecifico(textoFinal);
          console.log("[motor-agente v18] Troca de unidade: " + unidadeSalva + " -> " + novaUnidade);
        } else if (pareceIntencaoTrocaUnidade(textoFinal)) {
          // Item 4 (S-WM-21, VAL-06): detectarTrocaUnidade (match exato/typo) não achou nada,
          // mas a mensagem sugere intenção de trocar ("unidade", "trocar", "mudar" etc.) — só
          // AQUI vale a chamada semântica (avaliarSelecaoUnidade), pra não pagar uma chamada
          // extra de LLM em toda mensagem de acompanhamento comum de uma conversa já em
          // andamento (a maioria delas não menciona nada sobre trocar de unidade).
          const avaliacaoTroca = await avaliarSelecaoUnidade(textoFinal, openaiKey, historico);
          if (avaliacaoTroca.unidade && avaliacaoTroca.unidade !== unidadeSalva) {
            metadataAtual = { ...metadataAtual, unidade_selecionada: avaliacaoTroca.unidade, aguardando_unidade: false };
            await supabase.from('conversas').update({ metadata: metadataAtual }).eq('id', conversa.id);
            unidadeEfetiva = avaliacaoTroca.unidade;
            trocouUnidade = true;
            // S-WM-34 (VAL-23): este caminho JÁ chama avaliarSelecaoUnidade — reaproveita
            // pedido_depende_unidade direto, mesmo achado/mesma correção dos outros 3 pontos de
            // entrada que usam essa função (não estava no escopo original da story, mas é a
            // mesma classe de bug: trocouUnidade=true aqui também dispara "resumo geral" hoje).
            trocaComPedidoEspecifico = avaliacaoTroca.pedido_depende_unidade === true;
            console.log("[motor-agente v18] Troca de unidade (semantica): " + unidadeSalva + " -> " + avaliacaoTroca.unidade);
          } else if (avaliacaoTroca.mudou_de_assunto && !avaliacaoTroca.pergunta_geral && !avaliacaoTroca.quer_sair) {
            // Ambiguidade real: o sinal semântico indica que o lead mudou de assunto (não é
            // cortesia, nem pergunta geral, nem despedida) mas não deu pra identificar qual
            // unidade — pergunta em vez de continuar respondendo pela unidade antiga em
            // silêncio. Qualquer falha técnica da chamada (rate limit esgotado, JSON inválido,
            // erro de rede) cai no fallback seguro (mudou_de_assunto=false) e NÃO entra aqui —
            // mantém a unidade atual, mesmo comportamento de hoje pra erros transitórios.
            const respostaAmbiguidade = evitarRepeticaoLiteral("Só pra confirmar: você quer saber sobre outra unidade CUCA? Me diz qual! 😊\n\n" + MENU_UNIDADES, historico);
            await salvarMensagemAgente(supabase, conversa.id, lead.id, respostaAmbiguidade);
            return new Response(JSON.stringify({ success: true, resposta: respostaAmbiguidade, handover: false }), { headers: { "Content-Type": "application/json" } });
          } else {
            unidadeEfetiva = unidadeSalva;
          }
        } else {
          unidadeEfetiva = unidadeSalva;
        }
      } else if (aguardando) {
        const unidadeDetectadaDireta = detectarUnidadeDireta(textoFinal);
        let avaliacaoSemantica: AvaliacaoSelecaoUnidade = AVALIACAO_SELECAO_UNIDADE_DEFAULT;

        if (!unidadeDetectadaDireta) {
          avaliacaoSemantica = await avaliarSelecaoUnidade(textoFinal, openaiKey, historico);
        }

        const decisao = decidirAguardandoUnidade(unidadeDetectadaDireta, avaliacaoSemantica, textoFinal);

        if (decisao.unidadeSelecionada) {
          metadataAtual = { ...metadataAtual, unidade_selecionada: decisao.unidadeSelecionada, aguardando_unidade: decisao.aguardandoUnidade };
          await supabase.from('conversas').update({ metadata: metadataAtual }).eq('id', conversa.id);
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
          await supabase.from('conversas').update({ metadata: metadataAtual }).eq('id', conversa.id);
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
            aguardando_unidade: decisao.aguardandoUnidade,
            ...(decisao.aguardandoUnidade ? {} : { conversa_engajada: true }),
          };
          await supabase.from('conversas').update({ metadata: metadataAtual }).eq('id', conversa.id);
          await salvarMensagemAgente(supabase, conversa.id, lead.id, respostaFinal);
          return new Response(JSON.stringify({ success: true, resposta: respostaFinal, handover: false }), { headers: { "Content-Type": "application/json" } });
        } else {
          // VAL-12: pergunta_geral=true — nem unidade escolhida, nem resposta canned. Grava
          // aguardando_unidade=false e segue pro fluxo normal (Passo 6 responde de verdade).
          // Ampliação (S-WM-31): também marca conversa_engajada=true, mesmo motivo do branch acima.
          metadataAtual = { ...metadataAtual, aguardando_unidade: decisao.aguardandoUnidade, conversa_engajada: true };
          await supabase.from('conversas').update({ metadata: metadataAtual }).eq('id', conversa.id);
          perguntaGeralAtiva = true;
          console.log("[motor-agente v18] Pergunta geral identificada (aguardando_unidade): segue pro RAG geral (FAQ isolado)");
        }
      } else if (metadataAtual.conversa_engajada === true) {
        // S-WM-31 (item 6 do Escopo): 3º branch — conversa já engajada (passou por cortesia ou
        // pergunta_geral antes), sem unidade_selecionada nem aguardando_unidade pendentes.
        // Reavalia com a MESMA detecção usada nos outros branches, sem repetir saudação.
        const unidadeDetectadaDiretaEngajada = detectarUnidadeDireta(textoFinal);
        let avaliacaoSemanticaEngajada: AvaliacaoSelecaoUnidade = AVALIACAO_SELECAO_UNIDADE_DEFAULT;

        if (!unidadeDetectadaDiretaEngajada) {
          avaliacaoSemanticaEngajada = await avaliarSelecaoUnidade(textoFinal, openaiKey, historico);
        }

        const decisaoEngajada = decidirConversaEngajada(unidadeDetectadaDiretaEngajada, avaliacaoSemanticaEngajada, textoFinal);

        if (decisaoEngajada.unidadeSelecionada) {
          metadataAtual = { ...metadataAtual, unidade_selecionada: decisaoEngajada.unidadeSelecionada, aguardando_unidade: false };
          await supabase.from('conversas').update({ metadata: metadataAtual }).eq('id', conversa.id);
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
          await supabase.from('conversas').update({ metadata: metadataAtual }).eq('id', conversa.id);
          console.log("[motor-agente v18] Disparo recente não reconhecido (conversa engajada) — ignora resposta canned, segue pro GPT");
        } else if (decisaoEngajada.resposta !== null) {
          const respostaFinal = evitarRepeticaoLiteral(decisaoEngajada.resposta, historico);
          metadataAtual = { ...metadataAtual, aguardando_unidade: decisaoEngajada.aguardandoUnidade };
          await supabase.from('conversas').update({ metadata: metadataAtual }).eq('id', conversa.id);
          await salvarMensagemAgente(supabase, conversa.id, lead.id, respostaFinal);
          return new Response(JSON.stringify({ success: true, resposta: respostaFinal, handover: false }), { headers: { "Content-Type": "application/json" } });
        } else {
          perguntaGeralAtiva = true;
          console.log("[motor-agente v18] Pergunta geral identificada (conversa engajada): segue pro RAG geral (FAQ isolado)");
        }
      } else {
        const unidadeDetectadaDireta1a = detectarUnidadeDireta(textoFinal);
        let avaliacaoSemantica1a: AvaliacaoSelecaoUnidade = AVALIACAO_SELECAO_UNIDADE_DEFAULT;

        if (!unidadeDetectadaDireta1a) {
          avaliacaoSemantica1a = await avaliarSelecaoUnidade(textoFinal, openaiKey, historico);
        }

        const decisaoPrimeira = decidirPrimeiraMensagem(unidadeDetectadaDireta1a, avaliacaoSemantica1a, textoFinal);
        if (decisaoPrimeira.unidadeSelecionada) {
          // AUD-07: unidade já citada na própria 1ª mensagem — resolve direto e segue pro
          // fluxo normal (RAG/GPT) em vez de mandar o menu e forçar uma rodada extra.
          metadataAtual = { ...metadataAtual, unidade_selecionada: decisaoPrimeira.unidadeSelecionada, aguardando_unidade: decisaoPrimeira.aguardandoUnidade };
          await supabase.from('conversas').update({ metadata: metadataAtual }).eq('id', conversa.id);
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
          await supabase.from('conversas').update({ metadata: metadataAtual }).eq('id', conversa.id);
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
            aguardando_unidade: decisaoPrimeira.aguardandoUnidade,
            ...(decisaoPrimeira.aguardandoUnidade ? {} : { conversa_engajada: true }),
          };
          await supabase.from('conversas').update({ metadata: metadataAtual }).eq('id', conversa.id);
          await salvarMensagemAgente(supabase, conversa.id, lead.id, respostaFinal);
          return new Response(JSON.stringify({ success: true, resposta: respostaFinal, handover: false }), { headers: { "Content-Type": "application/json" } });
        } else {
          // VAL-12: pergunta_geral=true já na 1ª mensagem — segue pro fluxo normal (Passo 6).
          // Item 6: também marca conversa_engajada=true, mesmo motivo do branch acima.
          metadataAtual = { ...metadataAtual, aguardando_unidade: decisaoPrimeira.aguardandoUnidade, conversa_engajada: true };
          await supabase.from('conversas').update({ metadata: metadataAtual }).eq('id', conversa.id);
          perguntaGeralAtiva = true;
          console.log("[motor-agente v18] Pergunta geral identificada (1a mensagem): segue pro RAG geral (FAQ isolado)");
        }
      }
    }

    // 6. Contexto RAG
    let contextRAG = "";
    const temUnidadeDefinida = unidadeEfetiva && unidadeEfetiva !== 'Geral';
    const isAgenteProgramacao = agente_tipo === 'Institucional' || agente_tipo === 'maria';
    // S-WM-51: gateado em isAgenteProgramacao (não literal 'Institucional') por consistência com
    // todos os outros gates deste Passo 6 — 'maria' não tem número WhatsApp ativo hoje
    // (meta_phone_numbers só tem 'Institucional' e 'Empregabilidade'), então a diferença é um
    // no-op no tráfego real. Carregado 1x, ANTES da cadeia if/else abaixo, porque é pequeno
    // (algumas linhas — padrão comum + exceções por unidade) e relevante com ou sem unidade
    // conhecida, ao contrário de monthly_program/resumo_rede que são mutuamente exclusivos entre
    // si. Cada branch da cadeia abaixo inicializa contextRAG com este valor (nunca "") antes de
    // somar seu próprio conteúdo — nenhum branch pode usar "contextRAG = ..." direto sem antes
    // passar por "contextRAG = contextServicos", senão sobrescreve este bloco em silêncio (a
    // primeira escrita de cada branch sempre foi atribuição, não concatenação).
    const servicosRedeConteudo = isAgenteProgramacao ? await carregarServicosRede(supabase) : "";
    const contextServicos = servicosRedeConteudo ? "\n\n--- SERVICOS DA REDE (comuns + excecoes por unidade) ---\n" + servicosRedeConteudo : "";
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
      const menuCategoriaAtivoNovo = Boolean(temUnidadeDefinida) && precisaVisaoGeral;
      if (menuCategoriaAtivoNovo !== menuCategoriaAtivoAnterior) {
        metadataAtual = { ...metadataAtual, menu_categoria_ativo: menuCategoriaAtivoNovo };
        await supabase.from('conversas').update({ metadata: metadataAtual }).eq('id', conversa.id);
      }
    }

    if (temUnidadeDefinida && isAgenteProgramacao && precisaVisaoGeral) {
      // S-WM-43 (PERF-02, Par 3): carregarProgramacaoMensal e gerarEmbedding não dependem de
      // dado um do outro (o embedding usa textoFinal, não conteudoPrograma) — paralelizados.
      // `buscarAtividadeDeterministica` (abaixo, condicional a trocaComPedidoEspecifico ||
      // trocouUnidade) foi deliberadamente deixado FORA deste Promise.all: é uma chamada
      // condicional (nem sempre roda) e a S-WM-35 a introduziu depois do plano original desta
      // story — incluí-la aumentaria a superfície de risco (mais uma chamada de rede concorrente
      // no mesmo trecho) para um ganho marginal, já que ela só dispara numa fração dos turnos.
      const [conteudoPrograma, embedding] = await Promise.all([
        carregarProgramacaoMensal(supabase, unidadeEfetiva),
        gerarEmbedding(textoFinal, openaiKey),
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
      contextRAG = contextServicos;
      if (conteudoPrograma) {
        contextRAG += "\n\n--- PROGRAMACAO MENSAL ATUAL (" + unidadeEfetiva + ") ---" + instrucaoArea + "\n" + conteudoPrograma;
      }

      // S-WM-35 (Frente C): quando a mensagem que causou a troca de unidade ja trazia um pedido
      // especifico junto (trocaComPedidoEspecifico), SOMA um bloco de dado exato
      // (atividades_mensais.metadata) ao resumo geral acima - nao substitui. O resumo geral
      // continua sendo a base da resposta (a bifurcacao de instrucao do S-WM-34, mais abaixo no
      // promptFinal, ja cuida de pedir uma resposta direta ao pedido quando esse bloco existe);
      // este bloco so garante que o dado exato da atividade pedida esta disponivel com certeza,
      // em vez de depender so do que sobrar nos ~40+ chunks do resumo geral.
      if (trocaComPedidoEspecifico || trocouUnidade) {
        const conteudoAtividadeEspecifica = await buscarAtividadeDeterministica(supabase, unidadeEfetiva as string, textoFinal, historico);
        if (conteudoAtividadeEspecifica) {
          contextRAG += "\n\n--- ATIVIDADE ESPECIFICA (dado exato) ---\n" + conteudoAtividadeEspecifica;
        }
      }

      // Complementa com eventos pontuais via busca vetorial (embedding já resolvido acima, no Promise.all do Par 3)
      const { data: chunksEventos } = await supabase.rpc("buscar_chunks_similares", {
        query_embedding: "[" + embedding.join(",") + "]",
        p_tipos: ["eventos_pontuais", "FAQ"],
        p_unidade_cuca: unidadeEfetiva,
        p_limite: 3,
      });
      if (chunksEventos && chunksEventos.length > 0) {
        contextRAG += "\n\n--- EVENTOS E FAQ ---\n" + formatarChunks(chunksEventos);
      }
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
      const conteudoAtividade = await buscarAtividadeDeterministica(supabase, unidadeEfetiva as string, textoFinal, historico)
        ?? await buscarAtividadeEspecifica(supabase, unidadeEfetiva as string, textoFinal, historico);
      // S-WM-51: mesma inicialização com contextServicos que o branch anterior — ver comentário
      // na declaração de contextServicos.
      contextRAG = contextServicos;
      if (conteudoAtividade) {
        contextRAG += "\n\n--- CONTEXTO (atividade especifica) ---\n" + conteudoAtividade;
      } else {
        const embedding = await gerarEmbedding(textoFinal, openaiKey);
        const { data: chunksPrograma } = await supabase.rpc("buscar_chunks_similares", {
          query_embedding: "[" + embedding.join(",") + "]",
          p_tipos: ["monthly_program", "eventos_pontuais", "FAQ"],
          p_unidade_cuca: unidadeEfetiva,
          p_limite: 5,
        });
        // VAL-02/VAL-04: quantos chunks a busca de acompanhamento realmente trouxe - sem isso,
        // "o GPT respondeu errado" e "a busca nao trouxe o chunk certo" eram indistinguiveis no log.
        console.log("[motor-agente v18] Busca vetorial acompanhamento: " + (chunksPrograma?.length ?? 0) + " chunks (unidade=" + unidadeEfetiva + ")");
        if (chunksPrograma && chunksPrograma.length > 0) {
          contextRAG += "\n\n--- CONTEXTO ---\n" + formatarChunks(chunksPrograma);
        }
      }
    } else if (isAgenteProgramacao && perguntaGeralAtiva) {
      // VAL-12: pergunta institucional real sem unidade escolhida ainda — busca só em FAQ.
      // documentos_rag confirma (produção, 2026-07-10): FAQ é 4/4 documentos sem unidade_cuca
      // (sempre geral), monthly_program é 5/5 SEMPRE atrelado a uma unidade — misturar tipos
      // aqui (como RAG_FONTES_POR_AGENTE faz) vazaria conteúdo de uma unidade aleatória (a mais
      // parecida por embedding) numa resposta que ainda não tem unidade definida.
      // S-WM-32 (Escopo item 5): também carrega o resumo_rede ativo por inteiro (carregamento
      // direto, nunca via buscar_chunks_similares — item 6 do Escopo, monthly_program/
      // eventos_pontuais continuam exigindo unidade exata, sem exceção) — cobre pergunta de
      // enumeração/agregação ("quais unidades têm X") que busca vetorial de FAQ isolado nunca
      // respondia com dado real, mesmo unificando os 3 pontos de entrada de perguntaGeralAtiva
      // (1ª mensagem, aguardando_unidade, conversa_engajada) sem precisar de 3ª classificação.
      const resumoRede = await carregarResumoRede(supabase);
      const embedding = await gerarEmbedding(textoFinal, openaiKey);
      const { data: chunksFaq } = await supabase.rpc("buscar_chunks_similares", {
        query_embedding: "[" + embedding.join(",") + "]",
        p_tipos: ["FAQ"],
        p_unidade_cuca: null,
        p_limite: 5,
      });
      console.log("[motor-agente v18] perguntaGeralAtiva: resumo_rede " + (resumoRede ? "carregado" : "ausente") + ", " + (chunksFaq?.length ?? 0) + " chunks FAQ");
      const blocosRede: string[] = [];
      if (resumoRede) blocosRede.push("--- RESUMO DA REDE (atividades por unidade) ---\n" + resumoRede);
      if (chunksFaq && chunksFaq.length > 0) {
        blocosRede.push("--- CONTEXTO (FAQ) ---\n" + formatarChunks(chunksFaq));
      }
      // S-WM-51: mesma inicialização com contextServicos dos outros 2 branches.
      contextRAG = contextServicos;
      if (blocosRede.length > 0) contextRAG += "\n\n" + blocosRede.join("\n\n");
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
        contextRAG = "\n\n--- CONTEXTO ---\n" + formatarChunks(chunks);
      }
    }

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
    const promptFinal = [
      prompt.prompt_sistema, DATA_ATUAL, INSTRUCAO_SEGURANCA,
      prompt.prompt_contexto || "", CONTEXTO_DISPARO, contextRAG,
      "UNIDADE: " + (unidadeEfetiva || "Nao informada"),
      // TOM-04: regra genérica, sem dado do usuário — o dado (nome) vai isolado no turno
      // "user" (contextoNomeLead), sem diretiva junto. Separar dado de instrução fecha a
      // superfície de prompt injection (lead.nome é controlado pelo próprio usuário) e mantém
      // a regra comportamental no prompt de sistema, onde é seguida de forma confiável — uma
      // instrução de moderação num turno "user" antecipado, longe do ponto de geração, é
      // seguida com muito menos confiabilidade.
      "Se o contexto informar o nome do lead, use-o com moderacao (1-2x, em momentos naturais da conversa).",
      // S-WM-34 (VAL-23): trocaComPedidoEspecifico bifurca a instrução — resumo geral (comportamento
      // atual preservado, AC4) quando a troca foi "pelada" (só o nome da unidade ou pedido vago);
      // resposta direta ao pedido (sem resumo geral) quando a mensagem que trocou de unidade já
      // trazia um pedido específico junto (AC3) — o contexto de programação já foi carregado de
      // qualquer forma (conteudoPrograma, acima), então a resposta direta tem o dado disponível.
      trocouUnidade && !trocaComPedidoEspecifico
        ? "INSTRUCAO: O cidadao acabou de trocar para esta unidade. Inicie com uma mensagem de transicao amigavel (ex: 'Claro! Vou te mostrar o que tem no [unidade] 😊') e apresente um resumo geral da programacao usando formato compacto."
        : "",
      trocouUnidade && trocaComPedidoEspecifico
        ? "INSTRUCAO: O cidadao acabou de trocar para esta unidade E ja fez um pedido especifico na mesma mensagem. Inicie com uma mensagem de transicao amigavel curta (ex: 'Claro! Vou verificar isso no [unidade] 😊') e responda DIRETAMENTE ao pedido especifico usando os dados disponiveis acima — programacao mensal e/ou o bloco '--- SERVICOS DA REDE (comuns + excecoes por unidade) ---' (se presente) — NAO apresente um resumo geral da programacao."
        : "",
      contextRAG.includes("ATIVIDADE ESPECIFICA") || contextRAG.includes("atividade especifica")
        ? "INSTRUCAO CRITICA: existe um bloco de atividade especifica com dado exato no contexto. Use esse bloco como fonte principal e liste TODAS as turmas/linhas compatíveis presentes nele. Nao resuma, nao escolha só algumas e nao omita opcoes. Preserve quando existir: categoria, titulo/modalidade, turma, professor/responsavel, dias, horario, vagas, sexo, faixa etaria/idade e local."
        : "",
      // VAL-07: para Institucional/maria, só dizer "primeira mensagem" quando for de fato
      // conversaGenuinamenteNova (não reabertura) — evita mandar essa instrução pro GPT numa
      // conversa retomada minutos depois. Outros agente_tipo (Sofia/Ouvidoria) continuam no
      // conversaJustCreated original, sem mudança — decisão sobre eles fica fora deste escopo.
      (isAgenteProgramacao ? conversaGenuinamenteNova : conversaJustCreated) ? "INSTRUCAO: Esta e a primeira mensagem. Combine saudacao e menu em uma unica resposta." : "",
      // Achado 2026-07-24: CONTEXTO_DISPARO (acima) era só um fato passivo no meio do prompt,
      // sem nenhuma diretiva de uso — diferente dos outros blocos deste array, que sempre vêm
      // com uma INSTRUCAO explícita dizendo como reagir. Gated no mesmo `ultimoDisparo` de
      // CONTEXTO_DISPARO (nunca aparece sem o fato correspondente). Não conflita com a INSTRUCAO
      // de "primeira mensagem" acima: `ultimo_disparo` só existe quando o worker já criou a linha
      // de `conversas` antes desta mensagem chegar (breadcrumb do disparo) — nesse caso
      // conversaGenuinamenteNova/conversaJustCreated já são false, então as duas nunca disparam
      // juntas pro mesmo turno.
      ultimoDisparo
        ? "INSTRUCAO: O lead recebeu recentemente o aviso institucional citado em ULTIMO DISPARO. Reconheca isso de forma natural e breve na resposta (ex: 'Vi que voce recebeu nosso aviso sobre...') antes de seguir com o resto — NAO trate esta mensagem como se fosse a primeira interacao da conversa, mesmo que pareca uma saudacao."
        : "",
      // S-WM-32 (AC8, achado de Junior em teste ao vivo): pergunta de rede inteira sem unidade
      // ja gerou alucinacao silenciosa antes desta story ("tem curso de natacao?" respondido com
      // uma lista de modalidades sem fonte real verificavel) — vale tanto enquanto o
      // resumo_rede ainda nao existe/nao foi gerado quanto depois, se o resumo_rede ativo nao
      // cobrir a atividade perguntada. Reforco condicional (so quando perguntaGeralAtiva=true),
      // nao generico em INSTRUCAO_SEGURANCA, pra nao confundir respostas de 1 unidade especifica.
      perguntaGeralAtiva ? "INSTRUCAO CRITICA: esta pergunta e sobre a rede CUCA inteira, sem unidade especifica. Use APENAS o bloco '--- RESUMO DA REDE ---' (se presente acima) e o '--- CONTEXTO (FAQ) ---' pra responder sobre quais unidades oferecem o que. Se a atividade perguntada NAO aparecer em nenhum desses blocos, NUNCA componha ou invente uma lista de atividades/modalidades — diga com suas proprias palavras que voce nao tem a programacao consolidada da rede toda pra essa pergunta especifica, e sugira ajudar escolhendo uma unidade." : "",
    ].filter(Boolean).join("\n\n");

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
    const { texto: respostaGerada } = await chamarGPT(promptFinal, [contextoNomeLead, ...historico], openaiKey, prompt.temperatura, prompt.max_tokens);
    let resposta = respostaGerada;
    let handover = false; let encerrado = false;
    const avaliacaoHandover = removerTag(resposta, "handover");
    if (avaliacaoHandover.encontrada) { handover = true; resposta = avaliacaoHandover.texto; }
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
      if (canal) {
        const numeroCanal = await buscarNumeroCanal(supabase, canal);
        resposta = montarMensagemEncaminhamento(canal, numeroCanal);
      } else {
        // Canal fora da lista fechada (GPT alucinou um valor) — remove só a tag mal-formada,
        // mantém o texto do GPT como resposta normal em vez de inventar um encaminhamento.
        resposta = avaliacaoEncaminhar.texto;
      }
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
    if (handover) await supabase.from("conversas").update({ status: "awaiting_human", updated_at: new Date().toISOString() }).eq("id", conversa.id);
    else if (encerrado) await supabase.from("conversas").update({ status: "encerrada", updated_at: new Date().toISOString() }).eq("id", conversa.id);

    return new Response(JSON.stringify({ success: true, agente_usado: agente_tipo, handover, encerrado, resposta, mensagens }), { headers: { "Content-Type": "application/json" } });

  } catch (error: unknown) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error("[motor-agente v18]", errMsg);
    return new Response(JSON.stringify({ error: "Erro interno" }), { status: 500 });
  }
}
