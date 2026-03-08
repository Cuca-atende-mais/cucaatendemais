"use client"

import { useState, useRef } from "react"
import { createClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { CheckCircle2, Loader2, UploadCloud, User, Phone, Calendar, MapPin } from "lucide-react"
import toast from "react-hot-toast"

const UNIDADES = [
    "Cuca Barra",
    "Cuca Pici",
    "Cuca Jangurussu",
    "Cuca Mondubim",
    "Cuca José Walter",
]

export default function CandidaturaEspontaneaPage() {
    const fileRef = useRef<HTMLInputElement>(null)

    const [nome, setNome] = useState("")
    const [telefone, setTelefone] = useState("")
    const [dataNascimento, setDataNascimento] = useState("")
    const [email, setEmail] = useState("")
    const [unidade, setUnidade] = useState("")
    const [arquivo, setArquivo] = useState<File | null>(null)

    const [loading, setLoading] = useState(false)
    const [sucesso, setSucesso] = useState(false)

    const supabase = createClient()

    const formatarTelefone = (v: string) => {
        const nums = v.replace(/\D/g, "").slice(0, 11)
        if (nums.length <= 2) return nums
        if (nums.length <= 6) return `(${nums.slice(0, 2)}) ${nums.slice(2)}`
        if (nums.length <= 10) return `(${nums.slice(0, 2)}) ${nums.slice(2, 6)}-${nums.slice(6)}`
        return `(${nums.slice(0, 2)}) ${nums.slice(2, 7)}-${nums.slice(7)}`
    }

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        if (!nome.trim()) { toast.error("Informe seu nome completo."); return }
        if (!telefone.trim()) { toast.error("Informe seu telefone."); return }
        if (!dataNascimento) { toast.error("Informe sua data de nascimento."); return }
        if (!unidade) { toast.error("Selecione a unidade CUCA de preferência."); return }

        setLoading(true)
        try {
            let cvUrl: string | null = null

            // 1. Upload do CV se fornecido
            if (arquivo) {
                const ext = arquivo.name.split(".").pop()
                const path = `espontanea/${Date.now()}_${nome.replace(/\s+/g, "_").toLowerCase()}.${ext}`
                const { error: upErr } = await supabase.storage
                    .from("curriculos")
                    .upload(path, arquivo, { contentType: arquivo.type, upsert: false })

                if (upErr) throw new Error("Erro no upload do currículo: " + upErr.message)
                const { data: urlData } = supabase.storage.from("curriculos").getPublicUrl(path)
                cvUrl = urlData?.publicUrl ?? null
            }

            // 2. Inserir diretamente no talent_bank
            const { error: insErr } = await supabase.from("talent_bank").insert({
                nome: nome.trim(),
                telefone: telefone.replace(/\D/g, ""),
                data_nascimento: dataNascimento || null,
                arquivo_cv_url: cvUrl,
                status: "disponivel",
                skills_jsonb: {
                    email: email.trim() || null,
                    unidade_preferencia: unidade,
                    origem: "candidatura_espontanea",
                },
            })

            if (insErr) throw new Error(insErr.message)

            // 3. Disparar OCR em background se CV foi enviado
            if (cvUrl) {
                fetch("/api/talent-bank/processar-cv-espontaneo", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ nome: nome.trim(), telefone: telefone.replace(/\D/g, ""), cv_url: cvUrl }),
                }).catch(() => null) // fire-and-forget
            }

            setSucesso(true)
        } catch (err: any) {
            toast.error(err.message || "Erro ao enviar cadastro. Tente novamente.")
        } finally {
            setLoading(false)
        }
    }

    if (sucesso) {
        return (
            <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-white to-blue-50 flex items-center justify-center p-4">
                <div className="max-w-md w-full text-center space-y-6">
                    <div className="flex justify-center">
                        <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
                            <CheckCircle2 className="h-10 w-10 text-green-600" />
                        </div>
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900">Cadastro Realizado!</h1>
                        <p className="text-gray-500 mt-2">
                            Seu perfil foi adicionado ao Banco de Talentos da Rede CUCA.
                            Quando surgir uma vaga compatível com seu perfil, entraremos em contato pelo WhatsApp.
                        </p>
                    </div>
                    <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-800">
                        <strong>Dica:</strong> Fique atento ao seu WhatsApp! Nosso sistema de empregabilidade vai te notificar sobre oportunidades que combinam com você.
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-white to-blue-50 py-8 px-4">
            <div className="max-w-lg mx-auto space-y-6">
                {/* Header CUCA */}
                <div className="text-center space-y-2">
                    <div className="inline-flex items-center gap-2 bg-yellow-400 text-yellow-900 font-bold px-4 py-1.5 rounded-full text-sm">
                        Rede CUCA — Empregabilidade
                    </div>
                    <h1 className="text-3xl font-bold text-gray-900">Banco de Talentos</h1>
                    <p className="text-gray-500">
                        Cadastre seu currículo e seja notificado quando surgir uma vaga para o seu perfil.
                    </p>
                </div>

                <Card className="shadow-sm border-gray-100">
                    <CardHeader>
                        <CardTitle className="text-lg">Seus Dados</CardTitle>
                        <CardDescription>Preencha as informações abaixo. O cadastro é gratuito.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {/* Nome */}
                            <div className="space-y-1.5">
                                <Label htmlFor="nome" className="flex items-center gap-1.5">
                                    <User className="h-3.5 w-3.5" /> Nome Completo *
                                </Label>
                                <Input
                                    id="nome"
                                    placeholder="Seu nome completo"
                                    value={nome}
                                    onChange={e => setNome(e.target.value)}
                                    required
                                />
                            </div>

                            {/* Telefone */}
                            <div className="space-y-1.5">
                                <Label htmlFor="telefone" className="flex items-center gap-1.5">
                                    <Phone className="h-3.5 w-3.5" /> WhatsApp *
                                </Label>
                                <Input
                                    id="telefone"
                                    placeholder="(85) 99999-9999"
                                    value={telefone}
                                    onChange={e => setTelefone(formatarTelefone(e.target.value))}
                                    required
                                />
                            </div>

                            {/* Data nascimento */}
                            <div className="space-y-1.5">
                                <Label htmlFor="nascimento" className="flex items-center gap-1.5">
                                    <Calendar className="h-3.5 w-3.5" /> Data de Nascimento *
                                </Label>
                                <Input
                                    id="nascimento"
                                    type="date"
                                    value={dataNascimento}
                                    onChange={e => setDataNascimento(e.target.value)}
                                    max={new Date().toISOString().split("T")[0]}
                                    required
                                />
                            </div>

                            {/* Email */}
                            <div className="space-y-1.5">
                                <Label htmlFor="email">E-mail (opcional)</Label>
                                <Input
                                    id="email"
                                    type="email"
                                    placeholder="seu@email.com"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                />
                            </div>

                            {/* Unidade */}
                            <div className="space-y-1.5">
                                <Label className="flex items-center gap-1.5">
                                    <MapPin className="h-3.5 w-3.5" /> Unidade CUCA de Preferência *
                                </Label>
                                <Select value={unidade} onValueChange={setUnidade}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Selecione a unidade mais próxima..." />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {UNIDADES.map(u => (
                                            <SelectItem key={u} value={u}>{u}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* Upload CV */}
                            <div className="space-y-1.5">
                                <Label>Currículo (PDF — opcional, mas recomendado)</Label>
                                <div
                                    className="border-2 border-dashed border-gray-200 rounded-lg p-5 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-colors"
                                    onClick={() => fileRef.current?.click()}
                                >
                                    {arquivo ? (
                                        <div className="flex flex-col items-center gap-1">
                                            <CheckCircle2 className="h-6 w-6 text-green-500" />
                                            <p className="text-sm font-medium text-gray-700">{arquivo.name}</p>
                                            <p className="text-xs text-gray-400">{(arquivo.size / 1024).toFixed(0)} KB</p>
                                            <button
                                                type="button"
                                                className="text-xs text-red-500 hover:underline mt-1"
                                                onClick={e => { e.stopPropagation(); setArquivo(null) }}
                                            >
                                                Remover
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center gap-1.5">
                                            <UploadCloud className="h-7 w-7 text-gray-300" />
                                            <p className="text-sm text-gray-500">Clique para anexar seu currículo em PDF</p>
                                            <p className="text-xs text-gray-400">Nossa IA extrai suas habilidades automaticamente</p>
                                        </div>
                                    )}
                                </div>
                                <input
                                    ref={fileRef}
                                    type="file"
                                    accept=".pdf,application/pdf"
                                    className="hidden"
                                    onChange={e => setArquivo(e.target.files?.[0] ?? null)}
                                />
                            </div>

                            <Button
                                type="submit"
                                className="w-full bg-yellow-400 hover:bg-yellow-500 text-yellow-900 font-bold h-11 text-base"
                                disabled={loading}
                            >
                                {loading
                                    ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando...</>
                                    : "Entrar no Banco de Talentos"}
                            </Button>

                            <p className="text-center text-xs text-gray-400">
                                Seus dados são usados exclusivamente para oportunidades de emprego na Rede CUCA.
                            </p>
                        </form>
                    </CardContent>
                </Card>
            </div>
        </div>
    )
}
