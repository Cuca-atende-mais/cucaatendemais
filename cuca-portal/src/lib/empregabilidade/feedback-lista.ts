import { statusFeedback, type StatusFeedback } from "./feedback-solicitacao"
import { rotuloVaga, type TipoVaga } from "./feedback-tela"

// S-EMP-GES-08: regras da lista de feedbacks enviados que não dependem do banco — uma linha por vaga
// com o pedido mais recente (decisão 1), busca, filtro e o endereço da tela (lista x detalhe).

export interface PedidoDaLista {
    id: string
    vaga_id: string
    created_at: string
    enviado_por: string | null
    candidatos: number
    status_envio: string
    erro_envio: string | null
    expires_at: string | null
    respondido_em: string | null
    situacao: string | null
}

export interface LinhaFeedback {
    vaga_id: string
    empresa_id: string | null
    empresa_nome: string
    numero_vaga: number | null
    titulo: string | null
    tipo: TipoVaga
    pedidos: number
    ultimo: PedidoDaLista
}

/** Mais novo primeiro; no empate de data, o maior id, para o resultado não depender da ordem de chegada. */
function maisNovo(a: { created_at: string; id: string }, b: { created_at: string; id: string }): boolean {
    const ta = new Date(a.created_at).getTime()
    const tb = new Date(b.created_at).getTime()
    if (ta !== tb) return ta > tb
    return a.id > b.id
}

/** AC2: agrupa os pedidos por vaga — o pedido mais recente e quantos pedidos a vaga já recebeu. */
export function ultimoPedidoPorVaga<T extends { id: string; vaga_id: string; created_at: string }>(
    pedidos: T[],
): Map<string, { ultimo: T; total: number }> {
    const mapa = new Map<string, { ultimo: T; total: number }>()
    for (const p of pedidos) {
        const atual = mapa.get(p.vaga_id)
        if (!atual) {
            mapa.set(p.vaga_id, { ultimo: p, total: 1 })
            continue
        }
        atual.total += 1
        if (maisNovo(p, atual.ultimo)) atual.ultimo = p
    }
    return mapa
}

/** AC4: ordena pelo último envio, do mais novo ao mais antigo. */
export function ordenarPorUltimoEnvio(linhas: LinhaFeedback[]): LinhaFeedback[] {
    return [...linhas].sort((a, b) => (maisNovo(a.ultimo, b.ultimo) ? -1 : maisNovo(b.ultimo, a.ultimo) ? 1 : 0))
}

/** Busca sem diferença de maiúsculas e acentos. */
export function normalizarBusca(texto: string | null | undefined): string {
    return (texto ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim()
}

export const STATUS_FILTRO_TODOS = "todos"

/** Status oferecidos no filtro. "Substituída" fica de fora: o pedido mais recente nunca está substituído. */
export const STATUS_FILTRAVEIS: StatusFeedback[] = ["aguardando", "respondido", "em_analise", "expirado", "nao_enviado"]

export interface FiltroLista {
    busca?: string
    status?: StatusFeedback | typeof STATUS_FILTRO_TODOS | ""
    empresaId?: string
}

/** AC4 e AC5: busca por empresa ou vaga, status do feedback do último pedido e empresa. */
export function filtrarLista(linhas: LinhaFeedback[], filtro: FiltroLista, agora: Date = new Date()): LinhaFeedback[] {
    const termo = normalizarBusca(filtro.busca)
    const status = filtro.status && filtro.status !== STATUS_FILTRO_TODOS ? filtro.status : null
    return linhas.filter(l => {
        if (filtro.empresaId && l.empresa_id !== filtro.empresaId) return false
        if (status && statusFeedback(l.ultimo, agora) !== status) return false
        if (termo) {
            const alvo = normalizarBusca(`${l.empresa_nome} ${rotuloVaga(l)}`)
            if (!alvo.includes(termo)) return false
        }
        return true
    })
}

export const ROTA_FEEDBACK = "/empregabilidade/feedback"

/**
 * Endereço da tela (AC5-AC8): sem `vaga` é a lista; com `vaga` é o detalhe. `empresa` guarda o filtro
 * da lista, para o "Voltar para a lista" devolver a lista como estava antes do clique.
 */
export function urlFeedback(params: { empresa?: string | null; vaga?: string | null } = {}): string {
    const q = new URLSearchParams()
    if (params.empresa) q.set("empresa", params.empresa)
    if (params.vaga) q.set("vaga", params.vaga)
    const s = q.toString()
    return s ? `${ROTA_FEEDBACK}?${s}` : ROTA_FEEDBACK
}
