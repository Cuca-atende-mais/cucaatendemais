"use client"

import { useState, useEffect, useRef, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Briefcase, Building2, CheckCircle2, Loader2, AlertTriangle, DollarSign, Gift, ShieldCheck, ChevronRight, Bookmark, Camera, Upload, X, Tag, Home } from "lucide-react"

const AREAS_INTERESSE = [
    "Serviços Gerais (limpeza, portaria, zeladoria)",
    "Construção Civil (pedreiro, ajudante, eletricista, encanador)",
    "Logística e Entregas (estoque, separação, entregador, motorista)",
    "Comércio e Vendas (vendedor, caixa, atendimento)",
    "Alimentação (cozinha, garçom, lanchonete)",
    "Tecnologia (suporte técnico, programação, dados)",
    "Criativo / Digital (design, vídeo, redes sociais)",
    "Beleza e Estética (barbeiro, manicure, cabeleireiro)",
    "Cuidados Pessoais (babá, cuidador de idosos)",
    "Administrativo / Escritório (recepção, auxiliar administrativo)",
]
import toast from "react-hot-toast"

export default function CandidaturaPublicaPage() {
    return (
        <Suspense fallback={
            <div className="min-h-screen flex items-center justify-center bg-muted/30">
                <Loader2 className="h-10 w-10 animate-spin text-cuca-blue" />
            </div>
        }>
            <CandidaturaContent />
        </Suspense>
    )
}

