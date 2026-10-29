"use client"

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import toast from "react-hot-toast"
import { AlertTriangle, ArrowDown, ArrowUp, ArrowUpDown, Copy, LayoutGrid, List, Lock, Pencil, Plus, Search } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/lib/auth/user-provider"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Aviso } from "@/components/planejamento/projeto-form"
import { ICONE_STATUS, StatusBadge } from "@/components/planejamento/status-projeto"
import { PLA_PROJ } from "@/lib/rbac/catalogo-planejamento"
import {
    ANO_PLANEJAMENTO, SITUACOES_2026, STATUS_PROJETO, TIPOS_PROJETO, formatarReais, mostrarSeloFichaEmConstrucao,
    rotuloSituacao, rotuloTipo, type StatusProjeto,
} from "@/lib/planejamento/projeto"
import {
    CHAVE_VISUALIZACAO, FILTROS_VAZIOS, LIMITE_BUSCA, MESES, ORDENACAO_PADRAO, alternarOrdenacao, alternarStatus, aplicarFiltros,
    contarPorStatus, etiquetaSetores, filtrosDaUrl, filtrosParaUrl, lerVisualizacao, mostrarFiltroSetor, ordenar,
    rotuloPeriodo, temFiltroAtivo, type ColunaOrdenacao, type Filtros, type Ordenacao, type ProjetoLista, type Visualizacao,
} from "@/lib/planejamento/lista"
import { rotaDepoisDeDuplicar } from "@/lib/planejamento/status"
import { carregarLista, carregarSetores, carregarSetoresPermitidos, dataHoraFortaleza, duplicarProjeto, type Setor } from "@/lib/planejamento/projeto-dados"

// S-PLA-03 (AC1 a AC8): lista de projetos do Planejamento 2027. Filtros na URL (link compartilhável e
// "voltar" do navegador mantém a lista), contadores por status, cards ou tabela.

const TODOS = "__todos__"
const urlProjeto = (id: string) => `/planejamento/projeto/${id}`
const numeroBR = (n: number | null) => (n === null ? "—" : n.toLocaleString("pt-BR"))

// Escolha cards/tabela guardada no navegador. No servidor (e na 1ª pintura) vale "cards"; sem
// armazenamento disponível, a escolha vale só nesta visita (fica em memória).
const ouvintesVisualizacao = new Set<() => void>()
let visualizacaoEmMemoria: Visualizacao = "cards"
function assinarVisualizacao(avisar: () => void) {
    ouvintesVisualizacao.add(avisar)
    window.addEventListener("storage", avisar)
    return () => { ouvintesVisualizacao.delete(avisar); window.removeEventListener("storage", avisar) }
}
function lerVisualizacaoGuardada(): Visualizacao {
    try { return lerVisualizacao(window.localStorage.getItem(CHAVE_VISUALIZACAO)) } catch { return visualizacaoEmMemoria }
}
function guardarVisualizacao(v: Visualizacao) {
    visualizacaoEmMemoria = v
    try { window.localStorage.setItem(CHAVE_VISUALIZACAO, v) } catch { /* sem armazenamento: fica em memória */ }
    ouvintesVisualizacao.forEach(avisar => avisar())
}

