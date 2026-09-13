import { ACOES_CRUD, type CampoPermissao } from "./catalogo-programacao-mensal"

export type LinhaMatriz = {
    module: string
    can_read: boolean
    can_create: boolean
    can_update: boolean
    can_delete: boolean
}

// Marcar criar/editar/apagar marca "ver"; desmarcar "ver" desmarca o resto. Campos fora de `acoes`
// nunca ficam marcados.
export function marcarCampo<T extends LinhaMatriz>(
    linha: T, campo: CampoPermissao, marcado: boolean, acoes: CampoPermissao[] = ACOES_CRUD,
): T {
    if (!acoes.includes(campo)) return linha
    const nova = { ...linha, [campo]: marcado }
    if (marcado && campo !== "can_read") nova.can_read = true
    if (!marcado && campo === "can_read") {
        nova.can_create = false
        nova.can_update = false
        nova.can_delete = false
    }
    return limitarAcoes(nova, acoes)
}

export function marcarLinha<T extends LinhaMatriz>(linha: T, marcado: boolean, acoes: CampoPermissao[] = ACOES_CRUD): T {
    const nova = { ...linha, can_read: false, can_create: false, can_update: false, can_delete: false }
    for (const campo of acoes) nova[campo] = marcado
    return nova
}

export function limitarAcoes<T extends LinhaMatriz>(linha: T, acoes: CampoPermissao[] = ACOES_CRUD): T {
    const nova = { ...linha }
    for (const campo of ACOES_CRUD) if (!acoes.includes(campo)) nova[campo] = false
    return nova
}

export function linhaCompleta(linha: LinhaMatriz, acoes: CampoPermissao[] = ACOES_CRUD): boolean {
    return acoes.every(campo => linha[campo])
}
