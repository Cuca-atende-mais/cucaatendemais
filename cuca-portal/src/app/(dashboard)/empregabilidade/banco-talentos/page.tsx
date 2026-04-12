"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { TalentBank } from "@/lib/types/database"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog"
import {
    Search, FileText, BrainCircuit, User, Phone, Plus, X,
    ShoppingCart, Building2, Truck, Wrench, UtensilsCrossed,
    Palette, HardHat, Cpu, HelpCircle, Star, Clock, GraduationCap,
    CheckCircle, AlertCircle, ExternalLink, MessageCircle, Scissors, Heart, Trash2,
    ChevronLeft, ChevronRight, Filter, PenLine,
} from "lucide-react"
import { useUser } from "@/lib/auth/user-provider"
import { Label } from "@/components/ui/label"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { differenceInYears, format } from "date-fns"
import { ptBR } from "date-fns/locale"
import toast from "react-hot-toast"
import { NIVEIS_ESCOLARIDADE } from "@/constants/empregabilidade"
import { useRouter } from "next/navigation"

// ─── Configuração de áreas ────────────────────────────────────────────────────

type AreaConfig = {
    label: string
    key: string | null   // null = sem área definida
    icon: React.ReactNode
    color: string        // tailwind color key (bg/text/border)
    bgClass: string
    textClass: string
    borderClass: string
}

const AREAS: AreaConfig[] = [
    {
        label: "Comércio e Vendas",
        key: "Comércio e Vendas (vendedor, caixa, atendimento)",
        icon: <ShoppingCart className="h-5 w-5" />,
        color: "blue",
        bgClass: "bg-blue-500/15",
        textClass: "text-blue-400",
        borderClass: "border-blue-500/30",
    },
    {
        label: "Administrativo",
        key: "Administrativo / Escritório (recepção, auxiliar administrativo)",
        icon: <Building2 className="h-5 w-5" />,
        color: "violet",
        bgClass: "bg-violet-500/15",
        textClass: "text-violet-400",
        borderClass: "border-violet-500/30",
    },
    {
        label: "Logística",
        key: "Logística e Entregas (estoque, separação, entregador, motorista)",
        icon: <Truck className="h-5 w-5" />,
        color: "orange",
        bgClass: "bg-orange-500/15",
        textClass: "text-orange-400",
        borderClass: "border-orange-500/30",
    },
    {
        label: "Serviços Gerais",
        key: "Serviços Gerais (limpeza, portaria, zeladoria)",
        icon: <Wrench className="h-5 w-5" />,
        color: "slate",
        bgClass: "bg-slate-500/15",
        textClass: "text-slate-400",
        borderClass: "border-slate-500/30",
    },
    {
        label: "Alimentação",
        key: "Alimentação (cozinha, garçom, lanchonete)",
        icon: <UtensilsCrossed className="h-5 w-5" />,
        color: "amber",
        bgClass: "bg-amber-500/15",
        textClass: "text-amber-400",
        borderClass: "border-amber-500/30",
    },
    {
        label: "Criativo / Digital",
        key: "Criativo / Digital (design, vídeo, redes sociais)",
        icon: <Palette className="h-5 w-5" />,
        color: "pink",
        bgClass: "bg-pink-500/15",
        textClass: "text-pink-400",
        borderClass: "border-pink-500/30",
    },
    {
        label: "Construção Civil",
        key: "Construção Civil (pedreiro, ajudante, eletricista, encanador)",
        icon: <HardHat className="h-5 w-5" />,
        color: "yellow",
        bgClass: "bg-yellow-500/15",
        textClass: "text-yellow-400",
        borderClass: "border-yellow-500/30",
    },
    {
        label: "Tecnologia",
        key: "Tecnologia (suporte técnico, programação, dados)",
        icon: <Cpu className="h-5 w-5" />,
        color: "cyan",
        bgClass: "bg-cyan-500/15",
        textClass: "text-cyan-400",
        borderClass: "border-cyan-500/30",
    },
    {
        label: "Beleza e Estética",
        key: "Beleza e Estética (barbeiro, manicure, cabeleireiro)",
        icon: <Scissors className="h-5 w-5" />,
        color: "rose",
        bgClass: "bg-rose-500/15",
        textClass: "text-rose-400",
        borderClass: "border-rose-500/30",
    },
    {
        label: "Cuidados Pessoais",
        key: "Cuidados Pessoais (babá, cuidador de idosos)",
        icon: <Heart className="h-5 w-5" />,
        color: "emerald",
        bgClass: "bg-emerald-500/15",
        textClass: "text-emerald-400",
        borderClass: "border-emerald-500/30",
    },
    {
        label: "Sem área definida",
        key: null,
        icon: <HelpCircle className="h-5 w-5" />,
        color: "zinc",
        bgClass: "bg-zinc-500/15",
        textClass: "text-zinc-400",
        borderClass: "border-zinc-500/30",
    },
]

