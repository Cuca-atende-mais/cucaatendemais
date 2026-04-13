"use client"

/**
 * TASK 2.5: UI/UX - Formulário Dinâmico de Feedback Público
 * Link: /feedback-empresa/[token]
 */
import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { toast } from "sonner"
import { CheckCircle2, Clock, MapPin, XCircle, AlertCircle, Loader2 } from "lucide-react"

type Candidato = {
  id: string
  nome: string
  status: string
  evaluation?: 'pendente' | 'aprovado_empresa' | 'rejeitado'
  data_entrevista?: string
  hora_entrevista?: string
  local_entrevista?: string
}

export default function VagaFeedbackPage() {
  const { token } = useParams()

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [vaga, setVaga] = useState<any>(null)
  const [candidates, setCandidates] = useState<Candidato[]>([])
  const [isBypass, setIsBypass] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [globalData, setGlobalData] = useState("")
  const [globalHora, setGlobalHora] = useState("")
  const [globalLocal, setGlobalLocal] = useState("")
  const [cucaUnitId, setCucaUnitId] = useState<string | null>(null)

  useEffect(() => {
    fetchData()
  }, [])

  async function fetchData() {
    try {
      const res = await fetch(`/api/empregabilidade/vagas/feedback-token/${token}`)
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || "Link inválido ou expirado.")
        return
      }

      setVaga(data.vaga)
      setCucaUnitId(data.cuca_unit_id)
      setCandidates((data.candidates || []).map((c: any) => ({ ...c, evaluation: 'pendente' })))
    } catch (err: any) {
      setError("Erro ao carregar dados.")
      console.error(err)
    } finally {
      setLoading(false)
    }
  }

  const updateEvaluation = (id: string, evaluation: any) => {
    setCandidates(prev => prev.map(c => c.id === id ? { ...c, evaluation } : c))
  }

  const updateCandidateField = (id: string, field: string, value: string) => {
    setCandidates(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c))
  }

  const handleSubmit = async () => {
    setSubmitting(true)
    try {
      // Validação: Se não for bypass, validar campos globais
      if (!isBypass) {
        const hasApproved = candidates.some(c => c.evaluation === 'aprovado_empresa')
        if (hasApproved && (!globalData || !globalHora || !globalLocal)) {
          toast.error("Por favor, preencha Data, Hora e Local da entrevista.")
          setSubmitting(false)
          return
        }
      }

      // Enviar submissão para API (Backend Portal para invalidar token e atualizar DB em lote)
      const response = await fetch('/api/empregabilidade/vagas/feedback-submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          isBypass,
          evaluations: candidates.map(c => ({
            id: c.id,
            status: c.evaluation,
            data_entrevista: c.evaluation === 'aprovado_empresa' ? globalData : undefined,
            hora_entrevista: c.evaluation === 'aprovado_empresa' ? globalHora : undefined,
            local_entrevista: c.evaluation === 'aprovado_empresa' ? globalLocal : undefined
          }))
        })
      })

      if (!response.ok) {
        throw new Error("Falha ao salvar feedback.")
      }

      toast.success("Feedback enviado com sucesso! Obrigado.")
      setSubmitted(true)
    } catch (err: any) {
      toast.error(err.message || "Erro ao enviar formulário.")
    } finally {
      setSubmitting(false)
    }
  }

  if (submitted) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4 bg-muted/30">
        <Card className="w-full max-w-md text-center border-none shadow-xl">
          <CardContent className="pt-10 pb-8 flex flex-col items-center">
            <div className="h-20 w-20 bg-green-100 rounded-full flex items-center justify-center mb-6">
              <CheckCircle2 className="h-10 w-10 text-green-600" />
            </div>
            <h2 className="text-2xl font-bold text-cuca-dark mb-2">Feedback Enviado!</h2>
            <p className="text-muted-foreground text-sm">
              Obrigado pelo retorno. O CUCA já foi notificado e os candidatos serão informados em breve.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (loading) {
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

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <Card className="w-full max-w-md border-destructive">
          <CardHeader>
            <CardTitle className="text-destructive flex items-center gap-2">
              <AlertCircle className="h-6 w-6" /> Ops!
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground">{error}</p>
          </CardContent>
          <CardFooter>
            <Button variant="outline" className="w-full" onClick={() => window.location.reload()}>Tentar Novamente</Button>
          </CardFooter>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-muted/30 p-4 md:p-8 flex flex-col items-center">
      <Card className="w-full max-w-4xl shadow-xl border-none">
        <CardHeader className="bg-primary text-primary-foreground rounded-t-lg">
          <div className="flex justify-between items-start gap-4">
            <div>
              <p className="text-sm opacity-80 uppercase tracking-widest font-semibold">Feedback de Seleção</p>
              <CardTitle className="text-2xl md:text-3xl mt-1">{vaga?.titulo}</CardTitle>
              <p className="mt-2 text-primary-foreground/90 font-medium">{vaga?.empresas?.nome}</p>
              {cucaUnitId && (
                <p className="mt-1 text-primary-foreground/70 text-sm font-medium">
                  Avaliando candidatos da unidade: <strong>CUCA {cucaUnitId}</strong>
                </p>
              )}
            </div>
            <Badge variant="secondary" className="bg-white/20 text-white hover:bg-white/30 border-none">
              Token Ativo
            </Badge>
          </div>
        </CardHeader>

        <CardContent className="pt-8 space-y-8">
          {/* Sessão de Bypass */}
          <section className="bg-amber-50 dark:bg-amber-950/20 p-6 rounded-xl border border-amber-100 dark:border-amber-900/30">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="bypass" className="text-lg font-semibold flex items-center gap-2 text-amber-800 dark:text-amber-200">
                  Vaga ainda em análise
                </Label>
                <p className="text-sm text-amber-700/70 dark:text-amber-300/60">
                  Marque esta opção se você ainda não avaliou todos os candidatos desta remessa. 
                  O sistema permitirá uma nova avaliação no futuro.
                </p>
              </div>
              <Switch 
                id="bypass" 
                checked={isBypass} 
                onCheckedChange={setIsBypass} 
                className="data-[state=checked]:bg-amber-600"
              />
            </div>
          </section>

          {!isBypass ? (
            <section className="space-y-6">
              {/* Seção global de data/hora/local — preenchida uma vez para todos os aprovados */}
              <div className="p-6 bg-green-50 dark:bg-green-950/20 rounded-xl border border-green-100 dark:border-green-900/30 space-y-4">
                <h4 className="font-semibold text-green-800 dark:text-green-200 flex items-center gap-2">
                  <Clock className="h-4 w-4" /> Detalhes da Entrevista (válidos para todos os aprovados)
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs text-green-700">Data</Label>
                    <Input type="date" className="bg-white border-green-200 focus-visible:ring-green-500" value={globalData} onChange={(e) => setGlobalData(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-green-700">Hora</Label>
                    <Input type="time" className="bg-white border-green-200 focus-visible:ring-green-500" value={globalHora} onChange={(e) => setGlobalHora(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-green-700">Local / Link</Label>
                    <Input placeholder="Endereço ou link da reunião" className="bg-white border-green-200 focus-visible:ring-green-500" value={globalLocal} onChange={(e) => setGlobalLocal(e.target.value)} />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-4">
                <h3 className="text-xl font-bold">Candidatos Encaminhados</h3>
                <Badge variant="outline" className="rounded-full">{candidates.length}</Badge>
              </div>

              {candidates.length === 0 ? (
                <div className="text-center py-12 border-2 border-dashed rounded-xl">
                  <p className="text-muted-foreground">Nenhum candidato pendente de avaliação.</p>
                </div>
              ) : (
                <div className="grid gap-6">
                  {candidates.map((cand) => (
                    <Card key={cand.id} className="overflow-hidden border-muted/60 hover:border-primary/30 transition-all shadow-sm">
                      <div className="p-5">
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div className="flex items-center gap-3">
                            <div className="bg-primary/10 p-2 rounded-full">
                              <CheckCircle2 className="h-5 w-5 text-primary" />
                            </div>
                            <span className="text-lg font-semibold">{cand.nome}</span>
                          </div>

                          <div className="flex gap-2">
                            <Button
                              variant={cand.evaluation === 'aprovado_empresa' ? "default" : "outline"}
                              className={cand.evaluation === 'aprovado_empresa' ? "bg-green-600 hover:bg-green-700" : "hover:text-green-600 hover:border-green-600"}
                              onClick={() => updateEvaluation(cand.id, 'aprovado_empresa')}
                            >
                              Aprovar
                            </Button>
                            <Button
                              variant={cand.evaluation === 'rejeitado' ? "destructive" : "outline"}
                              onClick={() => updateEvaluation(cand.id, 'rejeitado')}
                            >
                              Reprovar
                            </Button>
                            <Button
                                variant={cand.evaluation === 'pendente' ? "secondary" : "outline"}
                                onClick={() => updateEvaluation(cand.id, 'pendente')}
                                className="opacity-50"
                            >
                                Manter Pendente
                            </Button>
                          </div>
                        </div>

                        {cand.evaluation === 'rejeitado' && (
                          <div className="mt-4 p-4 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-100 dark:border-red-900/30">
                            <p className="text-xs text-red-700 dark:text-red-300">Status atualizado para: *Reprovado pela Empresa*.</p>
                          </div>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <div className="py-10 text-center space-y-4">
               <div className="inline-flex p-4 bg-amber-100 dark:bg-amber-900/30 rounded-full mb-2">
                 <Loader2 className="h-10 w-10 text-amber-600 animate-spin" />
               </div>
               <h3 className="text-xl font-bold text-amber-800 dark:text-amber-200">Bypass Ativado</h3>
               <p className="text-muted-foreground max-w-md mx-auto">
                 Ao submeter agora, você sinaliza que a vaga ainda está em análise interna.
                 Nenhum candidato terá o status alterado no momento.
               </p>
            </div>
          )}
        </CardContent>

        <Separator />

        <CardFooter className="p-8 flex justify-between bg-muted/20">
          <p className="text-xs text-muted-foreground max-w-[250px]">
            Ao clicar em enviar, os dados serão processados instantaneamente. Verifique as informações.
          </p>
          <Button 
            size="lg" 
            className="px-12 font-bold text-lg"
            onClick={handleSubmit} 
            disabled={submitting}
          >
            {submitting ? (
              <> <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando...</>
            ) : (
              "Finalizar e Enviar Feedback"
            )}
          </Button>
        </CardFooter>
      </Card>

      <footer className="mt-8 text-muted-foreground/60 text-sm flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4" /> CUCA Atende Mais - Sistema de Empregabilidade
      </footer>
    </div>
  )
}
