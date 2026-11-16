// S-INST-QUAL-08: avisos da rede com data de validade, na tela da Base de Conhecimento Global.
// Uma permissão por ação, nascendo desmarcadas (sem linha em `sys_permissions` = sem acesso). Ver a
// lista de avisos usa o "Ver base global" (`pgr_ver`), que já abre a tela. Prefixo `avs_`: não casa,
// pelo LIKE do has_permission (`_` é curinga), com nenhum recurso checado hoje (teste de colisão).
import { ACAO_UNICA, type GrupoPermissao, type ModuloPermissao } from "./catalogo-programacao-mensal"

export const AVS = {
    criar: "avs_criar",
    editar: "avs_editar",
    desativar: "avs_desativar",
} as const

export const GRUPOS_AVISOS: GrupoPermissao[] = [
    {
        category: "Avisos da Rede",
        modules: [
            { id: AVS.criar, label: "Criar aviso", acoes: ACAO_UNICA },
            { id: AVS.editar, label: "Editar aviso", acoes: ACAO_UNICA },
            { id: AVS.desativar, label: "Desativar aviso", acoes: ACAO_UNICA },
        ],
    },
]

export const MODULOS_AVISOS: ModuloPermissao[] = GRUPOS_AVISOS[0].modules
