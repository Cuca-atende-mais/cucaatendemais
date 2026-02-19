import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Users, Calendar, Briefcase, MessageSquare } from "lucide-react"

export default function DashboardPage() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
                <p className="text-muted-foreground">
                    Bem-vindo ao Sistema CUCA Atende+
                </p>
            </div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">
                            Leads Ativos
                        </CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">0</div>
                        <p className="text-xs text-muted-foreground">
                            Aguardando dados
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">
                            Eventos Programados
                        </CardTitle>
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">0</div>
                        <p className="text-xs text-muted-foreground">
                            Aguardando dados
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">
                            Vagas Abertas
                        </CardTitle>
                        <Briefcase className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">0</div>
                        <p className="text-xs text-muted-foreground">
                            Aguardando dados
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">
                            Feedbacks Pendentes
                        </CardTitle>
                        <MessageSquare className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">0</div>
                        <p className="text-xs text-muted-foreground">
                            Aguardando dados
                        </p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Sistema CUCA Atende+</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div>
                        <h3 className="font-semibold mb-2">✅ Configuração Completa</h3>
                        <ul className="text-sm text-muted-foreground space-y-1">
                            <li>• Banco de dados Supabase configurado (40 tabelas)</li>
                            <li>• Projeto Next.js 15 + shadcn/ui</li>
                            <li>• Tema CUCA customizado</li>
                            <li>• Componentes de layout criados</li>
                        </ul>
                    </div>

                    <div>
                        <h3 className="font-semibold mb-2">🚀 Próximos Passos</h3>
                        <ul className="text-sm text-muted-foreground space-y-1">
                            <li>• Implementar autenticação Supabase</li>
                            <li>• Criar páginas de gestão de leads</li>
                            <li>• Desenvolver sistema de programações</li>
                            <li>• Integrar com UAZAPI (WhatsApp)</li>
                        </ul>
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
