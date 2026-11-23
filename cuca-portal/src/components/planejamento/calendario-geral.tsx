"use client"

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { AlertTriangle, CalendarRange, FileDown, FileSpreadsheet, Lock } from "lucide-react"
import toast from "react-hot-toast"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/lib/auth/user-provider"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Aviso } from "@/components/planejamento/projeto-form"
import { PLA_CALGERAL } from "@/lib/rbac/catalogo-planejamento"
import { ANO_PLANEJAMENTO, STATUS_PROJETO, TIPOS_PROJETO } from "@/lib/planejamento/projeto"
import { MESES } from "@/lib/planejamento/lista"
import { corTextoSobre } from "@/lib/planejamento/slides"
import { alternarSetor, aplicarFiltrosCalendario, filtrosCalendarioDaUrl, filtrosCalendarioParaUrl, type FiltrosCalendario } from "@/lib/planejamento/calendario"
import {
    CABECALHO_GRADE, EXPLICACAO_MESES, atividadesPorMes, colunaFimDeSemana, contarPorSetor, linhasLista, montarGradeAno, nomeArquivoCalendarioGeral,
    rotuloDatas, textoDoDia, textoFiltros, type CelulaDia, type ProjetoCalendarioGeral,
} from "@/lib/planejamento/calendario-geral"
import { carregarCalendarioGeral } from "@/lib/planejamento/calendario-geral-dados"
import { carregarSetores, carregarSetoresPermitidos, carregarUnidades, type Setor, type Unidade } from "@/lib/planejamento/projeto-dados"

// S-PLA-10: Calendário Geral 2027 (pedido da direção, só leitura). Junta os dois formatos de referência:
// a grade do ano do calendário escolar (meses × dias alinhados pela semana, cada dia na cor do setor) e as
// tabelas por mês do calendário oficial (Data · Ação · Área/Setor · Responsável). Exporta em PDF e Excel
// com os mesmos filtros da tela. Clicar num dia mostra as atividades dele; clicar numa atividade abre o projeto.

const TODOS = "__todos__"
const urlProjeto = (id: string) => `/planejamento/projeto/${id}`
const CINZA = "#64748b"

