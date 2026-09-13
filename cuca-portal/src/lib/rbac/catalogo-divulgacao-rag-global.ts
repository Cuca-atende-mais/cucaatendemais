// S-PROG-16: permissões detalhadas da Divulgação e da Base de Conhecimento Global. Opções de ação única
// (o "liberado" fica em `can_read`). A Divulgação reaproveita as duas opções `pgm_` da S-PROG-12/15 e
// ganha "Ver"; a base global usa o prefixo `pgr_`, que não colide com a checagem por prefixo de
// has_permission ('programacao', 'divulgacao', 'developer') nem com `pgm_`/`pgp_`.
import {
    ACAO_UNICA, MODULOS_DIVULGACAO, PGM_DIVULGACAO, type GrupoPermissao, type ModuloPermissao,
} from "./catalogo-programacao-mensal"

export const PGM_DIVULGACAO_VER = "pgm_divulgacao_ver"

export const PGR = {
    ver: "pgr_ver",
    cadastrar: "pgr_cadastrar",
    editar: "pgr_editar",
    ativar: "pgr_ativar",
    excluir: "pgr_excluir",
    reindexar: "pgr_reindexar",
    gerarResumo: "pgr_gerar_resumo",
} as const

export const GRUPOS_DIVULGACAO_RAG_GLOBAL: GrupoPermissao[] = [
    {
        category: "Divulgação",
        modules: [
            { id: PGM_DIVULGACAO_VER, label: "Ver Divulgação", acoes: ACAO_UNICA },
            ...MODULOS_DIVULGACAO,
        ],
    },
    {
        category: "Base de Conhecimento Global",
        modules: [
            { id: PGR.ver, label: "Ver base global", acoes: ACAO_UNICA },
            { id: PGR.cadastrar, label: "Cadastrar documento", acoes: ACAO_UNICA },
            { id: PGR.editar, label: "Editar documento", acoes: ACAO_UNICA },
            { id: PGR.ativar, label: "Ativar/desativar documento", acoes: ACAO_UNICA },
            { id: PGR.excluir, label: "Excluir documento", acoes: ACAO_UNICA },
            { id: PGR.reindexar, label: "Reindexar documento", acoes: ACAO_UNICA },
            { id: PGR.gerarResumo, label: "Gerar resumo da rede", acoes: ACAO_UNICA },
        ],
    },
]

export const MODULOS_RAG_GLOBAL: ModuloPermissao[] = GRUPOS_DIVULGACAO_RAG_GLOBAL[1].modules

type Linha = { module: string; can_read: boolean; can_create: boolean; can_update: boolean; can_delete: boolean }

/** Aprovar RAG ou Disparar sem "Ver Divulgação" não abrem a página: ao salvar, "Ver" é marcado junto. */
export function completarVerDivulgacao<T extends Linha>(linhas: T[]): T[] {
    const precisaVer = linhas.some(l => (l.module === PGM_DIVULGACAO.aprovarRag || l.module === PGM_DIVULGACAO.dispararGlobal) && l.can_read)
    if (!precisaVer) return linhas
    return linhas.map(l => (l.module === PGM_DIVULGACAO_VER ? { ...l, can_read: true } : l))
}

type Flags = { can_read: boolean; can_create: boolean; can_update: boolean; can_delete: boolean }

// Espelhamento a partir de `programacao_rag_global` (espelhado em SQL na migration
// `s_prog_16_expand_divulgacao_rag_global`; o teste confere que as duas batem).
export const ORIGEM_ESPELHAMENTO_RAG_GLOBAL: Record<string, keyof Flags> = {
    [PGR.ver]: "can_read",
    [PGR.cadastrar]: "can_create",
    [PGR.editar]: "can_update",
    [PGR.ativar]: "can_update",
    [PGR.reindexar]: "can_update",
    [PGR.gerarResumo]: "can_update",
    [PGR.excluir]: "can_delete",
}

export function espelharRagGlobal(antiga: Flags): Linha[] {
    return MODULOS_RAG_GLOBAL.map(m => ({
        module: m.id,
        can_read: antiga[ORIGEM_ESPELHAMENTO_RAG_GLOBAL[m.id]],
        can_create: false,
        can_update: false,
        can_delete: false,
    }))
}

/** "Ver Divulgação" para quem via a página antes: módulo `divulgacao` (ler) ou uma das duas opções. */
export function espelharVerDivulgacao(divulgacaoLeitura: boolean, aprovarRag: boolean, disparar: boolean): boolean {
    return divulgacaoLeitura || aprovarRag || disparar
}
