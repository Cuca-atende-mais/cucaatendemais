/**
 * S-EMP-GES-04: relatório Emprega+ — regras que não dependem do banco nem do Excel.
 * Período (mês no fuso de Fortaleza), escopo de unidade pela permissão (AC13), agregação das linhas da
 * RPC `relatorio_emprega_mais` e a descrição das abas da planilha, com as fórmulas nas células certas
 * (AC5, AC6). `gerar-xlsx-relatorio.ts` só desenha o que este módulo descreve.
 */

// ── Período ──────────────────────────────────────────────────────────────────────────────────────

export const FUSO_RELATORIO = "America/Fortaleza"
export const MAX_MESES_PERIODO = 24

const MES_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

export const MESES_ABREV = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"]

function partes(mes: string): [number, number] {
    const m = MES_RE.exec(mes)
    if (!m) throw new Error(`Mês inválido: ${mes}`)
    return [Number(m[1]), Number(m[2])]
}

function formatarMes(ano: number, mes: number): string {
    return `${ano}-${String(mes).padStart(2, "0")}`
}

/** Soma `n` meses (negativo volta). */
export function somarMeses(mes: string, n: number): string {
    const [a, m] = partes(mes)
    const total = a * 12 + (m - 1) + n
    return formatarMes(Math.floor(total / 12), (total % 12) + 1)
}

/** Mês corrente em Fortaleza (não UTC): às 22h do dia 30 em Fortaleza ainda é o mesmo mês. */
export function mesAtualFortaleza(agora: Date = new Date()): string {
    const p = new Intl.DateTimeFormat("en-CA", { timeZone: FUSO_RELATORIO, year: "numeric", month: "2-digit" }).formatToParts(agora)
    const ano = p.find(x => x.type === "year")?.value
    const mes = p.find(x => x.type === "month")?.value
    return `${ano}-${mes}`
}

export function listarMeses(inicio: string, fim: string): string[] {
    const meses: string[] = []
    for (let m = inicio; m <= fim; m = somarMeses(m, 1)) meses.push(m)
    return meses
}

export type PeriodoLido = { ok: true; inicio: string; fim: string; meses: string[] } | { ok: false; erro: string }

export function lerPeriodo(inicio: unknown, fim: unknown): PeriodoLido {
    if (typeof inicio !== "string" || !MES_RE.test(inicio) || typeof fim !== "string" || !MES_RE.test(fim)) {
        return { ok: false, erro: "Período inválido. Use AAAA-MM." }
    }
    if (inicio > fim) return { ok: false, erro: "O mês inicial não pode ser depois do mês final." }
    const meses = listarMeses(inicio, fim)
    if (meses.length > MAX_MESES_PERIODO) return { ok: false, erro: `O período pode ter até ${MAX_MESES_PERIODO} meses.` }
    return { ok: true, inicio, fim, meses }
}

/** Período anterior de mesmo tamanho, logo antes (AC3). */
export function periodoAnterior(inicio: string, fim: string): { inicio: string; fim: string } {
    const n = listarMeses(inicio, fim).length
    return { inicio: somarMeses(inicio, -n), fim: somarMeses(inicio, -1) }
}

export type Atalho = "mes_passado" | "ultimos_3" | "ano_atual"

export function periodoDoAtalho(atalho: Atalho, agora: Date = new Date()): { inicio: string; fim: string } {
    const atual = mesAtualFortaleza(agora)
    if (atalho === "mes_passado") {
        const m = somarMeses(atual, -1)
        return { inicio: m, fim: m }
    }
    if (atalho === "ultimos_3") return { inicio: somarMeses(atual, -3), fim: somarMeses(atual, -1) }
    return { inicio: `${atual.slice(0, 4)}-01`, fim: atual }
}

/** "2026-09" → "SET/26" */
export function rotuloMes(mes: string): string {
    const [a, m] = partes(mes)
    return `${MESES_ABREV[m - 1]}/${String(a).slice(-2)}`
}

