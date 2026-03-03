"use client"

/**
 * CanalWhatsappTab
 * ─────────────────
 * Componente de sub-aba "Canal WhatsApp" reutilizável.
 * Usado dentro de Ouvidoria e Acesso CUCA para que o Super Admin
 * gerencie instâncias e transbordo desses módulos específicos,
 * sem expor essa configuração para gerentes de unidade.
 *
 * Props:
 *   modulo: "Ouvidoria" | "Acesso"  — define qual tipo de canal mostrar
 */

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import {
    Phone, Shield, MessageSquare, Wifi, WifiOff, QrCode, Loader2,
    Plus, Pencil, Trash2, Save, X, UserCheck, RefreshCw, TriangleAlert,
} from "lucide-react"
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Dialog, DialogContent, DialogDescription, DialogHeader,
    DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { toast } from "sonner"
import { useUazapi } from "@/hooks/use-uazapi"

/* ─── Tipos ────────────────────────────────────────────────── */
type Instancia = {
    id: string
    nome: string
    canal_tipo: string
    unidade_cuca: string | null
    telefone: string | null
    token: string | null
    ativa: boolean
    reserva: boolean
    observacoes: string | null
    webhook_url: string | null
}

type Transbordo = {
    id: string
    unidade_cuca: string | null
    modulo: string
    responsavel: string
    telefone: string
    ativo: boolean
}

/* ─── Props ────────────────────────────────────────────────── */
interface Props {
    modulo: "Ouvidoria" | "Acesso"
}