function CandidaturaContent() {
    const searchParams = useSearchParams()
    const vagaId = searchParams.get("vaga_id")
    const nomeParam = searchParams.get("nome") || ""
    const origemTel = searchParams.get("origem_tel") || ""
    const conversaId = searchParams.get("conversa_id") || ""
    const bancoTalentosParam = searchParams.get("banco_talentos") === "1"
    const cargoEscolhidoParam = searchParams.get("cargo_escolhido") || "" // SQS-49

    const [vaga, setVaga] = useState<any>(null)
    const [empresa, setEmpresa] = useState<any>(null)
    const [loadingVaga, setLoadingVaga] = useState(true)
    const [vagaInvalida, setVagaInvalida] = useState(false)

    const [nome, setNome] = useState(nomeParam)
    const [dataNascimento, setDataNascimento] = useState("")
    const [telefone, setTelefone] = useState(
        origemTel ? formatPhoneInit(origemTel) : ""
    )
    const [arquivo, setArquivo] = useState<File | null>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const cameraInputRef = useRef<HTMLInputElement>(null)
    const [arquivoPreview, setArquivoPreview] = useState<string | null>(null)

    const showAreaInteresse = bancoTalentosParam

    const [areasInteresse, setAreasInteresse] = useState<string[]>([])
    const [pcdCandidato, setPcdCandidato] = useState(false)
    const [pcdTipoCandidato, setPcdTipoCandidato] = useState("")

    const toggleArea = (a: string) => {
        setAreasInteresse(prev => prev.includes(a) ? prev.filter(x => x !== a) : [...prev, a])
    }

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

    const formatPhone = (value: string) => {
        let digits = value.replace(/\D/g, "")
        // Remove prefixo 55 (Brasil) se presente e resultar em 13 dígitos
        if (digits.length === 13 && digits.startsWith("55")) digits = digits.slice(2)
        if (digits.length === 12 && digits.startsWith("55")) digits = digits.slice(2)
        return digits
            .replace(/^(\d{2})(\d)/g, "($1) $2")
            .replace(/(\d{5})(\d{4})$/, "$1-$2")
            .replace(/(\d{4})(\d{4})$/, "$1-$2")
            .substring(0, 15)
    }

    // Usado apenas para o valor inicial vindo do parâmetro da URL
    function formatPhoneInit(raw: string) {
        let digits = raw.replace(/\D/g, "")
        if (digits.length === 13 && digits.startsWith("55")) digits = digits.slice(2)
        if (digits.length === 12 && digits.startsWith("55")) digits = digits.slice(2)
        return digits
            .replace(/^(\d{2})(\d)/g, "($1) $2")
            .replace(/(\d{5})(\d{4})$/, "$1-$2")
            .replace(/(\d{4})(\d{4})$/, "$1-$2")
            .substring(0, 15)
    }

    const calcularIdade = (dataNasc: string): number => {
        const nasc = new Date(dataNasc)
        const hoje = new Date()
        let idade = hoje.getFullYear() - nasc.getFullYear()
        const m = hoje.getMonth() - nasc.getMonth()
        if (m < 0 || (m === 0 && hoje.getDate() < nasc.getDate())) idade--
        return idade
    }

    const handleFileSelected = (file: File | null) => {
        setArquivo(file)
        if (file && file.type.startsWith("image/")) {
            const reader = new FileReader()
            reader.onload = (e) => setArquivoPreview(e.target?.result as string)
            reader.readAsDataURL(file)
        } else {
            setArquivoPreview(null)
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!nome || !dataNascimento || !telefone) {
            toast.error("Preencha todos os campos obrigatórios.")
            return
        }
        if (!arquivo) {
            toast.error("Anexe seu currículo ou tire uma foto do documento.")
            return
        }
        if (showAreaInteresse && areasInteresse.length === 0) {
            toast.error("Selecione pelo menos uma área de interesse.")
            return
        }

        setLoadingSubmit(true)
        try {
            let destinoBancoTalentos = bancoTalentosParam

            // Validação etária — bloqueio rígido para vagas "Maior de 18 anos"
            if (vaga?.faixa_etaria === "Maior de 18 anos" && calcularIdade(dataNascimento) < 18) {
                toast.error("⚠️ Esta vaga exige idade mínima de 18 anos. Sua candidatura não pode ser concluída.")
                setLoadingSubmit(false)
                return
            }

            // Verificar limite de currículos (conta apenas candidaturas reais, não banco de talentos)
            if (!destinoBancoTalentos && vaga?.limite_curriculos && vagaId) {
                const { count } = await supabase
                    .from("candidaturas")
                    .select("id", { count: "exact", head: true })
                    .eq("vaga_id", vagaId)
                    .not("observacoes", "ilike", "banco_talentos:%")
                if ((count ?? 0) >= vaga.limite_curriculos) {
                    destinoBancoTalentos = true
                }
            }

            const fd = new FormData()
            fd.append("file", arquivo)
            fd.append("folder", `candidaturas/${vagaId || "banco_talentos"}`)
            const upRes = await fetch("/api/empregabilidade/upload-cv", { method: "POST", body: fd })
            if (!upRes.ok) {
                const errData = await upRes.json().catch(() => ({}))
                throw new Error(errData.error || `Erro no upload (HTTP ${upRes.status}).`)
            }
            const { url: publicUrl } = await upRes.json()

            const obsArr: string[] = []
            if (destinoBancoTalentos) {
                obsArr.push(bancoTalentosParam ? "banco_talentos: candidatura geral" : "banco_talentos: limite de currículos atingido")
            }
            if (calcularIdade(dataNascimento) < 18 && vaga?.faixa_etaria && /18\+|maior.*18|adulto/i.test(vaga.faixa_etaria)) {
                obsArr[0] = "banco_talentos: menor de idade"
            }

            const res = await fetch("/api/empregabilidade/candidaturas", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    vaga_id: vagaId || null,
                    nome,
                    data_nascimento: dataNascimento,
                    telefone: telefone.replace(/\D/g, ""),
                    arquivo_cv_url: publicUrl,
                    status: "pendente",
                    requisitos_atendidos: "pendente",
                    observacoes: obsArr.length > 0 ? obsArr[0] : null,
                    conversa_id: conversaId || null,
                    area_interesse: areasInteresse,
                    pcd_candidato: pcdCandidato,
                    pcd_tipo_candidato: pcdCandidato ? (pcdTipoCandidato || null) : null,
                    cargo_escolhido: cargoEscolhidoParam || null, // SQS-49
                }),
            })
            const candData = await res.json()
            if (res.status === 409) {
                toast.error(candData.error || "Você já está inscrito nesta vaga.")
                return
            }
            if (!res.ok) throw new Error(candData.error || `Erro ${res.status}`)

            const codigo = candData.codigo

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
                        {!destinadoBancoTalentos && (
                            <>
                                <div className="bg-muted rounded-lg px-6 py-3 mb-4">
                                    <p className="text-xs text-muted-foreground mb-1">Número de acompanhamento</p>
                                    <p className="text-2xl font-bold tracking-widest text-cuca-blue">{numeroCandidatura}</p>
                                </div>
                                <p className="text-xs text-muted-foreground mb-6">
                                    Use esse número para acompanhar pelo WhatsApp da unidade CUCA.
                                </p>
                            </>
                        )}
                        <Button
                            variant="outline"
                            className="w-full"
                            onClick={() => {
                                window.close()
                                // Fallback para navegadores in-app (WhatsApp, Instagram) que bloqueiam window.close()
                                setTimeout(() => {
                                    window.location.href = "https://www.cucaatendemais.com.br"
                                }, 300)
                            }}
                        >
                            <Home className="mr-2 h-4 w-4" />
                            Encerrar
                        </Button>
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
                                    maxLength={16}
                                    required
                                />
                            </div>

                            <div className="space-y-2">
                                <Label>Currículo (PDF, JPG, PNG) *</Label>
                                <div className="grid grid-cols-2 gap-2">
                                    <button
                                        type="button"
                                        onClick={() => fileInputRef.current?.click()}
                                        className="flex items-center justify-center gap-2 rounded-md border border-input bg-muted/40 px-3 py-3 text-sm font-medium hover:bg-muted/70 transition-colors"
                                    >
                                        <Upload className="h-4 w-4" />
                                        Escolher Arquivo
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => cameraInputRef.current?.click()}
                                        className="flex items-center justify-center gap-2 rounded-md border border-input bg-muted/40 px-3 py-3 text-sm font-medium hover:bg-muted/70 transition-colors"
                                    >
                                        <Camera className="h-4 w-4" />
                                        Tirar Foto
                                    </button>
                                </div>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept=".pdf,image/png,image/jpeg"
                                    className="hidden"
                                    onChange={(e) => handleFileSelected(e.target.files?.[0] || null)}
                                />
                                <input
                                    ref={cameraInputRef}
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    className="hidden"
                                    onChange={(e) => handleFileSelected(e.target.files?.[0] || null)}
                                />
                                {arquivo && (
                                    <div className="flex items-center gap-2 rounded-md border border-green-500/30 bg-green-500/10 px-3 py-2">
                                        {arquivoPreview ? (
                                            <img src={arquivoPreview} alt="Preview" className="h-10 w-10 object-cover rounded" />
                                        ) : null}
                                        <div className="flex-1 min-w-0">
                                            <p className="text-xs font-medium truncate">{arquivo.name}</p>
                                            <p className="text-[10px] text-muted-foreground">{(arquivo.size / 1024).toFixed(0)} KB</p>
                                        </div>
                                        <button type="button" onClick={() => { handleFileSelected(null); if(fileInputRef.current) fileInputRef.current.value=""; if(cameraInputRef.current) cameraInputRef.current.value=""; }}>
                                            <X className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                                        </button>
                                    </div>
                                )}
                                <p className="text-[10px] text-muted-foreground">
                                    Seu currículo será lido por nossa Inteligência Artificial para análise de compatibilidade.
                                </p>
                            </div>

                            {/* PCD */}
                            <div className="space-y-3 pt-1">
                                <Label className="text-base font-semibold">Você é Pessoa com Deficiência (PCD)?</Label>
                                <div className="flex gap-3">
                                    <label className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 cursor-pointer text-sm transition-colors ${!pcdCandidato ? "border-cuca-blue bg-cuca-blue/10 text-cuca-blue font-medium" : "border-border"}`}>
                                        <input type="radio" name="pcdCand" checked={!pcdCandidato} onChange={() => { setPcdCandidato(false); setPcdTipoCandidato("") }} className="accent-cuca-blue" /> Não
                                    </label>
                                    <label className={`flex items-center gap-2 rounded-lg border px-4 py-2.5 cursor-pointer text-sm transition-colors ${pcdCandidato ? "border-cuca-blue bg-cuca-blue/10 text-cuca-blue font-medium" : "border-border"}`}>
                                        <input type="radio" name="pcdCand" checked={pcdCandidato} onChange={() => setPcdCandidato(true)} className="accent-cuca-blue" /> Sim
                                    </label>
                                </div>
                                {pcdCandidato && (
                                    <Input value={pcdTipoCandidato} onChange={e => setPcdTipoCandidato(e.target.value)} placeholder="Tipo de deficiência (opcional)" />
                                )}
                            </div>

                            {/* Área de interesse — apenas para banco de talentos */}
                            {showAreaInteresse && (
                                <div className="space-y-3 pt-1">
                                    <div className="flex items-center gap-2">
                                        <Tag className="h-4 w-4 text-cuca-blue" />
                                        <Label className="text-base font-semibold">Área de Interesse *</Label>
                                    </div>
                                    <p className="text-xs text-muted-foreground -mt-1">Em quais áreas você quer trabalhar? Selecione todas que se aplicam.</p>
                                    <div className="grid grid-cols-1 gap-2">
                                        {AREAS_INTERESSE.map(a => (
                                            <label key={a} className={`flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer text-sm transition-colors ${areasInteresse.includes(a) ? "border-cuca-blue bg-cuca-blue/10 text-cuca-blue font-medium" : "border-border hover:border-cuca-blue/50"}`}>
                                                <input type="checkbox" className="accent-cuca-blue" checked={areasInteresse.includes(a)} onChange={() => toggleArea(a)} />
                                                {a}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}

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
