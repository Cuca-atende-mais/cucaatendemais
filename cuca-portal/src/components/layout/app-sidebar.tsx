"use client"

import { usePathname, useRouter } from "next/navigation"
import Link from "next/link"
import {
    LayoutDashboard,
    Users,
    Calendar,
    Briefcase,
    MessageSquare,
    Settings,
    Hexagon,
    DoorOpen,
    LogOut,
    BarChart2,
} from "lucide-react"
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    useSidebar,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { menuItems } from "@/lib/constants"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/lib/auth/user-provider"

const iconMap = {
    LayoutDashboard,
    Users,
    Calendar,
    Briefcase,
    MessageSquare,
    Settings,
    DoorOpen,
    BarChart2,
}

export function AppSidebar() {
    const pathname = usePathname()
    const router = useRouter()
    const { state } = useSidebar()
    const { profile, hasPermission } = useUser()
    const supabase = createClient()

    const handleLogout = async () => {
        await supabase.auth.signOut()
        router.push("/login")
        router.refresh()
    }

    // Filtrar itens de menu baseados nas permissões do colaborador
    const filteredMenuItems = menuItems.filter(item => {
        if (!item.permission) return true // Itens sem permissão explícita são públicos (dashboard?)
        return hasPermission(item.permission.recurso, item.permission.acao)
    })

    return (
        <Sidebar collapsible="icon" className="border-r">
            <SidebarHeader className="border-b p-4">
                <div className="flex items-center gap-3">
                    <Hexagon className="w-8 h-8 text-cuca-yellow animate-pulse" />
                    {state === "expanded" && (
                        <div className="flex flex-col">
                            <span className="font-bold text-xl tracking-tight uppercase">
                                REDE CUCA
                            </span>
                            <span className="text-xs text-cuca-yellow uppercase tracking-widest font-medium">
                                Atende+
                            </span>
                        </div>
                    )}
                </div>
            </SidebarHeader>

            <SidebarContent>
                <SidebarGroup>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {filteredMenuItems.map((item) => {
                                const Icon = iconMap[item.icon as keyof typeof iconMap] ?? Hexagon
                                return (
                                    <SidebarMenuItem key={item.title}>
                                        <SidebarMenuButton
                                            asChild
                                            isActive={pathname === item.url || (item.items?.some(s => pathname === s.url) ?? false)}
                                            tooltip={item.title}
                                        >
                                            <Link href={item.url}>
                                                <Icon />
                                                <span>{item.title}</span>
                                            </Link>
                                        </SidebarMenuButton>
                                        {item.items && state === "expanded" && (
                                            <SidebarMenu className="ml-4 mt-1">
                                                {item.items.map((subItem) => {
                                                    // Opcional: Filtrar subitens também se necessário
                                                    return (
                                                        <SidebarMenuItem key={subItem.title}>
                                                            <SidebarMenuButton
                                                                asChild
                                                                isActive={pathname === subItem.url}
                                                                size="sm"
                                                            >
                                                                <Link href={subItem.url}>
                                                                    <span>{subItem.title}</span>
                                                                </Link>
                                                            </SidebarMenuButton>
                                                        </SidebarMenuItem>
                                                    )
                                                })}
                                            </SidebarMenu>
                                        )}
                                    </SidebarMenuItem>
                                )
                            })}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>

            <SidebarFooter className="border-t p-4">
                <div className="space-y-4">
                    <div className="flex items-center gap-3">
                        <Avatar className="h-9 w-9 border-2 border-cuca-yellow">
                            <AvatarFallback className="bg-cuca-dark text-cuca-yellow font-bold text-xs">
                                {profile?.nome_completo?.substring(0, 2).toUpperCase() || '??'}
                            </AvatarFallback>
                        </Avatar>
                        {state === "expanded" && (
                            <div className="flex-1 overflow-hidden">
                                <p className="text-sm font-bold truncate">{profile?.nome_completo || 'Carregando...'}</p>
                                <p className="text-[10px] text-muted-foreground uppercase tracking-tighter">
                                    {profile?.funcao.nome.replace('_', ' ') || 'Acesso Restrito'}
                                </p>
                            </div>
                        )}
                    </div>
                    {state === "expanded" && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="w-full justify-start text-muted-foreground hover:text-destructive border-dashed border-muted-foreground/30"
                            onClick={handleLogout}
                        >
                            <LogOut className="mr-2 h-4 w-4" />
                            Sair do sistema
                        </Button>
                    )}
                </div>
            </SidebarFooter>
        </Sidebar>
    )
}
