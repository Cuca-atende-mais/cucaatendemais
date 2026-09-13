import { isDeveloperEmail } from "./developers"

export type OperacaoColaborador = "create" | "update" | "delete" | "resend-invite"

export type EntradaAcessoColaborador = {
    operacao: OperacaoColaborador
    emailQuemPede: string | null | undefined
    temPermissao: boolean
    emailAlvo?: string | null
    // Perfil que a requisição quer atribuir é o "Developer" (exclusivo das contas Developer)
    atribuiPerfilDeveloper?: boolean
}

export type ResultadoAcessoColaborador =
    | { permitido: true; developer: boolean }
    | { permitido: false; status: 403; error: string }

export const ACAO_POR_OPERACAO: Record<OperacaoColaborador, "create" | "update" | "delete"> = {
    create: "create",
    update: "update",
    delete: "delete",
    "resend-invite": "update",
}

export const NOME_PERFIL_DEVELOPER = "Developer"

export function avaliarAcessoColaborador(entrada: EntradaAcessoColaborador): ResultadoAcessoColaborador {
    if (isDeveloperEmail(entrada.emailQuemPede)) return { permitido: true, developer: true }

    if (!entrada.temPermissao) {
        return { permitido: false, status: 403, error: "Sem permissão para gerenciar colaboradores" }
    }

    if (isDeveloperEmail(entrada.emailAlvo)) {
        return { permitido: false, status: 403, error: "Somente um Developer pode alterar uma conta Developer" }
    }

    if (entrada.atribuiPerfilDeveloper) {
        return { permitido: false, status: 403, error: "O perfil Developer é exclusivo das contas Developer" }
    }

    return { permitido: true, developer: false }
}
