// S-PLA-08: regras puras do Painel de Indicadores (sem React, sem Supabase). A rota agrega aqui, no
// servidor, a partir dos fatos por projeto que a função `pla_indicadores_projetos` devolve; o navegador
// recebe só os números. A regra de meses é a da S-PLA-03 (`mesesDoPeriodo`), só importada.

import {
    ANO_PLANEJAMENTO, CATEGORIAS_ORCAMENTO, SITUACOES_2026, STATUS_PROJETO, TIPOS_PROJETO,
    rotuloCategoria, rotuloSituacao, rotuloStatus, rotuloTipo,
    type Situacao2026, type StatusProjeto, type TipoProjeto,
} from "./projeto"
import { FILTROS_VAZIOS, MESES, filtrosParaUrl, mesesDoPeriodo, rotuloPeriodo, type Filtros, type PeriodoProjeto } from "./lista"
import { FILTROS_CALENDARIO_VAZIOS, filtrosCalendarioParaUrl } from "./calendario"

// ── Projeto como o painel usa ────────────────────────────────────────────────────────────────

export type ProjetoIndicador = PeriodoProjeto & {
    id: string
    nome: string
    setor_id: string
    tipo: TipoProjeto
    status: StatusProjeto
    situacao_2026: Situacao2026 | null
    participantes_estimados: number | null
    responsavel_nome: string | null
    orcamento_total: number
    // chave = categoria do item, ou "sem_categoria" para item sem categoria
    orcamento_categorias: Record<string, number>
    correcoes_abertas: number
    validado: boolean
}

// O banco aceita item de orçamento sem categoria e projeto sem situação 2026. Eles ganham um balde
// próprio, para que a soma das partes bata sempre com os cartões (AC4).
export const SEM_CATEGORIA = "sem_categoria"
export const SEM_SITUACAO = "sem_situacao"

const numero = (v: unknown): number => {
    const n = typeof v === "number" ? v : Number(v)
    return Number.isFinite(n) ? n : 0
}

// Normaliza uma linha vinda do banco (jsonb): números como número, datas como "AAAA-MM-DD" ou null.
export function lerProjetoIndicador(raw: Record<string, unknown>): ProjetoIndicador {
    const categorias: Record<string, number> = {}
    const brutas = raw.orcamento_categorias
    if (brutas && typeof brutas === "object") {
        for (const [k, v] of Object.entries(brutas as Record<string, unknown>)) categorias[k] = numero(v)
    }
    const participantes = raw.participantes_estimados
    return {
        id: String(raw.id),
        nome: String(raw.nome ?? ""),
        setor_id: String(raw.setor_id),
        tipo: raw.tipo as TipoProjeto,
        status: raw.status as StatusProjeto,
        situacao_2026: (raw.situacao_2026 ?? null) as Situacao2026 | null,
        periodo_ano_todo: raw.periodo_ano_todo === true,
        data_inicio: typeof raw.data_inicio === "string" ? raw.data_inicio : null,
        data_fim: typeof raw.data_fim === "string" ? raw.data_fim : null,
        participantes_estimados: participantes === null || participantes === undefined ? null : numero(participantes),
        responsavel_nome: typeof raw.responsavel_nome === "string" ? raw.responsavel_nome : null,
        orcamento_total: numero(raw.orcamento_total),
        orcamento_categorias: categorias,
        correcoes_abertas: numero(raw.correcoes_abertas),
        validado: raw.validado === true,
    }
}

// ── Filtros (ficam na URL) ───────────────────────────────────────────────────────────────────

export type FiltrosIndicadores = {
    setor: string
    status: StatusProjeto | ""
    situacao: Situacao2026 | ""
    tipo: TipoProjeto | ""
}
export const FILTROS_INDICADORES_VAZIOS: FiltrosIndicadores = { setor: "", status: "", situacao: "", tipo: "" }

const valido = <T extends string>(lista: readonly { valor: T }[], v: string | null): T | "" =>
    v !== null && lista.some(o => o.valor === v) ? (v as T) : ""

// Valor desconhecido vira "sem filtro". Setor fora da lista de válidos também (nunca amplia o escopo).
export function filtrosIndicadoresDaUrl(params: { get(nome: string): string | null }, setoresValidos: readonly string[] = []): FiltrosIndicadores {
    const setor = params.get("setor") ?? ""
    return {
        setor: setoresValidos.includes(setor) ? setor : "",
        status: valido(STATUS_PROJETO, params.get("status")),
        situacao: valido(SITUACOES_2026, params.get("situacao")),
        tipo: valido(TIPOS_PROJETO, params.get("tipo")),
    }
}

