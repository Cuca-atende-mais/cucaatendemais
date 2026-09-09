"use client"

// S-PROG-01 (item 6): ajuda em camadas. Radix Tooltip só abre em hover — não existe hover em
// toque, e a grade vira cartão por linha abaixo de 820px (exatamente onde a ajuda mais importa,
// pra quem tem menos prática). Por isso o mesmo ícone "?" abre por hover no desktop (Tooltip) e
// por toque no mobile (Popover) — os dois compartilham o mesmo texto, de `lib/programacao/ajuda`.

import { HelpCircle } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { AJUDA_CAMPOS, CampoComAjuda } from "@/lib/programacao/ajuda"

export function AjudaCampo({ campo }: { campo: CampoComAjuda }) {
    const texto = AJUDA_CAMPOS[campo]
    return (
        <>
            {/* Desktop: hover. Escondido em telas de toque via CSS (grupo "hidden sm:inline-flex"
                não basta sozinho — o Tooltip do Radix ainda reagiria a um tap fantasma em touch
                devices sem cursor real; por isso o par abaixo cobre mobile via Popover mesmo
                assim, e aqui só escondemos visualmente para não duplicar o ícone na tela). */}
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        type="button"
                        tabIndex={-1}
                        className="hidden sm:inline-flex text-muted-foreground hover:text-foreground shrink-0"
                        aria-label="Ajuda"
                    >
                        <HelpCircle className="h-3.5 w-3.5" />
                    </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-64">{texto}</TooltipContent>
            </Tooltip>

            {/* Mobile/toque: tap abre popover com o mesmo texto. */}
            <Popover>
                <PopoverTrigger asChild>
                    <button
                        type="button"
                        className="inline-flex sm:hidden text-muted-foreground hover:text-foreground shrink-0"
                        aria-label="Ajuda"
                    >
                        <HelpCircle className="h-3.5 w-3.5" />
                    </button>
                </PopoverTrigger>
                <PopoverContent className="max-w-64 text-xs">{texto}</PopoverContent>
            </Popover>
        </>
    )
}

/** Rótulo de campo com o ícone de ajuda embutido — uso padrão na ficha e nos cabeçalhos de
 * coluna da grade. */
export function RotuloComAjuda({ texto, campo, obrigatorio }: { texto: string; campo?: CampoComAjuda; obrigatorio?: boolean }) {
    return (
        <span className="inline-flex items-center gap-1">
            {texto}
            {obrigatorio ? " *" : ""}
            {campo ? <AjudaCampo campo={campo} /> : null}
        </span>
    )
}
