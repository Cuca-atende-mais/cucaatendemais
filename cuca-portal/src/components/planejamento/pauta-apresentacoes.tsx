"use client"

import { Fragment, useCallback, useEffect, useMemo, useState, type DragEvent } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import toast from "react-hot-toast"
import { AlertTriangle, ArrowDown, ArrowUp, GripVertical, Loader2, Lock, Pencil, Play } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/lib/auth/user-provider"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Switch } from "@/components/ui/switch"
import { Aviso } from "@/components/planejamento/projeto-form"
import { StatusBadge } from "@/components/planejamento/status-projeto"
import { PLA_APRES, PLA_PROJ } from "@/lib/rbac/catalogo-planejamento"
import { ANO_PLANEJAMENTO, rotuloTipo } from "@/lib/planejamento/projeto"
import { MENSAGEM_FICHA_PARCIAL } from "@/lib/planejamento/slides"
import {
    PARAMETRO_ENCERRADOS, montarPauta, mover, moverPara, urlApresentarDaPauta, type BlocoPauta, type ItemPauta,
} from "@/lib/planejamento/pauta"
import { carregarPauta, ordenarProjetosDaPauta, ordenarSetoresDaPauta, type DadosPauta } from "@/lib/planejamento/pauta-dados"
import { carregarSetores, type Setor } from "@/lib/planejamento/projeto-dados"

// S-PLA-06: pauta da reunião anual. Projetos por setor, na ordem em que serão apresentados (a mesma
// para todos), com "Apresentar" abrindo o modo apresentar da S-PLA-05 em sequência. Não muda status
// nem pede aprovação (D4). Não guarda data da reunião.

type Arrasto = { tipo: "setor"; id: string } | { tipo: "projeto"; id: string; setor: string } | null

