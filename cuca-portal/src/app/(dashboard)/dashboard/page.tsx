"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Users, Calendar, Briefcase, MessageSquare, Building2, TrendingUp, Loader2 } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { unidadesCuca } from "@/lib/constants"
import { cn } from "@/lib/utils"

export default function DashboardPage() {
    const supabase = createClient()
    const [loading, setLoading] = useState(true)
    const [selectedUnit, setSelectedUnit] = useState("all")
    const [stats, setStats] = useState({
        leads: 0,
        eventos: 0,
        vagas: 0,
        ouvidoria: 0,
        progresso: 85
    })

    useEffect(() => {
        fetchStats()
    }, [selectedUnit])

    const fetchStats = async () => {
        setLoading(true)

        let leadQuery = supabase.from("leads").select("id", { count: "exact", head: true })
        let eventQuery = supabase.from("ouvidoria_eventos").select("id", { count: "exact", head: true }).eq("status", "ativo")
        let vagaQuery = supabase.from("vagas").select("id", { count: "exact", head: true }).eq("status", "aberta")
        let ouvidoriaQuery = supabase.from("ouvidoria_registros").select("id", { count: "exact", head: true })

        if (selectedUnit !== "all") {
            leadQuery = leadQuery.eq("unidade_cuca", selectedUnit)
            eventQuery = eventQuery.eq("unidade_cuca", selectedUnit)
            vagaQuery = vagaQuery.eq("unidade_cuca", selectedUnit)
            ouvidoriaQuery = ouvidoriaQuery.eq("unidade_cuca", selectedUnit)
        }

        const [lCount, eCount, vCount, oCount] = await Promise.all([
            leadQuery, eventQuery, vagaQuery, ouvidoriaQuery
        ])

        setStats({
            leads: lCount.count || 0,
            eventos: eCount.count || 0,
            vagas: vCount.count || 0,
            ouvidoria: oCount.count || 0,
            progresso: 92
        })
        setLoading(false)
    }

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Painel Gerencial</h1>
                    <p className="text-muted-foreground">Consolidado de métricas da Rede CUCA</p>
                </div>
                <div className="flex items-center gap-2">
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    <Select value={selectedUnit} onValueChange={setSelectedUnit}>
                        <SelectTrigger className="w-[200px]">
                            <SelectValue placeholder="Todas as Unidades" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">Todas as Unidades</SelectItem>
                            {unidadesCuca.map(u => (
                                <SelectItem key={u.id} value={u.nome}>{u.nome}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
            ) : (
                <>
                    <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
                        <Card className="hover:shadow-md transition-shadow">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Leads Totais</CardTitle>
                                <Users className="h-4 w-4 text-sky-500" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{stats.leads.toLocaleString()}</div>
                                <p className="text-xs text-muted-foreground mt-1">Contatos na base</p>
                            </CardContent>
                        </Card>

                        <Card className="hover:shadow-md transition-shadow">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Eventos de Escuta</CardTitle>
                                <Calendar className="h-4 w-4 text-amber-500" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{stats.eventos}</div>
                                <p className="text-xs text-muted-foreground mt-1">Escutas ativas agora</p>
                            </CardContent>
                        </Card>

                        <Card className="hover:shadow-md transition-shadow">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Vagas de Emprego</CardTitle>
                                <Briefcase className="h-4 w-4 text-emerald-500" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{stats.vagas}</div>
                                <p className="text-xs text-muted-foreground mt-1">Vagas abertas no portal</p>
                            </CardContent>
                        </Card>

                        <Card className="hover:shadow-md transition-shadow">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                                <CardTitle className="text-sm font-medium">Manifestações</CardTitle>
                                <MessageSquare className="h-4 w-4 text-indigo-500" />
                            </CardHeader>
                            <CardContent>
                                <div className="text-2xl font-bold">{stats.ouvidoria}</div>
                                <p className="text-xs text-muted-foreground mt-1">Críticas e sugestões</p>
                            </CardContent>
                        </Card>
                    </div>

                    <div className="grid gap-6 md:grid-cols-2">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base flex items-center gap-2">
                                    <TrendingUp className="h-5 w-5 text-primary" />
                                    Status do Sistema (Go-Live)
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div className="space-y-2">
                                    <div className="flex justify-between text-sm">
                                        <span>Desenvolvimento da Sprint 12-16</span>
                                        <span className="font-bold">{stats.progresso}%</span>
                                    </div>
                                    <div className="w-full bg-muted rounded-full h-2">
                                        <div className="bg-primary h-2 rounded-full transition-all duration-1000" style={{ width: `${stats.progresso}%` }} />
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-4">
                                    <div className="p-3 border rounded-lg bg-green-50">
                                        <p className="text-[10px] uppercase font-bold text-green-700">Database</p>
                                        <p className="text-sm font-semibold">Integrado (Supabase)</p>
                                    </div>
                                    <div className="p-3 border rounded-lg bg-blue-50">
                                        <p className="text-[10px] uppercase font-bold text-blue-700">WhatsApp</p>
                                        <p className="text-sm font-semibold">UAZAPI Master OK</p>
                                    </div>
                                    <div className="p-3 border rounded-lg bg-indigo-50">
                                        <p className="text-[10px] uppercase font-bold text-indigo-700">Privacidade</p>
                                        <p className="text-sm font-semibold">LGPD Core OK</p>
                                    </div>
                                    <div className="p-3 border rounded-lg bg-amber-50">
                                        <p className="text-[10px] uppercase font-bold text-amber-700">Developer</p>
                                        <p className="text-sm font-semibold">Console Ativo</p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base text-cuca-dark">Links Rápidos</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-1 gap-2">
                                    <a href="/atendimento" className="p-3 border rounded-lg hover:bg-slate-50 transition-colors flex justify-between items-center text-sm group">
                                        Painel de Atendimentos
                                        <span className="text-xs text-muted-foreground group-hover:text-primary">Ir para →</span>
                                    </a>
                                    <a href="/acesso-cuca" className="p-3 border rounded-lg hover:bg-slate-50 transition-colors flex justify-between items-center text-sm group">
                                        Acesso e Reservas (S12)
                                        <span className="text-xs text-muted-foreground group-hover:text-primary">Ir para →</span>
                                    </a>
                                    <a href="/ouvidoria" className="p-3 border rounded-lg hover:bg-slate-50 transition-colors flex justify-between items-center text-sm group">
                                        Manifestações Sofia (S13)
                                        <span className="text-xs text-muted-foreground group-hover:text-primary">Ir para →</span>
                                    </a>
                                    <a href="/leads" className="p-3 border rounded-lg hover:bg-slate-50 transition-colors flex justify-between items-center text-sm group">
                                        Gestão de Leads & LGPD
                                        <span className="text-xs text-muted-foreground group-hover:text-primary">Ir para →</span>
                                    </a>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </>
            )}
        </div>
    )
}