export function ListaProjetos() {
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const supabase = useMemo(() => createClient(), [])
    const { loading: carregandoUsuario, hasPermission } = useUser()
    const podeVer = hasPermission(PLA_PROJ.ver, "read")
    const podeCriar = hasPermission(PLA_PROJ.criar, "read")
    const podeEditar = hasPermission(PLA_PROJ.editar, "read")
    const podeDuplicar = hasPermission(PLA_PROJ.duplicar, "read")

    const [projetos, setProjetos] = useState<ProjetoLista[] | null>(null)
    const [setores, setSetores] = useState<Setor[]>([])
    const [permitidos, setPermitidos] = useState<Setor[] | null>(null)
    const [erro, setErro] = useState<string | null>(null)
    const [ordenacao, setOrdenacao] = useState<Ordenacao>(ORDENACAO_PADRAO)
    const [duplicando, setDuplicando] = useState<string | null>(null)

    useEffect(() => {
        if (carregandoUsuario || !podeVer) return
        let cancelado = false
        ;(async () => {
            try {
                const [s, lista] = await Promise.all([carregarSetores(supabase), carregarLista(supabase, ANO_PLANEJAMENTO)])
                const perm = await carregarSetoresPermitidos(supabase, s)
                if (cancelado) return
                setSetores(s)
                setPermitidos(perm)
                setProjetos(lista)
            } catch (e) {
                if (!cancelado) setErro(e instanceof Error ? e.message : String(e))
            }
        })()
        return () => { cancelado = true }
    }, [carregandoUsuario, podeVer, supabase])

    const visualizacao = useSyncExternalStore(assinarVisualizacao, lerVisualizacaoGuardada, () => "cards" as Visualizacao)
    const trocarVisualizacao = guardarVisualizacao

    const idsSetores = useMemo(() => setores.map(s => s.id), [setores])
    const filtros = useMemo(() => filtrosDaUrl(searchParams, idsSetores), [searchParams, idsSetores])
    const atualizarFiltros = useCallback((f: Filtros) => {
        const q = filtrosParaUrl(f)
        router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
    }, [router, pathname])

    // Busca: digita livre e grava na URL depois de uma pausa. Se a URL mudar por fora (voltar do
    // navegador, link), o campo acompanha; a volta do que a própria tela gravou não apaga o que a
    // pessoa continuou digitando.
    const [busca, setBusca] = useState(filtros.busca)
    const [buscaEnviada, setBuscaEnviada] = useState(filtros.busca)
    const [buscaDaUrl, setBuscaDaUrl] = useState(filtros.busca)
    if (filtros.busca !== buscaDaUrl) {
        setBuscaDaUrl(filtros.busca)
        if (filtros.busca !== buscaEnviada.trim()) {
            setBusca(filtros.busca)
            setBuscaEnviada(filtros.busca)
        }
    }
    useEffect(() => {
        // A URL guarda a busca sem espaços nas pontas: comparar já aparado evita regravar sem parar.
        if (busca.trim() === filtros.busca) return
        const t = setTimeout(() => {
            setBuscaEnviada(busca)
            atualizarFiltros({ ...filtros, busca })
        }, 300)
        return () => clearTimeout(t)
    }, [busca, filtros, atualizarFiltros])

    const setorPorId = useMemo(() => new Map(setores.map(s => [s.id, s])), [setores])
    const nomeSetor = (id: string) => setorPorId.get(id)?.nome ?? id

    const duplicar = async (id: string) => {
        setDuplicando(id)
        try {
            const novo = await duplicarProjeto(supabase, id)
            toast.success("Cópia criada")
            router.push(rotaDepoisDeDuplicar(novo, podeEditar))
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e))
            setDuplicando(null)
        }
    }

    if (carregandoUsuario) return <Skeleton className="h-64 w-full" />
    if (!podeVer) {
        return <Aviso icone={<Lock className="h-8 w-8 text-muted-foreground" />} titulo="Você não tem acesso aos projetos do Planejamento." texto="Peça a liberação no seu perfil de acesso." />
    }

    const filtrados = projetos ? ordenar(aplicarFiltros(projetos, filtros), visualizacao === "tabela" ? ordenacao : ORDENACAO_PADRAO, nomeSetor) : []
    const contadores = projetos ? contarPorStatus(projetos, filtros) : null
    const filtroAtivo = temFiltroAtivo(filtros)
    const limpar = () => { setBusca(""); setBuscaEnviada(""); atualizarFiltros(FILTROS_VAZIOS) }
    const acoes = { podeEditar, podeDuplicar, duplicando, duplicar }

    return (
        <div className="space-y-4">
            {/* Cabeçalho (AC1) */}
            <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-1 flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-semibold tracking-tight">Planejamento {ANO_PLANEJAMENTO}</h1>
                    {permitidos && (etiquetaSetores(permitidos.length, setores.length) === "todos"
                        ? <Badge variant="secondary">Todos os setores</Badge>
                        : permitidos.map(s => <Badge key={s.id} className="text-white" style={{ backgroundColor: s.cor }}>{s.nome}</Badge>))}
                </div>
                {podeCriar && (
                    <Button asChild><Link href="/planejamento/novo"><Plus className="mr-1 h-4 w-4" /> Novo Projeto</Link></Button>
                )}
            </div>

            {erro ? (
                <Aviso icone={<AlertTriangle className="h-8 w-8 text-rose-600" />} titulo="Não foi possível carregar os projetos." texto={erro} />
            ) : projetos === null || contadores === null ? (
                <Skeleton className="h-64 w-full" />
            ) : projetos.length === 0 ? (
                <Aviso
                    titulo={`Nenhum projeto cadastrado para ${ANO_PLANEJAMENTO}`}
                    acao={podeCriar ? <Button asChild><Link href="/planejamento/novo"><Plus className="mr-1 h-4 w-4" /> Criar o primeiro projeto</Link></Button> : undefined}
                />
            ) : (
                <>
                    {/* Contadores (AC2) */}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                        <Contador rotulo="Total" valor={contadores.total} ativo={filtros.status === ""} onClick={() => atualizarFiltros({ ...filtros, status: "" })} />
                        {STATUS_PROJETO.map(s => (
                            <Contador
                                key={s.valor}
                                rotulo={s.rotulo}
                                status={s.valor}
                                valor={contadores[s.valor]}
                                ativo={filtros.status === s.valor}
                                onClick={() => atualizarFiltros(alternarStatus(filtros, s.valor))}
                            />
                        ))}
                    </div>

                    {/* Filtros (AC3) e alternância cards/tabela (AC4) */}
                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative w-full sm:w-64">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden />
                            <Input className="pl-8" placeholder="Buscar por nome" maxLength={LIMITE_BUSCA} value={busca} onChange={e => setBusca(e.target.value)} aria-label="Buscar por nome" />
                        </div>
                        {permitidos && mostrarFiltroSetor(permitidos.length) && (
                            <Filtro rotulo="Setor" valor={filtros.setor} onChange={v => atualizarFiltros({ ...filtros, setor: v })}
                                opcoes={permitidos.map(s => ({ valor: s.id, rotulo: s.nome }))} />
                        )}
                        <Filtro rotulo="Status" valor={filtros.status} onChange={v => atualizarFiltros({ ...filtros, status: v as Filtros["status"] })}
                            opcoes={STATUS_PROJETO.map(s => ({ valor: s.valor, rotulo: s.rotulo }))} />
                        <Filtro rotulo="Situação 2026" valor={filtros.situacao} onChange={v => atualizarFiltros({ ...filtros, situacao: v as Filtros["situacao"] })}
                            opcoes={SITUACOES_2026.map(s => ({ valor: s.valor, rotulo: s.rotulo }))} />
                        <Filtro rotulo="Tipo" valor={filtros.tipo} onChange={v => atualizarFiltros({ ...filtros, tipo: v as Filtros["tipo"] })}
                            opcoes={TIPOS_PROJETO.map(s => ({ valor: s.valor, rotulo: s.rotulo }))} />
                        <Filtro rotulo="Mês" valor={filtros.mes === "" ? "" : String(filtros.mes)}
                            onChange={v => atualizarFiltros({ ...filtros, mes: v === "" ? "" : v === "ano_todo" ? "ano_todo" : Number(v) })}
                            opcoes={[...MESES.map((m, i) => ({ valor: String(i + 1), rotulo: m })), { valor: "ano_todo", rotulo: "Ano todo" }]} />
                        {filtroAtivo && <Button variant="ghost" onClick={limpar}>Limpar filtros</Button>}
                        <div className="ml-auto flex gap-1" role="group" aria-label="Visualização">
                            <Button variant={visualizacao === "cards" ? "secondary" : "ghost"} size="icon" title="Cards" aria-pressed={visualizacao === "cards"} onClick={() => trocarVisualizacao("cards")}>
                                <LayoutGrid className="h-4 w-4" />
                            </Button>
                            <Button variant={visualizacao === "tabela" ? "secondary" : "ghost"} size="icon" title="Tabela" aria-pressed={visualizacao === "tabela"} onClick={() => trocarVisualizacao("tabela")}>
                                <List className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>

                    {filtrados.length === 0 ? (
                        <Aviso titulo="Nenhum projeto com esses filtros" acao={<Button variant="outline" onClick={limpar}>Limpar filtros</Button>} />
                    ) : visualizacao === "cards" ? (
                        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {filtrados.map(p => <CardProjeto key={p.id} p={p} setor={setorPorId.get(p.setor_id)} {...acoes} />)}
                        </div>
                    ) : (
                        <TabelaProjetos
                            linhas={filtrados} setorPorId={setorPorId} ordenacao={ordenacao}
                            onOrdenar={c => setOrdenacao(o => alternarOrdenacao(o, c))} {...acoes}
                        />
                    )}
                </>
            )}
        </div>
    )
}