function getAreaConfig(areaInteresse: string[] | null | undefined): AreaConfig {
    if (!areaInteresse || areaInteresse.length === 0) {
        return AREAS.find(a => a.key === null)!
    }
    const found = AREAS.find(a => a.key && areaInteresse.includes(a.key))
    return found ?? AREAS.find(a => a.key === null)!
}

// ─── Componente principal ─────────────────────────────────────────────────────

const PAGE_SIZE = 25

export default function BancoTalentosPage() {
    const [talentos, setTalentos] = useState<TalentBank[]>([])
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState("")
    const [debouncedSearch, setDebouncedSearch] = useState("")
    const [filtroStatus, setFiltroStatus] = useState("todos")
    const [filtroArea, setFiltroArea] = useState<string | null | undefined>(undefined)
    // S37B-04: novos filtros demográficos
    const [filtroEscolaridade, setFiltroEscolaridade] = useState("")
    const [filtroGenero, setFiltroGenero] = useState("")
    const [filtroPCD, setFiltroPCD] = useState<"" | "true" | "false">("")
    const [filtroPrimeiroEmprego, setFiltroPrimeiroEmprego] = useState<"" | "true" | "false">("")
    const [filtroBairro, setFiltroBairro] = useState("")
    // S37B-05: paginação server-side
    const [page, setPage] = useState(0)
    const [totalCount, setTotalCount] = useState(0)
    const [totalGeral, setTotalGeral] = useState(0)
    const [totalDisponiveis, setTotalDisponiveis] = useState(0)

    const [contagemPorArea, setContagemPorArea] = useState<Map<string | null, number>>(new Map())
    const [selectedTalento, setSelectedTalento] = useState<TalentBank | null>(null)
    const [cadastroOpen, setCadastroOpen] = useState(false)
    const [formNome, setFormNome] = useState("")
    const [formTelefone, setFormTelefone] = useState("")
    const [formNasc, setFormNasc] = useState("")
    const [formArea, setFormArea] = useState("")
    const [formArquivo, setFormArquivo] = useState<File | null>(null)
    const [savingCadastro, setSavingCadastro] = useState(false)
    const [deletandoId, setDeletandoId] = useState<string | null>(null)

    const AREAS_INTERESSE = AREAS.filter(a => a.key !== null).map(a => a.key as string)

    const supabase = createClient()
    const { isDeveloper, profile } = useUser()
    const podeExcluir = isDeveloper || profile?.funcao?.nome === "Super Admin Cuca"

    // Debounce de texto de busca
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(searchTerm), 400)
        return () => clearTimeout(timer)
    }, [searchTerm])

    // Reset de página ao mudar qualquer filtro
    useEffect(() => { setPage(0) }, [debouncedSearch, filtroStatus, filtroArea, filtroEscolaridade, filtroGenero, filtroPCD, filtroPrimeiroEmprego, filtroBairro])

    // Métricas gerais + contagem por área (carregadas uma vez no mount)
    useEffect(() => {
        const fetchMetrics = async () => {
            const [{ count: total }, { count: disp }, { data: areaRows }] = await Promise.all([
                supabase.from("talent_bank").select("id", { count: "exact", head: true }),
                supabase.from("talent_bank").select("id", { count: "exact", head: true }).eq("status", "disponivel"),
                // Busca apenas area_interesse para montar contagens por card
                supabase.from("talent_bank").select("area_interesse"),
            ])
            setTotalGeral(total ?? 0)
            setTotalDisponiveis(disp ?? 0)

            // Computa contagem por área localmente a partir dos dados brutos
            const map = new Map<string | null, number>()
            for (const row of (areaRows || [])) {
                const areas = row.area_interesse as string[] | null
                const cfg = getAreaConfig(areas)
                map.set(cfg.key, (map.get(cfg.key) ?? 0) + 1)
            }
            setContagemPorArea(map)
        }
        fetchMetrics()
    }, [])

    const fetchTalentos = useCallback(async () => {
        setLoading(true)
        let query = supabase
            .from("talent_bank")
            .select("*", { count: "exact" })
            .order("created_at", { ascending: false })

        if (debouncedSearch) {
            query = query.or(`nome.ilike.%${debouncedSearch}%,telefone.ilike.%${debouncedSearch}%`)
        }
        if (filtroStatus !== "todos") query = query.eq("status", filtroStatus)
        if (filtroArea !== undefined) {
            if (filtroArea === null) {
                query = query.is("area_interesse", null)
            } else {
                // Extrai o termo principal antes de " / " e "(" para suportar tanto
                // o texto longo ("Administrativo / Escritório (...)") quanto o curto
                // ("Administrativo") que podem estar salvos em registros de origens distintas.
                // O cast ::text converte o array para string permitindo o ilike.
                const termoPrincipal = filtroArea.split(" / ")[0].split("(")[0].trim()
                query = query.filter("area_interesse::text", "ilike", `%${termoPrincipal}%`)
            }
        }
        if (filtroEscolaridade) query = query.eq("escolaridade_normalizada", filtroEscolaridade)
        if (filtroGenero) query = query.eq("genero", filtroGenero)
        if (filtroPCD !== "") query = query.eq("pcd", filtroPCD === "true")
        if (filtroPrimeiroEmprego !== "") query = query.eq("primeiro_emprego", filtroPrimeiroEmprego === "true")
        if (filtroBairro) query = query.ilike("bairro", `%${filtroBairro}%`)

        const from = page * PAGE_SIZE
        const to = from + PAGE_SIZE - 1
        const { data, error, count } = await query.range(from, to)

        if (error) {
            console.error("Erro ao buscar talentos:", error)
            toast.error("Erro ao carregar banco de talentos")
        } else {
            setTalentos(data || [])
            setTotalCount(count ?? 0)
        }
        setLoading(false)
    }, [debouncedSearch, filtroStatus, filtroArea, filtroEscolaridade, filtroGenero, filtroPCD, filtroPrimeiroEmprego, filtroBairro, page])

    useEffect(() => { fetchTalentos() }, [fetchTalentos])

    const totalPages = Math.ceil(totalCount / PAGE_SIZE)

    const calcularIdade = (dataStr: string | null) => {
        if (!dataStr) return null
        return differenceInYears(new Date(), new Date(dataStr))
    }

    const handleCadastroManual = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!formNome.trim() || !formTelefone.trim()) {
            toast.error("Nome e telefone são obrigatórios.")
            return
        }
        setSavingCadastro(true)
        try {
            const fd = new FormData()
            fd.append("nome", formNome.trim())
            fd.append("telefone", formTelefone)
            if (formNasc) fd.append("data_nascimento", formNasc)
            if (formArea) fd.append("area_interesse", formArea)
            if (formArquivo) fd.append("arquivo", formArquivo)

            const res = await fetch("/api/empregabilidade/talent-bank/cadastrar", {
                method: "POST",
                body: fd,
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Erro ao cadastrar")

            toast.success("Candidato adicionado ao Banco de Talentos!")
            setCadastroOpen(false)
            setFormNome(""); setFormTelefone(""); setFormNasc(""); setFormArea(""); setFormArquivo(null)
            fetchTalentos()
        } catch (err: any) {
            toast.error(err.message || "Erro ao cadastrar.")
        } finally {
            setSavingCadastro(false)
        }
    }

    const handleDelete = async (id: string, nome: string) => {
        if (!confirm(`Confirma a exclusão de ${nome}? O PDF também será removido do bucket.`)) return
        setDeletandoId(id)
        try {
            const res = await fetch(`/api/empregabilidade/talent-bank/${id}`, { method: "DELETE" })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error || "Erro ao deletar")
            }
            setTalentos(prev => prev.filter(t => t.id !== id))
            toast.success(`${nome} removido do banco de talentos.`)
        } catch (err: any) {
            toast.error(err.message || "Erro ao deletar candidato.")
        } finally {
            setDeletandoId(null)
        }
    }

    const areaAtiva = filtroArea !== undefined
        ? AREAS.find(a => a.key === filtroArea)
        : null

    const temFiltrosDemograficos = filtroEscolaridade || filtroGenero || filtroPCD || filtroPrimeiroEmprego || filtroBairro

    return (
        <div className="space-y-6">
            {/* Cabeçalho */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Banco de Talentos</h1>
                    <p className="text-muted-foreground">
                        Repositório inteligente de candidatos para matching futuro.
                    </p>
                </div>
                <Button
                    className="bg-cuca-yellow hover:bg-yellow-500 font-bold"
                    onClick={() => setCadastroOpen(true)}
                >
                    <Plus className="mr-2 h-4 w-4" /> Cadastrar Manualmente
                </Button>
            </div>

            {/* Cards de métricas */}
            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total no Banco</CardTitle>
                        <User className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{totalGeral.toLocaleString("pt-BR")}</div>
                        <p className="text-xs text-muted-foreground">{totalCount.toLocaleString("pt-BR")} com filtros</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Disponíveis</CardTitle>
                        <BrainCircuit className="h-4 w-4 text-cuca-blue" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{totalDisponiveis.toLocaleString("pt-BR")}</div>
                        <p className="text-xs text-muted-foreground">Aguardando nova oportunidade</p>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Arquivados / Contratados</CardTitle>
                        <FileText className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {(totalGeral - totalDisponiveis).toLocaleString("pt-BR")}
                        </div>
                        <p className="text-xs text-muted-foreground">Não mais disponíveis</p>
                    </CardContent>
                </Card>
            </div>

            {/* ── Áreas de interesse ─────────────────────────────────────────── */}
            <div>
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                    Áreas de interesse — clique para filtrar
                </h2>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {AREAS.map((area) => {
                        const isActive = filtroArea !== undefined && filtroArea === area.key
                        const contagem = isActive ? totalCount : (contagemPorArea.get(area.key) ?? 0)
                        return (
                            <button
                                key={String(area.key)}
                                onClick={() => setFiltroArea(isActive ? undefined : area.key)}
                                className={[
                                    "flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all duration-150 hover:scale-[1.02] active:scale-[0.98]",
                                    area.bgClass,
                                    area.borderClass,
                                    isActive ? "ring-2 ring-offset-2 ring-offset-background " + area.textClass.replace("text-", "ring-") : "",
                                ].join(" ")}
                            >
                                <div className={["flex items-center justify-between w-full", area.textClass].join(" ")}>
                                    {area.icon}
                                    <span className="text-2xl font-bold tabular-nums">{contagem}</span>
                                </div>
                                <span className={["text-xs font-medium leading-tight", area.textClass].join(" ")}>
                                    {area.label}
                                </span>
                            </button>
                        )
                    })}
                    {/* Card "Todos" */}
                    <button
                        onClick={() => setFiltroArea(undefined)}
                        className={[
                            "flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all duration-150 hover:scale-[1.02] active:scale-[0.98]",
                            "bg-green-500/15 border-green-500/30",
                            filtroArea === undefined ? "ring-2 ring-offset-2 ring-offset-background ring-green-400" : "",
                        ].join(" ")}
                    >
                        <div className="flex items-center justify-between w-full text-green-400">
                            <Star className="h-5 w-5" />
                            <span className="text-2xl font-bold tabular-nums">{totalGeral}</span>
                        </div>
                        <span className="text-xs font-medium leading-tight text-green-400">Todos</span>
                    </button>
                </div>
            </div>

            {/* ── Lista de candidatos ────────────────────────────────────────── */}
            <Card>
                <CardHeader>
                    <div className="flex flex-col gap-4">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <div>
                                <CardTitle>
                                    {areaAtiva ? areaAtiva.label : "Todos os Talentos"}
                                </CardTitle>
                                <CardDescription>
                                    {totalCount.toLocaleString("pt-BR")} candidato(s) encontrado(s) — página {page + 1} de {Math.max(1, totalPages)}
                                </CardDescription>
                            </div>
                            <div className="flex gap-2 flex-wrap">
                                <div className="relative w-full md:w-72">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                                    <Input
                                        placeholder="Buscar nome, telefone..."
                                        className="pl-10 w-full"
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                    />
                                </div>
                                <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                                    <SelectTrigger className="w-[150px]">
                                        <SelectValue placeholder="Status" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="todos">Todos</SelectItem>
                                        <SelectItem value="disponivel">Disponíveis</SelectItem>
                                        <SelectItem value="arquivado">Arquivados</SelectItem>
                                        <SelectItem value="contratado">Contratados</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </div>

                        {/* S37B-04: Filtros demográficos */}
                        <div className="flex flex-wrap gap-2 items-center">
                            <Filter className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />

                            <Select value={filtroEscolaridade || "todos"} onValueChange={(v) => setFiltroEscolaridade(v === "todos" ? "" : v)}>
                                <SelectTrigger className="h-8 w-auto min-w-[160px] text-xs">
                                    <GraduationCap className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
                                    <SelectValue placeholder="Escolaridade" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="todos">Todas as escolaridades</SelectItem>
                                    {NIVEIS_ESCOLARIDADE.map(n => (
                                        <SelectItem key={n} value={n}>{n}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>

                            <Select value={filtroGenero || "todos"} onValueChange={(v) => setFiltroGenero(v === "todos" ? "" : v)}>
                                <SelectTrigger className="h-8 w-auto min-w-[120px] text-xs">
                                    <SelectValue placeholder="Gênero" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="todos">Todos os gêneros</SelectItem>
                                    <SelectItem value="Masculino">Masculino</SelectItem>
                                    <SelectItem value="Feminino">Feminino</SelectItem>
                                    <SelectItem value="Não-binário">Não-binário</SelectItem>
                                    <SelectItem value="Prefiro não informar">Prefiro não informar</SelectItem>
                                </SelectContent>
                            </Select>

                            <Select value={filtroPCD || "todos"} onValueChange={(v) => setFiltroPCD(v === "todos" ? "" : v as "true" | "false")}>
                                <SelectTrigger className="h-8 w-auto min-w-[100px] text-xs">
                                    <SelectValue placeholder="PCD" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="todos">PCD: todos</SelectItem>
                                    <SelectItem value="true">Somente PCD</SelectItem>
                                    <SelectItem value="false">Não PCD</SelectItem>
                                </SelectContent>
                            </Select>

                            <Select value={filtroPrimeiroEmprego || "todos"} onValueChange={(v) => setFiltroPrimeiroEmprego(v === "todos" ? "" : v as "true" | "false")}>
                                <SelectTrigger className="h-8 w-auto min-w-[150px] text-xs">
                                    <SelectValue placeholder="Primeiro Emprego" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="todos">1º Emprego: todos</SelectItem>
                                    <SelectItem value="true">Primeiro Emprego</SelectItem>
                                    <SelectItem value="false">Com experiência</SelectItem>
                                </SelectContent>
                            </Select>

                            <div className="relative">
                                <Input
                                    placeholder="Bairro..."
                                    className="h-8 w-32 text-xs"
                                    value={filtroBairro}
                                    onChange={(e) => setFiltroBairro(e.target.value)}
                                />
                            </div>

                            {temFiltrosDemograficos && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 text-xs text-muted-foreground hover:text-destructive"
                                    onClick={() => {
                                        setFiltroEscolaridade("")
                                        setFiltroGenero("")
                                        setFiltroPCD("")
                                        setFiltroPrimeiroEmprego("")
                                        setFiltroBairro("")
                                    }}
                                >
                                    <X className="h-3.5 w-3.5 mr-1" /> Limpar filtros
                                </Button>
                            )}
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="text-center py-12 text-muted-foreground">
                            Carregando talentos...
                        </div>
                    ) : talentos.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            Nenhum talento encontrado com os filtros aplicados.
                        </div>
                    ) : (
                        <div className="divide-y divide-border">
                            {talentos.map((t) => {
                                const ocr = t.skills_jsonb || {}
                                const area = getAreaConfig(t.area_interesse as string[] | null)
                                const idade = calcularIdade(t.data_nascimento)
                                return (
                                    <div
                                        key={t.id}
                                        className="flex items-center gap-4 py-3 px-2 rounded-lg cursor-pointer hover:bg-muted/40 transition-colors group"
                                        onClick={() => setSelectedTalento(t)}
                                    >
                                        {/* Avatar inicial */}
                                        <div className={["flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold", area.bgClass, area.textClass].join(" ")}>
                                            {t.nome.charAt(0).toUpperCase()}
                                        </div>

                                        {/* Nome + área */}
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium truncate group-hover:text-foreground">{t.nome}</p>
                                            <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                                                <span className={["inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[10px] font-medium", area.bgClass, area.textClass, area.borderClass].join(" ")}>
                                                    {area.label}
                                                </span>
                                                {idade !== null && <span>· {idade} anos</span>}
                                            </p>
                                        </div>

                                        {/* Escolaridade */}
                                        <div className="hidden md:block w-36 text-xs text-muted-foreground truncate">
                                            {ocr.escolaridade || "—"}
                                        </div>

                                        {/* Status */}
                                        <div className="flex-shrink-0">
                                            <Badge
                                                variant="outline"
                                                className={
                                                    t.status === "disponivel"
                                                        ? "border-green-500/40 text-green-400 bg-green-500/10"
                                                        : t.status === "contratado"
                                                            ? "border-blue-500/40 text-blue-400 bg-blue-500/10"
                                                            : "border-zinc-500/40 text-zinc-400 bg-zinc-500/10"
                                                }
                                            >
                                                {t.status}
                                            </Badge>
                                        </div>

                                        {/* Ações rápidas */}
                                        <div className="flex-shrink-0 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                            {t.arquivo_cv_url && (
                                                <Button variant="ghost" size="icon" title="Ver PDF" onClick={() => window.open(t.arquivo_cv_url!, "_blank")}>
                                                    <FileText className="h-4 w-4 text-muted-foreground" />
                                                </Button>
                                            )}
                                            {t.telefone && (
                                                <Button variant="ghost" size="icon" title="WhatsApp"
                                                    onClick={() => window.open(`https://wa.me/55${t.telefone!.replace(/\D/g, "")}`, "_blank")}>
                                                    <Phone className="h-4 w-4 text-green-500" />
                                                </Button>
                                            )}
                                            {podeExcluir && (
                                                <Button
                                                    variant="ghost" size="icon" title="Excluir candidato e PDF"
                                                    disabled={deletandoId === t.id}
                                                    onClick={() => handleDelete(t.id, t.nome)}
                                                >
                                                    <Trash2 className="h-4 w-4 text-destructive" />
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    {/* S37B-05: Controles de paginação */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between pt-4 border-t mt-4">
                            <span className="text-xs text-muted-foreground">
                                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} de {totalCount.toLocaleString("pt-BR")}
                            </span>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={page === 0}
                                    onClick={() => setPage(p => p - 1)}
                                >
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <span className="text-xs tabular-nums">
                                    {page + 1} / {totalPages}
                                </span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={page >= totalPages - 1}
                                    onClick={() => setPage(p => p + 1)}
                                >
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* ── Modal currículo completo ───────────────────────────────────── */}
            <Dialog open={!!selectedTalento} onOpenChange={(o) => !o && setSelectedTalento(null)}>
                <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                    {selectedTalento && <CurriculoModal talento={selectedTalento} onRefresh={fetchTalentos} />}
                </DialogContent>
            </Dialog>

            {/* ── Modal cadastro manual ──────────────────────────────────────── */}
            {cadastroOpen && (
                <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
                    <div className="bg-popover rounded-xl shadow-xl w-full max-w-md">
                        <div className="flex items-center justify-between p-5 border-b">
                            <h2 className="text-lg font-bold">Cadastrar Candidato Presencial</h2>
                            <button onClick={() => setCadastroOpen(false)} className="text-muted-foreground hover:text-foreground">
                                <X className="h-5 w-5" />
                            </button>
                        </div>
                        <form onSubmit={handleCadastroManual} className="p-5 space-y-4">
                            <div className="space-y-1.5">
                                <Label htmlFor="m-nome">Nome Completo *</Label>
                                <Input id="m-nome" value={formNome} onChange={e => setFormNome(e.target.value)} placeholder="Nome do candidato" required />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="m-tel">Telefone / WhatsApp *</Label>
                                <Input id="m-tel" value={formTelefone} onChange={e => setFormTelefone(e.target.value)} placeholder="(85) 99999-9999" required />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="m-nasc">Data de Nascimento</Label>
                                <Input id="m-nasc" type="date" value={formNasc} onChange={e => setFormNasc(e.target.value)} max={new Date().toISOString().split("T")[0]} />
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="m-area">Área de Interesse</Label>
                                <Select value={formArea} onValueChange={setFormArea}>
                                    <SelectTrigger id="m-area">
                                        <SelectValue placeholder="Selecione a área" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {AREAS_INTERESSE.map(a => (
                                            <SelectItem key={a} value={a}>{a}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="space-y-1.5">
                                <Label htmlFor="m-cv">Currículo (PDF)</Label>
                                <Input
                                    id="m-cv"
                                    type="file"
                                    accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
                                    onChange={e => setFormArquivo(e.target.files?.[0] || null)}
                                    className="cursor-pointer"
                                />
                                <p className="text-xs text-muted-foreground">A análise de IA será disparada após o salvamento.</p>
                            </div>
                            <div className="flex justify-end gap-3 pt-2">
                                <Button type="button" variant="outline" onClick={() => setCadastroOpen(false)}>Cancelar</Button>
                                <Button type="submit" className="bg-cuca-yellow hover:bg-yellow-500 font-bold" disabled={savingCadastro}>
                                    {savingCadastro ? "Salvando..." : "Adicionar ao Banco"}
                                </Button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    )
}

// ─── Modal de currículo completo ──────────────────────────────────────────────

function CurriculoModal({ talento, onRefresh }: { talento: TalentBank; onRefresh?: () => void }) {
    const router = useRouter()
    const ocr = talento.skills_jsonb || {}
    const area = getAreaConfig(talento.area_interesse as string[] | null)
    const idade = talento.data_nascimento
        ? differenceInYears(new Date(), new Date(talento.data_nascimento))
        : null
    const dataNasc = talento.data_nascimento
        ? format(new Date(talento.data_nascimento + "T12:00:00"), "dd/MM/yyyy", { locale: ptBR })
        : null
    const dataEntrada = talento.created_at
        ? format(new Date(talento.created_at), "dd/MM/yyyy", { locale: ptBR })
        : null

    const habilidades: string[] = Array.isArray(ocr.habilidades)
        ? ocr.habilidades
        : typeof ocr.habilidades === "string"
            ? ocr.habilidades.split(/[,;]/).map((s: string) => s.trim()).filter(Boolean)
            : []

    const pontosFortesArr: string[] = Array.isArray(ocr.pontos_fortes)
        ? ocr.pontos_fortes
        : typeof ocr.pontos_fortes === "string"
            ? [ocr.pontos_fortes]
            : []

    const pontosAtencaoArr: string[] = Array.isArray(ocr.pontos_atencao)
        ? ocr.pontos_atencao
        : typeof ocr.pontos_atencao === "string"
            ? [ocr.pontos_atencao]
            : []

    return (
        <>
            <DialogHeader>
                <div className="flex items-start gap-4">
                    <div className={["w-12 h-12 rounded-full flex-shrink-0 flex items-center justify-center text-lg font-bold", area.bgClass, area.textClass].join(" ")}>
                        {talento.nome.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                        <DialogTitle className="text-xl">{talento.nome}</DialogTitle>
                        <DialogDescription asChild>
                            <div className="flex flex-wrap items-center gap-2 mt-1">
                                <span className={["inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-xs font-medium", area.bgClass, area.textClass, area.borderClass].join(" ")}>
                                    {area.icon}
                                    {area.label}
                                </span>
                                <Badge variant="outline" className={
                                    talento.status === "disponivel"
                                        ? "border-green-500/40 text-green-400 bg-green-500/10"
                                        : "border-zinc-500/40 text-zinc-400 bg-zinc-500/10"
                                }>
                                    {talento.status}
                                </Badge>
                            </div>
                        </DialogDescription>
                    </div>
                </div>
            </DialogHeader>

            <div className="space-y-5 pt-2">
                {/* Dados pessoais */}
                <div className="grid grid-cols-2 gap-3">
                    {talento.telefone && (
                        <div className="flex items-center gap-2 text-sm">
                            <Phone className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span>{talento.telefone}</span>
                        </div>
                    )}
                    {dataNasc && (
                        <div className="flex items-center gap-2 text-sm">
                            <User className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span>{dataNasc}{idade !== null ? ` (${idade} anos)` : ""}</span>
                        </div>
                    )}
                    {dataEntrada && (
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Clock className="h-4 w-4 flex-shrink-0" />
                            <span>Entrou em {dataEntrada}</span>
                        </div>
                    )}
                    {ocr.escolaridade && (
                        <div className="flex items-center gap-2 text-sm">
                            <GraduationCap className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span>{ocr.escolaridade}</span>
                        </div>
                    )}
                    {ocr.experiencia_meses != null && (
                        <div className="flex items-center gap-2 text-sm col-span-2">
                            <BrainCircuit className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                            <span>
                                {ocr.experiencia_meses} meses de experiência ({(ocr.experiencia_meses / 12).toFixed(1)} anos)
                            </span>
                        </div>
                    )}
                </div>

                {/* Habilidades */}
                {habilidades.length > 0 && (
                    <div>
                        <h4 className="text-sm font-semibold mb-2">Habilidades</h4>
                        <div className="flex flex-wrap gap-1.5">
                            {habilidades.map((h, i) => (
                                <span key={i} className="px-2 py-0.5 rounded-full bg-muted text-xs border border-border">
                                    {h}
                                </span>
                            ))}
                        </div>
                    </div>
                )}

                {/* Resumo profissional */}
                {(ocr.experiencia_resumo || ocr.skills) && (
                    <div>
                        <h4 className="text-sm font-semibold mb-2">Resumo Profissional</h4>
                        <div className="bg-muted/50 p-3 rounded-lg border text-sm whitespace-pre-wrap leading-relaxed">
                            {ocr.experiencia_resumo || ocr.skills}
                        </div>
                    </div>
                )}

                {/* Pontos fortes e atenção */}
                {(pontosFortesArr.length > 0 || pontosAtencaoArr.length > 0) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {pontosFortesArr.length > 0 && (
                            <div>
                                <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5 text-green-400">
                                    <CheckCircle className="h-4 w-4" /> Pontos Fortes
                                </h4>
                                <ul className="space-y-1">
                                    {pontosFortesArr.map((p, i) => (
                                        <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                                            <span className="text-green-400 mt-0.5">·</span> {p}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        {pontosAtencaoArr.length > 0 && (
                            <div>
                                <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5 text-amber-400">
                                    <AlertCircle className="h-4 w-4" /> Pontos de Atenção
                                </h4>
                                <ul className="space-y-1">
                                    {pontosAtencaoArr.map((p, i) => (
                                        <li key={i} className="text-xs text-muted-foreground flex gap-1.5">
                                            <span className="text-amber-400 mt-0.5">·</span> {p}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                )}

                {/* Veredito */}
                {ocr.veredito_final && (
                    <div>
                        <h4 className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                            <Star className="h-4 w-4 text-cuca-yellow" /> Veredito da IA
                        </h4>
                        <div className="bg-muted/50 p-3 rounded-lg border text-sm italic">
                            {ocr.veredito_final}
                        </div>
                    </div>
                )}

                {/* Match score */}
                {ocr.match_score != null && (
                    <div className="flex items-center gap-3">
                        <span className="text-sm font-semibold">Match Score:</span>
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                            <div
                                className="h-full rounded-full transition-all"
                                style={{
                                    width: `${Math.min(100, ocr.match_score)}%`,
                                    backgroundColor: ocr.match_score >= 70 ? "#22c55e" : ocr.match_score >= 40 ? "#f59e0b" : "#ef4444",
                                }}
                            />
                        </div>
                        <span className="text-sm font-bold tabular-nums w-10 text-right">{ocr.match_score}%</span>
                    </div>
                )}

                {/* Ações */}
                <div className="flex flex-wrap gap-2 pt-2 border-t">
                    {talento.arquivo_cv_url && (
                        <Button variant="outline" size="sm" onClick={() => window.open(talento.arquivo_cv_url!, "_blank")}>
                            <FileText className="h-4 w-4 mr-1.5" /> Ver Currículo Original
                            <ExternalLink className="h-3 w-3 ml-1.5 text-muted-foreground" />
                        </Button>
                    )}
                    <Button
                        variant="outline"
                        size="sm"
                        className="border-cuca-blue/40 text-cuca-blue hover:bg-cuca-blue/10"
                        onClick={() => router.push(`/empregabilidade/criar-curriculo/${talento.id}`)}
                    >
                        <PenLine className="h-4 w-4 mr-1.5" /> Criar Currículo
                    </Button>
                    {talento.telefone && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="border-green-500/40 text-green-400 hover:bg-green-500/10"
                            onClick={() => window.open(`https://wa.me/55${talento.telefone!.replace(/\D/g, "")}`, "_blank")}
                        >
                            <MessageCircle className="h-4 w-4 mr-1.5" /> WhatsApp
                        </Button>
                    )}
                </div>
            </div>

        </>
    )
}