function baixar(blob: Blob, nome: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = nome
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

const agoraFortaleza = () => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Fortaleza", dateStyle: "short", timeStyle: "short" }).format(new Date())

// Um setor: cor cheia. Vários: faixas verticais, uma por setor (igual ao PDF).
function fundoDoDia(cores: string[]): CSSProperties {
    if (cores.length === 1) return { backgroundColor: cores[0], color: corTextoSobre(cores[0]) }
    const passo = 100 / cores.length
    const faixas = cores.map((c, i) => `${c} ${i * passo}% ${(i + 1) * passo}%`).join(", ")
    return { backgroundImage: `linear-gradient(90deg, ${faixas})` }
}

export function CalendarioGeral() {
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const supabase = useMemo(() => createClient(), [])
    const { loading: carregandoUsuario, hasPermission } = useUser()
    const podeVer = hasPermission(PLA_CALGERAL.ver, "read")
    const podePdf = podeVer && hasPermission(PLA_CALGERAL.pdf, "read")
    const podeXlsx = podeVer && hasPermission(PLA_CALGERAL.xlsx, "read")

    const [projetos, setProjetos] = useState<ProjetoCalendarioGeral[] | null>(null)
    const [setores, setSetores] = useState<Setor[]>([])
    const [permitidos, setPermitidos] = useState<Setor[]>([])
    const [unidades, setUnidades] = useState<Unidade[]>([])
    const [erro, setErro] = useState<string | null>(null)
    const [selecionado, setSelecionado] = useState<{ mes: number; dia: number } | null>(null)
    const [exportando, setExportando] = useState<"pdf" | "xlsx" | null>(null)

    useEffect(() => {
        if (carregandoUsuario || !podeVer) return
        let cancelado = false
        ;(async () => {
            try {
                const [s, lista, u] = await Promise.all([carregarSetores(supabase), carregarCalendarioGeral(supabase, ANO_PLANEJAMENTO), carregarUnidades(supabase)])
                const perm = await carregarSetoresPermitidos(supabase, s)
                if (cancelado) return
                setSetores(s)
                setPermitidos(perm)
                setUnidades(u)
                setProjetos(lista)
            } catch (e) {
                if (!cancelado) setErro(e instanceof Error ? e.message : String(e))
            }
        })()
        return () => { cancelado = true }
    }, [carregandoUsuario, podeVer, supabase])

    // Mesmos filtros do Calendário 2027 (status, tipo e setores da legenda), no endereço. O mês não se aplica aqui.
    const idsSetores = useMemo(() => setores.map(s => s.id), [setores])
    const filtros = useMemo(() => ({ ...filtrosCalendarioDaUrl(searchParams, idsSetores), mes: null }), [searchParams, idsSetores])
    const atualizar = useCallback((f: FiltrosCalendario) => {
        const q = filtrosCalendarioParaUrl({ ...f, mes: null })
        router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
    }, [router, pathname])

    const setorPorId = useMemo(() => new Map(setores.map(s => [s.id, s])), [setores])
    const ordemSetor = useCallback((id: string) => setorPorId.get(id)?.ordem ?? 99, [setorPorId])
    const cor = useCallback((id: string) => setorPorId.get(id)?.cor ?? CINZA, [setorPorId])
    const nomeSetor = useCallback((id: string) => setorPorId.get(id)?.nome ?? "", [setorPorId])
    const nomeUnidade = useCallback((id: string) => unidades.find(u => u.id === id)?.nome, [unidades])

    const visiveis = useMemo(() => (projetos ? aplicarFiltrosCalendario(projetos, filtros) as ProjetoCalendarioGeral[] : []), [projetos, filtros])
    const grade = useMemo(() => montarGradeAno(visiveis, ordemSetor), [visiveis, ordemSetor])
    const atividades = useMemo(() => atividadesPorMes(visiveis, ordemSetor), [visiveis, ordemSetor])
    const contagem = useMemo(() => contarPorSetor(visiveis), [visiveis])
    const setoresLegenda = useMemo(() => permitidos.filter(s => !filtros.ocultos.includes(s.id)), [permitidos, filtros.ocultos])
    // Um filtro pode esvaziar o dia escolhido: aí o painel some (em vez de "0 atividades").
    const celulaEscolhida = selecionado ? grade[selecionado.mes - 1].celulas.find(c => c?.dia === selecionado.dia) ?? null : null
    const celulaSelecionada = celulaEscolhida && celulaEscolhida.projetos.length > 0 ? celulaEscolhida : null

    const exportar = async (tipo: "pdf" | "xlsx") => {
        setExportando(tipo)
        const geradoEm = agoraFortaleza()
        const filtrosTexto = textoFiltros(filtros, nomeSetor)
        try {
            if (tipo === "pdf") {
                const [{ pdf }, { CalendarioGeralPdfDocument }] = await Promise.all([import("@react-pdf/renderer"), import("@/lib/planejamento/calendario-geral-pdf")])
                const blob = await pdf(
                    <CalendarioGeralPdfDocument grade={grade} atividades={atividades} setores={setores} legenda={setoresLegenda} contagem={contagem}
                        geradoEm={geradoEm} filtrosTexto={filtrosTexto} logo={`${window.location.origin}/logo-rede-cuca.png`} />,
                ).toBlob()
                baixar(blob, nomeArquivoCalendarioGeral("pdf"))
            } else {
                const { gerarXlsxCalendarioGeral } = await import("@/lib/planejamento/gerar-xlsx-calendario-geral")
                const buffer = await gerarXlsxCalendarioGeral({
                    grade, linhas: linhasLista(atividades, nomeSetor, nomeUnidade), anoTodo: atividades.anoTodo,
                    setores, legenda: setoresLegenda, contagem, geradoEm, filtrosTexto,
                })
                baixar(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), nomeArquivoCalendarioGeral("xlsx"))
            }
            toast.success(tipo === "pdf" ? "PDF exportado" : "Planilha exportada")
        } catch (e) {
            console.error(`Error in exportar calendário geral (${tipo}):`, e)
            toast.error(e instanceof Error ? e.message : "Não foi possível gerar o arquivo")
        } finally {
            setExportando(null)
        }
    }

    if (carregandoUsuario) return <Skeleton className="h-96 w-full" />
    if (!podeVer) {
        return <Aviso icone={<Lock className="h-8 w-8 text-muted-foreground" />} titulo="Você não tem acesso ao Calendário Geral." texto="Peça a liberação no seu perfil de acesso." />
    }

    return (
        <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-3">
                <div className="mr-auto">
                    <h1 className="text-2xl font-semibold tracking-tight">Calendário Geral {ANO_PLANEJAMENTO}</h1>
                    <p className="text-sm text-muted-foreground">O ano inteiro numa grade, com as atividades de cada mês.</p>
                </div>
                <Filtro rotulo="Status" valor={filtros.status} onChange={v => atualizar({ ...filtros, status: v as FiltrosCalendario["status"] })}
                    opcoes={STATUS_PROJETO.map(s => ({ valor: s.valor, rotulo: s.rotulo }))} />
                <Filtro rotulo="Tipo" valor={filtros.tipo} onChange={v => atualizar({ ...filtros, tipo: v as FiltrosCalendario["tipo"] })}
                    opcoes={TIPOS_PROJETO.map(t => ({ valor: t.valor, rotulo: t.rotulo }))} />
                {podePdf && (
                    <Button variant="outline" onClick={() => exportar("pdf")} disabled={exportando !== null || projetos === null}>
                        <FileDown className="mr-2 h-4 w-4" /> {exportando === "pdf" ? "Gerando…" : "Exportar PDF"}
                    </Button>
                )}
                {podeXlsx && (
                    <Button variant="outline" onClick={() => exportar("xlsx")} disabled={exportando !== null || projetos === null}>
                        <FileSpreadsheet className="mr-2 h-4 w-4" /> {exportando === "xlsx" ? "Gerando…" : "Exportar Excel"}
                    </Button>
                )}
            </div>

            {/* Legenda clicável: liga e desliga cada setor (vale também para as exportações) */}
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
                                {s.nome}{ligado && <span className="text-xs opacity-80">({contagem.get(s.id) ?? 0})</span>}
                            </button>
                        )
                    })}
                </div>
            )}

            {erro ? (
                <Aviso icone={<AlertTriangle className="h-8 w-8 text-rose-600" />} titulo="Não foi possível carregar o calendário." texto={erro} />
            ) : projetos === null ? (
                <Skeleton className="h-96 w-full" />
            ) : (
                <>
                    {/* Grade do ano */}
                    <Card>
                        <CardContent className="overflow-x-auto p-3">
                            <table className="w-full min-w-[1100px] table-fixed border-separate border-spacing-[2px] text-center text-xs">
                                <thead>
                                    <tr>
                                        <th className="w-24" />
                                        {CABECALHO_GRADE.map((l, i) => (
                                            <th key={i} className={cn("rounded-sm py-1 font-semibold text-muted-foreground", colunaFimDeSemana(i) && "bg-muted")}>{l}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {grade.map(m => (
                                        <tr key={m.mes}>
                                            <th scope="row" className="pr-2 text-left text-sm font-semibold">{m.nome}</th>
                                            {m.celulas.map((c, i) => (
                                                <td key={i} className="p-0">
                                                    {c ? (
                                                        <Dia celula={c} mes={m.mes} cor={cor} nomeSetor={nomeSetor}
                                                            ativo={selecionado?.mes === m.mes && selecionado.dia === c.dia}
                                                            onClick={() => setSelecionado(s => (s?.mes === m.mes && s.dia === c.dia ? null : { mes: m.mes, dia: c.dia }))} />
                                                    ) : <div className="h-8 rounded-sm bg-muted/30" />}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            <div className="mt-3 flex flex-wrap items-center gap-4 px-1 text-xs text-muted-foreground">
                                <span className="flex items-center gap-1.5">
                                    <span className="h-3.5 w-3.5 rounded-sm" style={fundoDoDia(setoresLegenda.slice(0, 3).map(s => s.cor))} aria-hidden />
                                    Listrado: mais de um setor no dia
                                </span>
                                <span className="flex items-center gap-1.5"><span className="h-3.5 w-3.5 rounded-sm bg-muted" aria-hidden /> Fim de semana</span>
                                <span>Clique num dia para ver as atividades.</span>
                            </div>
                        </CardContent>
                    </Card>

                    {celulaSelecionada && selecionado && (
                        <DiaSelecionado mes={selecionado.mes} celula={celulaSelecionada} cor={cor} nomeSetor={nomeSetor} fechar={() => setSelecionado(null)} />
                    )}

                    {atividades.anoTodo.length > 0 && (
                        <Card>
                            <CardContent className="space-y-2 p-4">
                                <p className="flex items-center gap-2 text-sm font-semibold"><CalendarRange className="h-4 w-4 text-muted-foreground" aria-hidden /> Durante o ano todo</p>
                                <div className="flex flex-wrap gap-2">
                                    {atividades.anoTodo.map(p => (
                                        <Link key={p.id} href={urlProjeto(p.id)} className="rounded-md px-3 py-1 text-sm font-medium hover:opacity-90"
                                            style={{ backgroundColor: cor(p.setor_id), color: corTextoSobre(cor(p.setor_id)) }} title={nomeSetor(p.setor_id)}>
                                            {p.nome}
                                        </Link>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Atividades por mês, no formato do calendário oficial */}
                    <div className="space-y-2">
                        <h2 className="text-lg font-semibold">Atividades por mês</h2>
                        <p className="text-sm text-muted-foreground">{EXPLICACAO_MESES}</p>
                    </div>
                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
                        {MESES.map((nome, i) => (
                            <TabelaMes key={nome} nome={nome} projetos={atividades.meses[i + 1]} cor={cor} nomeSetor={nomeSetor} />
                        ))}
                    </div>

                    {atividades.semPeriodo.length > 0 && (
                        <Card>
                            <CardContent className="space-y-2 p-4">
                                <p className="text-sm font-semibold">Sem período definido ({atividades.semPeriodo.length})</p>
                                <ul className="flex flex-wrap gap-2">
                                    {atividades.semPeriodo.map(p => (
                                        <li key={p.id}>
                                            <Link href={urlProjeto(p.id)} className="flex items-center gap-2 rounded-md border px-3 py-1 text-sm hover:bg-accent">
                                                <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: cor(p.setor_id) }} aria-hidden />
                                                {p.nome}
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            </CardContent>
                        </Card>
                    )}
                </>
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

type Cores = { cor: (id: string) => string; nomeSetor: (id: string) => string }

function Dia({ celula: c, mes, ativo, onClick, cor, nomeSetor }: Cores & { celula: CelulaDia; mes: number; ativo: boolean; onClick: () => void }) {
    const vazio = c.setores.length === 0
    const varios = c.setores.length > 1
    const rotulo = `${c.dia} de ${MESES[mes - 1].toLowerCase()}`
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={vazio}
            title={vazio ? rotulo : `${rotulo}\n${textoDoDia(c, nomeSetor)}`}
            aria-label={vazio ? rotulo : `${rotulo}: ${c.projetos.length === 1 ? "1 atividade" : `${c.projetos.length} atividades`}`}
            aria-pressed={ativo}
            className={cn(
                "relative flex h-8 w-full items-center justify-center rounded-sm text-xs tabular-nums transition",
                vazio ? (c.fimDeSemana ? "bg-muted text-muted-foreground" : "bg-background text-foreground ring-1 ring-inset ring-border") : "font-semibold hover:opacity-85",
                ativo && "ring-2 ring-foreground ring-offset-1",
            )}
            style={vazio ? undefined : fundoDoDia(c.setores.map(cor))}
        >
            {varios ? (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white text-[10px] text-slate-900 shadow-sm">{c.dia}</span>
            ) : c.dia}
            {c.projetos.length > 1 && (
                <span className="absolute -right-0.5 -top-1 rounded-full bg-slate-900 px-1 text-[9px] leading-[13px] text-white" aria-hidden>{c.projetos.length}</span>
            )}
        </button>
    )
}

function DiaSelecionado({ mes, celula, cor, nomeSetor, fechar }: Cores & { mes: number; celula: CelulaDia | null; fechar: () => void }) {
    if (!celula) return null
    return (
        <Card>
            <CardContent className="space-y-3 p-4">
                <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold">
                        {celula.dia} de {MESES[mes - 1].toLowerCase()} · {celula.projetos.length === 1 ? "1 atividade" : `${celula.projetos.length} atividades`}
                    </p>
                    <Button variant="ghost" size="sm" onClick={fechar}>Fechar</Button>
                </div>
                <ul className="divide-y">
                    {celula.projetos.map(p => (
                        <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: cor(p.setor_id) }} aria-hidden />
                            <Link href={urlProjeto(p.id)} className="font-medium hover:underline">{p.nome}</Link>
                            <span className="text-muted-foreground">{nomeSetor(p.setor_id)} · {rotuloDatas(p)}{p.responsavel_nome ? ` · ${p.responsavel_nome}` : ""}</span>
                        </li>
                    ))}
                </ul>
            </CardContent>
        </Card>
    )
}

function TabelaMes({ nome, projetos, cor, nomeSetor }: Cores & { nome: string; projetos: ProjetoCalendarioGeral[] }) {
    return (
        <Card className="overflow-hidden">
            <div className="bg-slate-900 py-2 text-center text-sm font-semibold uppercase tracking-wide text-white">
                {nome} <span className="font-normal normal-case text-slate-300">· {projetos.length === 0 ? "vazio" : projetos.length === 1 ? "1 atividade" : `${projetos.length} atividades`}</span>
            </div>
            {projetos.length === 0 ? (
                <p className="p-4 text-center text-sm text-muted-foreground">Nenhuma atividade começa neste mês.</p>
            ) : (
                <table className="w-full text-left text-xs">
                    <thead className="bg-muted/60 text-muted-foreground">
                        <tr>
                            <th className="w-24 px-2 py-1.5 font-medium">Data</th>
                            <th className="px-2 py-1.5 font-medium">Ação</th>
                            <th className="w-28 px-2 py-1.5 font-medium">Área/Setor</th>
                            <th className="w-28 px-2 py-1.5 font-medium">Responsável</th>
                        </tr>
                    </thead>
                    <tbody>
                        {projetos.map(p => {
                            const c = cor(p.setor_id)
                            return (
                                <tr key={p.id} className="border-t align-top">
                                    <td className="px-2 py-1.5 font-semibold" style={{ backgroundColor: c, color: corTextoSobre(c) }}>{rotuloDatas(p)}</td>
                                    <td className="break-words px-2 py-1.5 font-medium"><Link href={urlProjeto(p.id)} className="hover:underline">{p.nome}</Link></td>
                                    <td className="px-2 py-1.5">{nomeSetor(p.setor_id)}</td>
                                    <td className="break-words px-2 py-1.5">{p.responsavel_nome ?? ""}</td>
                                </tr>
                            )
                        })}
                    </tbody>
                </table>
            )}
        </Card>
    )
}
