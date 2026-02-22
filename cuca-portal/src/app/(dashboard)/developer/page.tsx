"use client"

import {
    Bot,
    Activity,
    Database,
    Zap,
    Settings2,
    TriangleAlert,
    Server,
    DollarSign,
    Terminal,
    Wifi,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import Link from "next/link"

const consoleModules = [
    {
        title: "Agentes de IA",
        description: "Visualização dos prompts ativos (3 camadas: Persona + Técnica + RAG) por canal",
        icon: Bot,
        href: "/developer/agentes",
        badge: "4 agentes",
        badgeVariant: "default" as const,
        status: "active",
    },
    {
        title: "Consumo OpenAI",
        description: "Tokens consumidos por modelo e feature, custo estimado e projeção mensal",
        icon: DollarSign,
        href: "/developer/consumo",
        badge: "Em breve",
        badgeVariant: "secondary" as const,
        status: "coming",
    },
    {
        title: "Logs em Tempo Real",
        description: "Últimas 1.000 linhas do Worker Python — filtros por tipo, canal e lead",
        icon: Terminal,
        href: "/developer/logs",
        badge: "Em breve",
        badgeVariant: "secondary" as const,
        status: "coming",
    },
    {
        title: "Métricas do Worker",
        description: "Status, uptime, fila Celery, latência média, taxa de erro e uso de CPU/memória",
        icon: Server,
        href: "/developer/worker",
        badge: "Em breve",
        badgeVariant: "secondary" as const,
        status: "coming",
    },
    {
        title: "Instâncias WhatsApp",
        description: "Gerenciar 14 instâncias UAZAPI — criar, editar número banido, QR Code",
        icon: Wifi,
        href: "/developer/instancias",
        badge: "Fundação OK",
        badgeVariant: "default" as const,
        status: "active",
    },
    {
        title: "Gatilhos de Alerta",
        description: "Configurar alertas automáticos por WhatsApp e e-mail para eventos críticos",
        icon: Zap,
        href: "/developer/alertas",
        badge: "Em breve",
        badgeVariant: "secondary" as const,
        status: "coming",
    },
    {
        title: "Configurações do Sistema",
        description: "Ajustar delays de disparo, limites anti-ban, warm-up e parâmetros do Worker",
        icon: Settings2,
        href: "/developer/configuracoes",
        badge: "Em breve",
        badgeVariant: "secondary" as const,
        status: "coming",
    },
    {
        title: "Diagnóstico RAG",
        description: "Verificar chunks indexados por canal — testar busca semântica sem expor ao usuário",
        icon: Database,
        href: "/developer/rag",
        badge: "Em breve",
        badgeVariant: "secondary" as const,
        status: "coming",
    },
]

export default function DeveloperConsolePage() {
    return (
        <div className="flex flex-col gap-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-destructive/10">
                    <Activity className="h-5 w-5 text-destructive" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Developer Console</h1>
                    <p className="text-sm text-muted-foreground">
                        Área exclusiva do owner/developer — não exposta ao usuário final
                    </p>
                </div>
                <Badge variant="destructive" className="ml-auto">
                    Acesso Restrito
                </Badge>
            </div>

            {/* Warning */}
            <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                <TriangleAlert className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
                <div className="text-sm">
                    <p className="font-medium text-amber-500">Área técnica — nenhuma configuração aqui deve ser exposta ao usuário final</p>
                    <p className="text-muted-foreground mt-1">
                        Agentes de IA, prompts, RAG e parâmetros do sistema são gerenciados aqui pelo developer.
                        Os usuários (Admin CUCA, Colaboradores) não têm e não devem ter acesso a esta área.
                    </p>
                </div>
            </div>

            {/* Modules Grid */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {consoleModules.map((mod) => {
                    const Icon = mod.icon
                    return (
                        <Link key={mod.href} href={mod.href}>
                            <Card className={`h-full transition-all hover:shadow-md cursor-pointer ${mod.status === "active" ? "border-primary/30 bg-primary/5" : "opacity-75"}`}>
                                <CardHeader className="pb-3">
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-background border">
                                                <Icon className="h-4 w-4 text-primary" />
                                            </div>
                                            <CardTitle className="text-sm font-semibold">{mod.title}</CardTitle>
                                        </div>
                                        <Badge variant={mod.badgeVariant} className="text-xs shrink-0">
                                            {mod.badge}
                                        </Badge>
                                    </div>
                                </CardHeader>
                                <CardContent>
                                    <CardDescription className="text-xs leading-relaxed">
                                        {mod.description}
                                    </CardDescription>
                                </CardContent>
                            </Card>
                        </Link>
                    )
                })}
            </div>
        </div>
    )
}
