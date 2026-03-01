"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { CampanhaMensal } from "@/lib/types/database"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ArrowLeft, Calendar, CheckCircle2, Clock, MapPin, Search, Send, FileText, Tag, Loader2 } from "lucide-react"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import toast from "react-hot-toast"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"

export default function CampanhaMensalPage() {
    const params = useParams()
    const router = useRouter()
    const campanhaId = params.id as string

    const [campanha, setCampanha] = useState<CampanhaMensal | null>(null)
    const [atividades, setAtividades] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [isDisparando, setIsDisparando] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const [categoriaFilter, setCategoriaFilter] = useState("all")
    const [categoriasUnicas, setCategoriasUnicas] = useState<string[]>([])

    const supabase = createClient()

    useEffect(() => {
        if (campanhaId) {
            fetchData()
        }
    }, [campanhaId])

    const fetchData = async () => {
        setLoading(true)
        try {
            // 1. Fetch metadata
            const { data: campData, error: campErr } = await supabase
                .from("campanhas_mensais")
                .select("*")
                .eq("id", campanhaId)
                .single()

            if (campErr) throw campErr
            setCampanha(campData)

            // 2. Fetch all child elements
            const { data: actData, error: actErr } = await supabase
                .from("atividades_mensais")
                .select("*")
                .eq("campanha_id", campanhaId)
                .order("categoria", { ascending: true })
                .order("data_atividade", { ascending: true })
                .order("titulo", { ascending: true })

            if (actErr) throw actErr

            setAtividades(actData || [])

            // Extract distinct categories from rows for filtering headers
            if (actData) {
                const distinctTags = Array.from(new Set(actData.map(a => a.categoria || "Diversos")))
                setCategoriasUnicas(distinctTags as string[])
            }

        } catch (error: any) {
            console.error(error)
            toast.error("Erro ao carregar os dados desta planilha.")
        } finally {
            setLoading(false)
        }
    }

    const handleDispararWhatsApp = async () => {
        if (!campanha) return

        setIsDisparando(true)
        try {
            const res = await fetch("/api/disparos/mensal", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ campanhaId: campanha.id })
            })

            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error || "Falha na API de envio")
            }

            toast.success("Disparo criado com sucesso e enviado para fila da UAZAPI!")
        } catch (error: any) {
            toast.error("Erro no disparo: " + error.message)
        } finally {
            setIsDisparando(false)
        }
    }

    // Faceted filtering client-side
    const filteredAtividades = atividades.filter(act => {
        const matchesSearch = String(act.titulo).toLowerCase().includes(searchTerm.toLowerCase()) ||
            String(act.descricao || "").toLowerCase().includes(searchTerm.toLowerCase())
        const matchesCategoria = categoriaFilter === "all" || act.categoria === categoriaFilter
        return matchesSearch && matchesCategoria
    })

    if (loading) {
        return (
            <div className="flex-1 flex flex-col p-8 space-y-6 animate-pulse">
                <div className="h-8 bg-slate-200 w-1/4 rounded"></div>
                <div className="h-64 bg-slate-200 w-full rounded-2xl"></div>
            </div>
        )
    }

    if (!campanha) {
        return (
            <div className="p-8 text-center text-muted-foreground w-full">
                Campanha não encontrada ou deletada pelo novo upload.
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col gap-6 p-4 lg:p-8 animate-in fade-in zoom-in duration-300">
            {/* Header com botões */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl shadow-sm border border-slate-100">
                <div className="flex gap-4">
                    <Button variant="ghost" size="icon" onClick={() => router.push("/programacao")} className="mt-1">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <div className="flex items-center gap-3">
                            <h1 className="text-2xl font-bold tracking-tight text-cuca-dark">{campanha.titulo}</h1>
                            {campanha.status === "aprovado" && (
                                <Badge className="bg-green-100 text-green-800 border-green-200">Em Vigência</Badge>
                            )}
                        </div>
                        <p className="text-muted-foreground text-sm flex items-center gap-2 mt-1">
                            <MapPin className="h-3.5 w-3.5" /> CUCA {campanha.unidade_cuca}
                            <span className="text-slate-300">|</span>
                            {campanha.total_atividades} Itens catalogados
                        </p>
                    </div>
                </div>

                <Button
                    className="bg-green-600 hover:bg-green-700 font-bold"
                    onClick={handleDispararWhatsApp}
                    disabled={isDisparando}
                >
                    {isDisparando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    Aprovar Campanha e Disparar WhatsApp
                </Button>
            </div>

            {/* View do Data Table (React-like structure natively implemented via component) */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 flex-1 flex flex-col overflow-hidden">
                <div className="p-4 border-b bg-slate-50/50 flex flex-col sm:flex-row justify-between items-center gap-4">
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Filtrar nesta planilha..."
                                className="pl-9 w-64 bg-white"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <div className="flex p-1 bg-slate-100 rounded-lg">
                            <Button
                                variant={categoriaFilter === "all" ? "secondary" : "ghost"}
                                size="sm"
                                className="h-8 text-xs"
                                onClick={() => setCategoriaFilter("all")}
                            >
                                Todas as Abas
                            </Button>
                            {categoriasUnicas.map(cat => (
                                <Button
                                    key={cat}
                                    variant={categoriaFilter === cat ? "secondary" : "ghost"}
                                    size="sm"
                                    className="h-8 text-xs"
                                    onClick={() => setCategoriaFilter(cat)}
                                >
                                    {cat || "Geral"}
                                </Button>
                            ))}
                        </div>
                    </div>

                    <div className="text-sm text-slate-500 flex items-center gap-2">
                        <FileText className="h-4 w-4 text-cuca-blue" />
                        Exibindo {filteredAtividades.length} atividades processadas da planilha.
                    </div>
                </div>

                <div className="overflow-auto max-h-[600px] flex-1 p-4 bg-slate-50/50">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                        {filteredAtividades.map((act) => {
                            const meta = act.metadata || {}
                            return (
                                <div key={act.id} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 hover:border-cuca-blue/50 hover:shadow-md transition-all flex flex-col justify-between">
                                    {/* Card Header */}
                                    <div className="flex justify-between items-start mb-3 gap-2">
                                        <div className="font-semibold text-cuca-blue text-sm line-clamp-2 leading-tight">
                                            {act.titulo}
                                        </div>
                                        {categoriaFilter === "all" && (
                                            <Badge variant="outline" className="text-[10px] uppercase bg-slate-50 whitespace-nowrap">
                                                {act.categoria}
                                            </Badge>
                                        )}
                                    </div>

                                    {/* Card Body by Category */}
                                    <div className="flex-1 text-sm text-slate-600 space-y-2 mb-4">
                                        {categoriaFilter === "CURSOS" ? (
                                            <>
                                                <div className="text-xs line-clamp-2" title={meta.ementa}>
                                                    <span className="font-semibold text-slate-700">Ementa:</span> {meta.ementa || "-"}
                                                </div>
                                                <div className="grid grid-cols-2 gap-2 mt-2">
                                                    <div><span className="font-semibold text-slate-700">Educador:</span> {meta.educador || "-"}</div>
                                                    <div><span className="font-semibold text-slate-700">Vagas:</span> {meta.vagas || "-"}</div>
                                                    <div><span className="font-semibold text-slate-700">Carga:</span> {meta.carga_horaria || "-"}h</div>
                                                </div>
                                                <div className="text-[10px] text-orange-600 bg-orange-50 p-1.5 rounded mt-2 line-clamp-1">
                                                    Req: {meta.requisitos || "Nenhum"}
                                                </div>
                                            </>
                                        ) : categoriaFilter === "ESPORTES" ? (
                                            <>
                                                <div className="grid grid-cols-2 gap-y-2 gap-x-1 text-xs">
                                                    <div><span className="font-semibold text-slate-700">Prof:</span> <span className="line-clamp-1">{meta.professor || "-"}</span></div>
                                                    <div><span className="font-semibold text-slate-700">Turma:</span> {meta.turma || "-"}</div>
                                                    <div><span className="font-semibold text-slate-700">Vagas:</span> {meta.vagas || "-"}</div>
                                                    <div><Badge variant="secondary" className="text-[10px] truncate max-w-full">{meta.sexo || "Misto"}</Badge></div>
                                                </div>
                                                <div className="text-xs mt-2"><span className="font-semibold text-slate-700">Idade:</span> {meta.faixa_etaria || "-"}</div>
                                            </>
                                        ) : (categoriaFilter === "DIA A DIA" || categoriaFilter === "ESPECIAIS") ? (
                                            <>
                                                <div className="font-medium text-slate-700 mb-1 leading-tight line-clamp-2">{meta.atividade || ""}</div>
                                                <div className="text-xs text-slate-500 line-clamp-2" title={meta.informacoes}>
                                                    {meta.informacoes || "-"}
                                                </div>
                                                <div className="mt-2 text-xs">
                                                    <Badge className="bg-blue-100/50 text-blue-800 hover:bg-blue-200 border-none font-medium">
                                                        Sessão: {meta.sessao || "-"}
                                                    </Badge>
                                                </div>
                                            </>
                                        ) : (
                                            <div className="text-xs line-clamp-4">
                                                {act.descricao}
                                            </div>
                                        )}
                                    </div>

                                    {/* Card Footer */}
                                    <div className="pt-3 border-t border-slate-100 flex flex-col gap-1.5 text-xs text-slate-500">
                                        <div className="flex justify-between items-center w-full">
                                            <div className="flex items-center gap-1.5 font-medium text-slate-700 truncate">
                                                <Calendar className="h-3.5 w-3.5 shrink-0" />
                                                <span className="truncate">
                                                    {categoriaFilter === "CURSOS" ? meta.periodo || "--/--" :
                                                        categoriaFilter === "ESPORTES" ? meta.dias_semana || "--/--" :
                                                            (categoriaFilter === "DIA A DIA" || categoriaFilter === "ESPECIAIS") ? `${meta.data_real || "--/--"} (${meta.dia_semana?.substring(0, 3) || ""})` :
                                                                act.data_atividade ? format(new Date(act.data_atividade), "dd/MMM", { locale: ptBR }) : "--/--"}
                                                </span>
                                            </div>

                                            <div className="flex items-center justify-end gap-1.5 font-medium text-slate-600 shrink-0 w-1/3">
                                                <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                                                <span className="truncate" title={act.local || meta.local}>{act.local || meta.local || "Não inf."}</span>
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-1.5 font-semibold text-orange-600">
                                            <Clock className="h-3.5 w-3.5 shrink-0" />
                                            {categoriaFilter === "CURSOS" || categoriaFilter === "ESPORTES"
                                                ? meta.horario || "??"
                                                : (act.hora_inicio || act.hora_fim)
                                                    ? `${act.hora_inicio?.substring(0, 5) || "??"} às ${act.hora_fim?.substring(0, 5) || "??"}`
                                                    : "Horário Integral"}
                                        </div>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                    {filteredAtividades.length === 0 && (
                        <div className="py-24 text-center text-slate-500 flex flex-col items-center">
                            <FileText className="h-12 w-12 text-slate-300 mb-4" />
                            <p className="font-semibold text-lg text-slate-600">Nenhuma atividade localizada</p>
                            <p className="text-sm mt-1">com os filtros atuais ou nesta aba ({categoriaFilter === "all" ? "Geral" : categoriaFilter}).</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
} 
