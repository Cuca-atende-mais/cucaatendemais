"use client"

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { AlertCircle, CheckCircle2, Loader2, Lock } from 'lucide-react'
import Image from 'next/image'

export default function SetupSenhaPage() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const token = searchParams.get('token')

    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [isSuccess, setIsSuccess] = useState(false)

    useEffect(() => {
        if (!token) {
            setError("Link de acesso inválido. Certifique-se de copiar o link completo do seu e-mail.")
        }
    }, [token])

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError(null)

        if (!password || password.length < 6) {
            setError('A senha deve ter no mínimo 6 caracteres.')
            return
        }

        if (password !== confirmPassword) {
            setError('As senhas não coincidem.')
            return
        }

        setIsLoading(true)

        try {
            const res = await fetch('/api/colaboradores/setup-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, password }),
            })

            const data = await res.json()

            if (!res.ok) {
                throw new Error(data.error || 'Falha ao configurar a senha.')
            }

            setIsSuccess(true)
            setTimeout(() => {
                router.push('/login')
            }, 3000)

        } catch (err: any) {
            setError(err.message)
        } finally {
            setIsLoading(false)
        }
    }

    if (!token) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
                <Card className="w-full max-w-md">
                    <CardHeader className="text-center">
                        <CardTitle className="text-red-600 flex items-center justify-center gap-2">
                            <AlertCircle className="h-5 w-5" /> Token Ausente
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="text-center text-slate-600">
                        {error}
                        <div className="mt-6">
                            <Button variant="outline" onClick={() => router.push('/login')}>
                                Voltar para o Login
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4">

            <div className="mb-8">
                <Image
                    src="/images/logo_color.png"
                    alt="Cuca Logo"
                    width={180}
                    height={70}
                    className="object-contain drop-shadow-sm"
                />
            </div>

            <Card className="w-full max-w-md border-0 shadow-lg">
                <CardHeader className="text-center pb-4">
                    <CardTitle className="text-2xl font-bold text-slate-800">Crie sua Senha</CardTitle>
                    <CardDescription className="text-slate-500 mt-2">
                        Configure uma senha pessoal e intransferível para acessar o Cuca Portal.
                    </CardDescription>
                </CardHeader>

                <CardContent>
                    {isSuccess ? (
                        <div className="flex flex-col items-center justify-center py-6 text-center space-y-4 animate-in fade-in zoom-in duration-500">
                            <div className="h-16 w-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
                                <CheckCircle2 className="h-8 w-8" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-800">Senha Registrada!</h3>
                                <p className="text-slate-500 text-sm mt-1">
                                    Sua conta está pronta para uso. Redirecionando para o painel de acesso...
                                </p>
                            </div>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} className="space-y-4">
                            {error && (
                                <div className="bg-red-50 text-red-600 p-3 rounded-lg text-sm flex gap-2 items-start">
                                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                                    <span>{error}</span>
                                </div>
                            )}

                            <div className="space-y-2">
                                <Label htmlFor="password">Nova Senha</Label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                    <Input
                                        id="password"
                                        type="password"
                                        placeholder="Mínimo 6 caracteres"
                                        className="pl-9"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        disabled={isLoading}
                                        required
                                    />
                                </div>
                            </div>

                            <div className="space-y-2">
                                <Label htmlFor="confirmPassword">Confirmar nova senha</Label>
                                <div className="relative">
                                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                                    <Input
                                        id="confirmPassword"
                                        type="password"
                                        placeholder="Digite a senha novamente"
                                        className="pl-9"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        disabled={isLoading}
                                        required
                                    />
                                </div>
                            </div>

                            <Button
                                type="submit"
                                className="w-full bg-cuca-blue hover:bg-cuca-blue/90"
                                disabled={isLoading}
                            >
                                {isLoading ? (
                                    <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando...</>
                                ) : (
                                    "Salvar Senha e Acessar"
                                )}
                            </Button>
                        </form>
                    )}
                </CardContent>

                {!isSuccess && (
                    <CardFooter className="flex justify-center border-t py-4 bg-slate-50/50">
                        <p className="text-xs text-slate-500">
                            Ambiente Restrito • Prefeitura de Fortaleza
                        </p>
                    </CardFooter>
                )}
            </Card>
        </div>
    )
}
