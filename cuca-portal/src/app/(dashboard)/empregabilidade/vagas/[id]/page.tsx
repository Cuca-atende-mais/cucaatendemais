"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Vaga, Candidatura, EmpregabilidadeFollowup } from "@/lib/types/database"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
    ArrowLeft, FileText, CheckCircle2, UserCheck, UserX, AlertCircle, Loader2,
    FileTerminal, Eye, MoreHorizontal, Sparkles, Plus, MessageSquare, Send,
    Building2, User, Info
} from "lucide-react"
import toast from "react-hot-toast"
import { differenceInYears, format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { MatchModal } from "@/components/empregabilidade/match-modal"
import { mascaraTelefone, limparTelefone } from "@/lib/utils"

export default function VagaDetalhesPage() {
    const params = useParams()
    const router = useRouter()
    const id = params.id as string
    const supabase = createClient()

    const [vaga, setVaga] = useState<Vaga | null>(null)
    const [candidatos, setCandidatos] = useState<Candidatura[]>([])
    const [loading, setLoading] = useState(true)

    // Match modal
    const [selectedCandidato, setSelectedCandidato] = useState<any>(null)
    const [isMatchModalOpen, setIsMatchModalOpen] = useState(false)

    // S12-06: mensagem de fechamento
    const [msgFechamento, setMsgFechamento] = useState<{ candidato: Candidatura } | null>(null)

    // S12-07: follow-up Sheet
    const [followupSheet, setFollowupSheet] = useState<Candidatura | null>(null)
    const [followups, setFollowups] = useState<EmpregabilidadeFollowup[]>([])
    const [loadingFollowup, setLoadingFollowup] = useState(false)
    const [novoFollowup, setNovoFollowup] = useState({ tipo: "interno" as const, mensagem: "" })
    const [enviandoFollowup, setEnviandoFollowup] = useState(false)

    // S12-10: inscrição manual
    const [modalInscricao, setModalInscricao] = useState(false)
    const [inscricaoForm, setInscricaoForm] = useState({ nome: "", telefone: "", data_nascimento: "" })
    const [criandoInscricao, setCriandoInscricao] = useState(false)

    useEffect(() => {
        if (id) fetchData()
    }, [id])

    const fetchData = async () => {
        setLoading(true)
        try {
            const [{ data: vData, error: vErr }, { data: cData, error: cErr }] = await Promise.all([
                supabase.from("vagas").select("*").eq("id", id).single(),
                supabase.from("candidaturas").select("*").eq("vaga_id", id).order("created_at", { ascending: false }),
            ])
            if (vErr) throw vErr
            if (cErr) throw cErr
            setVaga(vData)
            setCandidatos(cData || [])
        } catch (error) {
            console.error("Erro ao buscar dados:", error)
            toast.error("Erro ao carregar vaga")
        } finally {
            setLoading(false)
        }
    }

    const calcularIdade = (dataStr: string | null) => {
        if (!dataStr) return "-"
        return differenceInYears(new Date(), new Date(dataStr)) + " anos"
    }

    // S12-05/06: ao marcar selecionado → enviar CV + exibir mensagem fechamento
    const handleUpdateStatus = async (candidaturaId: string, novoStatus: string, candidatura?: Candidatura) => {
        try {
            const { error } = await supabase.from("candidaturas").update({ status: novoStatus }).eq("id", candidaturaId)
            if (error) throw error

            // S12-05: enviar CV por email ao selecionar
            if (novoStatus === "selecionado" && candidatura) {
                const { data: { session } } = await supabase.auth.getSession()
                fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-cv-email`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${session?.access_token}`,
                    },
                    body: JSON.stringify({ candidatura_id: candidaturaId }),
                }).then(r => r.json()).then(result => {
                    if (result.success) toast.success("CV enviado para a empresa por email!")
                    else if (result.motivo) console.info("[send-cv-email]", result.motivo)
                }).catch(err => console.error("[send-cv-email]", err))

                // S12-06: exibir mensagem de fechamento
                setMsgFechamento({ candidato: candidatura })

                // S16-05: disparar WhatsApp de aprovação em background
                if (candidatura?.telefone && vaga) {
                    fetch("/api/empregabilidade/notificar-selecionado", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            candidatura_id: candidaturaId,
                            nome: candidatura.nome,
                            telefone: candidatura.telefone,
                            titulo_vaga: vaga.titulo,
                            unidade_cuca: vaga.unidade_cuca,
                        }),
                    }).then(r => r.json()).then(result => {
                        if (result.ok) toast.success("WhatsApp enviado ao candidato!")
                        else console.info("[S16-05]", result.motivo || result.error)
                    }).catch(err => console.error("[S16-05]", err))
                }
            }

            if (novoStatus === "rejeitado") toast.success("Candidato movido para o Banco de Talentos.")
            if (novoStatus === "contratado" && vaga) {
                const contratados = candidatos.filter(c => c.status === "contratado").length + 1
                if (contratados >= vaga.total_vagas) {
                    await supabase.from("vagas").update({ status: "preenchida" }).eq("id", vaga.id)
                    toast.success("Todas as vagas preenchidas! Vaga encerrada.", { duration: 5000 })
                    setVaga({ ...vaga, status: "preenchida" })
                }
            }

            toast.success("Status atualizado.")
            fetchData()
        } catch (error: any) {
            toast.error(error.message || "Falha ao mudar status.")
        }
    }

    const refreshOcr = async (candidaturaId: string, cvUrl: string) => {
        toast.loading("Re-processando OCR...", { id: "ocr" })
        try {
            const res = await fetch("/api/process-cv", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ candidatura_id: candidaturaId, vaga_id: vaga?.id, cv_url: cvUrl }),
            })
            if (!res.ok) throw new Error("Erro na API")
            toast.success("OCR reiniciado.", { id: "ocr" })
            setTimeout(fetchData, 8000)
        } catch {
            toast.error("Falha ao chamar motor", { id: "ocr" })
        }
    }

    // S12-07: abrir sheet de follow-up
    const abrirFollowup = async (candidatura: Candidatura) => {
        setFollowupSheet(candidatura)
        setLoadingFollowup(true)
        const { data, error } = await supabase
            .from("empregabilidade_followup")
            .select("*")
            .eq("candidatura_id", candidatura.id)
            .order("created_at", { ascending: true })
        if (!error) setFollowups(data || [])
        setLoadingFollowup(false)
    }

    const adicionarFollowup = async () => {
        if (!followupSheet || !novoFollowup.mensagem.trim()) return
        setEnviandoFollowup(true)
        try {
            const { error } = await supabase.from("empregabilidade_followup").insert({
                candidatura_id: followupSheet.id,
                tipo: novoFollowup.tipo,
                mensagem: novoFollowup.mensagem.trim(),
                status: "enviado",
            })
            if (error) throw error
            setNovoFollowup({ tipo: "interno", mensagem: "" })
            const { data } = await supabase
                .from("empregabilidade_followup")
                .select("*")
                .eq("candidatura_id", followupSheet.id)
                .order("created_at", { ascending: true })
            setFollowups(data || [])
            toast.success("Registro adicionado")
        } catch (err: any) {
            toast.error("Erro: " + err.message)
        } finally {
            setEnviandoFollowup(false)
        }
    }

    // S12-10: inscrição manual
    const criarInscricaoManual = async () => {
        if (!inscricaoForm.nome.trim() || !inscricaoForm.telefone.trim()) {
            toast.error("Nome e telefone são obrigatórios")
            return
        }
        setCriandoInscricao(true)
        try {
            const { error } = await supabase.from("candidaturas").insert({
                vaga_id: id,
                nome: inscricaoForm.nome.trim(),
                telefone: inscricaoForm.telefone.trim(),
                data_nascimento: inscricaoForm.data_nascimento || null,
                status: "pendente",
                requisitos_atendidos: "Inscrito manualmente por colaborador CUCA",
            })
            if (error) throw error
            toast.success("Candidato inscrito com sucesso")
            setModalInscricao(false)
            setInscricaoForm({ nome: "", telefone: "", data_nascimento: "" })
            fetchData()
        } catch (err: any) {
            toast.error("Erro: " + err.message)
        } finally {
            setCriandoInscricao(false)
        }
    }

    const tipoFollowupLabel = (tipo: string) => {
        if (tipo === "empresa") return { label: "Empresa", color: "bg-blue-100 text-blue-800", icon: Building2 }
        if (tipo === "candidato") return { label: "Candidato", color: "bg-green-100 text-green-800", icon: User }
        return { label: "Interno", color: "bg-muted text-muted-foreground", icon: Info }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="outline" size="icon" onClick={() => router.push("/empregabilidade/vagas")}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">{vaga?.titulo || "Detalhes da Vaga"}</h1>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                        {vaga?.status === "aberta" ? <Badge className="bg-green-600">Aberta</Badge> : <Badge variant="secondary">{vaga?.status}</Badge>}
                        <span className="text-muted-foreground text-sm">Posições: {vaga?.total_vagas}</span>
                        {vaga?.limite_curriculos && (
                            <span className={`text-sm font-medium ${candidatos.length >= vaga.limite_curriculos ? "text-red-500" : "text-amber-500"}`}>
                                · Currículos: {candidatos.length} / {vaga.limite_curriculos}
                            </span>
                        )}
                        {vaga?.tipo_selecao && (
                            <Badge variant="outline" className="text-xs">
                                {vaga.tipo_selecao === "coleta_curriculo" && "Coleta de Currículo"}
                                {vaga.tipo_selecao === "entrevista_unidade" && "Entrevista na Unidade"}
                                {vaga.tipo_selecao === "triagem_cuca" && `Triagem CUCA${vaga.unidade_cuca ? ` ${vaga.unidade_cuca}` : ""}`}
                            </Badge>
                        )}
                        {vaga?.email_contato_empresa && (
                            <span className="text-xs text-muted-foreground">· CV: {vaga.email_contato_empresa}</span>
                        )}
                    </div>
                    {vaga?.beneficios && (
                        <div className="flex flex-wrap gap-1 mt-2">
                            {vaga.beneficios.split(", ").map((b: string) => (
                                <Badge key={b} variant="secondary" className="text-[10px]">{b}</Badge>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <Card className="border-none shadow-sm">
                <CardHeader className="bg-muted/20 border-b flex flex-row items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <FileText className="h-5 w-5 text-cuca-blue" />
                            Candidatos / Pipeline
                            <Badge variant="outline" className="ml-2">{candidatos.length}</Badge>
                        </CardTitle>
                        <CardDescription>Gerencie o pipeline de seleção desta oportunidade</CardDescription>
                    </div>
                    {/* S12-10: inscrição manual */}
                    <Button size="sm" variant="outline" onClick={() => setModalInscricao(true)}>
                        <Plus className="mr-1.5 h-4 w-4" />
                        Inscrever Manualmente
                    </Button>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-muted/30">
                            <TableRow>
                                <TableHead>Candidato (Idade)</TableHead>
                                <TableHead>Contato</TableHead>
                                <TableHead>OCR: Escolaridade / Experiência</TableHead>
                                <TableHead>Match (IA)</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow><TableCell colSpan={6} className="text-center py-10"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
                            ) : candidatos.length === 0 ? (
                                <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">Nenhum currículo recebido até o momento.</TableCell></TableRow>
                            ) : candidatos.map(c => {
                                const ocr = c.dados_ocr_json || {}
                                return (
                                    <TableRow key={c.id}>
                                        <TableCell>
                                            <div className="font-semibold">{c.nome}</div>
                                            <div className="text-xs text-muted-foreground">{calcularIdade(c.data_nascimento)}</div>
                                        </TableCell>
                                        <TableCell className="text-sm">{c.telefone}</TableCell>
                                        <TableCell>
                                            <div className="text-xs max-w-[200px]">
                                                <p><span className="font-semibold">Esc:</span> {ocr?.escolaridade || "Analisando..."}</p>
                                                <p className="truncate"><span className="font-semibold">Exp:</span> {ocr?.experiencia_meses ? `${ocr.experiencia_meses} meses` : "Em processo"}</p>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div
                                                className="flex flex-col items-center cursor-pointer hover:bg-slate-50 p-1 rounded transition-colors"
                                                onClick={() => { setSelectedCandidato(c); setIsMatchModalOpen(true) }}
                                            >
                                                <div className={`text-xl font-bold ${(c as any).match_score >= 80 ? "text-green-600" : (c as any).match_score >= 50 ? "text-amber-600" : "text-red-600"}`}>
                                                    {(c as any).match_score || 0}%
                                                </div>
                                                <div className="text-[10px] uppercase font-bold text-muted-foreground flex items-center gap-1">
                                                    <Sparkles className="w-2 h-2" /> Analisar
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={c.status === "pendente" ? "outline" : c.status === "selecionado" ? "default" : c.status === "contratado" ? "secondary" : "destructive"}>
                                                {c.status.toUpperCase()}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex items-center justify-end gap-1">
                                                {c.status === "pendente" && (
                                                    <div className="flex gap-1 mr-1 bg-slate-100 p-1 rounded-lg">
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-green-600 hover:bg-green-50"
                                                            onClick={() => handleUpdateStatus(c.id, "selecionado", c)} title="Pré-selecionar">
                                                            <UserCheck className="h-4 w-4" />
                                                        </Button>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-red-600 hover:bg-red-50"
                                                            onClick={() => handleUpdateStatus(c.id, "rejeitado", c)} title="Rejeitar">
                                                            <UserX className="h-4 w-4" />
                                                        </Button>
                                                    </div>
                                                )}
                                                {/* S12-07: Follow-up */}
                                                <Button variant="ghost" size="icon" className="h-8 w-8 text-blue-600 hover:bg-blue-50"
                                                    onClick={() => abrirFollowup(c)} title="Follow-up">
                                                    <MessageSquare className="h-4 w-4" />
                                                </Button>
                                                {c.arquivo_cv_url && (
                                                    <Button variant="ghost" size="icon" title="Ver CV" onClick={() => window.open(c.arquivo_cv_url!, "_blank")}>
                                                        <Eye className="h-4 w-4 text-cuca-blue" />
                                                    </Button>
                                                )}
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem onClick={() => handleUpdateStatus(c.id, "selecionado", c)}>
                                                            <UserCheck className="mr-2 h-4 w-4 text-green-600" /> Marcar Selecionado
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => handleUpdateStatus(c.id, "contratado", c)}>
                                                            <CheckCircle2 className="mr-2 h-4 w-4 text-blue-600" /> Marcar Contratado
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => handleUpdateStatus(c.id, "rejeitado", c)}>
                                                            <UserX className="mr-2 h-4 w-4 text-red-600" /> Rejeitar (B. Talentos)
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => refreshOcr(c.id, c.arquivo_cv_url!)}>
                                                            <FileTerminal className="mr-2 h-4 w-4" /> Forçar Re-OCR
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {/* MatchModal */}
            <MatchModal isOpen={isMatchModalOpen} onClose={() => setIsMatchModalOpen(false)} candidato={selectedCandidato} vaga={vaga} />

            {/* S12-06: Modal mensagem de fechamento */}
            <Dialog open={!!msgFechamento} onOpenChange={open => !open && setMsgFechamento(null)}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <CheckCircle2 className="h-5 w-5 text-green-600" />
                            Candidato Pré-Selecionado
                        </DialogTitle>
                        <DialogDescription>
                            CV de <strong>{msgFechamento?.candidato.nome}</strong> enviado para a empresa. Use o texto abaixo para informar o candidato.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="bg-muted rounded-lg p-4 text-sm whitespace-pre-wrap leading-relaxed">
                        {`Olá ${msgFechamento?.candidato.nome?.split(" ")[0]}! 🎉

Temos uma boa notícia: seu perfil foi selecionado para a vaga de *${vaga?.titulo}* pela equipe CUCA Atende Mais.

Seu currículo foi encaminhado para a empresa parceira e em breve você receberá o contato para a próxima etapa do processo seletivo.

Continue atento ao seu WhatsApp. Qualquer dúvida, fale conosco aqui mesmo. Boa sorte! 💪`}
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => {
                            navigator.clipboard.writeText(`Olá ${msgFechamento?.candidato.nome?.split(" ")[0]}! Seu perfil foi selecionado para a vaga de ${vaga?.titulo}. Em breve a empresa entrará em contato.`)
                            toast.success("Texto copiado!")
                        }}>Copiar texto</Button>
                        <Button onClick={() => setMsgFechamento(null)}>Fechar</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            {/* S12-07: Sheet Follow-up */}
            <Sheet open={!!followupSheet} onOpenChange={open => !open && setFollowupSheet(null)}>
                <SheetContent className="w-full sm:max-w-md overflow-y-auto">
                    <SheetHeader className="mb-4">
                        <SheetTitle className="flex items-center gap-2">
                            <MessageSquare className="h-5 w-5 text-blue-600" />
                            Follow-up
                        </SheetTitle>
                        <SheetDescription>{followupSheet?.nome} — {vaga?.titulo}</SheetDescription>
                    </SheetHeader>

                    {loadingFollowup ? (
                        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
                    ) : (
                        <div className="space-y-4">
                            {/* Timeline */}
                            <div className="space-y-3">
                                {followups.length === 0 ? (
                                    <p className="text-sm text-muted-foreground text-center py-6">Nenhum registro ainda. Adicione o primeiro contato abaixo.</p>
                                ) : followups.map(fu => {
                                    const meta = tipoFollowupLabel(fu.tipo)
                                    const Icon = meta.icon
                                    return (
                                        <div key={fu.id} className="flex gap-3">
                                            <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${meta.color}`}>
                                                <Icon className="h-3.5 w-3.5" />
                                            </div>
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-0.5">
                                                    <span className={`text-xs font-semibold rounded px-1.5 py-0.5 ${meta.color}`}>{meta.label}</span>
                                                    <span className="text-xs text-muted-foreground">
                                                        {format(new Date(fu.created_at), "dd/MM HH:mm", { locale: ptBR })}
                                                    </span>
                                                </div>
                                                <p className="text-sm leading-relaxed">{fu.mensagem}</p>
                                            </div>
                                        </div>
                                    )
                                })}
                            </div>

                            {/* Novo registro */}
                            <div className="border-t pt-4 space-y-3">
                                <p className="text-xs font-semibold text-muted-foreground uppercase">Adicionar registro</p>
                                <div>
                                    <Label className="text-xs">Tipo</Label>
                                    <Select value={novoFollowup.tipo} onValueChange={v => setNovoFollowup(n => ({ ...n, tipo: v as any }))}>
                                        <SelectTrigger className="mt-1 h-8 text-sm">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="interno">Interno (CUCA)</SelectItem>
                                            <SelectItem value="empresa">Empresa</SelectItem>
                                            <SelectItem value="candidato">Candidato</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>
                                <div>
                                    <Label className="text-xs">Mensagem / Observação</Label>
                                    <Textarea
                                        className="mt-1 text-sm"
                                        rows={3}
                                        placeholder="Ex: Empresa confirmou entrevista para quinta-feira às 14h..."
                                        value={novoFollowup.mensagem}
                                        onChange={e => setNovoFollowup(n => ({ ...n, mensagem: e.target.value }))}
                                    />
                                </div>
                                <Button className="w-full" size="sm" onClick={adicionarFollowup} disabled={enviandoFollowup}>
                                    <Send className="mr-1.5 h-3.5 w-3.5" />
                                    {enviandoFollowup ? "Salvando..." : "Adicionar"}
                                </Button>
                            </div>
                        </div>
                    )}
                </SheetContent>
            </Sheet>

            {/* S12-10: Modal inscrição manual */}
            <Dialog open={modalInscricao} onOpenChange={setModalInscricao}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Inscrever Candidato Manualmente</DialogTitle>
                        <DialogDescription>
                            Registre um candidato que compareceu presencialmente ao CUCA para a vaga <strong>{vaga?.titulo}</strong>.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4">
                        <div>
                            <Label>Nome completo *</Label>
                            <Input
                                className="mt-1"
                                placeholder="Nome do candidato"
                                value={inscricaoForm.nome}
                                onChange={e => setInscricaoForm(f => ({ ...f, nome: e.target.value }))}
                            />
                        </div>
                        <div>
                            <Label>Telefone (WhatsApp) *</Label>
                            <Input
                                className="mt-1"
                                placeholder="+55 (85) 99999-9999"
                                value={mascaraTelefone(inscricaoForm.telefone)}
                                onChange={e => setInscricaoForm(f => ({ ...f, telefone: limparTelefone(e.target.value) }))}
                            />
                        </div>
                        <div>
                            <Label>Data de Nascimento</Label>
                            <Input
                                type="date"
                                className="mt-1"
                                value={inscricaoForm.data_nascimento}
                                onChange={e => setInscricaoForm(f => ({ ...f, data_nascimento: e.target.value }))}
                            />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setModalInscricao(false)}>Cancelar</Button>
                        <Button onClick={criarInscricaoManual} disabled={criandoInscricao}>
                            {criandoInscricao ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                            Inscrever
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}
