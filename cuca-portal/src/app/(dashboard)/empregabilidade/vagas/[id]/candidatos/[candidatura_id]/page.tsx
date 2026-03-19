"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
    ArrowLeft, FileText, Loader2, ExternalLink, Printer,
    Mail, CheckCircle, XCircle, Briefcase, GraduationCap,
    Clock, Phone, Calendar, Star, AlertTriangle, User,
    Database, TrendingUp, SendHorizonal
} from "lucide-react"
import toast from "react-hot-toast"
import { differenceInYears, format } from "date-fns"
import { ptBR } from "date-fns/locale"

function formatarExperiencia(meses: number | null | undefined): string {
    if (!meses || meses === 0) return "Sem experiência informada"
    if (meses < 12) return `${meses} ${meses === 1 ? "mês" : "meses"}`
    const anos = Math.floor(meses / 12)
    const resto = meses % 12
    if (resto === 0) return `${anos} ${anos === 1 ? "ano" : "anos"}`
    return `${anos} ${anos === 1 ? "ano" : "anos"} e ${resto} ${resto === 1 ? "mês" : "meses"}`
}

function StatusBadge({ status }: { status: string }) {
    const map: Record<string, string> = {
        pendente: "bg-amber-500/15 text-amber-400 border-amber-500/30",
        selecionado: "bg-blue-500/15 text-blue-400 border-blue-500/30",
        contratado: "bg-green-500/15 text-green-400 border-green-500/30",
        rejeitado: "bg-red-500/15 text-red-400 border-red-500/30",
    }
    const labels: Record<string, string> = {
        pendente: "Pendente",
        selecionado: "Selecionado",
        contratado: "Contratado",
        rejeitado: "Rejeitado",
    }
    return (
        <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-sm font-medium border ${map[status] || "bg-muted text-muted-foreground border-border"}`}>
            {labels[status] || status}
        </span>
    )
}

function ScoreCircle({ score }: { score: number | null | undefined }) {
    const s = score ?? 0
    const color = s >= 70 ? "text-green-400 border-green-500/40 bg-green-500/10"
        : s >= 50 ? "text-amber-400 border-amber-500/40 bg-amber-500/10"
            : "text-red-400 border-red-500/40 bg-red-500/10"
    return (
        <div className={`w-16 h-16 rounded-full border-2 flex flex-col items-center justify-center ${color}`}>
            <span className="text-xl font-bold leading-none">{s}</span>
            <span className="text-[10px] leading-none mt-0.5 opacity-70">match</span>
        </div>
    )
}

export default function CandidatoDetalhesPage() {
    const params = useParams()
    const router = useRouter()
    const vagaId = params.id as string
    const candidaturaId = params.candidatura_id as string
    const supabase = createClient()

    const [candidatura, setCandidatura] = useState<any>(null)
    const [vaga, setVaga] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const [salvandoStatus, setSalvandoStatus] = useState(false)
    const [enviandoEmail, setEnviandoEmail] = useState(false)
    const [rejeitando, setRejeitando] = useState(false)
    const [aprovando, setAprovando] = useState(false)

    useEffect(() => { fetchData() }, [candidaturaId, vagaId])

    const fetchData = async () => {
        setLoading(true)
        try {
            const [{ data: c, error: cErr }, { data: v, error: vErr }] = await Promise.all([
                supabase.from("candidaturas").select("*").eq("id", candidaturaId).single(),
                supabase.from("vagas").select("*, empresas(nome, nome_fantasia)").eq("id", vagaId).single(),
            ])
            if (cErr) throw cErr
            if (vErr) throw vErr
            setCandidatura(c)
            setVaga(v)
        } catch (err: any) {
            toast.error("Erro ao carregar candidato")
        } finally {
            setLoading(false)
        }
    }

    const alterarStatus = async (novoStatus: string) => {
        setSalvandoStatus(true)
        try {
            const { error } = await supabase
                .from("candidaturas")
                .update({ status: novoStatus, updated_at: new Date().toISOString() })
                .eq("id", candidaturaId)
            if (error) throw error
            setCandidatura((prev: any) => ({ ...prev, status: novoStatus }))
            toast.success("Status atualizado")
        } catch (err: any) {
            toast.error("Erro: " + err.message)
        } finally {
            setSalvandoStatus(false)
        }
    }

    const aprovarCandidato = async () => {
        setAprovando(true)
        try {
            const { error } = await supabase
                .from("candidaturas")
                .update({ status: "selecionado", updated_at: new Date().toISOString() })
                .eq("id", candidaturaId)
            if (error) throw error
            setCandidatura((prev: any) => ({ ...prev, status: "selecionado" }))

            // Notificar candidato via WhatsApp
            const res = await fetch("/api/empregabilidade/notificar-selecionado", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    candidatura_id: candidaturaId,
                    nome: candidatura.nome,
                    titulo_vaga: vaga?.titulo,
                    unidade_cuca: vaga?.unidade_cuca,
                }),
            })
            const data = await res.json()
            if (data.ok) {
                toast.success("Candidato aprovado e notificado por WhatsApp!")
            } else {
                toast.success("Candidato aprovado! " + (data.motivo || "WhatsApp não enviado."))
            }
        } catch (err: any) {
            toast.error("Erro: " + err.message)
        } finally {
            setAprovando(false)
        }
    }

    const rejeitarParaBancoTalentos = async () => {
        setRejeitando(true)
        try {
            // 1. Atualizar status da candidatura
            const { error: statusErr } = await supabase
                .from("candidaturas")
                .update({ status: "rejeitado", updated_at: new Date().toISOString() })
                .eq("id", candidaturaId)
            if (statusErr) throw statusErr

            // 2. Inserir/atualizar no banco de talentos
            const ocr = candidatura?.dados_ocr_json || {}
            const talentPayload = {
                nome: candidatura.nome,
                telefone: candidatura.telefone || null,
                data_nascimento: candidatura.data_nascimento || null,
                arquivo_cv_url: ocr?.arquivo_cv_url || candidatura.arquivo_cv_url || null,
                candidatura_origem_id: candidaturaId,
                vaga_origem_id: vagaId,
                skills_jsonb: ocr,
                status: "disponivel",
                updated_at: new Date().toISOString(),
            }

            // Upsert por telefone se disponível
            if (candidatura.telefone) {
                const { data: existing } = await supabase
                    .from("talent_bank")
                    .select("id")
                    .eq("telefone", candidatura.telefone)
                    .maybeSingle()

                if (existing) {
                    await supabase.from("talent_bank")
                        .update(talentPayload)
                        .eq("id", existing.id)
                } else {
                    await supabase.from("talent_bank").insert(talentPayload)
                }
            } else {
                await supabase.from("talent_bank").insert(talentPayload)
            }

            setCandidatura((prev: any) => ({ ...prev, status: "rejeitado" }))
            toast.success("Candidato rejeitado e adicionado ao Banco de Talentos!")
        } catch (err: any) {
            toast.error("Erro: " + err.message)
        } finally {
            setRejeitando(false)
        }
    }

    const enviarCVporEmail = async () => {
        const emailDestino = vaga?.email_responsavel || vaga?.email_contato_empresa
        if (!emailDestino) {
            toast.error("E-mail de contato da empresa não cadastrado na vaga.")
            return
        }
        setEnviandoEmail(true)
        try {
            const res = await fetch("/api/empregabilidade/enviar-cv", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ candidatura_id: candidaturaId, vaga_id: vagaId }),
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Erro ao enviar email")
            toast.success("Currículo enviado para a empresa!")
            // Atualiza localmente para refletir o envio
            setCandidatura((prev: any) => ({
                ...prev,
                email_enviado_em: new Date().toISOString(),
                email_enviado_para: emailDestino,
            }))
        } catch (err: any) {
            toast.error(err.message)
        } finally {
            setEnviandoEmail(false)
        }
    }

    const abrirCV = () => {
        const ocr = candidatura?.dados_ocr_json || {}
        const url = ocr?.arquivo_cv_url || candidatura?.arquivo_cv_url
        if (!url) {
            toast.error("Currículo ainda não disponível.")
            return
        }
        window.open(url, "_blank")
    }

    const imprimirCV = () => {
        const ocr = candidatura?.dados_ocr_json || {}
        const cvUrl = ocr?.arquivo_cv_url || candidatura?.arquivo_cv_url
        if (!cvUrl) {
            toast.error("Currículo ainda não disponível.")
            return
        }

        const score = ocr?.match_score ?? candidatura?.match_score ?? null
        const pontosFortesArr: string[] = ocr?.pontos_fortes || ocr?.analise_aderencia?.pontos_fortes || []
        const pontosAtencaoArr: string[] = ocr?.pontos_atencao || ocr?.analise_aderencia?.pontos_atencao || []
        const vereditoFinal: string = ocr?.veredito_final || ocr?.analise_aderencia?.veredito_final || ""
        const habilidades: string[] = ocr?.habilidades || []
        const resumoExp: string[] = ocr?.resumo_experiencias || []

        const analiseHtml = `
            <div style="font-family:Arial,sans-serif;max-width:760px;margin:0 auto;padding:32px;color:#111;">
                <div style="background:#0066cc;padding:20px 28px;border-radius:8px;margin-bottom:24px;">
                    <h1 style="color:white;margin:0;font-size:20px;">Análise de Aderência</h1>
                    <p style="color:#cce0ff;margin:4px 0 0;font-size:14px;">
                        ${candidatura.nome} — Vaga: ${vaga?.titulo}${vaga?.numero_vaga ? ` #${vaga.numero_vaga}` : ""}
                    </p>
                </div>
                ${score !== null ? `<div style="margin-bottom:20px;display:flex;align-items:center;gap:16px;">
                    <div style="width:64px;height:64px;border-radius:50%;border:3px solid ${score >= 70 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444"};display:flex;flex-direction:column;align-items:center;justify-content:center;background:${score >= 70 ? "#f0fdf4" : score >= 50 ? "#fffbeb" : "#fef2f2"};">
                        <span style="font-size:22px;font-weight:bold;color:${score >= 70 ? "#16a34a" : score >= 50 ? "#d97706" : "#dc2626"};">${score}</span>
                        <span style="font-size:10px;color:#666;">match</span>
                    </div>
                    <div><p style="margin:0;font-weight:bold;font-size:15px;">Score de Compatibilidade</p><p style="margin:2px 0 0;font-size:13px;color:#555;">${score >= 70 ? "Alta compatibilidade" : score >= 50 ? "Compatibilidade moderada" : "Baixa compatibilidade"}</p></div>
                </div>` : ""}
                ${habilidades.length > 0 ? `<div style="margin-bottom:18px;"><p style="font-weight:bold;font-size:13px;text-transform:uppercase;color:#0066cc;margin-bottom:6px;">Habilidades Identificadas</p><p style="font-size:13px;color:#333;">${habilidades.join(" · ")}</p></div>` : ""}
                ${resumoExp.length > 0 ? `<div style="margin-bottom:18px;"><p style="font-weight:bold;font-size:13px;text-transform:uppercase;color:#0066cc;margin-bottom:6px;">Experiências Anteriores</p><ul style="margin:0;padding-left:18px;">${resumoExp.map(e => `<li style="font-size:13px;color:#333;margin-bottom:4px;">${e}</li>`).join("")}</ul></div>` : ""}
                ${pontosFortesArr.length > 0 ? `<div style="margin-bottom:18px;"><p style="font-weight:bold;font-size:13px;text-transform:uppercase;color:#16a34a;margin-bottom:6px;">Pontos Fortes</p><ul style="margin:0;padding-left:18px;">${pontosFortesArr.map(p => `<li style="font-size:13px;color:#333;margin-bottom:4px;">${p}</li>`).join("")}</ul></div>` : ""}
                ${pontosAtencaoArr.length > 0 ? `<div style="margin-bottom:18px;"><p style="font-weight:bold;font-size:13px;text-transform:uppercase;color:#d97706;margin-bottom:6px;">Pontos de Atenção</p><ul style="margin:0;padding-left:18px;">${pontosAtencaoArr.map(p => `<li style="font-size:13px;color:#333;margin-bottom:4px;">${p}</li>`).join("")}</ul></div>` : ""}
                ${vereditoFinal ? `<div style="background:#f0f4ff;border-left:4px solid #0066cc;padding:14px 16px;border-radius:0 8px 8px 0;margin-bottom:20px;"><p style="font-weight:bold;font-size:13px;text-transform:uppercase;color:#0066cc;margin-bottom:4px;">Veredito Final</p><p style="font-size:14px;color:#111;margin:0;">${vereditoFinal}</p></div>` : ""}
                <div style="page-break-after:always;"></div>
                <iframe src="${cvUrl}" width="100%" height="1100px" style="border:none;margin-top:16px;" frameborder="0"></iframe>
            </div>
        `

        const win = window.open("", "_blank")
        if (win) {
            win.document.write(`<!DOCTYPE html><html><head><title>Currículo — ${candidatura.nome}</title></head><body style="margin:0;">${analiseHtml}</body></html>`)
            win.document.close()
            setTimeout(() => win.print(), 1200)
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (!candidatura) {
        return (
            <div className="text-center py-20 text-muted-foreground">
                <User className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>Candidato não encontrado.</p>
            </div>
        )
    }

    const ocr = candidatura.dados_ocr_json || {}
    const idade = candidatura.data_nascimento
        ? differenceInYears(new Date(), new Date(candidatura.data_nascimento))
        : null
    const score = ocr?.match_score ?? candidatura.match_score ?? null
    const temCV = !!(ocr?.arquivo_cv_url || candidatura?.arquivo_cv_url)
    const temEmail = !!(vaga?.email_responsavel || vaga?.email_contato_empresa)
    const podeAprovar = candidatura.status === "pendente"
    const podeRejeitar = candidatura.status === "pendente"
    const podeMarcarContratado = candidatura.status === "selecionado"

    const analise = ocr?.analise_aderencia || null
    const pontosFortesArr: string[] = ocr?.pontos_fortes || analise?.pontos_fortes || []
    const pontosAtencaoArr: string[] = ocr?.pontos_atencao || analise?.pontos_atencao || []
    const vereditoFinal: string = ocr?.veredito_final || analise?.veredito_final || ""
    const habilidades: string[] = ocr?.habilidades || []
    const resumoExperiencias: string[] = ocr?.resumo_experiencias || []

    return (
        <div className="space-y-6 pb-10">
            {/* Navegação */}
            <div className="flex items-center gap-3">
                <Button variant="outline" size="icon" onClick={() => router.push(`/empregabilidade/vagas/${vagaId}`)}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <p className="text-xs text-muted-foreground">Vagas / {vaga?.titulo}</p>
                    <h1 className="text-xl font-bold leading-tight">{candidatura.nome}</h1>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* ── Coluna Esquerda: dados do candidato ── */}
                <div className="lg:col-span-2 space-y-4">

                    {/* Card: Identificação */}
                    <Card className="border-none shadow-sm">
                        <CardContent className="p-5">
                            <div className="flex items-start gap-4">
                                <ScoreCircle score={score} />
                                <div className="flex-1 space-y-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h2 className="text-lg font-bold">{candidatura.nome}</h2>
                                        <StatusBadge status={candidatura.status} />
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                                        {idade !== null && (
                                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                                <User className="h-3.5 w-3.5" />
                                                <span>{idade} anos</span>
                                            </div>
                                        )}
                                        {candidatura.data_nascimento && (
                                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                                <Calendar className="h-3.5 w-3.5" />
                                                <span>{format(new Date(candidatura.data_nascimento), "dd/MM/yyyy")}</span>
                                            </div>
                                        )}
                                        {candidatura.telefone && (
                                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                                <Phone className="h-3.5 w-3.5" />
                                                <a href={`tel:${candidatura.telefone}`} className="hover:text-cuca-blue transition-colors">
                                                    {candidatura.telefone}
                                                </a>
                                            </div>
                                        )}
                                        {ocr?.escolaridade && (
                                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                                <GraduationCap className="h-3.5 w-3.5" />
                                                <span>{ocr.escolaridade}</span>
                                            </div>
                                        )}
                                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                            <Clock className="h-3.5 w-3.5" />
                                            <span>{formatarExperiencia(ocr?.experiencia_meses)}</span>
                                        </div>
                                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                            <Calendar className="h-3.5 w-3.5" />
                                            <span>Inscrito em {format(new Date(candidatura.created_at), "dd/MM/yy HH:mm", { locale: ptBR })}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Card: Habilidades */}
                    {habilidades.length > 0 && (
                        <Card className="border-none shadow-sm">
                            <CardContent className="p-5">
                                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                    <Star className="h-4 w-4 text-cuca-blue" />
                                    Habilidades Identificadas
                                </h3>
                                <div className="flex flex-wrap gap-1.5">
                                    {habilidades.map((h: string, i: number) => (
                                        <Badge key={i} variant="secondary" className="text-xs">{h}</Badge>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Card: Experiências */}
                    {resumoExperiencias.length > 0 && (
                        <Card className="border-none shadow-sm">
                            <CardContent className="p-5">
                                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                    <Briefcase className="h-4 w-4 text-cuca-blue" />
                                    Experiências Anteriores
                                </h3>
                                <ul className="space-y-1.5">
                                    {resumoExperiencias.map((exp: string, i: number) => (
                                        <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                                            <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-cuca-blue/60 flex-shrink-0" />
                                            {exp}
                                        </li>
                                    ))}
                                </ul>
                            </CardContent>
                        </Card>
                    )}

                    {/* Card: Análise de Aderência IA */}
                    {(pontosFortesArr.length > 0 || pontosAtencaoArr.length > 0 || vereditoFinal) && (
                        <Card className="border-none shadow-sm">
                            <CardContent className="p-5 space-y-4">
                                <h3 className="text-sm font-semibold flex items-center gap-2">
                                    <TrendingUp className="h-4 w-4 text-cuca-blue" />
                                    Análise de Aderência
                                </h3>

                                {pontosFortesArr.length > 0 && (
                                    <div>
                                        <p className="text-xs font-semibold text-green-400 mb-1.5 uppercase">Pontos Fortes</p>
                                        <ul className="space-y-1">
                                            {pontosFortesArr.map((p: string, i: number) => (
                                                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                                                    <CheckCircle className="h-3.5 w-3.5 text-green-400 mt-0.5 flex-shrink-0" />
                                                    {p}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {pontosAtencaoArr.length > 0 && (
                                    <div>
                                        <p className="text-xs font-semibold text-amber-400 mb-1.5 uppercase">Pontos de Atenção</p>
                                        <ul className="space-y-1">
                                            {pontosAtencaoArr.map((p: string, i: number) => (
                                                <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                                                    <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
                                                    {p}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {vereditoFinal && (
                                    <div className="bg-muted/50 rounded-lg p-3">
                                        <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Veredito Final</p>
                                        <p className="text-sm">{vereditoFinal}</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* Sem OCR */}
                    {!candidatura.dados_ocr_json && (
                        <Card className="border-none shadow-sm border-amber-500/20">
                            <CardContent className="p-5 flex items-center gap-3 text-amber-400">
                                <Loader2 className="h-5 w-5 animate-spin flex-shrink-0" />
                                <div>
                                    <p className="font-medium text-sm">Análise de IA em andamento</p>
                                    <p className="text-xs text-muted-foreground mt-0.5">O currículo está sendo processado. Recarregue em instantes.</p>
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* ── Coluna Direita: ações ── */}
                <div className="space-y-4">

                    {/* Status atual + alterar */}
                    <Card className="border-none shadow-sm">
                        <CardContent className="p-5 space-y-3">
                            <h3 className="text-sm font-semibold">Status da Candidatura</h3>
                            <StatusBadge status={candidatura.status} />
                            <div>
                                <p className="text-xs text-muted-foreground mb-1.5">Alterar status manualmente</p>
                                <Select
                                    value={candidatura.status}
                                    onValueChange={alterarStatus}
                                    disabled={salvandoStatus}
                                >
                                    <SelectTrigger className="h-8 text-sm">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="pendente">Pendente</SelectItem>
                                        <SelectItem value="selecionado">Selecionado</SelectItem>
                                        <SelectItem value="contratado">Contratado</SelectItem>
                                        <SelectItem value="rejeitado">Rejeitado</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Ações primárias */}
                    <Card className="border-none shadow-sm">
                        <CardContent className="p-5 space-y-3">
                            <h3 className="text-sm font-semibold">Ações</h3>

                            {/* Aprovar */}
                            {podeAprovar && (
                                <Button
                                    className="w-full bg-green-600 hover:bg-green-700 text-white"
                                    onClick={aprovarCandidato}
                                    disabled={aprovando}
                                >
                                    {aprovando
                                        ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        : <CheckCircle className="mr-2 h-4 w-4" />}
                                    Aprovar para a Vaga
                                </Button>
                            )}

                            {/* Marcar como contratado */}
                            {podeMarcarContratado && (
                                <Button
                                    className="w-full"
                                    onClick={() => alterarStatus("contratado")}
                                    disabled={salvandoStatus}
                                >
                                    {salvandoStatus
                                        ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        : <CheckCircle className="mr-2 h-4 w-4" />}
                                    Marcar como Contratado
                                </Button>
                            )}

                            {/* Rejeitar → banco de talentos */}
                            {podeRejeitar && (
                                <Button
                                    variant="outline"
                                    className="w-full border-red-500/30 text-red-400 hover:bg-red-500/10"
                                    onClick={rejeitarParaBancoTalentos}
                                    disabled={rejeitando}
                                >
                                    {rejeitando
                                        ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        : <Database className="mr-2 h-4 w-4" />}
                                    Rejeitar / Banco de Talentos
                                </Button>
                            )}

                            {/* Info se já rejeitado */}
                            {candidatura.status === "rejeitado" && (
                                <div className="flex items-center gap-2 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                                    <XCircle className="h-3.5 w-3.5 flex-shrink-0" />
                                    Candidato rejeitado e adicionado ao banco de talentos.
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Currículo */}
                    <Card className="border-none shadow-sm">
                        <CardContent className="p-5 space-y-2">
                            <h3 className="text-sm font-semibold">Currículo</h3>

                            <Button
                                variant="outline"
                                className="w-full"
                                onClick={abrirCV}
                                disabled={!temCV}
                            >
                                <ExternalLink className="mr-2 h-4 w-4" />
                                Ver Currículo
                            </Button>

                            <Button
                                variant="outline"
                                className="w-full"
                                onClick={imprimirCV}
                                disabled={!temCV}
                            >
                                <Printer className="mr-2 h-4 w-4" />
                                Imprimir Currículo
                            </Button>

                            <Button
                                variant="outline"
                                className="w-full"
                                onClick={enviarCVporEmail}
                                disabled={enviandoEmail || !temEmail}
                                title={!temEmail ? "Email de contato da empresa não cadastrado" : ""}
                            >
                                {enviandoEmail
                                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    : <Mail className="mr-2 h-4 w-4" />}
                                {enviandoEmail ? "Enviando..." : "Enviar para Empresa"}
                            </Button>

                            {!temEmail && (
                                <p className="text-xs text-muted-foreground text-center">
                                    Cadastre o e-mail do responsável na vaga para habilitar o envio.
                                </p>
                            )}
                            {!temCV && (
                                <p className="text-xs text-amber-400 text-center">
                                    Currículo ainda não processado.
                                </p>
                            )}
                            {candidatura?.email_enviado_em && (
                                <div className="flex items-start gap-2 text-xs bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2 text-green-400">
                                    <SendHorizonal className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                                    <div>
                                        <p className="font-medium">E-mail enviado à empresa</p>
                                        {candidatura.email_enviado_para && <p className="text-muted-foreground">{candidatura.email_enviado_para}</p>}
                                        <p className="text-muted-foreground">{format(new Date(candidatura.email_enviado_em), "dd/MM/yy HH:mm", { locale: ptBR })}</p>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Vaga */}
                    <Card className="border-none shadow-sm">
                        <CardContent className="p-5 space-y-2">
                            <h3 className="text-sm font-semibold">Vaga</h3>
                            <div className="space-y-1 text-sm text-muted-foreground">
                                <p className="font-medium text-foreground">{vaga?.titulo}</p>
                                {vaga?.unidade_cuca && <p>CUCA {vaga.unidade_cuca}</p>}
                                {vaga?.tipo_contrato && (
                                    <div className="flex items-center gap-1.5">
                                        <Briefcase className="h-3.5 w-3.5" />
                                        <span>{vaga.tipo_contrato}</span>
                                    </div>
                                )}
                            </div>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="w-full text-xs"
                                onClick={() => router.push(`/empregabilidade/vagas/${vagaId}`)}
                            >
                                Ver todos os candidatos
                            </Button>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
