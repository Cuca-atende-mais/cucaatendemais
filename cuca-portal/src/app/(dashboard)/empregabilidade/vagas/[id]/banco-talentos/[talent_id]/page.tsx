"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    ArrowLeft, Loader2, ExternalLink, CheckCircle,
    XCircle, Briefcase, GraduationCap, Clock, Phone,
    Calendar, Star, AlertTriangle, User, Database, TrendingUp
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

export default function BancoTalentosDetalhesPage() {
    const params = useParams()
    const router = useRouter()
    const vagaId = params.id as string
    const talentId = params.talent_id as string
    const supabase = createClient()

    const [talent, setTalent] = useState<any>(null)
    const [vaga, setVaga] = useState<any>(null)
    const [loading, setLoading] = useState(true)
    const [aprovando, setAprovando] = useState(false)
    const [rejeitando, setRejeitando] = useState(false)
    const [acaoFeita, setAcaoFeita] = useState<"aprovado" | "rejeitado" | null>(null)
    const [matchFromStorage, setMatchFromStorage] = useState<{ score: number | null; justificativa: string }>({ score: null, justificativa: "" })

    useEffect(() => { fetchData() }, [talentId, vagaId])

    const fetchData = async () => {
        setLoading(true)
        try {
            const [{ data: t, error: tErr }, { data: v, error: vErr }] = await Promise.all([
                supabase.from("talent_bank").select("*").eq("id", talentId).single(),
                supabase.from("vagas").select("titulo, unidade_cuca, tipo_contrato, numero_vaga").eq("id", vagaId).single(),
            ])
            if (tErr) throw tErr
            if (vErr) throw vErr
            setTalent(t)
            setVaga(v)

            // Recuperar match_score e justificativa do localStorage (calculados pelo GPT na triagem)
            try {
                const stored = localStorage.getItem(`talent_triagem_${vagaId}`)
                if (stored) {
                    const lista = JSON.parse(stored)
                    const entry = lista.find((c: any) => c.id === talentId)
                    if (entry) {
                        setMatchFromStorage({
                            score: entry.match_score ?? null,
                            justificativa: entry.justificativa || ""
                        })
                    }
                }
            } catch {}
        } catch (err: any) {
            toast.error("Erro ao carregar dados")
        } finally {
            setLoading(false)
        }
    }

    const aprovarParaVaga = async () => {
        setAprovando(true)
        try {
            // Criar nova candidatura para esta vaga (copia CV e dados do talent)
            const { data: novaCandidatura, error: insErr } = await supabase
                .from("candidaturas")
                .insert({
                    vaga_id: vagaId,
                    nome: talent.nome,
                    telefone: talent.telefone || null,
                    data_nascimento: talent.data_nascimento || null,
                    arquivo_cv_url: talent.arquivo_cv_url || null,
                    dados_ocr_json: talent.skills_jsonb || null,
                    match_score: matchFromStorage.score ?? null,
                    status: "pendente",
                    area_interesse: talent.area_interesse || null,
                    observacoes: `banco_talentos:${talentId}`,
                })
                .select("id")
                .single()

            if (insErr) throw insErr

            // Disparar análise de IA em background se houver CV
            if (talent.arquivo_cv_url && novaCandidatura?.id) {
                fetch("/api/empregabilidade/talent-bank/disparar-ia", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        candidatura_id: novaCandidatura.id,
                        cv_url: talent.arquivo_cv_url,
                        vaga_id: vagaId,
                    }),
                }).catch(() => null)
            }

            // Marcar candidato no banco de talentos como selecionado (permanece visível)
            await supabase
                .from("talent_bank")
                .update({ status: "selecionado", updated_at: new Date().toISOString() })
                .eq("id", talentId)

            // Atualizar status no localStorage para manter o card visível com badge "Aprovado"
            try {
                const stored = localStorage.getItem(`talent_triagem_${vagaId}`)
                if (stored) {
                    const lista = JSON.parse(stored)
                    localStorage.setItem(`talent_triagem_${vagaId}`, JSON.stringify(
                        lista.map((c: any) => c.id === talentId ? { ...c, tb_status: "selecionado" } : c)
                    ))
                }
            } catch {}

            // Notificar candidato via WhatsApp se tiver telefone
            if (talent.telefone && vaga?.titulo && vaga?.unidade_cuca) {
                await fetch("/api/empregabilidade/notificar-selecionado", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        candidatura_id: novaCandidatura.id,
                        nome: talent.nome,
                        titulo_vaga: vaga.titulo,
                        unidade_cuca: vaga.unidade_cuca,
                    }),
                })
            }

            setAcaoFeita("aprovado")
            toast.success("Candidato importado! Redirecionando...")
            // Redireciona com timestamp para forçar fetchData() na página da vaga
            setTimeout(() => router.push(`/empregabilidade/vagas/${vagaId}?t=${Date.now()}`), 1200)
        } catch (err: any) {
            toast.error("Erro: " + err.message)
        } finally {
            setAprovando(false)
        }
    }

    const rejeitarParaEstaVaga = async () => {
        setRejeitando(true)
        try {
            // Apenas registra que foi avaliado sem alterar status no banco de talentos
            // O candidato permanece disponível para outras vagas
            toast.success("Candidato marcado como não aprovado para esta vaga. Permanece no banco de talentos.")
            setAcaoFeita("rejeitado")
        } catch (err: any) {
            toast.error("Erro: " + err.message)
        } finally {
            setRejeitando(false)
        }
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (!talent) {
        return (
            <div className="text-center py-20 text-muted-foreground">
                <Database className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p>Candidato não encontrado no banco de talentos.</p>
            </div>
        )
    }

    const skills = talent.skills_jsonb || {}
    const idade = talent.data_nascimento
        ? differenceInYears(new Date(), new Date(talent.data_nascimento))
        : null
    // Score: prioriza localStorage (calculado pelo GPT na triagem), depois skills_jsonb, depois 0
    const score = matchFromStorage.score ?? (talent as any).match_score ?? skills?.match_score ?? null
    const cvUrl = talent.arquivo_cv_url || skills?.arquivo_cv_url
    const habilidades: string[] = skills?.habilidades || []
    const resumoExperiencias: string[] = skills?.resumo_experiencias || []
    const pontosFortesArr: string[] = skills?.pontos_fortes || skills?.analise_aderencia?.pontos_fortes || []
    const pontosAtencaoArr: string[] = skills?.pontos_atencao || skills?.analise_aderencia?.pontos_atencao || []
    const vereditoFinal: string = skills?.veredito_final || skills?.analise_aderencia?.veredito_final || matchFromStorage.justificativa || ""
    const isBatch = skills?.origem === "batch_developer_triage"
    const resumoPerfil: string = skills?.resumo || ""
    const justificativaArea: string = skills?.justificativa_ia || ""

    return (
        <div className="space-y-6 pb-10">
            {/* Navegação */}
            <div className="flex items-center gap-3">
                <Button variant="outline" size="icon" onClick={() => router.push(`/empregabilidade/vagas/${vagaId}`)}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <p className="text-xs text-muted-foreground">Vagas / {vaga?.titulo} / Banco de Talentos</p>
                    <h1 className="text-xl font-bold leading-tight">{talent.nome}</h1>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* ── Coluna Esquerda ── */}
                <div className="lg:col-span-2 space-y-4">

                    {/* Identificação */}
                    <Card className="border-none shadow-sm">
                        <CardContent className="p-5">
                            <div className="flex items-start gap-4">
                                <ScoreCircle score={score} />
                                <div className="flex-1 space-y-2">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h2 className="text-lg font-bold">{talent.nome}</h2>
                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs border bg-purple-500/10 text-purple-400 border-purple-500/30">
                                            <Database className="h-3 w-3" /> Banco de Talentos
                                        </span>
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-1.5">
                                        {idade !== null && (
                                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                                <User className="h-3.5 w-3.5" />
                                                <span>{idade} anos</span>
                                            </div>
                                        )}
                                        {talent.data_nascimento && (
                                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                                <Calendar className="h-3.5 w-3.5" />
                                                <span>{format(new Date(talent.data_nascimento), "dd/MM/yyyy")}</span>
                                            </div>
                                        )}
                                        {talent.telefone && (
                                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                                <Phone className="h-3.5 w-3.5" />
                                                <a href={`tel:${talent.telefone}`} className="hover:text-cuca-blue transition-colors">
                                                    {talent.telefone}
                                                </a>
                                            </div>
                                        )}
                                        {skills?.escolaridade && (
                                            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                                <GraduationCap className="h-3.5 w-3.5" />
                                                <span>{skills.escolaridade}</span>
                                            </div>
                                        )}
                                        <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                            <Clock className="h-3.5 w-3.5" />
                                            <span>{formatarExperiencia(skills?.experiencia_meses)}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Habilidades */}
                    {habilidades.length > 0 && (
                        <Card className="border-none shadow-sm">
                            <CardContent className="p-5">
                                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                    <Star className="h-4 w-4 text-cuca-blue" />
                                    Habilidades
                                </h3>
                                <div className="flex flex-wrap gap-1.5">
                                    {habilidades.map((h: string, i: number) => (
                                        <Badge key={i} variant="secondary" className="text-xs">{h}</Badge>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Experiências */}
                    {resumoExperiencias.length > 0 && (
                        <Card className="border-none shadow-sm">
                            <CardContent className="p-5">
                                <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                    <Briefcase className="h-4 w-4 text-cuca-blue" />
                                    Experiências
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

                    {/* Perfil batch (quando não tem análise completa) */}
                    {isBatch && (resumoPerfil || justificativaArea) && pontosFortesArr.length === 0 && (
                        <Card className="border-none shadow-sm">
                            <CardContent className="p-5 space-y-3">
                                <h3 className="text-sm font-semibold flex items-center gap-2">
                                    <TrendingUp className="h-4 w-4 text-cuca-blue" />
                                    Perfil do Candidato
                                </h3>
                                {resumoPerfil && (
                                    <div>
                                        <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Resumo Profissional</p>
                                        <p className="text-sm text-muted-foreground leading-relaxed">{resumoPerfil}</p>
                                    </div>
                                )}
                                {justificativaArea && (
                                    <div>
                                        <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Classificação de Área pela IA</p>
                                        <p className="text-sm text-muted-foreground">{justificativaArea}</p>
                                    </div>
                                )}
                                {vereditoFinal && (
                                    <div className="bg-muted/50 rounded-lg p-3">
                                        <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Compatibilidade com a Vaga</p>
                                        <p className="text-sm">{vereditoFinal}</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* Análise IA completa (candidatura com OCR detalhado) */}
                    {(pontosFortesArr.length > 0 || pontosAtencaoArr.length > 0 || vereditoFinal) && !isBatch && (
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
                                        <p className="text-xs font-semibold text-muted-foreground uppercase mb-1">Veredito</p>
                                        <p className="text-sm">{vereditoFinal}</p>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </div>

                {/* ── Coluna Direita: ações ── */}
                <div className="space-y-4">

                    {/* Ações para esta vaga */}
                    <Card className="border-none shadow-sm">
                        <CardContent className="p-5 space-y-3">
                            <h3 className="text-sm font-semibold">Ações para esta Vaga</h3>
                            <p className="text-xs text-muted-foreground">{vaga?.titulo}</p>

                            {acaoFeita === "aprovado" && (
                                <div className="flex items-center gap-2 text-xs text-green-400 bg-green-500/10 border border-green-500/20 rounded-lg px-3 py-2">
                                    <CheckCircle className="h-3.5 w-3.5 flex-shrink-0" />
                                    Candidato aprovado! Candidatura criada.
                                </div>
                            )}
                            {acaoFeita === "rejeitado" && (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted border border-border rounded-lg px-3 py-2">
                                    <XCircle className="h-3.5 w-3.5 flex-shrink-0" />
                                    Não aprovado para esta vaga. Permanece no banco de talentos.
                                </div>
                            )}

                            {!acaoFeita && (
                                <>
                                    <Button
                                        className="w-full bg-green-600 hover:bg-green-700 text-white"
                                        onClick={aprovarParaVaga}
                                        disabled={aprovando}
                                    >
                                        {aprovando
                                            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            : <CheckCircle className="mr-2 h-4 w-4" />}
                                        Aprovar para a Vaga
                                    </Button>
                                    <Button
                                        variant="outline"
                                        className="w-full border-muted text-muted-foreground hover:bg-muted"
                                        onClick={rejeitarParaEstaVaga}
                                        disabled={rejeitando}
                                    >
                                        {rejeitando
                                            ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            : <XCircle className="mr-2 h-4 w-4" />}
                                        Não aprovado para esta vaga
                                    </Button>
                                </>
                            )}

                            <p className="text-xs text-muted-foreground">
                                "Não aprovado" mantém o candidato disponível no banco de talentos para futuras triagens.
                            </p>
                        </CardContent>
                    </Card>

                    {/* Currículo */}
                    {cvUrl && (
                        <Card className="border-none shadow-sm">
                            <CardContent className="p-5 space-y-2">
                                <h3 className="text-sm font-semibold">Currículo</h3>
                                <Button
                                    variant="outline"
                                    className="w-full"
                                    onClick={() => window.open(cvUrl, "_blank")}
                                >
                                    <ExternalLink className="mr-2 h-4 w-4" />
                                    Ver Currículo
                                </Button>
                            </CardContent>
                        </Card>
                    )}

                    {/* Info banco de talentos */}
                    <Card className="border-none shadow-sm">
                        <CardContent className="p-5 space-y-2">
                            <h3 className="text-sm font-semibold flex items-center gap-2">
                                <Database className="h-4 w-4 text-purple-400" />
                                Banco de Talentos
                            </h3>
                            <div className="space-y-1 text-xs text-muted-foreground">
                                <p>Status: <span className="text-purple-400 font-medium">{talent.status || "disponivel"}</span></p>
                                {talent.vaga_origem_id && (
                                    <p>Vaga de origem cadastrada</p>
                                )}
                                <p>Adicionado em {format(new Date(talent.created_at), "dd/MM/yyyy", { locale: ptBR })}</p>
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    )
}
