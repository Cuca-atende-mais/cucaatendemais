"use client"

import { Menu, Bell, Search, User } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useSidebar } from "@/components/ui/sidebar"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

export function AppHeader() {
    const { toggleSidebar } = useSidebar()

    return (
        <header className="sticky top-0 z-40 bg-background border-b">
            <div className="flex items-center justify-between px-6 py-4">
                <div className="flex items-center gap-4">
                    <Button
                        variant="ghost"
                        size="icon"
                        onClick={toggleSidebar}
                        className="md:hidden"
                    >
                        <Menu className="h-6 w-6" />
                    </Button>

                    <div className="relative hidden sm:block">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            type="search"
                            placeholder="Buscar leads, vagas, eventos..."
                            className="pl-10 w-64 rounded-full"
                        />
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="icon" className="relative">
                        <Bell className="h-5 w-5" />
                        <span className="absolute top-1 right-1 h-2.5 w-2.5 bg-destructive rounded-full border-2 border-background" />
                    </Button>

                    <div className="h-8 w-px bg-border" />

                    <div className="flex items-center gap-3">
                        <span className="text-sm font-medium hidden md:block">
                            Prefeitura de Fortaleza
                        </span>
                        <Avatar className="h-8 w-8 bg-cuca-blue">
                            <AvatarFallback className="bg-cuca-blue text-white">
                                <User className="h-4 w-4" />
                            </AvatarFallback>
                        </Avatar>
                    </div>
                </div>
            </div>
        </header>
    )
}
