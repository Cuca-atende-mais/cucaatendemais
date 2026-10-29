// S-PLA-03: regras puras da lista de projetos (sem React, sem Supabase): período e "mês dentro do
// período", filtros (com leitura e escrita na URL), contadores por status e ordenação da tabela.
// A regra do mês é escrita só aqui e reaproveitada pelo Calendário (S-PLA-07) e pelo painel (S-PLA-08).

import { ANO_PLANEJAMENTO, SITUACOES_2026, STATUS_PROJETO, TIPOS_PROJETO, type Situacao2026, type StatusProjeto, type TipoProjeto } from "./projeto"

// ── Período e "mês dentro do período" ──────────────────────────────────────────────────────────

export const MESES = [
    "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
    "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
] as const
const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"] as const

// 1 a 12, ou "ano_todo".
export type MesFiltro = number | "ano_todo"

export type PeriodoProjeto = { periodo_ano_todo: boolean; data_inicio: string | null; data_fim: string | null }

// Onde o projeto cai no ano:
//   - "ano_todo": marcou "Ano todo". Fica numa faixa própria, separada dos meses (como o Calendário da
//     S-PLA-07 e a grade da S-PLA-08 mostram);
//   - lista de meses (1 a 12): todos os meses entre o início e o fim. Com uma data só, o mês dela;
//   - "sem_periodo": nenhuma data e sem "Ano todo".
export type MesesDoPeriodo = { tipo: "ano_todo" } | { tipo: "meses"; meses: number[] } | { tipo: "sem_periodo" }

const RE_DATA = /^(\d{4})-(\d{2})-\d{2}$/

function mesDaData(data: string | null, ano: number): number | null {
    const m = data ? RE_DATA.exec(data) : null
    if (!m || Number(m[1]) !== ano) return null
    const mes = Number(m[2])
    return mes >= 1 && mes <= 12 ? mes : null
}

export function mesesDoPeriodo(p: PeriodoProjeto, ano = ANO_PLANEJAMENTO): MesesDoPeriodo {
    if (p.periodo_ano_todo) return { tipo: "ano_todo" }
    const ini = mesDaData(p.data_inicio, ano)
    const fim = mesDaData(p.data_fim, ano)
    if (ini === null && fim === null) return { tipo: "sem_periodo" }
    const de = ini ?? fim as number
    const ate = fim ?? ini as number
    if (ate < de) return { tipo: "meses", meses: [de] }
    return { tipo: "meses", meses: Array.from({ length: ate - de + 1 }, (_, i) => de + i) }
}

// O projeto aparece no mês escolhido? "Ano todo" só casa com a opção "Ano todo".
export function mesDentroDoPeriodo(p: PeriodoProjeto, mes: MesFiltro, ano = ANO_PLANEJAMENTO): boolean {
    const onde = mesesDoPeriodo(p, ano)
    if (mes === "ano_todo") return onde.tipo === "ano_todo"
    return onde.tipo === "meses" && onde.meses.includes(mes)
}

// Rótulo curto do card: "Jun–Ago/2027", "Mar/2027", "Ano todo" ou "" (sem período).
export function rotuloPeriodo(p: PeriodoProjeto, ano = ANO_PLANEJAMENTO): string {
    const onde = mesesDoPeriodo(p, ano)
    if (onde.tipo === "ano_todo") return "Ano todo"
    if (onde.tipo === "sem_periodo") return ""
    const primeiro = onde.meses[0]
    const ultimo = onde.meses[onde.meses.length - 1]
    if (primeiro === ultimo) return `${MESES_CURTOS[primeiro - 1]}/${ano}`
    return `${MESES_CURTOS[primeiro - 1]}–${MESES_CURTOS[ultimo - 1]}/${ano}`
}

// ── Projeto como a lista usa ─────────────────────────────────────────────────────────────────

export type ProjetoLista = PeriodoProjeto & {
    id: string
    nome: string
    setor_id: string
    tipo: TipoProjeto
    status: StatusProjeto
    ficha: "parcial" | "final"
    situacao_2026: Situacao2026 | null
    participantes_estimados: number | null
    orcamento_total: number
    updated_at: string
    // S-PLA-04 (AC7): só preenchidos para quem tem `pla_acomp_ver`; sem ela ficam 0 / false.
    correcoes_abertas: number
    validado: boolean
}

