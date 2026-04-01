"use client"

import { useEffect, useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Users, Briefcase, FileText, TrendingUp, Star, GraduationCap } from "lucide-react"
import {
    BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
    PieChart, Pie, Cell, Legend
} from "recharts"

const STATUS_COLORS: Record<string, string> = {
    disponivel: "#22c55e",
    selecionado: "#3b82f6",
    contratado: "#a855f7",
    desconhecido: "#6b7280",
    aberta: "#22c55e",
    pre_cadastro: "#f59e0b",
    preenchida: "#3b82f6",
    cancelada: "#ef4444",
    pendente: "#f59e0b",
    rejeitado: "#ef4444",
}

const AREA_COLORS = ["#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#ef4444", "#06b6d4", "#f97316", "#ec4899"]

function StatCard({ title, value, sub, icon: Icon, color }: {
    title: string; value: number | string; sub?: string; icon: any; color: string
}) {
    return (
        <Card>
            <CardContent className="p-5">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm text-muted-foreground">{title}</p>
                        <p className="text-3xl font-bold mt-1">{value}</p>
                        {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
                    </div>
                    <div className={`p-3 rounded-full ${color}`}>
                        <Icon className="h-5 w-5 text-white" />
                    </div>
                </div>
            </CardContent>
        </Card>
    )
}

export default function EmpregabilidadeDashboard() {
    const [data, setData] = useState<any>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
        fetch("/api/empregabilidade/analytics")
            .then(r => r.json())
            .then(d => { setData(d); setLoading(false) })
            .catch(() => setLoading(false))
    }, [])

    if (loading) {
        return (
            <div className="p-6 space-y-4 animate-pulse">
                <div className="h-8 w-64 bg-muted rounded" />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-muted rounded-xl" />)}
                </div>
            </div>
        )
    }

    if (!data) return <div className="p-6 text-muted-foreground">Erro ao carregar analytics.</div>

    const tb = data.talent_bank
    const vagas = data.vagas
    const cands = data.candidaturas

    const peStatusTB = Object.entries(tb.por_status as Record<string, number>).map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1), value
    }))

    const peStatusCand = Object.entries(cands.por_status as Record<string, number>).map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1), value
    }))

    const primeiroEmpregoPie = [
        { name: "1º Emprego", value: tb.primeiro_emprego },
        { name: "Com experiência", value: tb.com_experiencia },
    ].filter(d => d.value > 0)

    const pctPrimeiroEmprego = tb.total_com_skills > 0
        ? Math.round((tb.primeiro_emprego / tb.total_com_skills) * 100)
        : 0

    return (
        <div className="p-6 space-y-6 max-w-7xl mx-auto">
            <div>
                <h1 className="text-2xl font-bold">Painel de Empregabilidade</h1>
                <p className="text-muted-foreground text-sm mt-1">Visão geral do banco de talentos, vagas e candidaturas.</p>
            </div>

            {/* Cards de resumo */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard
                    title="Banco de Talentos"
                    value={tb.total}
                    sub={`${tb.por_status?.disponivel ?? 0} disponíveis`}
                    icon={Users}
                    color="bg-purple-500"
                />
                <StatCard
                    title="1º Emprego"
                    value={`${pctPrimeiroEmprego}%`}
                    sub={`${tb.primeiro_emprego} de ${tb.total_com_skills} com dados`}
                    icon={Star}
                    color="bg-amber-500"
                />
                <StatCard
                    title="Vagas"
                    value={vagas.total}
                    sub={`${vagas.por_status?.aberta ?? 0} abertas`}
                    icon={Briefcase}
                    color="bg-blue-500"
                />
                <StatCard
                    title="Candidaturas"
                    value={cands.total}
                    sub={`${cands.por_status?.contratado ?? 0} contratados`}
                    icon={FileText}
                    color="bg-green-500"
                />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Top Áreas de interesse */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <TrendingUp className="h-4 w-4 text-blue-400" /> Áreas de Interesse (Top 8)
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={260}>
                            <BarChart data={data.areas} layout="vertical" margin={{ left: 0, right: 16 }}>
                                <XAxis type="number" tick={{ fontSize: 11 }} />
                                <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
                                <Tooltip />
                                <Bar dataKey="value" name="Candidatos" radius={[0, 4, 4, 0]}>
                                    {data.areas.map((_: any, i: number) => (
                                        <Cell key={i} fill={AREA_COLORS[i % AREA_COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Primeiro emprego */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <Star className="h-4 w-4 text-amber-400" /> Experiência no Banco de Talentos
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex items-center justify-center">
                        {primeiroEmpregoPie.length > 0 ? (
                            <ResponsiveContainer width="100%" height={220}>
                                <PieChart>
                                    <Pie
                                        data={primeiroEmpregoPie}
                                        cx="50%"
                                        cy="50%"
                                        outerRadius={80}
                                        dataKey="value"
                                        label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                                        labelLine={false}
                                    >
                                        <Cell fill="#f59e0b" />
                                        <Cell fill="#3b82f6" />
                                    </Pie>
                                    <Tooltip />
                                    <Legend />
                                </PieChart>
                            </ResponsiveContainer>
                        ) : (
                            <p className="text-muted-foreground text-sm">Dados insuficientes</p>
                        )}
                    </CardContent>
                </Card>

                {/* Escolaridade */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <GraduationCap className="h-4 w-4 text-green-400" /> Escolaridade (Banco de Talentos)
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <ResponsiveContainer width="100%" height={220}>
                            <BarChart data={data.escolaridade} layout="vertical" margin={{ left: 0, right: 16 }}>
                                <XAxis type="number" tick={{ fontSize: 11 }} />
                                <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 10 }} />
                                <Tooltip />
                                <Bar dataKey="value" name="Candidatos" fill="#22c55e" radius={[0, 4, 4, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>

                {/* Status candidaturas */}
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <FileText className="h-4 w-4 text-purple-400" /> Candidaturas por Status
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="flex items-center justify-center">
                        <ResponsiveContainer width="100%" height={220}>
                            <PieChart>
                                <Pie
                                    data={peStatusCand}
                                    cx="50%"
                                    cy="50%"
                                    outerRadius={80}
                                    dataKey="value"
                                    label={({ name, value }) => `${name}: ${value}`}
                                    labelLine={false}
                                >
                                    {peStatusCand.map((entry: any, i: number) => (
                                        <Cell key={i} fill={STATUS_COLORS[entry.name.toLowerCase()] ?? "#6b7280"} />
                                    ))}
                                </Pie>
                                <Tooltip />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </CardContent>
                </Card>
            </div>

            {/* Banco de talentos por status */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                        <Users className="h-4 w-4 text-purple-400" /> Banco de Talentos por Status
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <div className="flex flex-wrap gap-4">
                        {peStatusTB.map(({ name, value }) => (
                            <div key={name} className="flex items-center gap-2 text-sm">
                                <div className="w-3 h-3 rounded-full" style={{ background: STATUS_COLORS[name.toLowerCase()] ?? "#6b7280" }} />
                                <span className="font-medium">{value}</span>
                                <span className="text-muted-foreground">{name}</span>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>
        </div>
    )
}
