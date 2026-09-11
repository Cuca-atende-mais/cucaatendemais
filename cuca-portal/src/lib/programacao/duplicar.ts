/**
 * S-PROG-02: duplicação de mês anterior — converte uma linha já gravada (formato solto,
 * produzido em grande parte pelo import de planilha antigo) na `AtividadeForm` que a grade
 * (S-PROG-01) edita. NÃO é cópia crua: normaliza o que dá pra normalizar com segurança e deixa
 * em branco (nunca "chuta") o que não bate com um padrão conhecido — quem preenche revisa depois,
 * o painel de revisão (`revisao.ts`) já aponta os campos vazios.
 *
 * Os formatos abaixo vêm de consulta direta em produção (`svzkrkfzpiqcesloukgb`, 2026-09-09),
 * não são inventados — ver Dev Agent Record da story para as amostras reais que motivaram cada
 * regra (ex.: `dias_semana` livre — "Ter e Qui", "Ter a sex", "qui e ter" na MESMA campanha;
 * `periodo` de CURSOS como blob "dd/mm/aaaa\n\ndd/mm/aaaa\n\ntexto de dias"; `carga_horaria`
 * como "17h30min"/"17h/aula"; `vagas` como "20 por turma").
 */
import { AtividadeForm, Categoria, DIAS_SEMANA_ABREV, SESSOES_DIA_A_DIA, SEXOS, TEXTOS_DE_EXEMPLO } from "./tipos"
import { dataBrParaISO } from "./mascaras"

/** Categorias que a grade sabe editar — qualquer outra (ex.: "ESPORTE", singular, achado real na
 * campanha de junho/2026 do Jangurussu) marca a campanha inteira como não-duplicável (AC2). */
const CATEGORIAS_VALIDAS: readonly Categoria[] = ["ESPORTES", "CURSOS", "DIA A DIA", "ESPECIAIS"]

export function categoriaValida(valor: string | null | undefined): valor is Categoria {
  return !!valor && (CATEGORIAS_VALIDAS as readonly string[]).includes(valor)
}

function ehTextoDeExemplo(valor: string): boolean {
  return TEXTOS_DE_EXEMPLO.includes(valor.trim().toLowerCase())
}

/** trim + colapsa espaços duplos (pedido explícito da story) + remove texto de exemplo (vira "",
 * nunca copiado como se fosse dado real). Uso geral para todo campo de texto copiável. */
export function normalizarTextoCopiavel(valor: string | null | undefined): string {
  if (!valor) return ""
  const limpo = String(valor).trim().replace(/\s+/g, " ")
  return ehTextoDeExemplo(limpo) ? "" : limpo
}

/** Só copia se o valor já bate exatamente com a lista fechada correspondente — sexo, sessão.
 * Formato livre antigo que não bate (typo, variação de caixa não prevista) vem vazio: o painel
 * de revisão já aponta o campo vazio, e é melhor pedir pra reselecionar do que copiar errado. */
function valorSeNaLista<T extends string>(valor: string | null | undefined, lista: readonly T[]): string {
  const limpo = normalizarTextoCopiavel(valor)
  return (lista as readonly string[]).includes(limpo) ? limpo : ""
}

/**
 * "15 a 29 anos" -> { faixa_de: "15", faixa_ate: "29" }. "12+ anos" / "12+anos" -> só faixa_de
 * (sem máxima, é o "a partir de X anos" do item 2 da S-PROG-01). Aceita "a", "à" e "á" como
 * separador (as três formas apareceram em produção). Formato que não bate — incluindo lixo como
 * "15 a 29 e 29+" (achado real) — devolve tudo vazio: nunca adivinha idade.
 */
