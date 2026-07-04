export type AcaoDivulgacao = "can_read" | "can_create"

export type PermissaoDivulgacao = {
    module: string
    can_read: boolean
    can_create: boolean
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
    permissoes: PermissaoDivulgacao[],
    acao: AcaoDivulgacao,
    developerEmails: string[],
): ResultadoAutorizacao {
    if (!user) return { autorizado: false, status: 401, error: "Não autenticado" }
    if (developerEmails.includes(user.email ?? "")) {
        return { autorizado: true, userId: user.id }
    }

    const autorizado = permissoes.some(
        permissao => permissao.module === "divulgacao" && permissao[acao],
    )
    if (!autorizado) {
        const nomeAcao = acao === "can_create" ? "criar disparos" : "acessar a Divulgação"
        return { autorizado: false, status: 403, error: `Sem permissão para ${nomeAcao}.` }
    }

    return { autorizado: true, userId: user.id }
}

export function periodoValido(mes: unknown, ano: unknown): mes is number {
    return Number.isInteger(mes) && Number(mes) >= 1 && Number(mes) <= 12 && Number.isInteger(ano)
}

export function mensagemDuplicata(
    disparo: { status: string } | null,
    mes: number,
    ano: number,
) {
    return disparo
        ? `Já existe um disparo ${disparo.status} para ${mes}/${ano}. Aguarde a conclusão antes de criar outro.`
        : null
}

export function erroConfiguracao(
    numero: { phone_number_id: string } | null,
    template: { nome: string; corpo_texto: string } | null,
) {
    if (!numero) return "Nenhum número Meta Institucional ativo está disponível para o disparo."
    if (!template) return "Nenhum template Meta Institucional ativo e aprovado está disponível para este número."
    return null
}

export function montarRegistroDisparo(params: {
    mes: number
    ano: number
    titulo: unknown
    corpoTemplate: string
    phoneNumberId: string
    totalLeads: number
    userId: string
}) {
    return {
        mes: params.mes,
        ano: params.ano,
        titulo: typeof params.titulo === "string" && params.titulo.trim()
            ? params.titulo.trim()
            : `Aviso Programação ${params.mes}/${params.ano}`,
        mensagem_template: params.corpoTemplate,
        instancia_uazapi: params.phoneNumberId,
        status: "pendente",
        total_leads: params.totalLeads,
        criado_por: params.userId,
    }
}
