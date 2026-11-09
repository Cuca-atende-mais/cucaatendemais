/**
 * S-EMP-GES-09: relatório "Situação de vagas" — regras que não dependem do banco nem da tela.
 * Uma linha por vaga/seleção aberta: datas de cadastro e liberação (fuso de Fortaleza), dias em aberto,
 * currículos enviados à empresa por origem, data da entrevista/seleção e totais do rodapé.
 */

import { CHAVE_REDE, FUSO_RELATORIO, formatarDataHora, type AbaPlanilha, type Celula, type LinhaPlanilha, type Unidade } from "./relatorio"

// ── Origem do currículo (AC3) ───────────────────────────────────────────────────────────────────

export type OrigemCurriculo = "banco_talentos" | "automacao" | "manual"

// Convocação do Banco de Talentos para a vaga grava `banco_talentos:<id do talento>`. Os textos
// `banco_talentos: cadastro via WhatsApp` e `banco_talentos: candidatura geral` são currículos que foram
// PARA o banco, sem vaga — ficam fora porque o relatório só lê candidaturas com `vaga_id`.
const CONVOCADO_DO_BANCO = /^banco_talentos:[0-9a-f-]{36}$/i

export function classificarOrigem(observacoes: string | null | undefined): OrigemCurriculo {
    const texto = (observacoes ?? "").trim()
    if (!texto) return "automacao"
    if (CONVOCADO_DO_BANCO.test(texto)) return "banco_talentos"
    return "manual"
}

export interface CandidaturaEnviada {
    vaga_id: string
    observacoes: string | null
}

export interface ContagemEnviados {
    total: number
    banco_talentos: number
    automacao: number
}

/** Conta, por vaga, os currículos já enviados à empresa. Incluídos à mão entram só no total. */
export function contarEnviadosPorVaga(enviadas: CandidaturaEnviada[]): Map<string, ContagemEnviados> {
    const porVaga = new Map<string, ContagemEnviados>()
    for (const c of enviadas) {
        const atual = porVaga.get(c.vaga_id) ?? { total: 0, banco_talentos: 0, automacao: 0 }
        atual.total += 1
        const origem = classificarOrigem(c.observacoes)
        if (origem === "banco_talentos") atual.banco_talentos += 1
        else if (origem === "automacao") atual.automacao += 1
        porVaga.set(c.vaga_id, atual)
    }
    return porVaga
}

// ── Datas (AC3, AC5) ────────────────────────────────────────────────────────────────────────────

const DATA_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const HORA_RE = /^(\d{2}):(\d{2})/

/** Data do calendário de Fortaleza (AAAA-MM-DD) de um instante. */
export function diaFortaleza(instante: string | Date): string {
    const d = typeof instante === "string" ? new Date(instante) : instante
    return new Intl.DateTimeFormat("en-CA", { timeZone: FUSO_RELATORIO, year: "numeric", month: "2-digit", day: "2-digit" }).format(d)
}

/** "2026-10-29" → "29/10/2026". Texto fora do formato → null. */
export function formatarData(dia: string | null | undefined): string | null {
    const m = DATA_RE.exec((dia ?? "").slice(0, 10))
    return m ? `${m[3]}/${m[2]}/${m[1]}` : null
}

/** Dias corridos entre o dia da liberação e hoje, os dois no calendário de Fortaleza. */
export function diasEmAberto(liberadaEm: string | null | undefined, agora: Date = new Date()): number | null {
    if (!liberadaEm) return null
    const inicio = Date.parse(`${diaFortaleza(liberadaEm)}T00:00:00Z`)
    const hoje = Date.parse(`${diaFortaleza(agora)}T00:00:00Z`)
    if (Number.isNaN(inicio) || Number.isNaN(hoje)) return null
    return Math.max(0, Math.round((hoje - inicio) / 86_400_000))
}

interface DataSelecao {
    data: string
    hora: string
}

function lerDatasSelecao(valor: unknown): DataSelecao[] {
    if (!Array.isArray(valor)) return []
    return valor
        .map(v => {
            const item = (v ?? {}) as { data?: unknown; hora?: unknown }
            const data = typeof item.data === "string" ? item.data.slice(0, 10) : ""
            const hora = typeof item.hora === "string" && HORA_RE.test(item.hora) ? item.hora.slice(0, 5) : ""
            return { data, hora }
        })
        .filter(d => DATA_RE.test(d.data))
        .sort((a, b) => `${a.data} ${a.hora}`.localeCompare(`${b.data} ${b.hora}`))
}

