import * as React from "react"

/**
 * Hook de media query genérico — mesmo padrão de `use-mobile.ts`, mas parametrizável. Criado
 * pela S-PROG-01: a grade de programação precisa do corte em 820px (AC8), diferente do
 * breakpoint de 768px que `useIsMobile` já usa para a sidebar — são decisões independentes,
 * não a mesma constante reaproveitada por coincidência.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState<boolean>(false)

  React.useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [query])

  return matches
}
