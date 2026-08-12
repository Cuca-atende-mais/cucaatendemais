"use client"

// SQS-56 (ajuste pós-review do Junior): página dedicada de uma seleção por
// evento. Substitui o modal de detalhe — mesma estrutura de
// `vagas/[id]/page.tsx` (cabeçalho + dados + grid de candidatos), incluindo o
// CRUD de status que faltava (rascunho → publicar → preenchida/cancelada).

import { useState, useCallback, useMemo } from "react"
import { useParams, useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase/client"
import { Vaga, Candidatura, Empresa } from "@/lib/types/database"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
    AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
    AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
    ArrowLeft, Loader2, PenLine, Plus, Trash2, MessageSquare, Users, CalendarDays,
    MapPin, Building2, FileText, FileX2, Info, Briefcase, CheckCircle2, XCircle,
    Send, RotateCcw, Phone,
} from "lucide-react"
import toast from "react-hot-toast"
import { SelecaoModal } from "@/components/empregabilidade/selecao-modal"
import { useUser } from "@/lib/auth/user-provider"
import { mascaraTelefone } from "@/lib/utils"

const STATUS_CANDIDATO = [
    { value: "pendente", label: "Pendente" },
    { value: "selecionado", label: "Selecionado" },
    { value: "contratado", label: "Contratado" },
    { value: "rejeitado", label: "Rejeitado" },
]

const STATUS_VAGA: Record<string, { label: string; className: string }> = {
    aberta: { label: "Aberta / Pública", className: "bg-green-500/15 text-green-400 border-green-500/30" },
    pre_cadastro: { label: "Rascunho", className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    preenchida: { label: "Preenchida", className: "bg-blue-500/15 text-blue-400 border-blue-500/30" },
    cancelada: { label: "Cancelada", className: "bg-red-500/15 text-red-400 border-red-500/30" },
}

function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback
}

function formatarData(iso: string | undefined): string {
    if (!iso) return ""
    const p = iso.split("-")
    return p.length === 3 ? `${p[2]}/${p[1]}/${p[0]}` : iso
}