/** "2026-09" a "2026-11" → "SET/26 a NOV/26"; um mês só → "SET/26". */
export function rotuloPeriodo(inicio: string, fim: string): string {
    return inicio === fim ? rotuloMes(inicio) : `${rotuloMes(inicio)} a ${rotuloMes(fim)}`
}

// ── Unidades e escopo (AC2, AC13) ───────────────────────────────────────────────────────────────

export interface Unidade {
    id: string
    nome: string
}

/** Chave de unidade nas linhas da RPC: UUID, "rede" (vaga sem unidade atribuível) ou "sem_unidade". */
export const CHAVE_REDE = "rede"
export const CHAVE_SEM_UNIDADE = "sem_unidade"

/** "CUCA Pici" → "Pici". */
export function nomeCurto(nome: string): string {
    return nome.replace(/^cuca\s+/i, "").trim()
}

/** Unidade do colaborador (nome ou UUID, maiúsculas à parte) → unidade cadastrada. "Geral" e vazio → null. */
export function normalizarUnidade(valor: string | null | undefined, unidades: Unidade[]): Unidade | null {
    const v = (valor ?? "").trim().toLowerCase()
    if (!v) return null
    return unidades.find(u => u.id.toLowerCase() === v || u.nome.trim().toLowerCase() === v) ?? null
}

export type Escopo =
    | { ok: true; rede: true; chaves: string[]; selecionada: string }
    | { ok: true; rede: false; chaves: string[]; selecionada: string }
    | { ok: false; erro: string }

/**
 * Quem tem `epm_relatorio_rede` escolhe "todas", uma unidade ou "rede". Sem ela, o escopo é sempre a
 * unidade do colaborador, qualquer que seja o `unidade=` pedido — o parâmetro nunca amplia o escopo.
 */
export function resolverEscopo(p: {
    temRede: boolean
    unidadePedida: string | null | undefined
    unidadeDoColaborador: string | null | undefined
    unidades: Unidade[]
}): Escopo {
    const todas = [...p.unidades.map(u => u.id), CHAVE_REDE]
    if (p.temRede) {
        const pedida = (p.unidadePedida ?? "").trim()
        if (!pedida || pedida === "todas") return { ok: true, rede: true, chaves: todas, selecionada: "todas" }
        if (todas.includes(pedida)) return { ok: true, rede: true, chaves: [pedida], selecionada: pedida }
        return { ok: false, erro: "Unidade inválida." }
    }
    const propria = normalizarUnidade(p.unidadeDoColaborador, p.unidades)
    if (!propria) {
        return { ok: false, erro: "Seu cadastro não tem uma unidade definida, e você não tem permissão para ver a rede toda. Peça para ajustar o seu cadastro ou a sua permissão." }
    }
    return { ok: true, rede: false, chaves: [propria.id], selecionada: propria.id }
}

// ── Indicadores e agregação ─────────────────────────────────────────────────────────────────────

export type Indicador = "curriculos" | "encaminhamentos" | "empresas" | "vagas_normais" | "selecoes" | "postos"

export const INDICADORES_DA_REDE: Indicador[] = ["curriculos", "empresas"]
export const INDICADORES_POR_UNIDADE: Indicador[] = ["encaminhamentos", "vagas_normais", "selecoes", "postos"]

export interface LinhaRpc {
    mes: string
    unidade: string
    indicador: string
    valor: number | string
}

/** valores[chave][indicador][mes] */
export type Serie = Record<string, Partial<Record<Indicador, Record<string, number>>>>

/** Junta as linhas da RPC só nas chaves do escopo. Currículos e empresas só entram com a rede (AC13). */
export function agruparLinhas(linhas: LinhaRpc[], escopo: { rede: boolean; chaves: string[]; selecionada: string }): Serie {
    const serie: Serie = {}
    const incluiSemUnidade = escopo.rede && escopo.selecionada === "todas"
    for (const l of linhas) {
        const ind = l.indicador as Indicador
        const chave = l.unidade
        const valida = chave === CHAVE_SEM_UNIDADE ? incluiSemUnidade : escopo.chaves.includes(chave)
        if (!valida) continue
        const porInd = (serie[chave] ??= {})
        const porMes = (porInd[ind] ??= {})
        porMes[l.mes] = (porMes[l.mes] ?? 0) + Number(l.valor)
    }
    return serie
}

