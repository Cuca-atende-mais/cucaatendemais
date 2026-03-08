"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { CampanhaMensal } from "@/lib/types/database"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ArrowLeft, Calendar, CheckCircle2, Clock, MapPin, Search, FileText, Loader2, ThumbsUp } from "lucide-react"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import toast from "react-hot-toast"
import { cn } from "@/lib/utils"

export default function CampanhaMensalPage() {
    const params = useParams()
    const router = useRouter()
    const campanhaId = params.id as string

    const [campanha, setCampanha] = useState<CampanhaMensal | null>(null)
    const [atividades, setAtividades] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [isAprovando, setIsAprovando] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const [categoriaFilter, setCategoriaFilter] = useState("all")
    const [categoriasUnicas, setCategoriasUnicas] = useState<string[]>([])

    const supabase = createClient()

    useEffect(() => {
        if (campanhaId) fetchData()
    }, [campanhaId])

    const fetchData = async () => {
        setLoading(true)
        try {
            const { data: campData, error: campErr } = await supabase
                .from("campanhas_mensais").select("*").eq("id", campanhaId).single()
            if (campErr) throw campErr
            setCampanha(campData)

            const { data: actData, error: actErr } = await supabase
                .from("atividades_mensais").select("*").eq("campanha_id", campanhaId)
                .order("categoria", { ascending: true })
                .order("data_atividade", { ascending: true })
                .order("titulo", { ascending: true })
            if (actErr) throw actErr

            setAtividades(actData || [])
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

    // S9-00: Aprovação sem disparo automático
    const handleAprovarProgramacao = async () => {
        if (!campanha || campanha.status === "aprovado") return
        setIsAprovando(true)
        try {
            // Refresh session to avoid stale JWT 403 errors
            await supabase.auth.refreshSession()
            const { error } = await supabase
                .from("campanhas_mensais").update({ status: "aprovado" }).eq("id", campanha.id)
            if (error) throw error
            setCampanha({ ...campanha, status: "aprovado" })
            toast.success("Programação aprovada! O Gestor Geral poderá disparar o aviso para toda a Rede.")
        } catch (error: any) {
            toast.error("Erro ao aprovar: " + error.message)
        } finally {
            setIsAprovando(false)
        }
    }

    const filteredAtividades = atividades.filter(act => {
        const matchesSearch = String(act.titulo).toLowerCase().includes(searchTerm.toLowerCase()) ||
            String(act.descricao || "").toLowerCase().includes(searchTerm.toLowerCase())
        const matchesCategoria = categoriaFilter === "all" || act.categoria === categoriaFilter
        return matchesSearch && matchesCategoria
    })

    if (loading) {
        return (
            <div className="p-6 space-y-4">
                <Skeleton className="h-24 w-full rounded-2xl" />
                <Skeleton className="h-[500px] w-full rounded-2xl" />
            </div>
        )
    }

    if (!campanha) {
        return (
            <div className="p-8 text-center text-muted-foreground">
                Campanha não encontrada ou deletada pelo novo upload.
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col gap-5 p-4 lg:p-6 animate-fade-in-up">
            {/* ── Header ── */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-card p-5 rounded-2xl border border-border">
                <div className="flex gap-3 items-start">
                    <Button variant="ghost" size="icon" onClick={() => router.push("/programacao")} className="mt-0.5 shrink-0">
                        <ArrowLeft className="h-5 w-5" />
                    </Button>
                    <div>
                        <div className="flex items-center gap-2.5 flex-wrap">
                            <h1 className="text-xl font-bold tracking-tight">{campanha.titulo}</h1>
                            {campanha.status === "aprovado" && (
                                <Badge variant="outline" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-xs font-semibold">
                                    <CheckCircle2 className="h-3 w-3 mr-1" /> Em Vigência
                                </Badge>
                            )}
                        </div>
                        <p className="text-muted-foreground text-sm flex items-center gap-2 mt-1">
                            <MapPin className="h-3.5 w-3.5" />
                            CUCA {campanha.unidade_cuca}
                            <span className="text-border">|</span>
                            {campanha.total_atividades} itens catalogados
                        </p>
                    </div>
                </div>

                {campanha.status === "aprovado" ? (
                    <Badge variant="outline" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 px-4 py-2 text-sm font-semibold shrink-0">
                        <CheckCircle2 className="h-4 w-4 mr-2" /> Programação Aprovada
                    </Badge>
                ) : (
                    <Button
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shrink-0"
                        onClick={handleAprovarProgramacao}
                        disabled={isAprovando}
                    >
                        {isAprovando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ThumbsUp className="mr-2 h-4 w-4" />}
                        Aprovar Programação
                    </Button>
                )}
            </div>

            {/* ── Filtros + Grid ── */}
            <div className="bg-card rounded-2xl border border-border flex-1 flex flex-col overflow-hidden">
                {/* Barra de filtros */}
                <div className="p-4 border-b border-border flex flex-col sm:flex-row justify-between items-center gap-3">
                    <div className="flex items-center gap-3 w-full sm:w-auto">
                        <div className="relative flex-1 sm:w-64">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                            <Input
                                placeholder="Filtrar nesta planilha..."
                                className="pl-9 text-sm"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <div className="overflow-x-auto flex-1 min-w-0">
                            <div className="flex bg-muted p-1 rounded-lg flex-nowrap min-w-max gap-0.5">
                                <button
                                    onClick={() => setCategoriaFilter("all")}
                                    className={cn(
                                        "px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors",
                                        categoriaFilter === "all"
                                            ? "bg-popover text-foreground shadow-sm"
                                            : "text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    Todas as Abas
                                </button>
                                {categoriasUnicas.map(cat => (
                                    <button
                                        key={cat}
                                        onClick={() => setCategoriaFilter(cat)}
                                        className={cn(
                                            "px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors",
                                            categoriaFilter === cat
                                                ? "bg-popover text-foreground shadow-sm"
                                                : "text-muted-foreground hover:text-foreground"
                                        )}
                                    >
                                        {cat || "Geral"}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="text-xs text-muted-foreground flex items-center gap-1.5 shrink-0">
                        <FileText className="h-3.5 w-3.5 text-primary" />
                        {filteredAtividades.length} atividades
                    </div>
                </div>

                {/* Grid de cards */}
                <div className="overflow-auto flex-1 p-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {filteredAtividades.map((act) => {
                            const meta = act.metadata || {}
                            return (
                                <div
                                    key={act.id}
                                    className="bg-background rounded-xl border border-border p-4 hover:border-primary/40 hover:shadow-md hover:shadow-black/10 transition-all flex flex-col justify-between group"
                                >
                                    {/* Card Header */}
                                    <div className="flex justify-between items-start mb-3 gap-2">
                                        <p className="font-semibold text-sm text-foreground line-clamp-2 leading-snug group-hover:text-primary transition-colors">
                                            {act.titulo}
                                        </p>
                                        {categoriaFilter === "all" && (
                                            <Badge variant="outline" className="text-[10px] uppercase whitespace-nowrap shrink-0 font-medium">
                                                {act.categoria}
                                            </Badge>
                                        )}
                                    </div>

                                    {/* Card Body */}
                                    <div className="flex-1 text-xs text-muted-foreground space-y-2 mb-3">
                                        {categoriaFilter === "CURSOS" ? (
                                            <>
                                                <p className="line-clamp-2 text-foreground/80" title={meta.ementa}>
                                                    {meta.ementa || "—"}
                                                </p>
                                                <div className="grid grid-cols-2 gap-1.5 mt-1.5">
                                                    <div><span className="font-medium text-foreground/70">Educador:</span> {meta.educador || "—"}</div>
                                                    <div><span className="font-medium text-foreground/70">Vagas:</span> {meta.vagas || "—"}</div>
                                                    <div><span className="font-medium text-foreground/70">Carga:</span> {meta.carga_horaria || "—"}h</div>
                                                </div>
                                                {meta.requisitos && (
                                                    <div className="text-[10px] bg-orange-500/10 text-orange-400 p-1.5 rounded-md mt-1.5 line-clamp-1">
                                                        Req: {meta.requisitos}
                                                    </div>
                                                )}
                                            </>
                                        ) : categoriaFilter === "ESPORTES" ? (
                                            <div className="grid grid-cols-2 gap-y-1.5 gap-x-1">
                                                <div><span className="font-medium text-foreground/70">Prof:</span> <span className="line-clamp-1">{meta.professor || "—"}</span></div>
                                                <div><span className="font-medium text-foreground/70">Turma:</span> {meta.turma || "—"}</div>
                                                <div><span className="font-medium text-foreground/70">Vagas:</span> {meta.vagas || "—"}</div>
                                                <div>{meta.sexo && <Badge variant="secondary" className="text-[10px]">{meta.sexo}</Badge>}</div>
                                                <div className="col-span-2"><span className="font-medium text-foreground/70">Idade:</span> {meta.faixa_etaria || "—"}</div>
                                            </div>
                                        ) : (categoriaFilter === "DIA A DIA" || categoriaFilter === "ESPECIAIS") ? (
                                            <>
                                                <p className="font-medium text-foreground/80 leading-snug line-clamp-2">{meta.atividade || ""}</p>
                                                <p className="line-clamp-2 text-muted-foreground" title={meta.informacoes}>{meta.informacoes || "—"}</p>
                                                {meta.sessao && (
                                                    <Badge variant="outline" className="bg-blue-500/10 text-blue-400 border-blue-500/25 text-[10px] font-medium mt-1">
                                                        Sessão: {meta.sessao}
                                                    </Badge>
                                                )}
                                            </>
                                        ) : (
                                            <p className="line-clamp-4">{act.descricao}</p>
                                        )}
                                    </div>

                                    {/* Card Footer */}
                                    <div className="pt-3 border-t border-border/60 flex flex-col gap-1.5 text-xs">
                                        <div className="flex justify-between items-center">
                                            <div className="flex items-center gap-1.5 text-muted-foreground">
                                                <Calendar className="h-3.5 w-3.5 shrink-0" />
                                                <span className="truncate font-medium">
                                                    {categoriaFilter === "CURSOS" ? meta.periodo || "—" :
                                                        categoriaFilter === "ESPORTES" ? meta.dias_semana || "—" :
                                                            (categoriaFilter === "DIA A DIA" || categoriaFilter === "ESPECIAIS") ? `${meta.data_real || "—"} (${meta.dia_semana?.substring(0, 3) || ""})` :
                                                                act.data_atividade ? format(new Date(act.data_atividade), "dd/MMM", { locale: ptBR }) : "—"}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1 text-muted-foreground shrink-0">
                                                <MapPin className="h-3 w-3 shrink-0" />
                                                <span className="truncate max-w-[80px]" title={act.local || meta.local}>{act.local || meta.local || "Não inf."}</span>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1.5 text-orange-400 font-semibold">
                                            <Clock className="h-3.5 w-3.5 shrink-0" />
                                            {categoriaFilter === "CURSOS" || categoriaFilter === "ESPORTES"
                                                ? meta.horario || "—"
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
                        <div className="py-24 text-center flex flex-col items-center gap-3">
                            <div className="h-16 w-16 rounded-2xl bg-muted flex items-center justify-center">
                                <FileText className="h-7 w-7 text-muted-foreground/50" />
                            </div>
                            <p className="font-semibold text-foreground">Nenhuma atividade localizada</p>
                            <p className="text-sm text-muted-foreground">Ajuste os filtros ou busque por outro termo.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}
