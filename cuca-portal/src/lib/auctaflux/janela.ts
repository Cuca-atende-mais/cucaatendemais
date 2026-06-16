// Janela de atendimento de 24h da Meta (WhatsApp Cloud API): resposta em texto livre só é permitida
// se o lead enviou mensagem nas últimas 24h. Base = ae_conversas.ultima_entrada_em (última msg RECEBIDA).
// Função PURA — reusada pela UI (desabilita o input) e pela rota de envio (rejeita server-side, AC#4).
// Fora da janela, só template aprovado (S-AE-09).

export const JANELA_24H_MS = 24 * 60 * 60 * 1000

// Verdadeiro se a janela de 24h está aberta para `ultimaEntradaEm`. Sem entrada → fechada.
export function janelaAberta(
    ultimaEntradaEm: string | null | undefined,
    agora: Date = new Date(),
): boolean {
    return restanteJanelaMs(ultimaEntradaEm, agora) > 0
}

// Milissegundos restantes até a janela fechar (0 se já fechada ou sem entrada do lead).
export function restanteJanelaMs(
    ultimaEntradaEm: string | null | undefined,
    agora: Date = new Date(),
): number {
    if (!ultimaEntradaEm) return 0
    const base = new Date(ultimaEntradaEm).getTime()
    if (Number.isNaN(base)) return 0
    return Math.max(0, base + JANELA_24H_MS - agora.getTime())
}
