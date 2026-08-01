"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
    Dialog, DialogContent, DialogDescription, DialogHeader,
    DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Loader2, Pencil, Phone, Plus, Save, Trash2, UserCheck, X } from "lucide-react"
import { toast } from "sonner"
import { unidadesCuca } from "@/lib/constants"

type Transbordo = {
    id: string
    unidade_cuca: string | null
    modulo: string
    responsavel: string
    telefone: string
    ativo: boolean
}

const MODULOS = [
    { value: "Institucional", label: "Institucional (Maria)" },
    { value: "Empregabilidade", label: "Empregabilidade (Júlia)" },
    { value: "Acesso", label: "Acesso CUCA (Ana)" },
    { value: "Ouvidoria", label: "Ouvidoria (Sofia)" },
]

const MODULO_BADGE_CLASS: Record<string, string> = {
    Institucional: "bg-sky-500/10 text-sky-600 border-sky-500/30",
    Empregabilidade: "bg-emerald-500/10 text-emerald-600 border-emerald-500/30",
    Acesso: "bg-purple-500/10 text-purple-600 border-purple-500/30",
    Ouvidoria: "bg-orange-500/10 text-orange-600 border-orange-500/30",
}

export type TransbordoSectionProps = {
    /** Se definido (perfil não-super-admin), restringe leitura/escrita à própria unidade. */
    unidadeCuca?: string | null
    /**
     * Se definido, trava a seção num único módulo (esconde o seletor de módulo e força esse
     * valor em toda criação/edição) — usado quando o componente é embutido dentro de uma aba
     * de canal específico (ex.: Ouvidoria, Acesso CUCA), que não faz sentido misturar módulos.
     */
    moduloFixo?: string
    /** Título customizável da seção (default: "Transbordo Humano"). */
    titulo?: string
    /** Descrição customizável (default explica o propósito do transbordo). */
    descricao?: string
}

/**
 * Seção de cadastro de contatos de transbordo humano (`transbordo_humano`), usada em
 * /configuracoes/whatsapp, /developer/instancias e na aba de canal de Ouvidoria/Acesso CUCA.
 * Extraída como componente compartilhado (S-WM-63) para evitar 3 cópias divergentes da mesma
 * lógica de CRUD.
 */