export function parseFaixaEtaria(valor: string | null | undefined): { faixa_de: string; faixa_ate: string } {
  const texto = normalizarTextoCopiavel(valor)
  if (!texto) return { faixa_de: "", faixa_ate: "" }

  const faixa = texto.match(/^(\d{1,3})\s*[aáà]\s*(\d{1,3})\+?\s*(anos?)?\+?\s*$/i)
  if (faixa) return { faixa_de: faixa[1], faixa_ate: faixa[2] }

  const aberta = texto.match(/^(\d{1,3})\s*\+\s*(anos?)?\s*$/i)
  if (aberta) return { faixa_de: aberta[1], faixa_ate: "" }

  // "a partir de 12 anos" — formato que `montarAtividadePayload` grava pra ESPORTES sem idade
  // máxima (S-PROG-09 item 2: reabrir rascunho precisa entender o próprio texto que a gravação
  // produz, não só o formato antigo da planilha).
  const aPartirDe = texto.match(/^a partir de\s*(\d{1,3})\s*anos?\s*$/i)
  if (aPartirDe) return { faixa_de: aPartirDe[1], faixa_ate: "" }

  return { faixa_de: "", faixa_ate: "" }
}

/** Inverso de `dias_raw.map(d => DIAS_SEMANA_ABREV[d]).join(" e ")` (usado por
 * `montarAtividadePayload`) — "Ter e Qui" -> ["Terça", "Quinta"]. Usado só ao reabrir um
 * rascunho já gravado (S-PROG-09 item 2, `zerar: false`); a duplicação nunca chama isto, porque
 * `dias_raw` sempre zera. Abreviação que não bate com nenhum dia conhecido é descartada, nunca
 * adivinhada. */
const DIA_POR_ABREVIACAO: Record<string, string> = Object.fromEntries(
  Object.entries(DIAS_SEMANA_ABREV).map(([dia, abrev]) => [abrev, dia]),
)

export function parseDiasAbreviados(valor: string | null | undefined): string[] {
  const texto = normalizarTextoCopiavel(valor)
  if (!texto) return []
  return texto
    .split(/\s+e\s+/i)
    .map(parte => DIA_POR_ABREVIACAO[parte.trim()])
    .filter((dia): dia is string => !!dia)
}

/** `meta.periodo` gravado por `montarAtividadePayload` já vem como "dd/mm/aaaa a dd/mm/aaaa" —
 * `parsePeriodoCursos` extrai as duas datas em dd/mm/aaaa; aqui só converte pra ISO, formato que
 * os campos `data_inicio_raw`/`data_fim_raw` da grade esperam. Usado só ao reabrir rascunho
 * (item 2) — a duplicação nunca chama isto, os dois campos sempre zeram. */
function periodoCursosParaISO(periodo: string | null | undefined): { data_inicio_raw: string; data_fim_raw: string } {
  const { data_inicio_raw, data_fim_raw } = parsePeriodoCursos(periodo)
  return {
    data_inicio_raw: data_inicio_raw ? dataBrParaISO(data_inicio_raw) ?? "" : "",
    data_fim_raw: data_fim_raw ? dataBrParaISO(data_fim_raw) ?? "" : "",
  }
}

/**
 * CURSOS antigo não tem `data_inicio_raw`/`data_fim_raw` — as duas datas (e o texto de dias,
 * descartado aqui, ver módulo) vêm misturadas num blob `periodo`, ex.:
 * "09/09/2026\n\n30/09/2026\n\nQuarta e sexta-feira". Extrai as duas primeiras datas dd/mm/aaaa
 * na ordem em que aparecem — não tenta separar dias (item abaixo já cobre por quê).
 */
export function parsePeriodoCursos(valor: string | null | undefined): { data_inicio_raw: string; data_fim_raw: string } {
  if (!valor) return { data_inicio_raw: "", data_fim_raw: "" }
  const datas = String(valor).match(/\d{2}\/\d{2}\/\d{4}/g) || []
  return { data_inicio_raw: datas[0] || "", data_fim_raw: datas[1] || "" }
}

/** "17h30min" -> "17"; "17h/aula" -> "17"; "21" -> "21". Extrai o primeiro número — carga horária
 * fracionada (30min) não é representável no campo numérico da grade, perde-se a fração, nunca a
 * hora inteira. Nada que não comece com dígito (texto livre sem número) devolve "". */
