// S-PLA-10: regras puras do Calendário Geral 2027 (sem React, sem Supabase). Pedido da direção: uma
// visão única do ano, no formato de calendário escolar (meses nas linhas, dias alinhados pela semana nas
// colunas), mais as atividades de cada mês como no calendário oficial (Data · Ação · Setor · Responsável).
// Reaproveita as regras do Calendário 2027 (S-PLA-07) por import, sem alterá-las. Texto sempre como foi
// digitado (S-PLA-09): nada é cortado nem reescrito.

import { mesesDoPeriodo, MESES } from "./lista"
import { ANO_PLANEJAMENTO, rotuloStatus, rotuloTipo } from "./projeto"
import { diaDaSemana, diasDoProjetoNoMes, diasNoMes, type FiltrosCalendario, type ProjetoCalendario } from "./calendario"

export type ProjetoCalendarioGeral = ProjetoCalendario & {
    responsavel_nome: string | null
    locais_unidades: string[] | null
    local_outro: boolean | null
    local_outro_texto: string | null
    dias_horarios: string | null
}

export type SetorCalendario = { id: string; nome: string; cor: string; ordem: number }

// ── Grade do ano (formato calendário escolar) ────────────────────────────────────────────────

// 37 colunas: o mês mais "deslocado" começa no sábado (6) e tem 31 dias (6 + 31 = 37).
export const COLUNAS_GRADE = 37
const LETRAS_SEMANA = ["D", "S", "T", "Q", "Q", "S", "S"] as const
export const CABECALHO_GRADE: string[] = Array.from({ length: COLUNAS_GRADE }, (_, i) => LETRAS_SEMANA[i % 7])
export const colunaFimDeSemana = (coluna: number) => coluna % 7 === 0 || coluna % 7 === 6

export type CelulaDia = {
    dia: number
    fimDeSemana: boolean
    projetos: ProjetoCalendarioGeral[] // ordem: setor, início, nome
    setores: string[] // sem repetição, na ordem dos setores
}
export type MesGrade = { mes: number; nome: string; celulas: (CelulaDia | null)[] }

// Ordem estável: setor, depois o começo do período, depois o nome.
export function comparadorGeral(ordemSetor: (id: string) => number) {
    return (a: ProjetoCalendarioGeral, b: ProjetoCalendarioGeral) =>
        ordemSetor(a.setor_id) - ordemSetor(b.setor_id)
        || (a.data_inicio ?? a.data_fim ?? "").localeCompare(b.data_inicio ?? b.data_fim ?? "")
        || a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" })
}

// "Ano todo" e "sem período" ficam fora da grade (pintariam o ano inteiro ou não têm dia).
export function montarGradeAno(projetos: ProjetoCalendarioGeral[], ordemSetor: (id: string) => number = () => 0, ano = ANO_PLANEJAMENTO): MesGrade[] {
    const ordenados = [...projetos].sort(comparadorGeral(ordemSetor))
    return MESES.map((nome, i) => {
        const mes = i + 1
        const inicio = diaDaSemana(1, mes, ano)
        const total = diasNoMes(mes, ano)
        const porDia: ProjetoCalendarioGeral[][] = Array.from({ length: total + 1 }, () => [])
        for (const p of ordenados) {
            if (mesesDoPeriodo(p, ano).tipo !== "meses") continue
            const dias = diasDoProjetoNoMes(p, mes, ano)
            if (!dias) continue
            for (let d = dias.de; d <= dias.ate; d++) porDia[d].push(p)
        }
        const celulas: (CelulaDia | null)[] = Array.from({ length: COLUNAS_GRADE }, (_, coluna) => {
            const dia = coluna - inicio + 1
            if (dia < 1 || dia > total) return null
            const lista = porDia[dia]
            const setores = [...new Set(lista.map(p => p.setor_id))].sort((a, b) => ordemSetor(a) - ordemSetor(b))
            return { dia, fimDeSemana: colunaFimDeSemana(coluna), projetos: lista, setores }
        })
        return { mes, nome, celulas }
    })
}

// ── Datas como no calendário oficial ─────────────────────────────────────────────────────────

const RE_DATA = /^(\d{4})-(\d{2})-(\d{2})$/
function ddmm(data: string, ano: number): string {
    const m = RE_DATA.exec(data)
    if (!m) return data
    return Number(m[1]) === ano ? `${m[3]}/${m[2]}` : `${m[3]}/${m[2]}/${m[1]}`
}

// "16/01", "13/01 a 18/01", "Ano todo" ou "" (sem período). As datas aparecem como foram digitadas:
// fim antes do início não é reordenado.
export function rotuloDatas(p: ProjetoCalendario, ano = ANO_PLANEJAMENTO): string {
    if (p.periodo_ano_todo) return "Ano todo"
    const ini = p.data_inicio ? ddmm(p.data_inicio, ano) : ""
    const fim = p.data_fim ? ddmm(p.data_fim, ano) : ""
    if (!ini || !fim || ini === fim) return ini || fim
    return `${ini} a ${fim}`
}

// ── Atividades de cada mês ───────────────────────────────────────────────────────────────────

