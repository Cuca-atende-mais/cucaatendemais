"use client"

import { useEffect, useState, type ReactNode } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import toast from "react-hot-toast"
import {
    BadgeCheck, Bell, CheckCircle2, CircleCheck, CirclePlus, ClipboardList, Flag, History, ListChecks, Loader2,
    MessageSquare, Pencil, PlusCircle, RefreshCw, Save, ShieldOff, Trash2, Undo2, type LucideIcon,
} from "lucide-react"
import { useUser } from "@/lib/auth/user-provider"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { PLA_ACOMP } from "@/lib/rbac/catalogo-planejamento"
import {
    EVENTOS_POR_PAGINA, LIMITE_PENDENCIA, LIMITE_RESPONSAVEL, LIMITE_TEXTO, SECOES_CORRECAO, abertas,
    fichaAlteradaAposValidacao, montarLinhaDoTempo, rotuloSecaoCorrecao, textoFaixaCorrecoes,
    type Comentario, type Correcao, type EventoProjeto, type Pendencia, type Validacao,
} from "@/lib/planejamento/acompanhamento"
import {
    carregarHistorico, criarComentario, criarPendencia, editarComentario, editarPendencia, excluirComentario,
    excluirPendencia, marcarPendencia, pedirCorrecao, resolverCorrecao, retirarValidacao, validarProjeto,
    type Acompanhamento,
} from "@/lib/planejamento/acompanhamento-dados"
import { dataFortaleza, dataHoraFortaleza } from "@/lib/planejamento/projeto-dados"

// S-PLA-04: acompanhamento do projeto. Tudo aqui só é montado com `pla_acomp_ver` (a página confere);
// cada controle aparece só com a permissão da sua ação. O banco confere tudo de novo. Nada trava a ficha,
// o status ou a apresentação (D4).

export const ANCORA_CORRECOES = "acompanhamento-correcoes"
const SEM_SECAO = "__sem_secao__"

const erroDe = (e: unknown) => (e instanceof Error ? e.message : String(e))

function usePermissao() {
    const { hasPermission } = useUser()
    return (p: string) => hasPermission(p, "read")
}

// Executa uma ação, mostra o aviso e recarrega. Devolve true se deu certo.
function useAcao(recarregar: () => Promise<void> | void) {
    const [ocupado, setOcupado] = useState(false)
    const executar = async (acao: () => Promise<void>, sucesso: string): Promise<boolean> => {
        setOcupado(true)
        try {
            await acao()
            toast.success(sucesso)
            await recarregar()
            return true
        } catch (e) {
            toast.error(erroDe(e))
            return false
        } finally {
            setOcupado(false)
        }
    }
    return { ocupado, executar }
}

// ── Topo da página: faixa de correções (AC2) e validação (AC4) ──────────────────────────────

export function FaixaCorrecoes({ correcoes }: { correcoes: Correcao[] }) {
    const texto = textoFaixaCorrecoes(abertas(correcoes).length)
    if (!texto) return null
    return (
        <a
            href={`#${ANCORA_CORRECOES}`}
            className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm font-medium text-amber-900 hover:bg-amber-100"
        >
            <Bell className="h-4 w-4 shrink-0" aria-hidden /> {texto}
            <span className="ml-auto text-xs font-normal underline">Ver correções</span>
        </a>
    )
}

