// S-PLA-01: o que fazer com o campo "Setores do Planejamento" recebido pelas rotas de colaborador.
// Campo ausente → o vínculo atual não muda (chamadores antigos seguem iguais).
// Campo presente → só aceita ids de setores existentes; lista vazia = colaborador atua em todos os setores.
// Quem pode gravar é a mesma autorização de hoje do cadastro de colaborador (perfil, RBAC).

export const CAMPO_SETORES_PLANEJAMENTO = "setores_planejamento"

export type DecisaoVinculoSetores =
    | { tipo: "manter" }
    | { tipo: "substituir"; setores: string[] }
    | { tipo: "erro"; status: 400; error: string }

export function decidirVinculoSetores(campo: unknown, setoresValidos: readonly string[]): DecisaoVinculoSetores {
    if (campo === undefined) return { tipo: "manter" }
    if (!Array.isArray(campo) || campo.some(s => typeof s !== "string")) {
        return { tipo: "erro", status: 400, error: "Setores do Planejamento inválidos." }
    }
    const setores = [...new Set(campo as string[])]
    const desconhecidos = setores.filter(s => !setoresValidos.includes(s))
    if (desconhecidos.length > 0) {
        return { tipo: "erro", status: 400, error: `Setor do Planejamento desconhecido: ${desconhecidos.join(", ")}.` }
    }
    return { tipo: "substituir", setores }
}

// Lado da tela: o campo só vai no corpo quando as caixas estão na tela (lista de setores carregada).
// Sem a lista, mandar `[]` trocaria os setores do colaborador sem ninguém ver.
export function corpoSetoresPlanejamento(setoresCarregados: number, selecionados: string[]): Record<string, string[]> {
    if (setoresCarregados === 0) return {}
    return { [CAMPO_SETORES_PLANEJAMENTO]: selecionados }
}
