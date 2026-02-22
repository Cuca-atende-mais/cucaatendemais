"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MessageSquare } from "lucide-react"

export default function OuvidoriaPage() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Ouvidoria</h1>
                <p className="text-muted-foreground">Gestão de manifestações e feedback</p>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <MessageSquare className="h-5 w-5 text-cuca-blue" />
                        Status do Módulo: Em Configuração
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p>Utilize o módulo de Atendimento para responder conversas ativas no momento.</p>
                </CardContent>
            </Card>
        </div>
    )
}
