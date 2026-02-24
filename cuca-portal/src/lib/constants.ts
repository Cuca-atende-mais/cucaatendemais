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
        title: "Empregabilidade",
        url: "/empregabilidade",
        icon: "Briefcase",
        permission: { recurso: "empregabilidade", acao: "read" },
        items: [
            { title: "Vagas", url: "/empregabilidade/vagas", permission: { recurso: "empregabilidade", acao: "read" } },
        ],
    },
    {
        title: "Acesso CUCA",
        url: "/acesso-cuca",
        icon: "DoorOpen",
        permission: { recurso: "ouvidoria", acao: "read" },
        items: [
            { title: "Solicitações", url: "/acesso-cuca" },
            { title: "Espaços & Equipamentos", url: "/acesso-cuca/espacos" },
        ],
    },
    {
        title: "Ouvidoria",
        url: "/ouvidoria",
        icon: "Megaphone",
        permission: { recurso: "ouvidoria", acao: "read" },
        items: [
            { title: "Painel de Manifestações", url: "/ouvidoria" },
            { title: "Eventos de Escuta", url: "/ouvidoria/eventos" },
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
