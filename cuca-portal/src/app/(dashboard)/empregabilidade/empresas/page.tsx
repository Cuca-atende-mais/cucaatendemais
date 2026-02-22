"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Building2 } from "lucide-react"

export default function EmpresasPage() {
    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight">Empresas Parceiras</h1>
                <p className="text-muted-foreground">Gestão de convênios e parceiros</p>
            </div>
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Building2 className="h-5 w-5 text-cuca-blue" />
                        Status do Módulo: Em Manutenção
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p>A gestão de empresas está sendo unificada com o banco de talentos.</p>
                </CardContent>
            </Card>
        </div>
    )
}
