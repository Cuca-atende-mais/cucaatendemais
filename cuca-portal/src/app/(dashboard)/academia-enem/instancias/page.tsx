"use client"

import { useEffect, useState } from "react"
import { useUser } from "@/lib/auth/user-provider"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
    MessageSquare, ShieldAlert, RefreshCw, CheckCircle2, AlertTriangle, Link2,
} from "lucide-react"
import toast from "react-hot-toast"

interface Conexao {
    status: string | null
    phone_number: string | null
    display_name: string | null
    quality_rating: string | null
    messaging_limit_tier: string | null
    pending_reason: string | null
}

interface Instancia {
    workspace_id: string
    name: string | null
    slug: string | null
    mode: string | null
    forward_to_url: string | null
    assumida_por_nos: boolean
    ativa_local: boolean
    conexao: Conexao | null
    conexaoErro: string | null
}

// Mapeia o status da AuctaFlux para um rótulo/variação de badge legível.
function statusBadge(status: string | null) {
    switch (status) {
        case "connected":
            return { label: "Conectado", variant: "default" as const, icon: CheckCircle2 }
        case "pending_signup":
            return { label: "Aguardando cadastro (AuctaFlux)", variant: "secondary" as const, icon: AlertTriangle }
        case "disconnected":
            return { label: "Desconectado", variant: "destructive" as const, icon: AlertTriangle }
        default:
            return { label: status || "—", variant: "outline" as const, icon: AlertTriangle }
    }
}

