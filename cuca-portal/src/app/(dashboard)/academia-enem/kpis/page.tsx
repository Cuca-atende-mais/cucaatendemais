"use client"

import { useState, useEffect, useMemo } from "react"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/lib/auth/user-provider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts"
import {
    GraduationCap, ShieldAlert, Users, Percent, CalendarDays, UserX, Download, Send,
} from "lucide-react"
import toast from "react-hot-toast"

type Presenca = {
    nome: string | null
    telefone: string
    presente: boolean
    data_encontro: string
    unidade_cuca: string | null
    lead_id: string | null
}

type AlunoAgg = {
    telefone: string
    nome: string
    encontros: number
    presencas: number
    faltas: number
    taxa: number
}

const TODAS = "__todas__"

function exportarCSV(filename: string, headers: string[], rows: (string | number)[][]) {
    const esc = (v: string | number) => {
        const s = String(v ?? "")
        return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const csv = [headers, ...rows].map(r => r.map(esc).join(";")).join("\n")
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
}

export default function PresencaKpisPage() {
    const { isDeveloper, hasPermission, loading: authLoading } = useUser()
    const canRead = isDeveloper || hasPermission("ae_kpis", "read")
    const supabase = createClient()

    const [loading, setLoading] = useState(true)
    const [dados, setDados] = useState<Presenca[]>([])
    const [unidades, setUnidades] = useState<string[]>([])
    const [de, setDe] = useState("")
    const [ate, setAte] = useState("")
    const [unidade, setUnidade] = useState(TODAS)
    const [n, setN] = useState(2)

    useEffect(() => {
        if (authLoading || !canRead) return
        let cancel = false
        ;(async () => {
            let q = supabase.from("ae_presencas").select("nome, telefone, presente, data_encontro, unidade_cuca, lead_id")
            if (de) q = q.gte("data_encontro", de)
            if (ate) q = q.lte("data_encontro", ate)
            if (unidade !== TODAS) q = q.eq("unidade_cuca", unidade)
            const { data, error } = await q.order("data_encontro", { ascending: true })
            if (cancel) return
            if (error) toast.error("Erro ao carregar presenças")
            else setDados((data as Presenca[]) || [])
            setLoading(false)
        })()
        return () => { cancel = true }
    }, [authLoading, canRead, de, ate, unidade, supabase])

    // carrega a lista de unidades distintas uma vez (independe dos filtros)
    useEffect(() => {
        if (authLoading || !canRead) return
        supabase.from("ae_presencas").select("unidade_cuca").then(({ data }) => {
            const us = [...new Set((data || []).map(d => d.unidade_cuca).filter((u): u is string => !!u))].sort()
            setUnidades(us)
        })
    }, [authLoading, canRead, supabase])

    // ── Agregações ──
    const porEncontro = useMemo(() => {
        const map = new Map<string, { data: string; presentes: number; faltas: number }>()
        for (const p of dados) {
            const e = map.get(p.data_encontro) ?? { data: p.data_encontro, presentes: 0, faltas: 0 }
            if (p.presente) e.presentes++; else e.faltas++
            map.set(p.data_encontro, e)
        }
        return [...map.values()]
            .sort((a, b) => a.data.localeCompare(b.data))
            .map(e => ({ ...e, label: e.data.split("-").reverse().slice(0, 2).join("/") }))
    }, [dados])

    const porAluno = useMemo<AlunoAgg[]>(() => {
        const map = new Map<string, AlunoAgg>()
        for (const p of dados) {
            const a = map.get(p.telefone) ?? { telefone: p.telefone, nome: p.nome ?? "—", encontros: 0, presencas: 0, faltas: 0, taxa: 0 }
            a.encontros++
            if (p.presente) a.presencas++; else a.faltas++
            if (p.nome) a.nome = p.nome
            map.set(p.telefone, a)
        }
        return [...map.values()]
            .map(a => ({ ...a, taxa: a.encontros ? Math.round((a.presencas / a.encontros) * 100) : 0 }))
            .sort((a, b) => b.faltas - a.faltas || a.nome.localeCompare(b.nome))
    }, [dados])

    const totalRegistros = dados.length
    const totalPresentes = useMemo(() => dados.filter(d => d.presente).length, [dados])
    const taxaAssiduidade = totalRegistros ? Math.round((totalPresentes / totalRegistros) * 100) : 0
    const segmento = useMemo(() => porAluno.filter(a => a.faltas >= n), [porAluno, n])

    const exportarRecorte = () => {
        if (porAluno.length === 0) { toast.error("Nada para exportar"); return }
        exportarCSV(
            "presenca_academia_enem.csv",
            ["Nome", "Telefone", "Encontros", "Presenças", "Faltas", "Assiduidade (%)"],
            porAluno.map(a => [a.nome, a.telefone, a.encontros, a.presencas, a.faltas, a.taxa]),
        )
    }

    const usarComoPublico = () => {
        if (segmento.length === 0) { toast.error("Segmento vazio"); return }
        // Hook para o disparo (S-AE-09): persiste o público pela chave de identidade (telefone normalizado).
        const publico = segmento.map(a => ({ nome: a.nome, telefone: a.telefone }))
        sessionStorage.setItem("ae_disparo_publico", JSON.stringify({ origem: `faltou>=${n}`, contatos: publico }))
        toast.success(`Público preparado: ${publico.length} contato(s). Será usado no disparo (S-AE-09).`)
    }

    if (authLoading) {
        return (
            <div className="space-y-4 animate-pulse">
                <div className="h-9 w-80 bg-muted rounded" />
                <div className="grid gap-4 md:grid-cols-4">
                    {[0, 1, 2, 3].map(i => <div key={i} className="h-24 bg-muted rounded" />)}
                </div>
                <div className="h-72 bg-muted rounded" />
            </div>
        )
    }

    if (!canRead) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-12 gap-4 text-center">
                <ShieldAlert className="h-16 w-16 text-slate-300" />
                <h2 className="text-xl font-bold text-slate-700">Acesso Restrito</h2>
                <p className="text-slate-500 max-w-sm">Você não tem permissão para acessar os KPIs de presença da Academia Enem.</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20">
                    <GraduationCap className="h-6 w-6 text-primary" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">KPIs de Presença</h1>
                    <p className="text-muted-foreground text-sm">Assiduidade e faltas dos encontros da Academia Enem.</p>
                </div>
            </div>

            {/* Filtros */}
            <Card>
                <CardContent className="p-4 flex flex-wrap items-end gap-3">
                    <div className="grid gap-1">
                        <Label className="text-xs">De</Label>
                        <Input type="date" value={de} onChange={e => setDe(e.target.value)} className="w-40" />
                    </div>
                    <div className="grid gap-1">
                        <Label className="text-xs">Até</Label>
                        <Input type="date" value={ate} onChange={e => setAte(e.target.value)} className="w-40" />
                    </div>
                    <div className="grid gap-1">
                        <Label className="text-xs">Unidade</Label>
                        <Select value={unidade} onValueChange={setUnidade}>
                            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value={TODAS}>Todas as unidades</SelectItem>
                                {unidades.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="ml-auto">
                        <Button variant="outline" onClick={exportarRecorte}>
                            <Download className="mr-2 h-4 w-4" /> Exportar CSV
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Métricas */}
            <div className="grid gap-4 md:grid-cols-4">
                <Metric title="Alunos" value={porAluno.length} icon={Users} />
                <Metric title="Taxa de assiduidade" value={`${taxaAssiduidade}%`} icon={Percent} accent="text-green-600" />
                <Metric title="Encontros" value={porEncontro.length} icon={CalendarDays} />
                <Metric title="Com faltas" value={porAluno.filter(a => a.faltas > 0).length} icon={UserX} accent="text-amber-600" />
            </div>

            {/* Gráfico por encontro */}
            <Card>
                <CardHeader><CardTitle className="text-base">Presentes × Faltas por encontro</CardTitle></CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="h-64 flex items-center justify-center text-muted-foreground">Carregando...</div>
                    ) : porEncontro.length === 0 ? (
                        <div className="h-64 flex items-center justify-center text-muted-foreground">Sem presenças no período/unidade selecionados.</div>
                    ) : (
                        <ResponsiveContainer width="100%" height={280}>
                            <BarChart data={porEncontro}>
                                <XAxis dataKey="label" fontSize={12} />
                                <YAxis allowDecimals={false} fontSize={12} />
                                <Tooltip />
                                <Legend />
                                <Bar dataKey="presentes" name="Presentes" fill="#22c55e" radius={[4, 4, 0, 0]} />
                                <Bar dataKey="faltas" name="Faltas" fill="#ef4444" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    )}
                </CardContent>
            </Card>

            {/* Segmento "faltou ≥ N" */}
            <Card>
                <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <CardTitle className="text-base">Faltou ≥ N encontros</CardTitle>
                        <div className="flex items-center gap-2">
                            <Label htmlFor="n" className="text-xs">N =</Label>
                            <Input id="n" type="number" min={1} value={n}
                                onChange={e => setN(Math.max(1, Number(e.target.value) || 1))} className="w-20" />
                            <Button onClick={usarComoPublico} disabled={segmento.length === 0}>
                                <Send className="mr-2 h-4 w-4" /> Usar como público de disparo
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {segmento.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-4 text-center">Nenhum aluno com {n} ou mais faltas no recorte atual.</p>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Nome</TableHead>
                                    <TableHead>Telefone</TableHead>
                                    <TableHead className="text-center">Encontros</TableHead>
                                    <TableHead className="text-center">Faltas</TableHead>
                                    <TableHead className="text-center">Assiduidade</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {segmento.map(a => (
                                    <TableRow key={a.telefone}>
                                        <TableCell className="font-medium">{a.nome}</TableCell>
                                        <TableCell className="text-muted-foreground">{a.telefone}</TableCell>
                                        <TableCell className="text-center">{a.encontros}</TableCell>
                                        <TableCell className="text-center text-red-600 font-semibold">{a.faltas}</TableCell>
                                        <TableCell className="text-center">{a.taxa}%</TableCell>
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

function Metric({ title, value, icon: Icon, accent }: { title: string; value: number | string; icon: React.ElementType; accent?: string }) {
    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">{title}</CardTitle>
                <Icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
                <div className={`text-2xl font-bold ${accent ?? ""}`}>{value}</div>
            </CardContent>
        </Card>
    )
}
