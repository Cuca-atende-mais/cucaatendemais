"use client"

import { useState, useEffect, useCallback } from "react"
import { useUser } from "@/lib/auth/user-provider"
import { unidadesCuca } from "@/lib/constants"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
    Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog"
import {
    GraduationCap, ShieldAlert, Download, Send, UserPlus, Search, Check, X,
} from "lucide-react"
import toast from "react-hot-toast"

type LeadRecorte = { id: string; nome: string | null; telefone: string; unidade_cuca: string | null; opt_in: boolean; bloqueado: boolean }
type LeadBusca = { id: string; nome: string | null; telefone: string; unidade_cuca: string | null; matriculado: boolean }

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

    const [unidade, setUnidade] = useState(TODAS)
    const [optIn, setOptIn] = useState(true)
    const [recorte, setRecorte] = useState<LeadRecorte[]>([])
    const [loading, setLoading] = useState(true)

    const [dialogOpen, setDialogOpen] = useState(false)
    const [busca, setBusca] = useState("")
    const [resultados, setResultados] = useState<LeadBusca[]>([])
    const [buscando, setBuscando] = useState(false)

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
        carregarRecorte().then(rows => { if (!cancel) { setRecorte(rows); setLoading(false) } })
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
        // recarrega o recorte ao fechar
    }

    const usarComoPublico = () => {
        if (recorte.length === 0) { toast.error("Recorte vazio"); return }
        const contatos = recorte.map(l => ({ nome: l.nome ?? "", telefone: normalizarTelefone(l.telefone) }))
        sessionStorage.setItem("ae_disparo_publico", JSON.stringify({ origem: "tag_academia_enem", contatos }))
        toast.success(`Público preparado: ${contatos.length} contato(s). Será usado no disparo (S-AE-09).`)
    }

    const exportar = () => {
        if (recorte.length === 0) { toast.error("Nada para exportar"); return }
        exportarCSV(
            "publico_academia_enem.csv",
            ["Nome", "Telefone", "Unidade", "Opt-in"],
            recorte.map(l => [l.nome ?? "", l.telefone, l.unidade_cuca ?? "", l.opt_in ? "sim" : "não"]),
        )
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
                        <h1 className="text-3xl font-bold tracking-tight">Público — Matriculados Academia Enem</h1>
                        <p className="text-muted-foreground text-sm">Leads marcados como matriculados, prontos para receber informativos.</p>
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
                                    <TableHead>Nome</TableHead>
                                    <TableHead>Telefone</TableHead>
                                    <TableHead>Unidade</TableHead>
                                    <TableHead>Opt-in</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {recorte.map(l => (
                                    <TableRow key={l.id}>
                                        <TableCell className="font-medium">{l.nome || "—"}</TableCell>
                                        <TableCell className="text-muted-foreground">{l.telefone}</TableCell>
                                        <TableCell>{l.unidade_cuca || "—"}</TableCell>
                                        <TableCell>
                                            <Badge variant={l.opt_in ? "default" : "secondary"} className={l.opt_in ? "bg-green-600 text-white" : ""}>
                                                {l.opt_in ? "sim" : "não"}
                                            </Badge>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>
        </div>
    )
}