// ── Filtros (ficam na URL) ───────────────────────────────────────────────────────────────────

export type Filtros = {
    busca: string
    setor: string
    status: StatusProjeto | ""
    situacao: Situacao2026 | ""
    tipo: TipoProjeto | ""
    mes: MesFiltro | ""
    // S-PLA-04 (AC7): só valem para quem tem `pla_acomp_ver` (sem ela, a URL é ignorada).
    correcao: "abertas" | ""
    validacao: "validados" | "nao_validados" | ""
}

export const LIMITE_BUSCA = 200

export const FILTROS_VAZIOS: Filtros = { busca: "", setor: "", status: "", situacao: "", tipo: "", mes: "", correcao: "", validacao: "" }

export const OPCOES_VALIDACAO = [
    { valor: "validados", rotulo: "Validados" },
    { valor: "nao_validados", rotulo: "Não validados" },
] as const

const valido = <T extends string>(lista: readonly { valor: T }[], v: string | null): T | "" =>
    v !== null && lista.some(o => o.valor === v) ? (v as T) : ""

// Lê a URL. Valor desconhecido vira "sem filtro" (link antigo ou digitado à mão não quebra a página).
// Sem `pla_acomp_ver` (acompanhamento = false), os filtros de correção e validação são ignorados.
export function filtrosDaUrl(
    params: { get(nome: string): string | null },
    setoresValidos: readonly string[] = [],
    acompanhamento = false,
): Filtros {
    const setor = params.get("setor") ?? ""
    const mesTexto = params.get("mes")
    let mes: MesFiltro | "" = ""
    if (mesTexto === "ano_todo") mes = "ano_todo"
    else if (mesTexto && /^\d{1,2}$/.test(mesTexto) && Number(mesTexto) >= 1 && Number(mesTexto) <= 12) mes = Number(mesTexto)
    return {
        busca: (params.get("busca") ?? "").trim().slice(0, LIMITE_BUSCA),
        setor: setoresValidos.length === 0 || setoresValidos.includes(setor) ? setor : "",
        status: valido(STATUS_PROJETO, params.get("status")),
        situacao: valido(SITUACOES_2026, params.get("situacao")),
        tipo: valido(TIPOS_PROJETO, params.get("tipo")),
        mes,
        correcao: acompanhamento && params.get("correcao") === "abertas" ? "abertas" : "",
        validacao: acompanhamento ? valido(OPCOES_VALIDACAO, params.get("validacao")) : "",
    }
}

// Escreve na URL só os filtros preenchidos, numa ordem fixa (o mesmo filtro gera o mesmo link).
export function filtrosParaUrl(f: Filtros): string {
    const p = new URLSearchParams()
    if (f.busca.trim()) p.set("busca", f.busca.trim())
    if (f.setor) p.set("setor", f.setor)
    if (f.status) p.set("status", f.status)
    if (f.situacao) p.set("situacao", f.situacao)
    if (f.tipo) p.set("tipo", f.tipo)
    if (f.mes !== "") p.set("mes", String(f.mes))
    if (f.correcao) p.set("correcao", f.correcao)
    if (f.validacao) p.set("validacao", f.validacao)
    return p.toString()
}

export function temFiltroAtivo(f: Filtros): boolean {
    return filtrosParaUrl(f) !== ""
}

// Busca sem acento e sem diferença de maiúscula.
export function normalizarBusca(t: string): string {
    return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
}

export function aplicarFiltros(lista: ProjetoLista[], f: Filtros, ignorar: (keyof Filtros)[] = []): ProjetoLista[] {
    const usa = (k: keyof Filtros) => !ignorar.includes(k)
    const busca = normalizarBusca(f.busca)
    return lista.filter(p =>
        (!usa("busca") || busca === "" || normalizarBusca(p.nome).includes(busca))
        && (!usa("setor") || f.setor === "" || p.setor_id === f.setor)
        && (!usa("status") || f.status === "" || p.status === f.status)
        && (!usa("situacao") || f.situacao === "" || p.situacao_2026 === f.situacao)
        && (!usa("tipo") || f.tipo === "" || p.tipo === f.tipo)
        && (!usa("mes") || f.mes === "" || mesDentroDoPeriodo(p, f.mes))
        && (!usa("correcao") || f.correcao === "" || p.correcoes_abertas > 0)
        && (!usa("validacao") || f.validacao === "" || p.validado === (f.validacao === "validados")))
}

