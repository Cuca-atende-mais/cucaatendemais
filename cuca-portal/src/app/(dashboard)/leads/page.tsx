"use client"

import { useState, useEffect, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { Lead, LeadAtividade } from "@/lib/types/database"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    Dialog, DialogContent, DialogDescription, DialogFooter,
    DialogHeader, DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Search, UserPlus, Phone,
    ShieldBan, Plus, Trash2, Save, ChevronLeft, ChevronRight,
    LockKeyhole, Unlock,
} from "lucide-react"
import { unidadesCuca } from "@/lib/constants"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import toast from "react-hot-toast"
import { mascaraTelefone, limparTelefone, cn } from "@/lib/utils"
import { AcoesLead } from "@/components/leads/acoes-lead"
import { CartaoLead } from "@/components/leads/cartao-lead"

const PAGE_SIZE = 50

const BADGE_COLORS = [
    "bg-blue-500/15 text-blue-400 border border-blue-500/25",
    "bg-emerald-500/15 text-emerald-400 border border-emerald-500/25",
    "bg-violet-500/15 text-violet-400 border border-violet-500/25",
    "bg-orange-500/15 text-orange-400 border border-orange-500/25",
    "bg-pink-500/15 text-pink-400 border border-pink-500/25",
    "bg-amber-500/15 text-amber-400 border border-amber-500/25",
]

