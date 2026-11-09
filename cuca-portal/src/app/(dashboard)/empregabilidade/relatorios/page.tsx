"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { BarChart3, Download, Loader2, Lock, TrendingDown, TrendingUp } from "lucide-react"
import toast from "react-hot-toast"
import { useUser } from "@/lib/auth/user-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { EPM_RELATORIO } from "@/lib/rbac/catalogo-empregabilidade-gestao"
import {
    CHAVE_REDE,
    montarCartoes,
    montarPlanilha,
    montarPrevia,
    nomeArquivoRelatorio,
    nomeCurto,
    periodoDoAtalho,
    rotuloMes,
    rotuloPeriodo,
    type Atalho,
    type Serie,
    type Unidade,
    type VagaDetalhe,
} from "@/lib/empregabilidade/relatorio"

// S-EMP-GES-04: relatório Emprega+ — filtros de período e unidade, prévia na tela (cartões com variação
// sobre o período anterior e tabela indicador × mês) e download do Excel. O escopo de unidade é decidido
// no servidor (AC13); a tela só mostra o que a API devolveu.

interface RespostaRelatorio {
    periodo: { inicio: string; fim: string; meses: string[] }
    anterior: { inicio: string; fim: string; meses: string[] }
    escopo: { rede: boolean; selecionada: string; chaves: string[] }
    unidades: Unidade[]
    serie: Serie
    serieAnterior: Serie
    geradoPor: string
    permissoes: { exportar: boolean; rede: boolean }
    detalhe?: VagaDetalhe[]
}

const ATALHOS: { id: Atalho; rotulo: string }[] = [
    { id: "mes_passado", rotulo: "Mês passado" },
    { id: "ultimos_3", rotulo: "Últimos 3 meses" },
    { id: "ano_atual", rotulo: "Ano atual" },
]

function formatarVariacao(v: number | null): { texto: string; sobe: boolean | null } {
    if (v === null) return { texto: "sem base de comparação", sobe: null }
    const pct = (v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })
    return { texto: `${v > 0 ? "+" : ""}${pct}% sobre o período anterior`, sobe: v === 0 ? null : v > 0 }
}

