"use client"

import { useState, useEffect, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
    Search, LayoutDashboard, Users, Calendar, Briefcase,
    MessageSquare, Settings, DoorOpen, Megaphone, BarChart2, ArrowRight
} from "lucide-react"
import { Dialog, DialogContent } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

const commands = [
    { title: "Dashboard", description: "Painel gerencial principal", href: "/dashboard", icon: LayoutDashboard },
    { title: "Leads", description: "Gestão de leads e contatos", href: "/leads", icon: Users },
    { title: "Atendimento", description: "Painel de atendimentos", href: "/atendimento", icon: MessageSquare },
    { title: "Programação", description: "Eventos e programação cultural", href: "/programacao", icon: Calendar },
    { title: "Empregabilidade", description: "Vagas e banco de talentos", href: "/empregabilidade", icon: Briefcase },
    { title: "Acesso CUCA", description: "Reservas e controle de acesso", href: "/acesso-cuca", icon: DoorOpen },
    { title: "Ouvidoria", description: "Manifestações e eventos de escuta", href: "/ouvidoria", icon: BarChart2 },
    { title: "Divulgação", description: "Disparos e comunicações", href: "/divulgacao", icon: Megaphone },
    { title: "Configurações", description: "Configurações do sistema", href: "/configuracoes", icon: Settings },
]

export function CommandPalette() {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState("")
    const [selected, setSelected] = useState(0)

    useEffect(() => {
        const down = (e: KeyboardEvent) => {
            if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault()
                setOpen(true)
            }
        }
        const openPalette = () => setOpen(true)
        document.addEventListener("keydown", down)
        document.addEventListener("open-command-palette", openPalette)
        return () => {
            document.removeEventListener("keydown", down)
            document.removeEventListener("open-command-palette", openPalette)
        }
    }, [])

    const filtered = commands.filter(c =>
        c.title.toLowerCase().includes(query.toLowerCase()) ||
        c.description.toLowerCase().includes(query.toLowerCase())
    )

    const handleSelect = useCallback((href: string) => {
        router.push(href)
        setOpen(false)
        setQuery("")
        setSelected(0)
    }, [router])

    const handleClose = (v: boolean) => {
        setOpen(v)
        if (!v) { setQuery(""); setSelected(0) }
    }

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "ArrowDown") {
            e.preventDefault()
            setSelected(s => Math.min(s + 1, filtered.length - 1))
        } else if (e.key === "ArrowUp") {
            e.preventDefault()
            setSelected(s => Math.max(s - 1, 0))
        } else if (e.key === "Enter" && filtered[selected]) {
            handleSelect(filtered[selected].href)
        }
    }

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="p-0 overflow-hidden max-w-lg gap-0" onKeyDown={handleKeyDown}>
                <div className="flex items-center border-b px-4 py-3 gap-3">
                    <Search className="h-4 w-4 text-muted-foreground shrink-0" />
                    <input
                        autoFocus
                        value={query}
                        onChange={(e) => { setQuery(e.target.value); setSelected(0) }}
                        placeholder="Buscar módulos, páginas..."
                        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                    />
                    <kbd className="hidden sm:flex h-5 select-none items-center rounded border bg-muted px-1.5 text-[10px] font-medium text-muted-foreground">
                        ESC
                    </kbd>
                </div>

                <div className="py-2 max-h-80 overflow-y-auto">
                    {filtered.length === 0 && (
                        <p className="text-center text-sm text-muted-foreground py-8">Nenhum resultado encontrado</p>
                    )}
                    {filtered.map((cmd, i) => {
                        const Icon = cmd.icon
                        return (
                            <button
                                key={cmd.href}
                                onClick={() => handleSelect(cmd.href)}
                                className={cn(
                                    "flex items-center gap-3 w-full px-4 py-2.5 text-left transition-colors",
                                    i === selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                                )}
                            >
                                <div className="p-1.5 rounded-md bg-muted">
                                    <Icon className="h-4 w-4" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium">{cmd.title}</p>
                                    <p className="text-xs text-muted-foreground">{cmd.description}</p>
                                </div>
                                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
                            </button>
                        )
                    })}
                </div>

                <div className="border-t px-4 py-2 flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1"><kbd className="border rounded px-1">↑↓</kbd> navegar</span>
                    <span className="flex items-center gap-1"><kbd className="border rounded px-1">↵</kbd> abrir</span>
                    <span className="flex items-center gap-1"><kbd className="border rounded px-1">Esc</kbd> fechar</span>
                </div>
            </DialogContent>
        </Dialog>
    )
}
