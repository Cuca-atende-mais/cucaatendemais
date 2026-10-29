// S-PLA-07: regras puras do Calendário 2027 (sem React, sem Supabase). A distribuição pelos meses usa
// a regra única da S-PLA-03 (`mesesDoPeriodo` em `lista.ts`), sem reescrevê-la. Datas são datas puras
// (aaaa-mm-dd): as contas de dia e dia da semana são feitas em UTC para não "pular" de dia por fuso.

import { mesesDoPeriodo, type PeriodoProjeto } from "./lista"
import { ANO_PLANEJAMENTO, STATUS_PROJETO, TIPOS_PROJETO, type StatusProjeto, type TipoProjeto } from "./projeto"

export type ProjetoCalendario = PeriodoProjeto & {
    id: string
    nome: string
    setor_id: string
    status: StatusProjeto
    tipo: TipoProjeto
}

// ── Filtros (ficam na URL) ───────────────────────────────────────────────────────────────────

export type FiltrosCalendario = {
    mes: number | null // null = visão do ano
    ocultos: string[] // setores desligados na legenda
    status: StatusProjeto | ""
    tipo: TipoProjeto | ""
}
export const FILTROS_CALENDARIO_VAZIOS: FiltrosCalendario = { mes: null, ocultos: [], status: "", tipo: "" }

// Valor desconhecido vira "sem filtro" (link antigo ou digitado à mão não quebra a página).
export function filtrosCalendarioDaUrl(params: { get(nome: string): string | null }, setoresValidos: readonly string[] = []): FiltrosCalendario {
    const mesTexto = params.get("mes")
    const mes = mesTexto && /^\d{1,2}$/.test(mesTexto) && Number(mesTexto) >= 1 && Number(mesTexto) <= 12 ? Number(mesTexto) : null
    const ocultos = (params.get("ocultos") ?? "").split(",").map(s => s.trim()).filter(Boolean)
        .filter(s => setoresValidos.length === 0 || setoresValidos.includes(s))
    const status = params.get("status")
    const tipo = params.get("tipo")
    return {
        mes,
        ocultos: [...new Set(ocultos)].sort(),
        status: STATUS_PROJETO.some(s => s.valor === status) ? (status as StatusProjeto) : "",
        tipo: TIPOS_PROJETO.some(t => t.valor === tipo) ? (tipo as TipoProjeto) : "",
    }
}

// Ordem fixa dos parâmetros: o mesmo filtro gera o mesmo link.
export function filtrosCalendarioParaUrl(f: FiltrosCalendario): string {
    const p = new URLSearchParams()
    if (f.mes !== null) p.set("mes", String(f.mes))
    if (f.ocultos.length) p.set("ocultos", [...f.ocultos].sort().join(","))
    if (f.status) p.set("status", f.status)
    if (f.tipo) p.set("tipo", f.tipo)
    return p.toString()
}

// Legenda: liga e desliga um setor.
export function alternarSetor(f: FiltrosCalendario, setor: string): FiltrosCalendario {
    const ocultos = f.ocultos.includes(setor) ? f.ocultos.filter(s => s !== setor) : [...f.ocultos, setor].sort()
    return { ...f, ocultos }
}

export function aplicarFiltrosCalendario(projetos: ProjetoCalendario[], f: FiltrosCalendario): ProjetoCalendario[] {
    return projetos.filter(p =>
        !f.ocultos.includes(p.setor_id)
        && (f.status === "" || p.status === f.status)
        && (f.tipo === "" || p.tipo === f.tipo))
}

// ── Visão do ano ─────────────────────────────────────────────────────────────────────────────

export type PosicaoFaixa = "unico" | "inicio" | "meio" | "fim"
export type ItemMes = { projeto: ProjetoCalendario; posicao: PosicaoFaixa }
export type DistribuicaoAno = {
    anoTodo: ProjetoCalendario[]
    meses: Record<number, ItemMes[]> // 1 a 12
    semPeriodo: ProjetoCalendario[]
}

// Onde a faixa do projeto está naquele mês: começa, continua, termina ou cabe num mês só. A tela usa
// isso para arredondar só as pontas, e a faixa "atravessa" os meses.
export function posicaoNaFaixa(meses: number[], mes: number): PosicaoFaixa {
    const primeiro = meses[0]
    const ultimo = meses[meses.length - 1]
    if (primeiro === ultimo) return "unico"
    if (mes === primeiro) return "inicio"
    if (mes === ultimo) return "fim"
    return "meio"
}

