"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { CampanhaMensal } from "@/lib/types/database"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
    DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
    ArrowLeft, Calendar, CheckCircle2, Clock, MapPin, Search, FileText, Loader2, ThumbsUp,
    Download, Pencil, Send, HelpCircle, Undo2, History, FileSpreadsheet, FileType,
} from "lucide-react"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import toast from "react-hot-toast"
import { cn } from "@/lib/utils"
import * as XLSX from "xlsx"
import { pdf } from "@react-pdf/renderer"
import { montarAbasExportacao, nomeArquivoExportacao } from "@/lib/programacao/exportacao"
import { ProgramacaoPdfDocument } from "@/lib/programacao/programacao-pdf"
import { useUser } from "@/lib/auth/user-provider"
import { PGM_GERAL } from "@/lib/rbac/catalogo-programacao-mensal"
import {
    NOMES_CATEGORIAS, ROTULO_STATUS_CATEGORIA, opcaoLiberada, permissoesDaCategoria, podeTransicionarCategoria,
    slugDaCategoria, transicaoExigeMotivo, transicoesPossiveis, type AcaoFluxo, type StatusCategoria,
} from "@/lib/programacao/permissoes-categoria"
import { useChecarPgm } from "@/lib/programacao/use-checar-pgm"

// S-PROG-04 (item 3): uma linha do histórico de transições — join com `colaboradores` pra
// mostrar o nome de quem fez a mudança (Supabase resolve FK many-to-one como objeto único).
interface HistoricoItem {
    id: string
    de_status: string | null
    para_status: string
    motivo: string | null
    criado_em: string
    categoria: string | null
    colaboradores: { nome_completo: string | null }[] | null
}

// S-PROG-04 (item 2): as 4 transições do ciclo passam a ser centralizadas em
// /api/programacao/status — antes "aprovado" fazia update direto no cliente, bypassando
// qualquer checagem de motivo/histórico. Rota valida a transição, bloqueia sem revisão (item 2)
// e grava o histórico (item 3).

