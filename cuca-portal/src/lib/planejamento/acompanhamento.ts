// S-PLA-04: regras puras do acompanhamento do projeto (sem React, sem Supabase): linha do tempo,
// "ficha alterada após a validação", textos com singular/plural e onde cada correção aberta aparece
// no formulário. O banco (funções `pla_*` da migration 20261029120000) repete o que vale para segurança.

import { rotuloStatus, type IdSecao, type StatusProjeto } from "./projeto"

// ── Tipos lidos do banco ─────────────────────────────────────────────────────────────────────

export type Correcao = {
    id: string
    secao: number | null
    texto: string
    pedido_por_nome: string | null
    created_at: string
    resolvida_em: string | null
    resolvida_por_nome: string | null
    resolucao_obs: string | null
}

export type Comentario = {
    id: string
    texto: string
    autor_id: string
    autor_nome: string | null
    created_at: string
    editado_em: string | null
}

export type Validacao = { validado_por_nome: string | null; validado_em: string }

export type Pendencia = {
    id: string
    texto: string
    responsavel: string | null
    feito: boolean
    feito_por_nome: string | null
    criado_por_nome: string | null
    created_at: string
}

export type EventoProjeto = {
    id: string
    tipo: string
    detalhe: Record<string, unknown> | null
    autor_nome: string | null
    created_at: string
}

export const LIMITE_TEXTO = 2000
export const LIMITE_PENDENCIA = 500
export const LIMITE_RESPONSAVEL = 200
export const EVENTOS_POR_PAGINA = 10

// ── Seções da ficha a que uma correção se refere (AC2) ──────────────────────────────────────

// Mesmos ids das seções da S-PLA-02, com os nomes curtos do AC2.
export const SECOES_CORRECAO: readonly { id: IdSecao; rotulo: string }[] = [
    { id: 1, rotulo: "Identificação" },
    { id: 2, rotulo: "Relação com 2026" },
    { id: 3, rotulo: "Objetivos" },
    { id: 4, rotulo: "Execução" },
    { id: 5, rotulo: "Orçamento" },
    { id: 6, rotulo: "Metas" },
    { id: 7, rotulo: "Resultados/Observações" },
]

export function rotuloSecaoCorrecao(secao: number | null | undefined): string | null {
    return SECOES_CORRECAO.find(s => s.id === secao)?.rotulo ?? null
}

// ── Textos com singular e plural ─────────────────────────────────────────────────────────────

// Faixa no topo da página do projeto. 0 = sem faixa.
export function textoFaixaCorrecoes(abertas: number): string | null {
    if (abertas <= 0) return null
    return abertas === 1 ? "1 correção pedida em aberto" : `${abertas} correções pedidas em aberto`
}

// Selo do card/tabela da lista. 0 = sem selo.
export function textoSeloCorrecoes(abertas: number): string | null {
    if (abertas <= 0) return null
    return abertas === 1 ? "1 correção" : `${abertas} correções`
}

export const abertas = (correcoes: Correcao[]): Correcao[] => correcoes.filter(c => c.resolvida_em === null)

// ── Validação (AC4) ──────────────────────────────────────────────────────────────────────────

// A ficha foi salva (parcial, final ou "Salvar" da caixa de saída) depois da validação? O selo continua,
// só com o aviso. `updated_at` do projeto só muda quando a ficha é gravada: troca de status e as ações
// do acompanhamento não mexem nele.
export function fichaAlteradaAposValidacao(fichaAtualizadaEm: string, validadoEm: string): boolean {
    const ficha = Date.parse(fichaAtualizadaEm)
    const validacao = Date.parse(validadoEm)
    if (Number.isNaN(ficha) || Number.isNaN(validacao)) return false
    return ficha > validacao
}

// ── Destaques no formulário (AC2) ────────────────────────────────────────────────────────────

