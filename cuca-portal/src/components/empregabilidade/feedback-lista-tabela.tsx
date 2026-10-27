"use client"

import { useEffect, useMemo, useState } from "react"
import { format } from "date-fns"
import { ptBR } from "date-fns/locale"
import { AlertTriangle, ChevronLeft, ChevronRight, Search } from "lucide-react"
import toast from "react-hot-toast"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { rotuloStatusEnvio } from "@/lib/empregabilidade/feedback-solicitacao"
import { rotuloVaga } from "@/lib/empregabilidade/feedback-tela"
import { COR_ENVIO, ROTULO_FEEDBACK, rotuloFeedback } from "@/lib/empregabilidade/feedback-rotulos"
import {
    STATUS_FILTRAVEIS,
    STATUS_FILTRO_TODOS,
    filtrarLista,
    type FiltroLista,
    type LinhaFeedback,
} from "@/lib/empregabilidade/feedback-lista"

// S-EMP-GES-08: lista dos feedbacks enviados (modo lista da tela Feedback). Uma linha por vaga com o
// pedido mais recente; clicar abre o detalhe da vaga. Recarrega toda vez que a lista volta a aparecer.

const POR_PAGINA = 25

function dataHora(valor: string): string {
    try {
        return format(new Date(valor), "dd/MM/yyyy HH:mm", { locale: ptBR })
    } catch {
        return "—"
    }
}

interface Props {
    /** Filtro de empresa vindo do seletor (`?empresa=`). Vazio = todas. */
    empresaId: string
    onAbrir: (vagaId: string) => void
}

