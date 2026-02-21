"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import {
    Dialog, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { unidadesCuca } from "@/lib/constants"
import toast from "react-hot-toast"
import { Megaphone, Upload, X, Calendar, MapPin, Users } from "lucide-react"

interface CampanhaModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSuccess: () => void
    userUnidade?: string | null
}

export function CampanhaModal({ open, onOpenChange, onSuccess, userUnidade }: CampanhaModalProps) {
    const [loading, setLoading] = useState(false)
    const [categorias, setCategorias] = useState<{ id: string, nome: string }[]>([])

    // Form states
    const [titulo, setTitulo] = useState("")
    const [templateTexto, setTemplateTexto] = useState("")
    const [unidade, setUnidade] = useState<string>(userUnidade || "")
    const [dataAgendamento, setDataAgendamento] = useState("")
    const [eixoAlvo, setEixoAlvo] = useState<string>("all")
    const [flyerFile, setFlyerFile] = useState<File | null>(null)
    const [flyerPreview, setFlyerPreview] = useState<string | null>(null)

    const supabase = createClient()

    useEffect(() => {
        if (open) {
            fetchCategorias()
        }
    }, [open])

    const fetchCategorias = async () => {
        const { data } = await supabase.from('categorias').select('id, nome').order('nome')
        if (data) setCategorias(data)
    }

    const handleSave = async () => {
        if (!titulo || !templateTexto || !unidade) {
            toast.error("Preencha o título, texto da mensagem e unidade vinculada.")
            return
        }

        setLoading(true)

        try {
            // Buscar ID da unidade selecionada
            const { data: ud } = await supabase.from("unidades_cuca").select("id").eq("nome", unidade).single()
            if (!ud) throw new Error("Unidade não encontrada no banco.")

            let flyerUrl = null
            if (flyerFile) {
                const fileExt = flyerFile.name.split('.').pop()
                const fileName = `campanha_${Math.random()}.${fileExt}`
                const filePath = `flyers/${fileName}`

                const { error: uploadError } = await supabase.storage
                    .from('programacao') // reaproveitando o bucket existente
                    .upload(filePath, flyerFile)

                if (uploadError) throw uploadError

                const { data: { publicUrl } } = supabase.storage
                    .from('programacao')
                    .getPublicUrl(filePath)

                flyerUrl = publicUrl
            }

            // Preparar publico_alvo
            const publicoAlvo = {
                eixos: eixoAlvo === "all" ? [] : [eixoAlvo]
            }

            // Salvar em campanhas
            const { error } = await supabase.from("campanhas").insert({
                titulo,
                template_texto: templateTexto,
                unidade_cuca_id: ud.id,
                agendamento: dataAgendamento ? new Date(dataAgendamento).toISOString() : null,
                midia_url: flyerUrl,
                publico_alvo: publicoAlvo,
                status: "aguardando_aprovacao"
            })

            if (error) throw error

            toast.success("Campanha enviada para aprovação!")
            onSuccess()
            onOpenChange(false)
            resetForm()
        } catch (error: any) {
            console.error("Erro ao salvar campanha:", error)
            toast.error(error.message || "Erro técnico ao salvar campanha")
        } finally {
            setLoading(false)
        }
    }

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) {
            if (file.size > 5 * 1024 * 1024) {
                toast.error("A imagem deve ter no máximo 5MB")
                return
            }
            setFlyerFile(file)
            setFlyerPreview(URL.createObjectURL(file))
        }
    }

    const resetForm = () => {
        setTitulo("")
        setTemplateTexto("")
        if (!userUnidade) setUnidade("")
        setDataAgendamento("")
        setEixoAlvo("all")
        setFlyerFile(null)
        setFlyerPreview(null)
    }

    return (
        <Dialog open={open} onOpenChange={(val) => {
            if (!val) resetForm()
            onOpenChange(val)
        }}>
            <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <div className="flex items-center gap-2 mb-2">
                        <div className="p-2 bg-cuca-blue/20 rounded-lg">
                            <Megaphone className="h-5 w-5 text-cuca-blue" />
                        </div>
                        <DialogTitle className="text-xl">Nova Campanha de Disparo</DialogTitle>
                    </div>
                    <DialogDescription>
                        Crie uma mensagem em massa para ativar leads em sua unidade. Use {"{{nome}}"} para personalizar com o nome do cidadão.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 py-4">
                    <div className="grid gap-2">
                        <Label htmlFor="titulo">Título Interno da Campanha</Label>
                        <Input
                            id="titulo"
                            placeholder="Ex: Chamada Geral Cursos de Computação"
                            value={titulo}
                            onChange={(e) => setTitulo(e.target.value)}
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="template_texto" className="flex justify-between">
                            <span>Mensagem (WhatsApp)</span>
                            <span className="text-muted-foreground text-xs font-normal">Use {"{{nome}}"}</span>
                        </Label>
                        <Textarea
                            id="template_texto"
                            placeholder="Olá {{nome}}! Estão abertas as inscrições para..."
                            rows={5}
                            value={templateTexto}
                            onChange={(e) => setTemplateTexto(e.target.value)}
                        />
                    </div>

                    <div className="grid grid-cols-2 flex-col sm:flex-row gap-4">
                        <div className="grid gap-2">
                            <Label className="flex items-center gap-2"><MapPin className="h-3 w-3" /> Unidade Vinculada</Label>
                            <Select value={unidade} onValueChange={setUnidade} disabled={!!userUnidade && userUnidade !== 'Todas'}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {unidadesCuca.map(u => (
                                        <SelectItem key={u} value={u}>{u}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid gap-2">
                            <Label className="flex items-center gap-2"><Calendar className="h-3 w-3" /> Agendamento (Opcional)</Label>
                            <Input type="datetime-local" value={dataAgendamento} onChange={(e) => setDataAgendamento(e.target.value)} />
                        </div>
                    </div>

                    <div className="grid gap-2 p-4 bg-muted/40 rounded-xl border border-muted-foreground/10">
                        <Label className="flex items-center gap-2 font-bold mb-1"><Users className="h-4 w-4" /> Público-Alvo (Segmentação)</Label>
                        <p className="text-xs text-muted-foreground mb-3">Filtra os leads que possuem opt-in ativo e interesse no Eixo selecionado.</p>

                        <div className="grid gap-2">
                            <Label>Eixo Temático</Label>
                            <Select value={eixoAlvo} onValueChange={setEixoAlvo}>
                                <SelectTrigger className="bg-white">
                                    <SelectValue placeholder="Todos os públicos" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="all">Envio Global (Apenas para base desta Unidade)</SelectItem>
                                    {categorias.map(c => (
                                        <SelectItem key={c.id} value={c.nome}>{c.nome}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    {/* Flyer Upload */}
                    <div className="grid gap-2">
                        <Label>Mídia (Opcional)</Label>
                        <div className="border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center gap-3 transition-colors hover:bg-muted/30 relative">
                            {flyerPreview ? (
                                <div className="relative w-full aspect-[4/3] sm:aspect-video rounded-lg overflow-hidden border">
                                    <img src={flyerPreview} alt="Preview" className="w-full h-full object-contain bg-black/5" />
                                    <Button
                                        size="icon"
                                        variant="destructive"
                                        className="absolute top-2 right-2 h-8 w-8 rounded-full"
                                        onClick={() => { setFlyerFile(null); setFlyerPreview(null) }}
                                    >
                                        <X className="h-4 w-4" />
                                    </Button>
                                </div>
                            ) : (
                                <>
                                    <div className="p-3 bg-muted rounded-full">
                                        <Upload className="h-5 w-5 text-muted-foreground" />
                                    </div>
                                    <div className="text-center">
                                        <p className="text-sm font-medium">Anexar Arte / Imagem</p>
                                        <p className="text-xs text-muted-foreground">PNG, JPG ou JPEG até 5MB</p>
                                    </div>
                                    <Input
                                        type="file"
                                        accept="image/*"
                                        className="absolute inset-0 opacity-0 cursor-pointer"
                                        onChange={handleFileChange}
                                    />
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <DialogFooter className="gap-2 sm:gap-0 mt-4">
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                        Cancelar
                    </Button>
                    <Button
                        className="bg-cuca-blue hover:bg-sky-800 text-white"
                        onClick={handleSave}
                        disabled={loading}
                    >
                        {loading ? "Enviando..." : "Submeter Campanha"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
