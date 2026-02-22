"use client"

import { useState, useEffect } from "react"
import { useParams, useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Vaga, Candidatura } from "@/lib/types/database"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ArrowLeft, FileText, CheckCircle2, UserCheck, UserX, AlertCircle, Loader2, FileTerminal, Edit3, Eye, MoreHorizontal } from "lucide-react"
import toast from "react-hot-toast"
import { differenceInYears } from "date-fns"

export default function VagaDetalhesPage() {
    const params = useParams()
    const router = useRouter()
    const id = params.id as string

    const [vaga, setVaga] = useState<Vaga | null>(null)
    const [candidatos, setCandidatos] = useState<Candidatura[]>([])
    const [loading, setLoading] = useState(true)

    const supabase = createClient()

    useEffect(() => {
        if (id) {
            fetchData()
        }
    }, [id])

    const fetchData = async () => {
        setLoading(true)
        try {
            // Vaga
            const { data: vData, error: vError } = await supabase.from('vagas').select('*').eq('id', id).single()
            if (vError) throw vError
            setVaga(vData)

            // Candidaturas
            const { data: cData, error: cError } = await supabase
                .from('candidaturas')
                .select('*')
                .eq('vaga_id', id)
                .order('created_at', { ascending: false })

            if (cError) throw cError
            setCandidatos(cData || [])
        } catch (error) {
            console.error("Erro ao buscar dados:", error)
        } finally {
            setLoading(false)
        }
    }

    const calcularIdade = (dataStr: string) => {
        if (!dataStr) return "-"
        return differenceInYears(new Date(), new Date(dataStr)) + " anos"
    }

    const handleUpdateStatus = async (candidaturaId: string, novoStatus: string, jsonSkills: any) => {
        try {
            // 1. Atualizar candidaturas
            const { error } = await supabase.from("candidaturas").update({ status: novoStatus }).eq("id", candidaturaId)
            if (error) throw error

            // 2. Se for rejeitado (S9-13), vai pro banco de talentos (MVP simplificado)
            if (novoStatus === 'rejeitado') {
                toast.success("Candidato movido para o Banco de Talentos.")
            }

            // 3. Se for contratado (S9-14), verifica vagas restantes
            if (novoStatus === 'contratado' && vaga) {
                const contratadosHoje = candidatos.filter(c => c.status === 'contratado').length + 1
                if (contratadosHoje >= vaga.total_vagas) {
                    await supabase.from("vagas").update({ status: 'preenchida' }).eq("id", vaga.id)
                    toast.success("Todas as vagas foram preenchidas! Vaga encerrada.", { duration: 5000 })
                    setVaga({ ...vaga, status: 'preenchida' })
                }
            }

            toast.success("Status atualizado.")
            fetchData()
        } catch (error: any) {
            toast.error(error.message || "Falha ao mudar status.")
        }
    }

    const refreshOcr = async (candidaturaId: string, cvUrl: string) => {
        toast.loading("Re-processando OCR... aguarde uns segundos.", { id: 'ocr' })
        try {
            const res = await fetch('/api/process-cv', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    candidatura_id: candidaturaId,
                    vaga_id: vaga?.id,
                    cv_url: cvUrl
                })
            })
            if (!res.ok) throw new Error("Erro na API")
            toast.success("OCR reiniciado.", { id: 'ocr' })
            setTimeout(fetchData, 8000) // update after 8 seconds
        } catch (error) {
            toast.error("Falha ao chamar motor", { id: 'ocr' })
        }
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-4">
                <Button variant="outline" size="icon" onClick={() => router.push('/empregabilidade/vagas')}>
                    <ArrowLeft className="h-4 w-4" />
                </Button>
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-cuca-dark">{vaga?.titulo || "Detalhes da Vaga"}</h1>
                    <p className="text-muted-foreground flex items-center gap-2">
                        {vaga?.status === 'aberta' ? <Badge className="bg-green-600">Aberta</Badge> : <Badge variant="secondary">{vaga?.status}</Badge>}
                        <span>Total de vagas: {vaga?.total_vagas}</span>
                    </p>
                </div>
            </div>

            <Card className="border-none shadow-sm mt-6">
                <CardHeader className="bg-muted/20 border-b flex flex-row items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2">
                            <FileText className="h-5 w-5 text-cuca-blue" />
                            Candidatos / Pipeline
                            <Badge variant="outline" className="ml-2 bg-white">{candidatos.length}</Badge>
                        </CardTitle>
                        <CardDescription>Gerencie o pipeline de seleção desta oportunidade</CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="p-0">
                    <Table>
                        <TableHeader className="bg-muted/30">
                            <TableRow>
                                <TableHead>Candidato (Idade)</TableHead>
                                <TableHead>Contato</TableHead>
                                <TableHead>OCR: Escolaridade / Experiência</TableHead>
                                <TableHead>Aderência (IA)</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead className="text-right">Ações</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow><TableCell colSpan={6} className="text-center py-10"><Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
                            ) : candidatos.length === 0 ? (
                                <TableRow><TableCell colSpan={6} className="text-center py-10 text-muted-foreground">Nenhum currículo recebido até o momento.</TableCell></TableRow>
                            ) : candidatos.map(c => {
                                const ocr = c.dados_ocr_json || {}
                                return (
                                    <TableRow key={c.id}>
                                        <TableCell>
                                            <div className="font-semibold">{c.nome}</div>
                                            <div className="text-xs text-muted-foreground">{calcularIdade(c.data_nascimento)}</div>
                                        </TableCell>
                                        <TableCell className="text-sm">{c.telefone}</TableCell>
                                        <TableCell>
                                            <div className="text-xs max-w-[200px]">
                                                <p><span className="font-semibold">Esc:</span> {ocr?.escolaridade || "Analisando..."}</p>
                                                <p className="truncate"><span className="font-semibold">Exp:</span> {ocr?.experiencia_meses ? `${ocr.experiencia_meses} meses` : "Em processo"}</p>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="text-2xl" title="Match com Requisitos">
                                                {c.requisitos_atendidos || "⏳"}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={c.status === 'pendente' ? 'outline' : c.status === 'selecionado' ? 'default' : c.status === 'contratado' ? 'secondary' : 'destructive'}>
                                                {c.status.toUpperCase()}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                {c.arquivo_cv_url && (
                                                    <Button variant="ghost" size="icon" title="Ver Currículo PDF/Imagem" onClick={() => window.open(c.arquivo_cv_url!, '_blank')}>
                                                        <Eye className="h-4 w-4 text-cuca-blue" />
                                                    </Button>
                                                )}
                                                <DropdownMenu>
                                                    <DropdownMenuTrigger asChild>
                                                        <Button variant="ghost" size="icon"><MoreHorizontal className="h-4 w-4" /></Button>
                                                    </DropdownMenuTrigger>
                                                    <DropdownMenuContent align="end">
                                                        <DropdownMenuItem onClick={() => handleUpdateStatus(c.id, 'selecionado', ocr)}>
                                                            <UserCheck className="mr-2 h-4 w-4 text-green-600" /> Marcar Selecionado
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => handleUpdateStatus(c.id, 'contratado', ocr)}>
                                                            <CheckCircle2 className="mr-2 h-4 w-4 text-blue-600" /> Marcar Contratado
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => handleUpdateStatus(c.id, 'rejeitado', ocr)}>
                                                            <UserX className="mr-2 h-4 w-4 text-red-600" /> Rejeitar (B. Talentos)
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem onClick={() => refreshOcr(c.id, c.arquivo_cv_url!)}>
                                                            <FileTerminal className="mr-2 h-4 w-4" /> Forçar Re-OCR
                                                        </DropdownMenuItem>
                                                    </DropdownMenuContent>
                                                </DropdownMenu>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                )
                            })}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    )
}
