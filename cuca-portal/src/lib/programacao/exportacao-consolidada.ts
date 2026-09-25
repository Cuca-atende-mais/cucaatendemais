/**
 * S-PROG-18: planilha consolidada da programação mensal por unidade — as 4 categorias em abas.
 * Decisão do Junior (2026-09-25): a planilha da PICI é referência de FORMATAÇÃO (título mesclado,
 * cabeçalho, cores por aba, larguras); as colunas e os dados são os campos que já existem no portal
 * (os mesmos da grade de criação). Independe de a categoria estar autorizada.
 *
 * Módulo puro (sem Excel): monta as abas/linhas; `gerar-xlsx-consolidado.ts` só desenha. A
 * exportação por campanha ("da gráfica", `exportacao.ts`) é outra coisa e não é tocada aqui.
 */
import { MESES_NOME_EXPORTACAO } from "@/lib/programacao/exportacao"
import { parsePeriodoCursos } from "@/lib/programacao/duplicar"
import { slugDaCategoria } from "@/lib/programacao/permissoes-categoria"
import type { SlugCategoria } from "@/lib/rbac/catalogo-programacao-mensal"

export interface AtividadeConsolidada {
    titulo: string
    categoria: string | null
    local?: string | null
    data_atividade?: string | null
    // S-PROG-19: colunas de período (CURSOS/DIA A DIA/ESPECIAIS); linhas antigas podem não ter.
    data_inicio?: string | null
    data_fim?: string | null
    hora_inicio?: string | null
    hora_fim?: string | null
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    metadata: Record<string, any> | null
}

export interface CoresAba {
    /** Título (linha 1) e cabeçalho (linha 2), ARGB sem "#". */
    cabecalho: string
    /** Fundo das linhas de dados; ausente = sem preenchimento. */
    linhas?: string
}

export interface ColunaConsolidada {
    titulo: string
    /** Largura aproximada em caracteres (padrão do Excel). */
    largura: number
    /** Texto longo: quebra de linha na célula. */
    textoLongo?: boolean
}

export interface AbaConsolidada {
    /** Nome gravado na linha (`"DIA A DIA"`…). */
    categoria: string
    /** Nome da aba no arquivo: `"{CATEGORIA} - {MÊS} {AA}"` — sem "/" (o Excel não aceita) e ≤ 31. */
    nomeAba: string
    /** Linha 1, mesclada sobre todas as colunas: `"{MÊS} {ANO} - REDE CUCA {UNIDADE}"`. */
    titulo: string
    colunas: ColunaConsolidada[]
    linhas: string[][]
    cores: CoresAba
}

type Extrator = (a: AtividadeConsolidada) => string[]

interface DefinicaoAba {
    slug: SlugCategoria
    nome: string
    colunas: ColunaConsolidada[]
    cores: CoresAba
    extrator: Extrator
    ordenar: (a: AtividadeConsolidada, b: AtividadeConsolidada) => number
}

const texto = (v: unknown): string => {
    if (v === null || v === undefined) return ""
    return String(v).trim()
}

/** "07:00:00" → "07:00". Coluna `time` do Postgres. */
export function formatarHora(hora: string | null | undefined): string {
    const s = texto(hora)
    return /^\d{2}:\d{2}/.test(s) ? s.substring(0, 5) : s
}

/** "2026-10-07" → "07/10/2026". Qualquer outra coisa volta como veio. */
export function formatarData(iso: string | null | undefined): string {
    const s = texto(iso)
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
    return m ? `${m[3]}/${m[2]}/${m[1]}` : s
}

/** Mesmo gap da `formatarLinhaAtividadeDeterministica` (motor-agente): em parte das unidades a
 * `faixa_etaria` foi gravada como o próprio título da modalidade — repetir isso é pior que omitir. */
function faixaEtaria(a: AtividadeConsolidada): string {
    const faixa = texto(a.metadata?.faixa_etaria)
    return faixa && faixa.toLowerCase() !== texto(a.titulo).toLowerCase() ? faixa : ""
}

/** `payload.ts` prefixa "Turma " sem olhar maiúsculas, então há turma gravada como "Turma TURMA 1".
 * Só a exibição é limpa aqui — o dado gravado não muda. */
export function limparTurma(turma: unknown): string {
    return texto(turma).replace(/^turma\s+(?=turma\b)/i, "")
}

