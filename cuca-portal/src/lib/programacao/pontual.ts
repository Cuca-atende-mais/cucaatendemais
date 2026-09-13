/**
 * S-PROG-17: regras da programação pontual — transições de status, opção exigida por cada uma, quando
 * o evento pode ser editado e validação do que a tela envia. Funções puras, usadas pelas rotas
 * (`/api/programacao/pontual/**`) e pela tela.
 */
import { PGP } from "@/lib/rbac/catalogo-programacao-pontual"
import { opcaoLiberada, type ChecarPermissao } from "./permissoes-categoria"

export type StatusPontual =
    | "aguardando_aprovacao"
    | "autorizado"
    | "aprovado"
    | "em_andamento"
    | "pausada"
    | "pausada_limite_diario"
    | "concluida"
    | "cancelado"

export type AcaoPontual = "autorizar" | "devolver" | "disparar" | "cancelar"

/** Status que a tela pode pedir. Os demais são gravados só pelo worker. */
export const STATUS_DESTINO_PONTUAL = ["autorizado", "aguardando_aprovacao", "aprovado", "cancelado"] as const

/** Status em que ainda não começou o envio: dá para cancelar. */
const ANTES_DO_ENVIO = ["aguardando_aprovacao", "autorizado", "aprovado"]

export function acaoDaTransicaoPontual(de: string, para: string): AcaoPontual | null {
    if (de === "aguardando_aprovacao" && para === "autorizado") return "autorizar"
    if (de === "autorizado" && para === "aguardando_aprovacao") return "devolver"
    if (de === "autorizado" && para === "aprovado") return "disparar"
    if (para === "cancelado" && ANTES_DO_ENVIO.includes(de)) return "cancelar"
    return null
}

const OPCAO_DA_ACAO: Record<AcaoPontual, string> = {
    autorizar: PGP.autorizar,
    devolver: PGP.devolver,
    disparar: PGP.disparar,
    cancelar: PGP.cancelar,
}

export function opcaoDaAcaoPontual(acao: AcaoPontual): string {
    return OPCAO_DA_ACAO[acao]
}

export function podeTransicionarPontual(checar: ChecarPermissao, de: string, para: string): boolean {
    const acao = acaoDaTransicaoPontual(de, para)
    return acao !== null && opcaoLiberada(checar, OPCAO_DA_ACAO[acao])
}

export function transicaoPontualExigeMotivo(de: string, para: string): boolean {
    return acaoDaTransicaoPontual(de, para) === "devolver"
}

/**
 * Status com envio na fila, em curso ou pausado para retomada (`/retomar-disparo` do worker retoma
 * `pausada_limite_diario`). Excluir nesses status apagaria o evento no meio do envio (achado @qa A3).
 */
export const STATUS_BLOQUEIAM_EXCLUSAO_PONTUAL = ["aprovado", "em_andamento", "pausada_limite_diario"] as const

export function eventoExcluivel(status: string): boolean {
    return !(STATUS_BLOQUEIAM_EXCLUSAO_PONTUAL as readonly string[]).includes(status)
}

/** Editar só antes do disparo, como já era na tela. */
export function eventoEditavel(status: string): boolean {
    return status === "aguardando_aprovacao" || status === "autorizado"
}

export type DadosEventoPontual = {
    titulo: string
    descricao: string | null
    unidade_cuca: string | null
    data_evento: string
    data_inicio: string
    data_fim: string
    hora_inicio: string | null
    hora_fim: string | null
    local: string | null
    expansiva: boolean
    categorias_alvo: string[]
    flyer_url?: string | null
}

const DATA = /^\d{4}-\d{2}-\d{2}$/
const HORA = /^\d{2}:\d{2}(:\d{2})?$/

const textoOuNull = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null)

/**
 * Lê só os campos do formulário (status, created_by, disparo etc. nunca vêm da tela). Devolve o erro
 * em texto ou os dados prontos para gravar. `todaRede` grava unidade nula e `expansiva`, como antes.
 */
export function lerDadosEventoPontual(body: unknown): { erro: string } | { dados: DadosEventoPontual } {
    const b = (body ?? {}) as Record<string, unknown>
    const titulo = textoOuNull(b.titulo)
    const dataInicio = textoOuNull(b.data_inicio)
    const dataFim = textoOuNull(b.data_fim)
    const todaRede = b.expansiva === true
    const unidade = todaRede ? null : textoOuNull(b.unidade_cuca)

    if (!titulo || !dataInicio || !dataFim || (!todaRede && !unidade)) {
        return { erro: "Preencha título, datas e unidade (ou Toda a Rede)" }
    }
    if (!DATA.test(dataInicio) || !DATA.test(dataFim)) return { erro: "Data inválida" }
    if (dataFim < dataInicio) return { erro: "A data fim não pode ser antes da data início" }

    const horaInicio = textoOuNull(b.hora_inicio)
    const horaFim = textoOuNull(b.hora_fim)
    if ((horaInicio && !HORA.test(horaInicio)) || (horaFim && !HORA.test(horaFim))) return { erro: "Hora inválida" }

    const categorias = Array.isArray(b.categorias_alvo) ? b.categorias_alvo.filter((c): c is string => typeof c === "string") : []

    const dados: DadosEventoPontual = {
        titulo,
        descricao: textoOuNull(b.descricao),
        unidade_cuca: unidade,
        data_evento: dataInicio,
        data_inicio: dataInicio,
        data_fim: dataFim,
        hora_inicio: horaInicio,
        hora_fim: horaFim,
        local: textoOuNull(b.local),
        expansiva: todaRede,
        categorias_alvo: categorias,
    }
    const flyer = textoOuNull(b.flyer_url)
    if (flyer) dados.flyer_url = flyer
    return { dados }
}