/** Todas as datas da seleção, em ordem, com hora: "11/11 09:00 · 25/11 09:00". Sem datas → null. */
export function formatarDatasSelecao(valor: unknown): string | null {
    const datas = lerDatasSelecao(valor)
    if (datas.length === 0) return null
    return datas
        .map(d => {
            const [, , mes, dia] = DATA_RE.exec(d.data)!
            return d.hora ? `${dia}/${mes} ${d.hora}` : `${dia}/${mes}`
        })
        .join(" · ")
}

// ── Linha do relatório ──────────────────────────────────────────────────────────────────────────

export type TipoVaga = "vaga_normal" | "selecao_evento"

export interface VagaAberta {
    id: string
    tipo: string | null
    titulo: string | null
    empresa: string | null
    created_at: string
    liberada_em: string | null
    liberada_por_email: string | null
    data_selecao_prevista: string | null
    datas_selecao: unknown
}

export interface LinhaSituacao {
    id: string
    tipo: TipoVaga
    rotuloTipo: "Vaga" | "Seleção"
    titulo: string
    empresa: string | null
    unidade: string
    cadastradaEm: string
    cadastradaEmTexto: string | null
    liberadaEmTexto: string | null
    diasEmAberto: number | null
    /** null nas seleções: seleção não pede currículo e não envia para a empresa (D6). */
    enviados: ContagemEnviados | null
    dataEntrevistaSelecao: string | null
    liberadaPor: string | null
}

// Mesmo texto na coluna Unidade CUCA e no filtro de unidade: a chave "rede" é a vaga sem unidade atribuível,
// não "todas as unidades" (que é a opção "Todas" do filtro).
export const ROTULO_REDE = "Sem unidade definida (Rede Cuca)"

/** Nome da unidade resolvida por `emp_relatorio_unidade_vagas()`; "rede" (ou chave desconhecida) → rótulo da rede. */
export function rotuloUnidade(chave: string | null | undefined, unidades: Unidade[]): string {
    if (!chave || chave === CHAVE_REDE) return ROTULO_REDE
    return unidades.find(u => u.id === chave)?.nome ?? ROTULO_REDE
}

export function montarLinha(p: {
    vaga: VagaAberta
    unidadeNome: string
    enviados: ContagemEnviados | undefined
    agora?: Date
}): LinhaSituacao {
    const { vaga } = p
    const selecao = vaga.tipo === "selecao_evento"
    const cadastradaEm = diaFortaleza(vaga.created_at)
    return {
        id: vaga.id,
        tipo: selecao ? "selecao_evento" : "vaga_normal",
        rotuloTipo: selecao ? "Seleção" : "Vaga",
        titulo: (vaga.titulo ?? "").trim() || "(sem título)",
        empresa: vaga.empresa?.trim() || null,
        unidade: p.unidadeNome,
        cadastradaEm,
        cadastradaEmTexto: formatarData(cadastradaEm),
        liberadaEmTexto: vaga.liberada_em ? formatarData(diaFortaleza(vaga.liberada_em)) : null,
        diasEmAberto: diasEmAberto(vaga.liberada_em, p.agora),
        enviados: selecao ? null : (p.enviados ?? { total: 0, banco_talentos: 0, automacao: 0 }),
        dataEntrevistaSelecao: selecao ? formatarDatasSelecao(vaga.datas_selecao) : formatarData(vaga.data_selecao_prevista),
        liberadaPor: vaga.liberada_por_email?.trim() || null,
    }
}

/** Mais recente primeiro pela data de cadastro; empate pelo título. */
export function ordenarPorCadastro(linhas: LinhaSituacao[]): LinhaSituacao[] {
    return [...linhas].sort((a, b) => b.cadastradaEm.localeCompare(a.cadastradaEm) || a.titulo.localeCompare(b.titulo, "pt-BR"))
}

// ── Filtro e rodapé (AC5.1, AC6) ────────────────────────────────────────────────────────────────

export type FiltroTipo = "todas" | "vagas" | "selecoes"

function semAcento(texto: string): string {
    return texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
}

