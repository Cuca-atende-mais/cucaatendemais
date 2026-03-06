"use client"

/**
 * ChipDivulgacaoTab
 * ─────────────────
 * Gestão da instância "Divulgação" embutida no painel /divulgacao.
 * Permite criar, reconectar (QR Code inline) e atualizar o número
 * sem precisar de acesso a Configurações/WhatsApp.
 *
 * Quem pode usar: qualquer usuário com divulgacao:read (ver status)
 *                 e divulgacao:create (criar / reconectar chip)
 */

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import {
    Radio, Wifi, WifiOff, QrCode, Loader2,
    Plus, RefreshCw, LogOut, CheckCircle2, AlertCircle, Save,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Dialog, DialogContent, DialogDescription, DialogHeader,
    DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { toast } from "sonner"
import { useUazapi } from "@/hooks/use-uazapi"

/* ─── Tipos ─── */
type Instancia = {
    id: string
    nome: string
    canal_tipo: string
    telefone: string | null
    token: string | null
    ativa: boolean
    observacoes: string | null
    webhook_url: string | null
}

interface Props {
    podeCriar: boolean  // tem divulgacao:create na matriz?
}

/* ─── Componente ─── */
export function ChipDivulgacaoTab({ podeCriar }: Props) {
    const supabase = createClient()
    const { qrStatus, qrCode, criarInstancia, refreshQrCode, logoutInstancia, resetQr } = useUazapi()

    const [instancia, setInstancia] = useState<Instancia | null>(null)
    const [fetching, setFetching] = useState(true)
    const [modalCriar, setModalCriar] = useState(false)
    const [modalReconectar, setModalReconectar] = useState(false)
    const [iNome, setINome] = useState("")
    const [iObs, setIObs] = useState("")
    const [saving, setSaving] = useState(false)

    /* ─── Buscar instância Divulgação ─── */
    const fetchInstancia = useCallback(async () => {
        setFetching(true)
        const { data } = await supabase
            .from("instancias_uazapi")
            .select("*")
            .eq("canal_tipo", "Divulgação")
            .order("ativa", { ascending: false })
            .limit(1)
            .maybeSingle()
        setInstancia(data ?? null)
        setFetching(false)
    }, [supabase])

    useEffect(() => { fetchInstancia() }, [fetchInstancia])

    /* ─── Criar nova instância ─── */
    const handleCriar = async () => {
        if (!iNome.trim()) { toast.error("Informe um nome para a instância."); return }
        setSaving(true)
        const result = await criarInstancia(
            { nome: iNome.trim(), canal_tipo: "Divulgação", observacoes: iObs || null },
            () => { fetchInstancia(); setModalCriar(false) }
        )
        if (!result) setSaving(false)
    }

    /* ─── Abrir modal de reconexão ─── */
    const handleReconectar = async () => {
        if (!instancia) return
        setModalReconectar(true)
        await refreshQrCode(instancia.nome, () => { fetchInstancia(); setModalReconectar(false) })
    }

    /* ─── Logout do chip ─── */
    const handleLogout = async () => {
        if (!instancia) return
        if (!confirm(`Desconectar o chip "${instancia.nome}"? O número precisará ser reconectado.`)) return
        const ok = await logoutInstancia(instancia.nome)
        if (ok) { toast.success("Chip desconectado."); fetchInstancia() }
    }

    /* ─── Status badge ─── */
    const isConectado = instancia?.ativa && instancia?.token

    if (fetching) {
        return (
            <Card className="shadow-sm border-slate-100">
                <CardContent className="flex items-center justify-center py-10">
                    <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
                </CardContent>
            </Card>
        )
    }

    return (
        <>
            <Card className="shadow-sm border-slate-100">
                <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Radio className="h-5 w-5 text-yellow-500" />
                        Chip de Divulgação
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* ── Sem instância ── */}
                    {!instancia ? (
                        <div className="flex flex-col items-center gap-4 py-6 text-center">
                            <AlertCircle className="h-10 w-10 text-amber-400" />
                            <div>
                                <p className="font-semibold text-slate-700">Nenhuma instância Divulgação criada</p>
                                <p className="text-sm text-slate-500 mt-1">
                                    Crie o chip de Divulgação para começar a enviar anúncios globais.
                                </p>
                            </div>
                            {podeCriar && (
                                <Button
                                    onClick={() => { setINome(""); setIObs(""); setModalCriar(true) }}
                                    className="gap-2"
                                >
                                    <Plus className="h-4 w-4" /> Criar Chip Divulgação
                                </Button>
                            )}
                        </div>
                    ) : (
                        /* ── Instância existente ── */
                        <div className="space-y-3">
                            {/* Status row */}
                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
                                <div className="flex items-center gap-3">
                                    {isConectado
                                        ? <Wifi className="h-5 w-5 text-green-500" />
                                        : <WifiOff className="h-5 w-5 text-red-400" />
                                    }
                                    <div>
                                        <p className="font-semibold text-slate-700 text-sm">{instancia.nome}</p>
                                        <p className="text-xs text-slate-500">{instancia.telefone ?? "Número não registrado"}</p>
                                    </div>
                                    <Badge className={isConectado
                                        ? "bg-green-100 text-green-700 border-green-200"
                                        : "bg-red-100 text-red-600 border-red-200"
                                    }>
                                        {isConectado ? "Conectado" : "Desconectado"}
                                    </Badge>
                                </div>
                                {podeCriar && (
                                    <div className="flex gap-2 shrink-0">
                                        {!isConectado ? (
                                            <Button
                                                size="sm" variant="default"
                                                className="gap-1.5 text-xs"
                                                onClick={handleReconectar}
                                                disabled={qrStatus === "loading"}
                                            >
                                                {qrStatus === "loading"
                                                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                                    : <QrCode className="h-3.5 w-3.5" />
                                                }
                                                Conectar/QR Code
                                            </Button>
                                        ) : (
                                            <Button
                                                size="sm" variant="outline"
                                                className="gap-1.5 text-xs text-amber-600 border-amber-200 hover:bg-amber-50"
                                                onClick={handleLogout}
                                            >
                                                <LogOut className="h-3.5 w-3.5" />
                                                Trocar Chip
                                            </Button>
                                        )}
                                        <Button
                                            size="sm" variant="ghost"
                                            className="gap-1.5 text-xs"
                                            onClick={handleReconectar}
                                            disabled={qrStatus === "loading"}
                                        >
                                            <RefreshCw className="h-3.5 w-3.5" />
                                            Reconectar
                                        </Button>
                                    </div>
                                )}
                            </div>

                            {/* Aviso de desconexão */}
                            {!isConectado && (
                                <Alert className="border-red-200 bg-red-50">
                                    <AlertCircle className="h-4 w-4 text-red-500" />
                                    <AlertDescription className="text-red-700 text-xs">
                                        Chip desconectado. Clique em <strong>Conectar/QR Code</strong> para reconectar o WhatsApp.
                                    </AlertDescription>
                                </Alert>
                            )}

                            {/* Token info */}
                            <div className="flex items-center gap-2 text-xs text-slate-500">
                                <span className="font-medium">Token:</span>
                                <Badge variant="outline" className="text-[10px]">
                                    {instancia.token ? "✓ Configurado" : "⚠ Pendente"}
                                </Badge>
                                {instancia.webhook_url && (
                                    <>
                                        <span className="font-medium ml-2">Webhook:</span>
                                        <Badge variant="outline" className="text-[10px]">✓ Configurado</Badge>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* ── Modal: Criar Instância ── */}
            <Dialog open={modalCriar} onOpenChange={(v) => { if (!v) { resetQr(); setSaving(false) }; setModalCriar(v) }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <Radio className="h-5 w-5 text-yellow-500" />
                            Criar Chip de Divulgação
                        </DialogTitle>
                        <DialogDescription>
                            Crie a instância WhatsApp exclusiva para anúncios globais da Rede CUCA.
                        </DialogDescription>
                    </DialogHeader>

                    {qrStatus === "idle" || qrStatus === "error" ? (
                        <div className="space-y-3">
                            <div className="space-y-1.5">
                                <Label htmlFor="d-nome">Nome da instância</Label>
                                <Input
                                    id="d-nome"
                                    placeholder="ex: divulgacao-rede-cuca"
                                    value={iNome}
                                    onChange={e => setINome(e.target.value)}
                                />
                                <p className="text-xs text-muted-foreground">
                                    Use letras minúsculas, números e hífens. Sem espaços.
                                </p>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="d-obs">Observação (opcional)</Label>
                                <Input
                                    id="d-obs"
                                    placeholder="ex: Chip de divulgação da Rede CUCA"
                                    value={iObs}
                                    onChange={e => setIObs(e.target.value)}
                                />
                            </div>
                        </div>
                    ) : qrStatus === "loading" ? (
                        <div className="flex flex-col items-center gap-3 py-8">
                            <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
                            <p className="text-sm text-muted-foreground">Criando instância e gerando QR Code...</p>
                        </div>
                    ) : qrStatus === "qr_ready" && qrCode ? (
                        <div className="flex flex-col items-center gap-3 py-2">
                            <p className="text-sm font-medium text-slate-700">Escaneie com o WhatsApp:</p>
                            <img
                                src={`data:image/png;base64,${qrCode}`}
                                alt="QR Code WhatsApp"
                                className="w-56 h-56 border-4 border-slate-200 rounded-lg"
                            />
                            <p className="text-xs text-muted-foreground text-center">
                                Abra o WhatsApp → Dispositivos vinculados → Vincular dispositivo
                            </p>
                            <Alert className="border-amber-200 bg-amber-50">
                                <AlertDescription className="text-amber-700 text-xs">
                                    QR Code expira em 30 segundos. Aguarde a confirmação de conexão.
                                </AlertDescription>
                            </Alert>
                        </div>
                    ) : qrStatus === "connected" ? (
                        <div className="flex flex-col items-center gap-3 py-8">
                            <CheckCircle2 className="h-12 w-12 text-green-500" />
                            <p className="font-semibold text-green-700">WhatsApp conectado!</p>
                        </div>
                    ) : null}

                    <DialogFooter>
                        <Button variant="ghost" onClick={() => { resetQr(); setSaving(false); setModalCriar(false) }}>
                            Cancelar
                        </Button>
                        {(qrStatus === "idle" || qrStatus === "error") && (
                            <Button onClick={handleCriar} disabled={saving || qrStatus === "loading"}>
                                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
                                Criar e Gerar QR
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Modal: Reconectar ── */}
            <Dialog open={modalReconectar} onOpenChange={(v) => { if (!v) { resetQr() }; setModalReconectar(v) }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <QrCode className="h-5 w-5 text-yellow-500" />
                            Reconectar Chip — {instancia?.nome}
                        </DialogTitle>
                        <DialogDescription>
                            Escaneie o QR Code abaixo com o número WhatsApp do chip de Divulgação.
                        </DialogDescription>
                    </DialogHeader>

                    {qrStatus === "loading" ? (
                        <div className="flex flex-col items-center gap-3 py-8">
                            <Loader2 className="h-10 w-10 animate-spin text-yellow-500" />
                            <p className="text-sm text-muted-foreground">Gerando QR Code...</p>
                        </div>
                    ) : qrStatus === "qr_ready" && qrCode ? (
                        <div className="flex flex-col items-center gap-3 py-2">
                            <p className="text-sm font-medium text-slate-700">Escaneie com o WhatsApp:</p>
                            <img
                                src={`data:image/png;base64,${qrCode}`}
                                alt="QR Code WhatsApp"
                                className="w-56 h-56 border-4 border-slate-200 rounded-lg"
                            />
                            <p className="text-xs text-muted-foreground text-center">
                                Abra o WhatsApp → Dispositivos vinculados → Vincular dispositivo
                            </p>
                            <Alert className="border-amber-200 bg-amber-50">
                                <AlertDescription className="text-amber-700 text-xs">
                                    QR Code expira em 30s. Aguardando pareamento...
                                </AlertDescription>
                            </Alert>
                        </div>
                    ) : qrStatus === "connected" ? (
                        <div className="flex flex-col items-center gap-3 py-8">
                            <CheckCircle2 className="h-12 w-12 text-green-500" />
                            <p className="font-semibold text-green-700">WhatsApp reconectado!</p>
                        </div>
                    ) : qrStatus === "error" ? (
                        <Alert className="border-red-200 bg-red-50">
                            <AlertCircle className="h-4 w-4 text-red-500" />
                            <AlertDescription className="text-red-700 text-sm">
                                Falha ao gerar QR Code. Verifique a conexão com o Worker e tente novamente.
                            </AlertDescription>
                        </Alert>
                    ) : null}

                    <DialogFooter>
                        <Button variant="ghost" onClick={() => { resetQr(); setModalReconectar(false) }}>
                            Fechar
                        </Button>
                        {qrStatus === "error" && (
                            <Button onClick={handleReconectar}>
                                <RefreshCw className="mr-2 h-4 w-4" /> Tentar Novamente
                            </Button>
                        )}
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
