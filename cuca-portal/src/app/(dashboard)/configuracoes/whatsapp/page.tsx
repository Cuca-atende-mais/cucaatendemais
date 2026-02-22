"use client"

import { useState } from "react"
import {
    Wifi,
    WifiOff,
    RefreshCw,
    QrCode,
    LogOut,
    Building2,
    Calendar,
    Smartphone,
    TriangleAlert,
    Info,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from "@/components/ui/dialog"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

// Simulação do usuário logado (Admin do Cuca Pici)
const MOCK_USER = {
    nome: "João Silva",
    unidade: "Pici",
    role: "admin_cuca_pici"
}

type InstanceType = {
    id: string
    name: string
    category: "Empregabilidade" | "Pontual"
    unit: string
    status: "connected" | "disconnected" | "error"
    phone?: string
}

// Lista filtrada apenas para o Cuca Pici
const INITIAL_INSTANCES: InstanceType[] = [
    { id: "5", name: "Empregabilidade Pici", category: "Empregabilidade", unit: "Pici", status: "connected", phone: "5585999999999" },
    { id: "11", name: "Pontual Pici", category: "Pontual", unit: "Pici", status: "error", phone: "5585888888888" },
]

export default function WhatsAppUnidadePage() {
    const [instances, setInstances] = useState<InstanceType[]>(INITIAL_INSTANCES)
    const [loading, setLoading] = useState<string | null>(null)

    const handleConnect = (id: string) => {
        setLoading(id)
        setTimeout(() => {
            toast.success("QR Code gerado. Escaneie para conectar.")
            setLoading(null)
        }, 1000)
    }

    const handleLogout = (id: string) => {
        if (!confirm("Isso desconectará o número atual. Você tem um chip novo para conectar em seguida?")) return
        setLoading(id)
        setTimeout(() => {
            setInstances(prev => prev.map(inst => inst.id === id ? { ...inst, status: "disconnected", phone: undefined } : inst))
            toast.error("Número desconectado. Coloque o chip novo e gere um QR Code.")
            setLoading(null)
        }, 1000)
    }

    return (
        <div className="flex flex-col gap-6 p-2 md:p-6">
            {/* Header */}
            <div className="flex flex-col gap-1">
                <h1 className="text-2xl font-bold tracking-tight">WhatsApp — Cuca {MOCK_USER.unidade}</h1>
                <p className="text-sm text-muted-foreground">
                    Gerenciamento autônomo de conexão para os canais da sua unidade.
                </p>
            </div>

            {/* Aviso de Auto-Serviço */}
            <Alert className="bg-primary/5 border-primary/20">
                <Info className="h-4 w-4 text-primary" />
                <AlertTitle className="text-primary font-semibold">Autonomia de Unidade</AlertTitle>
                <AlertDescription className="text-xs">
                    Se o seu número for banido, você não precisa ligar para a central.
                    Basta clicar em **"Desconectar/Recuperar"** abaixo, inserir um chip novo no aparelho da unidade e escanear o novo QR Code.
                    A inteligência artificial voltará a funcionar instantaneamente com o novo número.
                </AlertDescription>
            </Alert>

            {/* Instâncias da Unidade */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-4xl">
                {instances.map((inst) => (
                    <Card key={inst.id} className="border-primary/10 shadow-sm relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-3">
                            {inst.status === "connected" ? (
                                <Wifi className="h-5 w-5 text-emerald-500" />
                            ) : (
                                <WifiOff className="h-5 w-5 text-muted-foreground opacity-50" />
                            )}
                        </div>

                        <CardHeader>
                            <div className="flex items-center gap-2 mb-2">
                                <div className="p-2 rounded-full bg-primary/10 text-primary">
                                    {inst.category === "Empregabilidade" ? <Building2 className="h-5 w-5" /> : <Calendar className="h-5 w-5" />}
                                </div>
                                <Badge variant="outline" className="font-normal text-[10px] uppercase tracking-wider">
                                    {inst.category}
                                </Badge>
                            </div>
                            <CardTitle className="text-xl">{inst.name}</CardTitle>
                            <CardDescription className="text-xs">
                                Canal oficial de {inst.category.toLowerCase()} da unidade {inst.unit}.
                            </CardDescription>
                        </CardHeader>

                        <CardContent>
                            <div className="space-y-3">
                                <div className="flex justify-between items-center py-2 border-b border-dashed">
                                    <span className="text-xs text-muted-foreground">Status da Conexão:</span>
                                    <Badge variant={inst.status === "connected" ? "default" : "secondary"} className={inst.status === "connected" ? "bg-emerald-500" : ""}>
                                        {inst.status === "connected" ? "Ativo" : "Desconectado"}
                                    </Badge>
                                </div>
                                <div className="flex justify-between items-center py-2 border-b border-dashed">
                                    <span className="text-xs text-muted-foreground">Número Atual:</span>
                                    <span className="text-sm font-mono">{inst.phone || "Aguardando conexão..."}</span>
                                </div>
                            </div>
                        </CardContent>

                        <CardFooter className="flex gap-3 bg-secondary/10 pt-4">
                            {inst.status === "connected" ? (
                                <Button
                                    variant="outline"
                                    className="w-full text-destructive border-destructive/20 hover:bg-destructive/5 h-10"
                                    onClick={() => handleLogout(inst.id)}
                                    disabled={loading === inst.id}
                                >
                                    <RefreshCw className="mr-2 h-4 w-4" />
                                    Recuperar Ban / Trocar Chip
                                </Button>
                            ) : (
                                <Dialog>
                                    <DialogTrigger asChild>
                                        <Button
                                            className="w-full h-10 bg-primary hover:bg-primary/90"
                                            onClick={() => handleConnect(inst.id)}
                                            disabled={loading === inst.id}
                                        >
                                            <QrCode className="mr-2 h-4 w-4" />
                                            Conectar WhatsApp
                                        </Button>
                                    </DialogTrigger>
                                    <DialogContent className="sm:max-w-md">
                                        <DialogHeader>
                                            <DialogTitle>Vincular WhatsApp da Unidade</DialogTitle>
                                            <DialogDescription className="text-xs">
                                                Use o celular oficial do CUCA {MOCK_USER.unidade} para escanear.
                                                A automação assumirá o controle deste chip imediatamente.
                                            </DialogDescription>
                                        </DialogHeader>
                                        <div className="flex flex-col items-center justify-center p-8 bg-white border-2 border-dashed rounded-xl">
                                            <div className="relative group">
                                                <QrCode className="h-48 w-48 text-slate-200" />
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                    <div className="flex flex-col items-center">
                                                        <RefreshCw className="h-10 w-10 text-primary animate-spin mb-2" />
                                                        <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-widest">Aguardando UAZAPI...</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="mt-6 flex flex-col gap-2 w-full">
                                                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                                    Webhook mestre configurado e aguardando conexão.
                                                </div>
                                                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                                    <div className="h-1.5 w-1.5 rounded-full bg-sky-500" />
                                                    Token da instância ativo na unidade {MOCK_USER.unidade}.
                                                </div>
                                            </div>
                                        </div>
                                    </DialogContent>
                                </Dialog>
                            )}
                        </CardFooter>

                        {/* Banner de Erro/Banimento simulado */}
                        {inst.status === "error" && (
                            <div className="absolute inset-0 bg-destructive/90 flex flex-col items-center justify-center p-6 text-center text-white">
                                <TriangleAlert className="h-12 w-12 mb-2" />
                                <h3 className="font-bold text-lg">Número Banido</h3>
                                <p className="text-xs mb-4">A Meta desconectou este chip por comportamento suspeito.</p>
                                <Button
                                    variant="secondary"
                                    className="w-full"
                                    onClick={() => handleLogout(inst.id)}
                                >
                                    Conectar Chip Reserva
                                </Button>
                            </div>
                        )}
                    </Card>
                ))}
            </div>

            <div className="mt-auto pt-8 border-t flex items-center gap-4 text-[10px] text-muted-foreground">
                <Info className="h-4 w-4" />
                <p>
                    Dúvidas técnicas? O canal de **Empregabilidade Geral** pode ser usado para suporte interno.
                    Lembre-se: nunca use o WhatsApp pessoal para as instâncias da unidade.
                </p>
            </div>
        </div>
    )
}