export function filtrarLinhas(linhas: LinhaSituacao[], filtro: { tipo: FiltroTipo; busca: string }): LinhaSituacao[] {
    const termo = semAcento(filtro.busca.trim())
    return linhas.filter(l => {
        if (filtro.tipo === "vagas" && l.tipo !== "vaga_normal") return false
        if (filtro.tipo === "selecoes" && l.tipo !== "selecao_evento") return false
        if (!termo) return true
        return semAcento(l.titulo).includes(termo) || semAcento(l.empresa ?? "").includes(termo)
    })
}

export function totaisRodape(linhas: LinhaSituacao[]): { vagas: number; selecoes: number; total: number } {
    const vagas = linhas.filter(l => l.tipo === "vaga_normal").length
    const selecoes = linhas.length - vagas
    return { vagas, selecoes, total: linhas.length }
}

/** Texto do rodapé: "Vagas = 15 · Seleções = 4 · Total = 19". */
export function textoRodape(linhas: LinhaSituacao[]): string {
    const t = totaisRodape(linhas)
    return `Vagas = ${t.vagas} · Seleções = ${t.selecoes} · Total = ${t.total}`
}

// ── Paginação (AC6) ─────────────────────────────────────────────────────────────────────────────

export const TAMANHO_PAGINA = 100

/** Página (0-based) das linhas já filtradas; a página pedida é ajustada para o intervalo válido. */
export function paginar<T>(linhas: T[], pagina: number, tamanho: number = TAMANHO_PAGINA): {
    itens: T[]
    pagina: number
    totalPaginas: number
    de: number
    ate: number
} {
    const totalPaginas = Math.max(1, Math.ceil(linhas.length / tamanho))
    const atual = Math.min(Math.max(0, Math.floor(pagina) || 0), totalPaginas - 1)
    const inicio = atual * tamanho
    const itens = linhas.slice(inicio, inicio + tamanho)
    return { itens, pagina: atual, totalPaginas, de: itens.length ? inicio + 1 : 0, ate: inicio + itens.length }
}

// ── Planilha Excel (mesmo gerador do Relatório mensal) ──────────────────────────────────────────

export const CABECALHO_PLANILHA = [
    "Tipo", "Vaga / Seleção", "Empresa", "Unidade CUCA", "Cadastrada em", "Liberada em", "Dias em aberto",
    "Currículos enviados à empresa", "Currículos enviados do Banco de Talentos", "Currículos enviados da automação",
    "Data da entrevista / seleção", "Liberada por",
]

const COR_PLANILHA = "1F4E79"
const LINHA_PRIMEIRO_DADO = 4 // título, subtítulo, cabeçalho

const TRACO = "—"

function numeroOuTraco(n: number | null | undefined): Celula {
    return n === null || n === undefined ? { valor: TRACO } : { valor: n, formato: "inteiro" }
}

/**
 * Uma aba "Situação de vagas" com as linhas que estão na tela (todas as páginas, já filtradas): título,
 * subtítulo com data, autor e filtros, cabeçalho com as 12 colunas, uma linha por vaga/seleção, linha de
 * total (soma das colunas de currículos) e a contagem de vagas e seleções.
 */