// Ordem dentro de um mês: pela ordem dos setores, depois pelo começo do período, depois pelo nome.
function comparador(ordemSetor: (id: string) => number) {
    return (a: ProjetoCalendario, b: ProjetoCalendario) =>
        ordemSetor(a.setor_id) - ordemSetor(b.setor_id)
        || (a.data_inicio ?? a.data_fim ?? "").localeCompare(b.data_inicio ?? b.data_fim ?? "")
        || a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" })
}

export function distribuirAno(projetos: ProjetoCalendario[], ordemSetor: (id: string) => number = () => 0, ano = ANO_PLANEJAMENTO): DistribuicaoAno {
    const r: DistribuicaoAno = { anoTodo: [], meses: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, []])), semPeriodo: [] }
    const cmp = comparador(ordemSetor)
    for (const p of [...projetos].sort(cmp)) {
        const onde = mesesDoPeriodo(p, ano)
        if (onde.tipo === "ano_todo") r.anoTodo.push(p)
        else if (onde.tipo === "sem_periodo") r.semPeriodo.push(p)
        else for (const m of onde.meses) r.meses[m].push({ projeto: p, posicao: posicaoNaFaixa(onde.meses, m) })
    }
    return r
}

// ── Visão de um mês ──────────────────────────────────────────────────────────────────────────

export const DIAS_SEMANA_CURTOS = ["D", "S", "T", "Q", "Q", "S", "S"] as const

export function diasNoMes(mes: number, ano = ANO_PLANEJAMENTO): number {
    return new Date(Date.UTC(ano, mes, 0)).getUTCDate()
}

// 0 = domingo.
export function diaDaSemana(dia: number, mes: number, ano = ANO_PLANEJAMENTO): number {
    return new Date(Date.UTC(ano, mes - 1, dia)).getUTCDay()
}

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/
function partes(data: string | null): { ano: number; mes: number; dia: number } | null {
    const m = data ? RE_DATA.exec(data) : null
    return m ? { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) } : null
}

// Dias do mês ocupados pelo projeto: do início (ou dia 1, se começou antes) ao fim (ou último dia, se
// termina depois). Com uma data só, só aquele dia. "Ano todo": o mês inteiro. Fora do mês: null.
export function diasDoProjetoNoMes(p: PeriodoProjeto, mes: number, ano = ANO_PLANEJAMENTO): { de: number; ate: number } | null {
    const onde = mesesDoPeriodo(p, ano)
    const ultimo = diasNoMes(mes, ano)
    if (onde.tipo === "ano_todo") return { de: 1, ate: ultimo }
    if (onde.tipo !== "meses" || !onde.meses.includes(mes)) return null
    const ini = partes(p.data_inicio)
    const fim = partes(p.data_fim)
    const noAno = (x: ReturnType<typeof partes>) => (x && x.ano === ano ? x : null)
    const i = noAno(ini)
    const f = noAno(fim)
    // Uma data só (ou fim antes do início): só aquele dia.
    if (!i || !f || (f.mes < i.mes || (f.mes === i.mes && f.dia < i.dia))) {
        const unica = i ?? f
        return unica && unica.mes === mes ? { de: unica.dia, ate: unica.dia } : null
    }
    return { de: i.mes === mes ? i.dia : 1, ate: f.mes === mes ? f.dia : ultimo }
}

export type LinhaMes = { projeto: ProjetoCalendario; de: number; ate: number; continuaAntes: boolean; continuaDepois: boolean }

// Projetos que passam pelo mês, cada um com os dias que ocupa. "Ano todo" vem separado.
export function linhasDoMes(projetos: ProjetoCalendario[], mes: number, ordemSetor: (id: string) => number = () => 0, ano = ANO_PLANEJAMENTO): { anoTodo: ProjetoCalendario[]; linhas: LinhaMes[] } {
    const anoTodo: ProjetoCalendario[] = []
    const linhas: LinhaMes[] = []
    const ultimo = diasNoMes(mes, ano)
    for (const p of [...projetos].sort(comparador(ordemSetor))) {
        const onde = mesesDoPeriodo(p, ano)
        if (onde.tipo === "ano_todo") { anoTodo.push(p); continue }
        const dias = diasDoProjetoNoMes(p, mes, ano)
        if (!dias || onde.tipo !== "meses") continue
        linhas.push({
            projeto: p,
            ...dias,
            continuaAntes: dias.de === 1 && onde.meses[0] < mes,
            continuaDepois: dias.ate === ultimo && onde.meses[onde.meses.length - 1] > mes,
        })
    }
    return { anoTodo, linhas }
}

// "‹ mês anterior" e "mês seguinte ›" param em janeiro e dezembro (o calendário é só de 2027).
export const mesAnterior = (mes: number) => (mes > 1 ? mes - 1 : null)
export const mesSeguinte = (mes: number) => (mes < 12 ? mes + 1 : null)