export default function RelatoriosPage() {
    const { hasPermission, loading: carregandoUsuario } = useUser()
    const podeVer = hasPermission(EPM_RELATORIO.ver, "read")

    const inicial = useMemo(() => periodoDoAtalho("mes_passado"), [])
    const [inicio, setInicio] = useState(inicial.inicio)
    const [fim, setFim] = useState(inicial.fim)
    const [unidade, setUnidade] = useState("todas")
    const [dados, setDados] = useState<RespostaRelatorio | null>(null)
    const [carregando, setCarregando] = useState(false)
    const [erro, setErro] = useState<string | null>(null)
    const [exportando, setExportando] = useState(false)

    const consulta = useCallback((exportar: boolean) => {
        const q = new URLSearchParams({ inicio, fim, unidade })
        if (exportar) q.set("exportar", "1")
        return fetch(`/api/empregabilidade/relatorio?${q.toString()}`)
    }, [inicio, fim, unidade])

    useEffect(() => {
        if (!podeVer || !inicio || !fim) return
        let cancelado = false
        setCarregando(true)
        setErro(null)
        consulta(false)
            .then(async res => {
                const corpo = await res.json().catch(() => ({}))
                if (cancelado) return
                if (!res.ok) {
                    setErro(corpo.error || "Não foi possível carregar o relatório.")
                    setDados(null)
                } else {
                    setDados(corpo as RespostaRelatorio)
                }
            })
            .catch(() => { if (!cancelado) setErro("Não foi possível carregar o relatório.") })
            .finally(() => { if (!cancelado) setCarregando(false) })
        return () => { cancelado = true }
    }, [podeVer, consulta, inicio, fim])

    const comRede = !!dados && dados.escopo.rede && dados.escopo.selecionada === "todas"
    const cartoes = useMemo(() => dados ? montarCartoes({
        serie: dados.serie, anterior: dados.serieAnterior, chaves: dados.escopo.chaves,
        meses: dados.periodo.meses, mesesAnteriores: dados.anterior.meses, rede: comRede,
    }) : [], [dados, comRede])
    const previa = useMemo(() => dados ? montarPrevia({
        serie: dados.serie, chaves: dados.escopo.chaves, meses: dados.periodo.meses, rede: comRede,
    }) : [], [dados, comRede])

    const aplicarAtalho = (a: Atalho) => {
        const p = periodoDoAtalho(a)
        setInicio(p.inicio)
        setFim(p.fim)
    }

    const baixar = async () => {
        setExportando(true)
        try {
            const res = await consulta(true)
            const corpo = await res.json().catch(() => ({}))
            if (!res.ok) {
                toast.error(corpo.error || "Não foi possível gerar a planilha.")
                return
            }
            const d = corpo as RespostaRelatorio
            const abas = montarPlanilha({
                escopo: d.escopo,
                unidades: d.unidades,
                vagas: d.detalhe ?? [],
                ctx: {
                    inicio: d.periodo.inicio, fim: d.periodo.fim, meses: d.periodo.meses, mesesAnteriores: d.anterior.meses,
                    serie: d.serie, anterior: d.serieAnterior, geradoEm: new Date(), geradoPor: d.geradoPor,
                },
            })
            const { gerarXlsxRelatorio } = await import("@/lib/empregabilidade/gerar-xlsx-relatorio")
            const buffer = await gerarXlsxRelatorio(abas, d.geradoPor)
            const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
            const url = URL.createObjectURL(blob)
            const link = document.createElement("a")
            link.href = url
            link.download = nomeArquivoRelatorio(d.periodo.inicio, d.periodo.fim, d.escopo.selecionada, d.unidades)
            link.click()
            URL.revokeObjectURL(url)
            toast.success("Planilha gerada.")
        } catch (e) {
            console.error("[relatorios] Erro ao gerar a planilha:", e)
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
                    <p className="font-medium">Você não tem acesso ao relatório Emprega+.</p>
                    <p className="text-sm text-muted-foreground">Peça a liberação no seu perfil de acesso.</p>
                </CardContent>
            </Card>
        )
    }

    const unidadeTravada = !!dados && !dados.escopo.rede
    const nomeUnidadeTravada = unidadeTravada ? nomeCurto(dados.unidades[0]?.nome ?? "") : ""

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                        <BarChart3 className="h-7 w-7 text-cuca-blue" />
                        Relatório Emprega+
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Indicadores do período por unidade e consolidados, para baixar em Excel.
                    </p>
                </div>
                {dados?.permissoes.exportar && (
                    <Button onClick={baixar} disabled={exportando || carregando || !!erro} className="gap-2 h-11 md:h-9">
                        {exportando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                        Baixar Excel
                    </Button>
                )}
            </div>

            <Card>
                <CardContent className="grid gap-4 pt-6 md:grid-cols-[1fr_1fr_1.4fr]">
                    <div className="grid gap-2 min-w-0">
                        <Label htmlFor="rel-inicio">Mês inicial</Label>
                        <Input id="rel-inicio" type="month" value={inicio} max={fim} onChange={e => setInicio(e.target.value)} />
                    </div>
                    <div className="grid gap-2 min-w-0">
                        <Label htmlFor="rel-fim">Mês final</Label>
                        <Input id="rel-fim" type="month" value={fim} min={inicio} onChange={e => setFim(e.target.value)} />
                    </div>
                    <div className="grid gap-2 min-w-0">
                        <Label>Unidade</Label>
                        {unidadeTravada ? (
                            <Input value={nomeUnidadeTravada} disabled />
                        ) : (
                            <Select value={unidade} onValueChange={setUnidade}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="todas">Todas (consolidado)</SelectItem>
                                    {(dados?.unidades ?? []).map(u => <SelectItem key={u.id} value={u.id}>{nomeCurto(u.nome)}</SelectItem>)}
                                    <SelectItem value={CHAVE_REDE}>Rede Cuca (global)</SelectItem>
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2 md:col-span-3">
                        {ATALHOS.map(a => (
                            <Button key={a.id} variant="outline" size="sm" className="h-11 md:h-8" onClick={() => aplicarAtalho(a.id)}>{a.rotulo}</Button>
                        ))}
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
                <>
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                        {cartoes.map(c => {
                            const v = formatarVariacao(c.variacao)
                            return (
                                <Card key={c.titulo}>
                                    <CardHeader className="pb-2">
                                        <CardDescription>{c.titulo}</CardDescription>
                                        <CardTitle className="text-3xl tabular-nums">{c.total.toLocaleString("pt-BR")}</CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-1 text-sm">
                                        <p className={`flex items-center gap-1 ${v.sobe === null ? "text-muted-foreground" : v.sobe ? "text-emerald-700" : "text-rose-700"}`}>
                                            {v.sobe === true && <TrendingUp className="h-4 w-4" />}
                                            {v.sobe === false && <TrendingDown className="h-4 w-4" />}
                                            {v.texto}
                                        </p>
                                        {c.detalhe && <p className="text-muted-foreground">{c.detalhe}</p>}
                                    </CardContent>
                                </Card>
                            )
                        })}
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Indicadores por mês — {rotuloPeriodo(dados.periodo.inicio, dados.periodo.fim)}</CardTitle>
                            <CardDescription>
                                {comRede
                                    ? "Rede Cuca, todas as unidades. Currículos e empresas não têm unidade e só aparecem no consolidado."
                                    : "Currículos e empresas não têm unidade e só aparecem no consolidado da rede."}
                                {carregando && " Atualizando..."}
                            </CardDescription>
                        </CardHeader>
                        {/* Um mês por coluna: em tela estreita a tabela rola para o lado por dentro, com a
                            coluna Indicador parada à esquerda */}
                        <CardContent>
                            <Table primeiraColunaFixa>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead className="min-w-[9rem] sm:min-w-[180px]">Indicador</TableHead>
                                        {dados.periodo.meses.map(m => <TableHead key={m} className="text-right">{rotuloMes(m)}</TableHead>)}
                                        <TableHead className="text-right">Total</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {previa.map(l => (
                                        <TableRow key={l.rotulo}>
                                            <TableCell className={l.sub ? "pl-8 text-muted-foreground whitespace-normal" : "font-medium whitespace-normal"}>{l.rotulo}</TableCell>
                                            {l.valores.map((v, i) => <TableCell key={i} className="text-right tabular-nums">{v.toLocaleString("pt-BR")}</TableCell>)}
                                            <TableCell className="text-right font-semibold tabular-nums">{l.total.toLocaleString("pt-BR")}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    )
}