export default function SelecaoDetalhePage() {
    const params = useParams()
    const selecaoId = params.id as string
    const router = useRouter()
    const supabase = createClient()
    const qc = useQueryClient()
    const { hasPermission } = useUser()

    const [editOpen, setEditOpen] = useState(false)
    const [feedbackLoading, setFeedbackLoading] = useState(false)
    const [statusVagaLoading, setStatusVagaLoading] = useState(false)
    const [savingStatusId, setSavingStatusId] = useState<string | null>(null)
    const [removendo, setRemovendo] = useState<Candidatura | null>(null)
    const [removeLoading, setRemoveLoading] = useState(false)

    // CRUD manual (AC13)
    const [manualOpen, setManualOpen] = useState(false)
    const [manualNome, setManualNome] = useState("")
    const [manualTelefone, setManualTelefone] = useState("")
    const [manualCargo, setManualCargo] = useState("")
    const [manualSaving, setManualSaving] = useState(false)

    // useMemo: sem isso o array é recriado a cada render e invalida o
    // useCallback de `invalidate` toda vez.
    const QUERY_KEY = useMemo(() => ["empregabilidade", "selecao", selecaoId] as const, [selecaoId])

    const { data, isLoading } = useQuery({
        queryKey: QUERY_KEY,
        queryFn: async () => {
            const { data: vaga, error } = await supabase
                .from("vagas").select("*").eq("id", selecaoId).single()
            if (error) throw error

            let empresa: Empresa | null = null
            if (vaga.empresa_id) {
                const { data: emp } = await supabase
                    .from("empresas").select("*").eq("id", vaga.empresa_id).maybeSingle()
                empresa = (emp as Empresa) ?? null
            }

            const { data: cands } = await supabase
                .from("candidaturas").select("*").eq("vaga_id", selecaoId)
                .order("created_at", { ascending: false })

            return {
                vaga: vaga as Vaga,
                empresa,
                candidatos: (cands || []) as Candidatura[],
            }
        },
    })

    const vaga = data?.vaga
    const empresa = data?.empresa
    const candidatos = data?.candidatos ?? []
    const invalidate = useCallback(() => { void qc.invalidateQueries({ queryKey: QUERY_KEY }) }, [qc, QUERY_KEY])

    const empresaNome = empresa?.nome_fantasia || empresa?.nome || "—"
    const cargos = vaga?.cargos_lista || []
    const datas = vaga?.datas_selecao || []
    const podeEditar = hasPermission("empreg_selecao", "update")

    // ── CRUD de status da seleção (o que faltava) ────────────────────────────
    const alterarStatusVaga = async (novoStatus: string) => {
        setStatusVagaLoading(true)
        try {
            const { error } = await supabase.from("vagas").update({ status: novoStatus }).eq("id", selecaoId)
            if (error) throw error
            toast.success(`Seleção marcada como "${STATUS_VAGA[novoStatus]?.label || novoStatus}".`)
            invalidate()
            void qc.invalidateQueries({ queryKey: ["empregabilidade", "selecoes"] })
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, "Erro ao alterar status da seleção."))
        } finally {
            setStatusVagaLoading(false)
        }
    }

    const alterarStatusCandidato = async (candidaturaId: string, novoStatus: string) => {
        setSavingStatusId(candidaturaId)
        const { error } = await supabase.from("candidaturas").update({ status: novoStatus }).eq("id", candidaturaId)
        if (error) toast.error("Erro ao atualizar status do candidato.")
        else invalidate()
        setSavingStatusId(null)
    }

    const confirmarRemocao = async () => {
        if (!removendo) return
        setRemoveLoading(true)
        const { error } = await supabase.from("candidaturas").delete().eq("id", removendo.id)
        if (error) toast.error("Erro ao remover candidato.")
        else { toast.success(`${removendo.nome} removido(a) da lista.`); invalidate() }
        setRemoveLoading(false)
        setRemovendo(null)
    }

    const adicionarManual = async () => {
        if (!manualNome.trim()) { toast.error("Informe o nome completo."); return }
        if (!manualTelefone.trim()) { toast.error("Informe o telefone."); return }
        setManualSaving(true)
        try {
            const telefoneDigitos = manualTelefone.replace(/\D/g, "")
            const { error } = await supabase.from("candidaturas").insert({
                vaga_id: selecaoId,
                nome: manualNome.trim(),
                telefone: telefoneDigitos,
                telefone_contato: telefoneDigitos,
                cargo_escolhido: manualCargo || null,
                status: "pendente",
                confirmacao_presenca: "confirmado",
                observacoes: "Incluído manualmente (outro canal)",
            })
            if (error) throw error
            toast.success(`${manualNome} adicionado(a) à lista.`)
            setManualNome(""); setManualTelefone(""); setManualCargo(""); setManualOpen(false)
            invalidate()
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, "Erro ao adicionar candidato."))
        } finally {
            setManualSaving(false)
        }
    }

    const solicitarFeedback = async () => {
        setFeedbackLoading(true)
        try {
            const res = await fetch(`/api/empregabilidade/vagas/${selecaoId}/solicitar-feedback`, { method: "POST" })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Erro ao solicitar feedback")
            toast.success("Solicitação de feedback enviada via WhatsApp!")
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, "Falha ao solicitar feedback."))
        } finally {
            setFeedbackLoading(false)
        }
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (!vaga) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
                <p className="text-muted-foreground">Seleção não encontrada.</p>
                <Button variant="outline" onClick={() => router.push("/empregabilidade/selecoes")}>
                    <ArrowLeft className="h-4 w-4 mr-2" /> Voltar para Seleções
                </Button>
            </div>
        )
    }

    const totalVagas = cargos.reduce((acc, c) => acc + (parseInt(String(c.quantidade)) || 0), 0)
    const contratados = candidatos.filter(c => c.status === "contratado").length
    const statusCfg = STATUS_VAGA[vaga.status]

    return (
        <div className="space-y-6 pb-10">

            {/* ── Navegação ── */}
            <div className="flex items-center gap-3">
                <Button variant="outline" size="icon" onClick={() => router.push("/empregabilidade/selecoes")}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Empregabilidade / Seleções</p>
                    <h1 className="text-xl font-bold leading-tight truncate">{vaga.titulo}</h1>
                </div>
            </div>

            {/* ── Cabeçalho da Seleção ── */}
            <Card className="border-none shadow-sm">
                <CardContent className="p-5 space-y-4">
                    <div className="flex flex-wrap items-start gap-3 justify-between">
                        <div className="space-y-1.5">
                            <div className="flex items-center gap-2 flex-wrap">
                                <Badge variant="outline" className={statusCfg?.className}>
                                    {statusCfg?.label || vaga.status}
                                </Badge>
                                {vaga.numero_vaga && (
                                    <span className="text-xs text-muted-foreground font-mono bg-muted px-2 py-0.5 rounded">
                                        #{vaga.numero_vaga}
                                    </span>
                                )}
                                {vaga.coleta_curriculo ? (
                                    <Badge variant="outline" className="gap-1 text-xs">
                                        <FileText className="h-3 w-3" /> Com currículo prévio
                                    </Badge>
                                ) : (
                                    <Badge variant="outline" className="gap-1 text-xs text-amber-600 border-amber-500/40 bg-amber-500/10">
                                        <FileX2 className="h-3 w-3" /> Só presença
                                    </Badge>
                                )}
                            </div>
                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                <Building2 className="h-3.5 w-3.5" />
                                <span>{empresaNome}</span>
                            </div>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Users className="h-4 w-4" />
                            <span>{contratados} / {totalVagas || "—"} posições preenchidas</span>
                        </div>
                    </div>

                    {/* Dados da seleção */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 pt-1">
                        <div className="flex items-start gap-2 text-sm">
                            <CalendarDays className="h-3.5 w-3.5 text-cuca-blue flex-shrink-0 mt-0.5" />
                            <div className="flex flex-col">
                                {datas.length === 0 ? <span className="text-muted-foreground">Sem data definida</span> : datas.map((d, i) => (
                                    <span key={i}>{formatarData(d.data)}{d.hora ? ` às ${d.hora}` : ""}</span>
                                ))}
                            </div>
                        </div>
                        {vaga.local_entrevista && (
                            <div className="flex items-start gap-2 text-sm">
                                <MapPin className="h-3.5 w-3.5 text-cuca-blue flex-shrink-0 mt-0.5" />
                                <span>{vaga.local_entrevista}</span>
                            </div>
                        )}
                        <div className="flex items-start gap-2 text-sm">
                            <Info className="h-3.5 w-3.5 text-cuca-blue flex-shrink-0 mt-0.5" />
                            <span>{vaga.unidade_destino === "global" ? "Toda a Rede CUCA" : (vaga.unidade_cuca || "Unidade não definida")}</span>
                        </div>
                        {vaga.observacoes_selecao && (
                            <div className="flex items-start gap-2 text-sm sm:col-span-2 lg:col-span-3">
                                <FileText className="h-3.5 w-3.5 text-cuca-blue flex-shrink-0 mt-0.5" />
                                <span className="text-muted-foreground">{vaga.observacoes_selecao}</span>
                            </div>
                        )}
                    </div>

                    {/* Ações — inclui o CRUD de status que faltava */}
                    {podeEditar && (
                        <div className="flex flex-wrap gap-2 pt-3 border-t">
                            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                                <PenLine className="h-3.5 w-3.5 mr-1.5" /> Editar seleção
                            </Button>

                            {vaga.status === "pre_cadastro" && (
                                <Button
                                    size="sm"
                                    className="bg-green-600 hover:bg-green-700 text-white"
                                    disabled={statusVagaLoading}
                                    onClick={() => alterarStatusVaga("aberta")}
                                >
                                    {statusVagaLoading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1.5" />}
                                    Publicar seleção
                                </Button>
                            )}
                            {vaga.status === "aberta" && (
                                <>
                                    <Button variant="outline" size="sm" disabled={statusVagaLoading}
                                        className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                                        onClick={() => alterarStatusVaga("preenchida")}>
                                        <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Marcar como preenchida
                                    </Button>
                                    <Button variant="outline" size="sm" disabled={statusVagaLoading}
                                        className="border-amber-500/30 text-amber-500 hover:bg-amber-500/10"
                                        onClick={() => alterarStatusVaga("pre_cadastro")}>
                                        <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Voltar para rascunho
                                    </Button>
                                </>
                            )}
                            {(vaga.status === "preenchida" || vaga.status === "cancelada") && (
                                <Button variant="outline" size="sm" disabled={statusVagaLoading}
                                    className="border-green-500/30 text-green-400 hover:bg-green-500/10"
                                    onClick={() => alterarStatusVaga("aberta")}>
                                    <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Reabrir seleção
                                </Button>
                            )}
                            {vaga.status !== "cancelada" && (
                                <Button variant="outline" size="sm" disabled={statusVagaLoading}
                                    className="border-destructive/30 text-destructive hover:bg-destructive/10"
                                    onClick={() => alterarStatusVaga("cancelada")}>
                                    <XCircle className="h-3.5 w-3.5 mr-1.5" /> Cancelar seleção
                                </Button>
                            )}

                            <Button
                                variant="outline" size="sm"
                                className="border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10 ml-auto"
                                onClick={solicitarFeedback}
                                disabled={feedbackLoading}
                            >
                                {feedbackLoading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <MessageSquare className="h-3.5 w-3.5 mr-1.5" />}
                                Solicitar feedback da empresa
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* ── Cargos ── */}
            <Card className="border-none shadow-sm">
                <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                        <Briefcase className="h-4 w-4 text-cuca-blue" /> Cargos ofertados
                        <Badge variant="secondary" className="ml-1 text-xs">{cargos.length}</Badge>
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    {cargos.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nenhum cargo cadastrado.</p>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                            {cargos.map((c, i) => {
                                const inscritos = candidatos.filter(x => x.cargo_escolhido === c.titulo).length
                                return (
                                    <div key={i} className="flex items-center justify-between gap-2 border rounded-lg px-3 py-2 bg-muted/20">
                                        <div className="min-w-0">
                                            <p className="text-sm font-medium truncate">{c.titulo}</p>
                                            <p className="text-xs text-muted-foreground">{c.faixa_etaria}</p>
                                        </div>
                                        <div className="text-right flex-shrink-0">
                                            <p className="text-sm font-semibold tabular-nums">{inscritos}/{c.quantidade}</p>
                                            <p className="text-[10px] text-muted-foreground">inscritos</p>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* ── Candidatos confirmados ── */}
            <Card className="border-none shadow-sm">
                <CardHeader className="pb-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                        <CardTitle className="text-base flex items-center gap-2">
                            <Users className="h-4 w-4 text-cuca-blue" /> Lista de presença
                            <Badge variant="secondary" className="ml-1 text-xs">{candidatos.length}</Badge>
                        </CardTitle>
                        {podeEditar && (
                            <Button variant="outline" size="sm" onClick={() => setManualOpen(o => !o)}>
                                <Plus className="h-3.5 w-3.5 mr-1.5" /> Incluir manualmente
                            </Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="space-y-3">
                    {manualOpen && (
                        <div className="border rounded-lg p-3 space-y-3 bg-muted/20">
                            <p className="text-xs text-muted-foreground">
                                Para candidatos que vieram por outro canal (redes sociais, presencial).
                            </p>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                                <div className="space-y-1">
                                    <Label className="text-xs">Nome completo *</Label>
                                    <Input value={manualNome} onChange={e => setManualNome(e.target.value)} placeholder="Nome do candidato" />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Telefone *</Label>
                                    <Input
                                        value={manualTelefone}
                                        onChange={e => setManualTelefone(mascaraTelefone(e.target.value))}
                                        placeholder="(85) 99999-9999"
                                    />
                                </div>
                                <div className="space-y-1">
                                    <Label className="text-xs">Cargo</Label>
                                    <Select value={manualCargo} onValueChange={setManualCargo}>
                                        <SelectTrigger><SelectValue placeholder="Selecione (opcional)" /></SelectTrigger>
                                        <SelectContent>
                                            {cargos.map(c => <SelectItem key={c.titulo} value={c.titulo}>{c.titulo}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                            <div className="flex justify-end gap-2">
                                <Button variant="ghost" size="sm" onClick={() => setManualOpen(false)}>Cancelar</Button>
                                <Button size="sm" onClick={adicionarManual} disabled={manualSaving}>
                                    {manualSaving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
                                    Adicionar
                                </Button>
                            </div>
                        </div>
                    )}

                    <div className="border rounded-lg overflow-hidden">
                        <Table className="table-fixed w-full">
                            <TableHeader className="bg-muted/30">
                                <TableRow>
                                    <TableHead className="w-[28%]">Nome</TableHead>
                                    <TableHead className="w-[18%]">Telefone</TableHead>
                                    <TableHead className="w-[22%]">Cargo</TableHead>
                                    <TableHead className="w-[14%]">Presença</TableHead>
                                    <TableHead className="w-[15%]">Status</TableHead>
                                    <TableHead className="w-12"></TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {candidatos.length === 0 ? (
                                    <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground text-sm">
                                        Nenhum candidato confirmado ainda.
                                    </TableCell></TableRow>
                                ) : candidatos.map(c => (
                                    <TableRow key={c.id}>
                                        <TableCell className="max-w-0">
                                            <span className="font-medium truncate block">{c.nome}</span>
                                            {c.observacoes?.includes("manualmente") && (
                                                <span className="text-[10px] text-muted-foreground">incluído manualmente</span>
                                            )}
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">
                                            <span className="inline-flex items-center gap-1.5">
                                                <Phone className="h-3 w-3 flex-shrink-0" />
                                                {c.telefone_contato || c.telefone || "—"}
                                            </span>
                                        </TableCell>
                                        <TableCell className="max-w-0">
                                            <span className="text-sm truncate block">{c.cargo_escolhido || "—"}</span>
                                        </TableCell>
                                        <TableCell>
                                            {c.confirmacao_presenca === "confirmado" ? (
                                                <Badge variant="outline" className="bg-green-500/10 text-green-400 border-green-500/30 text-xs">Confirmada</Badge>
                                            ) : c.confirmacao_presenca === "recusado" ? (
                                                <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30 text-xs">Recusada</Badge>
                                            ) : (
                                                <Badge variant="outline" className="text-muted-foreground text-xs">—</Badge>
                                            )}
                                        </TableCell>
                                        <TableCell>
                                            <Select
                                                value={c.status}
                                                onValueChange={v => alterarStatusCandidato(c.id, v)}
                                                disabled={!podeEditar || savingStatusId === c.id}
                                            >
                                                <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                                <SelectContent>
                                                    {STATUS_CANDIDATO.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            {podeEditar && (
                                                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                                                    onClick={() => setRemovendo(c)}>
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </Button>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>

            <SelecaoModal
                open={editOpen}
                onOpenChange={setEditOpen}
                onSuccess={() => {
                    invalidate()
                    void qc.invalidateQueries({ queryKey: ["empregabilidade", "selecoes"] })
                }}
                selecao={vaga}
            />

            <AlertDialog open={removendo !== null} onOpenChange={o => { if (!o) setRemovendo(null) }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Remover da lista de presença?</AlertDialogTitle>
                        <AlertDialogDescription>
                            <strong>{removendo?.nome}</strong> será removido(a) permanentemente desta seleção.
                            Esta ação não pode ser desfeita.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={removeLoading}>Cancelar</AlertDialogCancel>
                        <AlertDialogAction
                            onClick={confirmarRemocao}
                            disabled={removeLoading}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                            {removeLoading ? "Removendo..." : "Sim, remover"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}
