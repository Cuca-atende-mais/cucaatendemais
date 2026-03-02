export const menuItems = [
    {
        title: "Dashboard",
        url: "/dashboard",
        icon: "LayoutDashboard",
        permission: { recurso: "dashboard", acao: "read" } // Dashboard base
    },
    {
        title: "Leads",
        url: "/leads",
        icon: "Users",
        permission: { recurso: "leads_overview", acao: "read" }
    },
    {
        title: "Atendimento",
        url: "/atendimento",
        icon: "MessageSquare",
        permission: { recurso: "atendimentos", acao: "read" }
    },
    {
        title: "Programação",
        url: "/programacao",
        icon: "Calendar",
        permission: { recurso: "programacao_mensal", acao: "read" },
        // Fallback for parent menu logic if needed, usually handles visibleChildren
        items: [
            { title: "Mensal", url: "/programacao", permission: { recurso: "programacao_mensal", acao: "read" } },
            // If there's a specific route for pontual, it would be here.
        ],
    },
    {
        title: "Empregabilidade",
        url: "/empregabilidade",
        icon: "Briefcase",
        permission: { recurso: "empreg_banco_cv", acao: "read" },
        items: [
            { title: "Painel Geral", url: "/empregabilidade", permission: { recurso: "empreg_banco_cv", acao: "read" } },
            { title: "Vagas", url: "/empregabilidade/vagas", permission: { recurso: "empreg_vagas", acao: "read" } },
        ],
    },
    {
        title: "Acesso CUCA",
        url: "/acesso-cuca",
        icon: "DoorOpen",
        permission: { recurso: "acesso_solicitacoes", acao: "read" },
        items: [
            { title: "Solicitações", url: "/acesso-cuca", permission: { recurso: "acesso_solicitacoes", acao: "read" } },
            { title: "Espaços & Equipamentos", url: "/acesso-cuca/espacos", permission: { recurso: "acesso_espacos", acao: "read" } },
        ],
    },
    {
        title: "Ouvidoria",
        url: "/ouvidoria",
        icon: "Megaphone",
        permission: { recurso: "ouvidoria", acao: "read" },
        items: [
            { title: "Painel de Manifestações", url: "/ouvidoria", permission: { recurso: "ouvidoria", acao: "read" } },
            { title: "Eventos de Escuta", url: "/ouvidoria/eventos", permission: { recurso: "ouvidoria", acao: "read" } },
        ],
    },
    {
        title: "Configurações",
        url: "/configuracoes",
        icon: "Settings",
        // Parent menu doesn't need strict perm now, sidebar relies on children
        items: [
            { title: "WhatsApp", url: "/configuracoes/whatsapp", permission: { recurso: "config_whatsapp", acao: "read" } },
            { title: "Colaboradores", url: "/configuracoes/colaboradores", permission: { recurso: "config_colaboradores", acao: "read" } },
            { title: "Perfis (RBAC)", url: "/configuracoes/perfis", permission: { recurso: "config_perfis", acao: "read" } },
            { title: "Unidades", url: "/unidades", permission: { recurso: "config_unidades", acao: "read" } },
            { title: "Categorias", url: "/categorias", permission: { recurso: "config_categorias", acao: "read" } },
        ],
    },
    {
        title: "Developer Console",
        url: "/developer",
        icon: "BarChart2",
        permission: { recurso: "developer", acao: "read" }
    },
]

export const unidadesCuca = [
    "Cuca Barra",
    "Cuca Mondubim",
    "Cuca Jangurussu",
    "Cuca José Walter",
    "Cuca Pici",
] as const

export type UnidadeCuca = typeof unidadesCuca[number]
