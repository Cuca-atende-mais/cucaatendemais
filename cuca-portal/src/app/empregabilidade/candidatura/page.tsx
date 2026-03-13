"use client"

import { useState, useEffect } from "react"
import { useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Briefcase, Building2, CheckCircle2, Loader2, AlertTriangle, DollarSign, Gift, ShieldCheck, ChevronRight, Bookmark } from "lucide-react"
import toast from "react-hot-toast"

export default function CandidaturaPublicaPage() {
    const searchParams = useSearchParams()
    const vagaId = searchParams.get("vaga_id")
    const nomeParam = searchParams.get("nome") || ""
    const origemTel = searchParams.get("origem_tel") || ""
    const conversaId = searchParams.get("conversa_id") || ""
    const bancoTalentosParam = searchParams.get("banco_talentos") === "1"

    const [vaga, setVaga] = useState<any>(null)
    const [empresa, setEmpresa] = useState<any>(null)
    const [loadingVaga, setLoadingVaga] = useState(true)
    const [vagaInvalida, setVagaInvalida] = useState(false)

    const [nome, setNome] = useState(nomeParam)
    const [dataNascimento, setDataNascimento] = useState("")
    const [telefone, setTelefone] = useState(
        origemTel
            ? origemTel.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d)(\d{4})$/, "$1-$2").substring(0, 15)
            : ""
    )
    const [arquivo, setArquivo] = useState<File | null>(null)

    const [loadingSubmit, setLoadingSubmit] = useState(false)
    const [success, setSuccess] = useState(false)
    const [numeroCandidatura, setNumeroCandidatura] = useState("")
    const [destinadoBancoTalentos, setDestinadoBancoTalentos] = useState(false)

    const supabase = createClient()

    useEffect(() => {
        // Candidatura geral (banco de talentos sem vaga específica)
        if (!vagaId || bancoTalentosParam) {
            setLoadingVaga(false)
            return
        }
        supabase
            .from("vagas")
            .select("*")
            .eq("id", vagaId)
            .eq("status", "aberta")
            .single()
            .then(async ({ data: vData, error: vError }) => {
                if (vError || !vData) {
                    setVagaInvalida(true)
                } else {
                    setVaga(vData)
                    if (vData.empresa_id) {
                        const { data: eData } = await supabase
                            .from("empresas")
                            .select("nome, nome_fantasia")
                            .eq("id", vData.empresa_id)
                            .single()
                        setEmpresa(eData)
                    }
                }
                setLoadingVaga(false)
            })
    }, [vagaId])

    const formatPhone = (value: string) =>
        value
            .replace(/\D/g, "")
            .replace(/^(\d{2})(\d)/g, "($1) $2")
            .replace(/(\d)(\d{4})$/, "$1-$2")
            .substring(0, 15)

    const calcularIdade = (dataNasc: string): number => {
        const nasc = new Date(dataNasc)
        const hoje = new Date()
        let idade = hoje.getFullYear() - nasc.getFullYear()
        const m = hoje.getMonth() - nasc.getMonth()
        if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--
        return idade
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!nome || !dataNascimento || !telefone || !arquivo) {
            toast.error("Preencha todos os campos e anexe seu currículo.")
            return
        }

        setLoadingSubmit(true)
        try {
            let destinoBancoTalentos = bancoTalentosParam

            // Validação etária
            if (!destinoBancoTalentos && vaga?.faixa_etaria) {
                const exige18 = /18\+|maior.*18|adulto/i.test(vaga.faixa_etaria)
                if (exige18 && calcularIdade(dataNascimento) < 18) {
                    destinoBancoTalentos = true
                }
            }

            // Verificar limite de currículos
            if (!destinoBancoTalentos && vaga?.limite_curriculos && vagaId) {
                const { count } = await supabase
                    .from("candidaturas")
                    .select("id", { count: "exact", head: true })
                    .eq("vaga_id", vagaId)
                if ((count ?? 0) >= vaga.limite_curriculos) {
                    destinoBancoTalentos = true
                }
            }

            const fileExt = arquivo.name.split(".").pop()
            const filePath = `${vagaId || "banco_talentos"}/${Math.random()}.${fileExt}`

            const { error: uploadError } = await supabase.storage
                .from("curriculos")
                .upload(filePath, arquivo, { upsert: false })
            if (uploadError) throw uploadError

            const { data: { publicUrl } } = supabase.storage.from("curriculos").getPublicUrl(filePath)

            const obsArr: string[] = []
            if (destinoBancoTalentos) {
                obsArr.push(bancoTalentosParam ? "banco_talentos: candidatura geral" : "banco_talentos: limite de currículos atingido")
            }
            if (calcularIdade(dataNascimento) < 18 && vaga?.faixa_etaria && /18\+|maior.*18|adulto/i.test(vaga.faixa_etaria)) {
                obsArr[0] = "banco_talentos: menor de idade"
            }

            const { data: candData, error: candError } = await supabase
                .from("candidaturas")
                .insert({
                    vaga_id: vagaId || null,
                    nome,
                    data_nascimento: dataNascimento,
                    telefone: telefone.replace(/\D/g, ""),
                    arquivo_cv_url: publicUrl,
                    status: "pendente",
                    requisitos_atendidos: "pendente",
                    observacoes: obsArr.length > 0 ? obsArr[0] : null,
                })
                .select("id")
                .single()
            if (candError) throw candError

            const codigo = candData.id.replace(/-/g, "").slice(-6).toUpperCase()

            // Notificar worker via metadata da conversa de origem
            if (conversaId) {
                try {
                    const { data: convData } = await supabase
                        .from("conversas")
                        .select("metadata")
                        .eq("id", conversaId)
                        .single()
                    if (convData) {
                        const metadata = convData.metadata || {}
                        metadata.empreg_fluxo = {
                            ...(metadata.empreg_fluxo || {}),
                            candidatura_criada_id: candData.id,
                            candidatura_codigo: codigo,
                        }
                        await supabase
                            .from("conversas")
                            .update({ metadata })
                            .eq("id", conversaId)
                    }
                } catch (notifyErr) {
                    console.warn("Erro ao notificar worker:", notifyErr)
                }
            }

            // Disparar OCR assíncrono (apenas para candidaturas não-banco de talentos)
            if (!destinoBancoTalentos) {
                fetch("/api/process-cv", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        candidatura_id: candData.id,
                        vaga_id: vagaId,
                        cv_url: publicUrl,
                    }),
                }).catch((err) => console.error("OCR warning:", err))
            }

            setNumeroCandidatura(codigo)
            setDestinadoBancoTalentos(destinoBancoTalentos)
            setSuccess(true)
            toast.success("Candidatura enviada com sucesso!")
        } catch (error: any) {
            console.error("Erro no envio:", error)
            toast.error(error.message || "Não foi possível enviar sua candidatura agora.")
        } finally {
            setLoadingSubmit(false)
        }
    }

    if (loadingVaga) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-muted/30">
                <Loader2 className="h-10 w-10 animate-spin text-cuca-blue" />
            </div>
        )
    }

    if (vagaInvalida) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
                <Card className="max-w-md text-center p-8 border-none shadow-lg">
                    <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
                    <h2 className="text-xl font-bold mb-2">Vaga Indisponível</h2>
                    <p className="text-muted-foreground text-sm">
                        Esta vaga não está mais disponível ou o link é inválido.
                        Entre em contato com a unidade CUCA para verificar oportunidades abertas.
                    </p>
                </Card>
            </div>
        )
    }

    if (success) {
        return (
            <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
                <Card className="max-w-md w-full border-none shadow-xl text-center">
                    <CardContent className="pt-10 pb-8 flex flex-col items-center">
                        <div className={`h-20 w-20 rounded-full flex items-center justify-center mb-6 ${destinadoBancoTalentos ? "bg-blue-500/15" : "bg-green-100"}`}>
                            {destinadoBancoTalentos
                                ? <Bookmark className="h-10 w-10 text-blue-500" />
                                : <CheckCircle2 className="h-10 w-10 text-green-600" />
                            }
                        </div>
                        {destinadoBancoTalentos ? (
                            <>
                                <h2 className="text-2xl font-bold tracking-tight mb-2">Currículo Recebido!</h2>
                                <p className="text-muted-foreground text-sm mb-4">
                                    Seu currículo foi adicionado ao nosso <strong>banco de talentos</strong>.
                                    Você será notificado pelo WhatsApp quando surgir uma oportunidade compatível com seu perfil.
                                </p>
                            </>
                        ) : (
                            <>
                                <h2 className="text-2xl font-bold tracking-tight mb-2">Candidatura Enviada!</h2>
                                <p className="text-muted-foreground text-sm mb-4">
                                    Seu currículo para <strong>{vaga?.titulo}</strong> foi recebido.
                                    Nossa IA fará a triagem e você será notificado pelo WhatsApp.
                                </p>
                            </>
                        )}
                        <div className="bg-muted rounded-lg px-6 py-3 mb-4">
                            <p className="text-xs text-muted-foreground mb-1">Número de acompanhamento</p>
                            <p className="text-2xl font-bold tracking-widest text-cuca-blue">{numeroCandidatura}</p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Use esse número para acompanhar pelo WhatsApp da unidade CUCA.
                        </p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-muted/30 pb-12">
            {bancoTalentosParam ? (
                <div className="bg-cuca-dark text-white pt-16 pb-24 px-4 sm:px-6 lg:px-8">
                    <div className="max-w-2xl mx-auto space-y-3">
                        <Badge className="bg-cuca-yellow text-cuca-dark hover:bg-cuca-yellow/90">Banco de Talentos</Badge>
                        <h1 className="text-3xl font-bold tracking-tight">Cadastre seu Currículo</h1>
                        <p className="text-gray-300 text-sm">
                            Sem vaga específica no momento? Deixe seu currículo — a equipe CUCA entrará em contato quando surgir uma oportunidade compatível.
                        </p>
                    </div>
                </div>
            ) : (
                <div className="bg-cuca-dark text-white pt-16 pb-24 px-4 sm:px-6 lg:px-8">
                    <div className="max-w-2xl mx-auto space-y-3">
                        <Badge className="bg-cuca-yellow text-cuca-dark hover:bg-cuca-yellow/90">Oportunidade Juventude</Badge>
                        <h1 className="text-3xl font-bold tracking-tight">{vaga?.titulo}</h1>
                        <div className="flex flex-wrap items-center gap-4 text-gray-300 text-sm">
                            <div className="flex items-center gap-2">
                                <Building2 className="h-4 w-4" />
                                {empresa?.nome_fantasia || empresa?.nome || "Empresa Parceira CUCA"}
                            </div>
                            {vaga?.tipo_contrato && (
                                <div className="flex items-center gap-2">
                                    <Briefcase className="h-4 w-4" />
                                    {vaga.tipo_contrato}
                                </div>
                            )}
                            {vaga?.salario && (
                                <div className="flex items-center gap-2">
                                    <DollarSign className="h-4 w-4" />
                                    {vaga.salario}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 -mt-12 space-y-6">
                {!bancoTalentosParam && vaga?.descricao && (
                    <Card className="border-none shadow-md">
                        <CardHeader className="border-b bg-muted/20">
                            <CardTitle className="text-base">Sobre a vaga</CardTitle>
                        </CardHeader>
                        <CardContent className="p-6 space-y-4">
                            <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{vaga.descricao}</p>
                            {vaga.requisitos && (
                                <div>
                                    <p className="text-sm font-medium mb-1">Requisitos</p>
                                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{vaga.requisitos}</p>
                                </div>
                            )}
                            {vaga.beneficios && (
                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <Gift className="h-4 w-4 text-cuca-blue" />
                                        <p className="text-sm font-medium">Benefícios</p>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {vaga.beneficios.split(", ").map((b: string) => (
                                            <Badge key={b} variant="secondary" className="text-xs">{b}</Badge>
                                        ))}
                                    </div>
                                </div>
                            )}
                            {vaga.tipo_selecao && (
                                <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                                    <ShieldCheck className="h-4 w-4 text-cuca-blue mt-0.5 shrink-0" />
                                    <div>
                                        <p className="text-xs font-medium text-cuca-blue">Processo Seletivo</p>
                                        <p className="text-xs text-muted-foreground">
                                            {vaga.tipo_selecao === "coleta_curriculo" && "Coleta de Currículo — a empresa conduz o processo seletivo."}
                                            {vaga.tipo_selecao === "entrevista_unidade" && "Entrevista na Unidade CUCA — a equipe agendará sua entrevista."}
                                            {vaga.tipo_selecao === "triagem_cuca" && `Triagem Inicial pelo CUCA${vaga.unidade_cuca ? ` ${vaga.unidade_cuca}` : ""} — candidatos serão pré-selecionados antes do encaminhamento.`}
                                        </p>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                )}

                <Card className="border-none shadow-md">
                    <CardHeader className="border-b bg-muted/20">
                        <CardTitle className="text-lg">{bancoTalentosParam ? "Enviar Currículo" : "Enviar Candidatura"}</CardTitle>
                        <CardDescription>Preencha seus dados e anexe seu currículo em PDF ou imagem.</CardDescription>
                    </CardHeader>
                    <CardContent className="p-6">
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="nome">Nome Completo *</Label>
                                <Input
                                    id="nome"
                                    value={nome}
                                    onChange={(e) => setNome(e.target.value)}
                                    placeholder="João da Silva"
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="dataNascimento">Data de Nascimento *</Label>
                                <Input
                                    id="dataNascimento"
                                    type="date"
                                    value={dataNascimento}
                                    onChange={(e) => setDataNascimento(e.target.value)}
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="telefone">WhatsApp *</Label>
                                <Input
                                    id="telefone"
                                    value={telefone}
                                    onChange={(e) => setTelefone(formatPhone(e.target.value))}
                                    placeholder="(85) 90000-0000"
                                    maxLength={15}
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="cv">Currículo (PDF, JPG, PNG) *</Label>
                                <Input
                                    id="cv"
                                    type="file"
                                    accept=".pdf,image/png,image/jpeg"
                                    onChange={(e) => setArquivo(e.target.files?.[0] || null)}
                                    className="cursor-pointer file:bg-muted file:text-muted-foreground file:border-0 file:mr-4 file:px-4 file:py-2 file:rounded-md hover:file:bg-muted/80"
                                    required
                                />
                                <p className="text-[10px] text-muted-foreground">
                                    Seu currículo será lido por nossa Inteligência Artificial para análise de compatibilidade.
                                </p>
                            </div>

                            <Button
                                type="submit"
                                className="w-full mt-2 bg-cuca-blue hover:bg-sky-800 text-white font-bold"
                                disabled={loadingSubmit}
                            >
                                {loadingSubmit ? (
                                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando...</>
                                ) : (
                                    <>{bancoTalentosParam ? "Cadastrar no Banco de Talentos" : "Enviar Candidatura"} <ChevronRight className="ml-1 h-4 w-4" /></>
                                )}
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
