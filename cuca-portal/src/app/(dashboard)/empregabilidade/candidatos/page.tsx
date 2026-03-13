"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase/client"
import { Candidatura, Vaga } from "@/lib/types/database"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table"
import { Search, Eye, ExternalLink, Users, CheckCircle2, UserX } from "lucide-react"
import { differenceInYears } from "date-fns"
import toast from "react-hot-toast"
import { MatchModal } from "@/components/empregabilidade/match-modal"

type CandidatoComVaga = Candidatura & {
    vagas: {
        id: string
        titulo: string
        unidade_cuca: string | null
    } | null
}

export default function CandidatosGlobaisPage() {
    const [candidatos, setCandidatos] = useState<CandidatoComVaga[]>([])
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState("")
    const [selectedCandidato, setSelectedCandidato] = useState<any>(null)
    const [isMatchModalOpen, setIsMatchModalOpen] = useState(false)
    const router = useRouter()

    const supabase = createClient()

    useEffect(() => {
        fetchCandidatos()
    }, [])

    const fetchCandidatos = async () => {
        setLoading(true)
        const { data, error } = await supabase
            .from("candidaturas")
            .select("*, vagas(id, titulo, unidade_cuca)")
            .order("created_at", { ascending: false })

        if (error) {
            console.error("Erro ao buscar candidatos:", error)
            toast.error("Erro ao carregar candidatos")
        } else {
            setCandidatos(data || [])
        }
        setLoading(false)
    }

    const calcularIdade = (dataStr: string | null) => {
        if (!dataStr) return "-"
        return differenceInYears(new Date(), new Date(dataStr)) + " anos"
    }

    const openMatchModal = (candidato: CandidatoComVaga) => {
        // Formatar para o MatchModal que espera { candidato, vaga }
        setSelectedCandidato(candidato)
        setIsMatchModalOpen(true)
    }

    const handleUpdateStatus = async (candidaturaId: string, novoStatus: string) => {
        try {
            const { error } = await supabase.from("candidaturas").update({ status: novoStatus }).eq("id", candidaturaId)
            if (error) throw error

            if (novoStatus === 'rejeitado') {
                toast.success("Candidato movido para o Banco de Talentos.")
            } else {
                toast.success("Status atualizado.")
            }
            fetchCandidatos()
        } catch (error: any) {
            toast.error(error.message || "Falha ao mudar status.")
        }
    }

    const filteredCandidatos = candidatos.filter((c) => {
        const term = searchTerm.toLowerCase()
        return (c.nome && c.nome.toLowerCase().includes(term)) ||
            (c.telefone && c.telefone.includes(term)) ||
            (c.vagas?.titulo && c.vagas.titulo.toLowerCase().includes(term))
    })

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Gestão Global de Candidatos</h1>
                    <p className="text-muted-foreground">
                        Visão unificada de todas as aplicações e currículos enviados para as vagas ativas.
                    </p>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total de Inscrições</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{candidatos.length}</div>
                        <p className="text-xs text-muted-foreground">
                            {filteredCandidatos.length} listados na busca
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Contratados</CardTitle>
                        <CheckCircle2 className="h-4 w-4 text-cuca-blue" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {candidatos.filter((c) => c.status === 'contratado').length}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Processos Finalizados
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Rejeitados</CardTitle>
                        <UserX className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {candidatos.filter((c) => c.status === 'rejeitado').length}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Enviados ao Banco de Talentos
                        </p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <CardTitle>Últimas Candidaturas</CardTitle>
                            <CardDescription>
                                Acompanhe o fluxo de candidatos ou verifique a análise de match com as vagas.
                            </CardDescription>
                        </div>
                        <div className="relative w-full md:w-80">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar candidato ou vaga..."
                                className="pl-10 w-full"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="text-center py-8 text-muted-foreground">
                            Carregando currículos...
                        </div>
                    ) : filteredCandidatos.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            Nenhum candidato encontrado.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Candidato</TableHead>
                                    <TableHead>Vaga / Oportunidade</TableHead>
                                    <TableHead>Escolaridade / Resumo</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredCandidatos.map((c) => {
                                    const ocr = c.dados_ocr_json || {}
                                    return (
                                        <TableRow key={c.id}>
                                            <TableCell className="font-medium">
                                                <div>{c.nome}</div>
                                                <div className="text-xs text-muted-foreground">{calcularIdade(c.data_nascimento)} • {c.telefone}</div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="font-medium text-sm max-w-[200px] truncate" title={c.vagas?.titulo || "Vaga Deletada"}>
                                                    {c.vagas?.titulo || "Vaga Arquivada/Deletada"}
                                                </div>
                                                <div className="text-xs text-muted-foreground">
                                                    {c.vagas?.unidade_cuca || "Geral"}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <div className="text-sm max-w-[200px] truncate text-muted-foreground" title={ocr.escolaridade || "Sem dados de escolaridade"}>
                                                    {ocr.escolaridade || "Analisando OCR..."}
                                                </div>
                                                <div className="text-xs max-w-[200px] truncate text-muted-foreground" title={ocr.experiencia_resumo || ocr.skills || ""}>
                                                    {ocr.experiencia_resumo || ocr.skills || ""}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={c.status === 'pendente' ? 'outline' : c.status === 'selecionado' ? 'default' : c.status === 'contratado' ? 'secondary' : 'destructive'}
                                                    className={c.status === 'pendente' ? 'border-amber-300 text-amber-700 bg-amber-50' : ''}>
                                                    {c.status.toUpperCase()}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex items-center justify-end gap-2">
                                                    {c.vagas?.id && (
                                                        <Button
                                                            variant="outline"
                                                            size="sm"
                                                            title="Ver detalhes dentro do painel da vaga"
                                                            onClick={() => router.push(`/empregabilidade/vagas/${c.vagas?.id}`)}
                                                            className="h-8"
                                                        >
                                                            <ExternalLink className="h-4 w-4 mr-1" /> Vaga
                                                        </Button>
                                                    )}
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        title="Ver Análise da IA (Match)"
                                                        className="text-cuca-blue hover:text-sky-800 hover:bg-sky-50 h-8 font-semibold"
                                                        onClick={() => openMatchModal(c)}
                                                    >
                                                        <Eye className="h-4 w-4 mr-1" /> Análise IA
                                                    </Button>
                                                </div>
                                            </TableCell>
                                        </TableRow>
                                    )
                                })}
                            </TableBody>
                        </Table>
                    )}
                </CardContent>
            </Card>

            <MatchModal
                isOpen={isMatchModalOpen}
                onClose={() => setIsMatchModalOpen(false)}
                candidato={selectedCandidato}
                vaga={selectedCandidato?.vagas}
            />
        </div>
    )
}
