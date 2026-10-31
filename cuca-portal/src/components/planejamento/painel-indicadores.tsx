"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { AlertTriangle, ClipboardCheck, Coins, Download, FolderKanban, Lock, Users, type LucideIcon } from "lucide-react"
import toast from "react-hot-toast"
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { useUser } from "@/lib/auth/user-provider"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Aviso } from "@/components/planejamento/projeto-form"
import { ICONE_STATUS } from "@/components/planejamento/status-projeto"
import { PLA_CALENDARIO, PLA_INDIC } from "@/lib/rbac/catalogo-planejamento"
import { ANO_PLANEJAMENTO, SITUACOES_2026, STATUS_PROJETO, TIPOS_PROJETO, formatarReais, rotuloStatus, type StatusProjeto } from "@/lib/planejamento/projeto"
import type { Setor } from "@/lib/planejamento/projeto-dados"
import {
    CHAVES_SITUACAO, FILTROS_INDICADORES_VAZIOS, filtrosIndicadoresParaUrl, linkCelula, linkLista, linkProjeto,
    montarAbasIndicadores, nivelCalor, nomeArquivoIndicadores, rotuloCategoriaOuSem, rotuloMes, rotuloSituacaoOuSem,
    type FiltrosIndicadores, type Indicadores, type ListaCurta, type ProjetoIndicador,
} from "@/lib/planejamento/indicadores"

// S-PLA-08: Painel de Indicadores do Planejamento 2027 (só leitura). Os números chegam prontos da rota
// (agregados no servidor, no escopo de setor do usuário). Filtros no endereço; cada bloco leva à lista,
// ao calendário ou ao projeto.

type Resposta = {
    ano: number
    setores: Setor[]
    filtros: FiltrosIndicadores
    indicadores: Indicadores
    permissoes: { exportar: boolean }
    projetos?: ProjetoIndicador[]
}

const TODOS = "__todos__"

// Cores dos 6 status (as mesmas famílias das etiquetas da S-PLA-03, em tom de gráfico).
const COR_STATUS: Record<StatusProjeto, string> = {
    em_construcao: "#f59e0b",
    projeto_salvo: "#94a3b8",
    aprovado: "#10b981",
    em_execucao: "#3b82f6",
    concluido: "#a855f7",
    reprovado: "#f43f5e",
}
const COR_CATEGORIA: Record<string, string> = {
    material: "#6366f1", espaco: "#0ea5e9", transporte: "#14b8a6", alimentacao: "#f97316",
    divulgacao: "#ec4899", servicos: "#84cc16", outros: "#64748b", sem_categoria: "#cbd5e1",
}
const CALOR = [
    "bg-muted/40 text-muted-foreground",
    "bg-sky-100 text-sky-900",
    "bg-sky-200 text-sky-900",
    "bg-sky-400 text-white",
    "bg-sky-600 text-white",
] as const

const inteiro = (n: number) => n.toLocaleString("pt-BR")
const ESTILO_TOOLTIP = {
    backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "8px",
    fontSize: "12px", color: "hsl(var(--foreground))",
}

async function buscar(q: string): Promise<Resposta> {
    const res = await fetch(`/api/planejamento/indicadores${q ? `?${q}` : ""}`, { cache: "no-store" })
    const corpo = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error((corpo as { error?: string }).error ?? "Não foi possível carregar os indicadores.")
    return corpo as Resposta
}

