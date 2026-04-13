"use client"

import { useEffect, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    Search, Printer, PenLine, Trash2, Link2, Loader2,
    ChevronLeft, ChevronRight, Plus, UserPlus,
} from "lucide-react"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import toast from "react-hot-toast"
import {
    Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
// ─── Types ────────────────────────────────────────────────────────────────────

interface CurriculoRow {
    id: string
    talent_id: string
    dados: Record<string, any>
    deleted_at: string | null
    created_at: string
    updated_at: string
    talent_bank: { nome: string; telefone: string | null } | null
}

interface VagaRow {
    id: string
    titulo: string
    unidade_cuca: string | null
    status: string
    empresas: { nome: string } | null
}

const PAGE_SIZE = 25

const AREAS_INTERESSE = [
    "Comércio e Vendas (vendedor, caixa, atendimento)",
    "Administrativo / Escritório (recepção, auxiliar administrativo)",
    "Logística e Entregas (estoque, separação, entregador, motorista)",
    "Serviços Gerais (limpeza, portaria, zeladoria)",
    "Alimentação (cozinha, garçom, lanchonete)",
    "Criativo / Digital (design, vídeo, redes sociais)",
    "Construção Civil (pedreiro, ajudante, eletricista, encanador)",
    "Tecnologia (suporte técnico, programação, dados)",
    "Beleza e Estética (barbeiro, manicure, cabeleireiro)",
    "Cuidados Pessoais (babá, cuidador de idosos)",
]

// ─── Component ───────────────────────────────────────────────────────────────

export default function CriarCurriculoListPage() {
    const supabase = createClient()
    const router = useRouter()

    const [curriculos, setCurriculos] = useState<CurriculoRow[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")
    const [debouncedSearch, setDebouncedSearch] = useState("")
    const [page, setPage] = useState(0)
    const [total, setTotal] = useState(0)

    // Dialog: Novo Candidato
    const [novoOpen, setNovoOpen] = useState(false)
    const [novoNome, setNovoNome] = useState("")
    const [novoTel, setNovoTel] = useState("")
    const [novoNasc, setNovoNasc] = useState("")
    const [novoArea, setNovoArea] = useState("")
    const [criando, setCriando] = useState(false)

    // Dialog: Vincular a Vaga
    const [vincularCurriculo, setVincularCurriculo] = useState<CurriculoRow | null>(null)
    const [vagas, setVagas] = useState<VagaRow[]>([])
    const [vagaSearch, setVagaSearch] = useState("")
    const [vagaLoading, setVagaLoading] = useState(false)
    const [vinculando, setVinculando] = useState<string | null>(null)

    useEffect(() => {
        const t = setTimeout(() => { setDebouncedSearch(search); setPage(0) }, 400)
        return () => clearTimeout(t)
    }, [search])

    const fetchCurriculos = useCallback(async () => {
        setLoading(true)
        const from = page * PAGE_SIZE
        const to = from + PAGE_SIZE - 1

        const { data, error, count } = await supabase
            .from("curriculos")
            .select("*, talent_bank(nome, telefone)", { count: "exact" })
            .is("deleted_at", null)
            .order("updated_at", { ascending: false })
            .range(from, to)

        if (error) { toast.error("Erro ao carregar currículos"); console.error(error) }
        else {
            setCurriculos((data || []) as unknown as CurriculoRow[])
            setTotal(count ?? 0)
        }
        setLoading(false)
    }, [page])

    useEffect(() => { fetchCurriculos() }, [fetchCurriculos])

    // ── Criar novo candidato + currículo ──────────────────────────────────────

    const handleNovoCandidato = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!novoNome.trim() || !novoTel.trim()) {
            toast.error("Nome e telefone são obrigatórios.")
            return
        }
        setCriando(true)
        try {
            // 1. Criar entrada no Banco de Talentos
            const { data: talent, error: tErr } = await supabase
                .from("talent_bank")
                .insert({
                    nome: novoNome.trim(),
                    telefone: novoTel.trim(),
                    data_nascimento: novoNasc || null,
                    area_interesse: novoArea ? [novoArea] : null,
                    status: "disponivel",
                })
                .select("id")
                .single()

            if (tErr || !talent) throw tErr || new Error("Erro ao criar candidato")

            // 2. Criar currículo vinculado com dados iniciais
            const { error: cErr } = await supabase
                .from("curriculos")
                .insert({
                    talent_id: talent.id,
                    dados: { nome: novoNome.trim(), telefone: novoTel.trim() },
                })

            if (cErr) throw cErr

            toast.success("Candidato criado! Abrindo editor de currículo...")
            setNovoOpen(false)
            setNovoNome(""); setNovoTel(""); setNovoNasc(""); setNovoArea("")
            router.push(`/empregabilidade/criar-curriculo/${talent.id}`)
        } catch (err: any) {
            toast.error(err.message || "Erro ao criar candidato.")
        } finally {
            setCriando(false)
        }
    }

    // ── Soft delete ───────────────────────────────────────────────────────────

    const handleDelete = async (c: CurriculoRow) => {
        const nome = c.talent_bank?.nome ?? "este candidato"
        if (!confirm(`Arquivar currículo de ${nome}?`)) return
        const { error } = await supabase
            .from("curriculos")
            .update({ deleted_at: new Date().toISOString() })
            .eq("id", c.id)
        if (error) { toast.error("Erro ao arquivar"); return }
        toast.success("Currículo arquivado.")
        fetchCurriculos()
    }

    // ── Vincular a vaga ───────────────────────────────────────────────────────

    const openVincularModal = async (c: CurriculoRow) => {
        setVincularCurriculo(c)
        setVagaSearch("")
        setVagaLoading(true)
        const { data } = await supabase
            .from("vagas")
            .select("id, titulo, unidade_cuca, status, empresas(nome)")
            .eq("status", "aberta")
            .order("created_at", { ascending: false })
            .limit(200)
        setVagas((data || []) as unknown as VagaRow[])
        setVagaLoading(false)
    }

    const handleVincular = async (vaga: VagaRow) => {
        if (!vincularCurriculo) return
        setVinculando(vaga.id)
        const talentId = vincularCurriculo.talent_id

        const { data: existing } = await supabase
            .from("candidaturas")
            .select("id")
            .eq("vaga_id", vaga.id)
            .ilike("observacoes", `%banco_talentos:${talentId}%`)
            .maybeSingle()

        if (existing) {
            toast.error("Este candidato já está vinculado a esta vaga.")
            setVinculando(null)
            return
        }

        const { data: talent } = await supabase
            .from("talent_bank")
            .select("nome, data_nascimento, telefone, arquivo_cv_url, area_interesse")
            .eq("id", talentId)
            .single()

        if (!talent) { toast.error("Candidato não encontrado."); setVinculando(null); return }

        const { error } = await supabase.from("candidaturas").insert({
            vaga_id: vaga.id,
            nome: talent.nome,
            data_nascimento: talent.data_nascimento || "2000-01-01",
            telefone: talent.telefone || "",
            arquivo_cv_url: talent.arquivo_cv_url || null,
            area_interesse: talent.area_interesse || null,
            observacoes: `banco_talentos:${talentId}`,
            status: "pendente",
            requisitos_atendidos: "Encaminhado via Criar Currículo",
            unidade_cuca: vaga.unidade_cuca || null,
        })

        if (error) { toast.error("Erro ao encaminhar candidato"); console.error(error) }
        else {
            toast.success(`Candidato encaminhado para "${vaga.titulo}"!`)
            setVincularCurriculo(null)
        }
        setVinculando(null)
    }

    const vagasFiltradas = vagas.filter(v =>
        !vagaSearch ||
        v.titulo.toLowerCase().includes(vagaSearch.toLowerCase()) ||
        (v.empresas?.nome || "").toLowerCase().includes(vagaSearch.toLowerCase()) ||
        (v.unidade_cuca || "").toLowerCase().includes(vagaSearch.toLowerCase())
    )

    const totalPages = Math.ceil(total / PAGE_SIZE)

    return (
        <div className="space-y-6">
            {/* Cabeçalho */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Criar Currículo</h1>
                    <p className="text-muted-foreground">
                        Gere currículos profissionais para os candidatos do CUCA.
                    </p>
                </div>
                <Button
                    className="bg-cuca-yellow hover:bg-yellow-500 font-bold"
                    onClick={() => setNovoOpen(true)}
                >
                    <UserPlus className="mr-2 h-4 w-4" /> Novo Currículo
                </Button>
            </div>

            {/* DataTable */}
            <Card>
                <CardHeader>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <CardTitle>Currículos Criados</CardTitle>
                            <CardDescription>
                                {total} currículo(s) — página {page + 1} de {Math.max(1, totalPages)}
                            </CardDescription>
                        </div>
                        <div className="relative w-full md:w-72">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar candidato..."
                                className="pl-10"
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    {loading ? (
                        <div className="flex items-center justify-center py-16">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : curriculos.length === 0 ? (
                        <div className="text-center py-16 text-muted-foreground">
                            <p>Nenhum currículo encontrado.</p>
                            <Button className="mt-4" variant="outline" onClick={() => setNovoOpen(true)}>
                                <UserPlus className="h-4 w-4 mr-2" /> Criar primeiro currículo
                            </Button>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Candidato</TableHead>
                                        <TableHead className="hidden md:table-cell">Objetivo / Área</TableHead>
                                        <TableHead className="hidden lg:table-cell">Atualizado em</TableHead>
                                        <TableHead>Status</TableHead>
                                        <TableHead className="text-right">Ações</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {curriculos.map(c => {
                                        const nome = c.talent_bank?.nome ?? "—"
                                        const dados = c.dados || {}
                                        const temDados = Object.keys(dados).length > 1 // mais que só {nome, telefone}
                                        const objetivo = dados.objetivo
                                            ? String(dados.objetivo).slice(0, 50) + (dados.objetivo.length > 50 ? "…" : "")
                                            : "—"
                                        const atualizado = format(new Date(c.updated_at), "dd/MM/yyyy", { locale: ptBR })
                                        return (
                                            <TableRow key={c.id} className="group">
                                                <TableCell>
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-8 h-8 rounded-full bg-cuca-blue/15 text-cuca-blue flex items-center justify-center text-xs font-bold flex-shrink-0">
                                                            {nome.charAt(0).toUpperCase()}
                                                        </div>
                                                        <div>
                                                            <p className="font-medium text-sm">{nome}</p>
                                                            <p className="text-xs text-muted-foreground">{c.talent_bank?.telefone || "—"}</p>
                                                        </div>
                                                    </div>
                                                </TableCell>
                                                <TableCell className="hidden md:table-cell text-sm text-muted-foreground max-w-[200px] truncate">
                                                    {objetivo}
                                                </TableCell>
                                                <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                                                    {atualizado}
                                                </TableCell>
                                                <TableCell>
                                                    <Badge variant="outline" className={temDados
                                                        ? "bg-green-500/10 text-green-400 border-green-500/30"
                                                        : "bg-zinc-500/10 text-zinc-400 border-zinc-500/30"
                                                    }>
                                                        {temDados ? "Preenchido" : "Em branco"}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <Button
                                                            variant="ghost" size="icon"
                                                            title="Editar currículo"
                                                            onClick={() => router.push(`/empregabilidade/criar-curriculo/${c.talent_id}`)}
                                                        >
                                                            <PenLine className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            variant="ghost" size="icon"
                                                            title="Imprimir / Salvar PDF"
                                                            onClick={() => router.push(`/empregabilidade/print/${c.id}`)}
                                                        >
                                                            <Printer className="h-4 w-4" />
                                                        </Button>
                                                        <Button
                                                            variant="ghost" size="icon"
                                                            title="Encaminhar para vaga"
                                                            onClick={() => openVincularModal(c)}
                                                        >
                                                            <Link2 className="h-4 w-4 text-cuca-blue" />
                                                        </Button>
                                                        <Button
                                                            variant="ghost" size="icon"
                                                            title="Arquivar currículo"
                                                            onClick={() => handleDelete(c)}
                                                        >
                                                            <Trash2 className="h-4 w-4 text-destructive" />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            </TableRow>
                                        )
                                    })}
                                </TableBody>
                            </Table>
                        </div>
                    )}

                    {/* Paginação */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-between px-6 py-4 border-t">
                            <span className="text-xs text-muted-foreground">
                                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total}
                            </span>
                            <div className="flex items-center gap-2">
                                <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
                                    <ChevronLeft className="h-4 w-4" />
                                </Button>
                                <span className="text-xs tabular-nums">{page + 1} / {totalPages}</span>
                                <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>
                                    <ChevronRight className="h-4 w-4" />
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* ── Dialog: Novo Candidato ──────────────────────────────────────── */}
            <Dialog open={novoOpen} onOpenChange={o => { if (!o) setNovoOpen(false) }}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Novo Currículo</DialogTitle>
                        <DialogDescription>
                            Preencha os dados básicos do candidato. O currículo completo será criado a seguir.
                        </DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleNovoCandidato} className="space-y-4 pt-2">
                        <div className="space-y-1.5">
                            <Label htmlFor="nc-nome">Nome Completo *</Label>
                            <Input
                                id="nc-nome"
                                value={novoNome}
                                onChange={e => setNovoNome(e.target.value)}
                                placeholder="Nome do candidato"
                                required
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="nc-tel">Telefone / WhatsApp *</Label>
                            <Input
                                id="nc-tel"
                                value={novoTel}
                                onChange={e => setNovoTel(e.target.value)}
                                placeholder="(85) 99999-9999"
                                required
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="nc-nasc">Data de Nascimento</Label>
                            <Input
                                id="nc-nasc"
                                type="date"
                                value={novoNasc}
                                onChange={e => setNovoNasc(e.target.value)}
                                max={new Date().toISOString().split("T")[0]}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <Label htmlFor="nc-area">Área de Interesse</Label>
                            <Select value={novoArea} onValueChange={setNovoArea}>
                                <SelectTrigger id="nc-area">
                                    <SelectValue placeholder="Selecione a área" />
                                </SelectTrigger>
                                <SelectContent>
                                    {AREAS_INTERESSE.map(a => (
                                        <SelectItem key={a} value={a}>{a.split(" (")[0]}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex justify-end gap-3 pt-2">
                            <Button type="button" variant="outline" onClick={() => setNovoOpen(false)}>Cancelar</Button>
                            <Button
                                type="submit"
                                className="bg-cuca-yellow hover:bg-yellow-500 font-bold"
                                disabled={criando}
                            >
                                {criando ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserPlus className="h-4 w-4 mr-2" />}
                                Criar e Abrir Editor
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>

            {/* ── Dialog: Vincular a Vaga ─────────────────────────────────────── */}
            <Dialog open={!!vincularCurriculo} onOpenChange={o => { if (!o) setVincularCurriculo(null) }}>
                <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Encaminhar para Vaga</DialogTitle>
                        <DialogDescription>
                            Candidato: <strong>{vincularCurriculo?.talent_bank?.nome}</strong> — selecione uma vaga em aberto.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="relative mb-3">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder="Buscar por título, empresa ou unidade..."
                            className="pl-10"
                            value={vagaSearch}
                            onChange={e => setVagaSearch(e.target.value)}
                        />
                    </div>
                    <div className="overflow-y-auto flex-1 divide-y divide-border border rounded-lg">
                        {vagaLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        ) : vagasFiltradas.length === 0 ? (
                            <p className="text-center py-8 text-muted-foreground text-sm">Nenhuma vaga encontrada.</p>
                        ) : vagasFiltradas.map(v => (
                            <div key={v.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
                                <div className="flex-1 min-w-0">
                                    <p className="font-medium text-sm truncate">{v.titulo}</p>
                                    <p className="text-xs text-muted-foreground">
                                        {v.empresas?.nome || "Empresa"} · {v.unidade_cuca || "Todas as unidades"}
                                    </p>
                                </div>
                                <Button
                                    size="sm"
                                    disabled={vinculando === v.id}
                                    onClick={() => handleVincular(v)}
                                >
                                    {vinculando === v.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Encaminhar"}
                                </Button>
                            </div>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
