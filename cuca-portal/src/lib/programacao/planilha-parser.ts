/**
 * Parsing puro da planilha mensal de programação — extraído de `import-planilha-modal.tsx`
 * (tarefa B2, S-WM-35) pra ser testável sem precisar renderizar o componente React.
 *
 * Princípio central (achado do Junior): detecção por NOME/conteúdo de coluna, nunca por posição
 * fixa assumida. Quando uma coluna esperada não é encontrada com confiança, o chamador deve
 * ABORTAR a importação inteira com erro visível — nunca cair num fallback silencioso por índice
 * fixo (foi exatamente isso que embaralhou os campos de José Walter e corrompeu 66 linhas de
 * Jangurussu, ver S-WM-35).
 *
 * Limitação conhecida e documentada: os regexes de CURSOS e DIA A DIA/ESPECIAIS são um
 * best-effort — as planilhas .xlsx originais não existem em nenhum storage do sistema (também
 * documentado em S-WM-35), então não há como confirmar contra o header real. Foram escolhidos a
 * partir dos nomes de campo que o código já usava (`ementa`, `requisitos`, `carga_horaria`,
 * `educador` etc. — presumivelmente escolhidos por quem via o header real na época). Se o
 * regex errar contra uma planilha futura, o resultado esperado é um ABORT visível (com o header
 * real encontrado na mensagem de erro, pra quem for ajustar o regex), nunca dado embaralhado
 * silencioso — essa é a garantia que importa aqui, não a precisão do palpite em si.
 */

export type ColunaDefinicao = { chave: string; regex: RegExp }

export type DeteccaoColunas =
  | { ok: true; indices: Record<string, number> }
  | { ok: false; faltando: string[]; headerEncontrado: string[] }

/** Normaliza uma célula de header pra comparação (string, minúsculo, sem espaço nas pontas). */
function normalizarHeader(valor: unknown): string {
  return String(valor ?? "").toLowerCase().trim()
}

/**
 * Detecta o índice de cada coluna esperada pelo NOME do header (nunca por posição). Retorna
 * `ok:false` com a lista de chaves que não foram encontradas — o chamador decide o que fazer
 * (na prática desta planilha, sempre abortar a aba/arquivo, nunca seguir com índice fixo).
 */
export function detectarColunas(headerRow: unknown[], colunas: ColunaDefinicao[]): DeteccaoColunas {
  const normalizada = (headerRow || []).map(normalizarHeader)
  const indices: Record<string, number> = {}
  const faltando: string[] = []
  for (const { chave, regex } of colunas) {
    const idx = normalizada.findIndex((h) => regex.test(h))
    if (idx === -1) faltando.push(chave)
    else indices[chave] = idx
  }
  if (faltando.length > 0) {
    return { ok: false, faltando, headerEncontrado: normalizada }
  }
  return { ok: true, indices }
}

export const CATEGORIAS_VALIDAS = ["ESPORTES", "CURSOS", "DIA A DIA", "ESPECIAIS"] as const
export type CategoriaValida = (typeof CATEGORIAS_VALIDAS)[number]

/**
 * Deriva a categoria a partir do nome da aba (tudo antes do "-", maiúsculo/trim). Retorna `null`
 * quando não bate com nenhuma categoria conhecida — isso NÃO deve virar "Diversos" tratado como
 * dado válido (era o bug: "ESPORTE - JUNHO", sem o S, virava "Diversos" e caía num parser
 * genérico que gravou nome de professor como título de atividade, ver achado Jangurussu em
 * S-WM-35). O chamador aborta a aba inteira quando recebe `null` — não tenta adivinhar via
 * fuzzy-match, porque "consertar sozinho" um typo de categoria é o mesmo tipo de risco que essa
 * tarefa existe pra eliminar.
 */
export function detectarCategoria(nomeAba: string): CategoriaValida | null {
  const snUpper = nomeAba.toUpperCase().trim()
  if (!snUpper.includes("-")) return null
  const categoriaVal = snUpper.split("-")[0].trim()
  return (CATEGORIAS_VALIDAS as readonly string[]).includes(categoriaVal)
    ? (categoriaVal as CategoriaValida)
    : null
}

export const COLUNAS_ESPORTES: ColunaDefinicao[] = [
  { chave: "titulo", regex: /modalidade/ },
  { chave: "professor", regex: /professor/ },
  { chave: "turma", regex: /turma/ },
  // \bidade\b (não "idade" solto): "Modalidade" também contém a substring "idade" no fim
  // ("mod-al-idade") e colidiria com o regex de titulo — \b evita esse falso positivo.
  { chave: "faixaEtaria", regex: /faixa|\bidade\b/ },
  { chave: "sexo", regex: /sexo|naipe/ },
  { chave: "vagas", regex: /vagas/ },
  { chave: "dias", regex: /dias/ },
  { chave: "horario", regex: /hor[aá]rio/ },
]

export const COLUNAS_CURSOS: ColunaDefinicao[] = [
  { chave: "titulo", regex: /curso|t[ií]tulo/ },
  { chave: "carga_horaria", regex: /carga.*hor[aá]ria/ },
  { chave: "vagas", regex: /vagas/ },
  { chave: "periodo", regex: /per[ií]odo/ },
  { chave: "horario", regex: /hor[aá]rio/ },
  { chave: "requisitos", regex: /requisito/ },
  { chave: "ementa", regex: /ementa/ },
  { chave: "educador", regex: /educador/ },
]

export const COLUNAS_DIA_A_DIA: ColunaDefinicao[] = [
  { chave: "sessao", regex: /sess[aã]o/ },
  { chave: "data", regex: /^data/ },
  { chave: "dia_semana", regex: /dia.*semana/ },
  // "titulo" (nome do Programa/Projeto, ex.: "Calendário de Matrículas") é um campo DISTINTO de
  // "atividade" (a tarefa específica, ex.: "Marcação dos testes de Natação") — confirmado no
  // texto já gravado em atividades_mensais.descricao ("Programa (DIA A DIA): {titulo}.
  // Atividade: {atividade}."). Perder essa distinção junta 2 conceitos reais num só.
  { chave: "titulo", regex: /programa|projeto|[aá]rea/ },
  { chave: "atividade", regex: /atividade/ },
  { chave: "hora_inicio", regex: /in[ií]cio|hor[aá]rio/ },
  { chave: "hora_fim", regex: /fim|t[ée]rmino/ },
  { chave: "local", regex: /local/ },
  { chave: "informacoes", regex: /informa[cç]|obs/ },
]

/** Lê um valor de `row` pelo índice detectado — sem fallback por posição fixa (`|| row[N]`):
 * índice ausente já teria abortado em `detectarColunas` antes de chegar aqui. */
export function lerColuna(row: unknown[], indices: Record<string, number>, chave: string): string {
  const i = indices[chave]
  return i === undefined ? "" : String(row[i] ?? "")
}