export default function InstanciasAcademiaEnemPage() {
    const { isDeveloper, hasPermission, loading: authLoading } = useUser()
    const canRead = isDeveloper || hasPermission("ae_instancia", "read")
    const canAssumir = isDeveloper || hasPermission("ae_instancia", "create")
    const canLiberar = isDeveloper || hasPermission("ae_instancia", "update")

    const [instancias, setInstancias] = useState<Instancia[]>([])
    const [loading, setLoading] = useState(true)
    const [erro, setErro] = useState<string | null>(null)
    // Confirmação de ação (assumir/liberar altera o workspace real / gira o segredo HMAC).
    const [confirmando, setConfirmando] = useState<{ inst: Instancia; acao: "assumir" | "liberar" } | null>(null)
    const [agindo, setAgindo] = useState(false)

    async function executarAcao() {
        if (!confirmando) return
        const { inst, acao } = confirmando
        setAgindo(true)
        try {
            const res = await fetch(`/api/academia-enem/instancias/${acao}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ workspace_id: inst.workspace_id }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json?.error || `Falha ao ${acao}`)
            toast.success(acao === "assumir" ? "Instância assumida." : "Instância liberada.")
            setConfirmando(null)
            await carregar()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : `Erro ao ${acao}`)
        } finally {
            setAgindo(false)
        }
    }

    async function carregar() {
        setLoading(true)
        setErro(null)
        try {
            const res = await fetch("/api/academia-enem/instancias", { cache: "no-store" })
            const json = await res.json()
            if (!res.ok) throw new Error(json?.error || "Falha ao listar instâncias")
            setInstancias(json.instancias ?? [])
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Erro ao carregar"
            setErro(msg)
            toast.error(msg)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (canRead) carregar()
    }, [canRead])

    if (authLoading) return null

    if (!canRead) {
        return (
            <div className="flex flex-col items-center justify-center gap-2 py-24 text-muted-foreground">
                <ShieldAlert className="h-10 w-10" />
                <p>Você não tem permissão para acessar as instâncias da Academia Enem.</p>
            </div>
        )
    }

    return (
        <div className="space-y-6 p-4 md:p-6">
            <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                    <h1 className="flex items-center gap-2 text-2xl font-semibold">
                        <MessageSquare className="h-6 w-6" />
                        Instâncias WhatsApp — Academia Enem
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Instâncias (workspaces) criadas no console da AuctaFlux. Aqui você lista e acompanha o status;
                        a criação/pareamento do número é feita no console da AuctaFlux.
                    </p>
                </div>
                <Button variant="outline" size="sm" onClick={carregar} disabled={loading}>
                    <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                    Atualizar
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Instâncias disponíveis</CardTitle>
                    <CardDescription>
                        {loading ? "Carregando…" : `${instancias.length} instância(s) encontrada(s) na AuctaFlux.`}
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    {erro && (
                        <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                            <AlertTriangle className="h-4 w-4" /> {erro}
                        </div>
                    )}
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Nome</TableHead>
                                <TableHead>Número</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Qualidade</TableHead>
                                <TableHead>Tier de envio</TableHead>
                                <TableHead>Webhook</TableHead>
                                <TableHead className="text-right">Ação</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {!loading && instancias.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                                        Nenhuma instância encontrada na AuctaFlux.
                                    </TableCell>
                                </TableRow>
                            )}
                            {instancias.map((inst) => {
                                const sb = statusBadge(inst.conexao?.status ?? null)
                                const StatusIcon = sb.icon
                                return (
                                    <TableRow key={inst.workspace_id}>
                                        <TableCell className="font-medium">
                                            {inst.name || inst.slug || inst.workspace_id}
                                            {inst.ativa_local && (
                                                <Badge variant="default" className="ml-2">Ativa no módulo</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell>{inst.conexao?.phone_number || "—"}</TableCell>
                                        <TableCell>
                                            <Badge variant={sb.variant} className="gap-1">
                                                <StatusIcon className="h-3 w-3" /> {sb.label}
                                            </Badge>
                                            {inst.conexao?.pending_reason && (
                                                <p className="mt-1 text-xs text-muted-foreground">
                                                    {inst.conexao.pending_reason} — resolver na AuctaFlux.
                                                </p>
                                            )}
                                            {inst.conexaoErro && (
                                                <p className="mt-1 text-xs text-destructive">{inst.conexaoErro}</p>
                                            )}
                                        </TableCell>
                                        <TableCell>{inst.conexao?.quality_rating || "—"}</TableCell>
                                        <TableCell>{inst.conexao?.messaging_limit_tier || "—"}</TableCell>
                                        <TableCell>
                                            {inst.assumida_por_nos ? (
                                                <Badge variant="secondary" className="gap-1">
                                                    <Link2 className="h-3 w-3" /> Apontado p/ nós
                                                </Badge>
                                            ) : (
                                                <span className="text-xs text-muted-foreground">Não apontado</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {inst.ativa_local ? (
                                                <Button
                                                    size="sm" variant="outline"
                                                    disabled={!canLiberar}
                                                    onClick={() => setConfirmando({ inst, acao: "liberar" })}
                                                >
                                                    Liberar
                                                </Button>
                                            ) : (
                                                <Button
                                                    size="sm"
                                                    disabled={!canAssumir}
                                                    onClick={() => setConfirmando({ inst, acao: "assumir" })}
                                                >
                                                    Assumir
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <AlertDialog open={!!confirmando} onOpenChange={(o) => { if (!o) setConfirmando(null) }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {confirmando?.acao === "assumir" ? "Assumir instância?" : "Liberar instância?"}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirmando?.acao === "assumir" ? (
                                <>
                                    O sistema vai apontar o webhook desta instância para o portal e <strong>gerar um novo
                                    segredo HMAC</strong> (o anterior é invalidado). A partir daí, as mensagens recebidas
                                    passam a chegar no módulo Academia Enem. Continuar?
                                </>
                            ) : (
                                <>
                                    A instância deixa de ser processada no módulo (<strong>ativa=false</strong>). O número
                                    permanece na AuctaFlux (não é desconectado na Meta). Continuar?
                                </>
                            )}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={agindo}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={(e) => { e.preventDefault(); executarAcao() }}
                            disabled={agindo}
                        >
                            {agindo ? "Processando…" : (confirmando?.acao === "assumir" ? "Assumir" : "Liberar")}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
