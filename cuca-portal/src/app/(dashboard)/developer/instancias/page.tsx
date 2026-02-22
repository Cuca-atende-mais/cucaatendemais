"use client"

import { useState, useEffect } from "react"
import {
    Wifi,
    WifiOff,
    RefreshCw,
    QrCode,
    LogOut,
    Smartphone,
    Building2,
    Calendar,
    MessageSquare,
    Search,
    Filter,
    AlertTriangle,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { toast } from "sonner"

// Tipagem básica para instâncias
type InstanceType = {
    id: string
    name: string
    category: "Empregabilidade" | "Pontual" | "Mensal" | "Ouvidoria" | "Geral"
    unit: string | "Geral"
    status: "connected" | "disconnected" | "error" | "pending"
    phone?: string
    lastSeen?: string
}

// Lista estática das 14 instâncias baseada na documentação ministerial
const INITIAL_INSTANCES: InstanceType[] = [
    { id: "1", name: "Emp. Barra", category: "Empregabilidade", unit: "Barra", status: "disconnected" },
    { id: "2", name: "Emp. Mondubim", category: "Empregabilidade", unit: "Mondubim", status: "disconnected" },
    { id: "3", name: "Emp. Jangurussu", category: "Empregabilidade", unit: "Jangurussu", status: "disconnected" },
    { id: "4", name: "Emp. José Walter", category: "Empregabilidade", unit: "José Walter", status: "disconnected" },
    { id: "5", name: "Emp. Pici", category: "Empregabilidade", unit: "Pici", status: "disconnected" },
    { id: "6", name: "Emp. Geral", category: "Empregabilidade", unit: "Geral", status: "disconnected" },
    { id: "7", name: "Pontual Barra", category: "Pontual", unit: "Barra", status: "disconnected" },
    { id: "8", name: "Pontual Mondubim", category: "Pontual", unit: "Mondubim", status: "disconnected" },
    { id: "9", name: "Pontual Jangurussu", category: "Pontual", unit: "Jangurussu", status: "disconnected" },
    { id: "10", name: "Pontual José Walter", category: "Pontual", unit: "José Walter", status: "disconnected" },
    { id: "11", name: "Pontual Pici", category: "Pontual", unit: "Pici", status: "disconnected" },
    { id: "12", name: "Prog. Mensal", category: "Mensal", unit: "Geral", status: "disconnected" },
    { id: "13", name: "Ouvidoria Jovem", category: "Ouvidoria", unit: "Geral", status: "disconnected" },
    { id: "14", name: "Agente Geral (Sofia)", category: "Geral", unit: "Geral", status: "disconnected" },
]

export default function InstanciasPage() {
    const [instances, setInstances] = useState<InstanceType[]>(INITIAL_INSTANCES)
    const [search, setSearch] = useState("")
    const [filterCategory, setFilterCategory] = useState("all")
    const [loading, setLoading] = useState<string | null>(null)

    // Simulação de ação de conexão (Gera QR Code)
    const handleConnect = (id: string) => {
        setLoading(id)
        setTimeout(() => {
            toast.success("QR Code gerado com sucesso!")
            setLoading(null)
        }, 1500)
    }

    // Simulação de Logout
    const handleLogout = (id: string) => {
        if (!confirm("Tem certeza que deseja desconectar este número?")) return
        setLoading(id)
        setTimeout(() => {
            setInstances(prev => prev.map(inst => inst.id === id ? { ...inst, status: "disconnected" } : inst))
            toast.error("Instância desconectada com segurança.")
            setLoading(null)
        }, 1200)
    }

    const filteredInstances = instances.filter(inst => {
        const matchesSearch = inst.name.toLowerCase().includes(search.toLowerCase()) ||
            inst.unit.toLowerCase().includes(search.toLowerCase())
        const matchesCategory = filterCategory === "all" || inst.category === filterCategory
        return matchesSearch && matchesCategory
    })

    const getStatusIcon = (status: InstanceType["status"]) => {
        switch (status) {
            case "connected": return <Wifi className="h-4 w-4 text-emerald-500" />
            case "disconnected": return <WifiOff className="h-4 w-4 text-muted-foreground" />
            case "error": return <AlertTriangle className="h-4 w-4 text-destructive" />
            default: return <RefreshCw className="h-4 w-4 text-amber-500 animate-spin" />
        }
    }

    const getCategoryIcon = (category: InstanceType["category"]) => {
        switch (category) {
            case "Empregabilidade": return <Building2 className="h-4 w-4" />
            case "Pontual": return <Calendar className="h-4 w-4" />
            case "Mensal": return <Smartphone className="h-4 w-4" />
            case "Ouvidoria": return <MessageSquare className="h-4 w-4" />
            default: return <Smartphone className="h-4 w-4" />
        }
    }

    return (
        <div className="flex flex-col gap-6 p-2 md:p-6">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Gestão de Instâncias UAZAPI</h1>
                    <p className="text-sm text-muted-foreground">
                        Controle e monitoramento dos 14 canais oficiais do WhatsApp
                    </p>
                </div>
                <Badge variant="outline" className="w-fit border-primary/30 text-primary">
                    {instances.filter(i => i.status === "connected").length} / 14 Conectados
                </Badge>
            </div>

            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-3">
                <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        placeholder="Buscar por nome ou unidade..."
                        className="pl-9"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <Select value={filterCategory} onValueChange={setFilterCategory}>
                    <SelectTrigger className="w-full md:w-[200px]">
                        <SelectValue placeholder="Categoria" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">Todas Categorias</SelectItem>
                        <SelectItem value="Empregabilidade">Empregabilidade</SelectItem>
                        <SelectItem value="Pontual">Pontual</SelectItem>
                        <SelectItem value="Mensal">Mensal</SelectItem>
                        <SelectItem value="Ouvidoria">Ouvidoria</SelectItem>
                        <SelectItem value="Geral">Geral</SelectItem>
                    </SelectContent>
                </Select>
            </div>

            {/* Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredInstances.map((inst) => (
                    <Card key={inst.id} className="overflow-hidden border-border/50 hover:border-primary/30 transition-all shadow-sm">
                        <CardHeader className="pb-3 space-y-1">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <div className="p-1.5 rounded-md bg-secondary/50 border border-border/50">
                                        {getCategoryIcon(inst.category)}
                                    </div>
                                    <Badge variant="secondary" className="text-[10px] font-normal">
                                        {inst.category}
                                    </Badge>
                                </div>
                                {getStatusIcon(inst.status)}
                            </div>
                            <CardTitle className="text-base truncate">{inst.name}</CardTitle>
                            <CardDescription className="text-xs">
                                Unidade: {inst.unit}
                            </CardDescription>
                        </CardHeader>

                        <CardContent className="pb-3">
                            <div className="flex flex-col gap-2">
                                <div className="flex justify-between text-[11px]">
                                    <span className="text-muted-foreground">Status:</span>
                                    <span className={`font-medium ${inst.status === "connected" ? "text-emerald-500" : "text-muted-foreground"}`}>
                                        {inst.status === "connected" ? "Conectado" : "Desconectado"}
                                    </span>
                                </div>
                                <div className="flex justify-between text-[11px]">
                                    <span className="text-muted-foreground">Telefone:</span>
                                    <span className="font-mono">{inst.phone || "---"}</span>
                                </div>
                            </div>
                        </CardContent>

                        <CardFooter className="pt-2 border-t bg-secondary/20 flex gap-2">
                            {inst.status === "connected" ? (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="w-full h-8 text-[11px] border-destructive/20 text-destructive hover:bg-destructive/10"
                                    onClick={() => handleLogout(inst.id)}
                                    disabled={loading === inst.id}
                                >
                                    <LogOut className="mr-2 h-3.5 w-3.5" />
                                    Desconectar
                                </Button>
                            ) : (
                                <Dialog>
                                    <DialogTrigger asChild>
                                        <Button
                                            variant="default"
                                            size="sm"
                                            className="w-full h-8 text-[11px]"
                                            onClick={() => handleConnect(inst.id)}
                                            disabled={loading === inst.id}
                                        >
                                            <QrCode className="mr-2 h-3.5 w-3.5" />
                                            Gerar QR Code
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent className="sm:max-w-md">
                                        <DialogHeader>
                                            <DialogTitle>Conectar {inst.name}</DialogTitle>
                                            <DialogDescription>
                                                Abra o WhatsApp no seu celular, vá em Aparelhos Conectados e escaneie o código baixo.
                                            </DialogDescription>
                                        </DialogHeader>
                                        <div className="flex flex-col items-center justify-center p-8 bg-white rounded-lg border">
                                            {/* Mock do QR Code */}
                                            <div className="w-48 h-48 bg-slate-100 flex items-center justify-center border-2 border-dashed border-slate-300 relative group overflow-hidden">
                                                <QrCode className="h-16 w-16 text-slate-300 group-hover:scale-110 transition-transform" />
                                                <div className="absolute inset-0 bg-white/80 flex items-center justify-center opacity-100 transition-opacity">
                                                    <div className="text-center">
                                                        <RefreshCw className="h-8 w-8 text-primary animate-spin mx-auto mb-2" />
                                                        <span className="text-[10px] text-muted-foreground">Gerando QR único...</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <p className="mt-4 text-[11px] text-center text-muted-foreground">
                                                O código expira em 30 segundos. <br />
                                                <span className="text-primary cursor-pointer hover:underline font-medium">Recarregar agora</span>
                                            </p>
                                        </div>
                                    </DialogContent>
                                </Dialog>
                            )}
                        </CardFooter>
                    </Card>
                ))}
            </div>

            {/* Legend/Info */}
            <div className="mt-4 p-4 rounded-lg bg-blue-500/5 border border-blue-500/20 text-[11px] text-muted-foreground flex items-start gap-3">
                <Wifi className="h-4 w-4 text-blue-500 shrink-0" />
                <p>
                    <strong>Nota Técnica:</strong> Todas as instâncias são isoladas via Docker e geridas pela UAZAPI Master.
                    Ao desconectar uma instância, o token será revogado e a sessão limpa preventivamente para evitar banimentos por "sessão fantasma".
                </p>
            </div>
        </div>
    )
}
