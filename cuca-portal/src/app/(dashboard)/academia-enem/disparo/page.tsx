"use client"

import { useState, useEffect, useCallback } from "react"
import { useUser } from "@/lib/auth/user-provider"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
    Send, ShieldAlert, Megaphone, Users, AlertTriangle, RotateCcw, Clock,
    CheckCircle2, XCircle, PauseCircle,
} from "lucide-react"
import toast from "react-hot-toast"

type Template = {
    id: string
    nome: string
    categoria: string | null
    corpo_texto_aprovado: string | null
    variaveis: { posicao?: number; descricao?: string }[] | null
}

type DisparoHistorico = {
    id: string
    titulo: string
    template_nome: string
    status: string
    total_destinatarios: number
    total_enviados: number
    total_erros: number
    created_at: string
    concluido_em: string | null
}

type PublicoSessao = { origem: string; contatos: { nome: string; telefone: string }[] } | null

type EstadoTela = {
    phone_number_id: string | null
    templates: Template[]
    publico_default_count: number
    disparos: DisparoHistorico[]
    aviso: string | null
}

const STATUS_CFG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
    pendente: { label: "Pendente", color: "bg-slate-100 text-slate-700 border-slate-200", icon: Clock },
    em_andamento: { label: "Em andamento", color: "bg-blue-100 text-blue-700 border-blue-200", icon: RotateCcw },
    pausada_limite_diario: { label: "Pausado (teto diário)", color: "bg-amber-100 text-amber-700 border-amber-200", icon: PauseCircle },
    pausada: { label: "Pausado", color: "bg-amber-100 text-amber-700 border-amber-200", icon: PauseCircle },
    concluida: { label: "Concluído", color: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: CheckCircle2 },
}

function fmtData(iso: string | null): string {
    if (!iso) return "—"
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
}