export function TransbordoSection({
    unidadeCuca = null,
    moduloFixo,
    titulo = "Transbordo Humano",
    descricao = "Quando a IA não consegue ajudar, o sistema encaminha para estes números.",
}: TransbordoSectionProps) {
    const supabase = createClient()
    const [transbordos, setTransbordos] = useState<Transbordo[]>([])
    const [loading, setLoading] = useState(true)

    const [modalTrans, setModalTrans] = useState(false)
    const [editingTrans, setEditingTrans] = useState<Transbordo | null>(null)
    const [tResponsavel, setTResponsavel] = useState("")
    const [tTelefone, setTTelefone] = useState("")
    const [tModulo, setTModulo] = useState(moduloFixo || "Institucional")
    const [tUnidade, setTUnidade] = useState("global")
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        fetchTransbordos()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [unidadeCuca, moduloFixo])

    const fetchTransbordos = async () => {
        setLoading(true)
        try {
            let query = supabase.from("transbordo_humano").select("*").order("modulo").order("responsavel")
            if (unidadeCuca) {
                query = query.eq("unidade_cuca", unidadeCuca)
            }
            if (moduloFixo) {
                query = query.eq("modulo", moduloFixo)
            }
            const { data } = await query
            setTransbordos(data || [])
        } finally {
            setLoading(false)
        }
    }

    const openCreate = () => {
        setEditingTrans(null)
        setTResponsavel("")
        setTTelefone("")
        setTModulo(moduloFixo || "Institucional")
        setTUnidade(unidadeCuca || "global")
        setModalTrans(true)
    }

    const openEdit = (t: Transbordo) => {
        setEditingTrans(t)
        setTResponsavel(t.responsavel)
        setTTelefone(t.telefone)
        setTModulo(t.modulo)
        setTUnidade(t.unidade_cuca || "global")
        setModalTrans(true)
    }

    const save = async () => {
        if (!tResponsavel.trim() || !tTelefone.trim()) {
            toast.error("Responsável e Telefone são obrigatórios.")
            return
        }
        setSaving(true)
        try {
            const payload = {
                unidade_cuca: unidadeCuca || (tUnidade === "global" || !tUnidade ? null : tUnidade),
                modulo: moduloFixo || tModulo,
                responsavel: tResponsavel.trim(),
                telefone: tTelefone.trim(),
                ativo: true,
            }
            if (editingTrans) {
                const { error } = await supabase.from("transbordo_humano").update(payload).eq("id", editingTrans.id)
                if (error) throw error
                toast.success("Atendente atualizado!")
            } else {
                const { error } = await supabase.from("transbordo_humano").insert(payload)
                if (error) throw error
                toast.success("Atendente de transbordo cadastrado!")
            }
            setModalTrans(false)
            await fetchTransbordos()
        } catch (err: any) {
            toast.error(`Erro: ${err.message}`)
        } finally {
            setSaving(false)
        }
    }

    const excluir = async (t: Transbordo) => {
        if (!confirm(`Remover "${t.responsavel}" (${t.telefone})? Ele não receberá mais chamados de transbordo.`)) return
        try {
            const { error } = await supabase.from("transbordo_humano").delete().eq("id", t.id)
            if (error) throw error
            toast.success("Removido com sucesso.")
            await fetchTransbordos()
        } catch (err: any) {
            toast.error(`Erro ao remover: ${err.message}`)
        }
    }

    return (
        <div className="border rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <UserCheck className="h-5 w-5 text-primary" />
                    <div>
                        <h2 className="font-semibold text-base">{titulo}</h2>
                        <p className="text-xs text-muted-foreground">{descricao}</p>
                    </div>
                </div>
                <Button size="sm" variant="outline" onClick={openCreate} className="gap-2">
                    <Plus className="h-3.5 w-3.5" /> Adicionar
                </Button>
            </div>

            {loading ? (
                <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
            ) : transbordos.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground border rounded-lg border-dashed">
                    <UserCheck className="h-8 w-8 mx-auto mb-2 opacity-20" />
                    <p className="text-xs">Nenhum atendente cadastrado.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {transbordos.map((t) => (
                        <div key={t.id} className="flex items-center justify-between p-3 rounded-lg border bg-secondary/10">
                            <div className="flex items-center gap-3">
                                <div className="p-1.5 rounded-full bg-primary/10">
                                    <Phone className="h-4 w-4 text-primary" />
                                </div>
                                <div>
                                    <p className="text-sm font-medium">{t.responsavel}</p>
                                    <p className="text-xs text-muted-foreground">
                                        <span className="font-mono">{t.telefone}</span>
                                        {" · "}
                                        <Badge variant="outline" className={`text-[10px] ${MODULO_BADGE_CLASS[t.modulo] || ""}`}>{t.modulo}</Badge>
                                        {t.unidade_cuca && <span className="ml-1 opacity-60">· {t.unidade_cuca}</span>}
                                    </p>
                                </div>
                            </div>
                            <div className="flex gap-1">
                                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(t)}>
                                    <Pencil className="h-3.5 w-3.5" />
                                </Button>
                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => excluir(t)}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <Dialog open={modalTrans} onOpenChange={setModalTrans}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>{editingTrans ? "Editar Atendente de Transbordo" : "Novo Atendente de Transbordo"}</DialogTitle>
                        <DialogDescription className="text-xs">
                            Quando a IA não conseguir resolver, o sistema enviará um alerta para este número.
                        </DialogDescription>
                    </DialogHeader>

                    <div className="grid gap-4 py-2">
                        <div className="grid gap-1.5">
                            <Label>Nome do Responsável *</Label>
                            <Input
                                placeholder="Ex: Mariazinha do RH"
                                value={tResponsavel}
                                onChange={(e) => setTResponsavel(e.target.value)}
                            />
                        </div>
                        <div className="grid gap-1.5">
                            <Label>WhatsApp Pessoal (com DDI) *</Label>
                            <Input
                                placeholder="+5585999998888"
                                value={tTelefone}
                                onChange={(e) => setTTelefone(e.target.value)}
                            />
                        </div>
                        <div className={!unidadeCuca && !moduloFixo ? "grid grid-cols-2 gap-3" : "grid gap-1.5"}>
                            {!moduloFixo && (
                                <div className="grid gap-1.5">
                                    <Label>Módulo de Atuação</Label>
                                    <Select value={tModulo} onValueChange={setTModulo}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            {MODULOS.map((m) => (
                                                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                            {!unidadeCuca && !moduloFixo && (
                                <div className="grid gap-1.5">
                                    <Label>Unidade</Label>
                                    <Select value={tUnidade} onValueChange={setTUnidade}>
                                        <SelectTrigger><SelectValue placeholder="Selecione..." /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="global">Global (Todas)</SelectItem>
                                            {unidadesCuca.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        </div>
                    </div>

                    <DialogFooter className="gap-2">
                        <Button variant="outline" onClick={() => setModalTrans(false)}>
                            <X className="mr-2 h-4 w-4" /> Cancelar
                        </Button>
                        <Button onClick={save} disabled={saving}>
                            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            {editingTrans ? "Salvar" : "Cadastrar"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
