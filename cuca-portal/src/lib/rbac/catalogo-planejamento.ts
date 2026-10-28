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
} as const

export const GRUPOS_PLANEJAMENTO: GrupoPermissao[] = [
    {
        category: "Planejamento 2027 — Projetos",
        modules: [
            { id: PLA_PROJ.ver, label: "Ver o menu Projetos, a lista e a página de cada projeto dos seus setores", acoes: ACAO_UNICA },
            { id: PLA_PROJ.criar, label: "Criar projeto (botão \"+ Novo Projeto\" e primeira gravação)", acoes: ACAO_UNICA },
            { id: PLA_PROJ.editar, label: "Editar projeto dos seus setores (inclusive retomar rascunho próprio)", acoes: ACAO_UNICA },
        ],
    },
]

export const MODULOS_PLANEJAMENTO: string[] = GRUPOS_PLANEJAMENTO.flatMap(g => g.modules.map(m => m.id))