export function valor(serie: Serie, chaves: string[], ind: Indicador, mes: string): number {
    let total = 0
    for (const c of chaves) total += serie[c]?.[ind]?.[mes] ?? 0
    return total
}

export function totalPeriodo(serie: Serie, chaves: string[], ind: Indicador, meses: string[]): number {
    return meses.reduce((s, m) => s + valor(serie, chaves, ind, m), 0)
}

/** Variação %: null quando não há base de comparação. */
export function variacao(atual: number, anterior: number): number | null {
    if (!anterior) return null
    return (atual - anterior) / anterior
}

/** Chaves que entram no consolidado: unidades do escopo + "sem_unidade" (currículos/empresas). */
export function chavesConsolidado(escopo: { chaves: string[] }): string[] {
    return [...escopo.chaves, CHAVE_SEM_UNIDADE]
}

export interface Cartao {
    titulo: string
    total: number
    anterior: number
    variacao: number | null
    detalhe?: string
}

export function montarCartoes(p: { serie: Serie; anterior: Serie; chaves: string[]; meses: string[]; mesesAnteriores: string[]; rede: boolean }): Cartao[] {
    const ch = chavesConsolidado({ chaves: p.chaves })
    const t = (ind: Indicador) => totalPeriodo(p.serie, ch, ind, p.meses)
    const a = (ind: Indicador) => totalPeriodo(p.anterior, ch, ind, p.mesesAnteriores)
    const cartao = (titulo: string, atual: number, ant: number, detalhe?: string): Cartao => ({ titulo, total: atual, anterior: ant, variacao: variacao(atual, ant), detalhe })
    const vagas = t("vagas_normais") + t("selecoes")
    const vagasAnt = a("vagas_normais") + a("selecoes")
    const lista: Cartao[] = []
    if (p.rede) lista.push(cartao("Currículos criados", t("curriculos"), a("curriculos")))
    lista.push(cartao("Encaminhamentos", t("encaminhamentos"), a("encaminhamentos")))
    if (p.rede) lista.push(cartao("Empresas cadastradas", t("empresas"), a("empresas")))
    lista.push(cartao("Vagas cadastradas", vagas, vagasAnt, `${t("vagas_normais")} vagas · ${t("selecoes")} seleções · ${t("postos").toLocaleString("pt-BR")} postos`))
    return lista
}

export interface LinhaPrevia {
    rotulo: string
    sub: boolean
    valores: number[]
    total: number
}

/** Tabela indicador × mês da tela (AC3). Sem a rede, currículos e empresas não aparecem. */
export function montarPrevia(p: { serie: Serie; chaves: string[]; meses: string[]; rede: boolean }): LinhaPrevia[] {
    const ch = chavesConsolidado({ chaves: p.chaves })
    const linha = (rotulo: string, f: (m: string) => number, sub = false): LinhaPrevia => {
        const valores = p.meses.map(f)
        return { rotulo, sub, valores, total: valores.reduce((s, v) => s + v, 0) }
    }
    const v = (ind: Indicador) => (m: string) => valor(p.serie, ch, ind, m)
    return [
        ...(p.rede ? [linha("Currículos criados", v("curriculos"))] : []),
        linha("Encaminhamentos", v("encaminhamentos")),
        ...(p.rede ? [linha("Empresas cadastradas", v("empresas"))] : []),
        linha("Vagas cadastradas", m => v("vagas_normais")(m) + v("selecoes")(m)),
        linha("Vagas normais", v("vagas_normais"), true),
        linha("Seleções", v("selecoes"), true),
        linha("Postos ofertados", v("postos")),
    ]
}

// ── Planilha (AC5–AC8, AC12) ────────────────────────────────────────────────────────────────────

export type Formato = "inteiro" | "percentual" | "texto"

export interface Celula {
    valor?: string | number | null
    /** Fórmula do Excel, sem "=". */
    formula?: string
    formato?: Formato
}

