"use client"

import { Bell } from "lucide-react"
import { Button } from "@/components/ui/button"
import { textoContador } from "@/lib/alertas/alertas"

// S-INST-QUAL-12 — Botão do sino (só apresentação). Sem não lidos, nenhum indicador.
export function SinoAlertasBotao({ naoLidos, onClick }: { naoLidos: number; onClick?: () => void }) {
    const contador = textoContador(naoLidos)
    return (
        <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 relative"
            onClick={onClick}
            aria-label={contador ? `Alertas: ${contador} não lidos` : "Alertas: nenhum não lido"}
        >
            <Bell className="h-4 w-4" />
            {contador && (
                <span
                    data-testid="contador-alertas"
                    className="absolute -top-0.5 -right-0.5 min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-xs font-semibold leading-5 text-center ring-2 ring-background"
                >
                    {contador}
                </span>
            )}
        </Button>
    )
}
