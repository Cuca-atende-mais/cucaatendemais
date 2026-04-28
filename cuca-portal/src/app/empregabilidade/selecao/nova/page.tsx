"use client"

// SQS-49: Formulário de Processo Seletivo por Evento (selecao_evento)
// Rota exclusiva — não afeta /empregabilidade/vagas/nova nem qualquer lógica existente

import { useState, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Building2, Calendar, CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react"
import toast from "react-hot-toast"

const FAIXAS_ETARIAS = [
    "A partir de 14 anos",
    "Maior de 18 anos",
]

interface DataHora { data: string; hora: string }
interface CargoLinha { titulo: string; quantidade: string; faixa_etaria: string }

function cargoVazio(): CargoLinha {
    return { titulo: "", quantidade: "1", faixa_etaria: "A partir de 14 anos" }
}

function SelecaoNovaContent() {
    const searchParams = useSearchParams()
    const empresaId = searchParams.get("empresa_id") || ""
    const unidadeCucaParam = searchParams.get("unidade_cuca") || ""
    const emailParam = searchParams.get("email_responsavel") || ""
    const telParam = searchParams.get("telefone_responsavel") || ""

    const [empresa, setEmpresa] = useState<any>(null)
    const [loadingEmpresa, setLoadingEmpresa] = useState(true)
    const [success, setSuccess] = useState(false)
    const [loading, setLoading] = useState(false)
    const [erro, setErro] = useState("")

    const [cargos, setCargos] = useState<CargoLinha[]>([cargoVazio()])
    const [datasSelecao, setDatasSelecao] = useState<DataHora[]>([{ data: "", hora: "08:00" }])
    const [unidades, setUnidades] = useState<any[]>([])
    const [unidadeSelecionada, setUnidadeSelecionada] = useState(unidadeCucaParam)

    useEffect(() => {
        if (!empresaId) { setLoadingEmpresa(false); return }
        fetch(`/api/empregabilidade/empresa/${empresaId}`)
            .then(r => r.ok ? r.json() : null)
            .then(d => { if (d) setEmpresa(d) })
            .finally(() => setLoadingEmpresa(false))

        fetch("/api/empregabilidade/unidades")
            .then(r => r.json())
            .then(d => setUnidades(Array.isArray(d) ? d : (d.unidades || [])))
    }, [empresaId])

    // ── Cargos ─────────────────────────────────────────────────────────────────
    function addCargo() { setCargos(prev => [...prev, cargoVazio()]) }
    function removeCargo(i: number) { setCargos(prev => prev.filter((_, idx) => idx !== i)) }
    function updateCargo(i: number, field: keyof CargoLinha, val: string) {
        setCargos(prev => prev.map((c, idx) => idx === i ? { ...c, [field]: val } : c))
    }

    // ── Datas ──────────────────────────────────────────────────────────────────
    function addData() { setDatasSelecao(prev => [...prev, { data: "", hora: "08:00" }]) }
    function removeData(i: number) { setDatasSelecao(prev => prev.filter((_, idx) => idx !== i)) }
    function updateData(i: number, field: keyof DataHora, val: string) {
        setDatasSelecao(prev => prev.map((d, idx) => idx === i ? { ...d, [field]: val } : d))
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setErro("")

        const cargosValidos = cargos.filter(c => c.titulo.trim())
        if (cargosValidos.length === 0) { setErro("Informe ao menos um cargo."); return }
        const datasValidas = datasSelecao.filter(d => d.data)
        if (datasValidas.length === 0) { setErro("Informe ao menos uma data de seleção."); return }
        if (!empresaId) { setErro("empresa_id ausente na URL."); return }

        setLoading(true)
        try {
            const res = await fetch("/api/empregabilidade/selecao", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    empresa_id: empresaId,
                    unidade_cuca: unidadeSelecionada === "todas" ? null : (unidadeSelecionada || null),
                    unidade_destino: "global",
                    cargos_lista: cargosValidos.map(c => ({
                        titulo: c.titulo.trim(),
                        quantidade: parseInt(c.quantidade) || 1,
                        faixa_etaria: c.faixa_etaria,
                    })),
                    datas_selecao: datasValidas,
                    email_responsavel: emailParam,
                    telefone_responsavel: telParam,
                }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || `Erro ${res.status}`)
            setSuccess(true)
        } catch (err: any) {
            setErro(err.message)
            toast.error(err.message)
        } finally {
            setLoading(false)
        }
    }

    if (loadingEmpresa) {
        return (
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin text-cuca-blue" />
            </div>
        )
    }

    if (success) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
                <Card className="max-w-md w-full text-center">
                    <CardContent className="pt-8 pb-8 space-y-4">
                        <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
                        <h2 className="text-xl font-bold">Processo Seletivo Cadastrado!</h2>
                        <p className="text-muted-foreground text-sm">
                            As vagas já estão visíveis para todas as unidades da rede CUCA. A equipe irá gerenciar as candidaturas pelo portal.
                        </p>
                        <p className="text-sm font-medium">
                            Você receberá a confirmação pelo WhatsApp em breve.
                        </p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-muted/30 p-4">
            <div className="max-w-2xl mx-auto space-y-6">

                {/* Cabeçalho */}
                <div className="text-center pt-4">
                    <div className="inline-flex items-center gap-2 bg-cuca-blue/10 text-cuca-blue rounded-full px-4 py-2 text-sm font-medium mb-3">
                        <Calendar className="h-4 w-4" />
                        Marcar Processo Seletivo
                    </div>
                    {empresa && (
                        <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
                            <Building2 className="h-4 w-4" />
                            <span>{empresa.nome_fantasia || empresa.nome}</span>
                        </div>
                    )}
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">

                    {/* Unidade CUCA */}
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Unidade CUCA da Seleção</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <Select value={unidadeSelecionada} onValueChange={setUnidadeSelecionada}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione a unidade onde ocorrerá a seleção" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="todas">Todas as unidades</SelectItem>
                                    {unidades.map((u: any) => (
                                        <SelectItem key={u.id} value={u.nome}>{u.nome}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground mt-2">
                                As vagas ficam visíveis para toda a rede CUCA. Selecione "Todas as unidades" se a seleção puder ocorrer em qualquer unidade.
                            </p>
                        </CardContent>
                    </Card>

                    {/* Datas e horários */}
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Datas e Horários da Seleção</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {datasSelecao.map((d, i) => (
                                <div key={i} className="flex gap-2 items-end">
                                    <div className="flex-1">
                                        <Label className="text-xs">Data</Label>
                                        <Input
                                            type="date"
                                            value={d.data}
                                            onChange={e => {
                                                updateData(i, "data", e.target.value)
                                                // auto-adiciona linha se for a última e data preenchida
                                                if (e.target.value && i === datasSelecao.length - 1) {
                                                    setDatasSelecao(prev => [...prev, { data: "", hora: "08:00" }])
                                                }
                                            }}
                                            required
                                        />
                                    </div>
                                    <div className="w-28">
                                        <Label className="text-xs">Horário</Label>
                                        <Input
                                            type="time"
                                            value={d.hora}
                                            onChange={e => updateData(i, "hora", e.target.value)}
                                        />
                                    </div>
                                    {datasSelecao.length > 1 && (
                                        <Button type="button" variant="ghost" size="icon" onClick={() => removeData(i)}>
                                            <Trash2 className="h-4 w-4 text-destructive" />
                                        </Button>
                                    )}
                                </div>
                            ))}
                            <p className="text-xs text-muted-foreground">
                                Uma nova linha é adicionada automaticamente ao preencher cada data.
                            </p>
                        </CardContent>
                    </Card>

                    {/* Cargos */}
                    <Card>
                        <CardHeader className="pb-3">
                            <CardTitle className="text-base">Vagas Disponíveis</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            {cargos.map((c, i) => (
                                <div key={i} className="border rounded-lg p-3 space-y-3 bg-background">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                            Cargo {i + 1}
                                        </span>
                                        {cargos.length > 1 && (
                                            <Button type="button" variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeCargo(i)}>
                                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                                            </Button>
                                        )}
                                    </div>
                                    <div>
                                        <Label className="text-xs">Título do Cargo *</Label>
                                        <Input
                                            placeholder="Ex: Operador de Caixa"
                                            value={c.titulo}
                                            onChange={e => updateCargo(i, "titulo", e.target.value)}
                                            required
                                            className="mt-1"
                                        />
                                    </div>
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <Label className="text-xs">Quantidade de Vagas *</Label>
                                            <Input
                                                type="number"
                                                min="1"
                                                max="999"
                                                value={c.quantidade}
                                                onChange={e => updateCargo(i, "quantidade", e.target.value)}
                                                required
                                                className="mt-1"
                                            />
                                        </div>
                                        <div>
                                            <Label className="text-xs">Idade Mínima *</Label>
                                            <Select
                                                value={c.faixa_etaria}
                                                onValueChange={val => updateCargo(i, "faixa_etaria", val)}
                                            >
                                                <SelectTrigger className="mt-1">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {FAIXAS_ETARIAS.map(f => (
                                                        <SelectItem key={f} value={f}>{f}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    </div>
                                </div>
                            ))}
                            <Button type="button" variant="outline" size="sm" className="w-full mt-1" onClick={addCargo}>
                                <Plus className="h-4 w-4 mr-1" /> Adicionar cargo
                            </Button>
                        </CardContent>
                    </Card>

                    {erro && (
                        <p className="text-sm text-destructive bg-destructive/10 rounded p-3">{erro}</p>
                    )}

                    <Button type="submit" className="w-full" size="lg" disabled={loading}>
                        {loading
                            ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Cadastrando...</>
                            : "Cadastrar Processo Seletivo"
                        }
                    </Button>
                </form>
            </div>
        </div>
    )
}

export default function SelecaoNovaPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center">
                <Loader2 className="h-10 w-10 animate-spin" />
            </div>
        }>
            <SelecaoNovaContent />
        </Suspense>
    )
}