function Contador({ rotulo, valor, ativo, status, onClick }: { rotulo: string; valor: number; ativo: boolean; status?: StatusProjeto; onClick: () => void }) {
    const Icone = status ? ICONE_STATUS[status] : null
    return (
        <button
            type="button"
            onClick={onClick}
            aria-pressed={ativo}
            className={cn(
                "rounded-lg border bg-card px-3 py-2 text-left transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                ativo && "border-primary ring-2 ring-primary/40",
            )}
        >
            <span className="flex items-center gap-1 text-xs text-muted-foreground">{Icone && <Icone className="h-3.5 w-3.5" aria-hidden />}{rotulo}</span>
            <span className="text-2xl font-semibold tabular-nums">{valor}</span>
        </button>
    )
}

function Filtro({ rotulo, valor, opcoes, onChange }: {
    rotulo: string; valor: string; opcoes: { valor: string; rotulo: string }[]; onChange: (v: string) => void
}) {
    return (
        <Select value={valor === "" ? TODOS : valor} onValueChange={v => onChange(v === TODOS ? "" : v)}>
            <SelectTrigger className={cn("w-full sm:w-44", valor !== "" && "border-primary")} aria-label={rotulo}>
                <SelectValue placeholder={rotulo} />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value={TODOS}>{rotulo}: todos</SelectItem>
                {opcoes.map(o => <SelectItem key={o.valor} value={o.valor}>{o.rotulo}</SelectItem>)}
            </SelectContent>
        </Select>
    )
}

