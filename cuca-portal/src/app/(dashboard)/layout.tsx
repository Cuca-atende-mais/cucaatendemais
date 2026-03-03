export const dynamic = 'force-dynamic'

import { AppSidebar } from "@/components/layout/app-sidebar"
import { AppHeader } from "@/components/layout/app-header"
import { SidebarProvider } from "@/components/ui/sidebar"

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode
}) {
    return (
        <SidebarProvider defaultOpen>
            <div className="flex min-h-screen w-full">
                <AppSidebar />
                <div className="flex flex-col flex-1">
                    <AppHeader />
                    <main className="flex-1 p-6 bg-slate-50">
                        {children}
                    </main>
                </div>
            </div>
        </SidebarProvider>
    )
}
