// S-RESP-01 (AC5) — Menu no celular, sem navegador (react-dom/server, ambiente node).
// Os componentes de layout do menu são trocados por versões simples (a gaveta real do celular usa
// portal, que não renderiza para HTML estático). Os links são capturados para chamar o clique.
import { beforeEach, describe, expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import type { ReactNode } from "react"

const menu = vi.hoisted(() => ({ isMobile: true, state: "expanded", setOpenMobile: vi.fn() }))
const links = vi.hoisted(() => [] as Array<{ href: string; onClick?: () => void }>)

vi.mock("@/components/ui/sidebar", () => {
    const Caixa = ({ children }: { children?: ReactNode }) => <div>{children}</div>
    return {
        Sidebar: Caixa, SidebarContent: Caixa, SidebarFooter: Caixa, SidebarGroup: Caixa,
        SidebarGroupContent: Caixa, SidebarGroupLabel: Caixa, SidebarHeader: Caixa, SidebarMenu: Caixa,
        SidebarMenuItem: Caixa, SidebarSeparator: () => <hr />,
        SidebarMenuButton: ({ children }: { children?: ReactNode }) => <>{children}</>,
        useSidebar: () => menu,
    }
})
vi.mock("next/link", () => ({
    default: ({ href, onClick, children, className }: { href: string; onClick?: () => void; children?: ReactNode; className?: string }) => {
        links.push({ href, onClick })
        return <a href={href} className={className}>{children}</a>
    },
}))
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} /> }))
vi.mock("next/navigation", () => ({
    usePathname: () => "/empregabilidade/vagas",
    useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))
vi.mock("@/lib/auth/user-provider", () => ({
    useUser: () => ({ profile: { nome_completo: "Teste" }, hasPermission: () => true, isDeveloper: true }),
}))
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signOut: vi.fn() } }) }))

import { AppSidebar } from "./app-sidebar"

function renderizar() {
    links.length = 0
    return renderToStaticMarkup(<AppSidebar />)
}

function link(href: string) {
    const achado = links.find(l => l.href === href)
    expect(achado, `link ${href}`).toBeDefined()
    return achado!
}

beforeEach(() => {
    menu.setOpenMobile.mockClear()
    menu.state = "expanded"
})

describe("AppSidebar no celular", () => {
    beforeEach(() => { menu.isMobile = true })

    it("item com submenu vira botão que abre/fecha o submenu, sem link", () => {
        const html = renderizar()
        expect(html).toMatch(/<button type="button" aria-expanded="(true|false)"[^>]*>.*?Empregabilidade/)
        // "/empregabilidade" sobra só como subitem "Painel Geral" (o item principal virou botão)
        expect(links.filter(l => l.href === "/empregabilidade")).toHaveLength(1)
        expect(links.some(l => l.href === "/programacao/exportar")).toBe(false) // submenu fechado
    })

    it("o submenu do módulo da tela atual começa aberto", () => {
        const html = renderizar()
        expect(html).toMatch(/aria-expanded="true"[^>]*>.*?Empregabilidade/)
        expect(links.some(l => l.href === "/empregabilidade/candidatos")).toBe(true)
    })

    it("tocar num item com link fecha o menu", () => {
        renderizar()
        link("/leads").onClick?.()
        expect(menu.setOpenMobile).toHaveBeenCalledWith(false)
    })

    it("tocar num item do submenu fecha o menu", () => {
        renderizar()
        link("/empregabilidade/candidatos").onClick?.()
        expect(menu.setOpenMobile).toHaveBeenCalledWith(false)
    })

    it("abre inteiro mesmo se no computador o menu estiver recolhido", () => {
        menu.state = "collapsed"
        const html = renderizar()
        expect(html).toContain("Candidatos")
        expect(html).toContain("Teste")
    })
})

describe("AppSidebar no computador (nada muda)", () => {
    beforeEach(() => { menu.isMobile = false })

    it("item com submenu continua sendo link e não há botão de submenu", () => {
        const html = renderizar()
        expect(html).not.toContain("aria-expanded")
        // item principal + subitem "Painel Geral"
        expect(links.filter(l => l.href === "/empregabilidade")).toHaveLength(2)
    })

    it("clicar num link não mexe no menu", () => {
        renderizar()
        link("/leads").onClick?.()
        link("/empregabilidade/vagas").onClick?.()
        expect(menu.setOpenMobile).not.toHaveBeenCalled()
    })

    it("recolhido: submenu escondido, como antes", () => {
        menu.state = "collapsed"
        renderizar()
        expect(links.some(l => l.href === "/empregabilidade/candidatos")).toBe(false)
    })
})