type Acoes = { podeEditar: boolean; podeDuplicar: boolean; duplicando: string | null; duplicar: (id: string) => void }

// Atalhos (AC6) ficam acima do link que cobre o card/linha, para não abrirem o projeto.
function Atalhos({ p, podeEditar, podeDuplicar, duplicando, duplicar }: { p: ProjetoLista } & Acoes) {
    if (!podeEditar && !podeDuplicar) return null
    return (
        <div className="relative z-10 flex shrink-0 gap-1">
            {podeEditar && (
                <Button asChild variant="ghost" size="icon" title="Editar">
                    <Link href={`${urlProjeto(p.id)}/editar`} aria-label={`Editar ${p.nome}`}><Pencil className="h-4 w-4" /></Link>
                </Button>
            )}
            {podeDuplicar && (
                <Button variant="ghost" size="icon" title="Duplicar" aria-label={`Duplicar ${p.nome}`}
                    disabled={duplicando !== null} onClick={() => duplicar(p.id)}>
                    <Copy className="h-4 w-4" />
                </Button>
            )}
        </div>
    )
}

function CardProjeto({ p, setor, ...acoes }: { p: ProjetoLista; setor?: Setor } & Acoes) {
    const periodo = rotuloPeriodo(p)
    return (
        <Card className="relative transition hover:shadow-md focus-within:ring-2 focus-within:ring-ring">
            <CardContent className="space-y-3 p-4">
                <div className="flex items-start gap-2">
                    <h2 className="flex-1 text-base font-semibold leading-snug">
                        {/* Link que cobre o card inteiro (AC5): clique em qualquer ponto e "abrir em nova aba". */}
                        <Link href={urlProjeto(p.id)} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none">{p.nome}</Link>
                    </h2>
                    <Atalhos p={p} {...acoes} />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                    {setor ? <Badge className="text-white" style={{ backgroundColor: setor.cor }}>{setor.nome}</Badge> : <Badge variant="outline">{p.setor_id}</Badge>}
                    <Badge variant="outline">{rotuloTipo(p.tipo)}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={p.status} />
                    {p.situacao_2026 && <Badge variant="secondary">2026: {rotuloSituacao(p.situacao_2026)}</Badge>}
                    {mostrarSeloFichaEmConstrucao(p.status, p.ficha) && (
                        <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">Ficha em construção</Badge>
                    )}
                </div>
                <dl className="grid grid-cols-3 gap-2 text-sm">
                    <div><dt className="text-xs text-muted-foreground">Período</dt><dd>{periodo || "—"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Participantes</dt><dd className="tabular-nums">{numeroBR(p.participantes_estimados)}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Orçamento</dt><dd className="tabular-nums">{formatarReais(p.orcamento_total)}</dd></div>
                </dl>
            </CardContent>
        </Card>
    )
}

function Cabecalho({ coluna, children, className, ordenacao, onOrdenar }: {
    coluna: ColunaOrdenacao; children: string; className?: string; ordenacao: Ordenacao; onOrdenar: (c: ColunaOrdenacao) => void
}) {
    const ativa = ordenacao.coluna === coluna
    const Icone = !ativa ? ArrowUpDown : ordenacao.direcao === "asc" ? ArrowUp : ArrowDown
    return (
        <TableHead className={className} aria-sort={ativa ? (ordenacao.direcao === "asc" ? "ascending" : "descending") : "none"}>
            <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => onOrdenar(coluna)}>
                {children} <Icone className="h-3.5 w-3.5" aria-hidden />
            </button>
        </TableHead>
    )
}

