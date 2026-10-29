"use client"

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { AlertTriangle, ArrowLeft, CalendarRange, ChevronLeft, ChevronRight, Lock } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/lib/auth/user-provider"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Aviso } from "@/components/planejamento/projeto-form"
import { PLA_CALENDARIO } from "@/lib/rbac/catalogo-planejamento"
import { ANO_PLANEJAMENTO, STATUS_PROJETO, TIPOS_PROJETO } from "@/lib/planejamento/projeto"
import { MESES, rotuloPeriodo } from "@/lib/planejamento/lista"
import { corTextoSobre } from "@/lib/planejamento/slides"
import {
    DIAS_SEMANA_CURTOS, alternarSetor, aplicarFiltrosCalendario, diaDaSemana, diasNoMes, distribuirAno, filtrosCalendarioDaUrl,
    filtrosCalendarioParaUrl, linhasDoMes, mesAnterior, mesSeguinte, type FiltrosCalendario, type ItemMes, type ProjetoCalendario,
} from "@/lib/planejamento/calendario"
import { carregarCalendario } from "@/lib/planejamento/calendario-dados"
import { carregarSetores, carregarSetoresPermitidos, type Setor } from "@/lib/planejamento/projeto-dados"

// S-PLA-07: Calendário 2027 (só leitura). Visão do ano (12 meses, faixas na cor do setor, "Ano todo" no
// topo, "Sem período definido" no fim) e visão de um mês (?mes=6) com os dias de cada projeto. Legenda
// e filtros ficam no endereço. Clicar numa atividade abre a página do projeto.

const TODOS = "__todos__"
const urlProjeto = (id: string) => `/planejamento/projeto/${id}`