export function filtrosIndicadoresParaUrl(f: FiltrosIndicadores): string {
    const p = new URLSearchParams()
    if (f.setor) p.set("setor", f.setor)
    if (f.status) p.set("status", f.status)
    if (f.situacao) p.set("situacao", f.situacao)
    if (f.tipo) p.set("tipo", f.tipo)
    return p.toString()
}

export function aplicarFiltrosIndicadores(lista: ProjetoIndicador[], f: FiltrosIndicadores): ProjetoIndicador[] {
    return lista.filter(p =>
        (f.setor === "" || p.setor_id === f.setor)
        && (f.status === "" || p.status === f.status)
        && (f.situacao === "" || p.situacao_2026 === f.situacao)
        && (f.tipo === "" || p.tipo === f.tipo))
}

// ── Agregações ───────────────────────────────────────────────────────────────────────────────

export type ChaveSituacao = Situacao2026 | typeof SEM_SITUACAO
export type ChaveMes = number | "ano_todo"

export type LinhaSetor = {
    setor_id: string // "total" na linha de total
    projetos: number
    porStatus: Record<StatusProjeto, number>
    porSituacao: Record<ChaveSituacao, number>
    participantes: number
    orcamento: number
}

export type ItemAcompanhamento = { id: string; nome: string; setor_id: string; correcoes: number }
export type ListaCurta = { total: number; itens: ItemAcompanhamento[] }

export type LinhaMensal = { mes: ChaveMes; porSetor: Record<string, number>; total: number }

export type Indicadores = {
    cartoes: { projetos: number; orcamento: number; participantes: number; porStatus: Record<StatusProjeto, number> }
    setores: LinhaSetor[] // na ordem dos setores visíveis, inclusive os com 0
    total: LinhaSetor
    orcamentoPorCategoria: { categoria: string; valor: number }[]
    acompanhamento: { correcoesAbertas: ListaCurta; naoValidados: ListaCurta; setoresSemProjeto: string[] }
    visaoMensal: { linhas: LinhaMensal[]; maximo: number; semPeriodo: number }
}

export const LIMITE_LISTA_CURTA = 10
export const ORDEM_MESES: readonly ChaveMes[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, "ano_todo"]
export const CHAVES_SITUACAO: readonly ChaveSituacao[] = [...SITUACOES_2026.map(s => s.valor), SEM_SITUACAO]

const zeros = <K extends string>(chaves: readonly K[]): Record<K, number> => {
    const r = {} as Record<K, number>
    for (const k of chaves) r[k] = 0
    return r
}
const CHAVES_STATUS = STATUS_PROJETO.map(s => s.valor)

const linhaVazia = (setor_id: string): LinhaSetor => ({
    setor_id, projetos: 0, porStatus: zeros(CHAVES_STATUS), porSituacao: zeros(CHAVES_SITUACAO), participantes: 0, orcamento: 0,
})

function somarNaLinha(l: LinhaSetor, p: ProjetoIndicador) {
    l.projetos += 1
    l.porStatus[p.status] += 1
    l.porSituacao[p.situacao_2026 ?? SEM_SITUACAO] += 1
    l.participantes += p.participantes_estimados ?? 0
    l.orcamento += p.orcamento_total
}

// Centavos: soma de valores em reais sem acumular erro de ponto flutuante.
const reais = (v: number) => Math.round(v * 100) / 100

