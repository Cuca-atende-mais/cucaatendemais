"use client"

import { useEffect, useState, useCallback } from "react"
import { createClient } from "@/lib/supabase/client"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import {
    FileText, Search, Printer, PenLine, Trash2, Link2, Loader2,
    ChevronLeft, ChevronRight,
} from "lucide-react"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import toast from "react-hot-toast"
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog"

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
    empresa_id: string
    unidade_cuca: string | null
    status: string
    empresas: { nome: string } | null
}

const PAGE_SIZE = 25

// ─── Component ───────────────────────────────────────────────────────────────

export default function CvBuilderListPage() {
    const supabase = createClient()
    const router = useRouter()

    const [curriculos, setCurriculos] = useState<CurriculoRow[]>([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState("")
    const [debouncedSearch, setDebouncedSearch] = useState("")
    const [page, setPage] = useState(0)
    const [total, setTotal] = useState(0)

    // Vincular a vagas
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

        let query = supabase
            .from("curriculos")
            .select("*, talent_bank(nome, telefone)", { count: "exact" })
            .is("deleted_at", null)
            .order("updated_at", { ascending: false })
            .range(from, to)

        const { data, error, count } = await query
        if (error) { toast.error("Erro ao carregar currículos"); console.error(error) }
        else {
            setCurriculos((data || []) as unknown as CurriculoRow[])
            setTotal(count ?? 0)
        }
        setLoading(false)
    }, [page])

    useEffect(() => { fetchCurriculos() }, [fetchCurriculos])

    const handleDelete = async (c: CurriculoRow) => {
        const nome = c.talent_bank?.nome ?? "este candidato"
        if (!confirm(`Arquivar currículo de ${nome}? Pode ser restaurado posteriormente.`)) return
        const { error } = await supabase
            .from("curriculos")
            .update({ deleted_at: new Date().toISOString() })
            .eq("id", c.id)
        if (error) { toast.error("Erro ao arquivar"); return }
        toast.success("Currículo arquivado.")
        fetchCurriculos()
    }

    // Carregar vagas abertas globalmente
    const openVincularModal = async (c: CurriculoRow) => {
        setVincularCurriculo(c)
        setVagaSearch("")
        setVagaLoading(true)
        const { data } = await supabase
            .from("vagas")
            .select("id, titulo, unidade_cuca, status, empresa_id, empresas(nome)")
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
        const vagaId = vaga.id

        // Verificar se já existe candidatura deste talento nesta vaga
        const { data: existing } = await supabase
            .from("candidaturas")
            .select("id")
            .eq("vaga_id", vagaId)
            .ilike("observacoes", `%banco_talentos:${talentId}%`)
            .maybeSingle()

        if (existing) {
            toast.error("Este candidato já está vinculado a esta vaga.")
            setVinculando(null)
            return
        }

        // Buscar dados do talento
        const { data: talent } = await supabase
            .from("talent_bank")
            .select("nome, data_nascimento, telefone, arquivo_cv_url, area_interesse")
            .eq("id", talentId)
            .single()

        if (!talent) { toast.error("Talento não encontrado."); setVinculando(null); return }

        const { error } = await supabase.from("candidaturas").insert({
            vaga_id: vagaId,
            nome: talent.nome,
            data_nascimento: talent.data_nascimento || "2000-01-01",
            telefone: talent.telefone || "",
            arquivo_cv_url: talent.arquivo_cv_url || null,
            area_interesse: talent.area_interesse || null,
            observacoes: `banco_talentos:${talentId}`,
            status: "novo",
            requisitos_atendidos: "Encaminhado via Banco de Talentos / CV Builder",
            unidade_cuca: vaga.unidade_cuca || null,
        })

        if (error) { toast.error("Erro ao vincular"); console.error(error) }
        else {
            toast.success(`Candidato vinculado a "${vaga.titulo}" com sucesso!`)
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
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">CV Builder</h1>
                    <p className="text-muted-foreground">Currículos estruturados gerados no balcão do CUCA.</p>
                </div>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <CardTitle>Currículos Ativos</CardTitle>
                            <CardDescription>{total} currículo(s)</CardDescription>
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
                <CardContent>
                    {loading ? (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                        </div>
                    ) : curriculos.length === 0 ? (
                        <p className="text-center py-12 text-muted-foreground">Nenhum currículo encontrado.</p>
                    ) : (
                        <div className="divide-y divide-border">
                            {curriculos.map(c => {
                                const nome = c.talent_bank?.nome ?? "—"
                                const dados = c.dados || {}
                                const temDados = Object.keys(dados).length > 0
                                const atualizado = format(new Date(c.updated_at), "dd/MM/yyyy", { locale: ptBR })
                                return (
                                    <div key={c.id} className="flex items-center gap-4 py-3 px-2 rounded-lg hover:bg-muted/40 transition-colors group">
                                        <div className="w-10 h-10 rounded-full bg-cuca-blue/15 text-cuca-blue flex items-center justify-center text-sm font-bold flex-shrink-0">
                                            {nome.charAt(0).toUpperCase()}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium truncate">{nome}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {dados.objetivo ? `"${String(dados.objetivo).slice(0, 60)}…"` : "Sem objetivo"}
                                                {" · "} Atualizado {atualizado}
                                            </p>
                                        </div>
                                        <Badge variant={temDados ? "default" : "outline"} className={temDados ? "bg-green-500/20 text-green-400 border-green-500/30" : ""}>
                                            {temDados ? "Preenchido" : "Vazio"}
                                        </Badge>
                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                            <Button
                                                variant="ghost" size="icon" title="Editar"
                                                onClick={() => router.push(`/empregabilidade/cv-builder/${c.talent_id}`)}
                                            >
                                                <PenLine className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost" size="icon" title="Imprimir"
                                                onClick={() => router.push(`/empregabilidade/print/${c.id}`)}
                                            >
                                                <Printer className="h-4 w-4" />
                                            </Button>
                                            <Button
                                                variant="ghost" size="icon" title="Vincular a Vaga"
                                                onClick={() => openVincularModal(c)}
                                            >
                                                <Link2 className="h-4 w-4 text-cuca-blue" />
                                            </Button>
                                            <Button
                                                variant="ghost" size="icon" title="Arquivar"
                                                onClick={() => handleDelete(c)}
                                            >
                                                <Trash2 className="h-4 w-4 text-destructive" />
                                            </Button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}

                    {totalPages > 1 && (
                        <div className="flex items-center justify-between pt-4 border-t mt-4">
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

            {/* ── Modal Vincular a Vaga ───────────────────────────────────────── */}
            <Dialog open={!!vincularCurriculo} onOpenChange={o => { if (!o) setVincularCurriculo(null) }}>
                <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
                    <DialogHeader>
                        <DialogTitle>Vincular a Vaga</DialogTitle>
                        <DialogDescription>
                            Candidato: <strong>{vincularCurriculo?.talent_bank?.nome}</strong> — selecione uma vaga aberta em qualquer CUCA.
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
                                    {vinculando === v.id ? <Loader2 className="h-4 w-4 animate-spin" /> : "Vincular"}
                                </Button>
                            </div>
                        ))}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
