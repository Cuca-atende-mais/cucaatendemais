"use client"

import { useState, useEffect } from "react"
import { createClient } from "@/lib/supabase/client"
import { TalentBank } from "@/lib/types/database"
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
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import { Search, Eye, FileText, BrainCircuit, User } from "lucide-react"
import { differenceInYears } from "date-fns"
import toast from "react-hot-toast"

export default function BancoTalentosPage() {
    const [talentos, setTalentos] = useState<TalentBank[]>([])
    const [loading, setLoading] = useState(true)
    const [searchTerm, setSearchTerm] = useState("")
    const [dialogOpen, setDialogOpen] = useState(false)
    const [selectedTalento, setSelectedTalento] = useState<TalentBank | null>(null)

    const supabase = createClient()

    useEffect(() => {
        fetchTalentos()
    }, [])

    const fetchTalentos = async () => {
        setLoading(true)
        const { data, error } = await supabase
            .from("talent_bank")
            .select("*")
            .order("created_at", { ascending: false })

        if (error) {
            console.error("Erro ao buscar talentos:", error)
            toast.error("Erro ao carregar banco de talentos")
        } else {
            setTalentos(data || [])
        }
        setLoading(false)
    }

    const calcularIdade = (dataStr: string | null) => {
        if (!dataStr) return "-"
        return differenceInYears(new Date(), new Date(dataStr)) + " anos"
    }

    const handleViewSkills = (talento: TalentBank) => {
        setSelectedTalento(talento)
        setDialogOpen(true)
    }

    const filteredTalentos = talentos.filter((t) => {
        const term = searchTerm.toLowerCase()
        const skillsStr = JSON.stringify(t.skills_jsonb || {}).toLowerCase()
        return t.nome.toLowerCase().includes(term) || skillsStr.includes(term) || (t.telefone && t.telefone.includes(term))
    })

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Banco de Talentos</h1>
                    <p className="text-muted-foreground">
                        Respositório inteligente de todos os candidatos não contratados para matching futuro.
                    </p>
                </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Total no Banco</CardTitle>
                        <User className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{talentos.length}</div>
                        <p className="text-xs text-muted-foreground">
                            {filteredTalentos.length} listados na busca
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Disponíveis</CardTitle>
                        <BrainCircuit className="h-4 w-4 text-cuca-blue" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {talentos.filter((c) => c.status === 'disponivel').length}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Aguardando nova oportunidade
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Arquivados/Contratados (Outras)</CardTitle>
                        <FileText className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">
                            {talentos.filter((c) => c.status !== 'disponivel').length}
                        </div>
                        <p className="text-xs text-muted-foreground">
                            Não mais disponíveis
                        </p>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                            <CardTitle>Pool Lógico de Talentos (IA)</CardTitle>
                            <CardDescription>
                                As Habilidades listadas abaixo foram inferidas silenciosamente via GPT-4o Vision a partir dos PDFs enviados outrora pelos candidatos.
                            </CardDescription>
                        </div>
                        <div className="relative w-full md:w-80">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder="Buscar por nome, python, react, excel..."
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
                            Puxando rede de talentos...
                        </div>
                    ) : filteredTalentos.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                            Nenhum talento retido até o momento.
                        </div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Candidato (Idade)</TableHead>
                                    <TableHead>Contato</TableHead>
                                    <TableHead>Escolaridade</TableHead>
                                    <TableHead>Resumo de Skills</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead className="text-right">Ações</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredTalentos.map((t) => {
                                    const ocr = t.skills_jsonb || {}
                                    return (
                                        <TableRow key={t.id}>
                                            <TableCell className="font-medium text-slate-800">
                                                <div>{t.nome}</div>
                                                <div className="text-xs text-muted-foreground">{calcularIdade(t.data_nascimento)}</div>
                                            </TableCell>
                                            <TableCell className="text-sm text-muted-foreground">
                                                {t.telefone || "-"}
                                            </TableCell>
                                            <TableCell className="text-sm text-muted-foreground">
                                                {ocr.escolaridade || "-"}
                                            </TableCell>
                                            <TableCell>
                                                <div className="text-xs truncate max-w-[200px] text-muted-foreground">
                                                    {ocr.experiencia_resumo || ocr.skills || "Nenhum resumo detectado."}
                                                </div>
                                            </TableCell>
                                            <TableCell>
                                                <Badge variant={t.status === 'disponivel' ? 'outline' : 'secondary'} className={t.status === 'disponivel' ? 'border-green-300 text-green-700 bg-green-50' : ''}>
                                                    {t.status.toUpperCase()}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="text-right">
                                                <div className="flex justify-end gap-2">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="text-cuca-blue hover:text-sky-800 hover:bg-sky-50"
                                                        onClick={() => handleViewSkills(t)}
                                                    >
                                                        <BrainCircuit className="h-4 w-4 mr-1" />
                                                        Ver Raio-X IA
                                                    </Button>
                                                    {t.arquivo_cv_url && (
                                                        <Button variant="ghost" size="icon" title="Ver Currículo Original" onClick={() => window.open(t.arquivo_cv_url!, '_blank')}>
                                                            <FileText className="h-4 w-4 text-slate-500" />
                                                        </Button>
                                                    )}
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

            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle className="flex items-center gap-2">
                            <BrainCircuit className="w-5 h-5 text-cuca-blue" /> Raio-X de Competências
                        </DialogTitle>
                        <DialogDescription>
                            Dados extraídos via GPT Vision OCR sobre <strong>{selectedTalento?.nome}</strong>
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        {selectedTalento && (
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <h4 className="text-sm font-semibold text-slate-900">Escolaridade</h4>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        {selectedTalento.skills_jsonb?.escolaridade || "Não informada"}
                                    </p>
                                </div>
                                <div>
                                    <h4 className="text-sm font-semibold text-slate-900">Tempo de Experiência</h4>
                                    <p className="text-sm text-muted-foreground mt-1">
                                        {selectedTalento.skills_jsonb?.experiencia_meses
                                            ? `${selectedTalento.skills_jsonb.experiencia_meses} meses / ${(selectedTalento.skills_jsonb.experiencia_meses / 12).toFixed(1)} anos`
                                            : "Não detectada"}
                                    </p>
                                </div>
                                <div className="col-span-2">
                                    <h4 className="text-sm font-semibold text-slate-900">Resumo Profissional / Habilidades</h4>
                                    <div className="mt-2 bg-slate-50 p-3 rounded-md border text-sm text-slate-700 whitespace-pre-wrap">
                                        {selectedTalento.skills_jsonb?.experiencia_resumo || selectedTalento.skills_jsonb?.skills || "Nenhum detalhe extraído pelo processamento de currículo."}
                                    </div>
                                </div>
                                <div className="col-span-2">
                                    <h4 className="text-sm font-semibold text-slate-900">Dados JSON Brutos (Debug Engine)</h4>
                                    <pre className="mt-2 bg-slate-900 text-slate-100 p-3 rounded-md text-xs overflow-auto max-h-[200px]">
                                        {JSON.stringify(selectedTalento.skills_jsonb, null, 2)}
                                    </pre>
                                </div>
                            </div>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    )
}
