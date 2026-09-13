// S-PROG-17: permissões detalhadas da programação pontual. Cada opção é uma linha na tela de Perfis e
// em sys_permissions, de ação única (o "liberado" fica em `can_read`). Prefixo `pgp_` para não colidir
// com a checagem por prefixo de has_permission ('programacao', 'divulgacao', 'developer') nem com `pgm_`.
import { ACAO_UNICA, type GrupoPermissao, type ModuloPermissao } from "./catalogo-programacao-mensal"

export const PGP = {
    ver: "pgp_ver",
    criar: "pgp_criar",
    editar: "pgp_editar",
    autorizar: "pgp_autorizar",
    devolver: "pgp_devolver",
    disparar: "pgp_disparar",
    cancelar: "pgp_cancelar",
    excluir: "pgp_excluir",
} as const

export const GRUPOS_PROGRAMACAO_PONTUAL: GrupoPermissao[] = [
    {
        category: "Programação Pontual",
        modules: [
            { id: PGP.ver, label: "Ver eventos", acoes: ACAO_UNICA },
            { id: PGP.criar, label: "Criar evento", acoes: ACAO_UNICA },
            { id: PGP.editar, label: "Editar evento", acoes: ACAO_UNICA },
            { id: PGP.autorizar, label: "Autorizar evento", acoes: ACAO_UNICA },
            { id: PGP.devolver, label: "Devolver para ajuste (com motivo)", acoes: ACAO_UNICA },
            { id: PGP.disparar, label: "Disparar evento", acoes: ACAO_UNICA },
            { id: PGP.cancelar, label: "Cancelar evento", acoes: ACAO_UNICA },
            { id: PGP.excluir, label: "Excluir evento", acoes: ACAO_UNICA },
        ],
    },
]

export const MODULOS_PROGRAMACAO_PONTUAL: ModuloPermissao[] = GRUPOS_PROGRAMACAO_PONTUAL.flatMap(g => g.modules)

type Flags = { can_read: boolean; can_create: boolean; can_update: boolean; can_delete: boolean }

// Espelhamento a partir de `programacao_pontual` (espelhado em SQL na migration
// `s_prog_17_expand_programacao_pontual`; o teste confere que as duas batem). Excluir não é espelhado:
// hoje só as contas Developer excluem evento pontual.
export const ORIGEM_ESPELHAMENTO_PONTUAL: Record<string, keyof Flags | "nenhum"> = {
    [PGP.ver]: "can_read",
    [PGP.criar]: "can_create",
    [PGP.editar]: "can_update",
    [PGP.autorizar]: "can_update",
    [PGP.devolver]: "can_update",
    [PGP.disparar]: "can_update",
    [PGP.cancelar]: "can_update",
    [PGP.excluir]: "nenhum",
}

export function espelharPermissoesPontual(pontual: Flags): (Flags & { module: string })[] {
    return MODULOS_PROGRAMACAO_PONTUAL.map(m => {
        const origem = ORIGEM_ESPELHAMENTO_PONTUAL[m.id]
        return {
            module: m.id,
            can_read: origem === "nenhum" ? false : pontual[origem],
            can_create: false,
            can_update: false,
            can_delete: false,
        }
    })
}