export type TipoLinha =
    | "titulo" | "subtitulo" | "vazia" | "destaque_rotulo" | "destaque_valor"
    | "cabecalho" | "dado" | "total" | "secao" | "nota" | "alerta"

export interface LinhaPlanilha {
    tipo: TipoLinha
    celulas: Celula[]
    /** Mescla da 1ª à última coluna da aba (título, subtítulo, seção, nota). */
    mesclar?: boolean
}

export interface AbaPlanilha {
    nome: string
    /** Cor da aba e do cabeçalho, RGB sem "#". */
    cor: string
    larguras: number[]
    linhas: LinhaPlanilha[]
    /** Linhas (1-based) congeladas no topo: até o cabeçalho da tabela. */
    congelarLinhas: number
    congelarColunas: number
}

/** Cores das abas: a mesma ideia das abas por categoria da programação, uma por unidade. */
export const CORES_RELATORIO: Record<string, string> = {
    consolidado: "1F4E79",
    barra: "C00000",
    jangurussu: "7030A0",
    "jose-walter": "00B050",
    mondubim: "ED7D31",
    pici: "0070C0",
    rede: "595959",
    matriz: "2F5597",
    detalhe: "404040",
}

/** Letra da coluna (1 → A, 27 → AA). */
export function letraColuna(n: number): string {
    let s = ""
    while (n > 0) {
        const r = (n - 1) % 26
        s = String.fromCharCode(65 + r) + s
        n = Math.floor((n - 1) / 26)
    }
    return s
}

/** O Excel não aceita [] : * ? / \ no nome da aba, e o limite é 31 caracteres. */
export function nomeAbaSeguro(nome: string): string {
    return nome.replace(/[[\]:*?/\\]/g, "-").slice(0, 31)
}

export const NOTAS_RELATORIO = [
    "Definições:",
    "• Currículos criados: currículos montados na plataforma (fluxo \"Criar Currículo\" e link público) no período, sem os excluídos. Não têm unidade: entram só no consolidado.",
    "• Encaminhamentos: candidatos encaminhados à empresa (data do envio do currículo) no período. É uma data por candidatura — um reenvio substitui a anterior —, então conta candidatos encaminhados, não envios.",
    "• Empresas cadastradas: empresas cadastradas no período. Não têm unidade: entram só no consolidado.",
    "• Vagas cadastradas: vagas normais e seleções cadastradas no período. Postos ofertados: soma do número de vagas (postos) dessas vagas e seleções.",
    "Unidade da vaga: a do colaborador que liberou a vaga; para vagas liberadas antes desse registro, a unidade de destino, depois a unidade base e, por fim, \"Rede Cuca (todas as unidades)\". A aba Detalhe mostra a origem de cada atribuição.",
    "Meses contados no horário de Fortaleza. Totais e variações são fórmulas: editar um mês recalcula a planilha.",
]

interface DefinicaoLinha {
    rotulo: string
    ind?: Indicador
    /** Linha calculada como soma de outras (pelos rótulos). */
    somaDe?: string[]
    daRede?: boolean
}

const LINHAS_INDICADORES: DefinicaoLinha[] = [
    { rotulo: "Currículos criados", ind: "curriculos", daRede: true },
    { rotulo: "Encaminhamentos", ind: "encaminhamentos" },
    { rotulo: "Empresas cadastradas", ind: "empresas", daRede: true },
    { rotulo: "Vagas cadastradas", somaDe: ["  Vagas normais", "  Seleções"] },
    { rotulo: "  Vagas normais", ind: "vagas_normais" },
    { rotulo: "  Seleções", ind: "selecoes" },
    { rotulo: "Postos ofertados", ind: "postos" },
]

const TEXTO_SEM_UNIDADE = "— (indicador da rede, sem unidade)"

export interface ContextoPlanilha {
    inicio: string
    fim: string
    meses: string[]
    mesesAnteriores: string[]
    serie: Serie
    anterior: Serie
    geradoEm: Date
    geradoPor: string
}

