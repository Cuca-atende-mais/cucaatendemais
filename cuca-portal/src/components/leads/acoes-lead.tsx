"use client"

import { Lead } from "@/lib/types/database"
import { Button } from "@/components/ui/button"
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem,
    DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { MoreHorizontal, BellOff, Bell, ShieldBan, ShieldCheck, Eraser, Trash2 } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Menu de ações de um lead. A tabela (telas a partir de lg) e os cartões (abaixo de lg) usam este
 * mesmo componente, para as duas versões nunca ficarem com ações diferentes.
 */
export function AcoesLead({
    lead,
    classeBotao,
    onVer,
    onAlternarOptIn,
    onDesbloquear,
    onBloquear,
    onLimparTags,
    onExcluir,
}: {
    lead: Lead
    classeBotao?: string
    onVer: (lead: Lead) => void
    onAlternarOptIn: (lead: Lead) => void
    onDesbloquear: (lead: Lead) => void
    onBloquear: (lead: Lead) => void
    onLimparTags: (lead: Lead) => void
    onExcluir: (lead: Lead) => void
}) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon"
                    className={cn("h-8 w-8", classeBotao)}
                    aria-label={`Ações do lead ${lead.nome ?? lead.telefone}`}
                >
                    <MoreHorizontal className="h-4 w-4" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onVer(lead)}>
                    Ver Lead
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onAlternarOptIn(lead)}>
                    {lead.opt_in ? (
                        <><BellOff className="mr-2 h-4 w-4" />Remover Opt-in</>
                    ) : (
                        <><Bell className="mr-2 h-4 w-4" />Ativar Opt-in</>
                    )}
                </DropdownMenuItem>
                {lead.bloqueado ? (
                    <DropdownMenuItem onClick={() => onDesbloquear(lead)}>
                        <ShieldCheck className="mr-2 h-4 w-4" />Desbloquear
                    </DropdownMenuItem>
                ) : (
                    <DropdownMenuItem
                        className="text-destructive"
                        onClick={() => onBloquear(lead)}
                    >
                        <ShieldBan className="mr-2 h-4 w-4" />Bloquear
                    </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onLimparTags(lead)}>
                    <Eraser className="mr-2 h-4 w-4" />Limpar Tags
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => onExcluir(lead)}
                >
                    <Trash2 className="mr-2 h-4 w-4" />Excluir
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
