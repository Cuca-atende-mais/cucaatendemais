"use client"

import { useEffect, useMemo, useState } from "react"
import { ChevronLeft, ChevronRight, ClipboardList, Download, Loader2, Lock, Search } from "lucide-react"
import toast from "react-hot-toast"
import { useUser } from "@/lib/auth/user-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EPM_SITUACAO_VAGAS } from "@/lib/rbac/catalogo-empregabilidade-gestao"
import { CHAVE_REDE, nomeCurto, type Unidade } from "@/lib/empregabilidade/relatorio"
import {
    filtrarLinhas,
    montarExportacaoSituacao,
    paginar,
    ROTULO_REDE,
    textoRodape,
    type FiltroTipo,
    type LinhaSituacao,
} from "@/lib/empregabilidade/relatorio-situacao-vagas"

// S-EMP-GES-09: relatório "Situação de vagas" — vagas e seleções abertas agora. O escopo de unidade é
// decidido no servidor (AC7); tipo e busca filtram na tela, e o rodapé conta o que está na tela (AC5.1).

interface RespostaSituacao {
    escopo: { rede: boolean; selecionada: string }
    unidades: Unidade[]
    linhas: LinhaSituacao[]
    permissoes: { exportar: boolean; rede: boolean }
    geradoPor: string
}

const VAZIO = "—"

function numero(n: number | null | undefined): string {
    return n === null || n === undefined ? VAZIO : n.toLocaleString("pt-BR")
}

function texto(v: string | null | undefined): string {
    return v || VAZIO
}

function CartaoLinha({ l }: { l: LinhaSituacao }) {
    const itens: [string, string][] = [
        ["Empresa", texto(l.empresa)],
        ["Unidade CUCA", l.unidade],
        ["Cadastrada em", texto(l.cadastradaEmTexto)],
        ["Liberada em", texto(l.liberadaEmTexto)],
        ["Dias em aberto", numero(l.diasEmAberto)],
        ["Currículos enviados à empresa", numero(l.enviados?.total)],
        ["Currículos enviados do Banco de Talentos", numero(l.enviados?.banco_talentos)],
        ["Currículos enviados da automação", numero(l.enviados?.automacao)],
        ["Data da entrevista / seleção", texto(l.dataEntrevistaSelecao)],
        ["Liberada por", texto(l.liberadaPor)],
    ]
    return (
        <Card>
            <CardContent className="space-y-3 pt-4">
                <div className="min-w-0">
                    <p className="text-xs font-medium uppercase text-muted-foreground">{l.rotuloTipo}</p>
                    <p className="font-semibold break-words">{l.titulo}</p>
                </div>
                <dl className="grid grid-cols-1 gap-2 text-sm">
                    {itens.map(([rotulo, valor]) => (
                        <div key={rotulo} className="flex justify-between gap-3">
                            <dt className="text-muted-foreground">{rotulo}</dt>
                            <dd className="text-right font-medium [overflow-wrap:anywhere]">{valor}</dd>
                        </div>
                    ))}
                </dl>
            </CardContent>
        </Card>
    )
}