export type AtividadesDoAno = {
    anoTodo: ProjetoCalendarioGeral[]
    meses: Record<number, ProjetoCalendarioGeral[]> // 1 a 12
    semPeriodo: ProjetoCalendarioGeral[]
}

// Como no calendário oficial: cada atividade aparece UMA vez, no mês em que começa, com o período
// inteiro na coluna Data ("01/06 a 03/10"). Dentro do mês: pela data, depois setor, depois nome.
export function atividadesPorMes(projetos: ProjetoCalendarioGeral[], ordemSetor: (id: string) => number = () => 0, ano = ANO_PLANEJAMENTO): AtividadesDoAno {
    const r: AtividadesDoAno = { anoTodo: [], meses: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, []])), semPeriodo: [] }
    const porData = (a: ProjetoCalendarioGeral, b: ProjetoCalendarioGeral) =>
        (a.data_inicio ?? a.data_fim ?? "").localeCompare(b.data_inicio ?? b.data_fim ?? "")
        || ordemSetor(a.setor_id) - ordemSetor(b.setor_id)
        || a.nome.localeCompare(b.nome, "pt-BR", { sensitivity: "base" })
    for (const p of projetos) {
        const onde = mesesDoPeriodo(p, ano)
        if (onde.tipo === "ano_todo") r.anoTodo.push(p)
        else if (onde.tipo === "sem_periodo") r.semPeriodo.push(p)
        else r.meses[onde.meses[0]].push(p)
    }
    for (const m of Object.keys(r.meses)) r.meses[Number(m)].sort(porData)
    r.anoTodo.sort(comparadorGeral(ordemSetor))
    r.semPeriodo.sort(comparadorGeral(ordemSetor))
    return r
}

// Quantas atividades de cada setor aparecem (legenda com contagem).
export function contarPorSetor(projetos: ProjetoCalendarioGeral[]): Map<string, number> {
    const m = new Map<string, number>()
    for (const p of projetos) m.set(p.setor_id, (m.get(p.setor_id) ?? 0) + 1)
    return m
}

// Locais: unidades marcadas (pelo nome cadastrado) e o "outro local" digitado.
export function rotuloLocais(p: ProjetoCalendarioGeral, nomeUnidade: (id: string) => string | undefined): string {
    const nomes = (p.locais_unidades ?? []).map(nomeUnidade).filter((n): n is string => !!n)
    if (p.local_outro && p.local_outro_texto?.trim()) nomes.push(p.local_outro_texto)
    return nomes.join(", ")
}

// ── Planilha ─────────────────────────────────────────────────────────────────────────────────

export const COLUNAS_LISTA = ["Mês", "Data", "Ação", "Área/Setor", "Responsável", "Tipo", "Status", "Locais", "Dias e horários"] as const

export type LinhaLista = { valores: string[]; setorId: string }

// Uma linha por atividade, na mesma ordem da tela: "Ano todo" primeiro, depois os meses, depois as sem período.
export function linhasLista(a: AtividadesDoAno, nomeSetor: (id: string) => string, nomeUnidade: (id: string) => string | undefined, ano = ANO_PLANEJAMENTO): LinhaLista[] {
    const linha = (mes: string, p: ProjetoCalendarioGeral): LinhaLista => ({
        setorId: p.setor_id,
        valores: [
            mes, rotuloDatas(p, ano), p.nome, nomeSetor(p.setor_id), p.responsavel_nome ?? "", rotuloTipo(p.tipo), rotuloStatus(p.status),
            rotuloLocais(p, nomeUnidade), p.dias_horarios ?? "",
        ],
    })
    return [
        ...a.anoTodo.map(p => linha("Ano todo", p)),
        ...MESES.flatMap((nome, i) => a.meses[i + 1].map(p => linha(nome, p))),
        ...a.semPeriodo.map(p => linha("Sem período", p)),
    ]
}

// Texto da nota/dica de um dia: "Nome (Setor)" por linha.
export function textoDoDia(c: CelulaDia, nomeSetor: (id: string) => string): string {
    return c.projetos.map(p => `${p.nome} (${nomeSetor(p.setor_id)})`).join("\n")
}

// Filtros em uso, para o cabeçalho do PDF e da planilha ("" = sem filtro: tudo o que o usuário vê).
export function textoFiltros(f: FiltrosCalendario, nomeSetor: (id: string) => string): string {
    const partes: string[] = []
    if (f.status) partes.push(`status: ${rotuloStatus(f.status)}`)
    if (f.tipo) partes.push(`tipo: ${rotuloTipo(f.tipo)}`)
    if (f.ocultos.length) partes.push(`setores fora: ${f.ocultos.map(nomeSetor).join(", ")}`)
    return partes.length ? `Filtros: ${partes.join("; ")}` : ""
}

export const nomeArquivoCalendarioGeral = (ext: "pdf" | "xlsx", ano = ANO_PLANEJAMENTO) => `calendario-geral-${ano}.${ext}`

// Mesma frase na tela, no PDF e na planilha: quem lê só o arquivo entende por que um mês parece vazio.
export const EXPLICACAO_MESES = "Cada atividade aparece uma vez, no mês em que começa, com o período completo na coluna Data."