/**
 * Aba de indicadores (Consolidado, uma unidade ou "Rede (global)"): título, subtítulo, bloco de destaque
 * que referencia os totais, tabela indicador × mês com Total (SUM), Período anterior e Variação %
 * (fórmula), e as notas.
 */
export function montarAbaIndicadores(p: {
    nome: string
    cor: string
    tituloUnidade: string
    chaves: string[]
    /** Consolidado: currículos/empresas com valor. Aba de unidade: "—". */
    comIndicadoresDaRede: boolean
    ctx: ContextoPlanilha
}): AbaPlanilha {
    const { ctx } = p
    const nMeses = ctx.meses.length
    const colTotal = 2 + nMeses
    const colAnterior = colTotal + 1
    const colVariacao = colTotal + 2
    const nColunas = colVariacao
    const linhas: LinhaPlanilha[] = []

    linhas.push({ tipo: "titulo", mesclar: true, celulas: [{ valor: `RELATÓRIO EMPREGA+ — ${rotuloPeriodo(ctx.inicio, ctx.fim)} — ${p.tituloUnidade}` }] })
    linhas.push({ tipo: "subtitulo", mesclar: true, celulas: [{ valor: `Gerado em ${formatarDataHora(ctx.geradoEm)} por ${ctx.geradoPor}` }] })
    linhas.push({ tipo: "vazia", celulas: [] })

    // Destaque: rótulos na linha 4, fórmulas na linha 5 (preenchidas depois de saber a linha de cada indicador).
    const destaques = p.comIndicadoresDaRede
        ? ["Currículos criados", "Encaminhamentos", "Empresas cadastradas", "Vagas cadastradas", "Postos ofertados"]
        : ["Encaminhamentos", "Vagas cadastradas", "Postos ofertados"]
    const idxDestaqueValor = linhas.length + 1
    linhas.push({ tipo: "destaque_rotulo", celulas: destaques.map(d => ({ valor: d })) })
    linhas.push({ tipo: "destaque_valor", celulas: [] })
    linhas.push({ tipo: "vazia", celulas: [] })

    linhas.push({
        tipo: "cabecalho",
        celulas: [
            { valor: "Indicador" },
            ...ctx.meses.map(m => ({ valor: rotuloMes(m) })),
            { valor: "Total" },
            { valor: `Período anterior (${rotuloPeriodo(ctx.mesesAnteriores[0], ctx.mesesAnteriores[ctx.mesesAnteriores.length - 1])})` },
            { valor: "Variação %" },
        ],
    })
    const linhaCabecalho = linhas.length // 1-based

    const linhaDoRotulo = new Map<string, number>()
    LINHAS_INDICADORES.forEach((def, i) => linhaDoRotulo.set(def.rotulo, linhaCabecalho + 1 + i))

    const chavesValor = p.comIndicadoresDaRede ? [...p.chaves, CHAVE_SEM_UNIDADE] : p.chaves
    for (const def of LINHAS_INDICADORES) {
        const r = linhaDoRotulo.get(def.rotulo) as number
        if (def.daRede && !p.comIndicadoresDaRede) {
            linhas.push({ tipo: "dado", celulas: [{ valor: def.rotulo.trim() }, { valor: TEXTO_SEM_UNIDADE }] })
            continue
        }
        const celulas: Celula[] = [{ valor: def.rotulo }]
        ctx.meses.forEach((m, j) => {
            const col = letraColuna(2 + j)
            if (def.somaDe) {
                celulas.push({ formula: def.somaDe.map(s => `${col}${linhaDoRotulo.get(s)}`).join("+"), formato: "inteiro" })
            } else {
                celulas.push({ valor: valor(ctx.serie, chavesValor, def.ind as Indicador, m), formato: "inteiro" })
            }
        })
        const primeira = letraColuna(2)
        const ultima = letraColuna(1 + nMeses)
        celulas.push({ formula: `SUM(${primeira}${r}:${ultima}${r})`, formato: "inteiro" })
        const anterior = def.somaDe
            ? def.somaDe.reduce((s, x) => s + totalPeriodo(ctx.anterior, chavesValor, LINHAS_INDICADORES.find(d => d.rotulo === x)?.ind as Indicador, ctx.mesesAnteriores), 0)
            : totalPeriodo(ctx.anterior, chavesValor, def.ind as Indicador, ctx.mesesAnteriores)
        celulas.push({ valor: anterior, formato: "inteiro" })
        const T = `${letraColuna(colTotal)}${r}`
        const A = `${letraColuna(colAnterior)}${r}`
        celulas.push({ formula: `IF(${A}=0,"",(${T}-${A})/${A})`, formato: "percentual" })
        linhas.push({ tipo: def.rotulo.startsWith("  ") ? "dado" : "total", celulas })
    }

    const totalDe = (rotulo: string): Celula => ({ formula: `${letraColuna(colTotal)}${linhaDoRotulo.get(rotulo)}`, formato: "inteiro" })
    linhas[idxDestaqueValor] = { tipo: "destaque_valor", celulas: destaques.map(totalDe) }

    linhas.push({ tipo: "vazia", celulas: [] })
    for (const n of NOTAS_RELATORIO) linhas.push({ tipo: "nota", mesclar: true, celulas: [{ valor: n }] })

    return {
        nome: nomeAbaSeguro(p.nome),
        cor: p.cor,
        larguras: [30, ...ctx.meses.map(() => 11), 12, 22, 12].slice(0, nColunas),
        linhas,
        congelarLinhas: linhaCabecalho,
        congelarColunas: 1,
    }
}