// `setoresVisiveis`: os setores do escopo do usuário (e do filtro de setor), na ordem oficial. Todos
// aparecem nas barras, na tabela e na grade, mesmo com 0 (AC3). `projetos` já vem filtrado.
export function agregarIndicadores(projetos: ProjetoIndicador[], setoresVisiveis: readonly string[], limiteLista = LIMITE_LISTA_CURTA): Indicadores {
    const porSetor = new Map(setoresVisiveis.map(s => [s, linhaVazia(s)]))
    const total = linhaVazia("total")
    const categorias = new Map<string, number>(CATEGORIAS_ORCAMENTO.map(c => [c.valor, 0]))
    categorias.set(SEM_CATEGORIA, 0)
    const meses = new Map<ChaveMes, LinhaMensal>(ORDEM_MESES.map(m => [m, { mes: m, porSetor: Object.fromEntries(setoresVisiveis.map(s => [s, 0])), total: 0 }]))
    let semPeriodo = 0
    const comCorrecao: ItemAcompanhamento[] = []
    const naoValidados: ItemAcompanhamento[] = []

    for (const p of projetos) {
        // Projeto de setor fora do conjunto visível não deveria chegar aqui (a rota já filtra); se chegar,
        // fica fora de tudo, para os totais continuarem batendo.
        const linha = porSetor.get(p.setor_id)
        if (!linha) continue
        somarNaLinha(linha, p)
        somarNaLinha(total, p)

        for (const [cat, valor] of Object.entries(p.orcamento_categorias)) {
            const chave = categorias.has(cat) ? cat : SEM_CATEGORIA
            categorias.set(chave, (categorias.get(chave) ?? 0) + valor)
        }

        const onde = mesesDoPeriodo(p, ANO_PLANEJAMENTO)
        const chaves: ChaveMes[] = onde.tipo === "ano_todo" ? ["ano_todo"] : onde.tipo === "meses" ? onde.meses : []
        if (chaves.length === 0) semPeriodo += 1
        for (const m of chaves) {
            const lm = meses.get(m) as LinhaMensal
            lm.porSetor[p.setor_id] += 1
            lm.total += 1
        }

        const item = { id: p.id, nome: p.nome, setor_id: p.setor_id, correcoes: p.correcoes_abertas }
        if (p.correcoes_abertas > 0) comCorrecao.push(item)
        if (!p.validado) naoValidados.push(item)
    }

    for (const l of [...porSetor.values(), total]) l.orcamento = reais(l.orcamento)
    const linhasMes = [...meses.values()]
    const ordemSetor = new Map(setoresVisiveis.map((s, i) => [s, i]))
    const ordenar = (a: ItemAcompanhamento, b: ItemAcompanhamento) =>
        (ordemSetor.get(a.setor_id) ?? 99) - (ordemSetor.get(b.setor_id) ?? 99) || a.nome.localeCompare(b.nome, "pt-BR")
    comCorrecao.sort((a, b) => b.correcoes - a.correcoes || ordenar(a, b))
    naoValidados.sort(ordenar)

    return {
        cartoes: { projetos: total.projetos, orcamento: total.orcamento, participantes: total.participantes, porStatus: { ...total.porStatus } },
        setores: setoresVisiveis.map(s => porSetor.get(s) as LinhaSetor),
        total,
        orcamentoPorCategoria: [...categorias.entries()]
            .filter(([c, v]) => c !== SEM_CATEGORIA || v > 0)
            .map(([categoria, valor]) => ({ categoria, valor: reais(valor) })),
        acompanhamento: {
            correcoesAbertas: { total: comCorrecao.length, itens: comCorrecao.slice(0, limiteLista) },
            naoValidados: { total: naoValidados.length, itens: naoValidados.slice(0, limiteLista) },
            setoresSemProjeto: setoresVisiveis.filter(s => (porSetor.get(s) as LinhaSetor).projetos === 0),
        },
        visaoMensal: { linhas: linhasMes, maximo: Math.max(0, ...linhasMes.flatMap(l => Object.values(l.porSetor))), semPeriodo },
    }
}

export const rotuloMes = (m: ChaveMes) => (m === "ano_todo" ? "Ano todo" : MESES[m - 1])
export const rotuloCategoriaOuSem = (c: string) => (c === SEM_CATEGORIA ? "Sem categoria" : rotuloCategoria(c))
export const rotuloSituacaoOuSem = (s: ChaveSituacao) => (s === SEM_SITUACAO ? "Sem situação" : rotuloSituacao(s))

// Intensidade da cor da célula da visão mensal (0 = vazio; 1 a 4 = mais forte onde há mais atividades).
export function nivelCalor(valor: number, maximo: number): 0 | 1 | 2 | 3 | 4 {
    if (valor <= 0 || maximo <= 0) return 0
    return Math.min(4, Math.max(1, Math.ceil((valor / maximo) * 4))) as 1 | 2 | 3 | 4
}

// ── Links (cliques do painel) ────────────────────────────────────────────────────────────────

// Lista de projetos (S-PLA-03) com os filtros do painel e o recorte clicado.
export function linkLista(f: FiltrosIndicadores, recorte: Partial<Filtros> = {}): string {
    const q = filtrosParaUrl({ ...FILTROS_VAZIOS, ...f, ...recorte })
    return q ? `/planejamento?${q}` : "/planejamento"
}

// Célula da visão mensal: com o Calendário (S-PLA-07), abre o mês com só aquele setor ligado na legenda
// (o calendário não tem "setor=", tem "ocultos="). "Ano todo" não tem visão de mês: abre a visão do ano,
// onde "Ano todo" fica no topo. Sem o Calendário, a lista filtrada por setor e mês.
export function linkCelula(
    mes: ChaveMes, setor: string, f: FiltrosIndicadores, todosSetores: readonly string[], temCalendario: boolean,
): string {
    if (!temCalendario) return linkLista(f, { setor, mes })
    const q = filtrosCalendarioParaUrl({
        ...FILTROS_CALENDARIO_VAZIOS,
        mes: mes === "ano_todo" ? null : mes,
        ocultos: todosSetores.filter(s => s !== setor),
        status: f.status,
        tipo: f.tipo,
    })
    return q ? `/planejamento/calendario?${q}` : "/planejamento/calendario"
}