export function parseCargaHoraria(valor: string | null | undefined): string {
  if (!valor) return ""
  const m = String(valor).match(/\d+/)
  return m ? m[0] : ""
}

/** `dias_semana` de origem é texto totalmente livre no dado real (planilha antiga não tinha lista
 * fechada) — "Ter e Qui", "Ter a sex", "qui e ter" já apareceram na MESMA campanha. Não existe
 * parser seguro de texto livre para a lista fechada de dias sem arriscar adivinhar; por isso este
 * módulo NÃO tenta — `dias_raw` sempre nasce vazio na duplicação, e o painel de revisão já
 * detecta "nenhum dia da semana selecionado" (regra que já existia antes desta story). */

export interface LinhaOrigemDuplicacao {
  categoria: string
  titulo: string | null
  descricao: string | null
  local: string | null
  // `data_atividade`/`hora_inicio`/`hora_fim` (colunas reais de `atividades_mensais`) só são
  // usados quando `opcoes.zerar === false` (S-PROG-09 item 2, reabrir rascunho gravado) —
  // opcionais porque a duplicação (zerar: true, padrão) nunca lê estes campos.
  data_atividade?: string | null
  hora_inicio?: string | null
  hora_fim?: string | null
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata: Record<string, any> | null
}

export interface OpcoesConversaoLinha {
  /**
   * `true` (padrão) — comportamento original da duplicação (S-PROG-02): data, hora início, hora
   * fim e vagas SEMPRE nascem vazios, decisão do Junior, vale pra toda categoria, nunca copiados
   * mesmo que o dado de origem seja válido.
   * `false` — S-PROG-09 item 2 (reabrir um rascunho já gravado pelo próprio editor): nada é
   * zerado, os valores reais gravados voltam pro formulário tal como estão no banco.
   */
  zerar?: boolean
}

/**
 * Converte uma linha já gravada (formato solto de produção) na `AtividadeForm` que a grade edita.
 * Com `zerar: true` (padrão, duplicação — S-PROG-02): data, hora início, hora fim e vagas SEMPRE
 * nascem vazios. Com `zerar: false` (reabrir rascunho — S-PROG-09 item 2): nada é zerado, os
 * valores reais são reconstituídos a partir das colunas e do `metadata` gravados. Em ambos os
 * casos o resto do descritivo é copiado com a normalização de cada campo (ver funções acima).
 */