const comparar = (x: string, y: string) => x.localeCompare(y, "pt-BR", { sensitivity: "base", numeric: true })
const chaveData = (a: AtividadeConsolidada) => texto(a.data_inicio) || texto(a.data_atividade) || "9999-99-99"

const porTituloEHorario = (a: AtividadeConsolidada, b: AtividadeConsolidada) =>
    comparar(texto(a.titulo), texto(b.titulo))
    || comparar(limparTurma(a.metadata?.turma), limparTurma(b.metadata?.turma))
    || comparar(formatarHora(a.hora_inicio), formatarHora(b.hora_inicio))

const porDataEHorario = (a: AtividadeConsolidada, b: AtividadeConsolidada) =>
    comparar(chaveData(a), chaveData(b))
    || comparar(formatarHora(a.hora_inicio), formatarHora(b.hora_inicio))
    || comparar(texto(a.titulo), texto(b.titulo))

const COLUNAS_EVENTO: ColunaConsolidada[] = [
    { titulo: "Sessão", largura: 16 },
    { titulo: "Programa", largura: 30 },
    { titulo: "Atividade", largura: 40, textoLongo: true },
    { titulo: "Data início", largura: 12 },
    { titulo: "Data fim", largura: 12 },
    { titulo: "Dia da semana", largura: 14 },
    { titulo: "Horário início", largura: 13 },
    { titulo: "Horário fim", largura: 12 },
    { titulo: "Local", largura: 20 },
    { titulo: "Informações", largura: 46, textoLongo: true },
]

const extratorEvento: Extrator = (a) => {
    const m = a.metadata || {}
    return [
        texto(m.sessao),
        texto(a.titulo),
        texto(m.atividade),
        formatarData(a.data_inicio) || formatarData(a.data_atividade) || texto(m.data_real),
        // Linha sem a coluna (até agosto/2026): data fim vazia — nunca inventada.
        formatarData(a.data_fim),
        texto(m.dia_semana),
        formatarHora(a.hora_inicio),
        formatarHora(a.hora_fim),
        texto(a.local) || texto(m.local),
        texto(m.informacoes),
    ]
}

/** Ordem pedida pelo Junior: ESPORTES · CURSOS · DIA A DIA · ESPECIAIS. Cores da planilha da PICI. */
const DEFINICOES: DefinicaoAba[] = [
    {
        slug: "esportes",
        nome: "ESPORTES",
        cores: { cabecalho: "FF00FF" },
        colunas: [
            { titulo: "Modalidade", largura: 24 },
            { titulo: "Professor", largura: 24 },
            { titulo: "Turma", largura: 12 },
            { titulo: "Idade", largura: 16 },
            { titulo: "Sexo", largura: 12 },
            { titulo: "Vagas", largura: 8 },
            { titulo: "Dias", largura: 16 },
            { titulo: "Horário início", largura: 13 },
            { titulo: "Horário fim", largura: 12 },
        ],
        extrator: (a) => {
            const m = a.metadata || {}
            return [
                texto(a.titulo), texto(m.professor), limparTurma(m.turma), faixaEtaria(a), texto(m.sexo),
                texto(m.vagas), texto(m.dias_semana), formatarHora(a.hora_inicio), formatarHora(a.hora_fim),
            ]
        },
        ordenar: porTituloEHorario,
    },
    {
        slug: "cursos",
        nome: "CURSOS",
        cores: { cabecalho: "F1C232", linhas: "FFD966" },
        colunas: [
            { titulo: "Curso", largura: 40, textoLongo: true },
            { titulo: "Educador", largura: 24 },
            { titulo: "Vagas", largura: 8 },
            { titulo: "Carga horária", largura: 13 },
            { titulo: "Início", largura: 12 },
            { titulo: "Término", largura: 12 },
            { titulo: "Dias", largura: 18 },
            { titulo: "Horário início", largura: 13 },
            { titulo: "Horário fim", largura: 12 },
            { titulo: "Pré-requisitos", largura: 26, textoLongo: true },
            { titulo: "Ementa", largura: 46, textoLongo: true },
        ],
        extrator: (a) => {
            const m = a.metadata || {}
            // S-PROG-19: colunas `data_inicio`/`data_fim` primeiro. Linha antiga sem elas: `periodo`
            // ("dd/mm/aaaa a dd/mm/aaaa" ou texto solto); sem período legível, início = `data_atividade`
            // e término vazio — nunca inventa o término.
            const { data_inicio_raw, data_fim_raw } = parsePeriodoCursos(m.periodo)
            const inicio = formatarData(a.data_inicio) || data_inicio_raw || formatarData(a.data_atividade)
            const termino = a.data_inicio ? formatarData(a.data_fim) : data_fim_raw
            return [
                texto(a.titulo), texto(m.educador), texto(m.vagas), texto(m.carga_horaria),
                inicio, termino, texto(m.dias_semana),
                formatarHora(a.hora_inicio), formatarHora(a.hora_fim), texto(m.requisitos), texto(m.ementa),
            ]
        },
        ordenar: porTituloEHorario,
    },
    {
        slug: "dia_a_dia",
        nome: "DIA A DIA",
        cores: { cabecalho: "6D9EEB" },
        colunas: COLUNAS_EVENTO,
        extrator: extratorEvento,
        ordenar: porDataEHorario,
    },
    {
        slug: "especiais",
        nome: "ESPECIAIS",
        cores: { cabecalho: "FFD966", linhas: "FFF2CC" },
        colunas: COLUNAS_EVENTO,
        extrator: extratorEvento,
        ordenar: porDataEHorario,
    },
]

