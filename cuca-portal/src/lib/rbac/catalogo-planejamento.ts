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

// S-PLA-04: acompanhamento do projeto. Nomes escolhidos para nenhum ser prefixo de outro no LIKE
// (por isso `pla_valid_dar`/`pla_valid_retirar`, e não `pla_validar`). Toda ação também exige
// `pla_acomp_ver`: sem ela a seção Acompanhamento não aparece e o banco recusa a ação.
export const PLA_ACOMP = {
    ver: "pla_acomp_ver",
    comentCriar: "pla_coment_criar",
    comentEditar: "pla_coment_editar",
    comentExcluir: "pla_coment_excluir",
    correcaoPedir: "pla_correcao_pedir",
    correcaoResolver: "pla_correcao_resolver",
    validDar: "pla_valid_dar",
    validRetirar: "pla_valid_retirar",
    pendCriar: "pla_pend_criar",
    pendEditar: "pla_pend_editar",
    pendExcluir: "pla_pend_excluir",
    pendFeito: "pla_pend_feito",
} as const

// S-PLA-05: slides e PDFs. Só telas e botões: os dados vêm da mesma leitura do projeto (RLS da S-PLA-02,
// com setor e `pla_proj_ver`/`pla_proj_editar`); não há tabela nem função nova no banco.
export const PLA_APRES = {
    slidesVer: "pla_slides_ver",
    slidesApresentar: "pla_slides_apresentar",
    slidesPdf: "pla_slides_pdf",
    fichaPdf: "pla_ficha_pdf",
    // S-PLA-06: pauta de apresentações. Apresentar segue `pla_slides_apresentar`.
    pautaVer: "pla_apresent_ver",
    pautaOrdem: "pla_apresent_ordem",
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
    {
        category: "Planejamento 2027 — Acompanhamento",
        modules: [
            { id: PLA_ACOMP.ver, label: "Ver o acompanhamento do projeto (correções, comentários, validação, pendências, histórico e selos da lista). Necessária para as ações abaixo", acoes: ACAO_UNICA },
            { id: PLA_ACOMP.comentCriar, label: "Comentar no projeto (exige \"Ver o acompanhamento\")", acoes: ACAO_UNICA },
            { id: PLA_ACOMP.comentEditar, label: "Editar o próprio comentário (exige \"Ver o acompanhamento\")", acoes: ACAO_UNICA },
            { id: PLA_ACOMP.comentExcluir, label: "Excluir o próprio comentário (exige \"Ver o acompanhamento\")", acoes: ACAO_UNICA },
            { id: PLA_ACOMP.correcaoPedir, label: "Pedir correção no projeto (exige \"Ver o acompanhamento\")", acoes: ACAO_UNICA },
            { id: PLA_ACOMP.correcaoResolver, label: "Marcar correção como resolvida (exige \"Ver o acompanhamento\")", acoes: ACAO_UNICA },
            { id: PLA_ACOMP.validDar, label: "Validar projeto (exige \"Ver o acompanhamento\")", acoes: ACAO_UNICA },
            { id: PLA_ACOMP.validRetirar, label: "Retirar a validação do projeto (exige \"Ver o acompanhamento\")", acoes: ACAO_UNICA },
            { id: PLA_ACOMP.pendCriar, label: "Adicionar pendência (exige \"Ver o acompanhamento\")", acoes: ACAO_UNICA },
            { id: PLA_ACOMP.pendEditar, label: "Editar pendência (exige \"Ver o acompanhamento\")", acoes: ACAO_UNICA },
            { id: PLA_ACOMP.pendExcluir, label: "Excluir pendência (exige \"Ver o acompanhamento\")", acoes: ACAO_UNICA },
            { id: PLA_ACOMP.pendFeito, label: "Marcar e desmarcar pendência como feita (exige \"Ver o acompanhamento\")", acoes: ACAO_UNICA },
        ],
    },
    {
        category: "Planejamento 2027 — Apresentação",
        modules: [
            { id: PLA_APRES.slidesVer, label: "Ver os slides do projeto (botão \"Ver slides\" e atalho na lista)", acoes: ACAO_UNICA },
            { id: PLA_APRES.slidesApresentar, label: "Apresentar os slides em tela cheia (exige \"Ver os slides\")", acoes: ACAO_UNICA },
            { id: PLA_APRES.slidesPdf, label: "Exportar os slides em PDF (exige \"Ver os slides\")", acoes: ACAO_UNICA },
            { id: PLA_APRES.fichaPdf, label: "Exportar a ficha do projeto em PDF (A4, na página do projeto)", acoes: ACAO_UNICA },
            { id: PLA_APRES.pautaVer, label: "Ver o menu Apresentações (pauta da reunião por setor)", acoes: ACAO_UNICA },
            { id: PLA_APRES.pautaOrdem, label: "Mudar a ordem da pauta: setores e projetos (exige \"Ver o menu Apresentações\")", acoes: ACAO_UNICA },
        ],
    },
]

export const MODULOS_PLANEJAMENTO: string[] = GRUPOS_PLANEJAMENTO.flatMap(g => g.modules.map(m => m.id))