/** Matriz unidade × mês para cada indicador com unidade, com linha de total por SUM (AC5). */
export function montarAbaMatriz(p: { unidades: Unidade[]; incluiRede: boolean; ctx: ContextoPlanilha }): AbaPlanilha {
    const { ctx } = p
    const nMeses = ctx.meses.length
    const colTotal = 2 + nMeses
    const linhas: LinhaPlanilha[] = []
    linhas.push({ tipo: "titulo", mesclar: true, celulas: [{ valor: `RELATÓRIO EMPREGA+ — ${rotuloPeriodo(ctx.inicio, ctx.fim)} — UNIDADE × MÊS` }] })
    linhas.push({ tipo: "subtitulo", mesclar: true, celulas: [{ valor: `Gerado em ${formatarDataHora(ctx.geradoEm)} por ${ctx.geradoPor}` }] })

    const linhasUnidade: { rotulo: string; chave: string }[] = [
        ...p.unidades.map(u => ({ rotulo: nomeCurto(u.nome), chave: u.id })),
        ...(p.incluiRede ? [{ rotulo: "Rede Cuca (global)", chave: CHAVE_REDE }] : []),
    ]
    const blocos: { titulo: string; ind: Indicador | "vagas" }[] = [
        { titulo: "Encaminhamentos", ind: "encaminhamentos" },
        { titulo: "Vagas cadastradas (vagas normais + seleções)", ind: "vagas" },
        { titulo: "Postos ofertados", ind: "postos" },
    ]
    for (const bloco of blocos) {
        linhas.push({ tipo: "vazia", celulas: [] })
        linhas.push({ tipo: "secao", mesclar: true, celulas: [{ valor: bloco.titulo }] })
        linhas.push({ tipo: "cabecalho", celulas: [{ valor: "Unidade" }, ...ctx.meses.map(m => ({ valor: rotuloMes(m) })), { valor: "Total" }] })
        const primeiraDados = linhas.length + 1
        for (const u of linhasUnidade) {
            const r = linhas.length + 1
            const v = (m: string) => bloco.ind === "vagas"
                ? valor(ctx.serie, [u.chave], "vagas_normais", m) + valor(ctx.serie, [u.chave], "selecoes", m)
                : valor(ctx.serie, [u.chave], bloco.ind, m)
            linhas.push({
                tipo: "dado",
                celulas: [
                    { valor: u.rotulo },
                    ...ctx.meses.map(m => ({ valor: v(m), formato: "inteiro" as const })),
                    { formula: `SUM(${letraColuna(2)}${r}:${letraColuna(1 + nMeses)}${r})`, formato: "inteiro" },
                ],
            })
        }
        const ultimaDados = linhas.length
        linhas.push({
            tipo: "total",
            celulas: [
                { valor: "Total" },
                ...Array.from({ length: nMeses + 1 }, (_, j) => {
                    const col = letraColuna(2 + j)
                    return { formula: `SUM(${col}${primeiraDados}:${col}${ultimaDados})`, formato: "inteiro" as const }
                }),
            ],
        })
    }
    linhas.push({ tipo: "vazia", celulas: [] })
    for (const n of NOTAS_RELATORIO) linhas.push({ tipo: "nota", mesclar: true, celulas: [{ valor: n }] })

    return {
        nome: "Unidade x Mês",
        cor: CORES_RELATORIO.matriz,
        larguras: [26, ...ctx.meses.map(() => 11), 12].slice(0, colTotal),
        linhas,
        congelarLinhas: 2,
        congelarColunas: 1,
    }
}

