"use client"

import { usePathname, useRouter } from "next/navigation"
import Link from "next/link"
import Image from "next/image"
import {
    LayoutDashboard,
    Users,
    Calendar,
    Briefcase,
    MessageSquare,
    Settings,
    DoorOpen,
    LogOut,
    BarChart2,
    Megaphone,
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
    LogOut,
    BarChart2,
    Megaphone,
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
        if (!item.permission) return true
        return hasPermission(item.permission.recurso, item.permission.acao)
    })

    return (
        <Sidebar collapsible="icon" className="border-r">
            <SidebarHeader className="border-b p-4">
                <div className="flex items-center gap-3">
                    <Image
                        src="/logo-rede-cuca.png"
                        alt="Rede CUCA"
                        width={36}
                        height={36}
                        className="object-contain shrink-0"
                    />
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
                                const IconComponent = iconMap[item.icon as keyof typeof iconMap]
                                const isActive = pathname === item.url || pathname.startsWith(item.url + "/")

                                return (
                                    <SidebarMenuItem key={item.title}>
                                        <SidebarMenuButton
                                            asChild
                                            isActive={isActive}
                                            tooltip={item.title}
                                        >
                                            <Link href={item.url}>
                                                {IconComponent && <IconComponent />}
                                                <span>{item.title}</span>
                                            </Link>
                                        </SidebarMenuButton>

                                        {/* Sub-items */}
                                        {item.items && isActive && state === "expanded" && (
                                            <div className="ml-6 mt-1 space-y-1">
                                                {item.items.map((subItem) => (
                                                    <Link
                                                        key={subItem.title}
                                                        href={subItem.url}
                                                        className={`block text-xs px-3 py-1.5 rounded-md transition-colors ${pathname === subItem.url
                                                                ? "bg-primary/10 text-primary font-medium"
                                                                : "text-muted-foreground hover:text-foreground hover:bg-accent"
                                                            }`}
                                                    >
                                                        {subItem.title}
                                                    </Link>
                                                ))}
                                            </div>
                                        )}
                                    </SidebarMenuItem>
                                )
                            })}
                        </SidebarMenu>
                    </SidebarGroupContent>
                </SidebarGroup>
            </SidebarContent>

            <SidebarFooter className="border-t p-4">
                <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <Avatar className="h-8 w-8 shrink-0">
                            <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                                {profile?.nome_completo
                                    ? profile.nome_completo.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
                                    : "?"}
                            </AvatarFallback>
                        </Avatar>
                        {state === "expanded" && (
                            <div className="flex flex-col min-w-0">
                                <span className="text-xs font-medium truncate">
                                    {profile?.nome_completo || "Usuário"}
                                </span>
                                <span className="text-[10px] text-muted-foreground truncate">
                                    {profile?.unidade_cuca || "Super Admin"}
                                </span>
                            </div>
                        )}
                    </div>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={handleLogout}
                        title="Sair do sistema"
                    >
                        <LogOut className="h-4 w-4" />
                    </Button>
                </div>
            </SidebarFooter>
        </Sidebar>
    )
}
