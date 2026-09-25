// S-PROG-12: permissões detalhadas da programação mensal. Cada item vira uma linha na tela de
// Perfis e uma linha em sys_permissions. Prefixo `pgm_` para não colidir com a checagem por prefixo
// de has_permission ('programacao', 'divulgacao', 'developer').
export type CampoPermissao = "can_read" | "can_create" | "can_update" | "can_delete"

export type ModuloPermissao = {
    id: string
    label: string
    // Campos exibidos na matriz (padrão: as 4 ações). Opção de ação única usa só `can_read` ("Liberar").
    acoes?: CampoPermissao[]
}

export type GrupoPermissao = { category: string; modules: ModuloPermissao[] }

export const ACOES_CRUD: CampoPermissao[] = ["can_read", "can_create", "can_update", "can_delete"]
export const ACAO_UNICA: CampoPermissao[] = ["can_read"]

export const CATEGORIAS_PROGRAMACAO = [
    { slug: "esportes", nome: "ESPORTES", rotulo: "Esportes" },
    { slug: "cursos", nome: "CURSOS", rotulo: "Cursos" },
    { slug: "dia_a_dia", nome: "DIA A DIA", rotulo: "Dia a Dia" },
    { slug: "especiais", nome: "ESPECIAIS", rotulo: "Especiais" },
] as const

export type SlugCategoria = (typeof CATEGORIAS_PROGRAMACAO)[number]["slug"]

export const PGM_GERAL = {
    lista: "pgm_lista",
    criarZero: "pgm_criar_zero",
    duplicar: "pgm_duplicar",
    importarPlanilha: "pgm_importar_planilha",
    excluirProgramacao: "pgm_excluir_programacao",
    exportar: "pgm_exportar",
    historico: "pgm_historico",
} as const

// S-PROG-18: tela "Exportar planilha" (consolidada por unidade). Fora de PGM_GERAL de propósito:
// PGM_GERAL entra no espelhamento da S-PROG-12 e estas opções nascem desmarcadas em todos os perfis
// (decisão do Junior, 2026-09-25) — a Rede Cuca marca depois na tela de Perfis.
export const PGM_EXPORTACAO_CONSOLIDADA = {
    ver: "pgm_exportacao_consolidada_ver",
    exportar: "pgm_exportacao_consolidada_exportar",
} as const

export const PGM_DIVULGACAO = {
    aprovarRag: "pgm_rag_aprovar",
    dispararGlobal: "pgm_disparo_global",
} as const

export const pgmCategoria = (slug: SlugCategoria) => ({
    atividades: `pgm_${slug}_atividades`,
    enviar: `pgm_${slug}_enviar`,
    autorizar: `pgm_${slug}_autorizar`,
    devolver: `pgm_${slug}_devolver`,
    reabrir: `pgm_${slug}_reabrir`,
    // Decisão do Junior (2026-09-21): excluir é por categoria, não mais a programação inteira.
    excluirMinha: `pgm_${slug}_excluir_minha`,
    excluirEnviada: `pgm_${slug}_excluir_enviada`,
})

export const GRUPOS_PROGRAMACAO_MENSAL: GrupoPermissao[] = [
    {
        category: "Programação Mensal — Geral",
        modules: [
            { id: PGM_GERAL.lista, label: "Ver lista de programações", acoes: ACAO_UNICA },
            { id: PGM_GERAL.criarZero, label: "Criar programação do zero", acoes: ACAO_UNICA },
            { id: PGM_GERAL.duplicar, label: "Duplicar mês anterior", acoes: ACAO_UNICA },
            { id: PGM_GERAL.importarPlanilha, label: "Importar planilha", acoes: ACAO_UNICA },
            { id: PGM_GERAL.exportar, label: "Exportar (XLSX/PDF)", acoes: ACAO_UNICA },
            { id: PGM_GERAL.historico, label: "Ver histórico", acoes: ACAO_UNICA },
        ],
    },
    {
        category: "Programação Mensal — Exportação consolidada",
        modules: [
            { id: PGM_EXPORTACAO_CONSOLIDADA.ver, label: "Ver a tela de exportação consolidada", acoes: ACAO_UNICA },
            { id: PGM_EXPORTACAO_CONSOLIDADA.exportar, label: "Baixar a planilha consolidada", acoes: ACAO_UNICA },
        ],
    },
    ...CATEGORIAS_PROGRAMACAO.map(c => {
        const ids = pgmCategoria(c.slug)
        return {
            category: `Programação Mensal — ${c.rotulo}`,
            modules: [
                { id: ids.atividades, label: `${c.rotulo}: atividades (ver, criar, editar, excluir)`, acoes: ACOES_CRUD },
                { id: ids.enviar, label: `${c.rotulo}: enviar para autorização`, acoes: ACAO_UNICA },
                { id: ids.autorizar, label: `${c.rotulo}: autorizar`, acoes: ACAO_UNICA },
                { id: ids.devolver, label: `${c.rotulo}: devolver para ajuste`, acoes: ACAO_UNICA },
                { id: ids.reabrir, label: `${c.rotulo}: reabrir autorizada`, acoes: ACAO_UNICA },
                { id: ids.excluirMinha, label: `${c.rotulo}: excluir minha programação (em rascunho)`, acoes: ACAO_UNICA },
                { id: ids.excluirEnviada, label: `${c.rotulo}: excluir programação enviada ou autorizada (antes de publicar)`, acoes: ACAO_UNICA },
            ],
        }
    }),
]