export interface VagaDetalhe {
    numero_vaga: number | null
    titulo: string | null
    empresa: string | null
    tipo: string | null
    unidade: string
    origem: string
    postos: number | null
    encaminhados: number
    criada_em: string
}

export const LIMITE_POSTOS_DESTAQUE = 100

export const ROTULO_ORIGEM: Record<string, string> = {
    colaborador: "Colaborador que liberou",
    destino: "Unidade de destino",
    base: "Unidade base",
    rede: "Rede Cuca",
}

export function rotuloUnidade(chave: string, unidades: Unidade[]): string {
    if (chave === CHAVE_REDE) return "Rede Cuca (todas as unidades)"
    const u = unidades.find(x => x.id === chave)
    return u ? nomeCurto(u.nome) : chave
}

/** Aba Detalhe (AC5, AC12): uma linha por vaga, com a origem da unidade; postos acima de 100 em destaque. */
export function montarAbaDetalhe(p: { vagas: VagaDetalhe[]; unidades: Unidade[]; ctx: ContextoPlanilha }): AbaPlanilha {
    const { ctx } = p
    const cab = ["Nº", "Título", "Empresa", "Tipo", "Unidade", "Origem da unidade", "Postos", "Encaminhados no período", "Cadastrada em"]
    const linhas: LinhaPlanilha[] = [
        { tipo: "titulo", mesclar: true, celulas: [{ valor: `RELATÓRIO EMPREGA+ — ${rotuloPeriodo(ctx.inicio, ctx.fim)} — VAGAS E SELEÇÕES DO PERÍODO` }] },
        { tipo: "subtitulo", mesclar: true, celulas: [{ valor: `Gerado em ${formatarDataHora(ctx.geradoEm)} por ${ctx.geradoPor}. Em destaque: mais de ${LIMITE_POSTOS_DESTAQUE} postos, para conferência.` }] },
        { tipo: "cabecalho", celulas: cab.map(c => ({ valor: c })) },
    ]
    for (const v of p.vagas) {
        linhas.push({
            tipo: (v.postos ?? 0) > LIMITE_POSTOS_DESTAQUE ? "alerta" : "dado",
            celulas: [
                { valor: v.numero_vaga ?? "", formato: "texto" },
                { valor: v.titulo ?? "" },
                { valor: v.empresa ?? "" },
                { valor: v.tipo === "selecao_evento" ? "Seleção" : "Vaga" },
                { valor: rotuloUnidade(v.unidade, p.unidades) },
                { valor: ROTULO_ORIGEM[v.origem] ?? v.origem },
                { valor: v.postos ?? 0, formato: "inteiro" },
                { valor: v.encaminhados, formato: "inteiro" },
                { valor: formatarData(v.criada_em) },
            ],
        })
    }
    if (p.vagas.length > 0) {
        const r1 = 4
        const r2 = 3 + p.vagas.length
        linhas.push({
            tipo: "total",
            celulas: [
                { valor: "Total" }, { valor: "" }, { valor: "" }, { valor: "" }, { valor: "" }, { valor: "" },
                { formula: `SUM(G${r1}:G${r2})`, formato: "inteiro" },
                { formula: `SUM(H${r1}:H${r2})`, formato: "inteiro" },
                { valor: "" },
            ],
        })
    }
    linhas.push({ tipo: "vazia", celulas: [] })
    for (const n of NOTAS_RELATORIO) linhas.push({ tipo: "nota", mesclar: true, celulas: [{ valor: n }] })
    return { nome: "Detalhe", cor: CORES_RELATORIO.detalhe, larguras: [8, 36, 30, 10, 26, 24, 9, 14, 14], linhas, congelarLinhas: 3, congelarColunas: 0 }
}