// Correções abertas que viram destaque em cada seção do formulário. As sem seção, e as de seção que a
// ficha esconde (ex.: "Encerrado" tira as seções 3 a 6), vão para um aviso geral no topo, para não sumir.
export function correcoesNoFormulario(
    correcoes: Correcao[],
    secoesVisiveis: readonly IdSecao[],
): { porSecao: Partial<Record<IdSecao, Correcao[]>>; gerais: Correcao[] } {
    const porSecao: Partial<Record<IdSecao, Correcao[]>> = {}
    const gerais: Correcao[] = []
    for (const c of abertas(correcoes)) {
        const secao = c.secao as IdSecao | null
        if (secao !== null && secoesVisiveis.includes(secao)) (porSecao[secao] ??= []).push(c)
        else gerais.push(c)
    }
    return { porSecao, gerais }
}

// ── Linha do tempo (AC6) ─────────────────────────────────────────────────────────────────────

export type ItemLinhaDoTempo = {
    id: string
    tipo: string
    titulo: string
    descricao: string | null
    autor: string
    quando: string
}

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null)
const status = (v: unknown): string => (typeof v === "string" ? rotuloStatus(v as StatusProjeto) || v : "—")

// Título e descrição de cada tipo de evento da tabela única (S-PLA-02, S-PLA-03 e S-PLA-04).
export function descreverEvento(e: Pick<EventoProjeto, "tipo" | "detalhe">): { titulo: string; descricao: string | null } {
    const d = e.detalhe ?? {}
    switch (e.tipo) {
        case "criacao": {
            const origem = texto(d.duplicado_de_nome)
            return { titulo: origem ? `Projeto criado como cópia de "${origem}"` : "Projeto criado", descricao: null }
        }
        case "salvar_projeto":
            return { titulo: "Ficha salva como final (Salvar projeto)", descricao: null }
        case "ficha_voltou_parcial":
            return { titulo: "Ficha voltou para parcial", descricao: null }
        case "status_alterado":
            return { titulo: `Status alterado: ${status(d.status_anterior)} → ${status(d.status)}`, descricao: texto(d.observacao) }
        case "correcao_pedida": {
            const secao = rotuloSecaoCorrecao(typeof d.secao === "number" ? d.secao : null)
            return { titulo: secao ? `Correção pedida (${secao})` : "Correção pedida", descricao: texto(d.texto) }
        }
        case "correcao_resolvida": {
            const obs = texto(d.observacao)
            const pedido = texto(d.texto)
            return {
                titulo: "Correção resolvida",
                descricao: [pedido, obs ? `Observação: ${obs}` : null].filter(Boolean).join("\n") || null,
            }
        }
        case "validado":
            return { titulo: "Projeto validado", descricao: null }
        case "validacao_retirada":
            return { titulo: "Validação retirada", descricao: null }
        case "pendencia_criada": {
            const resp = texto(d.responsavel)
            const pend = texto(d.texto)
            return { titulo: "Pendência criada", descricao: pend ? (resp ? `${pend} (responsável: ${resp})` : pend) : null }
        }
        case "pendencia_concluida":
            return { titulo: "Pendência concluída", descricao: texto(d.texto) }
        case "exclusao":
            return { titulo: "Projeto excluído", descricao: null }
        default:
            return { titulo: e.tipo, descricao: null }
    }
}

// Do mais recente para o mais antigo. Empate de horário: acontece quando a mesma gravação gera dois
// eventos (ex.: projeto criado direto com "Salvar projeto" grava `criacao` e `salvar_projeto` no mesmo
// instante). "Criado" fica sempre como o mais antigo; o resto desempata pelo id, para a ordem não mudar
// entre recargas.
const rankNoMesmoInstante = (tipo: string) => (tipo === "criacao" ? 0 : 1)
export function montarLinhaDoTempo(eventos: EventoProjeto[], formatarData: (iso: string) => string): ItemLinhaDoTempo[] {
    return [...eventos]
        .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
            || rankNoMesmoInstante(b.tipo) - rankNoMesmoInstante(a.tipo)
            || b.id.localeCompare(a.id))
        .map(e => ({
            id: e.id,
            tipo: e.tipo,
            ...descreverEvento(e),
            autor: e.autor_nome ?? "—",
            quando: formatarData(e.created_at),
        }))
}
