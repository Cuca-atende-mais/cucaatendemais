export const menuItems = [
    {
        title: "Dashboard",
        url: "/dashboard",
        icon: "LayoutDashboard",
        permission: { recurso: "leads", acao: "read" } // Dashboard base usa leitura de leads
    },
    {
        title: "Leads",
        url: "/leads",
        icon: "Users",
        permission: { recurso: "leads", acao: "read" }
    },
    {
        title: "Atendimento",
        url: "/atendimento",
        icon: "MessageSquare",
        permission: { recurso: "ouvidoria", acao: "read" } // Atendimento/Chat vinculado à ouvidoria/conversas
    },
    {
        title: "Programação",
        url: "/programacao",
        icon: "Calendar",
        permission: { recurso: "programacao", acao: "read" }
    },
    {
        title: "Campanhas",
        url: "/campanhas",
        icon: "Megaphone",
        permission: { recurso: "campanhas", acao: "read" }
    },
    {
        title: "Empregabilidade",
        url: "/empregabilidade",
        icon: "Briefcase",
        permission: { recurso: "empregabilidade", acao: "read" },
        items: [
            { title: "Vagas", url: "/empregabilidade/vagas", permission: { recurso: "empregabilidade", acao: "read" } },
        ],
    },
    {
        title: "Configurações",
        url: "/configuracoes",
        icon: "Settings",
        permission: { recurso: "configuracoes", acao: "update" },
        items: [
            { title: "WhatsApp", url: "/configuracoes/whatsapp" },
            { title: "Colaboradores", url: "/configuracoes/colaboradores" },
            { title: "Unidades", url: "/unidades" },
            { title: "Categorias", url: "/categorias" },
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