function TabelaProjetos({ linhas, setorPorId, ordenacao, onOrdenar, ...acoes }: {
    linhas: ProjetoLista[]; setorPorId: Map<string, Setor>; ordenacao: Ordenacao; onOrdenar: (c: ColunaOrdenacao) => void
} & Acoes) {
    const o = { ordenacao, onOrdenar }
    return (
        <Card>
            <CardContent className="p-0">
                <Table>
                    <TableHeader>
                        <TableRow>
                            <Cabecalho {...o} coluna="nome">Nome</Cabecalho>
                            <Cabecalho {...o} coluna="setor">Setor</Cabecalho>
                            <TableHead>Tipo</TableHead>
                            <Cabecalho {...o} coluna="status">Status</Cabecalho>
                            <TableHead>Situação 2026</TableHead>
                            <TableHead>Período</TableHead>
                            <TableHead className="text-right">Participantes</TableHead>
                            <Cabecalho {...o} coluna="orcamento" className="text-right">Orçamento</Cabecalho>
                            <Cabecalho {...o} coluna="atualizado">Atualizado em</Cabecalho>
                            <TableHead className="w-0"><span className="sr-only">Atalhos</span></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {linhas.map(p => {
                            const setor = setorPorId.get(p.setor_id)
                            return (
                                <TableRow key={p.id} className="relative">
                                    <TableCell className="font-medium">
                                        <Link href={urlProjeto(p.id)} className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:underline">{p.nome}</Link>
                                    </TableCell>
                                    <TableCell>{setor ? <Badge className="text-white" style={{ backgroundColor: setor.cor }}>{setor.nome}</Badge> : p.setor_id}</TableCell>
                                    <TableCell>{rotuloTipo(p.tipo)}</TableCell>
                                    <TableCell>
                                        <div className="flex flex-wrap gap-1">
                                            <StatusBadge status={p.status} />
                                            {mostrarSeloFichaEmConstrucao(p.status, p.ficha) && <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">Ficha em construção</Badge>}
                                        </div>
                                    </TableCell>
                                    <TableCell>{rotuloSituacao(p.situacao_2026) || "—"}</TableCell>
                                    <TableCell>{rotuloPeriodo(p) || "—"}</TableCell>
                                    <TableCell className="text-right tabular-nums">{numeroBR(p.participantes_estimados)}</TableCell>
                                    <TableCell className="text-right tabular-nums">{formatarReais(p.orcamento_total)}</TableCell>
                                    <TableCell className="text-muted-foreground">{dataHoraFortaleza(p.updated_at)}</TableCell>
                                    <TableCell><Atalhos p={p} {...acoes} /></TableCell>
                                </TableRow>
                            )
                        })}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    )
}