export default function DisparoAcademiaEnemPage() {
    const { isDeveloper, hasPermission, loading: authLoading } = useUser()
    const canRead = isDeveloper || hasPermission("ae_disparo", "read")
    const canCreate = isDeveloper || hasPermission("ae_disparo", "create")

    const [estado, setEstado] = useState<EstadoTela | null>(null)
    const [loading, setLoading] = useState(true)
    const [publicoSessao, setPublicoSessao] = useState<PublicoSessao>(null)
    const [titulo, setTitulo] = useState("")
    const [templateNome, setTemplateNome] = useState("")
    const [enviando, setEnviando] = useState(false)

    const carregar = useCallback(async () => {
        const res = await fetch("/api/academia-enem/disparo")
        const json = await res.json()
        if (!res.ok) { toast.error(json.error || "Erro ao carregar"); return }
        setEstado(json as EstadoTela)
    }, [])

    useEffect(() => {
        if (authLoading || !canRead) return
        setLoading(true)
        carregar().finally(() => setLoading(false))

        // Hook de público (S-AE-08/S-AE-11): {origem, contatos:[{nome,telefone}]}, persistido
        // pela tela de origem antes de navegar pra cá.
        try {
            const raw = sessionStorage.getItem("ae_disparo_publico")
            if (raw) setPublicoSessao(JSON.parse(raw) as PublicoSessao)
        } catch {
            // sessionStorage indisponível/corrompido — segue com o público default, sem travar a tela
        }
    }, [authLoading, canRead, carregar])

    const limparPublicoSessao = () => {
        sessionStorage.removeItem("ae_disparo_publico")
        setPublicoSessao(null)
    }

    const disparar = async () => {
        if (!templateNome) { toast.error("Selecione um template"); return }
        if (!titulo.trim()) { toast.error("Informe um título pra identificar o disparo"); return }
        setEnviando(true)
        try {
            const res = await fetch("/api/academia-enem/disparo", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    titulo: titulo.trim(),
                    template_nome: templateNome,
                    publico: publicoSessao ?? undefined,
                }),
            })
            const json = await res.json()
            if (!res.ok) { toast.error(json.error || "Erro ao criar disparo"); return }
            toast.success(`Disparo criado: ${json.disparo.total_destinatarios} contato(s) na fila.`)
            setTitulo("")
            setTemplateNome("")
            limparPublicoSessao()
            await carregar()
        } finally {
            setEnviando(false)
        }
    }

    if (authLoading || loading) {
        return (
            <div className="space-y-4 animate-pulse">
                <div className="h-9 w-80 bg-muted rounded" />
                <div className="h-56 bg-muted rounded" />
                <div className="h-72 bg-muted rounded" />
            </div>
        )
    }

    if (!canRead) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-12 gap-4 text-center">
                <ShieldAlert className="h-16 w-16 text-slate-300" />
                <h2 className="text-xl font-bold text-slate-700">Acesso Restrito</h2>
                <p className="text-slate-500 max-w-sm">Você não tem permissão para acessar o disparo de avisos da Academia Enem.</p>
            </div>
        )
    }

    const publicoCount = publicoSessao?.contatos?.length ?? estado?.publico_default_count ?? 0
    const semTemplates = (estado?.templates.length ?? 0) === 0

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20">
                    <Megaphone className="h-6 w-6 text-primary" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Disparo de Avisos</h1>
                    <p className="text-muted-foreground text-sm">Fila própria da Academia Enem — não passa pela fila do Institucional/Divulgação.</p>
                </div>
            </div>

            {/* AC#1: aviso claro quando não há template aprovado nem número configurado */}
            {estado?.aviso && (
                <Card className="border-amber-200 bg-amber-50">
                    <CardContent className="p-4 flex items-start gap-3">
                        <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
                        <p className="text-sm text-amber-800">{estado.aviso}</p>
                    </CardContent>
                </Card>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>Novo disparo</CardTitle>
                    <CardDescription>Só templates já aprovados na Meta para o número da Academia Enem aparecem aqui.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid gap-1.5">
                        <Label>Título (identificação interna)</Label>
                        <Input
                            value={titulo}
                            onChange={e => setTitulo(e.target.value)}
                            placeholder="Ex: Aviso de início das aulas — turma agosto"
                            disabled={!canCreate}
                        />
                    </div>

                    <div className="grid gap-1.5">
                        <Label>Template aprovado</Label>
                        <Select value={templateNome} onValueChange={setTemplateNome} disabled={!canCreate || semTemplates}>
                            <SelectTrigger className="w-full max-w-md">
                                <SelectValue placeholder={semTemplates ? "Nenhum template disponível" : "Selecione o template"} />
                            </SelectTrigger>
                            <SelectContent>
                                {estado?.templates.map(t => (
                                    <SelectItem key={t.id} value={t.nome}>{t.nome}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        {templateNome && (
                            <p className="text-xs text-muted-foreground max-w-md">
                                {estado?.templates.find(t => t.nome === templateNome)?.corpo_texto_aprovado}
                            </p>
                        )}
                    </div>

                    <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                        <Users className="h-5 w-5 text-muted-foreground shrink-0" />
                        <div className="flex-1 text-sm">
                            {publicoSessao ? (
                                <>
                                    <span className="font-medium">{publicoCount} contato(s)</span> selecionado(s) manualmente
                                    (origem: <span className="font-mono text-xs">{publicoSessao.origem}</span>)
                                </>
                            ) : (
                                <>
                                    Público padrão: <span className="font-medium">{publicoCount} contato(s)</span> com a tag &ldquo;Academia Enem&rdquo; (matriculados, opt-in, não bloqueados)
                                </>
                            )}
                        </div>
                        {publicoSessao && (
                            <Button variant="outline" size="sm" onClick={limparPublicoSessao}>
                                Usar público padrão
                            </Button>
                        )}
                    </div>

                    <Button onClick={disparar} disabled={!canCreate || enviando || semTemplates || publicoCount === 0}>
                        <Send className="mr-2 h-4 w-4" />
                        {enviando ? "Criando disparo..." : "Disparar"}
                    </Button>
                    {!canCreate && (
                        <p className="text-xs text-muted-foreground">Você tem acesso de leitura — criar disparos exige a permissão de criação neste recurso.</p>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Histórico</CardTitle>
                    <CardDescription>Últimos disparos da fila própria da Academia Enem.</CardDescription>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Título</TableHead>
                                <TableHead>Template</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Destinatários</TableHead>
                                <TableHead className="text-right">Enviados</TableHead>
                                <TableHead className="text-right">Erros</TableHead>
                                <TableHead>Criado em</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {(estado?.disparos ?? []).length === 0 && (
                                <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">Nenhum disparo ainda.</TableCell></TableRow>
                            )}
                            {estado?.disparos.map(d => {
                                const cfg = STATUS_CFG[d.status] ?? { label: d.status, color: "bg-slate-100 text-slate-700 border-slate-200", icon: XCircle }
                                const Icon = cfg.icon
                                return (
                                    <TableRow key={d.id}>
                                        <TableCell className="font-medium">{d.titulo}</TableCell>
                                        <TableCell className="font-mono text-xs">{d.template_nome}</TableCell>
                                        <TableCell>
                                            <Badge className={`flex items-center gap-1.5 w-fit text-xs font-medium border ${cfg.color}`}>
                                                <Icon className="h-3 w-3" /> {cfg.label}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">{d.total_destinatarios}</TableCell>
                                        <TableCell className="text-right">{d.total_enviados}</TableCell>
                                        <TableCell className="text-right">{d.total_erros}</TableCell>
                                        <TableCell className="text-xs text-muted-foreground">{fmtData(d.created_at)}</TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}
