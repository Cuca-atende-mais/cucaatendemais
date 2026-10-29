import { ACAO_UNICA, type GrupoPermissao } from "./catalogo-programacao-mensal"

// Épico PLA (Planejamento 2027): uma permissão por ação, todas nascendo desmarcadas (D14).
// Prefixo `pla_`. `has_permission` casa `sys_permissions.module LIKE recurso || '%'` e, no LIKE, o `_`
// vale por qualquer caractere: nenhum id pode casar com outro id nem com um recurso já checado
// (ver catalogo-planejamento.test.ts). As próximas stories acrescentam os seus grupos aqui.
// A S-PLA-01 não cria permissão: o escopo por setor vem do cadastro do colaborador (sem setor = todos).
// Ação única: a matriz de Perfis grava só `can_read`, então toda checagem usa a ação 'read'.

// S-PLA-02: cada permissão vale só para a sua ação, sem exceção para o autor.
export const PLA_PROJ = {
    ver: "pla_proj_ver",
    criar: "pla_proj_criar",
    editar: "pla_proj_editar",
    duplicar: "pla_proj_duplicar",
    excluir: "pla_proj_excluir",
} as const

// S-PLA-03: troca manual de status, uma permissão por opção do seletor.
export const PLA_STATUS = {
    aprovado: "pla_status_aprovado",
    execucao: "pla_status_execucao",
    concluido: "pla_status_concluido",
    reprovado: "pla_status_reprovado",
    ficha: "pla_status_ficha",
} as const

export const GRUPOS_PLANEJAMENTO: GrupoPermissao[] = [
    {
        category: "Planejamento 2027 — Projetos",
        modules: [
            { id: PLA_PROJ.ver, label: "Ver o menu Projetos, a lista e a página de cada projeto dos seus setores", acoes: ACAO_UNICA },
            { id: PLA_PROJ.criar, label: "Criar projeto (botão \"+ Novo Projeto\" e primeira gravação)", acoes: ACAO_UNICA },
            { id: PLA_PROJ.editar, label: "Editar projeto dos seus setores (inclusive retomar rascunho próprio)", acoes: ACAO_UNICA },
            { id: PLA_PROJ.duplicar, label: "Duplicar projeto dos seus setores (a cópia nasce Em construção)", acoes: ACAO_UNICA },
            { id: PLA_PROJ.excluir, label: "Excluir projeto dos seus setores (sai de todas as telas; o dado fica guardado)", acoes: ACAO_UNICA },
        ],
    },
    {
        category: "Planejamento 2027 — Status",
        modules: [
            { id: PLA_STATUS.aprovado, label: "Marcar projeto como Aprovado", acoes: ACAO_UNICA },
            { id: PLA_STATUS.execucao, label: "Marcar projeto como Em execução", acoes: ACAO_UNICA },
            { id: PLA_STATUS.concluido, label: "Marcar projeto como Concluído", acoes: ACAO_UNICA },
            { id: PLA_STATUS.reprovado, label: "Marcar projeto como Reprovado", acoes: ACAO_UNICA },
            { id: PLA_STATUS.ficha, label: "Voltar o projeto ao status da ficha (Em construção ou Projeto salvo)", acoes: ACAO_UNICA },
        ],
    },
]

export const MODULOS_PLANEJAMENTO: string[] = GRUPOS_PLANEJAMENTO.flatMap(g => g.modules.map(m => m.id))
