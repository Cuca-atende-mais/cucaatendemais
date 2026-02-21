"use client"

import { useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Building2, CheckCircle2, Loader2, MapPin, Phone, Briefcase, Search } from "lucide-react"
import toast from "react-hot-toast"
import Image from "next/image"

export default function CadastroEmpresaPage() {
    const [loading, setLoading] = useState(false)
    const [searchingCnpj, setSearchingCnpj] = useState(false)
    const [success, setSuccess] = useState(false)

    // Form states
    const [cnpj, setCnpj] = useState("")
    const [nome, setNome] = useState("")
    const [telefone, setTelefone] = useState("")
    const [email, setEmail] = useState("")
    const [endereco, setEndereco] = useState("")
    const [setor, setSetor] = useState("")
    const [porte, setPorte] = useState("")
    const [contatoResponsavel, setContatoResponsavel] = useState("")

    const supabase = createClient()

    const formatCNPJ = (value: string) => {
        return value
            .replace(/\D/g, '')
            .replace(/^(\d{2})(\d)/, '$1.$2')
            .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
            .replace(/\.(\d{3})(\d)/, '.$1/$2')
            .replace(/(\d{4})(\d)/, '$1-$2')
            .substring(0, 18)
    }

    const formatPhone = (value: string) => {
        return value
            .replace(/\D/g, '')
            .replace(/^(\d{2})(\d)/g, '($1) $2')
            .replace(/(\d)(\d{4})$/, '$1-$2')
            .substring(0, 15)
    }

    const unformatCnpj = (value: string) => value.replace(/\D/g, '')

    const handleCnpjSearch = async () => {
        const cleanCnpj = unformatCnpj(cnpj)
        if (cleanCnpj.length !== 14) {
            toast.error("Por favor, digite um CNPJ válido com 14 números.")
            return
        }

        setSearchingCnpj(true)
        try {
            const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cleanCnpj}`)
            if (!res.ok) throw new Error("CNPJ não encontrado")

            const data = await res.json()

            setNome(data.razao_social || data.nome_fantasia || "")
            setEndereco(`${data.logradouro}, ${data.numero} - ${data.bairro}, ${data.municipio} - ${data.uf}`)
            if (data.ddd_telefone_1) {
                setTelefone(formatPhone(data.ddd_telefone_1))
            }
            if (data.email) {
                setEmail(data.email.toLowerCase())
            }

            toast.success("Dados da empresa carregados!")
        } catch (error) {
            console.error("Erro na busca de CNPJ:", error)
            toast.error("Não foi possível buscar os dados do CNPJ automaticamente.")
        } finally {
            setSearchingCnpj(false)
        }
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()

        if (!nome || !cnpj || !telefone || !email || !contatoResponsavel) {
            toast.error("Por favor, preencha todos os campos obrigatórios.")
            return
        }

        setLoading(true)

        try {
            // Verificar se o CNPJ já existe
            const { data: existente } = await supabase
                .from("empresas")
                .select("id")
                .eq("cnpj", unformatCnpj(cnpj))
                .single()

            if (existente) {
                toast.error("Esta empresa já está cadastrada na nossa base.")
                setLoading(false)
                return
            }

            const { error } = await supabase.from("empresas").insert({
                nome,
                cnpj: unformatCnpj(cnpj),
                telefone,
                email,
                endereco,
                setor,
                porte,
                contato_responsavel: contatoResponsavel,
                ativa: false // Fica aguardando aprovação
            })

            if (error) throw error

            setSuccess(true)
            toast.success("Cadastro realizado com sucesso!")
        } catch (error: any) {
            console.error("Erro ao cadastrar empresa:", error)
            toast.error(error.message || "Erro técnico ao realizar cadastro")
        } finally {
            setLoading(false)
        }
    }

    if (success) {
        return (
            <div className="min-h-screen bg-muted/30 flex items-center justify-center p-4">
                <Card className="max-w-md w-full border-none shadow-lg text-center animate-in fade-in zoom-in duration-500">
                    <CardContent className="pt-10 pb-8 flex flex-col items-center">
                        <div className="h-20 w-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
                            <CheckCircle2 className="h-10 w-10 text-green-600" />
                        </div>
                        <h2 className="text-2xl font-bold tracking-tight text-cuca-dark mb-2">Cadastro Recebido!</h2>
                        <p className="text-muted-foreground mb-6">
                            Obrigado pelo seu interesse. Nossa equipe de Empregabilidade analisará seu cadastro e entrará em contato em breve para ativar sua parceria.
                        </p>
                        <Button className="w-full bg-cuca-blue hover:bg-sky-800 text-white" onClick={() => window.location.href = '/'}>
                            Voltar para a página inicial
                        </Button>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-muted/30 flex flex-col md:flex-row">
            {/* Banner/Sidebar Lateral */}
            <div className="w-full md:w-1/3 bg-cuca-blue text-white p-8 md:p-12 flex flex-col justify-center relative overflow-hidden hidden md:flex">
                <div className="absolute top-0 left-0 w-full h-full opacity-10 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-white via-transparent to-transparent"></div>
                <div className="relative z-10 space-y-8">
                    <Building2 className="h-16 w-16 text-cuca-yellow" />
                    <div className="space-y-4">
                        <h1 className="text-4xl font-bold tracking-tight text-white leading-tight">
                            Encontre os melhores talentos jovens.
                        </h1>
                        <p className="text-blue-100 text-lg">
                            Cadastre sua empresa na Rede CUCA e tenha acesso a um banco de talentos exclusivo, focado na juventude de Fortaleza.
                        </p>
                    </div>

                    <ul className="space-y-4 pt-8">
                        <li className="flex items-start gap-3">
                            <CheckCircle2 className="h-6 w-6 text-cuca-yellow shrink-0" />
                            <span className="text-sm">Triagem inteligente por habilidades</span>
                        </li>
                        <li className="flex items-start gap-3">
                            <CheckCircle2 className="h-6 w-6 text-cuca-yellow shrink-0" />
                            <span className="text-sm">Espaços nos CUCAs para entrevistas gratuitas</span>
                        </li>
                        <li className="flex items-start gap-3">
                            <CheckCircle2 className="h-6 w-6 text-cuca-yellow shrink-0" />
                            <span className="text-sm">Publicação de vagas via painel</span>
                        </li>
                    </ul>
                </div>
            </div>

            {/* Formulário */}
            <div className="w-full md:w-2/3 p-4 md:p-12 lg:p-24 flex items-center justify-center overflow-y-auto min-h-screen">
                <Card className="w-full max-w-2xl border-none shadow-xl">
                    <CardHeader className="space-y-3 pb-8">
                        {/* Mobile Header elements */}
                        <div className="md:hidden flex flex-col items-center text-center space-y-4 pb-4">
                            <Building2 className="h-12 w-12 text-cuca-blue" />
                            <div>
                                <h1 className="text-2xl font-bold tracking-tight text-cuca-dark">Parceria Empresa</h1>
                                <p className="text-sm text-muted-foreground mt-1">Conecte-se com talentos da Rede CUCA.</p>
                            </div>
                        </div>

                        <CardTitle className="text-2xl hidden md:block text-cuca-dark">Cadastro Corporativo</CardTitle>
                        <CardDescription className="hidden md:block">
                            Preencha os dados da sua organização para criar um perfil de empregador.
                        </CardDescription>
                    </CardHeader>

                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-6">

                            {/* Buscar CNPJ */}
                            <div className="grid gap-2 p-4 bg-muted/40 border border-muted-foreground/10 rounded-xl">
                                <Label htmlFor="cnpj" className="font-semibold flex items-center gap-2">
                                    <Search className="h-4 w-4" /> Buscar CNPJ
                                </Label>
                                <p className="text-xs text-muted-foreground mb-2">Digite o CNPJ para preencher os dados automaticamente.</p>
                                <div className="flex gap-2">
                                    <Input
                                        id="cnpj"
                                        placeholder="00.000.000/0000-00"
                                        value={cnpj}
                                        onChange={(e) => setCnpj(formatCNPJ(e.target.value))}
                                        className="bg-white form-input"
                                        maxLength={18}
                                        required
                                    />
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        onClick={handleCnpjSearch}
                                        disabled={searchingCnpj || unformatCnpj(cnpj).length !== 14}
                                    >
                                        {searchingCnpj ? <Loader2 className="h-4 w-4 animate-spin" /> : "Buscar"}
                                    </Button>
                                </div>
                            </div>

                            <div className="grid gap-6 sm:grid-cols-2 mt-4">
                                <div className="space-y-2 sm:col-span-2">
                                    <Label htmlFor="nome">Razão Social / Nome Fantasia *</Label>
                                    <Input
                                        id="nome"
                                        value={nome}
                                        onChange={(e) => setNome(e.target.value)}
                                        placeholder="Nome da sua empresa"
                                        required
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="telefone">Telefone (Fixo ou WhatsApp) *</Label>
                                    <Input
                                        id="telefone"
                                        value={telefone}
                                        onChange={(e) => setTelefone(formatPhone(e.target.value))}
                                        placeholder="(00) 00000-0000"
                                        maxLength={15}
                                        required
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="email">E-mail Comercial *</Label>
                                    <Input
                                        id="email"
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        placeholder="contato@empresa.com.br"
                                        required
                                    />
                                </div>

                                <div className="space-y-2 sm:col-span-2">
                                    <Label htmlFor="endereco" className="flex items-center gap-2">
                                        <MapPin className="h-3 w-3" /> Endereço Completo
                                    </Label>
                                    <Input
                                        id="endereco"
                                        value={endereco}
                                        onChange={(e) => setEndereco(e.target.value)}
                                        placeholder="Rua, Número, Bairro, Cidade"
                                    />
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="setor">Setor de Atuação</Label>
                                    <Select value={setor} onValueChange={setSetor}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Selecione o setor" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="tecnologia">Tecnologia (TI)</SelectItem>
                                            <SelectItem value="comercio">Comércio / Varejo</SelectItem>
                                            <SelectItem value="servicos">Serviços</SelectItem>
                                            <SelectItem value="industria">Indústria</SelectItem>
                                            <SelectItem value="alimentacao">Alimentação / Gastronomia</SelectItem>
                                            <SelectItem value="educacao">Educação</SelectItem>
                                            <SelectItem value="saude">Saúde</SelectItem>
                                            <SelectItem value="outros">Outros</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2">
                                    <Label htmlFor="porte">Porte da Empresa</Label>
                                    <Select value={porte} onValueChange={setPorte}>
                                        <SelectTrigger>
                                            <SelectValue placeholder="Selecione o porte" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="micro">MEI / Microempresa (Até 9 trab.)</SelectItem>
                                            <SelectItem value="pequena">Pequena (10 a 49 trab.)</SelectItem>
                                            <SelectItem value="media">Média (50 a 99 trab.)</SelectItem>
                                            <SelectItem value="grande">Grande (+100 trab.)</SelectItem>
                                        </SelectContent>
                                    </Select>
                                </div>

                                <div className="space-y-2 sm:col-span-2">
                                    <Label htmlFor="contatoResponsavel" className="flex items-center gap-2">
                                        <Briefcase className="h-3 w-3" /> Responsável por Recrutamento *
                                    </Label>
                                    <Input
                                        id="contatoResponsavel"
                                        value={contatoResponsavel}
                                        onChange={(e) => setContatoResponsavel(e.target.value)}
                                        placeholder="Nome completo do responsável (ex: Diretora de RH)"
                                        required
                                    />
                                </div>
                            </div>

                            <Button
                                type="submit"
                                className="w-full h-12 mt-8 bg-cuca-blue hover:bg-sky-800 text-white font-bold text-lg"
                                disabled={loading}
                            >
                                {loading ? (
                                    <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Processando...</>
                                ) : (
                                    "Solicitar Cadastro"
                                )}
                            </Button>

                            <p className="text-center text-xs text-muted-foreground mt-4">
                                Ao se cadastrar, você concorda que o núcleo de Empregabilidade da Rede CUCA
                                armazene os dados corporativos para fins de parceria e contato.
                            </p>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
