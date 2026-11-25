/**
 * S-EMP-GES-13 (AC18): largura das colunas que cada usuário deixou numa grade, guardada no navegador
 * dele (localStorage). Qualquer valor estranho (JSON quebrado, coluna que não existe mais, número fora
 * dos limites) é descartado e a coluna volta ao tamanho padrão.
 */

export type LimitesColuna = { minimo: number; maximo: number }
export type Larguras = Record<string, number>

type ArmazenamentoSimples = Pick<Storage, "getItem" | "setItem" | "removeItem">

const VERSAO = 1

function armazenamentoPadrao(): ArmazenamentoSimples | null {
    try {
        return typeof window !== "undefined" && window.localStorage ? window.localStorage : null
    } catch {
        // Navegador com armazenamento bloqueado (modo privado restrito): segue sem persistir.
        return null
    }
}

/** Mantém só colunas conhecidas e números finitos, dentro dos limites de cada uma. */
export function sanearLarguras(bruto: unknown, limites: Record<string, LimitesColuna>): Larguras {
    if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return {}
    const saida: Larguras = {}
    for (const [id, valor] of Object.entries(bruto as Record<string, unknown>)) {
        const lim = limites[id]
        if (!lim) continue
        if (typeof valor !== "number" || !Number.isFinite(valor)) continue
        saida[id] = Math.round(Math.min(lim.maximo, Math.max(lim.minimo, valor)))
    }
    return saida
}

/**
 * Gravar só depois de uma mudança feita pelo usuário, e não no meio do arraste (grava quando ele
 * termina). Nunca na montagem da tela: ali o estado ainda está vazio e a gravação apagaria a largura
 * salva antes de ela ser lida (com a montagem dupla do React em desenvolvimento, ela se perdia).
 */
export function deveGravarLarguras({ alteradoPeloUsuario, redimensionando }: { alteradoPeloUsuario: boolean; redimensionando: boolean }): boolean {
    return alteradoPeloUsuario && !redimensionando
}

export function lerLarguras(
    chave: string,
    limites: Record<string, LimitesColuna>,
    armazenamento: ArmazenamentoSimples | null = armazenamentoPadrao(),
): Larguras {
    if (!armazenamento) return {}
    try {
        const texto = armazenamento.getItem(chave)
        if (!texto) return {}
        const dado = JSON.parse(texto) as { v?: unknown; larguras?: unknown }
        if (!dado || dado.v !== VERSAO) return {}
        return sanearLarguras(dado.larguras, limites)
    } catch {
        return {}
    }
}

export function salvarLarguras(
    chave: string,
    larguras: Larguras,
    armazenamento: ArmazenamentoSimples | null = armazenamentoPadrao(),
): void {
    if (!armazenamento) return
    try {
        if (Object.keys(larguras).length === 0) armazenamento.removeItem(chave)
        else armazenamento.setItem(chave, JSON.stringify({ v: VERSAO, larguras }))
    } catch {
        // Cota cheia ou armazenamento bloqueado: a grade continua funcionando, só não lembra.
    }
}

export function apagarLarguras(chave: string, armazenamento: ArmazenamentoSimples | null = armazenamentoPadrao()): void {
    if (!armazenamento) return
    try {
        armazenamento.removeItem(chave)
    } catch {
        /* ignora */
    }
}