export default function SituacaoVagasPage() {
    const { hasPermission, loading: carregandoUsuario } = useUser()
    const podeVer = hasPermission(EPM_SITUACAO_VAGAS.ver, "read")

    const [unidade, setUnidade] = useState("todas")
    const [tipo, setTipo] = useState<FiltroTipo>("todas")
    const [busca, setBusca] = useState("")
    const [pagina, setPagina] = useState(0)
    const [exportando, setExportando] = useState(false)
    // Resultado da última consulta, marcado com a unidade pedida: enquanto a unidade da tela não bate com a
    // do resultado, está carregando (sem setState síncrono dentro do efeito).
    const [resultado, setResultado] = useState<{ unidade: string; dados: RespostaSituacao | null; erro: string | null } | null>(null)
    const carregando = podeVer && resultado?.unidade !== unidade
    const dados = resultado?.dados ?? null
    const erro = resultado?.unidade === unidade ? resultado.erro : null

    useEffect(() => {
        if (!podeVer) return
        let cancelado = false
        fetch(`/api/empregabilidade/relatorio/situacao-vagas?${new URLSearchParams({ unidade }).toString()}`)
            .then(async res => {
                const corpo = await res.json().catch(() => ({}))
                if (cancelado) return
                if (!res.ok) setResultado({ unidade, dados: null, erro: corpo.error || "Não foi possível carregar o relatório." })
                else setResultado({ unidade, dados: corpo as RespostaSituacao, erro: null })
            })
            .catch(() => { if (!cancelado) setResultado({ unidade, dados: null, erro: "Não foi possível carregar o relatório." }) })
        return () => { cancelado = true }
    }, [podeVer, unidade])

    const linhas = useMemo(() => dados ? filtrarLinhas(dados.linhas, { tipo, busca }) : [], [dados, tipo, busca])
    // Rodapé conta todas as linhas filtradas; a tabela mostra 100 por página (AC6).
    const paginaAtual = paginar(linhas, pagina)

    // Mesmo fluxo do Relatório mensal: pede de novo à API com exportar=1 (o servidor confere a permissão de
    // baixar), aplica os mesmos filtros da tela e monta o Excel no navegador (gerador carregado sob demanda).
    const baixar = async () => {
        setExportando(true)
        try {
            const res = await fetch(`/api/empregabilidade/relatorio/situacao-vagas?${new URLSearchParams({ unidade, exportar: "1" }).toString()}`)
            const corpo = await res.json().catch(() => ({}))
            if (!res.ok) {
                toast.error(corpo.error || "Não foi possível gerar a planilha.")
                return
            }
            const d = corpo as RespostaSituacao
            // Unidade que o servidor aplicou, não a do seletor (quem não vê a rede fica com o seletor em "todas").
            const { abas, nomeArquivo } = montarExportacaoSituacao({
                linhas: d.linhas,
                unidades: d.unidades,
                unidadeEfetiva: d.escopo.selecionada,
                tipo,
                busca,
                geradoPor: d.geradoPor,
                agora: new Date(),
            })
            const { gerarXlsxRelatorio } = await import("@/lib/empregabilidade/gerar-xlsx-relatorio")
            const buffer = await gerarXlsxRelatorio(abas, d.geradoPor, "Situação de vagas — Rede Cuca")
            const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
            const url = URL.createObjectURL(blob)
            const link = document.createElement("a")
            link.href = url
            link.download = nomeArquivo
            link.click()
            URL.revokeObjectURL(url)
            toast.success("Planilha gerada.")
        } catch (e) {
            console.error("[situacao-vagas] Erro ao gerar a planilha:", e)
            toast.error("Não foi possível gerar a planilha.")
        } finally {
            setExportando(false)
        }
    }

    if (carregandoUsuario) return <Skeleton className="h-64 w-full" />

    if (!podeVer) {
        return (
            <Card>
                <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
                    <Lock className="h-8 w-8 text-muted-foreground" />
                    <p className="font-medium">Você não tem acesso ao relatório Situação de vagas.</p>
                    <p className="text-sm text-muted-foreground">Peça a liberação no seu perfil de acesso.</p>
                </CardContent>
            </Card>
        )
    }

    const unidadeTravada = !!dados && !dados.escopo.rede

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                        <ClipboardList className="h-7 w-7 text-cuca-blue" />
                        Situação de vagas
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Vagas e seleções abertas agora: datas, dias em aberto, currículos enviados à empresa e quem liberou.
                    </p>
                </div>
                {dados?.permissoes?.exportar && (
                    <Button onClick={baixar} disabled={exportando || carregando || !!erro} className="gap-2 h-11 md:h-9">
                        {exportando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        Baixar Excel
                    </Button>
                )}
            </div>

            <Card>
                <CardContent className="grid gap-4 pt-6 md:grid-cols-3">
                    <div className="grid gap-2 min-w-0">
                        <Label>Tipo</Label>
                        <Select value={tipo} onValueChange={v => { setTipo(v as FiltroTipo); setPagina(0) }}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value="todas">Todas</SelectItem>
                                <SelectItem value="vagas">Vagas</SelectItem>
                                <SelectItem value="selecoes">Seleções</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid gap-2 min-w-0">
                        <Label>Unidade CUCA</Label>
                        {unidadeTravada ? (
                            <Input value={nomeCurto(dados?.unidades[0]?.nome ?? "")} disabled />
                        ) : (
                            <Select value={unidade} onValueChange={v => { setUnidade(v); setPagina(0) }}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="todas">Todas</SelectItem>
                                    {(dados?.unidades ?? []).map(u => <SelectItem key={u.id} value={u.id}>{nomeCurto(u.nome)}</SelectItem>)}
                                    <SelectItem value={CHAVE_REDE}>{ROTULO_REDE}</SelectItem>
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                    <div className="grid gap-2 min-w-0">
                        <Label htmlFor="situacao-busca">Buscar</Label>
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                            <Input id="situacao-busca" className="pl-9" placeholder="Vaga, seleção ou empresa" value={busca} onChange={e => { setBusca(e.target.value); setPagina(0) }} />
                        </div>
                    </div>
                </CardContent>
            </Card>

            {erro && (
                <Card className="border-rose-300">
                    <CardContent className="py-6 text-sm text-rose-900">{erro}</CardContent>
                </Card>
            )}

            {carregando && !dados && <Skeleton className="h-48 w-full" />}

            {dados && !erro && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-lg">Vagas e seleções abertas</CardTitle>
                        <CardDescription>
                            Seleção não pede currículo e não envia para a empresa, por isso as colunas de currículos ficam em branco nas seleções.
                            {carregando && " Atualizando..."}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {linhas.length === 0 ? (
                            <p className="py-8 text-center text-sm text-muted-foreground">Nenhuma vaga ou seleção aberta com esses filtros.</p>
                        ) : (
                            <>
                                {/* Celular: um cartão por vaga/seleção */}
                                <div className="space-y-2 md:hidden">
                                    {paginaAtual.itens.map(l => <CartaoLinha key={l.id} l={l} />)}
                                </div>
                                <div className="hidden md:block">
                                    <Table cabecalhoFixo primeiraColunaFixa>
                                        <TableHeader>
                                            <TableRow>
                                                <TableHead>Tipo</TableHead>
                                                <TableHead className="min-w-[14rem]">Vaga / Seleção</TableHead>
                                                <TableHead className="min-w-[12rem]">Empresa</TableHead>
                                                <TableHead className="min-w-[9rem]">Unidade CUCA</TableHead>
                                                <TableHead>Cadastrada em</TableHead>
                                                <TableHead>Liberada em</TableHead>
                                                <TableHead className="text-right">Dias em aberto</TableHead>
                                                <TableHead className="text-right min-w-[9rem] whitespace-normal">Currículos enviados à empresa</TableHead>
                                                <TableHead className="text-right min-w-[10rem] whitespace-normal">Currículos enviados do Banco de Talentos</TableHead>
                                                <TableHead className="text-right min-w-[9rem] whitespace-normal">Currículos enviados da automação</TableHead>
                                                <TableHead className="min-w-[10rem] whitespace-normal">Data da entrevista / seleção</TableHead>
                                                <TableHead>Liberada por</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {paginaAtual.itens.map(l => (
                                                <TableRow key={l.id}>
                                                    <TableCell className="font-medium">{l.rotuloTipo}</TableCell>
                                                    <TableCell className="whitespace-normal break-words">{l.titulo}</TableCell>
                                                    <TableCell className="whitespace-normal break-words">{texto(l.empresa)}</TableCell>
                                                    <TableCell className="whitespace-normal">{l.unidade}</TableCell>
                                                    <TableCell className="tabular-nums">{texto(l.cadastradaEmTexto)}</TableCell>
                                                    <TableCell className="tabular-nums">{texto(l.liberadaEmTexto)}</TableCell>
                                                    <TableCell className="text-right tabular-nums">{numero(l.diasEmAberto)}</TableCell>
                                                    <TableCell className="text-right tabular-nums font-semibold">{numero(l.enviados?.total)}</TableCell>
                                                    <TableCell className="text-right tabular-nums">{numero(l.enviados?.banco_talentos)}</TableCell>
                                                    <TableCell className="text-right tabular-nums">{numero(l.enviados?.automacao)}</TableCell>
                                                    <TableCell className="whitespace-normal tabular-nums">{texto(l.dataEntrevistaSelecao)}</TableCell>
                                                    <TableCell className="[overflow-wrap:anywhere]">{texto(l.liberadaPor)}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </div>
                                {paginaAtual.totalPaginas > 1 && (
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-xs text-muted-foreground tabular-nums">
                                            {paginaAtual.de}–{paginaAtual.ate} de {linhas.length}
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <Button variant="outline" size="sm" className="h-11 w-11 md:h-8 md:w-auto" aria-label="Página anterior" disabled={paginaAtual.pagina === 0} onClick={() => setPagina(paginaAtual.pagina - 1)}>
                                                <ChevronLeft className="h-4 w-4" />
                                            </Button>
                                            <span className="text-xs tabular-nums">{paginaAtual.pagina + 1} / {paginaAtual.totalPaginas}</span>
                                            <Button variant="outline" size="sm" className="h-11 w-11 md:h-8 md:w-auto" aria-label="Próxima página" disabled={paginaAtual.pagina >= paginaAtual.totalPaginas - 1} onClick={() => setPagina(paginaAtual.pagina + 1)}>
                                                <ChevronRight className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                )}
                            </>
                        )}
                        <p className="border-t pt-3 text-sm font-semibold tabular-nums">{textoRodape(linhas)}</p>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
