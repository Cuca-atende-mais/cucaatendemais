/**
 * Validação do daily_limit por número (S-WM-59, item 3). Espelha a mesma regra usada no
 * worker (_get_daily_limit_by_phone_sync / _warn_if_daily_limit_above_tier_sync,
 * worker/campanhas_engine.py, S-WM-60):
 *
 * - messaging_limit_tier NULL (camada da Meta ainda não confirmada/registrada pra este
 *   número) = "não sei", não "inconsistente" — o worker não bloqueia disparo nesse caso
 *   (só deixa de logar o aviso de "acima da camada"), então esta validação também não
 *   bloqueia a edição. Bloquear seria mais restritivo que o próprio worker que vai
 *   consumir o valor.
 * - messaging_limit_tier definido: daily_limit nunca pode passar dele — bloqueado tanto no
 *   frontend (Junior, item 3) quanto aqui (nunca confiar só no frontend).
 */
export function validarNovoDailyLimit(
    novoLimite: unknown,
    messagingLimitTier: number | null,
): { valido: true; valor: number } | { valido: false; erro: string } {
    if (typeof novoLimite !== "number" || !Number.isInteger(novoLimite)) {
        return { valido: false, erro: "daily_limit precisa ser um número inteiro" }
    }
    if (novoLimite <= 0) {
        return { valido: false, erro: "daily_limit precisa ser maior que zero" }
    }
    if (messagingLimitTier !== null && novoLimite > messagingLimitTier) {
        return {
            valido: false,
            erro: `daily_limit (${novoLimite}) não pode passar da camada de mensageria confirmada pela Meta pra este número (${messagingLimitTier})`,
        }
    }
    return { valido: true, valor: novoLimite }
}

export function validarCorpoAtualizacaoLimite(body: unknown): { phone_number_id: string; daily_limit: unknown } | { erro: string } {
    if (typeof body !== "object" || body === null) {
        return { erro: "Corpo da requisição inválido" }
    }
    const { phone_number_id, daily_limit } = body as { phone_number_id?: unknown; daily_limit?: unknown }
    if (typeof phone_number_id !== "string" || phone_number_id.trim() === "") {
        return { erro: "Campo obrigatório: phone_number_id" }
    }
    if (daily_limit === undefined) {
        return { erro: "Campo obrigatório: daily_limit" }
    }
    return { phone_number_id, daily_limit }
}
