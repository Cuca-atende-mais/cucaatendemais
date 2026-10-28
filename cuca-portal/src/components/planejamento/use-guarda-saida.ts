"use client"

import { useEffect, useRef } from "react"

// S-PLA-02 (AC8): com alteração não gravada,
// - fechar a aba, recarregar ou digitar outro endereço → aviso padrão do navegador (beforeunload);
// - clicar em qualquer link interno do portal (menu lateral, cabeçalho, links da página) → a página
//   intercepta antes do Next navegar e chama `aoTentarSair(destino)`, que abre a caixa "Salvar / Sair
//   sem salvar". O App Router não tem evento de "vai navegar", por isso o clique é capturado no window.
// Os botões da própria página ("Sair", "Voltar") chamam `aoTentarSair` direto.

export function destinoInterno(ancora: HTMLAnchorElement, origemAtual: string, caminhoAtual: string): string | null {
    if (ancora.target && ancora.target !== "_self") return null
    if (ancora.hasAttribute("download")) return null
    const href = ancora.getAttribute("href")
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return null
    let url: URL
    try {
        url = new URL(href, origemAtual)
    } catch {
        return null
    }
    if (url.origin !== origemAtual) return null
    const destino = url.pathname + url.search + url.hash
    if (url.pathname === caminhoAtual && !url.search) return null
    return destino
}

export function useGuardaSaida(sujo: boolean, aoTentarSair: (destino: string) => void) {
    const sujoRef = useRef(sujo)
    const aoTentarRef = useRef(aoTentarSair)
    useEffect(() => {
        sujoRef.current = sujo
        aoTentarRef.current = aoTentarSair
    })

    useEffect(() => {
        if (!sujo) return
        const avisar = (e: BeforeUnloadEvent) => {
            e.preventDefault()
            e.returnValue = ""
        }
        window.addEventListener("beforeunload", avisar)
        return () => window.removeEventListener("beforeunload", avisar)
    }, [sujo])

    useEffect(() => {
        const aoClicar = (e: MouseEvent) => {
            if (!sujoRef.current) return
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
            const alvo = e.target as Element | null
            const ancora = alvo?.closest?.("a[href]") as HTMLAnchorElement | null
            if (!ancora) return
            const destino = destinoInterno(ancora, window.location.origin, window.location.pathname)
            if (!destino) return
            e.preventDefault()
            e.stopPropagation()
            aoTentarRef.current(destino)
        }
        window.addEventListener("click", aoClicar, true)
        return () => window.removeEventListener("click", aoClicar, true)
    }, [])
}
