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

                <div className="overflow-auto max-h-[600px] flex-1">
                    <Table>
                        <TableHeader className="bg-slate-50 sticky top-0 z-10 shadow-sm">
                            {categoriaFilter === "CURSOS" ? (
                                <TableRow>
                                    <TableHead className="max-w-[200px]">Curso</TableHead>
                                    <TableHead className="min-w-[200px]">Ementa e Requisitos</TableHead>
                                    <TableHead>Educador</TableHead>
                                    <TableHead>CH / Vagas</TableHead>
                                    <TableHead>Período e Horário</TableHead>
                                </TableRow>
                            ) : categoriaFilter === "ESPORTES" ? (
                                <TableRow>
                                    <TableHead className="max-w-[200px]">Esporte / Modalidade</TableHead>
                                    <TableHead>Professor(a)</TableHead>
                                    <TableHead>Turma / Vagas</TableHead>
                                    <TableHead className="min-w-[150px]">Público Alvo</TableHead>
                                    <TableHead>Dias e Horários</TableHead>
                                </TableRow>
                            ) : (categoriaFilter === "DIA A DIA" || categoriaFilter === "ESPECIAIS") ? (
                                <TableRow>
                                    <TableHead className="max-w-[200px]">Programa / Atividade</TableHead>
                                    <TableHead>Data e Dia</TableHead>
                                    <TableHead>Horário</TableHead>
                                    <TableHead>Local</TableHead>
                                    <TableHead className="min-w-[200px]">Sessão e Infos</TableHead>
                                </TableRow>
                            ) : (
                                <TableRow>
                                    <TableHead className="w-[150px]">Categoria (Aba)</TableHead>
                                    <TableHead className="w-[120px]">Data Geral</TableHead>
                                    <TableHead className="max-w-[200px]">Atividade / Título</TableHead>
                                    <TableHead className="min-w-[300px]">Descrição Completa</TableHead>
                                    <TableHead className="w-[100px]">Horário</TableHead>
                                    <TableHead>Local</TableHead>
                                </TableRow>
                            )}
                        </TableHeader>
                        <TableBody>
                            {filteredAtividades.map((act) => {
                                const meta = act.metadata || {}
                                return (
                                    <TableRow key={act.id} className="hover:bg-blue-50/30">
                                        {categoriaFilter === "CURSOS" ? (
                                            <>
                                                <TableCell><div className="font-semibold text-cuca-blue text-sm line-clamp-2">{act.titulo}</div></TableCell>
                                                <TableCell>
                                                    <div className="text-xs text-slate-600 line-clamp-2" title={meta.ementa}>{meta.ementa || "-"}</div>
                                                    <div className="text-[10px] text-orange-600 mt-1">Req: {meta.requisitos || "-"}</div>
                                                </TableCell>
                                                <TableCell className="text-sm font-medium">{meta.educador || "-"}</TableCell>
                                                <TableCell className="text-xs text-slate-600">
                                                    <div>CH: <span className="font-semibold">{meta.carga_horaria || "-"}h</span></div>
                                                    <div>Vagas: <span className="font-semibold">{meta.vagas || "-"}</span></div>
                                                </TableCell>
                                                <TableCell className="text-xs text-slate-600">
                                                    <div className="flex items-center gap-1 mb-1"><Calendar className="h-3 w-3" /> {meta.periodo || "-"}</div>
                                                    <div className="flex items-center gap-1"><Clock className="h-3 w-3" /> {meta.horario || "-"}</div>
                                                </TableCell>
                                            </>
                                        ) : categoriaFilter === "ESPORTES" ? (
                                            <>
                                                <TableCell><div className="font-semibold text-cuca-blue text-sm line-clamp-2">{act.titulo}</div></TableCell>
                                                <TableCell className="text-sm font-medium">{meta.professor || "-"}</TableCell>
                                                <TableCell className="text-xs text-slate-600">
                                                    <div>Turma: <span className="font-semibold">{meta.turma || "-"}</span></div>
                                                    <div>Vagas: <span className="font-semibold">{meta.vagas || "-"}</span></div>
                                                </TableCell>
                                                <TableCell className="text-xs">
                                                    <Badge variant="secondary" className="mb-1">{meta.sexo || "Misto"}</Badge>
                                                    <div className="text-slate-500 mt-1">Idade: {meta.faixa_etaria || "-"}</div>
                                                </TableCell>
                                                <TableCell className="text-xs text-slate-600">
                                                    <div className="flex items-center gap-1 mb-1"><Calendar className="h-3 w-3" /> {meta.dias_semana || "-"}</div>
                                                    <div className="flex items-center gap-1"><Clock className="h-3 w-3" /> {meta.horario || "-"}</div>
                                                </TableCell>
                                            </>
                                        ) : (categoriaFilter === "DIA A DIA" || categoriaFilter === "ESPECIAIS") ? (
                                            <>
                                                <TableCell>
                                                    <div className="font-semibold text-cuca-blue text-sm">{act.titulo}</div>
                                                    <div className="text-xs text-slate-500 font-medium line-clamp-2 mt-1">{meta.atividade || ""}</div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="flex items-center gap-1.5 text-slate-600 text-sm font-medium">
                                                        <Calendar className="h-3.5 w-3.5" />
                                                        {meta.data_real || "--/--"}
                                                    </div>
                                                    <div className="text-xs text-slate-400 mt-0.5">{meta.dia_semana || ""}</div>
                                                </TableCell>
                                                <TableCell className="text-slate-600 whitespace-nowrap">
                                                    <div className="flex items-center gap-1 text-xs font-semibold">
                                                        <Clock className="h-3 w-3 text-orange-500" />
                                                        <span>{meta.hora_inicio || "??"} às {meta.hora_fim || "??"}</span>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-xs text-slate-600 font-medium bg-slate-50/50">
                                                    {act.local}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-200 mb-1">{meta.sessao || "-"}</Badge>
                                                    <div className="text-xs text-slate-500 line-clamp-2" title={meta.informacoes}>{meta.informacoes || "-"}</div>
                                                </TableCell>
                                            </>
                                        ) : (
                                            <>
                                                <TableCell>
                                                    <Badge variant="outline" className="font-semibold text-slate-700 bg-white">
                                                        {act.categoria || "N/A"}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="font-medium whitespace-nowrap">
                                                    <div className="flex items-center gap-1.5 text-slate-600">
                                                        <Calendar className="h-3.5 w-3.5" />
                                                        {act.data_atividade ? format(new Date(act.data_atividade), "dd/MMM", { locale: ptBR }) : "--/--"}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="font-semibold text-cuca-blue text-sm line-clamp-2">
                                                        {act.titulo}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <div className="text-xs text-slate-600 line-clamp-3" title={act.descricao}>
                                                        {act.descricao}
                                                    </div>
                                                </TableCell>
                                                <TableCell className="text-slate-600 whitespace-nowrap">
                                                    {(act.hora_inicio || act.hora_fim) ? (
                                                        <div className="flex items-center gap-1 text-xs">
                                                            <Clock className="h-3 w-3" />
                                                            <span>
                                                                {act.hora_inicio?.substring(0, 5) || "??:??"} às {act.hora_fim?.substring(0, 5) || "??:??"}
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <span className="text-xs text-slate-400">Integral</span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-xs text-slate-600">
                                                    {act.local}
                                                </TableCell>
                                            </>
                                        )}
                                    </TableRow>
                                )
                            })}
                            {filteredAtividades.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={6} className="h-32 text-center text-slate-500">
                                        Nenhuma atividade condizente com os filtros atuais ou nesta aba ({categoriaFilter === "all" ? "Geral" : categoriaFilter}).
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </div>
        </div>
    )
} 
