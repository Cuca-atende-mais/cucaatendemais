export const menuItems = [
    {
        title: "Dashboard",
        url: "/dashboard",
        icon: "LayoutDashboard",
    },
    {
        title: "Leads",
        url: "/leads",
        icon: "Users",
    },
    {
        title: "Atendimento",
        url: "/atendimento",
        icon: "MessageSquare",
    },

    {
        title: "Programação",
        url: "/programacao",
        icon: "Calendar",
        items: [
            { title: "Pontual", url: "/programacao/pontual" },
            { title: "Mensal", url: "/programacao/mensal" },
        ],
    },
    {
        title: "Empregabilidade",
        url: "/empregabilidade",
        icon: "Briefcase",
        items: [
            { title: "Vagas", url: "/empregabilidade/vagas" },
            { title: "Empresas", url: "/empregabilidade/empresas" },
        ],
    },
    {
        title: "Ouvidoria",
        url: "/ouvidoria",
        icon: "MessageSquare",
    },
    {
        title: "Acesso CUCA",
        url: "/acesso",
        icon: "DoorOpen",
    },
    {
        title: "Configurações",
        url: "/configuracoes",
        icon: "Settings",
        items: [
            { title: "WhatsApp", url: "/configuracoes/whatsapp" },
            { title: "Unidades", url: "/unidades" },
            { title: "Categorias", url: "/categorias" },
        ],
    },
    // ⚠️ Developer Console — EXCLUSIVO owner/developer. A proteção por role será aplicada no S2-04 (sidebar dinâmica por permissão).
    {
        title: "Developer Console",
        url: "/developer",
        icon: "BarChart2",
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