export const ORDEM_ABAS_CONSOLIDADA: string[] = DEFINICOES.map(d => d.nome)

/** "Cuca Pici" / "CUCA Pici" → "PICI". */
export function nomeCurtoUnidade(unidade: string | null | undefined): string {
    return texto(unidade).replace(/^cuca\s+/i, "").toUpperCase()
}

function nomeMes(mes: number): string {
    return (MESES_NOME_EXPORTACAO[mes] || String(mes)).toUpperCase()
}

/** Sempre as 4 abas, na ordem fixa — categoria sem atividade sai só com título e cabeçalho. */
export function montarAbasConsolidadas(
    unidade: string,
    mes: number,
    ano: number,
    atividades: AtividadeConsolidada[],
): AbaConsolidada[] {
    const mesNome = nomeMes(mes)
    const anoCurto = String(ano).slice(-2)
    const titulo = `${mesNome} ${ano} - REDE CUCA ${nomeCurtoUnidade(unidade)}`
    return DEFINICOES.map(def => {
        const itens = atividades
            .filter(a => slugDaCategoria(a.categoria) === def.slug)
            .sort(def.ordenar)
        return {
            categoria: def.nome,
            nomeAba: `${def.nome} - ${mesNome} ${anoCurto}`,
            titulo,
            colunas: def.colunas,
            linhas: itens.map(def.extrator),
            cores: def.cores,
        }
    })
}

export interface CampanhaDoMes {
    id: string
    unidade_cuca: string | null
}

export interface UnidadeResolvida {
    /** Unidades com programação no mês e ao alcance de quem pede, em ordem alfabética. */
    unidades: string[]
    /** A pedida, se estiver ao alcance; senão a primeira; `null` sem nenhuma. */
    unidade: string | null
    /** Campanhas da unidade escolhida (normalmente 1). */
    campanhaIds: string[]
}

/** Regra da rota `/api/programacao/exportacao-consolidada`: colaborador com unidade fixa nunca
 * alcança outra, mesmo pedindo por parâmetro (`alcancaUnidade` = `get_my_unit()`). */
export function resolverUnidade(
    campanhas: CampanhaDoMes[],
    alcancaUnidade: (unidade: string) => boolean,
    unidadePedida: string | null | undefined,
): UnidadeResolvida {
    const aoAlcance = campanhas.filter(c => c.unidade_cuca && alcancaUnidade(c.unidade_cuca))
    const unidades = [...new Set(aoAlcance.map(c => c.unidade_cuca as string))].sort((a, b) => a.localeCompare(b, "pt-BR"))
    const unidade = unidadePedida && unidades.includes(unidadePedida) ? unidadePedida : (unidades[0] ?? null)
    const campanhaIds = unidade ? aoAlcance.filter(c => c.unidade_cuca === unidade).map(c => c.id) : []
    return { unidades, unidade, campanhaIds }
}

/** `Programacao_Consolidada_{Unidade}_{Mes}_{Ano}.xlsx` */
export function nomeArquivoConsolidado(unidade: string, mes: number, ano: number): string {
    const mesNome = MESES_NOME_EXPORTACAO[mes] || String(mes)
    return `Programacao_Consolidada_${texto(unidade).replace(/\s+/g, "_")}_${mesNome}_${ano}.xlsx`
}
