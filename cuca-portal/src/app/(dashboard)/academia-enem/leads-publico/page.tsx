"use client"

import { useState, useEffect, useCallback, useRef, useMemo } from "react"
import * as XLSX from "xlsx"
import { useUser } from "@/lib/auth/user-provider"
import { unidadesCuca } from "@/lib/constants"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
    Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import {
    GraduationCap, ShieldAlert, Download, Send, UserPlus, Search, Check, X,
    Pencil, Lock, Unlock, Upload, FileSpreadsheet, ListChecks, Clock,
    CheckCircle2, AlertTriangle,
} from "lucide-react"
import toast from "react-hot-toast"

type LeadRecorte = {
    id: string; nome: string | null; telefone: string; unidade_cuca: string | null
    opt_in: boolean; bloqueado: boolean; motivo_bloqueio: string | null
}
type LeadBusca = { id: string; nome: string | null; telefone: string; unidade_cuca: string | null; matriculado: boolean }
type ResultadoUpload = { total: number; novos: number; ignorados: number; erros: { linha: number; motivo: string }[] }

const TODAS = "__todas__"

function normalizarTelefone(tel: string): string {
    const d = String(tel ?? "").replace(/\D/g, "")
    return (d.length === 10 || d.length === 11) && !d.startsWith("55") ? "55" + d : d
}

