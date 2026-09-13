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
