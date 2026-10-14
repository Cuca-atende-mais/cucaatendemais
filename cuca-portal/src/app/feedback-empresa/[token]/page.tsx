"use client"

/**
 * Página pública do pedido de feedback: /feedback-empresa/[token]
 * S-EMP-GES-03: o token é de um pedido (feedback_solicitacoes) e a página mostra só os candidatos dele.
 * Os links antigos (um por vaga, vagas_feedback_tokens) foram apagados em 14/10 e não são mais aceitos.
 */
import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { AlertCircle } from "lucide-react"
import { FormularioPedido, type DadosPedido } from "./formulario-pedido"

export default function VagaFeedbackPage() {
  const { token } = useParams()
  const [pedido, setPedido] = useState<DadosPedido | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    fetch(`/api/empregabilidade/vagas/feedback-token/${token}`)
      .then(async res => {
        const data = await res.json().catch(() => ({}))
        if (cancelado) return
        if (!res.ok) setErro(data.error || "Link inválido ou expirado.")
        else setPedido({ vaga: data.vaga, candidates: data.candidates || [] })
      })
      .catch(() => { if (!cancelado) setErro("Erro ao carregar dados.") })
    return () => { cancelado = true }
  }, [token])

  if (pedido) return <FormularioPedido token={String(token)} dados={pedido} />

  if (erro) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <Card className="w-full max-w-md border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-6 w-6" /> Ops!
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{erro}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <Skeleton className="h-8 w-3/4 mb-2" />
          <Skeleton className="h-4 w-1/2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    </div>
  )
}
