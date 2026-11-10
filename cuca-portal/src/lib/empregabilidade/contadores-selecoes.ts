// S-EMP-GES-10: contadores de seleções de cada talento do Banco de Talentos.
// A contagem é feita no banco (`emp_contadores_selecoes`); aqui ficam a validação do pedido,
// o formato da resposta e os textos mostrados nas telas.

export const MAX_IDS_CONTADORES = 100

export interface ContadoresSelecoes {
    ativas: number
    participou: number
}

export type MapaContadores = Record<string, ContadoresSelecoes>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ValidacaoIds = { ok: true; ids: string[] } | { ok: false; erro: string }

/** Confere o corpo `{ ids: uuid[] }`: lista de UUIDs, sem repetição, no máximo 100. */
export function validarIdsContadores(corpo: unknown): ValidacaoIds {
    const ids = (corpo as { ids?: unknown } | null)?.ids
    if (!Array.isArray(ids)) return { ok: false, erro: "Envie a lista de talentos em `ids`." }
    if (!ids.every(id => typeof id === "string" && UUID.test(id))) return { ok: false, erro: "Algum id de talento é inválido." }
    const unicos = [...new Set(ids as string[])]
    if (unicos.length > MAX_IDS_CONTADORES) {
        return { ok: false, erro: `No máximo ${MAX_IDS_CONTADORES} talentos por pedido.` }
    }
    return { ok: true, ids: unicos }
}

interface LinhaBanco {
    talent_id: string
    selecoes_ativas: number | null
    selecoes_participou: number | null
}

/** Converte as linhas da função do banco no mapa da resposta: só os dois números por talento. */
export function montarMapaContadores(linhas: LinhaBanco[] | null | undefined): MapaContadores {
    const mapa: MapaContadores = {}
    for (const l of linhas ?? []) {
        mapa[l.talent_id] = { ativas: l.selecoes_ativas ?? 0, participou: l.selecoes_participou ?? 0 }
    }
    return mapa
}

export const TITULO_ATIVAS = "Seleções ativas"
export const TITULO_PARTICIPOU = "Seleções de que já participou"

/** Texto do card da triagem: "Em 2 seleções ativas · Participou de 5". "—" quando não há dado. */
export function textoContadores(c: ContadoresSelecoes | null | undefined): string {
    if (!c) return "—"
    const ativas = c.ativas === 1 ? "Em 1 seleção ativa" : `Em ${c.ativas} seleções ativas`
    return `${ativas} · Participou de ${c.participou}`
}

/** Rótulo do status do talento. Depois da S-EMP-GES-10 só existem "disponivel" e "contratado". */
export function rotuloStatusTalento(status: string | null | undefined): string {
    if (status === "disponivel") return "Disponível"
    if (status === "contratado") return "Contratado"
    return status || "—"
}

/**
 * Ids dos talentos já aprovados para a vaga, a partir das candidaturas dela
 * (observacoes = "banco_talentos:<id do talento>"). Usado no selo "✓ Aprovado" da triagem.
 */
export function talentosAprovadosNaVaga(candidaturas: { observacoes?: string | null }[]): Set<string> {
    const ids = new Set<string>()
    for (const c of candidaturas) {
        const obs = c.observacoes ?? ""
        if (!obs.startsWith("banco_talentos:")) continue
        const id = obs.slice("banco_talentos:".length).trim()
        if (/^[0-9a-f-]{36}$/i.test(id)) ids.add(id)
    }
    return ids
}
