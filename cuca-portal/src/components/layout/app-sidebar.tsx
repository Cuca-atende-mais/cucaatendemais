"use client"

import * as React from "react"
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
    const supabase = createClient()

    const handleLogout = async () => {
        await supabase.auth.signOut()
        router.push("/login")
        router.refresh()
    }

    return (
        <Sidebar collapsible="icon" className="border-r">
            <SidebarHeader className="border-b p-4">
                <div className="flex items-center gap-3">
                    <Hexagon className="w-8 h-8 text-cuca-yellow animate-pulse" />
                    {state === "expanded" && (
                        <div className="flex flex-col">
                            <span className="font-bold text-xl tracking-tight">
                                REDE CUCA
                            </span>
                            <span className="text-xs text-cuca-yellow uppercase tracking-widest">
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
                            {menuItems.map((item) => {
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
                                                {item.items.map((subItem) => (
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
                                                ))}
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
                <div className="space-y-2">
                    <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8 bg-gradient-to-tr from-cuca-yellow to-orange-500">
                            <AvatarFallback className="bg-transparent text-cuca-dark font-bold text-xs">
                                ADM
                            </AvatarFallback>
                        </Avatar>
                        {state === "expanded" && (
                            <div className="flex-1">
                                <p className="text-sm font-medium">Administrador</p>
                                <p className="text-xs text-muted-foreground">Gestão Geral</p>
                            </div>
                        )}
                    </div>
                    {state === "expanded" && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="w-full justify-start text-muted-foreground hover:text-destructive"
                            onClick={handleLogout}
                        >
                            <LogOut className="mr-2 h-4 w-4" />
                            Sair
                        </Button>
                    )}
                </div>
            </SidebarFooter>
        </Sidebar>
    )
}