// ── Contadores (AC2) ─────────────────────────────────────────────────────────────────────────

export type Contadores = { total: number } & Record<StatusProjeto, number>

// Contam o que os outros filtros deixam passar, sem o filtro de status (que é o próprio contador):
// assim o número do contador é exatamente o que aparece ao clicar nele.
export function contarPorStatus(lista: ProjetoLista[], f: Filtros): Contadores {
    const base = aplicarFiltros(lista, f, ["status"])
    const c = { total: base.length } as Contadores
    for (const s of STATUS_PROJETO) c[s.valor] = 0
    for (const p of base) c[p.status] += 1
    return c
}

// Clicar no contador ativo desfaz; "Total" limpa o filtro de status.
export function alternarStatus(f: Filtros, status: StatusProjeto | ""): Filtros {
    return { ...f, status: f.status === status ? "" : status }
}

// ── Ordenação da tabela (AC4) ────────────────────────────────────────────────────────────────

export type ColunaOrdenacao = "nome" | "setor" | "status" | "orcamento" | "atualizado"
export type Ordenacao = { coluna: ColunaOrdenacao; direcao: "asc" | "desc" }
export const ORDENACAO_PADRAO: Ordenacao = { coluna: "atualizado", direcao: "desc" }

const ORDEM_STATUS = new Map(STATUS_PROJETO.map((s, i) => [s.valor, i]))

export function ordenar(lista: ProjetoLista[], o: Ordenacao, nomeSetor: (id: string) => string = id => id): ProjetoLista[] {
    const comparar = (a: ProjetoLista, b: ProjetoLista): number => {
        switch (o.coluna) {
            case "nome": return a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" })
            case "setor": return nomeSetor(a.setor_id).localeCompare(nomeSetor(b.setor_id), "pt-BR", { sensitivity: "base" })
            case "status": return (ORDEM_STATUS.get(a.status) ?? 0) - (ORDEM_STATUS.get(b.status) ?? 0)
            case "orcamento": return a.orcamento_total - b.orcamento_total
            case "atualizado": return a.updated_at.localeCompare(b.updated_at)
        }
    }
    const sinal = o.direcao === "asc" ? 1 : -1
    // Empate: nome, para a ordem não "pular" entre recargas.
    return [...lista].sort((a, b) => sinal * comparar(a, b) || a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" }))
}

// Clicar na mesma coluna inverte; numa coluna nova, começa crescente (atualização começa da mais recente).
export function alternarOrdenacao(atual: Ordenacao, coluna: ColunaOrdenacao): Ordenacao {
    if (atual.coluna === coluna) return { coluna, direcao: atual.direcao === "asc" ? "desc" : "asc" }
    return { coluna, direcao: coluna === "atualizado" ? "desc" : "asc" }
}

// ── Setores do cabeçalho (AC1) e filtro de setor (AC3) ───────────────────────────────────────

// Pode atuar em todos os setores (sem setor marcado, conta Developer ou todos marcados): "Todos os setores".
export function etiquetaSetores(permitidos: number, total: number): "todos" | "lista" {
    return total > 0 && permitidos >= total ? "todos" : "lista"
}

export function mostrarFiltroSetor(permitidos: number): boolean {
    return permitidos > 1
}

// ── Visualização (cards ou tabela), guardada no navegador ────────────────────────────────────

export type Visualizacao = "cards" | "tabela"
export const CHAVE_VISUALIZACAO = "planejamento:lista:visualizacao"
export function lerVisualizacao(valor: string | null | undefined): Visualizacao {
    return valor === "tabela" ? "tabela" : "cards"
}

// ── Selos do acompanhamento (S-PLA-04, AC7) ──────────────────────────────────────────────────

export type ResumoAcompanhamento = Record<string, { correcoes: number; validado: boolean }>

// Junta o resumo do banco (`pla_resumo_acompanhamento`) à lista. Projeto fora do resumo: 0 / false.
export function aplicarResumo(lista: ProjetoLista[], resumo: ResumoAcompanhamento): ProjetoLista[] {
    return lista.map(p => ({
        ...p,
        correcoes_abertas: Number(resumo[p.id]?.correcoes ?? 0),
        validado: resumo[p.id]?.validado === true,
    }))
}
