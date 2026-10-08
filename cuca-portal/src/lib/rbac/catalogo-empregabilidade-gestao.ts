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
} as const

export const GRUPOS_EMPREGABILIDADE_GESTAO: GrupoPermissao[] = [
    {
        category: "Empregabilidade — Feedback das empresas",
        modules: [
            { id: EPM_FEEDBACK.ver, label: "Ver a tela Feedback (empresa, vaga, contato e candidatos enviados)", acoes: ACAO_UNICA },
            { id: EPM_FEEDBACK.statusIndividual, label: "Mudar o status de um candidato por vez", acoes: ACAO_UNICA },
            { id: EPM_FEEDBACK.statusLote, label: "Mudar o status de vários candidatos em lote", acoes: ACAO_UNICA },
            { id: EPM_FEEDBACK.contatoEditar, label: "Editar o contato da vaga (nome, telefone, e-mail)", acoes: ACAO_UNICA },
        ],
    },
]

export const MODULOS_EMPREGABILIDADE_GESTAO: string[] = GRUPOS_EMPREGABILIDADE_GESTAO.flatMap(g => g.modules.map(m => m.id))