export function ValidacaoTopo({ supabase, projetoId, validacao, fichaAtualizadaEm, recarregar }: {
    supabase: SupabaseClient
    projetoId: string
    validacao: Validacao | null
    fichaAtualizadaEm: string
    recarregar: () => Promise<void> | void
}) {
    const pode = usePermissao()
    const { ocupado, executar } = useAcao(recarregar)
    const podeDar = pode(PLA_ACOMP.validDar)
    const podeRetirar = pode(PLA_ACOMP.validRetirar)

    if (!validacao) {
        if (!podeDar) return null
        return (
            <Button variant="outline" size="sm" disabled={ocupado}
                onClick={() => executar(() => validarProjeto(supabase, projetoId), "Projeto validado")}>
                {ocupado ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <BadgeCheck className="mr-1 h-4 w-4" />} Validar projeto
            </Button>
        )
    }
    const alterada = fichaAtualizadaEm && fichaAlteradaAposValidacao(fichaAtualizadaEm, validacao.validado_em)
    return (
        <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className="border-emerald-300 bg-emerald-50 text-emerald-800">
                ✔ Validado por {validacao.validado_por_nome ?? "—"} em {dataFortaleza(validacao.validado_em)}
            </Badge>
            {alterada && <span className="text-xs text-muted-foreground">ficha alterada após a validação</span>}
            {podeRetirar && (
                <Button variant="ghost" size="sm" disabled={ocupado}
                    onClick={() => executar(() => retirarValidacao(supabase, projetoId), "Validação retirada")}>
                    {ocupado ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <ShieldOff className="mr-1 h-4 w-4" />} Retirar validação
                </Button>
            )}
        </div>
    )
}

// ── Seção "Acompanhamento" (AC1) ─────────────────────────────────────────────────────────────

export function SecaoAcompanhamento({ supabase, projetoId, dados, versaoHistorico, recarregar }: {
    supabase: SupabaseClient
    projetoId: string
    dados: Acompanhamento
    versaoHistorico: number
    recarregar: () => Promise<void> | void
}) {
    return (
        <section className="space-y-4" aria-labelledby="titulo-acompanhamento">
            <h2 id="titulo-acompanhamento" className="text-xl font-semibold tracking-tight">Acompanhamento</h2>
            <BlocoCorrecoes supabase={supabase} projetoId={projetoId} correcoes={dados.correcoes} recarregar={recarregar} />
            <BlocoComentarios supabase={supabase} projetoId={projetoId} comentarios={dados.comentarios} recarregar={recarregar} />
            <BlocoPendencias supabase={supabase} projetoId={projetoId} pendencias={dados.pendencias} recarregar={recarregar} />
            <BlocoHistorico supabase={supabase} projetoId={projetoId} versao={versaoHistorico} />
        </section>
    )
}

function Bloco({ id, icone: Icone, titulo, children }: { id?: string; icone: LucideIcon; titulo: string; children: ReactNode }) {
    return (
        <Card id={id} className="scroll-mt-20">
            <CardContent className="space-y-4 pt-6">
                <h3 className="flex items-center gap-2 text-lg font-semibold"><Icone className="h-5 w-5 text-muted-foreground" aria-hidden /> {titulo}</h3>
                {children}
            </CardContent>
        </Card>
    )
}

const Vazio = ({ children }: { children: ReactNode }) => <p className="text-sm text-muted-foreground">{children}</p>

// ── Correções pedidas (AC2) ──────────────────────────────────────────────────────────────────