function exportarCSV(filename: string, headers: string[], rows: (string | number)[][]) {
    const esc = (v: string | number) => {
        const s = String(v ?? "")
        return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [headers, ...rows].map(r => r.map(esc).join(";")).join("\n")
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url; a.download = filename; a.click()
    URL.revokeObjectURL(url)
}

export default function LeadsPublicoPage() {
    const { isDeveloper, hasPermission, loading: authLoading } = useUser()
    const canRead = isDeveloper || hasPermission("ae_leads_filtro", "read")
    const canUpdate = isDeveloper || hasPermission("ae_leads_filtro", "update")
    const canUpload = isDeveloper || hasPermission("ae_leads_upload", "create")

    const [unidade, setUnidade] = useState(TODAS)
    const [optIn, setOptIn] = useState(true)
    const [recorte, setRecorte] = useState<LeadRecorte[]>([])
    const [loading, setLoading] = useState(true)
    const [selecionados, setSelecionados] = useState<Set<string>>(new Set())

    const [dialogOpen, setDialogOpen] = useState(false)
    const [busca, setBusca] = useState("")
    const [resultados, setResultados] = useState<LeadBusca[]>([])
    const [buscando, setBuscando] = useState(false)

    // Editar
    const [editando, setEditando] = useState<LeadRecorte | null>(null)
    const [editNome, setEditNome] = useState("")
    const [editTelefone, setEditTelefone] = useState("")
    const [salvandoEdicao, setSalvandoEdicao] = useState(false)

    // Bloquear (individual ou em massa)
    const [bloqueioAlvo, setBloqueioAlvo] = useState<{ ids: string[]; label: string } | null>(null)
    const [motivoBloqueio, setMotivoBloqueio] = useState("")
    const [bloqueando, setBloqueando] = useState(false)

    // Upload de planilha
    const [fileName, setFileName] = useState<string | null>(null)
    const [headersUpload, setHeadersUpload] = useState<string[]>([])
    const [rowsUpload, setRowsUpload] = useState<string[][]>([])
    const [mapUpload, setMapUpload] = useState<{ nome: number; telefone: number }>({ nome: -1, telefone: -1 })
    const [enviandoUpload, setEnviandoUpload] = useState(false)
    const [resultadoUpload, setResultadoUpload] = useState<ResultadoUpload | null>(null)
    const fileRef = useRef<HTMLInputElement>(null)

    const carregarRecorte = useCallback(async () => {
        const params = new URLSearchParams({ mode: "recorte", optIn: String(optIn) })
        if (unidade !== TODAS) params.set("unidade", unidade)
        const res = await fetch(`/api/academia-enem/leads?${params}`)
        const json = await res.json()
        if (!res.ok) { toast.error(json.error || "Erro ao carregar"); return [] }
        return (json.leads ?? []) as LeadRecorte[]
    }, [unidade, optIn])

    useEffect(() => {
        if (authLoading || !canRead) return
        let cancel = false
        setLoading(true)
        carregarRecorte().then(rows => { if (!cancel) { setRecorte(rows); setLoading(false); setSelecionados(new Set()) } })
        return () => { cancel = true }
    }, [authLoading, canRead, carregarRecorte])

    const buscarLeads = async (q: string) => {
        setBusca(q)
        if (q.trim().length < 2) { setResultados([]); return }
        setBuscando(true)
        try {
            const res = await fetch(`/api/academia-enem/leads?mode=buscar&q=${encodeURIComponent(q)}`)
            const json = await res.json()
            setResultados((json.leads ?? []) as LeadBusca[])
        } finally { setBuscando(false) }
    }

    const toggleMatricula = async (lead: LeadBusca) => {
        const novo = !lead.matriculado
        const res = await fetch("/api/academia-enem/leads", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ lead_id: lead.id, matriculado: novo }),
        })
        if (!res.ok) { const j = await res.json(); toast.error(j.error || "Erro"); return }
        setResultados(prev => prev.map(l => l.id === lead.id ? { ...l, matriculado: novo } : l))
        toast.success(novo ? "Matrícula adicionada" : "Matrícula removida")
    }

    // -------------------------
    // Edição / status (S-AE-13) — mesma semântica de campos (bloqueado/motivo_bloqueio) da tela
    // geral de Leads: a ação aqui muda o cadastro GERAL do lead, não uma cópia isolada do módulo.
    // -------------------------
    const abrirEdicao = (lead: LeadRecorte) => {
        setEditando(lead)
        setEditNome(lead.nome ?? "")
        setEditTelefone(lead.telefone)
    }

    const salvarEdicao = async () => {
        if (!editando) return
        setSalvandoEdicao(true)
        try {
            const res = await fetch("/api/academia-enem/leads", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: [editando.id], acao: "editar", nome: editNome, telefone: editTelefone }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Erro ao salvar")
            toast.success("Lead atualizado")
            setEditando(null)
            carregarRecorte().then(setRecorte)
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Erro ao salvar")
        } finally {
            setSalvandoEdicao(false)
        }
    }

    const confirmarBloqueio = async () => {
        if (!bloqueioAlvo) return
        setBloqueando(true)
        try {
            const res = await fetch("/api/academia-enem/leads", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: bloqueioAlvo.ids, acao: "bloquear", motivo: motivoBloqueio || null }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Erro ao bloquear")
            toast.success(`${bloqueioAlvo.ids.length} lead(s) bloqueado(s)`)
            setBloqueioAlvo(null)
            setMotivoBloqueio("")
            setSelecionados(new Set())
            carregarRecorte().then(setRecorte)
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Erro ao bloquear")
        } finally {
            setBloqueando(false)
        }
    }

    const desbloquear = async (ids: string[]) => {
        try {
            const res = await fetch("/api/academia-enem/leads", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids, acao: "desbloquear" }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Erro ao desbloquear")
            toast.success(`${ids.length} lead(s) desbloqueado(s)`)
            setSelecionados(new Set())
            carregarRecorte().then(setRecorte)
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Erro ao desbloquear")
        }
    }

    const toggleSelecionado = (id: string) => {
        setSelecionados(prev => {
            const next = new Set(prev)
            if (next.has(id)) { next.delete(id) } else { next.add(id) }
            return next
        })
    }

    const toggleSelecionarTodos = () => {
        const ids = recorte.map(l => l.id)
        const todos = ids.every(id => selecionados.has(id))
        setSelecionados(todos ? new Set() : new Set(ids))
    }

    // Público de disparo = só quem NÃO está bloqueado (bloquear "some do público de disparo padrão").
    const usarComoPublico = () => {
        const elegiveis = recorte.filter(l => !l.bloqueado)
        if (elegiveis.length === 0) { toast.error("Nenhum lead elegível (todos bloqueados ou recorte vazio)"); return }
        const contatos = elegiveis.map(l => ({ nome: l.nome ?? "", telefone: normalizarTelefone(l.telefone) }))
        sessionStorage.setItem("ae_disparo_publico", JSON.stringify({ origem: "tag_academia_enem", contatos }))
        toast.success(`Público preparado: ${contatos.length} contato(s). Será usado no disparo (S-AE-09).`)
    }

    const exportar = () => {
        if (recorte.length === 0) { toast.error("Nada para exportar"); return }
        exportarCSV(
            "publico_academia_enem.csv",
            ["Nome", "Telefone", "Unidade", "Opt-in", "Status"],
            recorte.map(l => [l.nome ?? "", l.telefone, l.unidade_cuca ?? "", l.opt_in ? "sim" : "não", l.bloqueado ? "bloqueado" : "ativo"]),
        )
    }

    // -------------------------
    // Upload de planilha (S-AE-13) — mesmo padrão de leitura da S-AE-07 (presencas): XLSX no
    // client (aceita .csv também), mapeamento de coluna, preview, POST das linhas cruas.
    // -------------------------
    const CAMPOS_UPLOAD: { key: "nome" | "telefone"; label: string; hints: RegExp }[] = useMemo(() => [
        { key: "nome", label: "Nome", hints: /nome|aluno|participante/i },
        { key: "telefone", label: "Telefone", hints: /tel|fone|celular|whats|contato/i },
    ], [])

    const handleFileUpload = (file: File) => {
        setResultadoUpload(null)
        const reader = new FileReader()
        reader.onload = (ev) => {
            try {
                const bstr = ev.target?.result
                const wb = XLSX.read(bstr, { type: "binary" })
                const ws = wb.Sheets[wb.SheetNames[0]]
                const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, blankrows: false })
                if (!aoa.length) { toast.error("Planilha vazia"); return }
                const hdr = (aoa[0] as unknown[]).map(c => String(c ?? "").trim())
                const body = aoa.slice(1).map(r => hdr.map((_, i) => String((r as unknown[])[i] ?? "").trim()))
                if (!hdr.some(h => /nome|aluno|participante/i.test(h)) && !hdr.some(h => /tel|fone|celular|whats|contato/i.test(h))) {
                    toast.error("Não encontrei colunas de nome/telefone — confira o cabeçalho da planilha")
                }
                setHeadersUpload(hdr)
                setRowsUpload(body)
                setFileName(file.name)
                const auto: { nome: number; telefone: number } = { nome: -1, telefone: -1 }
                CAMPOS_UPLOAD.forEach((c, idx) => {
                    const found = hdr.findIndex(h => c.hints.test(h))
                    auto[c.key] = found >= 0 ? found : (hdr[idx] !== undefined ? idx : -1)
                })
                setMapUpload(auto)
            } catch {
                toast.error("Não foi possível ler a planilha")
            }
        }
        reader.readAsBinaryString(file)
    }

    const previewUpload = useMemo(() => rowsUpload.slice(0, 8), [rowsUpload])

    const handleImportarPlanilha = async () => {
        if (!canUpload) { toast.error("Sem permissão para importar"); return }
        if (mapUpload.telefone < 0) { toast.error("Mapeie ao menos a coluna Telefone"); return }
        setEnviandoUpload(true)
        setResultadoUpload(null)
        try {
            const linhas = rowsUpload.map(r => ({
                nome: mapUpload.nome >= 0 ? r[mapUpload.nome] : "",
                telefone: mapUpload.telefone >= 0 ? r[mapUpload.telefone] : "",
            }))
            const res = await fetch("/api/academia-enem/leads/upload", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ linhas }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Falha na importação")
            setResultadoUpload(json as ResultadoUpload)
            toast.success(`${json.novos} lead(s) novo(s) cadastrado(s) — ${json.ignorados} já existiam`)
            carregarRecorte().then(setRecorte)
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Erro ao importar")
        } finally {
            setEnviandoUpload(false)
        }
    }

    if (authLoading) {
        return (
            <div className="space-y-4 animate-pulse">
                <div className="h-9 w-80 bg-muted rounded" />
                <div className="h-40 bg-muted rounded" />
            </div>
        )
    }

    if (!canRead) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-12 gap-4 text-center">
                <ShieldAlert className="h-16 w-16 text-slate-300" />
                <h2 className="text-xl font-bold text-slate-700">Acesso Restrito</h2>
                <p className="text-slate-500 max-w-sm">Você não tem permissão para acessar o público da Academia Enem.</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-3">
                    <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20">
                        <GraduationCap className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                        <h1 className="text-3xl font-bold tracking-tight">Leads — Academia Enem</h1>
                        <p className="text-muted-foreground text-sm">Estrutura própria de leads da Academia Enem: matrícula, status, edição e upload de planilha.</p>
                    </div>
                </div>
                {canUpdate && (
                    <Dialog open={dialogOpen} onOpenChange={(o) => { setDialogOpen(o); if (!o) { setBusca(""); setResultados([]); carregarRecorte().then(setRecorte) } }}>
                        <DialogTrigger asChild>
                            <Button variant="outline"><UserPlus className="mr-2 h-4 w-4" /> Gerenciar matrículas</Button>
                        </DialogTrigger>
                        <DialogContent className="max-w-xl">
                            <DialogHeader>
                                <DialogTitle>Marcar leads como matriculados</DialogTitle>
                                <DialogDescription>Busque pelo nome ou telefone e marque/desmarque a matrícula na Academia Enem.</DialogDescription>
                            </DialogHeader>
                            <div className="relative">
                                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                                <Input className="pl-8" placeholder="Buscar por nome ou telefone (mín. 2 letras)" value={busca}
                                    onChange={e => buscarLeads(e.target.value)} />
                            </div>
                            <div className="max-h-80 overflow-y-auto divide-y">
                                {buscando ? (
                                    <p className="text-sm text-muted-foreground py-4 text-center">Buscando...</p>
                                ) : resultados.length === 0 ? (
                                    <p className="text-sm text-muted-foreground py-4 text-center">{busca.trim().length < 2 ? "Digite ao menos 2 letras." : "Nenhum lead encontrado."}</p>
                                ) : resultados.map(l => (
                                    <div key={l.id} className="flex items-center justify-between gap-2 py-2">
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium truncate">{l.nome || "—"}</p>
                                            <p className="text-xs text-muted-foreground">{l.telefone}{l.unidade_cuca ? ` · ${l.unidade_cuca}` : ""}</p>
                                        </div>
                                        <Button size="sm" variant={l.matriculado ? "default" : "outline"}
                                            onClick={() => toggleMatricula(l)}>
                                            {l.matriculado ? <><Check className="mr-1 h-3.5 w-3.5" /> Matriculado</> : <><X className="mr-1 h-3.5 w-3.5" /> Não</>}
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        </DialogContent>
                    </Dialog>
                )}
            </div>

            {/* Upload de planilha */}
            {canUpload && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2"><Upload className="h-4 w-4" /> Upload de planilha</CardTitle>
                        <CardDescription>Suba uma planilha (nome, telefone) — cadastra automaticamente só os leads novos, com a tag Academia Enem. Formatos: .xlsx, .xls, .csv.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div
                            className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-6 text-center cursor-pointer hover:border-primary/40 hover:bg-muted/30 transition-colors"
                            onClick={() => fileRef.current?.click()}
                        >
                            <div className="flex flex-col items-center gap-2">
                                {fileName ? <FileSpreadsheet className="h-7 w-7 text-primary" /> : <Upload className="h-7 w-7 text-muted-foreground/50" />}
                                <p className="text-sm text-muted-foreground">{fileName ?? "Clique para selecionar a planilha"}</p>
                                {rowsUpload.length > 0 && <Badge variant="secondary" className="text-xs">{rowsUpload.length} linha(s)</Badge>}
                            </div>
                        </div>
                        <input
                            ref={fileRef}
                            type="file"
                            accept=".xlsx,.xls,.csv"
                            className="hidden"
                            onChange={e => { const file = e.target.files?.[0]; if (file) handleFileUpload(file); e.target.value = "" }}
                        />

                        {headersUpload.length > 0 && (
                            <>
                                <div className="grid gap-3 sm:grid-cols-2">
                                    {CAMPOS_UPLOAD.map(c => (
                                        <div key={c.key} className="grid gap-1">
                                            <Label className="text-xs">
                                                {c.label}{c.key === "telefone" && <span className="text-red-500"> *</span>}
                                            </Label>
                                            <Select
                                                value={mapUpload[c.key] >= 0 ? String(mapUpload[c.key]) : "__none__"}
                                                onValueChange={v => setMapUpload(prev => ({ ...prev, [c.key]: v === "__none__" ? -1 : Number(v) }))}
                                            >
                                                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="__none__">— (ignorar)</SelectItem>
                                                    {headersUpload.map((h, i) => (
                                                        <SelectItem key={i} value={String(i)}>{h || `Coluna ${i + 1}`}</SelectItem>
                                                    ))}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    ))}
                                </div>

                                <div className="rounded-lg border overflow-x-auto">
                                    <Table>
                                        <TableHeader>
                                            <TableRow>
                                                {CAMPOS_UPLOAD.map(c => <TableHead key={c.key}>{c.label}</TableHead>)}
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {previewUpload.map((r, ri) => (
                                                <TableRow key={ri}>
                                                    {CAMPOS_UPLOAD.map(c => (
                                                        <TableCell key={c.key} className="text-sm">
                                                            {mapUpload[c.key] >= 0 ? (r[mapUpload[c.key]] || "—") : "—"}
                                                        </TableCell>
                                                    ))}
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                                {rowsUpload.length > previewUpload.length && (
                                    <p className="text-xs text-muted-foreground">Mostrando {previewUpload.length} de {rowsUpload.length} linhas.</p>
                                )}

                                <div className="flex justify-end">
                                    <Button onClick={handleImportarPlanilha} disabled={enviandoUpload}>
                                        {enviandoUpload
                                            ? <><Clock className="mr-2 h-4 w-4 animate-spin" />Importando...</>
                                            : <><ListChecks className="mr-2 h-4 w-4" />Importar {rowsUpload.length} linha(s)</>}
                                    </Button>
                                </div>
                            </>
                        )}

                        {resultadoUpload && (
                            <div className="rounded-lg border p-4 space-y-3">
                                <p className="text-sm font-medium flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-green-600" /> Resultado do upload</p>
                                <div className="grid gap-3 sm:grid-cols-3">
                                    <div className="rounded-lg border p-3">
                                        <p className="text-2xl font-bold">{resultadoUpload.total}</p>
                                        <p className="text-xs text-muted-foreground">Linhas na planilha</p>
                                    </div>
                                    <div className="rounded-lg border p-3">
                                        <p className="text-2xl font-bold text-primary">{resultadoUpload.novos}</p>
                                        <p className="text-xs text-muted-foreground">Novos cadastrados</p>
                                    </div>
                                    <div className="rounded-lg border p-3">
                                        <p className="text-2xl font-bold text-amber-600">{resultadoUpload.ignorados}</p>
                                        <p className="text-xs text-muted-foreground">Já existiam (ignorados)</p>
                                    </div>
                                </div>
                                {resultadoUpload.erros.length > 0 && (
                                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                                        <p className="text-sm font-medium text-amber-800 flex items-center gap-1.5 mb-2">
                                            <AlertTriangle className="h-4 w-4" /> Linhas com erro (não derrubaram o restante)
                                        </p>
                                        <div className="max-h-48 overflow-y-auto text-xs text-amber-900 space-y-0.5">
                                            {resultadoUpload.erros.map((iv, i) => (
                                                <div key={i}>Linha {iv.linha}: {iv.motivo}</div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Filtros + ações */}
            <Card>
                <CardContent className="p-4 flex flex-wrap items-end gap-4">
                    <div className="grid gap-1">
                        <Label className="text-xs">Unidade</Label>
                        <Select value={unidade} onValueChange={setUnidade}>
                            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value={TODAS}>Todas as unidades</SelectItem>
                                {unidadesCuca.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex items-center gap-2 pb-2">
                        <Switch id="optin" checked={optIn} onCheckedChange={setOptIn} />
                        <Label htmlFor="optin" className="text-xs">Somente quem aceita receber (opt-in)</Label>
                    </div>
                    <div className="ml-auto flex gap-2">
                        {canUpdate && selecionados.size > 0 && (
                            <>
                                <Button variant="outline" onClick={() => desbloquear([...selecionados])}>
                                    <Unlock className="mr-2 h-4 w-4" /> Desbloquear ({selecionados.size})
                                </Button>
                                <Button variant="destructive" onClick={() => setBloqueioAlvo({ ids: [...selecionados], label: `${selecionados.size} lead(s) selecionado(s)` })}>
                                    <Lock className="mr-2 h-4 w-4" /> Bloquear ({selecionados.size})
                                </Button>
                            </>
                        )}
                        <Button variant="outline" onClick={exportar}><Download className="mr-2 h-4 w-4" /> CSV</Button>
                        <Button onClick={usarComoPublico} disabled={recorte.length === 0}>
                            <Send className="mr-2 h-4 w-4" /> Usar como público de disparo
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Recorte */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        Recorte <Badge variant="secondary">{recorte.length}</Badge>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>
                    ) : recorte.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-8 text-center">
                            Nenhum lead matriculado no recorte atual.{canUpdate ? " Use \"Gerenciar matrículas\" para marcar." : ""}
                        </p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    {canUpdate && (
                                        <TableHead className="w-8">
                                            <Checkbox
                                                checked={recorte.length > 0 && recorte.every(l => selecionados.has(l.id))}
                                                onCheckedChange={toggleSelecionarTodos}
                                            />
                                        </TableHead>
                                    )}
                                    <TableHead>Nome</TableHead>
                                    <TableHead>Telefone</TableHead>
                                    <TableHead>Unidade</TableHead>
                                    <TableHead>Opt-in</TableHead>
                                    <TableHead>Status</TableHead>
                                    {canUpdate && <TableHead className="text-right">Ações</TableHead>}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {recorte.map(l => (
                                    <TableRow key={l.id}>
                                        {canUpdate && (
                                            <TableCell>
                                                <Checkbox checked={selecionados.has(l.id)} onCheckedChange={() => toggleSelecionado(l.id)} />
                                            </TableCell>
                                        )}
                                        <TableCell className="font-medium">{l.nome || "—"}</TableCell>
                                        <TableCell className="text-muted-foreground">{l.telefone}</TableCell>
                                        <TableCell>{l.unidade_cuca || "—"}</TableCell>
                                        <TableCell>
                                            <Badge variant={l.opt_in ? "default" : "secondary"} className={l.opt_in ? "bg-green-600 text-white" : ""}>
                                                {l.opt_in ? "sim" : "não"}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            {l.bloqueado ? (
                                                <Badge variant="destructive" title={l.motivo_bloqueio || undefined}>Bloqueado</Badge>
                                            ) : (
                                                <Badge variant="outline">Ativo</Badge>
                                            )}
                                        </TableCell>
                                        {canUpdate && (
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-1">
                                                    <Button size="icon" variant="ghost" onClick={() => abrirEdicao(l)} title="Editar">
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                    {l.bloqueado ? (
                                                        <Button size="icon" variant="ghost" onClick={() => desbloquear([l.id])} title="Desbloquear">
                                                            <Unlock className="h-4 w-4" />
                                                        </Button>
                                                    ) : (
                                                        <Button size="icon" variant="ghost" onClick={() => setBloqueioAlvo({ ids: [l.id], label: l.nome || l.telefone })} title="Bloquear">
                                                            <Lock className="h-4 w-4" />
                                                        </Button>
                                                    )}
                                                </div>
                                            </TableCell>
                                        )}
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            {/* Dialog: editar lead */}
            <Dialog open={!!editando} onOpenChange={(o) => !o && setEditando(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Editar lead</DialogTitle>
                        <DialogDescription>
                            Isso altera o cadastro geral do lead (mesma linha usada por todo o sistema), não uma cópia isolada da Academia Enem.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-3">
                        <div className="grid gap-1">
                            <Label className="text-xs">Nome</Label>
                            <Input value={editNome} onChange={e => setEditNome(e.target.value)} />
                        </div>
                        <div className="grid gap-1">
                            <Label className="text-xs">Telefone</Label>
                            <Input value={editTelefone} onChange={e => setEditTelefone(e.target.value)} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setEditando(null)}>Cancelar</Button>
                        <Button onClick={salvarEdicao} disabled={salvandoEdicao}>{salvandoEdicao ? "Salvando..." : "Salvar"}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* Dialog: bloquear (individual ou em massa) */}
            <Dialog open={!!bloqueioAlvo} onOpenChange={(o) => { if (!o) { setBloqueioAlvo(null); setMotivoBloqueio("") } }}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Bloquear {bloqueioAlvo?.label}</DialogTitle>
                        <DialogDescription>
                            Lead(s) bloqueado(s) some(m) do público padrão de disparo. Isso altera o cadastro geral do lead.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-1">
                        <Label className="text-xs">Motivo (opcional)</Label>
                        <Input value={motivoBloqueio} onChange={e => setMotivoBloqueio(e.target.value)} placeholder="Ex.: pedido de exclusão, número inválido..." />
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => { setBloqueioAlvo(null); setMotivoBloqueio("") }}>Cancelar</Button>
                        <Button variant="destructive" onClick={confirmarBloqueio} disabled={bloqueando}>{bloqueando ? "Bloqueando..." : "Bloquear"}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
