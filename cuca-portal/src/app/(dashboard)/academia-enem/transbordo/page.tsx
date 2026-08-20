"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Loader2, Pencil, Phone, Plus, Save, Trash2, UserCheck, X } from "lucide-react"
import toast from "react-hot-toast"

// S-AE-06: contato(s) de transbordo humano PRÓPRIO da Academia Enem. Tela dedicada em vez de
// reaproveitar <TransbordoSection moduloFixo> (usada por Ouvidoria/Acesso CUCA) porque aquele
// componente escreve direto no client via Supabase, gated só pela RLS hardcoded de
// transbordo_humano (Developer/Super Admin Cuca) — incompatível com o RBAC granular que esta
// story pede (ae_transbordo_config, aprovável por perfil). Aqui a escrita passa sempre pela API
// (checkAuth + admin client), consistente com o padrão já usado em ae_leads_filtro/ae_leads_upload.
type Contato = { id: string; responsavel: string; telefone: string; ativo: boolean }

export default function AcademiaEnemTransbordoPage() {
    const [contatos, setContatos] = useState<Contato[]>([])
    const [loading, setLoading] = useState(true)
    const [semPermissao, setSemPermissao] = useState(false)

    const [modalAberto, setModalAberto] = useState(false)
    const [editando, setEditando] = useState<Contato | null>(null)
    const [responsavel, setResponsavel] = useState("")
    const [telefone, setTelefone] = useState("")
    const [salvando, setSalvando] = useState(false)

    useEffect(() => {
        carregar()
    }, [])

    const carregar = async () => {
        setLoading(true)
        try {
            const resp = await fetch("/api/academia-enem/transbordo")
            if (resp.status === 403) {
                setSemPermissao(true)
                return
            }
            const data = await resp.json()
            if (!resp.ok) throw new Error(data.error || "Erro ao carregar contatos")
            setContatos(data.contatos ?? [])
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Erro ao carregar contatos")
        } finally {
            setLoading(false)
        }
    }

    const abrirNovo = () => {
        setEditando(null)
        setResponsavel("")
        setTelefone("")
        setModalAberto(true)
    }

    const abrirEdicao = (c: Contato) => {
        setEditando(c)
        setResponsavel(c.responsavel)
        setTelefone(c.telefone)
        setModalAberto(true)
    }

    const salvar = async () => {
        if (!responsavel.trim() || !telefone.trim()) {
            toast.error("Responsável e telefone são obrigatórios.")
            return
        }
        setSalvando(true)
        try {
            const resp = editando
                ? await fetch("/api/academia-enem/transbordo", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ id: editando.id, responsavel: responsavel.trim(), telefone: telefone.trim() }),
                })
                : await fetch("/api/academia-enem/transbordo", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ responsavel: responsavel.trim(), telefone: telefone.trim() }),
                })
            const data = await resp.json()
            if (!resp.ok) throw new Error(data.error || "Erro ao salvar")
            toast.success(editando ? "Contato atualizado!" : "Contato cadastrado!")
            setModalAberto(false)
            await carregar()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Erro ao salvar")
        } finally {
            setSalvando(false)
        }
    }

    const alternarAtivo = async (c: Contato) => {
        try {
            const resp = await fetch("/api/academia-enem/transbordo", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: c.id, ativo: !c.ativo }),
            })
            const data = await resp.json()
            if (!resp.ok) throw new Error(data.error || "Erro ao atualizar")
            await carregar()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Erro ao atualizar")
        }
    }

    const remover = async (c: Contato) => {
        if (!confirm(`Remover "${c.responsavel}" (${c.telefone})? Ele não receberá mais alertas de transbordo da Academia Enem.`)) return
        try {
            const resp = await fetch(`/api/academia-enem/transbordo?id=${c.id}`, { method: "DELETE" })
            const data = await resp.json()
            if (!resp.ok) throw new Error(data.error || "Erro ao remover")
            toast.success("Removido com sucesso.")
            await carregar()
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Erro ao remover")
        }
    }

    if (semPermissao) {
        return (
            <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
                <UserCheck className="h-10 w-10 mb-3 opacity-30" />
                <p>Você não tem permissão para configurar o transbordo da Academia Enem.</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                    <UserCheck className="h-7 w-7 text-primary" />
                    Transbordo — Academia Enem
                </h1>
                <p className="text-muted-foreground">
                    Quando um lead pede para falar com alguém (ou a IA não consegue ajudar), estes números recebem o alerta.
                </p>
            </div>

            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <div>
                        <CardTitle className="text-base">Responsáveis pelo atendimento humano</CardTitle>
                        <CardDescription>Exclusivo da Academia Enem — não afeta o transbordo de outros módulos.</CardDescription>
                    </div>
                    <Button size="sm" variant="outline" onClick={abrirNovo} className="gap-2">
                        <Plus className="h-3.5 w-3.5" /> Adicionar
                    </Button>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center py-8">
                            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                    ) : contatos.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed">
                            <UserCheck className="h-8 w-8 mx-auto mb-2 opacity-20" />
                            <p className="text-sm">Nenhum atendente cadastrado ainda.</p>
                            <p className="text-xs mt-1">Sem contato configurado, os pedidos de transbordo não são notificados.</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {contatos.map((c) => (
                                <div key={c.id} className="flex items-center justify-between p-3 rounded-lg border bg-secondary/10">
                                    <div className="flex items-center gap-3">
                                        <div className="p-1.5 rounded-full bg-primary/10">
                                            <Phone className="h-4 w-4 text-primary" />
                                        </div>
                                        <div>
                                            <p className="text-sm font-medium">{c.responsavel}</p>
                                            <p className="text-xs text-muted-foreground font-mono">{c.telefone}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Switch checked={c.ativo} onCheckedChange={() => alternarAtivo(c)} />
                                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => abrirEdicao(c)}>
                                            <Pencil className="h-3.5 w-3.5" />
                                        </Button>
                                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => remover(c)}>
                                            <Trash2 className="h-3.5 w-3.5" />
                                        </Button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Dialog open={modalAberto} onOpenChange={setModalAberto}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editando ? "Editar Atendente" : "Novo Atendente"}</DialogTitle>
                        <DialogDescription className="text-xs">
                            Quando a IA não conseguir ajudar (ou o lead pedir), o alerta chega neste WhatsApp.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-2">
                        <div className="grid gap-1.5">
                            <Label>Nome do Responsável *</Label>
                            <Input placeholder="Ex: Equipe Academia Enem" value={responsavel} onChange={(e) => setResponsavel(e.target.value)} />
                        </div>
                        <div className="grid gap-1.5">
                            <Label>WhatsApp (com DDI) *</Label>
                            <Input placeholder="+5585999998888" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
                        </div>
                    </div>
                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setModalAberto(false)}>
                            <X className="mr-2 h-4 w-4" /> Cancelar
                        </Button>
                        <Button onClick={salvar} disabled={salvando}>
                            {salvando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            {editando ? "Salvar" : "Cadastrar"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
