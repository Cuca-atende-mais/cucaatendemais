import type { MotorFiltro } from "../logic.ts"

export type OrigemRetomada = "eventos_pontuais" | "ouvidoria_eventos" | "divulgacao"

/**
 * O motor exibido no painel ("pontual"/"ouvidoria"/"divulgacao") não é o mesmo texto que o
 * endpoint do worker (/retomar-disparo/{origem}/{item_id}, S-WM-60) espera como `origem` —
 * pontual/ouvidoria mapeiam pro nome real da tabela de origem.
 */
const MOTOR_PARA_ORIGEM: Record<MotorFiltro, OrigemRetomada> = {
    pontual: "eventos_pontuais",
    ouvidoria: "ouvidoria_eventos",
    divulgacao: "divulgacao",
}

export function mapMotorParaOrigem(motor: string): OrigemRetomada | null {
    return MOTOR_PARA_ORIGEM[motor as MotorFiltro] ?? null
}

export type CorpoReenvioValido = { motor: MotorFiltro; origem: OrigemRetomada; item_id: string }

/**
 * Valida o corpo do POST /reenviar antes de gastar uma chamada HTTP ao worker — motor
 * desconhecido ou item_id ausente/vazio nunca deveriam chegar lá.
 */
export function validarCorpoReenvio(body: unknown): CorpoReenvioValido | { erro: string } {
    if (typeof body !== "object" || body === null) {
        return { erro: "Corpo da requisição inválido" }
    }
    const { motor, item_id } = body as { motor?: unknown; item_id?: unknown }

    if (typeof motor !== "string") {
        return { erro: "Campo obrigatório: motor" }
    }
    const origem = mapMotorParaOrigem(motor)
    if (!origem) {
        return { erro: `motor inválido: ${motor}. Use pontual, ouvidoria ou divulgacao.` }
    }

    if (typeof item_id !== "string" || item_id.trim() === "") {
        return { erro: "Campo obrigatório: item_id" }
    }

    return { motor: motor as MotorFiltro, origem, item_id }
}