export const linkProjeto = (id: string) => `/planejamento/projeto/${id}`

// ── Exportação (.xlsx) ───────────────────────────────────────────────────────────────────────

export type ColunaAba = { titulo: string; largura: number; formato?: "moeda" | "inteiro" }
export type AbaIndicadores = {
    nomeAba: string
    titulo: string
    colunas: ColunaAba[]
    linhas: (string | number)[][]
    // a última linha é a de total (vai em negrito)
    temTotal: boolean
}

export function montarAbasIndicadores(
    ind: Indicadores, projetos: ProjetoIndicador[], nomeSetor: (id: string) => string, ordemSetor: (id: string) => number, geradoEm: string,
): AbaIndicadores[] {
    const sufixo = ` · gerado em ${geradoEm}`
    const linhaResumo = (l: LinhaSetor, nome: string) => [
        nome, l.projetos,
        ...CHAVES_SITUACAO.map(s => l.porSituacao[s]),
        l.participantes, l.orcamento, l.porStatus.aprovado, l.porStatus.em_execucao,
    ]
    const resumo: AbaIndicadores = {
        nomeAba: "Resumo por setor",
        titulo: `Planejamento ${ANO_PLANEJAMENTO} — Resumo por setor${sufixo}`,
        colunas: [
            { titulo: "Setor", largura: 26 },
            { titulo: "Projetos", largura: 11, formato: "inteiro" },
            ...CHAVES_SITUACAO.map(s => ({ titulo: rotuloSituacaoOuSem(s), largura: 14, formato: "inteiro" as const })),
            { titulo: "Participantes estimados", largura: 16, formato: "inteiro" },
            { titulo: "Orçamento estimado (R$)", largura: 18, formato: "moeda" },
            { titulo: "Aprovados", largura: 11, formato: "inteiro" },
            { titulo: "Em execução", largura: 12, formato: "inteiro" },
        ],
        linhas: [...ind.setores.map(l => linhaResumo(l, nomeSetor(l.setor_id))), linhaResumo(ind.total, "Total")],
        temTotal: true,
    }

    const mensal: AbaIndicadores = {
        nomeAba: "Visão mensal",
        titulo: `Planejamento ${ANO_PLANEJAMENTO} — Atividades por mês e setor${sufixo}`,
        colunas: [
            { titulo: "Mês", largura: 14 },
            ...ind.setores.map(l => ({ titulo: nomeSetor(l.setor_id), largura: 16, formato: "inteiro" as const })),
            { titulo: "Total", largura: 10, formato: "inteiro" },
        ],
        linhas: ind.visaoMensal.linhas.map(l => [rotuloMes(l.mes), ...ind.setores.map(s => l.porSetor[s.setor_id] ?? 0), l.total]),
        temTotal: false,
    }

    const ordenados = [...projetos].sort((a, b) =>
        ordemSetor(a.setor_id) - ordemSetor(b.setor_id) || a.nome.localeCompare(b.nome, "pt-BR"))
    const lista: AbaIndicadores = {
        nomeAba: "Lista de projetos",
        titulo: `Planejamento ${ANO_PLANEJAMENTO} — Projetos${sufixo}`,
        colunas: [
            { titulo: "Setor", largura: 22 },
            { titulo: "Nome", largura: 36 },
            { titulo: "Tipo", largura: 18 },
            { titulo: "Situação 2026", largura: 18 },
            { titulo: "Status", largura: 15 },
            { titulo: "Período", largura: 15 },
            { titulo: "Participantes", largura: 13, formato: "inteiro" },
            { titulo: "Orçamento (R$)", largura: 16, formato: "moeda" },
            { titulo: "Responsável", largura: 26 },
            { titulo: "Validado", largura: 10 },
            { titulo: "Correções em aberto", largura: 12, formato: "inteiro" },
        ],
        linhas: ordenados.map(p => [
            nomeSetor(p.setor_id), p.nome, rotuloTipo(p.tipo), rotuloSituacao(p.situacao_2026), rotuloStatus(p.status),
            rotuloPeriodo(p) || "Sem período", p.participantes_estimados ?? "", p.orcamento_total,
            p.responsavel_nome ?? "", p.validado ? "Sim" : "Não", p.correcoes_abertas,
        ]),
        temTotal: false,
    }
    return [resumo, mensal, lista]
}

// Data de hoje no fuso de Fortaleza, como AAAA-MM-DD.
export function dataHojeFortaleza(agora: Date = new Date()): string {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza", year: "numeric", month: "2-digit", day: "2-digit" }).format(agora)
}

export function nomeArquivoIndicadores(agora: Date = new Date()): string {
    return `planejamento-${ANO_PLANEJAMENTO}_indicadores_${dataHojeFortaleza(agora)}.xlsx`
}
