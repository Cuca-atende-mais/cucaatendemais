import { AppSidebar } from "@/components/layout/app-sidebar"
import { AppHeader } from "@/components/layout/app-header"
import { AreaConteudo } from "@/components/layout/area-conteudo"
import { SidebarProvider } from "@/components/ui/sidebar"

/**
 * Moldura do painel (S-RESP-01): ocupa exatamente a altura da tela e só a área de conteúdo
 * rola — cabeçalho e menu ficam parados. A altura do cabeçalho fica em `--altura-cabecalho`
 * para nenhuma tela precisar adivinhar. Na impressão a moldura volta à altura livre, para sair
 * o conteúdo inteiro e não só a parte visível.
 */
export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <SidebarProvider defaultOpen>
            <div className="flex h-svh w-full overflow-hidden [--altura-cabecalho:3.5rem] print:h-auto print:overflow-visible">
                <AppSidebar />
                <div className="flex min-w-0 flex-1 flex-col">
                    <AppHeader />
                    <AreaConteudo>{children}</AreaConteudo>
                </div>
            </div>
        </SidebarProvider>
    )
}
