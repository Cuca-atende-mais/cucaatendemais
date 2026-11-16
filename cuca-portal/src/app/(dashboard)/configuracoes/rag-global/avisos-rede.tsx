"use client"

// S-INST-QUAL-08: avisos da rede com data de validade (simulado, recesso, inscrições abertas). Vão
// inteiros ao assistente enquanto valem; depois do fim saem sozinhos.
import { useEffect, useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Megaphone, Pencil, Plus, Clock } from "lucide-react"
import toast from "react-hot-toast"
import {
    estadoAviso, formatarData, lerDadosAviso, LIMITE_TEXTO_AVISO, LIMITE_TITULO_AVISO,
    LIMITE_TOTAL_AVISOS, ROTULO_ESTADO_AVISO, voltaAValerAoSalvar, type Aviso, type EstadoAviso,
} from "@/lib/rag-global/avisos"

const FORM_VAZIO = { titulo: "", conteudo: "", valido_de: "", valido_ate: "" }

const COR_ESTADO: Record<EstadoAviso, string> = {
    valido: "bg-green-600 text-white",
    programado: "bg-blue-600 text-white",
    vencido: "",
    desativado: "",
}

export function AvisosRede() {
    const [avisos, setAvisos] = useState<Aviso[]>([])
    const [hoje, setHoje] = useState("")
    const [opcoes, setOpcoes] = useState({ criar: false, editar: false, desativar: false })
    const [carregando, setCarregando] = useState(true)
    const [aberto, setAberto] = useState(false)
    const [editando, setEditando] = useState<Aviso | null>(null)
    const [form, setForm] = useState(FORM_VAZIO)
    const [salvando, setSalvando] = useState(false)

    useEffect(() => { carregar() }, [])

    const carregar = async () => {
        setCarregando(true)
        try {
            const res = await fetch("/api/rag-global/avisos", { cache: "no-store" })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error)
            setAvisos(data.avisos ?? [])
            setHoje(data.hoje)
            setOpcoes(data.opcoes)
        } catch {
            toast.error("Erro ao carregar os avisos")
        } finally {
            setCarregando(false)
        }
    }

    const chamar = async (url: string, init: RequestInit) => {
        const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || "Erro na operação")
        return data
    }

    const abrirNovo = () => { setEditando(null); setForm(FORM_VAZIO); setAberto(true) }
    const abrirEdicao = (a: Aviso) => {
        setEditando(a)
        setForm({
            titulo: a.titulo,
            conteudo: a.conteudo,
            valido_de: String(a.metadados?.valido_de ?? ""),
            valido_ate: String(a.metadados?.valido_ate ?? ""),
        })
        setAberto(true)
    }
    const fechar = () => { setAberto(false); setEditando(null); setForm(FORM_VAZIO) }

    const salvar = async (e: React.FormEvent) => {
        e.preventDefault()
        // Mesma regra do servidor (o servidor confere de novo, inclusive o total do período).
        const categoria = editando ? (editando.metadados?.categoria as string | undefined) : undefined
        const lido = lerDadosAviso({ ...form, categoria }, hoje)
        if ("erro" in lido) { toast.error(lido.erro); return }
        setSalvando(true)
        try {
            const corpo = JSON.stringify({ ...lido.dados })
            if (editando) {
                await chamar(`/api/rag-global/avisos/${editando.id}`, { method: "PATCH", body: corpo })
                toast.success("Aviso atualizado")
            } else {
                await chamar("/api/rag-global/avisos", { method: "POST", body: corpo })
                toast.success("Aviso criado")
            }
            fechar()
            carregar()
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : "Erro ao salvar o aviso")
        } finally {
            setSalvando(false)
        }
    }

    const desativar = async (a: Aviso) => {
        if (!confirm("Tirar este aviso do assistente agora? Para voltar, edite o aviso e salve com a data de fim.")) return
        try {
            await chamar(`/api/rag-global/avisos/${a.id}/desativar`, { method: "PATCH" })
            toast.success("Aviso desativado")
            carregar()
        } catch (err: unknown) {
            toast.error(err instanceof Error ? err.message : "Erro ao desativar o aviso")
        }
    }

    const f = (k: keyof typeof FORM_VAZIO, v: string) => setForm(prev => ({ ...prev, [k]: v }))

    return (
        <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                    <CardTitle className="flex items-center gap-2"><Megaphone className="h-5 w-5 text-amber-600" /> Avisos da Rede</CardTitle>
                    <CardDescription>
                        Recados temporários para todas as unidades (simulado, recesso, inscrições abertas). O assistente usa o
                        aviso inteiro do início ao fim da validade e para de usar sozinho depois do fim. Até {LIMITE_TEXTO_AVISO} caracteres
                        por aviso e {LIMITE_TOTAL_AVISOS} no total dos avisos que valem ao mesmo tempo.
                    </CardDescription>
                </div>
                {opcoes.criar && (
                    <Button className="bg-amber-600 hover:bg-amber-700 shrink-0" onClick={abrirNovo}>
                        <Plus className="mr-2 h-4 w-4" /> Novo aviso
                    </Button>
                )}
            </CardHeader>
            <CardContent>
                {carregando ? (
                    <div className="text-center py-6 text-muted-foreground">Carregando...</div>
                ) : avisos.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground text-sm">Nenhum aviso cadastrado</div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Título</TableHead>
                                <TableHead>Aviso</TableHead>
                                <TableHead>Início</TableHead>
                                <TableHead>Fim</TableHead>
                                <TableHead>Estado</TableHead>
                                <TableHead className="text-right">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {avisos.map(a => {
                                const estado = estadoAviso(a, hoje)
                                const de = a.metadados?.valido_de as string | undefined
                                const ate = a.metadados?.valido_ate as string | undefined
                                return (
                                    <TableRow key={a.id} className={estado === "vencido" || estado === "desativado" ? "opacity-50" : ""}>
                                        <TableCell className="font-medium max-w-[12rem] truncate">{a.titulo}</TableCell>
                                        <TableCell className="max-w-md truncate text-sm text-muted-foreground" title={a.conteudo}>{a.conteudo}</TableCell>
                                        <TableCell className="text-sm whitespace-nowrap">{de ? formatarData(de) : "-"}</TableCell>
                                        <TableCell className="text-sm whitespace-nowrap">{ate ? formatarData(ate) : "-"}</TableCell>
                                        <TableCell>
                                            <Badge variant={estado === "valido" || estado === "programado" ? "default" : "secondary"} className={COR_ESTADO[estado]}>
                                                {ROTULO_ESTADO_AVISO[estado]}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                {opcoes.desativar && a.ativo && estado !== "vencido" && (
                                                    <Button variant="ghost" size="sm" onClick={() => desativar(a)}>
                                                        <span className="text-xs">Desativar</span>
                                                    </Button>
                                                )}
                                                {opcoes.editar && (
                                                    <Button variant="ghost" size="sm" onClick={() => abrirEdicao(a)}>
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                )}
            </CardContent>

            <Dialog open={aberto} onOpenChange={open => { if (!open) fechar() }}>
                <DialogContent className="max-w-xl">
                    <form onSubmit={salvar}>
                        <DialogHeader>
                            <DialogTitle>{editando ? "Editar aviso" : "Novo aviso da rede"}</DialogTitle>
                            <DialogDescription>
                                Vale para todas as unidades, entre o início e o fim (inclusive).
                                {editando && voltaAValerAoSalvar(editando, hoje) && " Este aviso está fora do assistente: ao salvar, ele volta a valer no período informado (o fim precisa ser de hoje em diante)."}
                            </DialogDescription>
                        </DialogHeader>
                        <div className="grid gap-4 py-4">
                            <div className="grid gap-1">
                                <Label htmlFor="aviso-titulo">Título *</Label>
                                <Input id="aviso-titulo" value={form.titulo} maxLength={LIMITE_TITULO_AVISO}
                                    onChange={e => f("titulo", e.target.value)} placeholder="Ex: Recesso de fim de ano" required />
                            </div>
                            <div className="grid gap-1">
                                <Label htmlFor="aviso-texto">Texto do aviso *</Label>
                                <Textarea id="aviso-texto" rows={5} value={form.conteudo}
                                    onChange={e => f("conteudo", e.target.value)}
                                    placeholder="Ex: As cinco unidades ficam fechadas de 24/12 a 02/01. As atividades voltam em 06/01." required />
                                <p className={`text-xs ${form.conteudo.trim().length > LIMITE_TEXTO_AVISO ? "text-red-600" : "text-muted-foreground"}`}>
                                    {form.conteudo.trim().length} de {LIMITE_TEXTO_AVISO} caracteres
                                </p>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div className="grid gap-1">
                                    <Label htmlFor="aviso-de">Início</Label>
                                    <Input id="aviso-de" type="date" value={form.valido_de} onChange={e => f("valido_de", e.target.value)} />
                                    <p className="text-xs text-muted-foreground">Vazio: a partir de hoje</p>
                                </div>
                                <div className="grid gap-1">
                                    <Label htmlFor="aviso-ate">Fim *</Label>
                                    <Input id="aviso-ate" type="date" value={form.valido_ate} onChange={e => f("valido_ate", e.target.value)} required />
                                    <p className="text-xs text-muted-foreground">Último dia em que o aviso vale</p>
                                </div>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={fechar}>Cancelar</Button>
                            <Button type="submit" className="bg-amber-600 hover:bg-amber-700" disabled={salvando}>
                                {salvando ? <><Clock className="mr-2 h-4 w-4 animate-spin" />Salvando...</> : editando ? "Atualizar" : "Criar"}
                            </Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>
        </Card>
    )
}
