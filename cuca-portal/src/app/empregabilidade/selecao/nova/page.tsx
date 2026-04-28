"use client"

// SQS-49: Formulário simplificado para Processo Seletivo por Evento (selecao_evento)
// Rota exclusiva — não afeta /empregabilidade/vagas/nova nem qualquer lógica existente

import { useState, useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Building2, Calendar, CheckCircle2, Loader2, Plus, Trash2 } from "lucide-react"
import toast from "react-hot-toast"

const FAIXAS_ETARIAS = [
    "15 a 29 anos",
    "15 a 17 anos (Jovem Aprendiz)",
    "18 a 29 anos",
    "Maior de 18 anos",
    "Sem restrição de idade",
]

interface DataHora { data: string; hora: string }
interface CargoLinha { titulo: string; quantidade: string }

function parseCargosTxt(texto: string): CargoLinha[] {
    if (!texto.trim()) return []
    // Suporta "Operador de Caixa (3), Repositor (2)" ou uma linha por cargo
    const linhas = texto.split(/[,\n]/).map(l => l.trim()).filter(Boolean)
    return linhas.map(l => {
        const match = l.match(/^(.+?)\s*\((\d+)\)\s*$/)
        if (match) return { titulo: match[1].trim(), quantidade: match[2] }
        return { titulo: l, quantidade: "1" }
    })
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

    const [cargosTexto, setCargosTexto] = useState("")
    const [cargosLista, setCargosLista] = useState<CargoLinha[]>([])
    const [datasSelecao, setDatasSelecao] = useState<DataHora[]>([{ data: "", hora: "08:00" }])
    const [faixaEtaria, setFaixaEtaria] = useState("15 a 29 anos")
    const [unidades, setUnidades] = useState<any[]>([])
    const [unidadeSelecionada, setUnidadeSelecionada] = useState(unidadeCucaParam)

    useEffect(() => {
        async function load() {
            if (!empresaId) { setLoadingEmpresa(false); return }
            const res = await fetch(`/api/empregabilidade/empresa/${empresaId}`)
            if (res.ok) { const d = await res.json(); setEmpresa(d) }
            setLoadingEmpresa(false)
        }
        load()
        fetch("/api/empregabilidade/unidades")
            .then(r => r.json())
            .then(d => setUnidades(Array.isArray(d) ? d : (d.unidades || [])))
    }, [empresaId])

    function parsear() {
        const lista = parseCargosTxt(cargosTexto)
        setCargosLista(lista)
    }

    function addData() {
        setDatasSelecao(prev => [...prev, { data: "", hora: "08:00" }])
    }
    function removeData(i: number) {
        setDatasSelecao(prev => prev.filter((_, idx) => idx !== i))
    }
    function updateData(i: number, field: keyof DataHora, val: string) {
        setDatasSelecao(prev => prev.map((d, idx) => idx === i ? { ...d, [field]: val } : d))
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        setErro("")

        const lista = cargosLista.length > 0 ? cargosLista : parseCargosTxt(cargosTexto)
        if (lista.length === 0) { setErro("Informe ao menos um cargo."); return }
        const datas = datasSelecao.filter(d => d.data)
        if (datas.length === 0) { setErro("Informe ao menos uma data de seleção."); return }
        if (!empresaId) { setErro("empresa_id ausente na URL."); return }

        setLoading(true)
        try {
            const res = await fetch("/api/empregabilidade/selecao", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    empresa_id: empresaId,
                    unidade_cuca: unidadeSelecionada || null,
                    cargos_texto: cargosTexto,
                    cargos_lista: lista.map(c => ({ titulo: c.titulo, quantidade: parseInt(c.quantidade) || 1 })),
                    datas_selecao: datas,
                    faixa_etaria: faixaEtaria,
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
                        <CardHeader className="pb-3"><CardTitle className="text-base">Unidade CUCA da Seleção</CardTitle></CardHeader>
                        <CardContent>
                            <Select value={unidadeSelecionada} onValueChange={setUnidadeSelecionada}>
                                <SelectTrigger>
                                    <SelectValue placeholder="Selecione a unidade onde ocorrerá a seleção" />
                                </SelectTrigger>
                                <SelectContent>
                                    {unidades.map((u: any) => (
                                        <SelectItem key={u.id} value={u.nome}>{u.nome}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground mt-2">
                                As vagas ficam visíveis para toda a rede CUCA, mas a seleção ocorre nesta unidade.
                            </p>
                        </CardContent>
                    </Card>

                    {/* Datas e horários */}
                    <Card>
                        <CardHeader className="pb-3">
                            <div className="flex items-center justify-between">
                                <CardTitle className="text-base">Datas e Horários da Seleção</CardTitle>
                                <Button type="button" variant="outline" size="sm" onClick={addData}>
                                    <Plus className="h-4 w-4 mr-1" /> Adicionar data
                                </Button>
                            </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                            {datasSelecao.map((d, i) => (
                                <div key={i} className="flex gap-2 items-end">
                                    <div className="flex-1">
                                        <Label className="text-xs">Data</Label>
                                        <Input
                                            type="date"
                                            value={d.data}
                                            onChange={e => updateData(i, "data", e.target.value)}
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
                        </CardContent>
                    </Card>

                    {/* Cargos */}
                    <Card>
                        <CardHeader className="pb-3"><CardTitle className="text-base">Cargos Disponíveis</CardTitle></CardHeader>
                        <CardContent className="space-y-3">
                            <div>
                                <Label className="text-sm">
                                    Liste os cargos e quantidades (ex: Operador de Caixa (3), Repositor (2))
                                </Label>
                                <Textarea
                                    placeholder={"Operador de Caixa (3)\nRepositor (2)\nJovem Aprendiz (5)\nAçougueiro (1)"}
                                    value={cargosTexto}
                                    onChange={e => { setCargosTexto(e.target.value); setCargosLista([]) }}
                                    rows={5}
                                    className="mt-1 font-mono text-sm"
                                />
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="mt-2"
                                    onClick={parsear}
                                >
                                    Verificar lista de cargos
                                </Button>
                            </div>
                            {cargosLista.length > 0 && (
                                <div className="bg-muted rounded-md p-3 space-y-1">
                                    <p className="text-xs font-medium text-muted-foreground mb-2">
                                        {cargosLista.length} cargo(s) identificado(s):
                                    </p>
                                    {cargosLista.map((c, i) => (
                                        <div key={i} className="flex items-center gap-2 text-sm">
                                            <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                                            <span className="font-medium">{c.titulo}</span>
                                            <span className="text-muted-foreground">— {c.quantidade} vaga(s)</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Faixa etária */}
                    <Card>
                        <CardHeader className="pb-3"><CardTitle className="text-base">Faixa Etária</CardTitle></CardHeader>
                        <CardContent>
                            <Select value={faixaEtaria} onValueChange={setFaixaEtaria}>
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    {FAIXAS_ETARIAS.map(f => (
                                        <SelectItem key={f} value={f}>{f}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </CardContent>
                    </Card>

                    {erro && (
                        <p className="text-sm text-destructive bg-destructive/10 rounded p-3">{erro}</p>
                    )}

                    <Button type="submit" className="w-full" size="lg" disabled={loading}>
                        {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Cadastrando...</> : "Cadastrar Processo Seletivo"}
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