export default function LeadsPage() {
    const supabase = createClient()

    // --- Listagem ---
    const [leads, setLeads] = useState<Lead[]>([])
    const [loading, setLoading] = useState(true)
    const [totalLeads, setTotalLeads] = useState(0)
    const [page, setPage] = useState(0)

    // --- Filtros ---
    const [busca, setBusca] = useState("")
    const [filtroUnidade, setFiltroUnidade] = useState("all")
    const [filtroStatus, setFiltroStatus] = useState("todos")

    // --- Sheet (perfil do lead) ---
    const [sheetOpen, setSheetOpen] = useState(false)
    const [leadSelecionado, setLeadSelecionado] = useState<Lead | null>(null)
    const [atividades, setAtividades] = useState<LeadAtividade[]>([])
    const [loadingAtividades, setLoadingAtividades] = useState(false)

    // Edição no sheet
    const [editando, setEditando] = useState(false)
    const [formDados, setFormDados] = useState({
        nome: "",
        telefone: "",
        data_nascimento: "",
        email: "",
        unidade_cuca: "",
    })
    const [salvandoDados, setSalvandoDados] = useState(false)

    // Adicionar atividade
    const [novaAtividade, setNovaAtividade] = useState({ equipamento: "", eixo: "", atividade: "", contagem: 1 })
    const [adicionandoAtividade, setAdicionandoAtividade] = useState(false)

    // --- Modal Novo Lead ---
    const [modalNovoLead, setModalNovoLead] = useState(false)
    const [novoLead, setNovoLead] = useState({
        nome: "",
        telefone: "",
        data_nascimento: "",
        email: "",
        unidade_cuca: "",
    })
    const [criandoLead, setCriandoLead] = useState(false)

    // --- Modal Bloquear ---
    const [modalBloquear, setModalBloquear] = useState<Lead | null>(null)
    const [motivoBloqueio, setMotivoBloqueio] = useState("")

    // --- Modal Excluir (soft delete) ---
    const [modalExcluir, setModalExcluir] = useState<Lead | null>(null)
    const [excluindoLead, setExcluindoLead] = useState(false)

    // --- Seleção múltipla e ações em massa ---
    const [selecionados, setSelecionados] = useState<Set<string>>(new Set())
    const [modalBloquearTodos, setModalBloquearTodos] = useState(false)
    const [bloqueandoTodos, setBloqueandoTodos] = useState(false)
    const [desbloqueandoSelecionados, setDesbloqueandoSelecionados] = useState(false)
    const [modalExcluirSelecionados, setModalExcluirSelecionados] = useState(false)
    const [excluindoSelecionados, setExcluindoSelecionados] = useState(false)

    // --- Interesses ---
    const [categoriasInteresse, setCategoriasInteresse] = useState<{ id: string; nome: string; pai_id: string | null }[]>([])
    const [leadInteresses, setLeadInteresses] = useState<string[]>([]) // IDs de categorias selecionadas
    const [salvandoInteresses, setSalvandoInteresses] = useState(false)

    // -------------------------
    // Busca com server-side pagination
    // -------------------------
    const buscarLeads = useCallback(async () => {
        setLoading(true)
        try {
            let query = supabase
                .from("leads")
                .select("*", { count: "exact" })
                .eq("excluido", false)

            if (busca.trim()) {
                query = query.or(
                    `nome.ilike.%${busca}%,telefone.ilike.%${busca}%,email.ilike.%${busca}%`
                )
            }
            if (filtroUnidade !== "all") {
                query = query.eq("unidade_cuca", filtroUnidade)
            }
            if (filtroStatus === "opt_in") {
                query = query.eq("opt_in", true)
            } else if (filtroStatus === "bloqueados") {
                query = query.eq("bloqueado", true)
            } else if (filtroStatus === "ativos") {
                query = query.eq("bloqueado", false)
            }

            const from = page * PAGE_SIZE
            const to = from + PAGE_SIZE - 1

            const { data, count, error } = await query
                .order("created_at", { ascending: false })
                .range(from, to)

            if (error) throw error
            setLeads(data ?? [])
            setTotalLeads(count ?? 0)
        } catch (err: any) {
            toast.error("Erro ao carregar leads: " + err.message)
        } finally {
            setLoading(false)
        }
    }, [busca, filtroUnidade, filtroStatus, page])

    useEffect(() => {
        buscarLeads()
    }, [buscarLeads])

    // Reset página ao mudar filtros
    useEffect(() => {
        setPage(0)
    }, [busca, filtroUnidade, filtroStatus])

    // -------------------------
    // Sheet: abrir e carregar atividades
    // -------------------------
    const abrirSheet = async (lead: Lead) => {
        setLeadSelecionado(lead)
        setFormDados({
            nome: lead.nome ?? "",
            telefone: lead.telefone,
            data_nascimento: lead.data_nascimento ?? "",
            email: lead.email ?? "",
            unidade_cuca: lead.unidade_cuca ?? "",
        })
        setEditando(false)
        setSheetOpen(true)
        setNovaAtividade({ equipamento: "", eixo: "", atividade: "", contagem: 1 })

        // Lazy load paralelo: atividades + categorias + interesses
        setLoadingAtividades(true)
        try {
            const [atividadesRes, categoriasRes, interessesRes] = await Promise.all([
                supabase.from("lead_atividades").select("*").eq("lead_id", lead.id).order("contagem", { ascending: false }),
                supabase.from("categorias_interesse").select("id, nome, pai_id").eq("ativo", true).order("ordem"),
                supabase.from("lead_interesses").select("categoria_id").eq("lead_id", lead.id),
            ])
            if (atividadesRes.error) throw atividadesRes.error
            setAtividades(atividadesRes.data ?? [])
            setCategoriasInteresse(categoriasRes.data ?? [])
            setLeadInteresses((interessesRes.data ?? []).map((r: any) => r.categoria_id))
        } catch (err: any) {
            toast.error("Erro ao carregar dados do lead")
        } finally {
            setLoadingAtividades(false)
        }
    }

    const toggleInteresse = async (categoriaId: string) => {
        if (!leadSelecionado) return
        const jaTemInteresse = leadInteresses.includes(categoriaId)
        setSalvandoInteresses(true)
        try {
            if (jaTemInteresse) {
                await supabase.from("lead_interesses").delete()
                    .eq("lead_id", leadSelecionado.id).eq("categoria_id", categoriaId)
                setLeadInteresses(prev => prev.filter(id => id !== categoriaId))
            } else {
                await supabase.from("lead_interesses").insert({ lead_id: leadSelecionado.id, categoria_id: categoriaId })
                setLeadInteresses(prev => [...prev, categoriaId])
            }
        } catch (err: any) {
            toast.error("Erro ao salvar interesse")
        } finally {
            setSalvandoInteresses(false)
        }
    }

    const salvarDados = async () => {
        if (!leadSelecionado) return
        setSalvandoDados(true)
        try {
            const { error } = await supabase
                .from("leads")
                .update({
                    nome: formDados.nome || null,
                    telefone: formDados.telefone,
                    data_nascimento: formDados.data_nascimento || null,
                    email: formDados.email || null,
                    unidade_cuca: formDados.unidade_cuca || null,
                })
                .eq("id", leadSelecionado.id)
            if (error) throw error
            toast.success("Dados salvos")
            setEditando(false)
            setLeadSelecionado(prev => prev ? { ...prev, ...formDados } : prev)
            buscarLeads()
        } catch (err: any) {
            toast.error("Erro: " + err.message)
        } finally {
            setSalvandoDados(false)
        }
    }

    const adicionarAtividade = async () => {
        if (!leadSelecionado) return
        if (!novaAtividade.equipamento.trim() || !novaAtividade.atividade.trim()) {
            toast.error("Equipamento e atividade são obrigatórios")
            return
        }
        setAdicionandoAtividade(true)
        try {
            const { error } = await supabase
                .from("lead_atividades")
                .upsert(
                    {
                        lead_id: leadSelecionado.id,
                        equipamento: novaAtividade.equipamento.trim().toUpperCase(),
                        atividade: novaAtividade.atividade.trim().toUpperCase(),
                        contagem: novaAtividade.contagem,
                    },
                    { onConflict: "lead_id,equipamento,atividade", ignoreDuplicates: false }
                )
            if (error) throw error
            toast.success("Atividade adicionada")
            setNovaAtividade({ equipamento: "", eixo: "", atividade: "", contagem: 1 })
            // Recarregar atividades e lead (perfil foi recalculado pelo trigger)
            const { data: novasAtiv } = await supabase
                .from("lead_atividades")
                .select("*")
                .eq("lead_id", leadSelecionado.id)
                .order("contagem", { ascending: false })
            setAtividades(novasAtiv ?? [])
            const { data: leadAtualizado } = await supabase
                .from("leads")
                .select("*")
                .eq("id", leadSelecionado.id)
                .single()
            if (leadAtualizado) setLeadSelecionado(leadAtualizado)
            buscarLeads()
        } catch (err: any) {
            toast.error("Erro: " + err.message)
        } finally {
            setAdicionandoAtividade(false)
        }
    }

    const excluirAtividade = async (atividadeId: string) => {
        if (!leadSelecionado) return
        try {
            const { error } = await supabase
                .from("lead_atividades")
                .delete()
                .eq("id", atividadeId)
            if (error) throw error
            setAtividades(prev => prev.filter(a => a.id !== atividadeId))
            toast.success("Atividade removida")
            // Recarregar lead para atualizar perfil
            const { data: leadAtualizado } = await supabase
                .from("leads")
                .select("*")
                .eq("id", leadSelecionado.id)
                .single()
            if (leadAtualizado) setLeadSelecionado(leadAtualizado)
            buscarLeads()
        } catch (err: any) {
            toast.error("Erro: " + err.message)
        }
    }

    // -------------------------
    // Ações na tabela
    // -------------------------
    const toggleOptIn = async (lead: Lead) => {
        const { error } = await supabase
            .from("leads")
            .update({ opt_in: !lead.opt_in })
            .eq("id", lead.id)
        if (error) { toast.error("Erro ao atualizar opt-in"); return }
        buscarLeads()
        toast.success(lead.opt_in ? "Opt-in removido" : "Opt-in ativado")
    }

    const bloquearLead = async () => {
        if (!modalBloquear) return
        const { error } = await supabase
            .from("leads")
            .update({ bloqueado: true, motivo_bloqueio: motivoBloqueio || null })
            .eq("id", modalBloquear.id)
        if (error) { toast.error("Erro"); return }
        setModalBloquear(null)
        setMotivoBloqueio("")
        buscarLeads()
        toast.success("Lead bloqueado")
    }

    const desbloquearLead = async (lead: Lead) => {
        const { error } = await supabase
            .from("leads")
            .update({ bloqueado: false, motivo_bloqueio: null })
            .eq("id", lead.id)
        if (error) { toast.error("Erro"); return }
        buscarLeads()
        toast.success("Lead desbloqueado")
    }

    const excluirLead = async () => {
        if (!modalExcluir) return
        setExcluindoLead(true)
        const { error } = await supabase
            .from("leads")
            .update({ excluido: true })
            .eq("id", modalExcluir.id)
        setExcluindoLead(false)
        if (error) { toast.error("Erro ao excluir lead"); return }
        setModalExcluir(null)
        buscarLeads()
        toast.success("Lead excluído")
    }

    const limparTags = async (lead: Lead) => {
        if (!confirm("Remover todas as tags deste lead?")) return
        const { error } = await supabase.from("leads").update({ tags: [] }).eq("id", lead.id)
        if (!error) {
            toast.success("Tags removidas")
            buscarLeads()
        }
    }

    // -------------------------
    // Novo Lead
    // -------------------------
    const criarLead = async () => {
        if (!novoLead.telefone.trim()) {
            toast.error("Telefone é obrigatório")
            return
        }
        setCriandoLead(true)
        try {
            const { error } = await supabase.from("leads").insert({
                nome: novoLead.nome || null,
                telefone: novoLead.telefone.trim(),
                data_nascimento: novoLead.data_nascimento || null,
                email: novoLead.email || null,
                unidade_cuca: novoLead.unidade_cuca || null,
                opt_in: true,
                bloqueado: false,
                equipamentos_principais: [],
                atividades_principais: [],
            })
            if (error) throw error
            toast.success("Lead criado")
            setModalNovoLead(false)
            setNovoLead({ nome: "", telefone: "", data_nascimento: "", email: "", unidade_cuca: "" })
            buscarLeads()
        } catch (err: any) {
            toast.error("Erro: " + err.message)
        } finally {
            setCriandoLead(false)
        }
    }

    // -------------------------
    // Ações em massa
    // -------------------------
    const toggleSelecionado = (id: string) => {
        setSelecionados(prev => {
            const next = new Set(prev)
            next.has(id) ? next.delete(id) : next.add(id)
            return next
        })
    }

    const toggleSelecionarPagina = () => {
        const idsPagina = leads.map(l => l.id)
        const todosSelecionados = idsPagina.every(id => selecionados.has(id))
        setSelecionados(prev => {
            const next = new Set(prev)
            todosSelecionados
                ? idsPagina.forEach(id => next.delete(id))
                : idsPagina.forEach(id => next.add(id))
            return next
        })
    }

    const bloquearTodos = async () => {
        setBloqueandoTodos(true)
        try {
            const { error } = await supabase
                .from("leads")
                .update({ bloqueado: true, motivo_bloqueio: "Bloqueio em massa" })
                .neq("id", "00000000-0000-0000-0000-000000000000") // força update em todos
            if (error) throw error
            toast.success(`Todos os leads bloqueados`)
            setSelecionados(new Set())
            setModalBloquearTodos(false)
            buscarLeads()
        } catch (err: any) {
            toast.error("Erro: " + err.message)
        } finally {
            setBloqueandoTodos(false)
        }
    }

    const desbloquearSelecionados = async () => {
        if (selecionados.size === 0) return
        setDesbloqueandoSelecionados(true)
        try {
            const ids = Array.from(selecionados)
            const { error } = await supabase
                .from("leads")
                .update({ bloqueado: false, motivo_bloqueio: null })
                .in("id", ids)
            if (error) throw error
            toast.success(`${ids.length} lead(s) desbloqueado(s)`)
            setSelecionados(new Set())
            buscarLeads()
        } catch (err: any) {
            toast.error("Erro: " + err.message)
        } finally {
            setDesbloqueandoSelecionados(false)
        }
    }

    const excluirSelecionados = async () => {
        if (selecionados.size === 0) return
        setExcluindoSelecionados(true)
        try {
            const ids = Array.from(selecionados)
            const { error } = await supabase
                .from("leads")
                .delete()
                .in("id", ids)
            if (error) throw error
            toast.success(`${ids.length} lead(s) excluído(s) permanentemente`)
            setSelecionados(new Set())
            setModalExcluirSelecionados(false)
            buscarLeads()
        } catch (err: any) {
            toast.error("Erro: " + err.message)
        } finally {
            setExcluindoSelecionados(false)
        }
    }

    // -------------------------
    // Helpers
    // -------------------------
    const totalPaginas = Math.ceil(totalLeads / PAGE_SIZE)

    const formatarData = (data: string | null) => {
        if (!data) return "—"
        try { return format(new Date(data), "dd/MM/yyyy", { locale: ptBR }) } catch { return data }
    }

    // S19-04: Helper para formatar cleanly (Eixo > Modalidade)
    const formatarAtividade = (nomeAtividade: string) => {
        const mod = categoriasInteresse.find(c => c.nome.toLowerCase() === nomeAtividade.toLowerCase() && c.pai_id)
        if (mod) {
            const pai = categoriasInteresse.find(c => c.id === mod.pai_id)
            if (pai) return `${pai.nome} > ${mod.nome}`
        }
        return nomeAtividade
    }

    // Perfil (até 2 atividades + 2 equipamentos), igual na tabela e no cartão. null quando vazio.
    const renderPerfil = (lead: Lead) => {
        const atividades = (lead.atividades_principais ?? []).slice(0, 2)
        const equipamentos = (lead.equipamentos_principais ?? []).slice(0, 2)
        if (atividades.length === 0 && equipamentos.length === 0) return null
        return (
            <div className="flex flex-wrap gap-1">
                {atividades.map((a, i) => (
                    <span
                        key={a}
                        title={`Original: ${a}`}
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium cursor-help ${BADGE_COLORS[i % BADGE_COLORS.length]}`}
                    >
                        {formatarAtividade(a)}
                    </span>
                ))}
                {equipamentos.map(eq => (
                    <Badge key={eq} variant="outline" className="text-xs">{eq}</Badge>
                ))}
            </div>
        )
    }

    const renderAcoes = (lead: Lead, classeBotao?: string) => (
        <AcoesLead
            lead={lead}
            classeBotao={classeBotao}
            onVer={abrirSheet}
            onAlternarOptIn={toggleOptIn}
            onDesbloquear={desbloquearLead}
            onBloquear={l => { setModalBloquear(l); setMotivoBloqueio("") }}
            onLimparTags={limparTags}
            onExcluir={setModalExcluir}
        />
    )

    return (
        // Sem espaçamento próprio abaixo de md: a moldura (area-conteudo) já dá p-6
        <div className="flex flex-col gap-6 md:p-6">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold">Leads</h1>
                    <p className="text-muted-foreground text-sm">
                        {totalLeads.toLocaleString("pt-BR")} leads cadastrados
                    </p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Button variant="destructive" className="h-11 md:h-9" onClick={() => setModalBloquearTodos(true)}>
                        <LockKeyhole className="mr-2 h-4 w-4" />
                        Bloquear Todos
                    </Button>
                    <Button className="h-11 md:h-9" onClick={() => setModalNovoLead(true)}>
                        <UserPlus className="mr-2 h-4 w-4" />
                        Novo Lead
                    </Button>
                </div>
            </div>

            {/* Filtros */}
            <Card>
                <CardContent className="pt-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                        <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[200px]">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                className="pl-9"
                                placeholder="Buscar por nome, telefone ou e-mail..."
                                value={busca}
                                onChange={e => setBusca(e.target.value)}
                            />
                        </div>
                        <Select value={filtroUnidade} onValueChange={setFiltroUnidade}>
                            <SelectTrigger className="w-full sm:w-[180px]">
                                <SelectValue placeholder="Unidade" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">Todas as unidades</SelectItem>
                                {unidadesCuca.map(u => (
                                    <SelectItem key={u} value={u}>{u}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <Select value={filtroStatus} onValueChange={setFiltroStatus}>
                            <SelectTrigger className="w-full sm:w-[150px]">
                                <SelectValue placeholder="Status" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="todos">Todos</SelectItem>
                                <SelectItem value="ativos">Ativos</SelectItem>
                                <SelectItem value="opt_in">Com Opt-in</SelectItem>
                                <SelectItem value="bloqueados">Bloqueados</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            {/* Barra de ação quando há selecionados */}
            {selecionados.size > 0 && (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
                    <span className="text-sm font-medium">
                        {selecionados.size} lead(s) selecionado(s)
                    </span>
                    <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={() => setSelecionados(new Set())}>
                            Limpar seleção
                        </Button>
                        <Button
                            size="sm"
                            className="h-11 md:h-8"
                            onClick={desbloquearSelecionados}
                            disabled={desbloqueandoSelecionados}
                        >
                            <Unlock className="mr-2 h-4 w-4" />
                            {desbloqueandoSelecionados
                                ? "Desbloqueando..."
                                : `Desbloquear ${selecionados.size}`}
                        </Button>
                        <Button
                            variant="destructive"
                            size="sm"
                            className="h-11 md:h-8"
                            onClick={() => setModalExcluirSelecionados(true)}
                        >
                            <Trash2 className="mr-2 h-4 w-4" />
                            {`Excluir ${selecionados.size}`}
                        </Button>
                    </div>
                </div>
            )}

            {/* Lista de leads: tabela a partir de lg (1024px); abaixo disso, cartões.
                Em 1024 a tabela mostra nome, telefone, unidade, status e ações sem rolar para o
                lado; Perfil e Cadastro aparecem a partir de xl (1280px). */}
            <div className="space-y-2 lg:hidden">
                {loading ? (
                    <p className="rounded-lg border bg-card py-10 text-center text-muted-foreground">Carregando...</p>
                ) : leads.length === 0 ? (
                    <p className="rounded-lg border bg-card py-10 text-center text-muted-foreground">Nenhum lead encontrado</p>
                ) : (
                    <>
                        <label className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground">
                            <Checkbox
                                checked={leads.every(l => selecionados.has(l.id))}
                                onCheckedChange={toggleSelecionarPagina}
                            />
                            Selecionar todos desta página
                        </label>
                        {leads.map(lead => (
                            <CartaoLead
                                key={lead.id}
                                lead={lead}
                                selecionado={selecionados.has(lead.id)}
                                onAlternarSelecao={() => toggleSelecionado(lead.id)}
                                dataCadastro={formatarData(lead.created_at)}
                                perfil={renderPerfil(lead)}
                                acoes={renderAcoes(lead, "h-11 w-11 shrink-0 -mr-2 -mt-2")}
                            />
                        ))}
                    </>
                )}
            </div>

            <Card className="hidden lg:flex">
                <CardContent className="p-0">
                    <Table cabecalhoFixo>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-10">
                                    <Checkbox
                                        checked={leads.length > 0 && leads.every(l => selecionados.has(l.id))}
                                        onCheckedChange={toggleSelecionarPagina}
                                    />
                                </TableHead>
                                <TableHead>Nome</TableHead>
                                <TableHead>Telefone</TableHead>
                                <TableHead>Unidade</TableHead>
                                <TableHead className="hidden xl:table-cell">Perfil</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="hidden xl:table-cell">Cadastro</TableHead>
                                <TableHead className="w-10"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow>
                                    <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                                        Carregando...
                                    </TableCell>
                                </TableRow>
                            ) : leads.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={8} className="text-center py-10 text-muted-foreground">
                                        Nenhum lead encontrado
                                    </TableCell>
                                </TableRow>
                            ) : leads.map(lead => (
                                <TableRow
                                    key={lead.id}
                                    className={cn("hover:bg-muted/50", selecionados.has(lead.id) && "bg-primary/5")}
                                >
                                    <TableCell>
                                        <Checkbox
                                            checked={selecionados.has(lead.id)}
                                            onCheckedChange={() => toggleSelecionado(lead.id)}
                                        />
                                    </TableCell>
                                    {/* Nome quebra linha: um nome longo não pode empurrar as ações para fora */}
                                    <TableCell className="font-medium whitespace-normal break-words min-w-[10rem]">
                                        {lead.nome ?? <span className="text-muted-foreground italic">Sem nome</span>}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex items-center gap-1">
                                            <Phone className="h-3 w-3 text-muted-foreground" />
                                            {lead.telefone}
                                        </div>
                                    </TableCell>
                                    <TableCell>{lead.unidade_cuca ?? "—"}</TableCell>
                                    <TableCell className="hidden xl:table-cell">
                                        {renderPerfil(lead)}
                                    </TableCell>
                                    <TableCell>
                                        <div className="flex flex-wrap gap-1">
                                            {lead.opt_in && <Badge variant="secondary">Opt-in</Badge>}
                                            {lead.bloqueado && <Badge variant="destructive">Bloqueado</Badge>}
                                            {!lead.opt_in && !lead.bloqueado && (
                                                <span className="text-muted-foreground text-xs">—</span>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell className="hidden xl:table-cell text-sm text-muted-foreground">
                                        {formatarData(lead.created_at)}
                                    </TableCell>
                                    <TableCell>
                                        {renderAcoes(lead)}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* Paginação */}
            {totalPaginas > 1 && (
                <div className="flex items-center justify-between gap-3">
                    <p className="text-sm text-muted-foreground">
                        Página {page + 1} de {totalPaginas} · {totalLeads.toLocaleString("pt-BR")} leads
                    </p>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-11 w-11 md:h-8 md:w-auto"
                            aria-label="Página anterior"
                            onClick={() => setPage(p => Math.max(0, p - 1))}
                            disabled={page === 0}
                        >
                            <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            className="h-11 w-11 md:h-8 md:w-auto"
                            aria-label="Próxima página"
                            onClick={() => setPage(p => Math.min(totalPaginas - 1, p + 1))}
                            disabled={page >= totalPaginas - 1}
                        >
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}

            {/* ============================
                Dialog — Perfil do Lead
            ============================ */}
            <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
                <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
                    <DialogTitle className="sr-only">Perfil do Lead</DialogTitle>

                    {leadSelecionado && (
                        <>
                            {/* ── Header fixo ── */}
                            <div className="flex flex-wrap items-start gap-4 px-4 sm:px-6 py-5 border-b border-border shrink-0 pr-14 sm:pr-14">
                                <div className="h-14 w-14 rounded-2xl bg-primary/15 flex items-center justify-center text-primary font-black text-2xl shrink-0">
                                    {(leadSelecionado.nome ?? "?").charAt(0).toUpperCase()}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <h2 className="text-lg font-bold leading-tight">{leadSelecionado.nome ?? "Lead sem nome"}</h2>
                                    <p className="text-sm text-muted-foreground mt-0.5">{leadSelecionado.telefone}</p>
                                    {leadSelecionado.unidade_cuca && (
                                        <Badge variant="outline" className="mt-2 text-xs">{leadSelecionado.unidade_cuca}</Badge>
                                    )}
                                </div>
                                {/* No celular os botões descem para uma linha própria, senão espremem o nome */}
                                <div className="basis-full sm:basis-auto shrink-0">
                                    {!editando ? (
                                        <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={() => setEditando(true)}>Editar</Button>
                                    ) : (
                                        <div className="flex gap-2">
                                            <Button variant="ghost" size="sm" className="h-11 md:h-8" onClick={() => setEditando(false)}>Cancelar</Button>
                                            <Button size="sm" className="h-11 md:h-8" onClick={salvarDados} disabled={salvandoDados}>
                                                <Save className="mr-1 h-3 w-3" />
                                                {salvandoDados ? "Salvando..." : "Salvar"}
                                            </Button>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* ── Corpo scrollável ── */}
                            <div className="flex-1 overflow-y-auto">
                                <div className="px-6 py-5 space-y-6">

                                    {/* Seção: Dados */}
                                    <div>
                                        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Informações Pessoais</p>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-1.5">Nome</p>
                                                {editando ? (
                                                    <Input value={formDados.nome} onChange={e => setFormDados(f => ({ ...f, nome: e.target.value }))} className="h-8 text-sm" />
                                                ) : (
                                                    <p className="text-sm font-medium">{leadSelecionado.nome ?? "—"}</p>
                                                )}
                                            </div>
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-1.5">Telefone</p>
                                                {editando ? (
                                                    <Input value={mascaraTelefone(formDados.telefone)} onChange={e => setFormDados(f => ({ ...f, telefone: limparTelefone(e.target.value) }))} placeholder="+55 (85) 99999-9999" className="h-8 text-sm" />
                                                ) : (
                                                    <p className="text-sm font-medium">{leadSelecionado.telefone}</p>
                                                )}
                                            </div>
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-1.5">Data de Nascimento</p>
                                                {editando ? (
                                                    <Input type="date" value={formDados.data_nascimento} onChange={e => setFormDados(f => ({ ...f, data_nascimento: e.target.value }))} className="h-8 text-sm" />
                                                ) : (
                                                    <p className="text-sm font-medium">{formatarData(leadSelecionado.data_nascimento)}</p>
                                                )}
                                            </div>
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-1.5">E-mail</p>
                                                {editando ? (
                                                    <Input type="email" value={formDados.email} onChange={e => setFormDados(f => ({ ...f, email: e.target.value }))} className="h-8 text-sm" />
                                                ) : (
                                                    <p className="text-sm font-medium">{leadSelecionado.email ?? "—"}</p>
                                                )}
                                            </div>
                                            <div className="sm:col-span-2">
                                                <p className="text-xs text-muted-foreground mb-1.5">Unidade CUCA</p>
                                                {editando ? (
                                                    <Select value={formDados.unidade_cuca} onValueChange={v => setFormDados(f => ({ ...f, unidade_cuca: v }))}>
                                                        <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                                                        <SelectContent>
                                                            {unidadesCuca.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                ) : (
                                                    <p className="text-sm font-medium">{leadSelecionado.unidade_cuca ?? "—"}</p>
                                                )}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Seção: Perfil Automático */}
                                    <div className="pt-5 border-t border-border">
                                        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Perfil Automático</p>
                                        <div className="space-y-3">
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-2">Atividades principais</p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {(leadSelecionado.atividades_principais ?? []).length === 0 ? (
                                                        <span className="text-xs text-muted-foreground italic">Nenhuma registrada</span>
                                                    ) : (leadSelecionado.atividades_principais ?? []).map((a, i) => {
                                                        // S19-04: Formatar (Eixo > Modalidade) e Tooltip com original
                                                        const cleanName = formatarAtividade(a)
                                                        return (
                                                            <span key={a} title={`Original: ${a}`} className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium cursor-help ${BADGE_COLORS[i % BADGE_COLORS.length]}`}>
                                                                {cleanName}
                                                            </span>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                            <div>
                                                <p className="text-xs text-muted-foreground mb-2">Equipamentos principais</p>
                                                <div className="flex flex-wrap gap-1.5">
                                                    {(leadSelecionado.equipamentos_principais ?? []).length === 0 ? (
                                                        <span className="text-xs text-muted-foreground italic">Nenhum registrado</span>
                                                    ) : (leadSelecionado.equipamentos_principais ?? []).map(eq => (
                                                        <Badge key={eq} variant="outline" className="text-xs">{eq}</Badge>
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Seção: Interesses — pills interativas */}
                                    {categoriasInteresse.length > 0 && (
                                        <div className="pt-5 border-t border-border">
                                            <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Interesses</p>
                                            <div className="space-y-4">
                                                {categoriasInteresse.filter(c => !c.pai_id).map(pai => {
                                                    const subs = categoriasInteresse.filter(c => c.pai_id === pai.id)
                                                    return (
                                                        <div key={pai.id}>
                                                            <p className="text-xs font-semibold text-muted-foreground/60 uppercase tracking-wider mb-2">{pai.nome}</p>
                                                            <div className="flex flex-wrap gap-2">
                                                                {subs.map(sub => (
                                                                    <button
                                                                        key={sub.id}
                                                                        type="button"
                                                                        disabled={salvandoInteresses}
                                                                        onClick={() => toggleInteresse(sub.id)}
                                                                        className={cn(
                                                                            "px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-150",
                                                                            leadInteresses.includes(sub.id)
                                                                                ? "bg-primary/20 text-primary border-primary/50 shadow-sm"
                                                                                : "bg-muted/50 text-muted-foreground border-border hover:bg-muted hover:text-foreground"
                                                                        )}
                                                                    >
                                                                        {sub.nome}
                                                                    </button>
                                                                ))}
                                                            </div>
                                                        </div>
                                                    )
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Seção: Histórico de Atividades */}
                                    <div className="pt-5 border-t border-border pb-2">
                                        <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-4">Histórico de Atividades</p>

                                        {loadingAtividades ? (
                                            <p className="text-sm text-muted-foreground">Carregando...</p>
                                        ) : (
                                            <>
                                                {atividades.length > 0 && (
                                                    <Table className="mb-4">
                                                        <TableHeader>
                                                            <TableRow>
                                                                <TableHead className="text-xs">Equipamento</TableHead>
                                                                <TableHead className="text-xs">Atividade</TableHead>
                                                                <TableHead className="text-xs text-center">Qtd</TableHead>
                                                                <TableHead className="w-8"></TableHead>
                                                            </TableRow>
                                                        </TableHeader>
                                                        <TableBody>
                                                            {atividades.map(a => (
                                                                <TableRow key={a.id}>
                                                                    <TableCell className="text-xs py-2">{a.equipamento}</TableCell>
                                                                    <TableCell className="text-xs py-2">{a.atividade}</TableCell>
                                                                    <TableCell className="text-xs py-2 text-center">{a.contagem}</TableCell>
                                                                    <TableCell className="py-2">
                                                                        <Button variant="ghost" size="icon" className="h-11 w-11 md:h-6 md:w-6 text-destructive hover:text-destructive" aria-label="Remover atividade" onClick={() => excluirAtividade(a.id)}>
                                                                            <Trash2 className="h-3 w-3" />
                                                                        </Button>
                                                                    </TableCell>
                                                                </TableRow>
                                                            ))}
                                                        </TableBody>
                                                    </Table>
                                                )}

                                                <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3 mt-4">
                                                    <p className="text-xs font-semibold text-foreground">Adicionar atividade / interesse</p>
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                        <div>
                                                            <Label className="text-xs">Equipamento (CUCA)</Label>
                                                            <Select value={novaAtividade.equipamento} onValueChange={v => setNovaAtividade(n => ({ ...n, equipamento: v }))}>
                                                                <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                                                                <SelectContent>
                                                                    {unidadesCuca.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                        <div>
                                                            <Label className="text-xs">Qtd (Opcional)</Label>
                                                            <Input type="number" min={1} value={novaAtividade.contagem} onChange={e => setNovaAtividade(n => ({ ...n, contagem: parseInt(e.target.value) || 1 }))} className="mt-1 h-8 text-base md:text-xs" />
                                                        </div>
                                                    </div>

                                                    {/* S19-03: Dropdown Cascata Pai/Filho */}
                                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                        <div>
                                                            <Label className="text-xs">Eixo (Opcional Filtro)</Label>
                                                            <Select
                                                                value={novaAtividade.eixo || "todos"}
                                                                onValueChange={v => {
                                                                    setNovaAtividade(n => ({ ...n, eixo: v === "todos" ? "" : v, atividade: "" }))
                                                                }}
                                                            >
                                                                <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="Todos os Eixos" /></SelectTrigger>
                                                                <SelectContent>
                                                                    <SelectItem value="todos">Todos os Eixos</SelectItem>
                                                                    {categoriasInteresse.filter(c => !c.pai_id).map(eixo => (
                                                                        <SelectItem key={eixo.id} value={eixo.id}>{eixo.nome}</SelectItem>
                                                                    ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                        <div>
                                                            <Label className="text-xs">Modalidade</Label>
                                                            <Select
                                                                value={novaAtividade.atividade}
                                                                onValueChange={v => setNovaAtividade(n => ({ ...n, atividade: v }))}
                                                            >
                                                                <SelectTrigger className="mt-1 h-8 text-xs"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                                                                <SelectContent>
                                                                    {categoriasInteresse
                                                                        .filter(c => c.pai_id && (!novaAtividade.eixo || c.pai_id === novaAtividade.eixo))
                                                                        .map(mod => (
                                                                            <SelectItem key={mod.nome} value={mod.nome}>{mod.nome}</SelectItem>
                                                                        ))}
                                                                </SelectContent>
                                                            </Select>
                                                        </div>
                                                    </div>

                                                    <Button size="sm" className="w-full mt-2 h-11 md:h-8" onClick={adicionarAtividade} disabled={adicionandoAtividade}>
                                                        <Plus className="mr-1 h-3 w-3" />
                                                        {adicionandoAtividade ? "Adicionando..." : "Adicionar à Grade"}
                                                    </Button>
                                                </div>
                                            </>
                                        )}
                                    </div>

                                </div>
                            </div>
                        </>
                    )}
                </DialogContent>
            </Dialog>

            {/* ============================
                Modal — Novo Lead
            ============================ */}
            <Dialog open={modalNovoLead} onOpenChange={setModalNovoLead}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Novo Lead</DialogTitle>
                        <DialogDescription>Cadastrar um novo contato</DialogDescription>
                    </DialogHeader>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="sm:col-span-2">
                            <Label>Nome</Label>
                            <Input
                                className="mt-1"
                                placeholder="Nome completo"
                                value={novoLead.nome}
                                onChange={e => setNovoLead(l => ({ ...l, nome: e.target.value }))}
                            />
                        </div>
                        <div>
                            <Label>Telefone *</Label>
                            <Input
                                className="mt-1"
                                placeholder="+55 (85) 99999-9999"
                                value={mascaraTelefone(novoLead.telefone)}
                                onChange={e => setNovoLead(l => ({ ...l, telefone: limparTelefone(e.target.value) }))}
                            />
                        </div>
                        <div>
                            <Label>Data de Nascimento</Label>
                            <Input
                                className="mt-1"
                                type="date"
                                value={novoLead.data_nascimento}
                                onChange={e => setNovoLead(l => ({ ...l, data_nascimento: e.target.value }))}
                            />
                        </div>
                        <div className="sm:col-span-2">
                            <Label>E-mail</Label>
                            <Input
                                className="mt-1"
                                type="email"
                                placeholder="email@exemplo.com"
                                value={novoLead.email}
                                onChange={e => setNovoLead(l => ({ ...l, email: e.target.value }))}
                            />
                        </div>
                        <div className="sm:col-span-2">
                            <Label>Unidade CUCA</Label>
                            <Select
                                value={novoLead.unidade_cuca}
                                onValueChange={v => setNovoLead(l => ({ ...l, unidade_cuca: v }))}
                            >
                                <SelectTrigger className="mt-1">
                                    <SelectValue placeholder="Selecionar unidade..." />
                                </SelectTrigger>
                                <SelectContent>
                                    {unidadesCuca.map(u => (
                                        <SelectItem key={u} value={u}>{u}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter className="max-md:[&_button]:h-11">
                        <Button variant="outline" onClick={() => setModalNovoLead(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={criarLead} disabled={criandoLead}>
                            {criandoLead ? "Criando..." : "Criar Lead"}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ============================
                Modal — Bloquear Todos
            ============================ */}
            <Dialog open={modalBloquearTodos} onOpenChange={setModalBloquearTodos}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Bloquear todos os leads</DialogTitle>
                        <DialogDescription>
                            Esta ação bloqueará <strong>todos os {totalLeads.toLocaleString("pt-BR")} leads</strong> do banco.
                            Nenhum deles receberá mensagens até que sejam desbloqueados individualmente.
                            Use os checkboxes para selecionar e desbloquear apenas os que desejar.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="max-md:[&_button]:h-11">
                        <Button variant="outline" onClick={() => setModalBloquearTodos(false)}>
                            Cancelar
                        </Button>
                        <Button variant="destructive" onClick={bloquearTodos} disabled={bloqueandoTodos}>
                            <LockKeyhole className="mr-2 h-4 w-4" />
                            {bloqueandoTodos ? "Bloqueando..." : `Bloquear todos os ${totalLeads.toLocaleString("pt-BR")} leads`}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ============================
                Modal — Bloquear Lead
            ============================ */}
            <Dialog open={!!modalBloquear} onOpenChange={open => !open && setModalBloquear(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Bloquear Lead</DialogTitle>
                        <DialogDescription>
                            Bloquear {modalBloquear?.nome ?? modalBloquear?.telefone}
                        </DialogDescription>
                    </DialogHeader>
                    <div>
                        <Label>Motivo (opcional)</Label>
                        <Textarea
                            className="mt-1"
                            placeholder="Descreva o motivo do bloqueio..."
                            value={motivoBloqueio}
                            onChange={e => setMotivoBloqueio(e.target.value)}
                            rows={3}
                        />
                    </div>
                    <DialogFooter className="max-md:[&_button]:h-11">
                        <Button variant="outline" onClick={() => setModalBloquear(null)}>Cancelar</Button>
                        <Button variant="destructive" onClick={bloquearLead}>
                            <ShieldBan className="mr-2 h-4 w-4" />Bloquear
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ============================
                Modal — Excluir Lead (soft delete)
            ============================ */}
            <Dialog open={!!modalExcluir} onOpenChange={open => !open && setModalExcluir(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Excluir Lead</DialogTitle>
                        <DialogDescription>
                            Excluir {modalExcluir?.nome ?? modalExcluir?.telefone}? O lead deixa de aparecer
                            na listagem, mas o histórico de conversas, mensagens e candidaturas é preservado
                            — esta ação não apaga dados relacionados, apenas remove o lead da lista.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="max-md:[&_button]:h-11">
                        <Button variant="outline" onClick={() => setModalExcluir(null)}>Cancelar</Button>
                        <Button variant="destructive" onClick={excluirLead} disabled={excluindoLead}>
                            <Trash2 className="mr-2 h-4 w-4" />Excluir
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* ============================
                Modal — Excluir Selecionados (hard delete em lote, irreversível)
            ============================ */}
            <Dialog open={modalExcluirSelecionados} onOpenChange={setModalExcluirSelecionados}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="text-destructive">Excluir leads selecionados</DialogTitle>
                        <DialogDescription>
                            Esta ação é <strong>IRREVERSÍVEL</strong>. Excluir <strong>{selecionados.size} lead(s)</strong> selecionado(s)?
                            Os leads e todo o histórico de conversas e mensagens associado serão apagados
                            definitivamente do banco de dados — não é possível desfazer nem recuperar.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter className="max-md:[&_button]:h-11">
                        <Button variant="outline" onClick={() => setModalExcluirSelecionados(false)}>
                            Cancelar
                        </Button>
                        <Button variant="destructive" onClick={excluirSelecionados} disabled={excluindoSelecionados}>
                            <Trash2 className="mr-2 h-4 w-4" />
                            {excluindoSelecionados ? "Excluindo..." : `Excluir ${selecionados.size}`}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