export function FeedbackListaTabela({ empresaId, onAbrir }: Props) {
    const [linhas, setLinhas] = useState<LinhaFeedback[]>([])
    const [carregando, setCarregando] = useState(true)
    const [erro, setErro] = useState(false)
    const [busca, setBusca] = useState("")
    const [status, setStatus] = useState<NonNullable<FiltroLista["status"]>>(STATUS_FILTRO_TODOS)
    const [pagina, setPagina] = useState(0)

    useEffect(() => {
        let cancelado = false
        const carregar = async () => {
            setCarregando(true)
            setErro(false)
            try {
                const res = await fetch("/api/empregabilidade/feedback/lista", { cache: "no-store" })
                const data = await res.json().catch(() => ({}))
                if (!res.ok) throw new Error(data.error || "Erro ao carregar os feedbacks enviados.")
                if (!cancelado) setLinhas((data.linhas ?? []) as LinhaFeedback[])
            } catch (err) {
                console.error("[feedback] Erro ao carregar a lista:", err)
                if (!cancelado) {
                    setErro(true)
                    toast.error(err instanceof Error ? err.message : "Erro ao carregar os feedbacks enviados.")
                }
            } finally {
                if (!cancelado) setCarregando(false)
            }
        }
        carregar()
        return () => { cancelado = true }
    }, [])

    useEffect(() => { setPagina(0) }, [busca, status, empresaId])

    const filtradas = useMemo(
        () => filtrarLista(linhas, { busca, status, empresaId: empresaId || undefined }),
        [linhas, busca, status, empresaId],
    )
    const totalPaginas = Math.max(1, Math.ceil(filtradas.length / POR_PAGINA))
    const paginaAtual = Math.min(pagina, totalPaginas - 1)
    const visiveis = filtradas.slice(paginaAtual * POR_PAGINA, (paginaAtual + 1) * POR_PAGINA)

    return (
        <Card>
            <CardHeader>
                <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                    <div>
                        <CardTitle className="text-lg">Feedbacks enviados</CardTitle>
                        <CardDescription>
                            {carregando ? "Carregando..." : `${filtradas.length} ${filtradas.length === 1 ? "vaga" : "vagas"} com pedido de feedback. Clique na linha para abrir.`}
                        </CardDescription>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <div className="relative w-full sm:w-64">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input
                                placeholder="Buscar empresa ou vaga..."
                                className="pl-10"
                                value={busca}
                                onChange={e => setBusca(e.target.value)}
                                aria-label="Buscar empresa ou vaga"
                            />
                        </div>
                        <Select value={status} onValueChange={v => setStatus(v as NonNullable<FiltroLista["status"]>)}>
                            <SelectTrigger className="w-full sm:w-56" aria-label="Filtrar pelo status do feedback">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value={STATUS_FILTRO_TODOS}>Todos os status</SelectItem>
                                {STATUS_FILTRAVEIS.map(s => <SelectItem key={s} value={s}>{ROTULO_FEEDBACK[s]}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                </div>
            </CardHeader>
            <CardContent>
                {carregando ? (
                    <Skeleton className="h-40 w-full" />
                ) : erro ? (
                    <p className="flex items-center justify-center gap-2 py-8 text-center text-sm text-rose-700">
                        <AlertTriangle className="h-4 w-4" /> Não foi possível carregar os feedbacks enviados.
                    </p>
                ) : linhas.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">Nenhum feedback enviado ainda.</p>
                ) : filtradas.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">Nenhum feedback encontrado com esses filtros.</p>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Último envio</TableHead>
                                        <TableHead>Empresa</TableHead>
                                        <TableHead>Vaga</TableHead>
                                        <TableHead>Candidatos</TableHead>
                                        <TableHead>Pedidos</TableHead>
                                        <TableHead>Mensagem</TableHead>
                                        <TableHead>Feedback</TableHead>
                                        <TableHead>Enviado por</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {visiveis.map(l => (
                                        <TableRow
                                            key={l.vaga_id}
                                            tabIndex={0}
                                            role="link"
                                            aria-label={`Abrir o feedback de ${rotuloVaga(l)} — ${l.empresa_nome}`}
                                            className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cuca-blue"
                                            onClick={() => onAbrir(l.vaga_id)}
                                            onKeyDown={e => { if (e.key === "Enter") onAbrir(l.vaga_id) }}
                                        >
                                            <TableCell className="whitespace-nowrap">{dataHora(l.ultimo.created_at)}</TableCell>
                                            <TableCell className="max-w-[14rem] truncate font-medium">{l.empresa_nome}</TableCell>
                                            <TableCell className="max-w-[18rem] truncate">{rotuloVaga(l)}</TableCell>
                                            <TableCell>{l.ultimo.candidatos}</TableCell>
                                            <TableCell>{l.pedidos}</TableCell>
                                            <TableCell>
                                                <Badge variant="outline" className={COR_ENVIO[l.ultimo.status_envio] ?? ""}>
                                                    {rotuloStatusEnvio(l.ultimo.status_envio, l.ultimo.erro_envio)}
                                                </Badge>
                                            </TableCell>
                                            <TableCell className="whitespace-nowrap">{rotuloFeedback(l.ultimo)}</TableCell>
                                            <TableCell className="max-w-[12rem] truncate">{l.ultimo.enviado_por || "—"}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>

                        {totalPaginas > 1 && (
                            <div className="mt-4 flex items-center justify-between border-t pt-4">
                                <span className="text-xs text-muted-foreground">
                                    {paginaAtual * POR_PAGINA + 1}–{Math.min((paginaAtual + 1) * POR_PAGINA, filtradas.length)} de {filtradas.length}
                                </span>
                                <div className="flex items-center gap-2">
                                    <Button variant="outline" size="sm" disabled={paginaAtual === 0} onClick={() => setPagina(paginaAtual - 1)} aria-label="Página anterior">
                                        <ChevronLeft className="h-4 w-4" />
                                    </Button>
                                    <span className="text-xs tabular-nums">{paginaAtual + 1} / {totalPaginas}</span>
                                    <Button variant="outline" size="sm" disabled={paginaAtual >= totalPaginas - 1} onClick={() => setPagina(paginaAtual + 1)} aria-label="Próxima página">
                                        <ChevronRight className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    )
}
