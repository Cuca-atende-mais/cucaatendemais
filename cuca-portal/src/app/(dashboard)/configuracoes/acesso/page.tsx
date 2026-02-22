"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ShieldCheck } from "lucide-react"

export default function AcessoPage() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Gestão de Acesso</h1>
                <p className="text-muted-foreground">Controle de permissões e segurança</p>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <ShieldCheck className="h-5 w-5 text-cuca-blue" />
                        Status do Módulo: Em Manutenção
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p>Este módulo está sendo migrado para o novo sistema de RBAC centralizado.</p>
                </CardContent>
            </Card>
        </div>
    )
}
