"use client"

import { Menu, Bell, Search, Moon, Sun } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useSidebar } from "@/components/ui/sidebar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { useTheme } from "next-themes"
import { useState, useEffect } from "react"
import { CommandPalette } from "@/components/dashboard/command-palette"
import { useUser } from "@/lib/auth/user-provider"

export function AppHeader() {
    const { toggleSidebar } = useSidebar()
    const { theme, setTheme } = useTheme()
    const { profile } = useUser()
    const [mounted, setMounted] = useState(false)

    useEffect(() => setMounted(true), [])

    const initials = profile?.nome_completo
        ? profile.nome_completo.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()
        : "?"

    const openPalette = () => {
        document.dispatchEvent(new CustomEvent("open-command-palette"))
    }

    return (
        <>
            <CommandPalette />
            <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-md">
                <div className="flex items-center justify-between px-4 py-3">

                    {/* Left: toggle + search trigger */}
                    <div className="flex items-center gap-3">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={toggleSidebar}
                            className="h-8 w-8"
                            aria-label="Abrir/fechar menu"
                        >
                            <Menu className="h-4 w-4" />
                        </Button>

                        {/* Command palette trigger */}
                        <button
                            onClick={openPalette}
                            className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 hover:bg-muted transition-colors rounded-lg px-3 py-1.5 cursor-text w-56 border border-border/50"
                            aria-label="Abrir busca global (Ctrl+K)"
                        >
                            <Search className="h-3.5 w-3.5 shrink-0" />
                            <span className="flex-1 text-left">Buscar...</span>
                            <kbd className="hidden md:flex items-center gap-0.5 text-[10px] border border-border/70 rounded px-1 py-0.5 bg-background/50">
                                <span>Ctrl</span>
                                <span>K</span>
                            </kbd>
                        </button>
                    </div>

                    {/* Right: actions + user */}
                    <div className="flex items-center gap-1">

                        {/* Theme toggle */}
                        {mounted && (
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                                aria-label="Alternar tema"
                            >
                                {theme === "dark"
                                    ? <Sun className="h-4 w-4" />
                                    : <Moon className="h-4 w-4" />
                                }
                            </Button>
                        )}

                        {/* Notifications */}
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 relative"
                            aria-label="Notificações"
                        >
                            <Bell className="h-4 w-4" />
                            <span className="absolute top-1.5 right-1.5 h-2 w-2 bg-rose-500 rounded-full ring-2 ring-background" />
                        </Button>

                        <div className="h-5 w-px bg-border mx-1" />

                        {/* User info */}
                        <div className="flex items-center gap-2.5">
                            <div className="hidden md:block text-right">
                                <p className="text-xs font-semibold leading-tight">
                                    {profile?.nome_completo || "Usuário"}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                    {profile?.unidade_cuca || "Super Admin"}
                                </p>
                            </div>
                            <Avatar className="h-7 w-7">
                                <AvatarFallback className="bg-primary text-primary-foreground text-xs font-semibold">
                                    {initials}
                                </AvatarFallback>
                            </Avatar>
                        </div>
                    </div>
                </div>
            </header>
        </>
    )
}
