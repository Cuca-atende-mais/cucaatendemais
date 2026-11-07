"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"

/**
 * Área de conteúdo do painel: é a única parte da moldura que rola (S-RESP-01).
 *
 * Como a rolagem deixou de ser da janela, o navegador não volta mais ao topo sozinho ao trocar
 * de tela. Por isso a área volta ao topo a cada troca de rota.
 */
export function AreaConteudo({ children }: { children: React.ReactNode }) {
    const ref = useRef<HTMLElement>(null)
    const pathname = usePathname()

    useEffect(() => {
        ref.current?.scrollTo({ top: 0, left: 0 })
    }, [pathname])

    return (
        <main
            ref={ref}
            data-slot="area-conteudo"
            className="min-h-0 flex-1 overflow-y-auto bg-background p-6 print:overflow-visible"
        >
            {children}
        </main>
    )
}
