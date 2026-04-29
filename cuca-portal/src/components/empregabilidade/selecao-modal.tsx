"use client"

// SQS-49: Modal de criação/edição de Processo Seletivo por Evento (selecao_evento)
// Usado no dashboard interno — espelha os campos de /empregabilidade/selecao/nova

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Vaga } from "@/lib/types/database"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Loader2, Plus, Save, Trash2, CalendarDays, Briefcase } from "lucide-react"
import toast from "react-hot-toast"

interface SelecaoModalProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    onSuccess: () => void
    selecao?: Vaga | null
}

interface CargoLinha { titulo: string; quantidade: string; faixa_etaria: string }
interface DataHora { data: string; hora: string }

const FAIXAS_ETARIAS = ["A partir de 14 anos", "Maior de 18 anos"]

function cargoVazio(): CargoLinha {
    return { titulo: "", quantidade: "1", faixa_etaria: "A partir de 14 anos" }
}

export function SelecaoModal({ open, onOpenChange, onSuccess, selecao }: SelecaoModalProps) {
    const supabase = createClient()
    const [loading, setLoading] = useState(false)
    const [fetching, setFetching] = useState(false)
    const [erro, setErro] = useState("")

    const [empresas, setEmpresas] = useState<Array<{ id: string; nome: string; nome_fantasia?: string }>>([])
    const [unidades, setUnidades] = useState<Array<{ id: string; nome: string }>>([])

    const [empresaId, setEmpresaId] = useState("")
    const [unidadeCuca, setUnidadeCuca] = useState("global")
    const [status, setStatus] = useState("pre_cadastro")
    const [cargos, setCargos] = useState<CargoLinha[]>([cargoVazio()])
    const [datasSelecao, setDatasSelecao] = useState<DataHora[]>([{ data: "", hora: "08:00" }])

    useEffect(() => {
        if (!open) return
        setFetching(true)
        Promise.all([
            supabase.from("empresas").select("id, nome, nome_fantasia").eq("ativa", true).order("nome"),
            supabase.from("unidades_cuca").select("id, nome").order("nome"),
        ]).then(([empRes, uniRes]) => {
            setEmpresas(empRes.data ?? [])
            setUnidades(uniRes.data ?? [])
        }).finally(() => setFetching(false))
    }, [open])

    useEffect(() => {
        if (!open) return
        if (selecao) {
            setEmpresaId(selecao.empresa_id)
            setUnidadeCuca(selecao.unidade_cuca || "global")
            setStatus(selecao.status)
            setCargos(
                selecao.cargos_lista?.length
                    ? selecao.cargos_lista
                    : [cargoVazio()]
            )
            setDatasSelecao(
                selecao.datas_selecao?.length
                    ? selecao.datas_selecao
                    : [{ data: "", hora: "08:00" }]
            )
        } else {
            setEmpresaId("")
            setUnidadeCuca("global")
            setStatus("pre_cadastro")
            setCargos([cargoVazio()])
            setDatasSelecao([{ data: "", hora: "08:00" }])
        }
        setErro("")
    }, [open, selecao])

    // ── Cargos ──────────────────────────────────────────────────────────────────
    const addCargo = () => setCargos(p => [...p, cargoVazio()])
    const removeCargo = (i: number) => setCargos(p => p.filter((_, idx) => idx !== i))
    const updateCargo = (i: number, field: keyof CargoLinha, val: string) =>
        setCargos(p => p.map((c, idx) => idx === i ? { ...c, [field]: val } : c))

    // ── Datas ────────────────────────────────────────────────────────────────────
    const addData = () => setDatasSelecao(p => [...p, { data: "", hora: "08:00" }])
    const removeData = (i: number) => setDatasSelecao(p => p.filter((_, idx) => idx !== i))
    const updateData = (i: number, field: keyof DataHora, val: string) =>
        setDatasSelecao(p => p.map((d, idx) => idx === i ? { ...d, [field]: val } : d))

    async function handleSave() {
        setErro("")
        const cargosValidos = cargos.filter(c => c.titulo.trim())
        if (!empresaId) { setErro("Selecione a empresa."); return }
        if (cargosValidos.length === 0) { setErro("Informe ao menos um cargo."); return }
        const datasValidas = datasSelecao.filter(d => d.data)
        if (datasValidas.length === 0) { setErro("Informe ao menos uma data de seleção."); return }

        setLoading(true)
        try {
            if (selecao) {
                // Edição: PATCH direto via supabase client (campos editáveis do selecao_evento)
                const { error } = await supabase.from("vagas").update({
                    unidade_cuca: unidadeCuca === "global" ? null : unidadeCuca,
                    unidade_destino: "global",
                    cargos_lista: cargosValidos,
                    datas_selecao: datasValidas,
                    status,
                    faixa_etaria: cargosValidos[0]?.faixa_etaria || "A partir de 14 anos",
                    total_vagas: cargosValidos.reduce((acc, c) => acc + (parseInt(c.quantidade) || 1), 0),
                    descricao: cargosValidos.map(c => `${c.titulo}${c.quantidade ? ` (${c.quantidade})` : ""}`).join(", "),
                }).eq("id", selecao.id)
                if (error) throw error
                toast.success("Seleção atualizada.")
            } else {
                // Criação via endpoint dedicado
                const res = await fetch("/api/empregabilidade/selecao", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        empresa_id: empresaId,
                        unidade_cuca: unidadeCuca === "global" ? null : unidadeCuca,
                        cargos_lista: cargosValidos,
                        datas_selecao: datasValidas,
                    }),
                })
                const json = await res.json()
                if (!res.ok) throw new Error(json.error || "Erro ao criar seleção")
                toast.success(`Processo seletivo #${json.numero_vaga} criado.`)
            }
            onSuccess()
            onOpenChange(false)
        } catch (err: any) {
            setErro(err.message || "Erro desconhecido")
        } finally {
            setLoading(false)
        }
    }

    const isEdit = !!selecao

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <CalendarDays className="h-5 w-5 text-cuca-blue" />
                        {isEdit ? "Editar Processo Seletivo" : "Novo Processo Seletivo"}
                        <Badge className="bg-cuca-blue/10 text-cuca-blue border-cuca-blue/30 text-xs ml-1">Evento</Badge>
                    </DialogTitle>
                </DialogHeader>

                {fetching ? (
                    <div className="flex items-center justify-center py-10 text-muted-foreground gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
                    </div>
                ) : (
                    <div className="space-y-5 pt-2">
                        {/* Empresa */}
                        <div className="space-y-1">
                            <Label>Empresa <span className="text-destructive">*</span></Label>
                            {isEdit ? (
                                <p className="text-sm font-medium text-muted-foreground px-3 py-2 border rounded-md bg-muted/30">
                                    {empresas.find(e => e.id === empresaId)?.nome_fantasia ||
                                        empresas.find(e => e.id === empresaId)?.nome ||
                                        empresaId}
                                </p>
                            ) : (
                                <Select value={empresaId} onValueChange={setEmpresaId}>
                                    <SelectTrigger><SelectValue placeholder="Selecione a empresa" /></SelectTrigger>
                                    <SelectContent>
                                        {empresas.map(e => (
                                            <SelectItem key={e.id} value={e.id}>
                                                {e.nome_fantasia || e.nome}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            )}
                        </div>

                        {/* Unidade e Status */}
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <Label>Unidade CUCA</Label>
                                <Select value={unidadeCuca} onValueChange={setUnidadeCuca}>
                                    <SelectTrigger><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="global">Toda a Rede CUCA</SelectItem>
                                        {unidades.map(u => (
                                            <SelectItem key={u.id} value={u.id}>{u.nome}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            {isEdit && (
                                <div className="space-y-1">
                                    <Label>Status</Label>
                                    <Select value={status} onValueChange={setStatus}>
                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="pre_cadastro">Rascunho</SelectItem>
                                            <SelectItem value="aberta">Aberta / Pública</SelectItem>
                                            <SelectItem value="preenchida">Preenchida</SelectItem>
                                            <SelectItem value="cancelada">Cancelada</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        </div>

                        {/* Cargos */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label className="flex items-center gap-1">
                                    <Briefcase className="h-3.5 w-3.5" /> Cargos <span className="text-destructive">*</span>
                                </Label>
                                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={addCargo}>
                                    <Plus className="h-3 w-3 mr-1" /> Adicionar cargo
                                </Button>
                            </div>
                            <div className="space-y-2">
                                {cargos.map((c, i) => (
                                    <div key={i} className="flex items-start gap-2 p-2 border rounded-md bg-muted/20">
                                        <div className="flex-1 grid grid-cols-3 gap-2">
                                            <div className="col-span-1">
                                                <Input
                                                    placeholder="Cargo (ex: Repositor)"
                                                    value={c.titulo}
                                                    onChange={e => updateCargo(i, "titulo", e.target.value)}
                                                    className="h-8 text-sm"
                                                />
                                            </div>
                                            <div>
                                                <Input
                                                    placeholder="Qtd"
                                                    type="number"
                                                    min="1"
                                                    value={c.quantidade}
                                                    onChange={e => updateCargo(i, "quantidade", e.target.value)}
                                                    className="h-8 text-sm"
                                                />
                                            </div>
                                            <div>
                                                <Select value={c.faixa_etaria} onValueChange={v => updateCargo(i, "faixa_etaria", v)}>
                                                    <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                                                    <SelectContent>
                                                        {FAIXAS_ETARIAS.map(f => (
                                                            <SelectItem key={f} value={f}>{f}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                        {cargos.length > 1 && (
                                            <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10" onClick={() => removeCargo(i)}>
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Datas */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <Label className="flex items-center gap-1">
                                    <CalendarDays className="h-3.5 w-3.5" /> Datas de Seleção <span className="text-destructive">*</span>
                                </Label>
                                <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={addData}>
                                    <Plus className="h-3 w-3 mr-1" /> Adicionar data
                                </Button>
                            </div>
                            <div className="space-y-2">
                                {datasSelecao.map((d, i) => (
                                    <div key={i} className="flex items-center gap-2">
                                        <Input
                                            type="date"
                                            value={d.data}
                                            onChange={e => updateData(i, "data", e.target.value)}
                                            className="h-8 text-sm flex-1"
                                        />
                                        <Input
                                            type="time"
                                            value={d.hora}
                                            onChange={e => updateData(i, "hora", e.target.value)}
                                            className="h-8 text-sm w-28"
                                        />
                                        {datasSelecao.length > 1 && (
                                            <Button type="button" variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:bg-destructive/10" onClick={() => removeData(i)}>
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {erro && <p className="text-sm text-destructive">{erro}</p>}

                        <div className="flex justify-end gap-2 pt-2 border-t">
                            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
                                Cancelar
                            </Button>
                            <Button className="bg-cuca-blue text-white hover:bg-sky-800" onClick={handleSave} disabled={loading}>
                                {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                                {isEdit ? "Salvar alterações" : "Criar processo seletivo"}
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
