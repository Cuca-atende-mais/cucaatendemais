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
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { unidadesCuca } from "@/lib/constants"
import toast from "react-hot-toast"
import { Calendar, MapPin, Sparkles, Upload, X, Users, Globe } from "lucide-react"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { useUser } from "@/lib/auth/user-provider"

interface UnifiedProgramModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSuccess: () => void
}

export function UnifiedProgramModal({ open, onOpenChange, onSuccess }: UnifiedProgramModalProps) {
    const { hasPermission } = useUser()
    const [loading, setLoading] = useState(false)
    const [isPontual, setIsPontual] = useState(hasPermission("programacao_pontual", "create"))

    // Form states
    const [titulo, setTitulo] = useState("")
    const [descricao, setDescricao] = useState("")
    const [unidade, setUnidade] = useState<string>("")

    // Pontual specific
    const [dataInicio, setDataInicio] = useState("")
    const [dataFim, setDataFim] = useState("")
    const [local, setLocal] = useState("")
    const [flyerFile, setFlyerFile] = useState<File | null>(null)
    const [flyerPreview, setFlyerPreview] = useState<string | null>(null)

    // Mensal specific
    const [mes, setMes] = useState(new Date().getMonth() + 1)
    const [ano, setAno] = useState(new Date().getFullYear())

    // S13-06: Expansiva (via Divulgação Global)
    const [expansiva, setExpansiva] = useState(false)

    // S13-11: Público-alvo por categorias de interesse
    const [categorias, setCategorias] = useState<{ id: string; nome: string; pai_id: string | null }[]>([])
    const [categoriasAlvo, setCategoriasAlvo] = useState<string[]>([])
    const [alcanceEstimado, setAlcanceEstimado] = useState<number | null>(null)

    const supabase = createClient()

    useEffect(() => {
        if (open) {
            supabase.from("categorias_interesse").select("id, nome, pai_id").eq("ativo", true).order("ordem")
                .then(({ data }) => setCategorias(data ?? []))
        }
    }, [open])

    const toggleCategoriaAlvo = async (catId: string) => {
        const novaLista = categoriasAlvo.includes(catId)
            ? categoriasAlvo.filter(id => id !== catId)
            : [...categoriasAlvo, catId]
        setCategoriasAlvo(novaLista)

        // Calcular alcance estimado
        if (novaLista.length > 0) {
            const { count } = await supabase
                .from("lead_interesses")
                .select("lead_id", { count: "exact", head: true })
                .in("categoria_id", novaLista)
            setAlcanceEstimado(count ?? 0)
        } else {
            setAlcanceEstimado(null)
        }
    }

    const handleSave = async () => {
        if (!titulo || (isPontual && (!unidade || !dataInicio || !dataFim))) {
            toast.error("Preencha os campos obrigatórios")
            return
        }

        setLoading(true)

        try {
            let flyerUrl = null
            if (isPontual && flyerFile) {
                const fileExt = flyerFile.name.split('.').pop()
                const fileName = `${Math.random()}.${fileExt}`
                const filePath = `flyers/${fileName}`

                const { error: uploadError } = await supabase.storage
                    .from('programacao')
                    .upload(filePath, flyerFile)

                if (uploadError) throw uploadError

                const { data: { publicUrl } } = supabase.storage
                    .from('programacao')
                    .getPublicUrl(filePath)

                flyerUrl = publicUrl
            }

            if (isPontual) {
                // Salvar em eventos_pontuais -> Status: aguardando_aprovacao
                const { error } = await supabase.from("eventos_pontuais").insert({
                    titulo,
                    descricao,
                    unidade_cuca: unidade,
                    data_evento: dataInicio,  // Mapeamento extra para cobrir a coluna non-nullable
                    data_inicio: dataInicio,
                    data_fim: dataFim,
                    local,
                    flyer_url: flyerUrl,
                    status: "aguardando_aprovacao",
                    expansiva,
                    categorias_alvo: categoriasAlvo.length > 0 ? categoriasAlvo : [],
                })
                if (error) throw error
                toast.success("Evento enviado para aprovação!")
            } else {
                // Salvar em campanhas_mensais -> Status: aguardando_aprovacao
                const { error } = await supabase.from("campanhas_mensais").insert({
                    titulo,
                    descricao,
                    mes,
                    ano,
                    status: "aguardando_aprovacao"
                })
                if (error) throw error
                toast.success("Programação mensal enviada para aprovação da comissão!")
            }

            onSuccess()
            onOpenChange(false)
            resetForm()
        } catch (error: any) {
            console.error("Erro ao salvar:", error)
            toast.error(error.message || "Erro técnico ao salvar item")
        } finally {
            setLoading(false)
        }
    }

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (file) {
            setFlyerFile(file)
            setFlyerPreview(URL.createObjectURL(file))
        }
    }

    const resetForm = () => {
        setTitulo("")
        setDescricao("")
        setUnidade("")
        setDataInicio("")
        setDataFim("")
        setLocal("")
        setFlyerFile(null)
        setFlyerPreview(null)
        setCategoriasAlvo([])
        setAlcanceEstimado(null)
        setExpansiva(false)
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <div className="flex items-center gap-2 mb-2">
                        <div className="p-2 bg-cuca-yellow/20 rounded-lg">
                            <Sparkles className="h-5 w-5 text-cuca-yellow" />
                        </div>
                        <DialogTitle className="text-xl">Nova Programação</DialogTitle>
                    </div>
                    <DialogDescription>
                        Cadastre eventos pontuais (cursos, festivais) ou a grade mensal de atividades.
                    </DialogDescription>
                </DialogHeader>

                <div className="grid gap-6 py-4">
                    {/* Toggle Selector */}
                    <div className="flex items-center justify-between p-3 bg-muted/40 rounded-xl border border-muted-foreground/10">
                        <div className="space-y-0.5">
                            <Label className="text-sm font-bold">Categoria</Label>
                            <p className="text-xs text-muted-foreground">
                                {isPontual ? "Aprovação superior necessária" : "Ativação imediata no RAG"}
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className={!isPontual ? "text-xs font-bold text-cuca-blue" : "text-xs text-muted-foreground"}>Mensal</span>
                            <Switch checked={isPontual} onCheckedChange={setIsPontual} />
                            <span className={isPontual ? "text-xs font-bold text-cuca-yellow" : "text-xs text-muted-foreground"}>Pontual</span>
                        </div>
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="titulo">Título do Evento / Campanha</Label>
                        <Input
                            id="titulo"
                            placeholder="Ex: Festival de Natação ou Grade de Março/2026"
                            value={titulo}
                            onChange={(e) => setTitulo(e.target.value)}
                        />
                    </div>

                    <div className="grid gap-2">
                        <Label htmlFor="descricao">Descrição (Contexto para a IA)</Label>
                        <Textarea
                            id="descricao"
                            placeholder="Descreva detalhes importantes que a IA deve saber..."
                            rows={3}
                            value={descricao}
                            onChange={(e) => setDescricao(e.target.value)}
                        />
                    </div>

                    {isPontual ? (
                        <div className="grid gap-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label className="flex items-center gap-2"><Calendar className="h-3 w-3" /> Data Início</Label>
                                    <Input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
                                </div>
                                <div className="grid gap-2">
                                    <Label className="flex items-center gap-2"><Calendar className="h-3 w-3" /> Data Fim</Label>
                                    <Input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-2">
                                    <Label className="flex items-center gap-2"><MapPin className="h-3 w-3" /> Local</Label>
                                    <Input placeholder="Local do evento" value={local} onChange={(e) => setLocal(e.target.value)} />
                                </div>
                                <div className="grid gap-2">
                                    <Label className="flex items-center gap-2"><MapPin className="h-3 w-3" /> Unidade</Label>
                                    <Select value={unidade} onValueChange={setUnidade}>
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
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-2 gap-4 p-4 bg-cuca-blue/5 rounded-xl border border-cuca-blue/10">
                            <div className="grid gap-2">
                                <Label>Mês de Referência</Label>
                                <Select value={mes.toString()} onValueChange={(v) => setMes(parseInt(v))}>
                                    <SelectTrigger>
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {Array.from({ length: 12 }, (_, i) => i + 1).map(m => (
                                            <SelectItem key={m} value={m.toString()}>
                                                {format(new Date(2024, m - 1, 1), "MMMM", { locale: ptBR })}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="grid gap-2">
                                <Label>Ano</Label>
                                <Input type="number" value={ano} onChange={(e) => setAno(parseInt(e.target.value))} />
                            </div>
                        </div>
                    )}

                    {/* S13-06: Toggle Expansiva / Via Divulgação Global (Apenas Pontual) */}
                    {isPontual && (
                        <div
                            className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-colors ${expansiva ? "bg-cuca-yellow/10 border-cuca-yellow/40" : "bg-muted/30 border-muted-foreground/10"}`}
                            onClick={() => setExpansiva(v => !v)}
                        >
                            <div className="space-y-0.5">
                                <Label className="text-sm font-bold flex items-center gap-2 cursor-pointer">
                                    <Globe className="h-4 w-4" /> Evento Expansivo
                                </Label>
                                <p className="text-xs text-muted-foreground">
                                    {expansiva
                                        ? "Disparo via instância Divulgação Global — atinge todas as unidades."
                                        : "Disparo via canal institucional da unidade selecionada (padrão)."}
                                </p>
                            </div>
                            <Switch checked={expansiva} onCheckedChange={setExpansiva} onClick={e => e.stopPropagation()} />
                        </div>
                    )}

                    {/* S13-11: Público-alvo por Interesses (Apenas Pontual) */}
                    {isPontual && categorias.length > 0 && (
                        <div className="grid gap-2">
                            <Label className="flex items-center gap-2">
                                <Users className="h-3.5 w-3.5" /> Público-alvo por Interesses
                                {alcanceEstimado !== null && (
                                    <Badge variant="secondary" className="ml-auto text-xs">
                                        ~{alcanceEstimado} leads com esses interesses
                                    </Badge>
                                )}
                            </Label>
                            <div className="border rounded-lg p-3 space-y-3 bg-muted/20">
                                {categorias.filter(c => !c.pai_id).map(pai => {
                                    const subs = categorias.filter(c => c.pai_id === pai.id)
                                    return (
                                        <div key={pai.id}>
                                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-1.5">{pai.nome}</p>
                                            <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                                                {subs.map(sub => (
                                                    <div key={sub.id} className="flex items-center gap-1.5">
                                                        <Checkbox
                                                            id={`cat-${sub.id}`}
                                                            checked={categoriasAlvo.includes(sub.id)}
                                                            onCheckedChange={() => toggleCategoriaAlvo(sub.id)}
                                                        />
                                                        <label htmlFor={`cat-${sub.id}`} className="text-xs cursor-pointer">
                                                            {sub.nome}
                                                        </label>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Selecione os grupos de interesse para filtrar o disparo desse evento. Deixe em branco para atingir todos.
                            </p>
                        </div>
                    )}

                    {/* Flyer Upload (Apenas Pontual) */}
                    {isPontual && (
                        <div className="grid gap-2">
                            <Label>Flyer / Arte do Evento</Label>
                            <div className="border-2 border-dashed rounded-xl p-4 flex flex-col items-center justify-center gap-3 transition-colors hover:bg-muted/30 relative">
                                {flyerPreview ? (
                                    <div className="relative w-full aspect-video rounded-lg overflow-hidden border">
                                        <img src={flyerPreview} alt="Preview" className="w-full h-full object-cover" />
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
                                            <p className="text-sm font-medium">Clique para fazer upload</p>
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
                    )}
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                        Cancelar
                    </Button>
                    <Button
                        className={isPontual ? "bg-cuca-yellow text-cuca-dark hover:bg-yellow-500" : "bg-cuca-blue hover:bg-sky-800 text-white"}
                        onClick={handleSave}
                        disabled={loading || (isPontual ? !hasPermission("programacao_pontual", "create") : !hasPermission("programacao_mensal", "create"))}
                    >
                        {loading ? "Salvando..." : isPontual ? "Enviar para Aprovação" : "Publicar Grade Mensal"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
