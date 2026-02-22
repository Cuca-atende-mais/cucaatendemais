"use client"

import { useState, useEffect } from "react"
import { useParams } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Vaga, Empresa } from "@/lib/types/database"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Briefcase, Building2, MapPin, Calendar, Clock, DollarSign, CheckCircle2, Loader2, UploadCloud, ChevronRight } from "lucide-react"
import toast from "react-hot-toast"

export default function VagaPublicaPage() {
    const params = useParams()
    const id = params.id as string

    const [vaga, setVaga] = useState<Vaga | null>(null)
    const [empresa, setEmpresa] = useState<Empresa | null>(null)
    const [loadingInfo, setLoadingInfo] = useState(true)

    const [nome, setNome] = useState("")
    const [dataNascimento, setDataNascimento] = useState("")
    const [telefone, setTelefone] = useState("")
    const [arquivo, setArquivo] = useState<File | null>(null)

    const [loadingSubmit, setLoadingSubmit] = useState(false)
    const [success, setSuccess] = useState(false)

    const supabase = createClient()

    useEffect(() => {
        if (id) {
            buscarVaga(id)
        }
    }, [id])

    const buscarVaga = async (vagaId: string) => {
        try {
            const { data: vData, error: vError } = await supabase.from('vagas').select('*').eq('id', vagaId).single()
            if (vError) throw vError

            setVaga(vData)

            if (vData?.empresa_id) {
                const { data: eData } = await supabase.from('empresas').select('*').eq('id', vData.empresa_id).single()
                setEmpresa(eData)
            }
        } catch (error) {
            console.error("Erro ao carregar vaga:", error)
            toast.error("Vaga não encontrada.")
        } finally {
            setLoadingInfo(false)
        }
    }

    const formatPhone = (value: string) => {
        return value
            .replace(/\D/g, '')
            .replace(/^(\d{2})(\d)/g, '($1) $2')
            .replace(/(\d)(\d{4})$/, '$1-$2')
            .substring(0, 15)
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!nome || !dataNascimento || !telefone || !arquivo) {
            toast.error("Por favor, preencha todos os campos e anexe seu currículo (PDF/Imagem).")
            return
        }

        setLoadingSubmit(true)

        try {
            // 1. Upload do Arquivo no Supabase Storage
            const fileExt = arquivo.name.split('.').pop()
            const fileName = `${Math.random()}.${fileExt}`
            const filePath = `${vaga?.id}/${fileName}`

            const { error: uploadError } = await supabase.storage
                .from('curriculos')
                .upload(filePath, arquivo, { upsert: false })

            if (uploadError) throw uploadError

            // Gerar URL publica
            const { data: { publicUrl } } = supabase.storage.from('curriculos').getPublicUrl(filePath)

            // 2. Salvar na Tabela 'candidaturas'
            const { data: candData, error: candError } = await supabase.from('candidaturas').insert({
                vaga_id: vaga?.id,
                nome,
                data_nascimento: dataNascimento,
                telefone: formatPhone(telefone),
                arquivo_cv_url: publicUrl,
                status: 'pendente',
                requisitos_atendidos: 'pendente'
            }).select('id').single()

            if (candError) throw candError

            // 3. Chamar API Next.js para fazer o proxy pro Worker FastAPI processar o OCR GPT-4o
            fetch('/api/process-cv', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    candidatura_id: candData.id,
                    vaga_id: vaga?.id,
                    cv_url: publicUrl
                })
            }).catch(err => console.error("Warning: Falha ao chamar motor OCR:", err))

            setSuccess(true)
            toast.success("Candidatura enviada com sucesso!")

        } catch (error: any) {
            console.error("Erro no envio:", error)
            toast.error(error.message || "Não foi possível enviar sua candidatura agora.")
        } finally {
            setLoadingSubmit(false)
        }
    }

    if (loadingInfo) {
        return <div className="min-h-screen flex items-center justify-center bg-muted/30"><Loader2 className="h-10 w-10 animate-spin text-cuca-blue" /></div>
    }

    if (!vaga || vaga.status !== 'aberta') {
        return (
            <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
                <Card className="max-w-md text-center p-6 border-none shadow-lg">
                    <Briefcase className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h2 className="text-xl font-bold text-cuca-dark mb-2">Vaga Indisponível</h2>
                    <p className="text-muted-foreground">Esta oportunidade já foi preenchida ou não existe mais.</p>
                </Card>
            </div>
        )
    }

    if (success) {
        return (
            <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
                <Card className="max-w-md w-full border-none shadow-xl text-center animate-in fade-in zoom-in duration-500">
                    <CardContent className="pt-10 pb-8 flex flex-col items-center">
                        <div className="h-20 w-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
                            <CheckCircle2 className="h-10 w-10 text-green-600" />
                        </div>
                        <h2 className="text-2xl font-bold tracking-tight text-cuca-dark mb-2">Currículo Enviado!</h2>
                        <p className="text-muted-foreground text-sm mb-6">
                            Sua candidatura para <strong className="text-cuca-dark">{vaga.titulo}</strong> foi recebida.
                            Nossa IA fará a triagem e, se seu currículo for selecionado, a empresa ou a Rede CUCA entrarão em contato via WhatsApp.
                        </p>
                        <Button className="w-full bg-cuca-blue hover:bg-sky-800" onClick={() => window.location.href = '/'}>
                            Voltar ao início
                        </Button>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-muted/30 pb-12">
            {/* Header da Vaga */}
            <div className="bg-cuca-dark text-white pt-16 pb-24 px-4 sm:px-6 lg:px-8">
                <div className="max-w-4xl mx-auto space-y-4">
                    <Badge className="bg-cuca-yellow text-cuca-dark hover:bg-cuca-yellow/90">Oportunidade Juventude</Badge>
                    <h1 className="text-3xl md:text-5xl font-bold tracking-tight">{vaga.titulo}</h1>

                    <div className="flex flex-wrap items-center gap-4 text-sm md:text-base text-gray-300 mt-4">
                        <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4" />
                            {empresa?.nome || "Confidencial"}
                        </div>
                        <div className="flex items-center gap-2">
                            <MapPin className="h-4 w-4" />
                            {vaga.local || "Não informado"}
                        </div>
                        <div className="flex items-center gap-2">
                            <Briefcase className="h-4 w-4" />
                            {vaga.tipo_contrato?.toUpperCase().replace('_', ' ') || "N/A"}
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 -mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">

                {/* Detalhes da Vaga */}
                <div className="md:col-span-2 space-y-6">
                    <Card className="border-none shadow-md">
                        <CardHeader className="border-b bg-muted/20">
                            <CardTitle className="text-lg flex items-center gap-2">
                                <FileTextIcon className="h-5 w-5 text-cuca-blue" />
                                Detalhes da Oportunidade
                            </CardTitle>
                        </CardHeader>
                        <CardContent className="p-6 space-y-6">
                            <div>
                                <h3 className="font-semibold text-cuca-dark mb-2">Descrição</h3>
                                <p className="text-muted-foreground whitespace-pre-wrap text-sm leading-relaxed">{vaga.descricao}</p>
                            </div>

                            {vaga.requisitos && (
                                <div>
                                    <h3 className="font-semibold text-cuca-dark mb-2">Requisitos</h3>
                                    <p className="text-muted-foreground whitespace-pre-wrap text-sm leading-relaxed">{vaga.requisitos}</p>
                                </div>
                            )}

                            {vaga.beneficios && (
                                <div>
                                    <h3 className="font-semibold text-cuca-dark mb-2">Benefícios</h3>
                                    <p className="text-muted-foreground whitespace-pre-wrap text-sm leading-relaxed">{vaga.beneficios}</p>
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Painel de Candidatura */}
                <div className="space-y-6">
                    <Card className="border-none shadow-md sticky top-6">
                        <CardHeader className="bg-muted/20 border-b">
                            <CardTitle className="text-lg">Candidatar-se</CardTitle>
                            <CardDescription>Envie seu currículo em PDF ou Imagem para esta vaga.</CardDescription>
                        </CardHeader>
                        <CardContent className="p-6">

                            <div className="grid grid-cols-2 gap-4 mb-6 pt-2">
                                <div className="space-y-1">
                                    <span className="text-xs text-muted-foreground flex items-center gap-1"><DollarSign className="h-3 w-3" /> Salário</span>
                                    <p className="text-sm font-medium">{vaga.salario || "A Combinar"}</p>
                                </div>
                                <div className="space-y-1">
                                    <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Carga Horária</span>
                                    <p className="text-sm font-medium">{vaga.carga_horaria || "Não info."}</p>
                                </div>
                                <div className="space-y-1">
                                    <span className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" /> Faixa Etária</span>
                                    <p className="text-sm font-medium">{vaga.faixa_etaria || "Sem restrição"}</p>
                                </div>
                            </div>

                            <form onSubmit={handleSubmit} className="space-y-4 pt-4 border-t">
                                <div className="space-y-2">
                                    <Label htmlFor="nome">Nome Completo *</Label>
                                    <Input
                                        id="nome"
                                        value={nome}
                                        onChange={(e) => setNome(e.target.value)}
                                        placeholder="Joao da Silva..."
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
                                    <div className="relative">
                                        <Input
                                            id="cv"
                                            type="file"
                                            accept=".pdf,image/png,image/jpeg"
                                            onChange={(e) => setArquivo(e.target.files?.[0] || null)}
                                            className="cursor-pointer file:bg-muted file:text-muted-foreground file:border-0 file:mr-4 file:px-4 file:py-2 file:rounded-md hover:file:bg-muted/80"
                                            required
                                        />
                                    </div>
                                    <p className="text-[10px] text-muted-foreground mt-1">Sua imagem ou PDF será lido por nossa Inteligência Artificial.</p>
                                </div>

                                <Button
                                    type="submit"
                                    className="w-full mt-4 bg-cuca-blue hover:bg-sky-800 text-white font-bold"
                                    disabled={loadingSubmit}
                                >
                                    {loadingSubmit ? (
                                        <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Processando...</>
                                    ) : (
                                        <>Enviar Candidatura <ChevronRight className="ml-1 h-4 w-4" /></>
                                    )}
                                </Button>
                            </form>
                        </CardContent>
                    </Card>
                </div>

            </div>
        </div>
    )
}

function FileTextIcon(props: any) {
    return (
        <svg
            {...props}
            xmlns="http://www.w3.org/2000/svg"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
        >
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" x2="8" y1="13" y2="13" />
            <line x1="16" x2="8" y1="17" y2="17" />
            <line x1="10" x2="8" y1="9" y2="9" />
        </svg>
    )
}