export function CalendarioPlanejamento() {
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const supabase = useMemo(() => createClient(), [])
    const { loading: carregandoUsuario, hasPermission } = useUser()
    const podeVer = hasPermission(PLA_CALENDARIO.ver, "read")

    const [projetos, setProjetos] = useState<ProjetoCalendario[] | null>(null)
    const [setores, setSetores] = useState<Setor[]>([])
    const [permitidos, setPermitidos] = useState<Setor[]>([])
    const [erro, setErro] = useState<string | null>(null)

    useEffect(() => {
        if (carregandoUsuario || !podeVer) return
        let cancelado = false
        ;(async () => {
            try {
                const [s, lista] = await Promise.all([carregarSetores(supabase), carregarCalendario(supabase, ANO_PLANEJAMENTO)])
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

    const idsSetores = useMemo(() => setores.map(s => s.id), [setores])
    const filtros = useMemo(() => filtrosCalendarioDaUrl(searchParams, idsSetores), [searchParams, idsSetores])
    const atualizar = useCallback((f: FiltrosCalendario) => {
        const q = filtrosCalendarioParaUrl(f)
        router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
    }, [router, pathname])

    const setorPorId = useMemo(() => new Map(setores.map(s => [s.id, s])), [setores])
    const ordemSetor = useCallback((id: string) => setorPorId.get(id)?.ordem ?? 99, [setorPorId])
    const visiveis = useMemo(() => (projetos ? aplicarFiltrosCalendario(projetos, filtros) : []), [projetos, filtros])

    if (carregandoUsuario) return <Skeleton className="h-96 w-full" />
    if (!podeVer) {
        return <Aviso icone={<Lock className="h-8 w-8 text-muted-foreground" />} titulo="Você não tem acesso ao Calendário do Planejamento." texto="Peça a liberação no seu perfil de acesso." />
    }

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <h1 className="mr-auto text-2xl font-semibold tracking-tight">Calendário {ANO_PLANEJAMENTO}</h1>
                <Filtro rotulo="Status" valor={filtros.status} onChange={v => atualizar({ ...filtros, status: v as FiltrosCalendario["status"] })}
                    opcoes={STATUS_PROJETO.map(s => ({ valor: s.valor, rotulo: s.rotulo }))} />
                <Filtro rotulo="Tipo" valor={filtros.tipo} onChange={v => atualizar({ ...filtros, tipo: v as FiltrosCalendario["tipo"] })}
                    opcoes={TIPOS_PROJETO.map(t => ({ valor: t.valor, rotulo: t.rotulo }))} />
            </div>

            {/* Legenda clicável: liga e desliga cada setor (AC4) */}
            {permitidos.length > 0 && (
                <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Setores no calendário">
                    {permitidos.map(s => {
                        const ligado = !filtros.ocultos.includes(s.id)
                        return (
                            <button
                                key={s.id}
                                type="button"
                                aria-pressed={ligado}
                                onClick={() => atualizar(alternarSetor(filtros, s.id))}
                                className={cn("flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition", !ligado && "opacity-50")}
                                style={ligado ? { backgroundColor: s.cor, borderColor: s.cor, color: corTextoSobre(s.cor) } : { borderColor: s.cor }}
                                title={ligado ? `Esconder ${s.nome}` : `Mostrar ${s.nome}`}
                            >
                                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: ligado ? corTextoSobre(s.cor) : s.cor }} aria-hidden />
                                {s.nome}
                            </button>
                        )
                    })}
                </div>
            )}

            {erro ? (
                <Aviso icone={<AlertTriangle className="h-8 w-8 text-rose-600" />} titulo="Não foi possível carregar o calendário." texto={erro} />
            ) : projetos === null ? (
                <Skeleton className="h-96 w-full" />
            ) : filtros.mes === null ? (
                <VisaoAno projetos={visiveis} setorPorId={setorPorId} ordemSetor={ordemSetor} abrirMes={m => atualizar({ ...filtros, mes: m })} />
            ) : (
                <VisaoMes mes={filtros.mes} projetos={visiveis} setorPorId={setorPorId} ordemSetor={ordemSetor} irPara={m => atualizar({ ...filtros, mes: m })} />
            )}
        </div>
    )
}

function Filtro({ rotulo, valor, opcoes, onChange }: { rotulo: string; valor: string; opcoes: { valor: string; rotulo: string }[]; onChange: (v: string) => void }) {
    return (
        <Select value={valor === "" ? TODOS : valor} onValueChange={v => onChange(v === TODOS ? "" : v)}>
            <SelectTrigger className={cn("w-full sm:w-44", valor !== "" && "border-primary")} aria-label={rotulo}><SelectValue placeholder={rotulo} /></SelectTrigger>
            <SelectContent>
                <SelectItem value={TODOS}>{rotulo}: todos</SelectItem>
                {opcoes.map(o => <SelectItem key={o.valor} value={o.valor}>{o.rotulo}</SelectItem>)}
            </SelectContent>
        </Select>
    )
}

type PropsVisao = { projetos: ProjetoCalendario[]; setorPorId: Map<string, Setor>; ordemSetor: (id: string) => number }

const corDoSetor = (setorPorId: Map<string, Setor>, id: string) => setorPorId.get(id)?.cor ?? "#64748b"
const estiloFaixa = (cor: string): CSSProperties => ({ backgroundColor: cor, color: corTextoSobre(cor) })

// Faixa "Ano todo" (fixa no topo, separada da grade).
function AnoTodo({ projetos, setorPorId }: { projetos: ProjetoCalendario[]; setorPorId: Map<string, Setor> }) {
    if (projetos.length === 0) return null
    return (
        <Card>
            <CardContent className="space-y-2 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold"><CalendarRange className="h-4 w-4 text-muted-foreground" aria-hidden /> Ano todo</p>
                <div className="flex flex-wrap gap-2">
                    {projetos.map(p => (
                        <Link key={p.id} href={urlProjeto(p.id)} className="max-w-full truncate rounded-md px-3 py-1 text-sm font-medium hover:opacity-90" style={estiloFaixa(corDoSetor(setorPorId, p.setor_id))} title={p.nome}>
                            {p.nome}
                        </Link>
                    ))}
                </div>
            </CardContent>
        </Card>
    )
}

// ── Visão do ano (AC2) ──────────────────────────────────────────────────────────────────────

function VisaoAno({ projetos, setorPorId, ordemSetor, abrirMes }: PropsVisao & { abrirMes: (m: number) => void }) {
    const d = useMemo(() => distribuirAno(projetos, ordemSetor), [projetos, ordemSetor])
    return (
        <div className="space-y-4">
            <AnoTodo projetos={d.anoTodo} setorPorId={setorPorId} />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-4">
                {MESES.map((nome, i) => {
                    const mes = i + 1
                    const itens = d.meses[mes]
                    return (
                        <Card key={nome} className="overflow-hidden">
                            <CardContent className="space-y-2 p-3">
                                <button type="button" onClick={() => abrirMes(mes)} className="flex w-full items-center justify-between text-left font-semibold hover:text-primary hover:underline">
                                    {nome}
                                    <span className="text-xs font-normal text-muted-foreground">{itens.length === 0 ? "vazio" : itens.length === 1 ? "1 atividade" : `${itens.length} atividades`}</span>
                                </button>
                                <div className="space-y-1">
                                    {itens.map(item => <FaixaMes key={item.projeto.id} item={item} cor={corDoSetor(setorPorId, item.projeto.setor_id)} />)}
                                </div>
                            </CardContent>
                        </Card>
                    )
                })}
            </div>
            {d.semPeriodo.length > 0 && (
                <Card>
                    <CardContent className="space-y-2 p-4">
                        <p className="text-sm font-semibold">Sem período definido ({d.semPeriodo.length})</p>
                        <ul className="flex flex-wrap gap-2">
                            {d.semPeriodo.map(p => (
                                <li key={p.id}>
                                    <Link href={urlProjeto(p.id)} className="flex items-center gap-2 rounded-md border px-3 py-1 text-sm hover:bg-accent">
                                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: corDoSetor(setorPorId, p.setor_id) }} aria-hidden />
                                        {p.nome}
                                    </Link>
                                </li>
                            ))}
                        </ul>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}

// Faixa do projeto num mês: arredondada só nas pontas; no meio do período encosta nas bordas do cartão,
// para "atravessar" os meses.
function FaixaMes({ item, cor }: { item: ItemMes; cor: string }) {
    const { projeto: p, posicao } = item
    const borda = {
        unico: "rounded-md",
        inicio: "-mr-3 rounded-l-md",
        meio: "-mx-3",
        fim: "-ml-3 rounded-r-md",
    }[posicao]
    return (
        <Link href={urlProjeto(p.id)} title={`${p.nome} · ${rotuloPeriodo(p)}`} className={cn("block truncate px-2 py-1 text-xs font-medium hover:opacity-90", borda)} style={estiloFaixa(cor)}>
            {posicao === "meio" || posicao === "fim" ? <span aria-hidden>… </span> : null}{p.nome}
        </Link>
    )
}

// ── Visão de um mês (AC3) ───────────────────────────────────────────────────────────────────

function VisaoMes({ mes, projetos, setorPorId, ordemSetor, irPara }: PropsVisao & { mes: number; irPara: (m: number | null) => void }) {
    const { anoTodo, linhas } = useMemo(() => linhasDoMes(projetos, mes, ordemSetor), [projetos, mes, ordemSetor])
    const total = diasNoMes(mes)
    const dias = Array.from({ length: total }, (_, i) => i + 1)
    const anterior = mesAnterior(mes)
    const seguinte = mesSeguinte(mes)
    const colunas: CSSProperties = { gridTemplateColumns: `minmax(160px, 220px) repeat(${total}, minmax(22px, 1fr))` }
    const fimDeSemana = (dia: number) => [0, 6].includes(diaDaSemana(dia, mes))

    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" onClick={() => irPara(null)}><ArrowLeft className="mr-1 h-4 w-4" /> Voltar ao ano</Button>
                <div className="flex flex-1 items-center justify-center gap-2">
                    <Button variant="ghost" disabled={anterior === null} onClick={() => anterior && irPara(anterior)} aria-label="Mês anterior">
                        <ChevronLeft className="h-4 w-4" /> {anterior ? MESES[anterior - 1] : ""}
                    </Button>
                    <h2 className="min-w-40 text-center text-xl font-semibold">{MESES[mes - 1]} de {ANO_PLANEJAMENTO}</h2>
                    <Button variant="ghost" disabled={seguinte === null} onClick={() => seguinte && irPara(seguinte)} aria-label="Mês seguinte">
                        {seguinte ? MESES[seguinte - 1] : ""} <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            </div>

            <AnoTodo projetos={anoTodo} setorPorId={setorPorId} />

            {linhas.length === 0 ? (
                <Aviso titulo={`Nenhuma atividade em ${MESES[mes - 1].toLowerCase()}`} texto={anoTodo.length ? "Só as atividades do ano todo, acima." : undefined} />
            ) : (
                <Card>
                    <CardContent className="overflow-x-auto p-0">
                        <div className="min-w-[860px]">
                            {/* Cabeçalho: dias do mês */}
                            <div className="grid border-b text-center text-[11px] text-muted-foreground" style={colunas}>
                                <div className="px-3 py-2 text-left text-xs font-medium">Atividade</div>
                                {dias.map(d => (
                                    <div key={d} className={cn("py-1", fimDeSemana(d) && "bg-muted/60")}>
                                        <div>{DIAS_SEMANA_CURTOS[diaDaSemana(d, mes)]}</div>
                                        <div className="font-medium text-foreground">{d}</div>
                                    </div>
                                ))}
                            </div>
                            {linhas.map(l => {
                                const cor = corDoSetor(setorPorId, l.projeto.setor_id)
                                return (
                                    <div key={l.projeto.id} className="relative grid items-center border-b last:border-0" style={colunas}>
                                        {/* Fundo do fim de semana */}
                                        {dias.map(d => fimDeSemana(d) ? <div key={d} className="h-full bg-muted/40" style={{ gridColumn: d + 1, gridRow: 1 }} /> : null)}
                                        <Link href={urlProjeto(l.projeto.id)} className="truncate px-3 py-2 text-sm font-medium hover:underline" style={{ gridColumn: 1, gridRow: 1 }} title={l.projeto.nome}>
                                            {l.projeto.nome}
                                        </Link>
                                        <Link
                                            href={urlProjeto(l.projeto.id)}
                                            title={`${l.projeto.nome} · ${rotuloPeriodo(l.projeto)}`}
                                            className={cn("mx-0.5 my-1.5 h-6 truncate px-1.5 text-[11px] leading-6 hover:opacity-90", !l.continuaAntes && "rounded-l-md", !l.continuaDepois && "rounded-r-md", l.continuaAntes && "-ml-px", l.continuaDepois && "-mr-px")}
                                            style={{ ...estiloFaixa(cor), gridColumn: `${l.de + 1} / ${l.ate + 2}`, gridRow: 1 }}
                                            aria-label={`${l.projeto.nome}, de ${l.de} a ${l.ate} de ${MESES[mes - 1].toLowerCase()}`}
                                        >
                                            {l.de === l.ate ? "" : l.projeto.nome}
                                        </Link>
                                    </div>
                                )
                            })}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