export default function CampanhaMensalPage() {
    const params = useParams()
    const router = useRouter()
    const campanhaId = params.id as string

    const [campanha, setCampanha] = useState<CampanhaMensal | null>(null)
    const [atividades, setAtividades] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [isAlterandoStatus, setIsAlterandoStatus] = useState(false)
    const [searchTerm, setSearchTerm] = useState("")
    const [categoriaFilter, setCategoriaFilter] = useState("all")
    const [categoriasUnicas, setCategoriasUnicas] = useState<string[]>([])
    // S-PROG-14: status de cada categoria e a transição que está sendo confirmada (motivo quando exigido).
    const [statusCategorias, setStatusCategorias] = useState<Record<string, StatusCategoria>>({})
    const [historico, setHistorico] = useState<HistoricoItem[]>([])
    const [transicaoAberta, setTransicaoAberta] = useState<{ categoria: string; de: StatusCategoria; para: StatusCategoria; acao: AcaoFluxo } | null>(null)
    const [motivoTransicao, setMotivoTransicao] = useState("")

    const supabase = createClient()

    // S-PROG-13: só as categorias que o perfil pode ver; exportar, histórico e cada transição
    // seguem a opção própria (o servidor confere de novo em /api/programacao/status).
    const { loading: carregandoUsuario } = useUser()
    const checarPgm = useChecarPgm()
    const podeExportar = opcaoLiberada(checarPgm, PGM_GERAL.exportar)
    const podeVerHistorico = opcaoLiberada(checarPgm, PGM_GERAL.historico)
    // Categorias visíveis ao perfil que têm atividade nesta programação, na ordem padrão.
    const categoriasVisiveis = NOMES_CATEGORIAS.filter(nome =>
        atividades.some(a => slugDaCategoria(a.categoria) === slugDaCategoria(nome)))

    useEffect(() => {
        if (campanhaId && !carregandoUsuario) fetchData()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [campanhaId, carregandoUsuario])

    const fetchHistorico = async () => {
        if (!podeVerHistorico) { setHistorico([]); return }
        const { data } = await supabase
            .from("campanha_historico")
            .select("id, de_status, para_status, motivo, criado_em, categoria, colaboradores(nome_completo)")
            .eq("campanha_id", campanhaId)
            .order("criado_em", { ascending: false })
        setHistorico(data || [])
    }

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

            const visiveis = (actData || []).filter(a => permissoesDaCategoria(checarPgm, a.categoria).ver)
            setAtividades(visiveis)

            const { data: stData } = await supabase
                .from("campanha_categoria_status").select("categoria, status").eq("campanha_id", campanhaId)
            setStatusCategorias(Object.fromEntries((stData || []).map(s => [s.categoria as string, s.status as StatusCategoria])))
            if (visiveis) {
                const distinctTags = Array.from(new Set(visiveis.map(a => a.categoria || "Diversos")))
                setCategoriasUnicas(distinctTags as string[])
            }

            await fetchHistorico()
        } catch (error: any) {
            console.error(error)
            toast.error("Erro ao carregar os dados desta planilha.")
        } finally {
            setLoading(false)
        }
    }

    // S-PROG-14: transição de UMA categoria — o servidor confere permissão da categoria, unidade,
    // campos obrigatórios e motivo, grava o histórico e deriva o status da programação. Não mexe no
    // RAG: publicar é o "Aprovar RAG" da Divulgação.
    const executarTransicao = async (categoria: string, para: StatusCategoria, motivo?: string): Promise<boolean> => {
        if (!campanha) return false
        setIsAlterandoStatus(true)
        try {
            const res = await fetch("/api/programacao/status", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ campanha_id: campanha.id, categoria, novoStatus: para, motivo }),
            })
            const data = await res.json()
            if (!res.ok) {
                toast.error(res.status === 409 && data.totalProblemas
                    ? `Não é possível enviar ${categoria}: ${data.totalProblemas} ponto(s) a revisar. Corrija nas atividades antes de tentar de novo.`
                    : data.error || "Erro ao alterar status")
                return false
            }
            setStatusCategorias(prev => ({ ...prev, [categoria]: para }))
            if (data.statusCampanha) setCampanha({ ...campanha, status: data.statusCampanha })
            await fetchHistorico()
            return true
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro ao alterar status")
            return false
        } finally {
            setIsAlterandoStatus(false)
        }
    }

    const ROTULO_ACAO: Record<AcaoFluxo, string> = {
        enviar: "Enviar para autorização",
        autorizar: "Autorizar",
        devolver: "Devolver para ajuste",
        reabrir: "Reabrir",
    }
    const MENSAGEM_SUCESSO: Record<AcaoFluxo, string> = {
        enviar: "enviada para autorização",
        autorizar: "autorizada",
        devolver: "devolvida para ajuste",
        reabrir: "reaberta para edição",
    }

    const confirmarTransicao = async () => {
        if (!transicaoAberta) return
        const { categoria, de, para, acao } = transicaoAberta
        if (transicaoExigeMotivo(de, para) && !motivoTransicao.trim()) {
            toast.error("Informe o motivo.")
            return
        }
        const ok = await executarTransicao(categoria, para, motivoTransicao.trim() || undefined)
        if (ok) {
            toast.success(`${categoria} ${MENSAGEM_SUCESSO[acao]}.`)
            setTransicaoAberta(null)
            setMotivoTransicao("")
        }
    }

    // SQS-44: T3.3/T3.4 — Exportar para Gráfica (.xlsx)
    // S-PROG-05 (item 2): montagem das abas extraída pra `lib/programacao/exportacao.ts`
    // (testável, com teste de snapshot congelando o formato que a gráfica já aceita) — aqui só
    // sobra a parte que só existe no navegador (montar o workbook e disparar o download).
    const handleExportarXLSX = () => {
        if (!campanha || atividades.length === 0) return
        const abas = montarAbasExportacao(campanha, atividades)
        if (abas.length === 0) { toast.error("Nenhuma atividade para exportar."); return }

        const wb = XLSX.utils.book_new()
        for (const aba of abas) {
            const rows = [[aba.tituloVisual], aba.headers, ...aba.linhas]
            const ws = XLSX.utils.aoa_to_sheet(rows)
            XLSX.utils.book_append_sheet(wb, ws, aba.tituloAba)
        }

        const nomeArq = nomeArquivoExportacao(campanha, "xlsx")
        XLSX.writeFile(wb, nomeArq)
        toast.success(`Arquivo ${nomeArq} gerado!`)
    }

    // S-PROG-05 (item 4): PDF de leitura — mesmas abas/linhas do XLSX (item 1: usuário escolhe o
    // formato, nenhum é padrão implícito), textos longos (ementa/informações) com quebra de linha.
    const [gerandoPdf, setGerandoPdf] = useState(false)
    const handleExportarPDF = async () => {
        if (!campanha || atividades.length === 0) return
        const abas = montarAbasExportacao(campanha, atividades)
        if (abas.length === 0) { toast.error("Nenhuma atividade para exportar."); return }

        setGerandoPdf(true)
        try {
            const blob = await pdf(<ProgramacaoPdfDocument campanha={campanha} abas={abas} />).toBlob()
            const nomeArq = nomeArquivoExportacao(campanha, "pdf")
            const url = URL.createObjectURL(blob)
            const a = document.createElement("a")
            a.href = url
            a.download = nomeArq
            a.click()
            URL.revokeObjectURL(url)
            toast.success(`Arquivo ${nomeArq} gerado!`)
        } catch (e) {
            console.error("[handleExportarPDF]", e)
            toast.error("Erro ao gerar o PDF.")
        } finally {
            setGerandoPdf(false)
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
                            {/* Item 6: ajuda no badge de status — o que cada um significa e quem muda */}
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button type="button" tabIndex={-1} className="text-muted-foreground hover:text-foreground" aria-label="O que os status significam">
                                        <HelpCircle className="h-3.5 w-3.5" />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent className="max-w-72 text-xs space-y-1">
                                    <p><strong>Rascunho:</strong> alguma categoria em edição ou aguardando autorização.</p>
                                    <p><strong>Autorizada:</strong> todas as categorias autorizadas; falta aprovar o RAG na Divulgação.</p>
                                    <p><strong>Aprovado:</strong> RAG aprovado na Divulgação — o assistente do WhatsApp responde com este conteúdo.</p>
                                </TooltipContent>
                            </Tooltip>
                        </div>
                        <p className="text-muted-foreground text-sm flex items-center gap-2 mt-1">
                            <MapPin className="h-3.5 w-3.5" />
                            CUCA {campanha.unidade_cuca}
                            <span className="text-border">|</span>
                            {campanha.total_atividades} itens catalogados
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap shrink-0">
                    {campanha.status === "autorizada" && (
                        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30 px-3 py-1.5 text-xs font-semibold">
                            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Todas as categorias autorizadas — aguardando &quot;Aprovar RAG&quot; na Divulgação
                        </Badge>
                    )}
                    {/* S-PROG-05 (item 1): escolha do formato — nenhum é padrão implícito */}
                    {podeExportar && (campanha.status === "aprovado" || campanha.status === "autorizada") && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button variant="outline" className="font-semibold gap-2" disabled={gerandoPdf}>
                                    {gerandoPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                                    <span className="hidden sm:inline">Exportar</span>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={handleExportarXLSX} className="gap-2">
                                    <FileSpreadsheet className="h-4 w-4" /> Exportar .xlsx (gráfica)
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={handleExportarPDF} className="gap-2">
                                    <FileType className="h-4 w-4" /> Exportar .pdf (leitura)
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>
            </div>

            {/* S-PROG-14: autorização por categoria */}
            {categoriasVisiveis.length > 0 && (
                <div className="bg-card p-5 rounded-2xl border border-border space-y-3">
                    <p className="text-sm font-bold flex items-center gap-2">
                        <Send className="h-4 w-4 text-muted-foreground" /> Autorização por categoria
                    </p>
                    <div className="divide-y divide-border/60">
                        {categoriasVisiveis.map(categoria => {
                            const status = statusCategorias[categoria] ?? "rascunho"
                            const acoes = transicoesPossiveis(status).filter(t => podeTransicionarCategoria(checarPgm, categoria, status, t.para))
                            return (
                                <div key={categoria} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2.5">
                                    <div className="flex items-center gap-2.5">
                                        <span className="text-sm font-semibold">{categoria}</span>
                                        <Badge variant="outline" className={cn("text-xs",
                                            status === "autorizada" ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
                                                : status === "aguardando_autorizacao" ? "bg-amber-500/10 text-amber-500 border-amber-500/30"
                                                    : "text-muted-foreground")}>
                                            {ROTULO_STATUS_CATEGORIA[status]}
                                        </Badge>
                                    </div>
                                    <div className="flex gap-2 flex-wrap">
                                        {acoes.map(t => (
                                            <Button
                                                key={t.acao}
                                                size="sm"
                                                variant={t.acao === "autorizar" ? "default" : "outline"}
                                                className={cn(t.acao === "autorizar" && "bg-emerald-600 hover:bg-emerald-700 text-white")}
                                                disabled={isAlterandoStatus}
                                                onClick={() => { setMotivoTransicao(""); setTransicaoAberta({ categoria, de: status, para: t.para, acao: t.acao }) }}
                                            >
                                                {t.acao === "autorizar" ? <ThumbsUp className="h-3.5 w-3.5 mr-1.5" />
                                                    : t.acao === "enviar" ? <Send className="h-3.5 w-3.5 mr-1.5" />
                                                        : t.acao === "reabrir" ? <Undo2 className="h-3.5 w-3.5 mr-1.5" />
                                                            : <Pencil className="h-3.5 w-3.5 mr-1.5" />}
                                                {ROTULO_ACAO[t.acao]}
                                            </Button>
                                        ))}
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                    <p className="text-xs text-muted-foreground">
                        Autorizar não publica no assistente do WhatsApp: o mês entra no ar só pelo &quot;Aprovar RAG&quot; na Divulgação.
                        Reabrir uma categoria de um mês que já está no ar não tira o mês do ar.
                    </p>
                </div>
            )}

            {/* Item 3: histórico visível — linha do tempo de transições, com motivo quando houver */}
            {historico.length > 0 && (
                <div className="bg-card p-5 rounded-2xl border border-border">
                    <p className="text-sm font-bold flex items-center gap-2 mb-3">
                        <History className="h-4 w-4 text-muted-foreground" /> Histórico
                    </p>
                    <div className="space-y-3">
                        {historico.map(h => (
                            <div key={h.id} className="flex items-start gap-3 text-sm">
                                <span className="h-2 w-2 rounded-full bg-primary mt-1.5 shrink-0" />
                                <div>
                                    <p className="font-medium">
                                        {h.categoria ? `${h.categoria}: ` : ""}
                                        {h.de_status ? `${h.de_status} → ${h.para_status}` : `Criada como ${h.para_status}`}
                                        <span className="text-muted-foreground font-normal ml-2">
                                            {format(new Date(h.criado_em), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                                            {h.colaboradores?.[0]?.nome_completo ? ` · ${h.colaboradores[0].nome_completo}` : ""}
                                        </span>
                                    </p>
                                    {h.motivo && (
                                        <p className="text-xs text-amber-500 mt-0.5">Motivo: {h.motivo}</p>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* S-PROG-14: confirmação da transição de categoria (motivo em devolver e reabrir) */}
            <AlertDialog open={!!transicaoAberta} onOpenChange={aberto => { if (!aberto) setTransicaoAberta(null) }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>{transicaoAberta ? `${ROTULO_ACAO[transicaoAberta.acao]} — ${transicaoAberta.categoria}` : ""}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {transicaoAberta?.acao === "enviar" && "A categoria vai para o coordenador e fica somente leitura até ser autorizada ou devolvida."}
                            {transicaoAberta?.acao === "autorizar" && "A categoria fica autorizada. A programação só entra no ar quando o RAG do mês for aprovado na Divulgação."}
                            {transicaoAberta?.acao === "devolver" && "A categoria volta para rascunho. Explique o que precisa ser corrigido — o motivo fica no histórico."}
                            {transicaoAberta?.acao === "reabrir" && "A categoria volta para rascunho para edição. Se o mês já está no ar, ele continua no ar com o conteúdo atual até o RAG ser aprovado de novo."}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {transicaoAberta && transicaoExigeMotivo(transicaoAberta.de, transicaoAberta.para) && (
                        <Textarea
                            placeholder="Motivo (obrigatório)"
                            value={motivoTransicao}
                            onChange={e => setMotivoTransicao(e.target.value)}
                            rows={3}
                        />
                    )}
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={e => { e.preventDefault(); confirmarTransicao() }}
                            disabled={isAlterandoStatus || (!!transicaoAberta && transicaoExigeMotivo(transicaoAberta.de, transicaoAberta.para) && !motivoTransicao.trim())}
                        >
                            Confirmar
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>


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
