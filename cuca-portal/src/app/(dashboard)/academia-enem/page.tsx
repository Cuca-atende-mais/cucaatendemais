"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { GraduationCap, Construction, ShieldX } from "lucide-react"
import { useUser } from "@/lib/auth/user-provider"

export default function AcademiaEnemPainel() {
    const { hasPermission, isDeveloper, loading } = useUser()

    // Enquanto o perfil carrega, não decide acesso (evita flash de loading / negação precoce).
    if (loading) {
        return (
            <div className="p-6 space-y-4 animate-pulse">
                <div className="h-8 w-64 bg-muted rounded" />
                <div className="h-40 bg-muted rounded" />
            </div>
        )
    }

    // Guarda de rota (AC #2): sem ae_painel:read a rota nega acesso.
    const canRead = isDeveloper || hasPermission("ae_painel", "read")
    if (!canRead) {
        return (
            <div className="flex flex-col items-center justify-center py-24 text-center">
                <ShieldX className="h-12 w-12 text-muted-foreground mb-4" />
                <h2 className="text-lg font-semibold">Acesso negado</h2>
                <p className="text-sm text-muted-foreground mt-1">
                    Você não tem permissão para acessar a Academia Enem.
                </p>
            </div>
        )
    }

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-full bg-primary/10">
                    <GraduationCap className="h-6 w-6 text-primary" />
                </div>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Academia Enem</h1>
                    <p className="text-sm text-muted-foreground">
                        Canal de comunicação WhatsApp Oficial Meta — comunicados, avisos e atendimento informativo.
                    </p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Construction className="h-5 w-5 text-amber-500" />
                        Painel em construção
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground">
                        As métricas e indicadores da Academia Enem chegarão nas próximas entregas
                        (presença, disparos, atendimento). Por enquanto, esta é a fundação navegável do módulo.
                    </p>
                </CardContent>
            </Card>
        </div>
    )
}