export function PautaApresentacoes() {
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const supabase = useMemo(() => createClient(), [])
    const { loading: carregandoUsuario, hasPermission } = useUser()
    const podeVer = hasPermission(PLA_APRES.pautaVer, "read")
    const podeOrdenar = hasPermission(PLA_APRES.pautaOrdem, "read")
    // Apresentar abre a página dos slides, que exige "ver os slides" (S-PLA-05).
    const podeApresentar = hasPermission(PLA_APRES.slidesApresentar, "read") && hasPermission(PLA_APRES.slidesVer, "read")
    const podeEditar = hasPermission(PLA_PROJ.editar, "read")

    const mostrarEncerrados = searchParams.get(PARAMETRO_ENCERRADOS) === "1"
    const [setores, setSetores] = useState<Setor[]>([])
    const [dados, setDados] = useState<DadosPauta | null>(null)
    const [erro, setErro] = useState<string | null>(null)
    const [salvando, setSalvando] = useState(false)
    const [alertaParcial, setAlertaParcial] = useState<string | null>(null)
    const [arrasto, setArrasto] = useState<Arrasto>(null)
    const [sobre, setSobre] = useState<string | null>(null)

    const recarregar = useCallback(async () => {
        const d = await carregarPauta(supabase, ANO_PLANEJAMENTO)
        setDados(d)
    }, [supabase])

    useEffect(() => {
        if (carregandoUsuario || !podeVer) return
        let cancelado = false
        Promise.all([carregarSetores(supabase), carregarPauta(supabase, ANO_PLANEJAMENTO)])
            .then(([s, d]) => { if (!cancelado) { setSetores(s); setDados(d) } })
            .catch(e => { if (!cancelado) setErro(e instanceof Error ? e.message : String(e)) })
        return () => { cancelado = true }
    }, [carregandoUsuario, podeVer, supabase])

    const blocos = useMemo<BlocoPauta[]>(() => (dados ? montarPauta({
        setores, projetos: dados.projetos, posicoesSetores: dados.posicoesSetores, posicoesProjetos: dados.posicoesProjetos, mostrarEncerrados,
    }) : []), [dados, setores, mostrarEncerrados])

    const alternarEncerrados = (v: boolean) => {
        router.replace(v ? `${pathname}?${PARAMETRO_ENCERRADOS}=1` : pathname, { scroll: false })
    }

    // Grava a nova ordem do que está na tela; o banco encaixa o que não está (setores de fora do
    // escopo, encerrados escondidos) e a tela recarrega a ordem salva.
    const salvar = async (acao: () => Promise<void>) => {
        setSalvando(true)
        try {
            await acao()
            await recarregar()
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e))
        } finally {
            setSalvando(false)
        }
    }
    const ordenarSetores = (ids: string[]) => salvar(() => ordenarSetoresDaPauta(supabase, ANO_PLANEJAMENTO, ids))
    const ordenarProjetos = (setor: string, ids: string[]) => salvar(() => ordenarProjetosDaPauta(supabase, ANO_PLANEJAMENTO, setor, ids))

    const idsSetores = blocos.map(b => b.setor.id)

    const apresentar = (item: ItemPauta) => {
        if (item.semSlides) { setAlertaParcial(a => (a === item.projeto.id ? null : item.projeto.id)); return }
        // O clique é o gesto que o navegador exige para a tela cheia.
        document.documentElement.requestFullscreen?.().catch(() => undefined)
        router.push(urlApresentarDaPauta(item.projeto.id, mostrarEncerrados))
    }

    // Arrastar e soltar nativo do navegador (sem biblioteca nova). As setas fazem o mesmo.
    const soltar = (e: DragEvent, alvo: Exclude<Arrasto, null>) => {
        e.preventDefault()
        setSobre(null)
        const origem = arrasto
        setArrasto(null)
        if (!origem || origem.tipo !== alvo.tipo || origem.id === alvo.id) return
        if (origem.tipo === "setor") ordenarSetores(moverPara(idsSetores, origem.id, alvo.id))
        else if (alvo.tipo === "projeto" && origem.setor === alvo.setor) {
            const bloco = blocos.find(b => b.setor.id === alvo.setor)
            if (bloco) ordenarProjetos(alvo.setor, moverPara(bloco.itens.map(i => i.projeto.id), origem.id, alvo.id))
        }
    }
    const origem = (alvo: Exclude<Arrasto, null>) => podeOrdenar && !salvando ? {
        draggable: true,
        onDragStart: (e: DragEvent) => { e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; setArrasto(alvo) },
        onDragEnd: () => { setArrasto(null); setSobre(null) },
    } : {}
    const destino = (alvo: Exclude<Arrasto, null>, chave: string) => podeOrdenar && !salvando ? {
        onDragOver: (e: DragEvent) => {
            if (!arrasto || arrasto.tipo !== alvo.tipo || (alvo.tipo === "projeto" && arrasto.tipo === "projeto" && arrasto.setor !== alvo.setor)) return
            e.preventDefault()
            e.stopPropagation()
            setSobre(chave)
        },
        onDrop: (e: DragEvent) => { e.stopPropagation(); soltar(e, alvo) },
    } : {}

    if (carregandoUsuario) return <Skeleton className="h-64 w-full" />
    if (!podeVer) {
        return <Aviso icone={<Lock className="h-8 w-8 text-muted-foreground" />} titulo="Você não tem acesso às Apresentações do Planejamento." texto="Peça a liberação no seu perfil de acesso." />
    }

    return (
        <div className="mx-auto max-w-6xl space-y-4">
            <div className="flex flex-wrap items-center gap-3">
                <div className="mr-auto">
                    <h1 className="text-2xl font-semibold tracking-tight">Apresentações — Planejamento {ANO_PLANEJAMENTO}</h1>
                    <p className="text-sm text-muted-foreground">Pauta da reunião anual, por setor, na ordem de apresentação.</p>
                </div>
                {salvando && <span className="flex items-center gap-1 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Salvando a ordem…</span>}
                <div className="flex items-center gap-2">
                    <Switch id="mostrar-encerrados" checked={mostrarEncerrados} onCheckedChange={alternarEncerrados} />
                    <Label htmlFor="mostrar-encerrados">Mostrar encerrados</Label>
                </div>
            </div>

            {erro ? (
                <Aviso icone={<AlertTriangle className="h-8 w-8 text-rose-600" />} titulo="Não foi possível carregar a pauta." texto={erro} />
            ) : dados === null ? (
                <Skeleton className="h-64 w-full" />
            ) : blocos.length === 0 ? (
                <Aviso titulo="Nenhum projeto na pauta" texto={mostrarEncerrados ? undefined : "Projetos encerrados ficam de fora. Ligue \"Mostrar encerrados\" para vê-los."} />
            ) : (
                blocos.map((bloco, iBloco) => (
                    <Card
                        key={bloco.setor.id}
                        className={cn("overflow-hidden border-l-4 transition", sobre === `s:${bloco.setor.id}` && "ring-2 ring-primary")}
                        style={{ borderLeftColor: bloco.setor.cor }}
                        {...destino({ tipo: "setor", id: bloco.setor.id }, `s:${bloco.setor.id}`)}
                    >
                        <CardContent className="space-y-2 p-0">
                            <div className={cn("flex flex-wrap items-center gap-2 px-4 pt-4", podeOrdenar && "cursor-grab")} {...origem({ tipo: "setor", id: bloco.setor.id })}>
                                {podeOrdenar && <GripVertical className="h-4 w-4 text-muted-foreground" aria-hidden />}
                                <Badge className="text-white" style={{ backgroundColor: bloco.setor.cor }}>{bloco.setor.nome}</Badge>
                                <span className="text-sm text-muted-foreground">{bloco.itens.length === 1 ? "1 projeto" : `${bloco.itens.length} projetos`}</span>
                                {podeOrdenar && (
                                    <div className="ml-auto flex gap-1">
                                        <Button variant="ghost" size="icon" aria-label={`Subir o setor ${bloco.setor.nome}`} disabled={salvando || iBloco === 0}
                                            onClick={() => ordenarSetores(mover(idsSetores, bloco.setor.id, -1))}><ArrowUp className="h-4 w-4" /></Button>
                                        <Button variant="ghost" size="icon" aria-label={`Descer o setor ${bloco.setor.nome}`} disabled={salvando || iBloco === blocos.length - 1}
                                            onClick={() => ordenarSetores(mover(idsSetores, bloco.setor.id, 1))}><ArrowDown className="h-4 w-4" /></Button>
                                    </div>
                                )}
                            </div>
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[720px] text-sm">
                                    <thead>
                                        <tr className="border-b text-left text-muted-foreground">
                                            <th className="w-12 px-4 py-2 font-medium">#</th>
                                            <th className="py-2 pr-2 font-medium">Projeto</th>
                                            <th className="py-2 pr-2 font-medium">Responsável</th>
                                            <th className="py-2 pr-2 font-medium">Tipo</th>
                                            <th className="py-2 pr-2 font-medium">Status</th>
                                            <th className="py-2 pr-4"><span className="sr-only">Ações</span></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {bloco.itens.map((item, i) => {
                                            const ids = bloco.itens.map(x => x.projeto.id)
                                            const chave = `p:${item.projeto.id}`
                                            return (
                                                <Fragment key={item.projeto.id}>
                                                    <tr
                                                        className={cn("border-b align-middle last:border-0", sobre === chave && "bg-primary/5")}
                                                        {...origem({ tipo: "projeto", id: item.projeto.id, setor: bloco.setor.id })}
                                                        {...destino({ tipo: "projeto", id: item.projeto.id, setor: bloco.setor.id }, chave)}
                                                    >
                                                        <td className="px-4 py-2 tabular-nums text-muted-foreground">
                                                            <span className="flex items-center gap-1">
                                                                {podeOrdenar && <GripVertical className="h-3.5 w-3.5 cursor-grab" aria-hidden />}{item.posicao}
                                                            </span>
                                                        </td>
                                                        <td className="py-2 pr-2">
                                                            <Link href={`/planejamento/projeto/${item.projeto.id}`} className="font-medium hover:underline">{item.projeto.nome}</Link>
                                                            <div className="mt-1 flex flex-wrap gap-1">
                                                                {item.semSlides && <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">Salvo parcialmente — sem slides</Badge>}
                                                                {item.encerrado && <Badge variant="secondary">Encerrado</Badge>}
                                                            </div>
                                                        </td>
                                                        <td className="py-2 pr-2">{item.projeto.responsavel_nome ?? "—"}</td>
                                                        <td className="py-2 pr-2">{rotuloTipo(item.projeto.tipo)}</td>
                                                        <td className="py-2 pr-2"><StatusBadge status={item.projeto.status} /></td>
                                                        <td className="py-2 pr-4">
                                                            <div className="flex items-center justify-end gap-1">
                                                                {podeOrdenar && (
                                                                    <>
                                                                        <Button variant="ghost" size="icon" aria-label={`Subir ${item.projeto.nome}`} disabled={salvando || i === 0}
                                                                            onClick={() => ordenarProjetos(bloco.setor.id, mover(ids, item.projeto.id, -1))}><ArrowUp className="h-4 w-4" /></Button>
                                                                        <Button variant="ghost" size="icon" aria-label={`Descer ${item.projeto.nome}`} disabled={salvando || i === bloco.itens.length - 1}
                                                                            onClick={() => ordenarProjetos(bloco.setor.id, mover(ids, item.projeto.id, 1))}><ArrowDown className="h-4 w-4" /></Button>
                                                                    </>
                                                                )}
                                                                {podeApresentar && (
                                                                    <Button size="sm" variant={item.semSlides ? "outline" : "default"} onClick={() => apresentar(item)}>
                                                                        <Play className="mr-1 h-4 w-4" /> Apresentar
                                                                    </Button>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                    {alertaParcial === item.projeto.id && (
                                                        <tr className="border-b bg-amber-50">
                                                            <td colSpan={6} className="px-4 py-3">
                                                                <div className="flex flex-wrap items-center gap-3 text-sm text-amber-900">
                                                                    <AlertTriangle className="h-4 w-4 shrink-0" />
                                                                    <span className="flex-1">{MENSAGEM_FICHA_PARCIAL}</span>
                                                                    {podeEditar && (
                                                                        <Button size="sm" variant="outline" asChild>
                                                                            <Link href={`/planejamento/projeto/${item.projeto.id}/editar`}><Pencil className="mr-1 h-4 w-4" /> Editar projeto</Link>
                                                                        </Button>
                                                                    )}
                                                                    <Button size="sm" variant="ghost" onClick={() => setAlertaParcial(null)}>Fechar</Button>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </Fragment>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </CardContent>
                    </Card>
                ))
            )}
        </div>
    )
}
