"use client"

import { useState, useEffect, useRef } from "react"
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
    const [excluindo, setExcluindo] = useState(false)
    const [analiseTimeout, setAnaliseTimeout] = useState(false)
    const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null)

    useEffect(() => { fetchData() }, [candidaturaId, vagaId])

    // Se não tem arquivo nem OCR, disparar análise textual a partir do currículo estruturado
    useEffect(() => {
        if (!candidatura) return
        if (candidatura.dados_ocr_json || candidatura.arquivo_cv_url) return
        // Buscar observacoes para extrair talent_id
        const obs: string = candidatura.observacoes || ""
        const match = obs.match(/banco_talentos:([a-f0-9-]+)/i)
        if (!match) return
        const talentId = match[1]
        ;(async () => {
            try {
                const { data: cur } = await supabase
                    .from("curriculos")
                    .select("dados")
                    .eq("talent_id", talentId)
                    .is("deleted_at", null)
                    .order("updated_at", { ascending: false })
                    .limit(1)
                    .maybeSingle()
                if (!cur?.dados) return
                const d = cur.dados as any
                const linhas: string[] = []
                if (d.nome) linhas.push(`Nome: ${d.nome}`)
                if (d.telefone) linhas.push(`Telefone: ${d.telefone}`)
                if (d.email) linhas.push(`Email: ${d.email}`)
                if (d.apresentacao) linhas.push(`\nApresentação:\n${d.apresentacao}`)
                if (d.objetivo) linhas.push(`\nObjetivo:\n${d.objetivo}`)
                if (d.formacoes?.length) {
                    linhas.push("\nFormação:")
                    d.formacoes.forEach((f: any) => {
                        linhas.push(`- ${f.escolaridade} em ${f.curso || ''} (${f.instituicao || ''}, ${f.ano || ''})`)
                    })
                }
                if (d.experiencias?.length) {
                    linhas.push("\nExperiências:")
                    d.experiencias.forEach((e: any) => {
                        const periodo = `${e.data_inicio || ''}${e.atual ? ' - atual' : e.data_fim ? ` - ${e.data_fim}` : ''}`
                        linhas.push(`- ${e.cargo || ''} em ${e.empresa || ''} (${periodo})`)
                        e.atividades?.forEach((a: any) => linhas.push(`  • ${a.descricao}`))
                    })
                }
                if (d.cursos?.length) {
                    linhas.push("\nCursos:")
                    d.cursos.forEach((c: any) => linhas.push(`- ${c.titulo} (${c.instituicao || ''}, ${c.ano || ''})`))
                }
                if (d.habilidades?.length) {
                    linhas.push("\nHabilidades:")
                    d.habilidades.forEach((h: any) => linhas.push(`- ${h.titulo}: ${h.descricao}`))
                }
                const cvText = linhas.join("\n")
                if (!cvText.trim()) return
                await fetch("/api/process-cv-text", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        candidatura_id: candidaturaId,
                        cv_text: cvText,
                        vaga_id: vagaId,
                    }),
                })
            } catch (err) {
                console.warn("[candidatura-detail] Erro ao disparar análise textual:", err)
            }
        })()
    }, [candidatura?.id])

    // Polling: re-faz fetch a cada 6s enquanto dados_ocr_json estiver null e houver CV
    useEffect(() => {
        if (!candidatura) return
        setAnaliseTimeout(false)
        // Polling para qualquer candidatura sem OCR (com arquivo ou com currículo estruturado)
        const obs: string = candidatura.observacoes || ""
        const temCurriculoEstruturado = /banco_talentos:[a-f0-9-]+/i.test(obs)
        const semOcr = !candidatura.dados_ocr_json && (candidatura.arquivo_cv_url || temCurriculoEstruturado)
        if (semOcr) {
            let tentativas = 0
            pollingRef.current = setInterval(async () => {
                tentativas++
                if (tentativas > 20) {
                    clearInterval(pollingRef.current!)
                    setAnaliseTimeout(true)
                    return
                }
                const { data } = await supabase
                    .from("candidaturas")
                    .select("dados_ocr_json, matching_score, match_score")
                    .eq("id", candidaturaId)
                    .single()
                if (data?.dados_ocr_json) {
                    setCandidatura((prev: any) => ({
                        ...prev,
                        dados_ocr_json: data.dados_ocr_json,
                        matching_score: data.matching_score,
                        match_score: data.match_score,
                    }))
                    clearInterval(pollingRef.current!)
                }
            }, 6000)
        }
        return () => { if (pollingRef.current) clearInterval(pollingRef.current) }
    }, [candidatura?.id, candidatura?.dados_ocr_json])

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
        // Rejeição sempre passa pela API para popular o banco de talentos
        if (novoStatus === 'rejeitado') {
            await rejeitarParaBancoTalentos()
            return
        }
        setSalvandoStatus(true)
        try {
            const { error } = await supabase
                .from("candidaturas")
                .update({ status: novoStatus, updated_at: new Date().toISOString() })
                .eq("id", candidaturaId)
            if (error) throw error
            setCandidatura((prev: any) => ({ ...prev, status: novoStatus }))

            // Sincronizar status no talent_bank pelo telefone da candidatura
            const telefone = candidatura?.telefone
            if (telefone) {
                const tbStatus = novoStatus === "contratado" ? "contratado" : "selecionado"
                await supabase
                    .from("talent_bank")
                    .update({ status: tbStatus, updated_at: new Date().toISOString() })
                    .eq("telefone", telefone)
            }

            // Invalidar cache TB desta vaga para forçar reload na próxima visita
            try { localStorage.removeItem(`talent_triagem_${vagaId}`) } catch {}
            toast.success("Status atualizado")
        } catch (err: any) {
            toast.error("Erro: " + err.message)
        } finally {
            setSalvandoStatus(false)
        }
    }

    const excluirCandidatura = async () => {
        if (!window.confirm(`Excluir permanentemente a candidatura de ${candidatura?.nome}? Esta ação não pode ser desfeita.`)) return
        setExcluindo(true)
        try {
            const { error } = await supabase.from("candidaturas").delete().eq("id", candidaturaId)
            if (error) throw error
            toast.success("Candidatura excluída.")
            router.push(`/empregabilidade/vagas/${vagaId}?t=${Date.now()}`)
        } catch (err: any) {
            toast.error("Erro: " + err.message)
        } finally {
            setExcluindo(false)
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

            // Sincronizar status no talent_bank
            if (candidatura?.telefone) {
                await supabase
                    .from("talent_bank")
                    .update({ status: "selecionado", updated_at: new Date().toISOString() })
                    .eq("telefone", candidatura.telefone)
            }

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
            // Invalidar cache TB desta vaga para forçar reload na próxima visita
            try { localStorage.removeItem(`talent_triagem_${vagaId}`) } catch {}
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
            const res = await fetch(`/api/empregabilidade/candidaturas/${candidaturaId}/rejeitar`, {
                method: "POST",
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.error || "Erro ao rejeitar candidato")
            toast.success("Candidato rejeitado e adicionado ao Banco de Talentos!")
            router.push(`/empregabilidade/vagas/${vagaId}?t=${Date.now()}`)
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

    const imprimirAnalise = () => {
        const ocr = candidatura?.dados_ocr_json || {}
        const temAnalise = !!(ocr?.pontos_fortes?.length || ocr?.veredito_final || ocr?.analise_aderencia)
        if (!temAnalise) {
            toast.error("Análise de IA ainda não disponível para este candidato.")
            return
        }

        const score = ocr?.match_score ?? candidatura?.match_score ?? null
        const pontosFortesArr: string[] = ocr?.pontos_fortes || ocr?.analise_aderencia?.pontos_fortes || []
        const pontosAtencaoArr: string[] = ocr?.pontos_atencao || ocr?.analise_aderencia?.pontos_atencao || []
        const vereditoFinal: string = ocr?.veredito_final || ocr?.analise_aderencia?.veredito_final || ""
        const habilidades: string[] = ocr?.habilidades || []
        const resumoExp: string[] = ocr?.resumo_experiencias || []
        const cvUrl = ocr?.arquivo_cv_url || candidatura?.arquivo_cv_url

        const scoreColor = score !== null ? (score >= 70 ? "#16a34a" : score >= 50 ? "#d97706" : "#dc2626") : "#666"
        const scoreBg = score !== null ? (score >= 70 ? "#f0fdf4" : score >= 50 ? "#fffbeb" : "#fef2f2") : "#f9f9f9"

        const html = `<!DOCTYPE html><html><head><title>Análise de Aderência — ${candidatura.nome}</title>
        <style>
            body{font-family:Arial,sans-serif;max-width:760px;margin:32px auto;padding:0 24px;color:#111;}
            h1{margin:0;font-size:20px;color:white;}
            .header{background:#0066cc;padding:20px 28px;border-radius:8px;margin-bottom:24px;}
            .sub{color:#cce0ff;margin:4px 0 0;font-size:14px;}
            .score-row{display:flex;align-items:center;gap:16px;margin-bottom:20px;}
            .score-circle{width:64px;height:64px;border-radius:50%;border:3px solid ${scoreColor};display:flex;flex-direction:column;align-items:center;justify-content:center;background:${scoreBg};flex-shrink:0;}
            .score-num{font-size:22px;font-weight:bold;color:${scoreColor};}
            .score-label{font-size:9px;color:#666;}
            .section-title{font-weight:bold;font-size:12px;text-transform:uppercase;margin-bottom:6px;margin-top:0;}
            .section{margin-bottom:18px;}
            ul{margin:0;padding-left:18px;}
            li{font-size:13px;color:#333;margin-bottom:4px;}
            .veredito{background:#f0f4ff;border-left:4px solid #0066cc;padding:14px 16px;border-radius:0 8px 8px 0;margin-bottom:20px;}
            .habilidades{font-size:13px;color:#333;}
            .cv-link{text-align:center;margin:28px 0 12px;}
            .cv-link a{background:#0066cc;color:white;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold;font-size:14px;}
            .footer{border-top:1px solid #e0e0e0;padding-top:12px;font-size:11px;color:#999;text-align:center;}
            @media print{body{margin:16px;}.no-print{display:none;}}
        </style></head><body>
        <div class="header">
            <h1>Análise de Aderência</h1>
            <p class="sub">${candidatura.nome} — Vaga: ${vaga?.titulo}${vaga?.numero_vaga ? ` #${vaga.numero_vaga}` : ""}</p>
        </div>
        ${score !== null ? `<div class="score-row">
            <div class="score-circle"><span class="score-num">${score}</span><span class="score-label">match</span></div>
            <div><p style="margin:0;font-weight:bold;font-size:15px;color:${scoreColor};">Score de Compatibilidade: ${score}/100</p>
            <p style="margin:2px 0 0;font-size:13px;color:#555;">${score >= 70 ? "Alta compatibilidade com os requisitos da vaga" : score >= 50 ? "Compatibilidade moderada" : "Baixa compatibilidade"}</p></div>
        </div>` : ""}
        ${habilidades.length > 0 ? `<div class="section"><p class="section-title" style="color:#0066cc;">Habilidades Identificadas</p><p class="habilidades">${habilidades.join(" · ")}</p></div>` : ""}
        ${resumoExp.length > 0 ? `<div class="section"><p class="section-title" style="color:#0066cc;">Experiências Anteriores</p><ul>${resumoExp.map(e => `<li>${e}</li>`).join("")}</ul></div>` : ""}
        ${pontosFortesArr.length > 0 ? `<div class="section"><p class="section-title" style="color:#16a34a;">✅ Pontos Fortes</p><ul>${pontosFortesArr.map(p => `<li>${p}</li>`).join("")}</ul></div>` : ""}
        ${pontosAtencaoArr.length > 0 ? `<div class="section"><p class="section-title" style="color:#d97706;">⚠️ Pontos de Atenção</p><ul>${pontosAtencaoArr.map(p => `<li>${p}</li>`).join("")}</ul></div>` : ""}
        ${vereditoFinal ? `<div class="veredito"><p class="section-title" style="color:#0066cc;">Veredito Final</p><p style="font-size:14px;margin:0;">${vereditoFinal}</p></div>` : ""}
        ${cvUrl ? `<div class="cv-link no-print"><a href="${cvUrl}" target="_blank">📄 Abrir Currículo Original</a></div>` : ""}
        <p class="footer">Análise gerada pelo sistema de empregabilidade CUCA · ${new Date().toLocaleDateString("pt-BR")}</p>
        </body></html>`

        const win = window.open("", "_blank")
        if (win) {
            win.document.write(html)
            win.document.close()
            setTimeout(() => win.print(), 800)
        }
    }

    const abrirCVParaImprimir = () => {
        const ocr = candidatura?.dados_ocr_json || {}
        const url = ocr?.arquivo_cv_url || candidatura?.arquivo_cv_url
        if (!url) {
            toast.error("Currículo ainda não disponível.")
            return
        }
        window.open(url, "_blank")
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
    const podeRejeitar = !["rejeitado", "contratado"].includes(candidatura.status)
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
                                {analiseTimeout
                                    ? <span className="h-5 w-5 flex-shrink-0 text-lg">⚠️</span>
                                    : <Loader2 className="h-5 w-5 animate-spin flex-shrink-0" />
                                }
                                <div>
                                    <p className="font-medium text-sm">
                                        {analiseTimeout ? "Análise de IA indisponível" : "Análise de IA em andamento"}
                                    </p>
                                    <p className="text-xs text-muted-foreground mt-0.5">
                                        {analiseTimeout
                                            ? "A análise demorou mais que o esperado. Verifique se o worker está ativo ou tente recarregar a página."
                                            : "O currículo está sendo processado. Esta página será atualizada automaticamente."}
                                    </p>
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

                            {/* Excluir permanentemente */}
                            <Button
                                variant="ghost"
                                className="w-full text-xs text-muted-foreground hover:text-red-500 hover:bg-red-500/10 mt-2"
                                onClick={excluirCandidatura}
                                disabled={excluindo}
                            >
                                {excluindo
                                    ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                    : <XCircle className="mr-2 h-3.5 w-3.5" />}
                                Excluir Candidatura
                            </Button>
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
                                Ver Currículo Original
                            </Button>

                            <Button
                                variant="outline"
                                className="w-full"
                                onClick={imprimirAnalise}
                                disabled={!candidatura?.dados_ocr_json}
                            >
                                <Printer className="mr-2 h-4 w-4" />
                                Imprimir Análise de IA
                            </Button>

                            <Button
                                variant="outline"
                                className="w-full"
                                onClick={abrirCVParaImprimir}
                                disabled={!temCV}
                            >
                                <FileText className="mr-2 h-4 w-4" />
                                Imprimir Currículo Original
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
