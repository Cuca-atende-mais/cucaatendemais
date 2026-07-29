export type AcaoAcompanhamentoEnvios = "can_read" | "can_update"

export type PermissaoAcompanhamentoEnvios = {
    module: string
    can_read: boolean
    can_update: boolean
}

type UsuarioAutenticado = {
    id: string
    email?: string | null
}

export type ResultadoAutorizacao =
    | { autorizado: true; userId: string }
    | { autorizado: false; status: 401 | 403; error: string }

export function avaliarAcesso(
    user: UsuarioAutenticado | null,
    permissoes: PermissaoAcompanhamentoEnvios[],
    acao: AcaoAcompanhamentoEnvios,
    developerEmails: string[],
): ResultadoAutorizacao {
    if (!user) return { autorizado: false, status: 401, error: "Não autenticado" }
    if (developerEmails.includes(user.email ?? "")) {
        return { autorizado: true, userId: user.id }
    }

    const autorizado = permissoes.some(
        permissao => permissao.module === "config_acompanhamento_envios" && permissao[acao],
    )
    if (!autorizado) {
        return { autorizado: false, status: 403, error: "Sem permissão para acessar o Acompanhamento de Envios." }
    }

    return { autorizado: true, userId: user.id }
}

export type MotorFiltro = "pontual" | "ouvidoria" | "divulgacao"

const MOTORES_VALIDOS: MotorFiltro[] = ["pontual", "ouvidoria", "divulgacao"]

/**
 * Valida os query params de filtro — nunca deixa passar um motor desconhecido pra RPC
 * (o Postgres aceitaria qualquer texto no p_motor, silenciosamente não retornando nada).
 */
export function validarFiltros(params: {
    motor?: string | null
    desde?: string | null
    ate?: string | null
}): { motor: MotorFiltro | null; desde: string | null; ate: string | null } | { erro: string } {
    let motor: MotorFiltro | null = null
    if (params.motor) {
        if (!MOTORES_VALIDOS.includes(params.motor as MotorFiltro)) {
            return { erro: `motor inválido: ${params.motor}. Use pontual, ouvidoria ou divulgacao.` }
        }
        motor = params.motor as MotorFiltro
    }

    for (const [nome, valor] of [["desde", params.desde], ["ate", params.ate]] as const) {
        if (valor && Number.isNaN(Date.parse(valor))) {
            return { erro: `${nome} inválido: ${valor}. Use uma data ISO (ex.: 2026-07-01).` }
        }
    }

    return { motor, desde: params.desde ?? null, ate: params.ate ?? null }
}