/**
 * Todas as abas, conforme o escopo: com a rede e "todas" → Consolidado, uma aba por unidade, "Rede
 * (global)", Unidade × Mês e Detalhe; com uma unidade só → a aba dela e o Detalhe dela.
 */
export function montarPlanilha(p: {
    escopo: { rede: boolean; chaves: string[]; selecionada: string }
    unidades: Unidade[]
    vagas: VagaDetalhe[]
    ctx: ContextoPlanilha
}): AbaPlanilha[] {
    const { ctx, unidades } = p
    const slug = (u: Unidade) => nomeCurto(u.nome).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "-")
    const abaUnidade = (chave: string) => {
        if (chave === CHAVE_REDE) {
            return montarAbaIndicadores({ nome: "Rede (global)", cor: CORES_RELATORIO.rede, tituloUnidade: "REDE CUCA (GLOBAL)", chaves: [CHAVE_REDE], comIndicadoresDaRede: false, ctx })
        }
        const u = unidades.find(x => x.id === chave) as Unidade
        return montarAbaIndicadores({
            nome: nomeCurto(u.nome), cor: CORES_RELATORIO[slug(u)] ?? CORES_RELATORIO.consolidado,
            tituloUnidade: u.nome.toUpperCase(), chaves: [chave], comIndicadoresDaRede: false, ctx,
        })
    }
    const vagasDoEscopo = p.vagas.filter(v => p.escopo.chaves.includes(v.unidade))

    if (p.escopo.rede && p.escopo.selecionada === "todas") {
        return [
            montarAbaIndicadores({ nome: "Consolidado", cor: CORES_RELATORIO.consolidado, tituloUnidade: "REDE CUCA", chaves: p.escopo.chaves, comIndicadoresDaRede: true, ctx }),
            ...unidades.map(u => abaUnidade(u.id)),
            abaUnidade(CHAVE_REDE),
            montarAbaMatriz({ unidades, incluiRede: true, ctx }),
            montarAbaDetalhe({ vagas: vagasDoEscopo, unidades, ctx }),
        ]
    }
    return [abaUnidade(p.escopo.selecionada), montarAbaDetalhe({ vagas: vagasDoEscopo, unidades, ctx })]
}

/** `relatorio-emprega-mais_{AAAA-MM}_a_{AAAA-MM}_{unidade}.xlsx` (AC8). */
export function nomeArquivoRelatorio(inicio: string, fim: string, selecionada: string, unidades: Unidade[]): string {
    const rotulo = selecionada === "todas" ? "todas" : selecionada === CHAVE_REDE ? "rede" : nomeCurto(unidades.find(u => u.id === selecionada)?.nome ?? selecionada)
    const slug = rotulo.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    return `relatorio-emprega-mais_${inicio}_a_${fim}_${slug}.xlsx`
}

/** dd/mm/aaaa hh:mm no horário de Fortaleza. */
export function formatarDataHora(d: Date): string {
    const p = new Intl.DateTimeFormat("pt-BR", {
        timeZone: FUSO_RELATORIO, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(d)
    const g = (t: string) => p.find(x => x.type === t)?.value ?? ""
    return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}`
}

/** ISO → dd/mm/aaaa no horário de Fortaleza. */
export function formatarData(iso: string): string {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ""
    const p = new Intl.DateTimeFormat("pt-BR", { timeZone: FUSO_RELATORIO, day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(d)
    const g = (t: string) => p.find(x => x.type === t)?.value ?? ""
    return `${g("day")}/${g("month")}/${g("year")}`
}