/* ─── Componente ───────────────────────────────────────────── */
export function CanalWhatsappTab({ modulo }: Props) {
    const supabase = createClient()

    const [instancias, setInstancias] = useState<Instancia[]>([])
    const [transbordos, setTransbordos] = useState<Transbordo[]>([])
    const [fetching, setFetching] = useState(true)

    // Modal Instância
    const [modalInst, setModalInst] = useState(false)
    const [editingInst, setEditingInst] = useState<Instancia | null>(null)
    const [iNome, setINome] = useState("")
    const [iObs, setIObs] = useState("")
    const [savingInst, setSavingInst] = useState(false)

    // Modal Transbordo
    const [modalTrans, setModalTrans] = useState(false)
    const [editingTrans, setEditingTrans] = useState<Transbordo | null>(null)
    const [tResponsavel, setTResponsavel] = useState("")
    const [tTelefone, setTTelefone] = useState("")
    const [savingTrans, setSavingTrans] = useState(false)

    // Modal QR Code real
    const [modalQr, setModalQr] = useState(false)
    const [nomeParaConectar, setNomeParaConectar] = useState("")
    const { qrStatus, qrCode, criarInstancia, refreshQrCode, logoutInstancia, excluirInstancia: excluirViaWorker, resetQr } = useUazapi()

    const icon = modulo === "Ouvidoria"
        ? <MessageSquare className="h-5 w-5 text-orange-500" />
        : <Shield className="h-5 w-5 text-purple-500" />

    const colorClass = modulo === "Ouvidoria"
        ? "border-orange-500/30 bg-orange-500/5"
        : "border-purple-500/30 bg-purple-500/5"

    /* ─── Data Loading ───────────────────────────────────── */
    const loadData = useCallback(async () => {
        setFetching(true)
        try {
            const [instRes, transRes] = await Promise.all([
                supabase
                    .from("instancias_uazapi")
                    .select("*")
                    .eq("canal_tipo", modulo)
                    .order("nome"),
                supabase
                    .from("transbordo_humano")
                    .select("*")
                    .eq("modulo", modulo)
                    .order("responsavel"),
            ])
            setInstancias(instRes.data || [])
            setTransbordos(transRes.data || [])
        } catch {
            toast.error("Erro ao carregar dados do canal.")
        } finally {
            setFetching(false)
        }
    }, [modulo])

    useEffect(() => {
        loadData()
    }, [loadData])

    /* ─── CRUD Instância ─────────────────────────────────── */
    const openCreate = () => {
        setEditingInst(null)
        setINome(`cuca_${modulo.toLowerCase()}_global`)
        setIObs("")
        setModalInst(true)
    }

    const openEdit = (inst: Instancia) => {
        setEditingInst(inst)
        setINome(inst.nome)
        setIObs(inst.observacoes || "")
        setModalInst(true)
    }

    const saveInstancia = async () => {
        if (!iNome.trim()) {
            toast.error("Nome é obrigatório.")
            return
        }
        setSavingInst(true)
        try {
            if (editingInst) {
                // Editar: só banco
                const { error } = await supabase.from("instancias_uazapi").update({
                    nome: iNome.trim(),
                    observacoes: iObs.trim() || null,
                    updated_at: new Date().toISOString(),
                }).eq("id", editingInst.id)
                if (error) throw error
                toast.success("Instância atualizada!")
                setModalInst(false)
                await loadData()
            } else {
                // Criar: chama Worker → UAZAPI
                setModalInst(false)
                setNomeParaConectar(iNome.trim())
                setModalQr(true)

                await criarInstancia(
                    {
                        nome: iNome.trim(),
                        canal_tipo: modulo,
                        unidade_cuca: null,   // Global — sem unidade
                        observacoes: iObs.trim() || null,
                    },
                    async () => { await loadData() }
                )
            }
        } catch (err: any) {
            toast.error(`Erro: ${err.message}`)
        } finally {
            setSavingInst(false)
        }
    }

    const conectar = async (inst: Instancia) => {
        setNomeParaConectar(inst.nome)
        setModalQr(true)
        await refreshQrCode(inst.nome, async () => { await loadData() })
    }

    const desativar = async (inst: Instancia) => {
        if (!confirm(`Desconectar "${inst.nome}"?`)) return
        const ok = await logoutInstancia(inst.nome)
        if (ok) {
            toast.success("Instância desconectada com segurança.")
            await loadData()
        }
    }

    const excluir = async (inst: Instancia) => {
        if (!confirm(`EXCLUIR "${inst.nome}"? Irreversível.`)) return
        const ok = await excluirViaWorker(inst.nome)
        if (ok) {
            toast.success("Instância excluída.")
            await loadData()
        }
    }

    /* ─── CRUD Transbordo ────────────────────────────────── */
    const openCreateTrans = () => {
        setEditingTrans(null); setTResponsavel(""); setTTelefone("")
        setModalTrans(true)
    }
    const openEditTrans = (t: Transbordo) => {
        setEditingTrans(t); setTResponsavel(t.responsavel); setTTelefone(t.telefone)
        setModalTrans(true)
    }

    const saveTrans = async () => {
        if (!tResponsavel.trim() || !tTelefone.trim()) {
            toast.error("Responsável e Telefone são obrigatórios.")
            return
        }
        setSavingTrans(true)
        try {
            const payload = {
                unidade_cuca: null,   // Global
                modulo: modulo,
                responsavel: tResponsavel.trim(),
                telefone: tTelefone.trim(),
                ativo: true,
            }
            if (editingTrans) {
                await supabase.from("transbordo_humano").update(payload).eq("id", editingTrans.id)
                toast.success("Atendente atualizado!")
            } else {
                await supabase.from("transbordo_humano").insert(payload)
                toast.success("Atendente cadastrado!")
            }
            setModalTrans(false)
            await loadData()
        } catch (err: any) {
            toast.error(`Erro: ${err.message}`)
        } finally {
            setSavingTrans(false)
        }
    }

    const excluirTrans = async (t: Transbordo) => {
        if (!confirm(`Remover "${t.responsavel}"?`)) return
        await supabase.from("transbordo_humano").delete().eq("id", t.id)
        toast.success("Removido.")
        await loadData()
    }

    /* ─── Render ─────────────────────────────────────────── */
    if (fetching) {
        return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
    }

    return (
        <div className="space-y-6 pt-2">

            {/* Aviso de isolamento */}
            <Alert className={`border ${colorClass}`}>
                {icon}
                <AlertDescription className="text-xs ml-2">
                    Este canal é <strong>exclusivo do Super Admin</strong>. Os gerentes de unidade não têm visibilidade
                    sobre estas instâncias nem sobre os registros de {modulo === "Ouvidoria" ? "ouvidoria" : "acesso"}.
                </AlertDescription>
            </Alert>

            {/* ── Instâncias ── */}
            <div>
                <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-sm flex items-center gap-2">
                        {icon} Número de Atendimento — {modulo}
                    </h3>
                    <Button size="sm" onClick={openCreate} className="gap-1.5 h-8 text-xs">
                        <Plus className="h-3.5 w-3.5" /> Nova Instância
                    </Button>
                </div>

                {instancias.length === 0 ? (
                    <div className="text-center py-10 text-muted-foreground border rounded-xl border-dashed">
                        <QrCode className="h-10 w-10 mx-auto mb-2 opacity-20" />
                        <p className="text-sm font-medium">Nenhuma instância configurada</p>
                        <p className="text-xs mt-1">Crie a instância do canal de {modulo}.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {instancias.map((inst) => (
                            <Card key={inst.id} className={`border shadow-sm ${inst.ativa ? `${colorClass} border` : "border-destructive/20 opacity-75"}`}>
                                <CardHeader className="pb-2">
                                    <div className="flex items-center justify-between">
                                        <Badge variant="outline" className="text-[10px] uppercase tracking-wider">
                                            {inst.canal_tipo} — Global
                                        </Badge>
                                        {inst.ativa
                                            ? <Wifi className="h-4 w-4 text-emerald-500" />
                                            : <WifiOff className="h-4 w-4 text-muted-foreground/40" />
                                        }
                                    </div>
                                    <CardTitle className="text-sm mt-2">{inst.nome}</CardTitle>
                                    <CardDescription className="text-[11px]">
                                        Telefone: <span className="font-mono">{inst.telefone || "—"}</span>
                                        {" · "}Token: {inst.token ? "✓ Ok" : "⚠ Pendente"}
                                    </CardDescription>
                                </CardHeader>

                                <CardFooter className="flex flex-col gap-1.5 pt-2 border-t bg-secondary/10">
                                    <div className="flex w-full gap-1.5">
                                        <Button variant="outline" size="sm" className="flex-1 h-7 text-[10px]" onClick={() => openEdit(inst)}>
                                            <Pencil className="mr-1 h-3 w-3" /> Editar
                                        </Button>
                                        <Button variant="outline" size="sm"
                                            className="h-7 text-[10px] border-destructive/20 text-destructive hover:bg-destructive/5"
                                            onClick={() => excluir(inst)}>
                                            <Trash2 className="h-3 w-3" />
                                        </Button>
                                    </div>
                                    {inst.ativa ? (
                                        <Button variant="ghost" size="sm"
                                            className="w-full h-7 text-[10px] text-amber-600 hover:bg-amber-500/10"
                                            onClick={() => desativar(inst)}>
                                            <RefreshCw className="mr-1 h-3 w-3" /> Recuperar Ban / Trocar Chip
                                        </Button>
                                    ) : (
                                        <Button size="sm" className="w-full h-7 text-[10px]" onClick={() => conectar(inst)}>
                                            <QrCode className="mr-1 h-3 w-3" /> Conectar WhatsApp (QR)
                                        </Button>
                                    )}
                                </CardFooter>
                            </Card>
                        ))}
                    </div>
                )}
            </div>

            {/* ── Transbordo Humano ── */}
            <div className="border rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <UserCheck className="h-4 w-4 text-primary" />
                        Transbordo Humano — {modulo}
                    </div>
                    <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={openCreateTrans}>
                        <Plus className="h-3 w-3" /> Adicionar
                    </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                    Quando a IA não resolver, o sistema avisa estes números.
                </p>

                {transbordos.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground border rounded-lg border-dashed">
                        <p className="text-xs">Nenhum atendente cadastrado.</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {transbordos.map((t) => (
                            <div key={t.id} className="flex items-center justify-between p-2.5 rounded-lg border bg-secondary/10">
                                <div className="flex items-center gap-2.5">
                                    <div className="p-1.5 rounded-full bg-primary/10">
                                        <Phone className="h-3.5 w-3.5 text-primary" />
                                    </div>
                                    <div>
                                        <p className="text-sm font-medium">{t.responsavel}</p>
                                        <p className="text-xs font-mono text-muted-foreground">{t.telefone}</p>
                                    </div>
                                </div>
                                <div className="flex gap-1">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditTrans(t)}>
                                        <Pencil className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                                        onClick={() => excluirTrans(t)}>
                                        <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* ── Modal QR Code Real ── */}
            <Dialog open={modalQr} onOpenChange={(open) => { if (!open) { resetQr(); setModalQr(false) } }}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <QrCode className="h-5 w-5 text-primary" />
                            Parear WhatsApp — {nomeParaConectar}
                        </DialogTitle>
                        <DialogDescription className="text-xs">
                            WhatsApp Business → Dispositivos Vinculados → Vincular dispositivo
                        </DialogDescription>
                    </DialogHeader>

                    <div className="flex flex-col items-center gap-4 py-2">
                        {qrStatus === "loading" && (
                            <div className="flex flex-col items-center gap-3 py-8">
                                <Loader2 className="h-10 w-10 animate-spin text-primary" />
                                <p className="text-sm text-muted-foreground">Criando instância na UAZAPI...</p>
                            </div>
                        )}
                        {qrStatus === "qr_ready" && qrCode && (
                            <>
                                <div className="bg-white p-3 rounded-xl border-2 border-primary/20">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={qrCode.startsWith("data:") ? qrCode : `data:image/png;base64,${qrCode}`}
                                        alt="QR Code WhatsApp"
                                        className="w-48 h-48"
                                    />
                                </div>
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <div className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
                                    Aguardando leitura... (verificando a cada 3s)
                                </div>
                            </>
                        )}
                        {qrStatus === "connected" && (
                            <div className="flex flex-col items-center gap-3 py-8 text-emerald-600">
                                <div className="h-16 w-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
                                    <Wifi className="h-8 w-8" />
                                </div>
                                <p className="font-semibold text-lg">✅ WhatsApp Conectado!</p>
                                <Button onClick={() => { resetQr(); setModalQr(false) }} className="mt-2">Fechar</Button>
                            </div>
                        )}
                        {qrStatus === "error" && (
                            <div className="flex flex-col items-center gap-3 py-6 text-destructive">
                                <TriangleAlert className="h-10 w-10" />
                                <p className="font-medium">Falha ao gerar QR Code</p>
                                <p className="text-xs text-muted-foreground text-center">
                                    Verifique UAZAPI_MASTER_TOKEN no Worker e tente novamente.
                                </p>
                                <Button variant="outline" onClick={() => { resetQr(); setModalQr(false) }}>Fechar</Button>
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>

            {/* ── Modal Instância ── */}
            <Dialog open={modalInst} onOpenChange={setModalInst}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editingInst ? "Editar Instância" : `Nova Instância — ${modulo}`}</DialogTitle>
                        <DialogDescription className="text-xs">
                            {editingInst
                                ? "Atualize o nome ou observações da instância."
                                : `Crie o canal de ${modulo}. Um QR Code será gerado em seguida.`}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-2">
                        <div className="grid gap-1.5">
                            <Label>Nome da Instância *</Label>
                            <Input
                                placeholder={`Ex: cuca_${modulo.toLowerCase()}_global`}
                                value={iNome}
                                onChange={(e) => setINome(e.target.value)}
                            />
                            <p className="text-[10px] text-muted-foreground">
                                Tipo: <strong>{modulo}</strong> · Unidade: <strong>Global</strong>
                            </p>
                        </div>
                        <div className="grid gap-1.5">
                            <Label>Observações (opcional)</Label>
                            <Textarea
                                placeholder="Notas internas sobre este canal..."
                                value={iObs}
                                onChange={(e) => setIObs(e.target.value)}
                                rows={2}
                            />
                        </div>
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setModalInst(false)}>
                            <X className="mr-2 h-4 w-4" /> Cancelar
                        </Button>
                        <Button onClick={saveInstancia} disabled={savingInst}>
                            {savingInst ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            {editingInst ? "Salvar" : "Criar e Gerar QR"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ── Modal Transbordo ── */}
            <Dialog open={modalTrans} onOpenChange={setModalTrans}>
                <DialogContent className="sm:max-w-sm">
                    <DialogHeader>
                        <DialogTitle>{editingTrans ? "Editar Atendente" : "Novo Atendente de Transbordo"}</DialogTitle>
                    </DialogHeader>
                    <div className="grid gap-3 py-2">
                        <div className="grid gap-1.5">
                            <Label>Nome *</Label>
                            <Input placeholder="Ex: Ana da Ouvidoria" value={tResponsavel} onChange={(e) => setTResponsavel(e.target.value)} />
                        </div>
                        <div className="grid gap-1.5">
                            <Label>WhatsApp (com DDI) *</Label>
                            <Input placeholder="+5585999998888" value={tTelefone} onChange={(e) => setTTelefone(e.target.value)} />
                        </div>
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setModalTrans(false)}>
                            <X className="mr-2 h-4 w-4" /> Cancelar
                        </Button>
                        <Button onClick={saveTrans} disabled={savingTrans}>
                            {savingTrans ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            {editingTrans ? "Salvar" : "Cadastrar"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