function BlocoCorrecoes({ supabase, projetoId, correcoes, recarregar }: {
    supabase: SupabaseClient; projetoId: string; correcoes: Correcao[]; recarregar: () => Promise<void> | void
}) {
    const pode = usePermissao()
    const { ocupado, executar } = useAcao(recarregar)
    const [texto, setTexto] = useState("")
    const [secao, setSecao] = useState(SEM_SECAO)
    const [resolvendo, setResolvendo] = useState<string | null>(null)
    const [observacao, setObservacao] = useState("")

    const emAberto = abertas(correcoes)
    const resolvidas = correcoes.filter(c => c.resolvida_em !== null)

    const pedir = async () => {
        const ok = await executar(
            () => pedirCorrecao(supabase, projetoId, texto, secao === SEM_SECAO ? null : Number(secao)),
            "Correção pedida",
        )
        if (ok) { setTexto(""); setSecao(SEM_SECAO) }
    }
    const resolver = async (id: string) => {
        const ok = await executar(() => resolverCorrecao(supabase, id, observacao), "Correção marcada como resolvida")
        if (ok) { setResolvendo(null); setObservacao("") }
    }

    return (
        <Bloco id={ANCORA_CORRECOES} icone={ClipboardList} titulo="Correções pedidas">
            {pode(PLA_ACOMP.correcaoPedir) && (
                <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                    <Label htmlFor="pedir-correcao">Pedir correção</Label>
                    <Textarea id="pedir-correcao" value={texto} maxLength={LIMITE_TEXTO} disabled={ocupado}
                        onChange={e => setTexto(e.target.value)} placeholder="O que precisa ser corrigido na ficha" />
                    <div className="flex flex-wrap items-center gap-2">
                        <Select value={secao} onValueChange={setSecao} disabled={ocupado}>
                            <SelectTrigger className="w-full sm:w-64" aria-label="Seção da ficha"><SelectValue /></SelectTrigger>
                            <SelectContent>
                                <SelectItem value={SEM_SECAO}>Seção da ficha (opcional)</SelectItem>
                                {SECOES_CORRECAO.map(s => <SelectItem key={s.id} value={String(s.id)}>{s.rotulo}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Button onClick={pedir} disabled={ocupado || texto.trim() === ""}>
                            {ocupado ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CirclePlus className="mr-1 h-4 w-4" />} Pedir correção
                        </Button>
                    </div>
                </div>
            )}

            {correcoes.length === 0 ? <Vazio>Nenhuma correção pedida.</Vazio> : (
                <ul className="space-y-3">
                    {[...emAberto, ...resolvidas].map(c => {
                        const resolvida = c.resolvida_em !== null
                        const secaoRotulo = rotuloSecaoCorrecao(c.secao)
                        return (
                            <li key={c.id} className={cn("space-y-2 rounded-md border p-3", resolvida ? "bg-muted/30 text-muted-foreground" : "border-amber-300 bg-amber-50/50")}>
                                <div className="flex flex-wrap items-center gap-2">
                                    <Badge variant="outline" className={resolvida ? "" : "border-amber-300 bg-amber-100 text-amber-900"}>
                                        {resolvida ? "Resolvida" : "Em aberto"}
                                    </Badge>
                                    {secaoRotulo && <Badge variant="secondary">{secaoRotulo}</Badge>}
                                    <span className="text-xs text-muted-foreground">
                                        Pedida por {c.pedido_por_nome ?? "—"} em {dataHoraFortaleza(c.created_at)}
                                    </span>
                                </div>
                                <p className="whitespace-pre-wrap text-sm">{c.texto}</p>
                                {resolvida && (
                                    <p className="text-xs">
                                        Resolvida por {c.resolvida_por_nome ?? "—"} em {dataHoraFortaleza(c.resolvida_em as string)}
                                        {c.resolucao_obs && <> · <span className="whitespace-pre-wrap">{c.resolucao_obs}</span></>}
                                    </p>
                                )}
                                {!resolvida && pode(PLA_ACOMP.correcaoResolver) && (resolvendo === c.id ? (
                                    <div className="space-y-2">
                                        <Label htmlFor={`obs-${c.id}`}>Observação (opcional)</Label>
                                        <Textarea id={`obs-${c.id}`} value={observacao} maxLength={LIMITE_TEXTO} disabled={ocupado}
                                            onChange={e => setObservacao(e.target.value)} />
                                        <div className="flex flex-wrap gap-2">
                                            <Button size="sm" onClick={() => resolver(c.id)} disabled={ocupado}>
                                                {ocupado && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Confirmar: resolvida
                                            </Button>
                                            <Button size="sm" variant="outline" disabled={ocupado} onClick={() => { setResolvendo(null); setObservacao("") }}>Cancelar</Button>
                                        </div>
                                    </div>
                                ) : (
                                    <Button size="sm" variant="outline" disabled={ocupado} onClick={() => { setResolvendo(c.id); setObservacao("") }}>
                                        <CheckCircle2 className="mr-1 h-4 w-4" /> Marcar como resolvida
                                    </Button>
                                ))}
                            </li>
                        )
                    })}
                </ul>
            )}
        </Bloco>
    )
}

// ── Comentários (AC3) ────────────────────────────────────────────────────────────────────────

function BlocoComentarios({ supabase, projetoId, comentarios, recarregar }: {
    supabase: SupabaseClient; projetoId: string; comentarios: Comentario[]; recarregar: () => Promise<void> | void
}) {
    const pode = usePermissao()
    const { user } = useUser()
    const { ocupado, executar } = useAcao(recarregar)
    const [novo, setNovo] = useState("")
    const [editando, setEditando] = useState<string | null>(null)
    const [textoEdicao, setTextoEdicao] = useState("")
    const [excluindo, setExcluindo] = useState<string | null>(null)

    const comentar = async () => {
        if (await executar(() => criarComentario(supabase, projetoId, novo), "Comentário publicado")) setNovo("")
    }
    const salvarEdicao = async (id: string) => {
        if (await executar(() => editarComentario(supabase, id, textoEdicao), "Comentário editado")) setEditando(null)
    }
    const excluir = async (id: string) => {
        if (await executar(() => excluirComentario(supabase, id), "Comentário excluído")) setExcluindo(null)
    }

    return (
        <Bloco icone={MessageSquare} titulo="Comentários">
            {comentarios.length === 0 ? <Vazio>Nenhum comentário.</Vazio> : (
                <ul className="space-y-3">
                    {comentarios.map(c => {
                        const proprio = user?.id === c.autor_id
                        return (
                            <li key={c.id} className="space-y-1 rounded-md border p-3">
                                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                    <span className="font-medium text-foreground">{c.autor_nome ?? "—"}</span>
                                    <span>{dataHoraFortaleza(c.created_at)}</span>
                                    {c.editado_em && <span>(editado)</span>}
                                    {proprio && editando !== c.id && excluindo !== c.id && (
                                        <span className="ml-auto flex gap-1">
                                            {pode(PLA_ACOMP.comentEditar) && (
                                                <Button variant="ghost" size="sm" disabled={ocupado} onClick={() => { setEditando(c.id); setTextoEdicao(c.texto) }}>
                                                    <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
                                                </Button>
                                            )}
                                            {pode(PLA_ACOMP.comentExcluir) && (
                                                <Button variant="ghost" size="sm" disabled={ocupado} onClick={() => setExcluindo(c.id)}>
                                                    <Trash2 className="mr-1 h-3.5 w-3.5" /> Excluir
                                                </Button>
                                            )}
                                        </span>
                                    )}
                                </div>
                                {editando === c.id ? (
                                    <div className="space-y-2">
                                        <Textarea value={textoEdicao} maxLength={LIMITE_TEXTO} disabled={ocupado} aria-label="Editar comentário"
                                            onChange={e => setTextoEdicao(e.target.value)} />
                                        <div className="flex gap-2">
                                            <Button size="sm" onClick={() => salvarEdicao(c.id)} disabled={ocupado || textoEdicao.trim() === ""}>
                                                {ocupado ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />} Salvar
                                            </Button>
                                            <Button size="sm" variant="outline" disabled={ocupado} onClick={() => setEditando(null)}>Cancelar</Button>
                                        </div>
                                    </div>
                                ) : (
                                    <p className="whitespace-pre-wrap text-sm">{c.texto}</p>
                                )}
                                {excluindo === c.id && (
                                    <div className="flex flex-wrap items-center gap-2 pt-1 text-sm">
                                        <span>Excluir este comentário?</span>
                                        <Button size="sm" variant="destructive" disabled={ocupado} onClick={() => excluir(c.id)}>
                                            {ocupado && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Excluir
                                        </Button>
                                        <Button size="sm" variant="outline" disabled={ocupado} onClick={() => setExcluindo(null)}>Cancelar</Button>
                                    </div>
                                )}
                            </li>
                        )
                    })}
                </ul>
            )}
            {pode(PLA_ACOMP.comentCriar) && (
                <div className="space-y-2">
                    <Textarea value={novo} maxLength={LIMITE_TEXTO} disabled={ocupado} aria-label="Novo comentário"
                        onChange={e => setNovo(e.target.value)} placeholder="Escreva um comentário" />
                    <Button onClick={comentar} disabled={ocupado || novo.trim() === ""}>
                        {ocupado ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <MessageSquare className="mr-1 h-4 w-4" />} Comentar
                    </Button>
                </div>
            )}
        </Bloco>
    )
}

// ── Pendências (AC5), sem prazo e sem data ───────────────────────────────────────────────────

function BlocoPendencias({ supabase, projetoId, pendencias, recarregar }: {
    supabase: SupabaseClient; projetoId: string; pendencias: Pendencia[]; recarregar: () => Promise<void> | void
}) {
    const pode = usePermissao()
    const { ocupado, executar } = useAcao(recarregar)
    const [adicionando, setAdicionando] = useState(false)
    const [editando, setEditando] = useState<string | null>(null)
    const [excluindo, setExcluindo] = useState<string | null>(null)
    const [texto, setTexto] = useState("")
    const [responsavel, setResponsavel] = useState("")

    const podeEditar = pode(PLA_ACOMP.pendEditar)
    const podeExcluir = pode(PLA_ACOMP.pendExcluir)
    const podeFeito = pode(PLA_ACOMP.pendFeito)

    const abrirEdicao = (p: Pendencia | null) => {
        setAdicionando(p === null)
        setEditando(p?.id ?? null)
        setTexto(p?.texto ?? "")
        setResponsavel(p?.responsavel ?? "")
    }
    const fechar = () => { setAdicionando(false); setEditando(null); setTexto(""); setResponsavel("") }
    const salvar = async () => {
        const ok = editando
            ? await executar(() => editarPendencia(supabase, editando, texto, responsavel), "Pendência atualizada")
            : await executar(() => criarPendencia(supabase, projetoId, texto, responsavel), "Pendência adicionada")
        if (ok) fechar()
    }
    const excluir = async (id: string) => {
        if (await executar(() => excluirPendencia(supabase, id), "Pendência excluída")) setExcluindo(null)
    }

    const linhaEdicao = (chave: string) => (
        <tr key={chave} className="border-b align-top">
            <td className="py-2 pr-2">
                <Input value={texto} maxLength={LIMITE_PENDENCIA} disabled={ocupado} aria-label="Pendência" onChange={e => setTexto(e.target.value)} autoFocus />
            </td>
            <td className="py-2 pr-2">
                <Input value={responsavel} maxLength={LIMITE_RESPONSAVEL} disabled={ocupado} aria-label="Responsável" onChange={e => setResponsavel(e.target.value)} />
            </td>
            <td className="py-2" colSpan={2}>
                <div className="flex flex-wrap gap-1">
                    <Button size="sm" onClick={salvar} disabled={ocupado || texto.trim() === ""}>
                        {ocupado ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />} Salvar
                    </Button>
                    <Button size="sm" variant="outline" disabled={ocupado} onClick={fechar}>Cancelar</Button>
                </div>
            </td>
        </tr>
    )

    return (
        <Bloco icone={ListChecks} titulo="Pendências">
            {pendencias.length === 0 && !adicionando ? <Vazio>Nenhuma pendência.</Vazio> : (
                <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                        <thead>
                            <tr className="border-b text-left text-muted-foreground">
                                <th className="py-2 pr-2 font-medium">Pendência</th>
                                <th className="py-2 pr-2 font-medium">Responsável</th>
                                <th className="w-20 py-2 pr-2 text-center font-medium">Feito</th>
                                <th className="w-0 py-2"><span className="sr-only">Ações</span></th>
                            </tr>
                        </thead>
                        <tbody>
                            {pendencias.map(p => editando === p.id ? linhaEdicao(p.id) : (
                                <tr key={p.id} className="border-b align-top">
                                    <td className={cn("py-2 pr-2 whitespace-pre-wrap", p.feito && "text-muted-foreground line-through")}>{p.texto}</td>
                                    <td className="py-2 pr-2">{p.responsavel ?? "—"}</td>
                                    <td className="py-2 pr-2 text-center">
                                        <Checkbox checked={p.feito} disabled={!podeFeito || ocupado} aria-label={`Feito: ${p.texto}`}
                                            onCheckedChange={v => executar(() => marcarPendencia(supabase, p.id, v === true), v === true ? "Pendência concluída" : "Pendência reaberta")} />
                                    </td>
                                    <td className="py-1">
                                        {excluindo === p.id ? (
                                            <div className="flex items-center gap-1 whitespace-nowrap">
                                                <Button size="sm" variant="destructive" disabled={ocupado} onClick={() => excluir(p.id)}>Excluir</Button>
                                                <Button size="sm" variant="outline" disabled={ocupado} onClick={() => setExcluindo(null)}>Cancelar</Button>
                                            </div>
                                        ) : (
                                            <div className="flex gap-1">
                                                {podeEditar && (
                                                    <Button variant="ghost" size="icon" title="Editar" aria-label={`Editar pendência ${p.texto}`} disabled={ocupado} onClick={() => abrirEdicao(p)}>
                                                        <Pencil className="h-4 w-4" />
                                                    </Button>
                                                )}
                                                {podeExcluir && (
                                                    <Button variant="ghost" size="icon" title="Excluir" aria-label={`Excluir pendência ${p.texto}`} disabled={ocupado} onClick={() => setExcluindo(p.id)}>
                                                        <Trash2 className="h-4 w-4 text-muted-foreground" />
                                                    </Button>
                                                )}
                                            </div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                            {adicionando && linhaEdicao("nova")}
                        </tbody>
                    </table>
                </div>
            )}
            {pode(PLA_ACOMP.pendCriar) && !adicionando && editando === null && (
                <Button variant="outline" size="sm" onClick={() => abrirEdicao(null)} disabled={ocupado}>
                    <PlusCircle className="mr-1 h-4 w-4" /> Adicionar pendência
                </Button>
            )}
        </Bloco>
    )
}

// ── Histórico (AC6) ──────────────────────────────────────────────────────────────────────────

const ICONE_EVENTO: Record<string, LucideIcon> = {
    criacao: PlusCircle,
    salvar_projeto: Save,
    ficha_voltou_parcial: Undo2,
    status_alterado: RefreshCw,
    correcao_pedida: Bell,
    correcao_resolvida: CheckCircle2,
    validado: BadgeCheck,
    validacao_retirada: ShieldOff,
    pendencia_criada: ListChecks,
    pendencia_concluida: CircleCheck,
    exclusao: Trash2,
}

function BlocoHistorico({ supabase, projetoId, versao }: { supabase: SupabaseClient; projetoId: string; versao: number }) {
    const [eventos, setEventos] = useState<EventoProjeto[] | null>(null)
    const [total, setTotal] = useState(0)
    const [tudo, setTudo] = useState(false)
    const [carregando, setCarregando] = useState(false)
    const [erro, setErro] = useState<string | null>(null)

    useEffect(() => {
        let cancelado = false
        carregarHistorico(supabase, projetoId, tudo ? null : EVENTOS_POR_PAGINA)
            .then(r => { if (!cancelado) { setEventos(r.eventos); setTotal(r.total); setErro(null) } })
            .catch(e => { if (!cancelado) setErro(erroDe(e)) })
            .finally(() => { if (!cancelado) setCarregando(false) })
        return () => { cancelado = true }
    }, [supabase, projetoId, versao, tudo])

    const itens = eventos ? montarLinhaDoTempo(eventos, dataHoraFortaleza) : []

    return (
        <Bloco icone={History} titulo="Histórico">
            {erro ? <p className="text-sm text-rose-700">Não foi possível carregar o histórico: {erro}</p>
                : eventos === null ? <Vazio>Carregando…</Vazio>
                : itens.length === 0 ? <Vazio>Nenhum evento.</Vazio> : (
                    <ol className="relative space-y-4 border-l pl-6">
                        {itens.map(i => {
                            const Icone = ICONE_EVENTO[i.tipo] ?? Flag
                            return (
                                <li key={i.id} className="relative">
                                    <span className="absolute -left-[35px] flex h-6 w-6 items-center justify-center rounded-full border bg-background">
                                        <Icone className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                                    </span>
                                    <p className="text-sm font-medium">{i.titulo}</p>
                                    {i.descricao && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{i.descricao}</p>}
                                    <p className="text-xs text-muted-foreground">{i.autor} · {i.quando}</p>
                                </li>
                            )
                        })}
                    </ol>
                )}
            {!tudo && eventos !== null && total > eventos.length && (
                <Button variant="outline" size="sm" onClick={() => { setCarregando(true); setTudo(true) }} disabled={carregando}>
                    {carregando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Ver mais ({total - eventos.length})
                </Button>
            )}
        </Bloco>
    )
}