export function montarPlanilhaSituacao(p: {
    linhas: LinhaSituacao[]
    geradoEm: Date
    geradoPor: string
    filtros: string
}): AbaPlanilha[] {
    const linhas: LinhaPlanilha[] = [
        { tipo: "titulo", mesclar: true, celulas: [{ valor: "SITUAÇÃO DE VAGAS — VAGAS E SELEÇÕES ABERTAS" }] },
        { tipo: "subtitulo", mesclar: true, celulas: [{ valor: `Gerado em ${formatarDataHora(p.geradoEm)} por ${p.geradoPor || "—"}. ${p.filtros}` }] },
        { tipo: "cabecalho", celulas: CABECALHO_PLANILHA.map(c => ({ valor: c })) },
    ]
    for (const l of p.linhas) {
        linhas.push({
            tipo: "dado",
            celulas: [
                { valor: l.rotuloTipo },
                { valor: l.titulo },
                { valor: l.empresa ?? TRACO },
                { valor: l.unidade },
                { valor: l.cadastradaEmTexto ?? TRACO },
                { valor: l.liberadaEmTexto ?? TRACO },
                numeroOuTraco(l.diasEmAberto),
                numeroOuTraco(l.enviados?.total),
                numeroOuTraco(l.enviados?.banco_talentos),
                numeroOuTraco(l.enviados?.automacao),
                { valor: l.dataEntrevistaSelecao ?? TRACO },
                { valor: l.liberadaPor ?? TRACO },
            ],
        })
    }
    if (p.linhas.length > 0) {
        const r1 = LINHA_PRIMEIRO_DADO
        const r2 = LINHA_PRIMEIRO_DADO + p.linhas.length - 1
        const soma = (col: string, campo: keyof ContagemEnviados): Celula => ({
            formula: `SUM(${col}${r1}:${col}${r2})`,
            resultado: p.linhas.reduce((s, l) => s + (l.enviados?.[campo] ?? 0), 0),
            formato: "inteiro",
        })
        linhas.push({
            tipo: "total",
            celulas: [
                { valor: "Total" }, { valor: "" }, { valor: "" }, { valor: "" }, { valor: "" }, { valor: "" }, { valor: "" },
                soma("H", "total"), soma("I", "banco_talentos"), soma("J", "automacao"),
                { valor: "" }, { valor: "" },
            ],
        })
    }
    linhas.push({ tipo: "vazia", celulas: [] })
    linhas.push({ tipo: "secao", mesclar: true, celulas: [{ valor: textoRodape(p.linhas) }] })
    linhas.push({ tipo: "nota", mesclar: true, celulas: [{ valor: "Seleção não pede currículo e não envia para a empresa, por isso as colunas de currículos ficam com — nas seleções. Liberação anterior a 15/10/2026 não tem data nem autor registrados." }] })
    return [{
        nome: "Situação de vagas",
        cor: COR_PLANILHA,
        larguras: [10, 40, 34, 22, 13, 13, 10, 14, 16, 14, 24, 34],
        linhas,
        congelarLinhas: 3,
        congelarColunas: 0,
    }]
}

/** Texto dos filtros aplicados, para o subtítulo da planilha. */
export function descreverFiltros(p: { unidade: string; tipo: FiltroTipo; busca: string; unidades: Unidade[] }): string {
    const unidade = p.unidade === "todas" ? "Todas" : p.unidade === CHAVE_REDE ? ROTULO_REDE : (p.unidades.find(u => u.id === p.unidade)?.nome ?? p.unidade)
    const tipo = p.tipo === "vagas" ? "Vagas" : p.tipo === "selecoes" ? "Seleções" : "Todas"
    const busca = p.busca.trim() ? ` · Busca: "${p.busca.trim()}"` : ""
    return `Unidade: ${unidade} · Tipo: ${tipo}${busca}.`
}

/** `situacao-de-vagas_{AAAA-MM-DD}_{unidade}.xlsx`, com a data de Fortaleza. */
export function nomeArquivoSituacao(p: { unidade: string; unidades: Unidade[]; agora?: Date }): string {
    const rotulo = p.unidade === "todas" ? "todas" : p.unidade === CHAVE_REDE ? "sem-unidade" : (p.unidades.find(u => u.id === p.unidade)?.nome.replace(/^cuca\s+/i, "") ?? p.unidade)
    const slug = rotulo.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
    return `situacao-de-vagas_${diaFortaleza(p.agora ?? new Date())}_${slug}.xlsx`
}

/**
 * Planilha e nome do arquivo do botão Baixar Excel. `unidadeEfetiva` é a unidade que o servidor aplicou
 * (`escopo.selecionada`), não a do seletor da tela: quem não vê a rede tem o seletor em "todas", mas recebe
 * só a própria unidade — o subtítulo e o nome do arquivo precisam dizer isso.
 */
export function montarExportacaoSituacao(p: {
    linhas: LinhaSituacao[]
    unidades: Unidade[]
    unidadeEfetiva: string
    tipo: FiltroTipo
    busca: string
    geradoPor: string
    agora: Date
}): { abas: AbaPlanilha[]; nomeArquivo: string } {
    return {
        abas: montarPlanilhaSituacao({
            linhas: filtrarLinhas(p.linhas, { tipo: p.tipo, busca: p.busca }),
            geradoEm: p.agora,
            geradoPor: p.geradoPor,
            filtros: descreverFiltros({ unidade: p.unidadeEfetiva, tipo: p.tipo, busca: p.busca, unidades: p.unidades }),
        }),
        nomeArquivo: nomeArquivoSituacao({ unidade: p.unidadeEfetiva, unidades: p.unidades, agora: p.agora }),
    }
}