// S-PROG-16: as duas opções da Divulgação passaram para o grupo "Divulgação" (catalogo-divulgacao-rag-global.ts).
// Continuam em MODULOS_PROGRAMACAO_MENSAL porque o espelhamento da S-PROG-12 as criou.
export const MODULOS_DIVULGACAO: ModuloPermissao[] = [
    { id: PGM_DIVULGACAO.aprovarRag, label: "Aprovar RAG do mês", acoes: ACAO_UNICA },
    { id: PGM_DIVULGACAO.dispararGlobal, label: "Disparar Aviso Global", acoes: ACAO_UNICA },
]

export const MODULOS_PROGRAMACAO_MENSAL: ModuloPermissao[] = [...GRUPOS_PROGRAMACAO_MENSAL.flatMap(g => g.modules), ...MODULOS_DIVULGACAO]

// Módulos que a migration `s_prog_12_espelha_permissoes_programacao` criou (histórico, não muda):
// `pgm_excluir_programacao` saiu da tela e as opções de excluir por categoria vieram depois.
export const MODULOS_ESPELHADOS_S_PROG_12: string[] = [
    ...Object.values(PGM_GERAL),
    ...CATEGORIAS_PROGRAMACAO.flatMap(c => {
        const ids = pgmCategoria(c.slug)
        return [ids.atividades, ids.enviar, ids.autorizar, ids.devolver, ids.reabrir]
    }),
    ...MODULOS_DIVULGACAO.map(m => m.id),
]

type Flags = { can_read: boolean; can_create: boolean; can_update: boolean; can_delete: boolean }
export type LinhaPermissao = Flags & { module: string }

const unica = (module: string, liberado: boolean): LinhaPermissao =>
    ({ module, can_read: liberado, can_create: false, can_update: false, can_delete: false })

// Item 4: equivalência a partir de programacao_mensal (e divulgacao para o disparo). Espelhada em SQL
// na migration `s_prog_12_espelha_permissoes_programacao`; o teste confere que as duas batem.
export function espelharPermissoes(mensal: Flags, divulgacao?: Flags | null): LinhaPermissao[] {
    const linhas: LinhaPermissao[] = [
        unica(PGM_GERAL.lista, mensal.can_read),
        unica(PGM_GERAL.historico, mensal.can_read),
        unica(PGM_GERAL.exportar, mensal.can_read),
        unica(PGM_GERAL.criarZero, mensal.can_create),
        unica(PGM_GERAL.duplicar, mensal.can_create),
        unica(PGM_GERAL.importarPlanilha, mensal.can_create),
        unica(PGM_GERAL.excluirProgramacao, mensal.can_delete),
    ]
    for (const c of CATEGORIAS_PROGRAMACAO) {
        const ids = pgmCategoria(c.slug)
        linhas.push(
            { module: ids.atividades, can_read: mensal.can_read, can_create: mensal.can_create, can_update: mensal.can_update, can_delete: mensal.can_delete },
            unica(ids.enviar, mensal.can_update),
            unica(ids.autorizar, mensal.can_update),
            unica(ids.devolver, mensal.can_update),
            unica(ids.reabrir, mensal.can_update),
        )
    }
    linhas.push(unica(PGM_DIVULGACAO.aprovarRag, false))
    linhas.push(unica(PGM_DIVULGACAO.dispararGlobal, divulgacao?.can_create ?? false))
    return linhas
}
