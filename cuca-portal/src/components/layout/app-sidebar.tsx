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
    Radio,
    ChevronRight,
} from "lucide-react"
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarSeparator,
    useSidebar,
} from "@/components/ui/sidebar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { menuItems } from "@/lib/constants"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/lib/auth/user-provider"
import { cn } from "@/lib/utils"

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
    Radio,
}

// Categorização dos módulos
const PRINCIPAL_URLS = ["/dashboard"]
const SISTEMA_URLS = ["/configuracoes", "/developer"]

export function AppSidebar() {
    const pathname = usePathname()
    const router = useRouter()
    const { state } = useSidebar()
    const { profile, hasPermission, isDeveloper } = useUser()
    const supabase = createClient()
    const isCollapsed = state === "collapsed"

    const handleLogout = async () => {
        await supabase.auth.signOut()
        router.push("/login")
        router.refresh()
    }

    const filteredMenuItems = menuItems.map(item => {
        if (isDeveloper) return item
        if (item.url === "/developer") return null

        let visibleChildren = item.items
        if (item.items) {
            visibleChildren = item.items.filter(child => {
                const perm = (child as any).permission
                const perms = (child as any).permissions
                if (!perm && !perms) return true
                if (perms && Array.isArray(perms)) {
                    return perms.some((p: any) => hasPermission(p.recurso, p.acao))
                }
                return hasPermission(perm.recurso, perm.acao)
            })
        }

        let hasParentPerm = true
        if ((item as any).permission) {
            hasParentPerm = hasPermission((item as any).permission.recurso, (item as any).permission.acao)
        }

        if (item.items && item.items.length > 0) {
            hasParentPerm = !!(visibleChildren && visibleChildren.length > 0)
        }

        if (!hasParentPerm) return null
        return { ...item, items: visibleChildren }
    }).filter(Boolean) as typeof menuItems

    const principal = filteredMenuItems.filter(i => PRINCIPAL_URLS.includes(i.url))
    const modulos   = filteredMenuItems.filter(i => !PRINCIPAL_URLS.includes(i.url) && !SISTEMA_URLS.includes(i.url))
    const sistema   = filteredMenuItems.filter(i => SISTEMA_URLS.includes(i.url))

    const initials = profile?.nome_completo
        ? profile.nome_completo.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
        : "?"

    function MenuItem({ item }: { item: (typeof menuItems)[0] }) {
        const IconComponent = iconMap[item.icon as keyof typeof iconMap]
        const isActive = pathname === item.url || pathname.startsWith(item.url + "/")
        const hasSubItems = item.items && item.items.length > 0
        const hasActiveChild = hasSubItems && item.items!.some(
            sub => pathname === sub.url || pathname.startsWith(sub.url + "/")
        )
        const effectiveActive = isActive || hasActiveChild

        return (
            <SidebarMenuItem>
                <SidebarMenuButton
                    asChild
                    isActive={effectiveActive}
                    tooltip={item.title}
                    className={cn(
                        "relative h-9 transition-all duration-150 font-medium text-sm",
                        effectiveActive
                            ? "bg-primary/15 text-foreground border-l-2 border-primary rounded-l-none font-semibold"
                            : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 border-l-2 border-transparent"
                    )}
                >
                    <Link href={item.url} className="flex items-center gap-3 w-full">
                        {IconComponent && (
                            <IconComponent className={cn(
                                "h-[18px] w-[18px] shrink-0",
                                effectiveActive ? "text-primary" : "text-sidebar-foreground/60"
                            )} />
                        )}
                        <span className="truncate">{item.title}</span>
                        {hasSubItems && !isCollapsed && (
                            <ChevronRight className={cn(
                                "ml-auto h-3.5 w-3.5 shrink-0 text-sidebar-foreground/40 transition-transform",
                                effectiveActive && "rotate-90"
                            )} />
                        )}
                    </Link>
                </SidebarMenuButton>

                {/* Sub-items — visíveis quando pai está ativo e sidebar expandida */}
                {hasSubItems && effectiveActive && !isCollapsed && (
                    <div className="ml-4 mt-1 space-y-0.5 border-l border-sidebar-border/60 pl-3">
                        {item.items!.map((sub) => {
                            const subActive = pathname === sub.url || pathname.startsWith(sub.url + "/")
                            return (
                                <Link
                                    key={sub.title}
                                    href={sub.url}
                                    className={cn(
                                        "block text-xs px-2 py-1.5 rounded-md transition-colors",
                                        subActive
                                            ? "text-primary font-semibold bg-primary/10"
                                            : "text-sidebar-foreground/60 hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
                                    )}
                                >
                                    {sub.title}
                                </Link>
                            )
                        })}
                    </div>
                )}
            </SidebarMenuItem>
        )
    }

    function MenuGroup({
        items,
        label,
    }: {
        items: typeof menuItems
        label?: string
    }) {
        if (items.length === 0) return null
        return (
            <SidebarGroup className="px-0">
                {label && !isCollapsed && (
                    <SidebarGroupLabel className="text-[10px] font-bold uppercase tracking-widest text-sidebar-foreground/35 px-4 mb-1">
                        {label}
                    </SidebarGroupLabel>
                )}
                <SidebarGroupContent>
                    <SidebarMenu className="gap-0.5 px-2">
                        {items.map(item => <MenuItem key={item.title} item={item} />)}
                    </SidebarMenu>
                </SidebarGroupContent>
            </SidebarGroup>
        )
    }

    return (
        <TooltipProvider delayDuration={0}>
            <Sidebar collapsible="icon" className="border-r border-sidebar-border">

                {/* ── Header / Logo ─── */}
                <SidebarHeader className="border-b border-sidebar-border/60 px-4 py-3">
                    <div className="flex items-center gap-3 min-h-[40px]">
                        <div className="shrink-0 relative">
                            <Image
                                src="/logo-rede-cuca.png"
                                alt="Rede CUCA"
                                width={36}
                                height={36}
                                className="object-contain"
                            />
                        </div>
                        {!isCollapsed && (
                            <div className="flex flex-col leading-tight min-w-0">
                                <span className="font-extrabold text-base tracking-tight text-sidebar-foreground uppercase">
                                    REDE CUCA
                                </span>
                                <span className="text-[9px] w-fit px-1.5 py-0.5 rounded-sm bg-cuca-yellow text-slate-900 font-black uppercase tracking-widest mt-0.5">
                                    ATENDE+
                                </span>
                            </div>
                        )}
                    </div>
                </SidebarHeader>

                {/* ── Navegação ─── */}
                <SidebarContent className="py-3 gap-0">
                    <MenuGroup items={principal} />

                    {principal.length > 0 && modulos.length > 0 && (
                        <SidebarSeparator className="mx-4 my-2 bg-sidebar-border/50" />
                    )}

                    <MenuGroup items={modulos} label="Módulos" />

                    {sistema.length > 0 && (
                        <>
                            <SidebarSeparator className="mx-4 my-2 bg-sidebar-border/50" />
                            <MenuGroup items={sistema} label="Sistema" />
                        </>
                    )}
                </SidebarContent>

                {/* ── Footer / Usuário ─── */}
                <SidebarFooter className="border-t border-sidebar-border/60 p-3">
                    <div className={cn(
                        "flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-sidebar-accent/50",
                        isCollapsed && "justify-center px-0"
                    )}>
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <Avatar className="h-7 w-7 shrink-0 ring-2 ring-primary/20">
                                    <AvatarFallback className="bg-primary/80 text-primary-foreground text-[11px] font-bold">
                                        {initials}
                                    </AvatarFallback>
                                </Avatar>
                            </TooltipTrigger>
                            {isCollapsed && (
                                <TooltipContent side="right">
                                    <p className="font-medium">{profile?.nome_completo || "Usuário"}</p>
                                    <p className="text-xs text-muted-foreground">{profile?.unidade_cuca || "Super Admin"}</p>
                                </TooltipContent>
                            )}
                        </Tooltip>

                        {!isCollapsed && (
                            <>
                                <div className="flex flex-col min-w-0 flex-1">
                                    <span className="text-xs font-semibold truncate text-sidebar-foreground">
                                        {profile?.nome_completo || "Usuário"}
                                    </span>
                                    <span className="text-[10px] text-sidebar-foreground/50 truncate">
                                        {profile?.unidade_cuca || "Super Admin"}
                                    </span>
                                </div>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7 shrink-0 text-sidebar-foreground/50 hover:text-destructive hover:bg-destructive/10"
                                    onClick={handleLogout}
                                    title="Sair do sistema"
                                >
                                    <LogOut className="h-3.5 w-3.5" />
                                </Button>
                            </>
                        )}
                    </div>
                </SidebarFooter>
            </Sidebar>
        </TooltipProvider>
    )
}
