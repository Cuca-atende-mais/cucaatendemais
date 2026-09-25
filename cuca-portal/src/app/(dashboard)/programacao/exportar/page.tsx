"use client"

import { useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { AlertTriangle, FileSpreadsheet, Loader2, Lock } from "lucide-react"
import toast from "react-hot-toast"
import { cn } from "@/lib/utils"
import { MESES_NOME_EXPORTACAO } from "@/lib/programacao/exportacao"
import {
    montarAbasConsolidadas, nomeArquivoConsolidado, type AtividadeConsolidada,
} from "@/lib/programacao/exportacao-consolidada"
import { ROTULO_STATUS_CATEGORIA, type StatusCategoria } from "@/lib/programacao/permissoes-categoria"
import { useChecarPgm } from "@/lib/programacao/use-checar-pgm"
import { useUser } from "@/lib/auth/user-provider"
import { PGM_EXPORTACAO_CONSOLIDADA } from "@/lib/rbac/catalogo-programacao-mensal"

// S-PROG-18: tela "Exportar planilha" — uma planilha por unidade com as 4 categorias em abas, no
// visual da planilha da PICI. Mostra e exporta a programação em qualquer status (rascunho,
// aguardando autorização, autorizada). O que se vê na tabela é exatamente o que vai para o arquivo.

interface RespostaExportacao {
    unidades: string[]
    unidade: string | null
    status: Record<string, StatusCategoria | null>
    atividades: AtividadeConsolidada[]
    podeExportar: boolean
}

// Padrão pedido pelo Junior: Outubro/2026. O seletor permite os outros meses.
const MES_PADRAO = 10
const ANO_PADRAO = 2026
const ANOS = [2025, 2026, 2027]

const CORES_STATUS: Record<StatusCategoria, string> = {
    rascunho: "bg-slate-100 text-slate-700 border-slate-300",
    aguardando_autorizacao: "bg-amber-100 text-amber-800 border-amber-300",
    autorizada: "bg-emerald-100 text-emerald-800 border-emerald-300",
}

export default function ExportarPlanilhaPage() {
    const { loading: carregandoUsuario } = useUser()
    const checar = useChecarPgm()
    const podeVer = checar(PGM_EXPORTACAO_CONSOLIDADA.ver, "read")

    const [mes, setMes] = useState(MES_PADRAO)
    const [ano, setAno] = useState(ANO_PADRAO)
    const [unidade, setUnidade] = useState<string | null>(null)
    const [dados, setDados] = useState<RespostaExportacao | null>(null)
    const [carregando, setCarregando] = useState(false)
    const [erro, setErro] = useState<string | null>(null)
    const [exportando, setExportando] = useState(false)

    useEffect(() => {
        if (carregandoUsuario || !podeVer) return
        let cancelado = false
        const carregar = async () => {
            setCarregando(true)
            setErro(null)
            try {
                const params = new URLSearchParams({ mes: String(mes), ano: String(ano) })
                if (unidade) params.set("unidade", unidade)
                const res = await fetch(`/api/programacao/exportacao-consolidada?${params}`)
                const json = await res.json()
                if (!res.ok) throw new Error(json.error || "Falha ao carregar")
                if (cancelado) return
                setDados(json as RespostaExportacao)
                // A rota devolve a unidade efetiva (a pedida, se estiver ao alcance, ou a primeira).
                if (json.unidade !== unidade) setUnidade(json.unidade)
            } catch (e) {
                if (!cancelado) setErro(e instanceof Error ? e.message : String(e))
            } finally {
                if (!cancelado) setCarregando(false)
            }
        }
        carregar()
        return () => { cancelado = true }
    }, [mes, ano, unidade, podeVer, carregandoUsuario])

    const abas = useMemo(
        () => dados?.unidade ? montarAbasConsolidadas(dados.unidade, mes, ano, dados.atividades) : [],
        [dados, mes, ano],
    )
    const totalAtividades = abas.reduce((s, a) => s + a.linhas.length, 0)
    const temNaoAutorizada = abas.some(a => a.linhas.length > 0 && dados?.status[a.categoria] !== "autorizada")

    const handleExportar = async () => {
        if (!dados?.unidade) return
        setExportando(true)
        try {
            const { gerarXlsxConsolidado } = await import("@/lib/programacao/gerar-xlsx-consolidado")
            const buffer = await gerarXlsxConsolidado(abas)
            const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
            const url = URL.createObjectURL(blob)
            const link = document.createElement("a")
            link.href = url
            link.download = nomeArquivoConsolidado(dados.unidade, mes, ano)
            link.click()
            URL.revokeObjectURL(url)
            toast.success("Planilha exportada")
        } catch (e) {
            console.error("Error in exportar planilha consolidada:", e)
            toast.error("Não foi possível gerar a planilha")
        } finally {
            setExportando(false)
        }
    }

    if (carregandoUsuario) {
        return <Skeleton className="h-64 w-full" />
    }

    if (!podeVer) {
        return (
            <Card>
                <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
                    <Lock className="h-8 w-8 text-muted-foreground" />
                    <p className="font-medium">Você não tem acesso à exportação consolidada.</p>
                    <p className="text-sm text-muted-foreground">Peça a liberação no seu perfil de acesso.</p>
                </CardContent>
            </Card>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
                        <FileSpreadsheet className="h-7 w-7 text-cuca-blue" />
                        Exportar planilha
                    </h1>
                    <p className="text-muted-foreground mt-1">
                        Programação do mês por unidade, com Esportes, Cursos, Dia a Dia e Especiais em abas —
                        autorizada ou não.
                    </p>
                </div>
                {dados?.podeExportar && (
                    <Button onClick={handleExportar} disabled={exportando || carregando || totalAtividades === 0} className="gap-2">
                        {exportando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />}
                        Exportar planilha (.xlsx)
                    </Button>
                )}
            </div>

            <div className="flex flex-wrap items-end gap-3">
                <div className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">Mês</span>
                    <Select value={String(mes)} onValueChange={v => setMes(Number(v))}>
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {MESES_NOME_EXPORTACAO.slice(1).map((nome, i) => (
                                <SelectItem key={nome} value={String(i + 1)}>{nome}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">Ano</span>
                    <Select value={String(ano)} onValueChange={v => setAno(Number(v))}>
                        <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {ANOS.map(a => <SelectItem key={a} value={String(a)}>{a}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                <div className="space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">Unidade</span>
                    <Select
                        value={unidade ?? ""}
                        onValueChange={v => setUnidade(v)}
                        disabled={!dados || dados.unidades.length <= 1}
                    >
                        <SelectTrigger className="w-56"><SelectValue placeholder="Sem programação no mês" /></SelectTrigger>
                        <SelectContent>
                            {(dados?.unidades ?? []).map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                        </SelectContent>
                    </Select>
                </div>
                {carregando && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground mb-2" />}
            </div>

            {erro && (
                <Card className="border-destructive/40">
                    <CardContent className="py-4 text-sm text-destructive">{erro}</CardContent>
                </Card>
            )}

            {!erro && dados && !dados.unidade && (
                <Card>
                    <CardContent className="py-16 text-center text-muted-foreground">
                        Nenhuma programação cadastrada para {MESES_NOME_EXPORTACAO[mes]}/{ano} nas unidades ao seu alcance.
                    </CardContent>
                </Card>
            )}

            {!erro && dados?.unidade && (
                <>
                    {temNaoAutorizada && (
                        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                            <AlertTriangle className="h-4 w-4 shrink-0" />
                            Contém programação ainda não autorizada — a planilha sai com o que está cadastrado agora.
                        </div>
                    )}

                    <Tabs defaultValue={abas[0]?.categoria} className="w-full">
                        <TabsList className="bg-muted/50 p-1 flex-wrap h-auto">
                            {abas.map(aba => (
                                <TabsTrigger key={aba.categoria} value={aba.categoria} className="gap-2">
                                    {aba.categoria}
                                    <Badge variant="secondary" className="px-1.5">{aba.linhas.length}</Badge>
                                </TabsTrigger>
                            ))}
                        </TabsList>

                        {abas.map(aba => {
                            const status = dados.status[aba.categoria]
                            return (
                                <TabsContent key={aba.categoria} value={aba.categoria} className="mt-4 space-y-3">
                                    <div className="flex items-center justify-between gap-3 flex-wrap">
                                        <div className="text-sm text-muted-foreground">
                                            Aba <span className="font-medium text-foreground">{aba.nomeAba}</span> · {aba.titulo}
                                        </div>
                                        <Badge variant="outline" className={cn("font-medium", status ? CORES_STATUS[status] : "text-muted-foreground")}>
                                            {status ? ROTULO_STATUS_CATEGORIA[status] : "Sem programação"}
                                        </Badge>
                                    </div>

                                    {aba.linhas.length === 0 ? (
                                        <Card>
                                            <CardContent className="py-12 text-center text-muted-foreground text-sm">
                                                Nenhuma atividade de {aba.categoria} neste mês. A aba sai na planilha só com o título e o cabeçalho.
                                            </CardContent>
                                        </Card>
                                    ) : (
                                        <div className="rounded-md border overflow-auto max-h-[65vh]">
                                            <table className="w-full text-sm border-collapse">
                                                <thead className="sticky top-0 z-10">
                                                    <tr>
                                                        {aba.colunas.map(c => (
                                                            <th
                                                                key={c.titulo}
                                                                className="px-3 py-2 text-left font-semibold whitespace-nowrap border-b text-black"
                                                                style={{ backgroundColor: `#${aba.cores.cabecalho}` }}
                                                            >
                                                                {c.titulo}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {aba.linhas.map((linha, i) => (
                                                        <tr key={i} className="border-b last:border-0 hover:bg-muted/40">
                                                            {linha.map((valor, j) => (
                                                                <td
                                                                    key={j}
                                                                    title={valor}
                                                                    className={cn(
                                                                        "px-3 py-2 align-top",
                                                                        aba.colunas[j]?.textoLongo ? "max-w-[22rem] truncate" : "whitespace-nowrap",
                                                                    )}
                                                                >
                                                                    {valor}
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </TabsContent>
                            )
                        })}
                    </Tabs>
                </>
            )}
        </div>
    )
}