export function PainelIndicadores() {
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const { loading: carregandoUsuario, hasPermission } = useUser()
    const podeVer = hasPermission(PLA_INDIC.ver, "read")
    const temCalendario = hasPermission(PLA_CALENDARIO.ver, "read")

    const [dados, setDados] = useState<Resposta | null>(null)
    const [erro, setErro] = useState<string | null>(null)
    const [exportando, setExportando] = useState(false)

    // O endereço manda; a rota valida de novo (setor fora do escopo vira "todos").
    const consulta = useMemo(() => {
        const p = new URLSearchParams()
        for (const k of ["setor", "status", "situacao", "tipo"]) {
            const v = searchParams.get(k)
            if (v) p.set(k, v)
        }
        return p.toString()
    }, [searchParams])

    useEffect(() => {
        if (carregandoUsuario || !podeVer) return
        let cancelado = false
        setErro(null)
        buscar(consulta)
            .then(r => { if (!cancelado) setDados(r) })
            .catch(e => { if (!cancelado) setErro(e instanceof Error ? e.message : String(e)) })
        return () => { cancelado = true }
    }, [carregandoUsuario, podeVer, consulta])

    const filtros = dados?.filtros ?? FILTROS_INDICADORES_VAZIOS
    const atualizar = useCallback((f: FiltrosIndicadores) => {
        const q = filtrosIndicadoresParaUrl(f)
        router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
    }, [router, pathname])

    const setorPorId = useMemo(() => new Map((dados?.setores ?? []).map(s => [s.id, s])), [dados])
    const nomeSetor = useCallback((id: string) => setorPorId.get(id)?.nome ?? id, [setorPorId])
    const corSetor = useCallback((id: string) => setorPorId.get(id)?.cor ?? "#64748b", [setorPorId])
    const todosSetores = useMemo(() => (dados?.setores ?? []).map(s => s.id), [dados])

    const exportar = async () => {
        setExportando(true)
        try {
            const r = await buscar([filtrosIndicadoresParaUrl(filtros), "exportar=1"].filter(Boolean).join("&"))
            const ordem = new Map(r.setores.map(s => [s.id, s.ordem]))
            const nomes = new Map(r.setores.map(s => [s.id, s.nome]))
            const geradoEm = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short", timeStyle: "short" }).format(new Date())
            const abas = montarAbasIndicadores(r.indicadores, r.projetos ?? [], id => nomes.get(id) ?? id, id => ordem.get(id) ?? 99, geradoEm)
            const { gerarXlsxIndicadores } = await import("@/lib/planejamento/gerar-xlsx-indicadores")
            const buffer = await gerarXlsxIndicadores(abas)
            const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" })
            const url = URL.createObjectURL(blob)
            const link = document.createElement("a")
            link.href = url
            link.download = nomeArquivoIndicadores()
            link.click()
            URL.revokeObjectURL(url)
            toast.success("Planilha exportada")
        } catch (e) {
            console.error("Error in exportar indicadores:", e)
            toast.error(e instanceof Error ? e.message : "Não foi possível gerar a planilha")
        } finally {
            setExportando(false)
        }
    }

    if (carregandoUsuario) return <Skeleton className="h-96 w-full" />
    if (!podeVer) {
        return <Aviso icone={<Lock className="h-8 w-8 text-muted-foreground" />} titulo="Você não tem acesso aos Indicadores do Planejamento." texto="Peça a liberação no seu perfil de acesso." />
    }

    const filtroAtivo = filtrosIndicadoresParaUrl(filtros) !== ""
    const ind = dados?.indicadores

    return (
        <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-3">
                <h1 className="mr-auto text-2xl font-semibold tracking-tight">Indicadores {ANO_PLANEJAMENTO}</h1>
                {dados?.permissoes.exportar && (
                    <Button variant="outline" onClick={exportar} disabled={exportando || !ind}>
                        <Download className="mr-2 h-4 w-4" /> {exportando ? "Gerando…" : "Exportar planilha"}
                    </Button>
                )}
            </div>

            {/* Filtros (AC8) */}
            <div className="flex flex-wrap items-center gap-3">
                <Filtro rotulo="Setor" valor={filtros.setor} onChange={v => atualizar({ ...filtros, setor: v })}
                    opcoes={(dados?.setores ?? []).map(s => ({ valor: s.id, rotulo: s.nome }))} />
                <Filtro rotulo="Status" valor={filtros.status} onChange={v => atualizar({ ...filtros, status: v as FiltrosIndicadores["status"] })}
                    opcoes={STATUS_PROJETO.map(s => ({ valor: s.valor, rotulo: s.rotulo }))} />
                <Filtro rotulo="Situação 2026" valor={filtros.situacao} onChange={v => atualizar({ ...filtros, situacao: v as FiltrosIndicadores["situacao"] })}
                    opcoes={SITUACOES_2026.map(s => ({ valor: s.valor, rotulo: s.rotulo }))} />
                <Filtro rotulo="Tipo" valor={filtros.tipo} onChange={v => atualizar({ ...filtros, tipo: v as FiltrosIndicadores["tipo"] })}
                    opcoes={TIPOS_PROJETO.map(t => ({ valor: t.valor, rotulo: t.rotulo }))} />
                {filtroAtivo && <Button variant="ghost" size="sm" onClick={() => atualizar(FILTROS_INDICADORES_VAZIOS)}>Limpar filtros</Button>}
            </div>

            {erro ? (
                <Aviso icone={<AlertTriangle className="h-8 w-8 text-rose-600" />} titulo="Não foi possível carregar os indicadores." texto={erro} />
            ) : !ind ? (
                <Skeleton className="h-96 w-full" />
            ) : (
                <>
                    {/* Cartões (AC2) */}
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                        <Cartao href={linkLista(filtros)} icone={FolderKanban} rotulo="Projetos" valor={inteiro(ind.cartoes.projetos)} />
                        <Cartao href={linkLista(filtros)} icone={Coins} rotulo="Orçamento total estimado" valor={formatarReais(ind.cartoes.orcamento)} />
                        <Cartao href={linkLista(filtros)} icone={Users} rotulo="Participantes estimados" valor={inteiro(ind.cartoes.participantes)} />
                    </div>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                        {STATUS_PROJETO.map(s => (
                            <Cartao key={s.valor} href={linkLista(filtros, { status: s.valor })} icone={ICONE_STATUS[s.valor]}
                                rotulo={s.rotulo} valor={inteiro(ind.cartoes.porStatus[s.valor])} cor={COR_STATUS[s.valor]} compacto />
                        ))}
                    </div>

                    {/* Projetos por setor e status (AC3) */}
                    <Card>
                        <CardHeader className="pb-2"><CardTitle className="text-base">Projetos por setor e status</CardTitle></CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={Math.max(200, ind.setores.length * 44 + 60)}>
                                <BarChart layout="vertical" data={ind.setores.map(l => ({ setor_id: l.setor_id, nome: nomeSetor(l.setor_id), ...l.porStatus }))} margin={{ left: 8, right: 16 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                    <XAxis type="number" allowDecimals={false} fontSize={12} />
                                    <YAxis type="category" dataKey="nome" width={140} fontSize={12} />
                                    <Tooltip contentStyle={ESTILO_TOOLTIP} cursor={{ fillOpacity: 0.1 }} />
                                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                                    {STATUS_PROJETO.map(s => (
                                        <Bar key={s.valor} dataKey={s.valor} name={s.rotulo} stackId="status" fill={COR_STATUS[s.valor]} cursor="pointer"
                                            onClick={(d: unknown) => {
                                                const setor = (d as { payload?: { setor_id?: string } }).payload?.setor_id
                                                if (setor) router.push(linkLista(filtros, { setor }))
                                            }} />
                                    ))}
                                </BarChart>
                            </ResponsiveContainer>
                            <p className="mt-1 text-xs text-muted-foreground">Clique numa barra para abrir a lista de projetos do setor.</p>
                        </CardContent>
                    </Card>

                    {/* Tabela-resumo (AC4) */}
                    <Card>
                        <CardHeader className="pb-2"><CardTitle className="text-base">Resumo por setor</CardTitle></CardHeader>
                        <CardContent className="overflow-x-auto">
                            <TabelaResumo ind={ind} nomeSetor={nomeSetor} corSetor={corSetor} />
                        </CardContent>
                    </Card>

                    {/* Orçamento (AC5) */}
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                        <Card>
                            <CardHeader className="pb-2"><CardTitle className="text-base">Orçamento por setor</CardTitle></CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={Math.max(200, ind.setores.length * 40 + 40)}>
                                    <BarChart layout="vertical" data={ind.setores.map(l => ({ setor_id: l.setor_id, nome: nomeSetor(l.setor_id), valor: l.orcamento }))} margin={{ left: 8, right: 16 }}>
                                        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                                        <XAxis type="number" fontSize={11} tickFormatter={(v: number) => v.toLocaleString("pt-BR", { notation: "compact" })} />
                                        <YAxis type="category" dataKey="nome" width={140} fontSize={12} />
                                        <Tooltip contentStyle={ESTILO_TOOLTIP} cursor={{ fillOpacity: 0.1 }} formatter={(v: unknown) => formatarReais(Number(v))} />
                                        <Bar dataKey="valor" name="Orçamento" cursor="pointer"
                                            onClick={(d: unknown) => {
                                                const setor = (d as { payload?: { setor_id?: string } }).payload?.setor_id
                                                if (setor) router.push(linkLista(filtros, { setor }))
                                            }}>
                                            {ind.setores.map(l => <Cell key={l.setor_id} fill={corSetor(l.setor_id)} />)}
                                        </Bar>
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader className="pb-2"><CardTitle className="text-base">Orçamento por categoria</CardTitle></CardHeader>
                            <CardContent>
                                {ind.cartoes.orcamento > 0 ? (
                                    <ResponsiveContainer width="100%" height={260}>
                                        <PieChart>
                                            <Pie data={ind.orcamentoPorCategoria.filter(c => c.valor > 0).map(c => ({ name: rotuloCategoriaOuSem(c.categoria), value: c.valor, categoria: c.categoria }))}
                                                dataKey="value" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={2} strokeWidth={0}>
                                                {ind.orcamentoPorCategoria.filter(c => c.valor > 0).map(c => <Cell key={c.categoria} fill={COR_CATEGORIA[c.categoria] ?? "#94a3b8"} />)}
                                            </Pie>
                                            <Tooltip contentStyle={ESTILO_TOOLTIP} formatter={(v: unknown) => formatarReais(Number(v))} />
                                            <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <p className="py-16 text-center text-sm text-muted-foreground">Nenhum orçamento informado {filtroAtivo ? "neste recorte" : "ainda"}.</p>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Acompanhamento (AC6) */}
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                        <ListaAcompanhamento titulo="Correção pedida em aberto" lista={ind.acompanhamento.correcoesAbertas} nomeSetor={nomeSetor}
                            vazio="Nenhum projeto com correção em aberto." detalhe={i => `${i.correcoes} ${i.correcoes === 1 ? "correção" : "correções"}`}
                            verTodos={linkLista(filtros, { correcao: "abertas" })} />
                        <ListaAcompanhamento titulo="Ainda não validados" lista={ind.acompanhamento.naoValidados} nomeSetor={nomeSetor}
                            vazio="Todos os projetos estão validados." verTodos={linkLista(filtros, { validacao: "nao_validados" })} />
                        <Card>
                            <CardHeader className="pb-2"><CardTitle className="text-base">Setores sem projeto{filtroAtivo ? " (neste recorte)" : ""}</CardTitle></CardHeader>
                            <CardContent>
                                {ind.acompanhamento.setoresSemProjeto.length === 0 ? (
                                    <p className="text-sm text-muted-foreground">Todos os setores têm projeto cadastrado.</p>
                                ) : (
                                    <ul className="space-y-1.5">
                                        {ind.acompanhamento.setoresSemProjeto.map(s => (
                                            <li key={s} className="flex items-center gap-2 text-sm">
                                                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: corSetor(s) }} aria-hidden />
                                                {nomeSetor(s)}
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Visão mensal (AC7) */}
                    <Card>
                        <CardHeader className="pb-2"><CardTitle className="text-base">Visão mensal {ANO_PLANEJAMENTO}</CardTitle></CardHeader>
                        <CardContent className="overflow-x-auto">
                            <table className="w-full min-w-[560px] border-separate border-spacing-1 text-sm">
                                <thead>
                                    <tr>
                                        <th className="text-left font-medium text-muted-foreground">Mês</th>
                                        {ind.setores.map(l => (
                                            <th key={l.setor_id} className="px-1 text-center text-xs font-medium">
                                                <span className="inline-flex items-center gap-1">
                                                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: corSetor(l.setor_id) }} aria-hidden />
                                                    {nomeSetor(l.setor_id)}
                                                </span>
                                            </th>
                                        ))}
                                        <th className="text-center text-xs font-medium text-muted-foreground">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {ind.visaoMensal.linhas.map(l => (
                                        <tr key={String(l.mes)}>
                                            <td className={cn("whitespace-nowrap pr-2", l.mes === "ano_todo" && "font-medium")}>{rotuloMes(l.mes)}</td>
                                            {ind.setores.map(s => {
                                                const v = l.porSetor[s.setor_id] ?? 0
                                                return (
                                                    <td key={s.setor_id} className="p-0">
                                                        <Link href={linkCelula(l.mes, s.setor_id, filtros, todosSetores, temCalendario)}
                                                            className={cn("block rounded py-1.5 text-center tabular-nums transition hover:ring-2 hover:ring-primary", CALOR[nivelCalor(v, ind.visaoMensal.maximo)])}
                                                            title={`${nomeSetor(s.setor_id)} · ${rotuloMes(l.mes)}: ${v} ${v === 1 ? "atividade" : "atividades"}`}>
                                                            {v}
                                                        </Link>
                                                    </td>
                                                )
                                            })}
                                            <td className="text-center tabular-nums text-muted-foreground">{l.total}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <p className="mt-2 text-xs text-muted-foreground">
                                Um projeto conta em todos os meses do seu período. {ind.visaoMensal.semPeriodo > 0 && `${ind.visaoMensal.semPeriodo} sem período definido (fora da grade). `}
                                Clique numa célula para abrir {temCalendario ? "o Calendário naquele mês e setor" : "a lista de projetos daquele mês e setor"}.
                            </p>
                        </CardContent>
                    </Card>
                </>
            )}
        </div>
    )
}

function Filtro({ rotulo, valor, opcoes, onChange }: { rotulo: string; valor: string; opcoes: { valor: string; rotulo: string }[]; onChange: (v: string) => void }) {
    return (
        <Select value={valor === "" ? TODOS : valor} onValueChange={v => onChange(v === TODOS ? "" : v)}>
            <SelectTrigger className={cn("w-full sm:w-48", valor !== "" && "border-primary")} aria-label={rotulo}><SelectValue placeholder={rotulo} /></SelectTrigger>
            <SelectContent>
                <SelectItem value={TODOS}>{rotulo}: todos</SelectItem>
                {opcoes.map(o => <SelectItem key={o.valor} value={o.valor}>{o.rotulo}</SelectItem>)}
            </SelectContent>
        </Select>
    )
}

function Cartao({ href, icone: Icone, rotulo, valor, cor, compacto }: { href: string; icone: LucideIcon; rotulo: string; valor: string; cor?: string; compacto?: boolean }) {
    return (
        <Link href={href} className="block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <Card className="h-full transition hover:border-primary/60 hover:shadow-sm" style={cor ? { borderLeft: `4px solid ${cor}` } : undefined}>
                <CardContent className={cn("flex items-center gap-3", compacto ? "p-3" : "p-4")}>
                    <Icone className={cn("shrink-0 text-muted-foreground", compacto ? "h-4 w-4" : "h-6 w-6")} style={cor ? { color: cor } : undefined} aria-hidden />
                    <div className="min-w-0">
                        <p className={cn("truncate text-muted-foreground", compacto ? "text-xs" : "text-sm")}>{rotulo}</p>
                        <p className={cn("font-semibold tabular-nums", compacto ? "text-xl" : "text-2xl")}>{valor}</p>
                    </div>
                </CardContent>
            </Card>
        </Link>
    )
}

function TabelaResumo({ ind, nomeSetor, corSetor }: { ind: Indicadores; nomeSetor: (id: string) => string; corSetor: (id: string) => string }) {
    const linhas = [...ind.setores, ind.total]
    return (
        <table className="w-full min-w-[820px] text-sm">
            <thead>
                <tr className="border-b text-xs text-muted-foreground">
                    <th className="py-2 text-left font-medium">Setor</th>
                    <th className="py-2 text-right font-medium">Projetos</th>
                    {CHAVES_SITUACAO.map(s => <th key={s} className="py-2 text-right font-medium">{rotuloSituacaoOuSem(s)}</th>)}
                    <th className="py-2 text-right font-medium">Participantes</th>
                    <th className="py-2 text-right font-medium">Orçamento</th>
                    <th className="py-2 text-right font-medium">{rotuloStatus("aprovado")}s</th>
                    <th className="py-2 text-right font-medium">{rotuloStatus("em_execucao")}</th>
                </tr>
            </thead>
            <tbody>
                {linhas.map(l => {
                    const total = l.setor_id === "total"
                    return (
                        <tr key={l.setor_id} className={cn("border-b last:border-0", total && "bg-muted/40 font-semibold")}>
                            <td className="py-2">
                                {total ? "Total" : (
                                    <span className="inline-flex items-center gap-2">
                                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: corSetor(l.setor_id) }} aria-hidden />
                                        {nomeSetor(l.setor_id)}
                                    </span>
                                )}
                            </td>
                            <td className="py-2 text-right tabular-nums">{inteiro(l.projetos)}</td>
                            {CHAVES_SITUACAO.map(s => <td key={s} className="py-2 text-right tabular-nums">{inteiro(l.porSituacao[s])}</td>)}
                            <td className="py-2 text-right tabular-nums">{inteiro(l.participantes)}</td>
                            <td className="py-2 text-right tabular-nums">{formatarReais(l.orcamento)}</td>
                            <td className="py-2 text-right tabular-nums">{inteiro(l.porStatus.aprovado)}</td>
                            <td className="py-2 text-right tabular-nums">{inteiro(l.porStatus.em_execucao)}</td>
                        </tr>
                    )
                })}
            </tbody>
        </table>
    )
}

function ListaAcompanhamento({ titulo, lista, nomeSetor, vazio, detalhe, verTodos }: {
    titulo: string; lista: ListaCurta; nomeSetor: (id: string) => string; vazio: string
    detalhe?: (i: ListaCurta["itens"][number]) => string; verTodos: string
}) {
    return (
        <Card>
            <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                    <ClipboardCheck className="h-4 w-4 text-muted-foreground" aria-hidden /> {titulo}
                    <span className="ml-auto text-sm font-normal tabular-nums text-muted-foreground">{lista.total}</span>
                </CardTitle>
            </CardHeader>
            <CardContent>
                {lista.total === 0 ? (
                    <p className="text-sm text-muted-foreground">{vazio}</p>
                ) : (
                    <ul className="space-y-1.5">
                        {lista.itens.map(i => (
                            <li key={i.id} className="text-sm">
                                <Link href={linkProjeto(i.id)} className="font-medium hover:underline">{i.nome}</Link>
                                <span className="text-muted-foreground"> · {nomeSetor(i.setor_id)}{detalhe ? ` · ${detalhe(i)}` : ""}</span>
                            </li>
                        ))}
                        {lista.total > lista.itens.length && (
                            <li className="pt-1 text-sm">
                                <Link href={verTodos} className="text-primary hover:underline">Ver todos os {lista.total}</Link>
                            </li>
                        )}
                    </ul>
                )}
            </CardContent>
        </Card>
    )
}
