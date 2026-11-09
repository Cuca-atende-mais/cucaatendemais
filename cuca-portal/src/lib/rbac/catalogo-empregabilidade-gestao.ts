import { ACAO_UNICA, type GrupoPermissao } from "./catalogo-programacao-mensal"

// Épico EMP-GES: permissões detalhadas do Emprega+ (decisão do Junior, 2026-10-08 — tudo que é criado
// entra no RBAC com uma permissão por ação, nascendo desmarcada; a Rede Cuca decide quem vê e quem mexe).
// Prefixo `epm_`: `has_permission` casa `module LIKE recurso || '%'`, então um id que começasse com um
// recurso já checado (ex.: `empreg_vagas_…`) concederia a permissão antiga por engano.

export const EPM_FEEDBACK = {
    ver: "epm_feedback_ver",
    statusIndividual: "epm_feedback_status_individual",
    statusLote: "epm_feedback_status_lote",
    contatoEditar: "epm_feedback_contato_editar",
    solicitar: "epm_feedback_solicitar",
    reenviar: "epm_feedback_reenviar",
} as const

// S-EMP-GES-04 (AC13): relatório Emprega+.
export const EPM_RELATORIO = {
    ver: "epm_relatorio_ver",
    exportar: "epm_relatorio_exportar",
    rede: "epm_relatorio_rede",
} as const

// S-EMP-GES-09 (AC9): relatório "Situação de vagas" (vagas e seleções abertas).
export const EPM_SITUACAO_VAGAS = {
    ver: "epm_vagas_abertas_ver",
    exportar: "epm_vagas_abertas_exportar",
    rede: "epm_vagas_abertas_rede",
} as const

export const GRUPOS_EMPREGABILIDADE_GESTAO: GrupoPermissao[] = [
    {
        category: "Empregabilidade — Feedback das empresas",
        modules: [
            { id: EPM_FEEDBACK.ver, label: "Ver a tela Feedback (empresa, vaga, contato e candidatos enviados)", acoes: ACAO_UNICA },
            { id: EPM_FEEDBACK.statusIndividual, label: "Mudar o status de um candidato por vez", acoes: ACAO_UNICA },
            { id: EPM_FEEDBACK.statusLote, label: "Mudar o status de vários candidatos em lote", acoes: ACAO_UNICA },
            { id: EPM_FEEDBACK.contatoEditar, label: "Editar o contato da vaga (nome, telefone, e-mail)", acoes: ACAO_UNICA },
            { id: EPM_FEEDBACK.solicitar, label: "Solicitar feedback à empresa", acoes: ACAO_UNICA },
            { id: EPM_FEEDBACK.reenviar, label: "Reenviar solicitação de feedback", acoes: ACAO_UNICA },
        ],
    },
    {
        category: "Empregabilidade — Relatório Emprega+",
        modules: [
            { id: EPM_RELATORIO.ver, label: "Ver o relatório (menu Relatórios e prévia na tela)", acoes: ACAO_UNICA },
            { id: EPM_RELATORIO.exportar, label: "Baixar o relatório em Excel", acoes: ACAO_UNICA },
            { id: EPM_RELATORIO.rede, label: "Ver todas as unidades e o consolidado da rede (sem ela, só a própria unidade)", acoes: ACAO_UNICA },
        ],
    },
    {
        category: "Empregabilidade — Relatório de vagas e seleções abertas",
        modules: [
            { id: EPM_SITUACAO_VAGAS.ver, label: "Ver o relatório Situação de vagas (menu Relatórios)", acoes: ACAO_UNICA },
            { id: EPM_SITUACAO_VAGAS.exportar, label: "Baixar o relatório Situação de vagas em Excel", acoes: ACAO_UNICA },
            { id: EPM_SITUACAO_VAGAS.rede, label: "Ver as vagas e seleções de todas as unidades (sem ela, só a própria unidade)", acoes: ACAO_UNICA },
        ],
    },
]

export const MODULOS_EMPREGABILIDADE_GESTAO: string[] = GRUPOS_EMPREGABILIDADE_GESTAO.flatMap(g => g.modules.map(m => m.id))