export function atividadeFormDeLinhaExistente(
  linha: LinhaOrigemDuplicacao,
  tempId: string,
  opcoes: OpcoesConversaoLinha = {},
): AtividadeForm | null {
  if (!categoriaValida(linha.categoria)) return null
  const categoria = linha.categoria
  const meta = linha.metadata || {}
  const zerar = opcoes.zerar ?? true

  const fmtHoraColuna = (t: string | null | undefined): string | null => (t ? t.substring(0, 5) : null)
  const valorMeta = (v: unknown): string => (v === null || v === undefined ? "" : String(v))

  const base: AtividadeForm = {
    _tempId: tempId,
    categoria,
    titulo: normalizarTextoCopiavel(linha.titulo),
    descricao: null, // sempre recalculado por `montarAtividadePayload` a partir do metadata, na gravação
    local: null,
    data_atividade: zerar ? null : (linha.data_atividade || null),
    hora_inicio: zerar ? null : fmtHoraColuna(linha.hora_inicio),
    hora_fim: zerar ? null : fmtHoraColuna(linha.hora_fim),
    metadata: {},
  }

  if (categoria === "ESPORTES") {
    const { faixa_de, faixa_ate } = parseFaixaEtaria(meta.faixa_etaria)
    return {
      ...base,
      metadata: {
        professor: normalizarTextoCopiavel(meta.professor),
        turma: normalizarTextoCopiavel(meta.turma),
        faixa_de,
        faixa_ate,
        sexo: valorSeNaLista(meta.sexo, SEXOS),
        vagas: zerar ? "" : valorMeta(meta.vagas),
        // "Dias" livre não é parseável com segurança na duplicação (formato de origem
        // inconsistente, ver comentário do módulo) — mas ao reabrir rascunho, `dias_semana` foi
        // gravado pelo PRÓPRIO `montarAtividadePayload` a partir de `dias_raw`, formato fechado e
        // conhecido, seguro de reverter.
        dias_raw: zerar ? ([] as string[]) : parseDiasAbreviados(meta.dias_semana),
        dias_semana: zerar ? "" : normalizarTextoCopiavel(meta.dias_semana),
        meta: meta.meta || null,
        diretoria: meta.diretoria || null,
      },
    }
  }

  if (categoria === "CURSOS") {
    const { data_inicio_raw, data_fim_raw } = zerar
      ? { data_inicio_raw: "", data_fim_raw: "" }
      : periodoCursosParaISO(meta.periodo)
    return {
      ...base,
      metadata: {
        educador: normalizarTextoCopiavel(meta.educador),
        vagas: zerar ? "" : valorMeta(meta.vagas),
        carga_horaria: parseCargaHoraria(meta.carga_horaria),
        data_inicio_raw,
        data_fim_raw,
        dias_raw: zerar ? ([] as string[]) : parseDiasAbreviados(meta.dias_semana),
        dias_semana: zerar ? "" : normalizarTextoCopiavel(meta.dias_semana),
        requisitos: normalizarTextoCopiavel(meta.requisitos),
        ementa: normalizarTextoCopiavel(meta.ementa),
        meta: meta.meta || null,
        diretoria: meta.diretoria || null,
      },
    }
  }

  // DIA A DIA / ESPECIAIS
  return {
    ...base,
    local: normalizarTextoCopiavel(linha.local || meta.local),
    metadata: {
      sessao: valorSeNaLista(meta.sessao, SESSOES_DIA_A_DIA),
      atividade: normalizarTextoCopiavel(meta.atividade),
      informacoes: normalizarTextoCopiavel(meta.informacoes),
      // `dia_semana`/`data_real` são derivados de `data_atividade` pela própria grade
      // (`grade-atividades.tsx`) sempre que a data muda — ao reabrir, já vêm coerentes com a
      // data real porque foram gravados pelo mesmo cálculo na última vez que a linha foi salva.
      dia_semana: zerar ? "" : valorMeta(meta.dia_semana),
      data_real: zerar ? "" : valorMeta(meta.data_real),
      meta: meta.meta || null,
      diretoria: meta.diretoria || null,
    },
  }
}

/** Verifica se `dias_semana`/`dia_semana`, `vagas`, `faixa_etaria`, `carga_horaria` do JEITO QUE
 * ESTÃO GRAVADOS parecem "problemáticos" — usado só pro selo de qualidade do card de origem
 * (item 1), não altera nada gravado. Critério: título vazio, texto de exemplo detectado em campo
 * chave, ou (ESPORTES) faixa etária sem nenhum dígito — os sinais que a story pede explicitamente. */
export function linhaTemProblema(linha: LinhaOrigemDuplicacao): boolean {
  const meta = linha.metadata || {}
  if (!linha.titulo?.trim()) return true

  const camposChave: Array<string | null | undefined> = [linha.titulo, meta.professor, meta.educador, meta.turma]
  if (camposChave.some(v => v && ehTextoDeExemplo(String(v)))) return true

  if (linha.categoria === "ESPORTES") {
    const faixa = String(meta.faixa_etaria || "")
    if (!/\d/.test(faixa)) return true
  }

  return false
}

export interface SeloQualidade {
  totalAtividades: number
  totalProblemas: number
  percentualProblemas: number
}

export function calcularSeloQualidade(linhas: LinhaOrigemDuplicacao[]): SeloQualidade {
  const total = linhas.length
  const problemas = linhas.filter(linhaTemProblema).length
  return {
    totalAtividades: total,
    totalProblemas: problemas,
    percentualProblemas: total > 0 ? Math.round((problemas / total) * 100) : 0,
  }
}
