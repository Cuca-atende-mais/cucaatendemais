"use client"

import { useState } from "react"
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { CheckCircle2, Clock, Loader2, AlertCircle } from "lucide-react"

// S-EMP-GES-03 (AC1, AC2, AC7): formulário do pedido de feedback. A empresa marca os selecionados entre
// os candidatos que a Rede Cuca enviou, ou "Nenhum candidato da lista foi selecionado", ou sinaliza que
// ainda está em análise. Os não marcados viram Rejeitado. Nada é enviado à empresa depois.

export interface DadosPedido {
    vaga: { titulo: string | null; empresa: string | null }
    candidates: { id: string; nome: string }[]
}

export function FormularioPedido({ token, dados }: { token: string; dados: DadosPedido }) {
    const [marcados, setMarcados] = useState<Set<string>>(new Set())
    const [nenhum, setNenhum] = useState(false)
    const [emAnalise, setEmAnalise] = useState(false)
    const [enviando, setEnviando] = useState(false)
    const [erro, setErro] = useState<string | null>(null)
    const [concluido, setConcluido] = useState<null | "resposta" | "em_analise">(null)

    const candidatos = dados.candidates
    const podeEnviar = emAnalise || nenhum || marcados.size > 0

    const alternar = (id: string) => {
        setNenhum(false)
        setMarcados(prev => {
            const novo = new Set(prev)
            if (novo.has(id)) novo.delete(id)
            else novo.add(id)
            return novo
        })
    }

    const alternarNenhum = (valor: boolean) => {
        setNenhum(valor)
        if (valor) setMarcados(new Set())
    }

    const enviar = async () => {
        if (!podeEnviar) return
        setEnviando(true)
        setErro(null)
        try {
            const corpo = emAnalise
                ? { token, isBypass: true }
                : nenhum ? { token, nenhum: true } : { token, selecionados: Array.from(marcados) }
            const res = await fetch("/api/empregabilidade/vagas/feedback-submit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(corpo),
            })
            const data = await res.json().catch(() => ({}))
            if (!res.ok) {
                setErro(data.error || "Não foi possível enviar. Tente novamente.")
                return
            }
            setConcluido(emAnalise ? "em_analise" : "resposta")
        } catch {
            setErro("Não foi possível enviar. Verifique a conexão e tente novamente.")
        } finally {
            setEnviando(false)
        }
    }

    if (concluido) {
        return (
            <div className="flex items-center justify-center min-h-screen p-4 bg-muted/30">
                <Card className="w-full max-w-md text-center border-none shadow-xl">
                    <CardContent className="pt-10 pb-8 flex flex-col items-center">
                        <div className="h-20 w-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
                            <CheckCircle2 className="h-10 w-10 text-green-600" />
                        </div>
                        <h2 className="text-2xl font-bold text-cuca-dark mb-2">
                            {concluido === "em_analise" ? "Recebemos o aviso" : "Retorno enviado!"}
                        </h2>
                        <p className="text-muted-foreground text-sm">
                            {concluido === "em_analise"
                                ? "A Rede Cuca enviará um novo link quando vocês concluírem a análise."
                                : "Obrigado pelo retorno. A Rede Cuca já recebeu o resultado da seleção."}
                        </p>
                    </CardContent>
                </Card>
            </div>
        )
    }

    return (
        <div className="min-h-screen bg-muted/30 p-4 md:p-8 flex flex-col items-center">
            <Card className="w-full max-w-3xl shadow-xl border-none">
                <CardHeader className="bg-primary text-primary-foreground rounded-t-lg">
                    <p className="text-sm opacity-80 uppercase tracking-widest font-semibold">Resultado da seleção</p>
                    <CardTitle className="text-2xl md:text-3xl mt-1 break-words">{dados.vaga.titulo}</CardTitle>
                    {dados.vaga.empresa && <p className="mt-2 text-primary-foreground/90 font-medium">{dados.vaga.empresa}</p>}
                </CardHeader>

                <CardContent className="pt-8 space-y-6">
                    <section className="bg-amber-50 p-4 md:p-5 rounded-xl border border-amber-100">
                        <div className="flex items-center justify-between gap-4">
                            <div className="space-y-1 min-w-0">
                                <Label htmlFor="em-analise" className="text-base font-semibold flex items-center gap-2 text-amber-800">
                                    <Clock className="h-4 w-4" /> Ainda em análise
                                </Label>
                                <p className="text-sm text-amber-700/80">
                                    Marque se vocês ainda não decidiram. Nenhum candidato muda e a Rede Cuca envia um novo link depois.
                                </p>
                            </div>
                            <Switch id="em-analise" checked={emAnalise} onCheckedChange={setEmAnalise} className="data-[state=checked]:bg-amber-600" />
                        </div>
                    </section>

                    {!emAnalise && (
                        <section className="space-y-4">
                            <label
                                htmlFor="nenhum"
                                className={`flex items-center gap-3 rounded-xl border-2 p-4 cursor-pointer ${nenhum ? "border-rose-400 bg-rose-50" : "border-muted"}`}
                            >
                                <Checkbox id="nenhum" checked={nenhum} onCheckedChange={v => alternarNenhum(v === true)} />
                                <span className="font-semibold">Nenhum candidato da lista foi selecionado</span>
                            </label>

                            <div className="flex items-center gap-2">
                                <h3 className="text-lg font-bold">Marque os candidatos selecionados</h3>
                                <Badge variant="outline" className="rounded-full">{candidatos.length}</Badge>
                            </div>

                            {candidatos.length === 0 ? (
                                <div className="text-center py-10 border-2 border-dashed rounded-xl">
                                    <p className="text-muted-foreground">Nenhum candidato aguardando o retorno de vocês.</p>
                                </div>
                            ) : (
                                <ul className="divide-y rounded-xl border">
                                    {candidatos.map(c => (
                                        <li key={c.id}>
                                            <label htmlFor={`c-${c.id}`} className="flex items-center gap-3 p-4 cursor-pointer hover:bg-muted/40">
                                                <Checkbox id={`c-${c.id}`} checked={marcados.has(c.id)} onCheckedChange={() => alternar(c.id)} />
                                                <span className="font-medium break-words min-w-0">{c.nome}</span>
                                            </label>
                                        </li>
                                    ))}
                                </ul>
                            )}

                            <p className="text-sm text-muted-foreground">
                                Os candidatos marcados ficam como selecionados. Os demais desta lista ficam como não selecionados.
                            </p>
                        </section>
                    )}

                    {erro && (
                        <p className="flex items-center gap-2 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900">
                            <AlertCircle className="h-4 w-4 shrink-0" /> {erro}
                        </p>
                    )}
                </CardContent>

                <Separator />

                <CardFooter className="p-6 flex flex-col-reverse gap-4 md:flex-row md:justify-between bg-muted/20">
                    <p className="text-xs text-muted-foreground md:max-w-[280px]">
                        {podeEnviar ? "O link vale uma vez: depois de enviar, não dá para alterar." : "Marque os selecionados ou \"Nenhum\" para enviar."}
                    </p>
                    <Button size="lg" className="w-full md:w-auto px-10 font-bold" onClick={enviar} disabled={!podeEnviar || enviando}>
                        {enviando ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando...</> : "Enviar retorno"}
                    </Button>
                </CardFooter>
            </Card>

            <footer className="mt-8 text-muted-foreground/60 text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" /> CUCA Atende Mais - Sistema de Empregabilidade
            </footer>
        </div>
    )
}
