"use client"

import { Smartphone } from "lucide-react"
import { TransbordoSection } from "@/components/transbordo/transbordo-section"

/* ─── Página ─────────────────────────────────────── */
// S-WM-63: esta página gerenciava instâncias UAZAPI (legado, migração pra WhatsApp
// Oficial Meta já concluída) além do transbordo humano global. A gestão de instância foi
// removida por completo — só resta a visão de developer do cadastro de transbordo,
// sem escopo de unidade (vê e edita tudo, mesma visão "Global" de antes).
export default function InstanciasPage() {
    return (
        <div className="flex flex-col gap-6 p-2 md:p-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                    <Smartphone className="h-6 w-6 text-primary" />
                    Transbordo Humano — Visão Developer
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Acompanhamento e gestão global (todas as unidades e módulos) dos contatos de transbordo.
                </p>
            </div>

            <TransbordoSection
                titulo="Transbordo Humano — Global"
                descricao="Atendentes reais que recebem chamados quando a IA não consegue resolver, em qualquer unidade."
            />
        </div>
    )
}
