"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useParams, usePathname, useRouter, useSearchParams } from "next/navigation"
import toast from "react-hot-toast"
import { AlertTriangle, ArrowLeft, ChevronLeft, ChevronRight, FileDown, Loader2, Lock, Maximize, Pencil, Play, X } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/lib/auth/user-provider"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Aviso } from "@/components/planejamento/projeto-form"
import { SlideTela } from "@/components/planejamento/slide-tela"
import { exportarSlidesPdf } from "@/components/planejamento/exportar-pdf"
import { PLA_APRES, PLA_PROJ } from "@/lib/rbac/catalogo-planejamento"
import {
    MENSAGEM_FICHA_PARCIAL, PARAMETRO_APRESENTAR, acaoDaTecla, montarSlides, navegar, type Apresentacao, type DadosSlides,
} from "@/lib/planejamento/slides"
import { carregarProjeto, carregarSetores, carregarUnidades } from "@/lib/planejamento/projeto-dados"

// S-PLA-05 (AC1, AC2, AC2a, AC6, AC7): página dos slides do projeto. Gerados na hora a partir da ficha
// gravada (nada é guardado). Ficha parcial: nenhum slide, só o alerta, inclusive aberta direto pelo
// endereço do modo apresentar. Os dados vêm da mesma leitura do projeto (RLS de setor da S-PLA-02).

type Estado = { fase: "carregando" } | { fase: "nao_encontrado" } | { fase: "erro"; mensagem: string } | { fase: "pronto"; dados: DadosSlides }

const urlProjeto = (id: string) => `/planejamento/projeto/${id}`

export function ApresentacaoProjeto() {
    const params = useParams()
    const id = params.id as string
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const supabase = useMemo(() => createClient(), [])
    const { loading: carregandoUsuario, hasPermission } = useUser()
    const podeVer = hasPermission(PLA_APRES.slidesVer, "read")
    const podeApresentar = hasPermission(PLA_APRES.slidesApresentar, "read")
    const podePdf = hasPermission(PLA_APRES.slidesPdf, "read")
    const podeEditar = hasPermission(PLA_PROJ.editar, "read")

    const [estado, setEstado] = useState<Estado>({ fase: "carregando" })
    const [atual, setAtual] = useState(0)
    const [exportando, setExportando] = useState(false)
    const topo = useRef<HTMLDivElement>(null)

    useEffect(() => {
        if (carregandoUsuario || !podeVer) return
        let cancelado = false
        ;(async () => {
            try {
                const [p, setores, unidades] = await Promise.all([carregarProjeto(supabase, id), carregarSetores(supabase), carregarUnidades(supabase)])
                if (cancelado) return
                if (!p) { setEstado({ fase: "nao_encontrado" }); return }
                const setor = setores.find(s => s.id === p.linha.setor_id)
                setEstado({ fase: "pronto", dados: { projeto: p.linha, filhas: p.filhas, setor: setor ? { id: setor.id, nome: setor.nome, cor: setor.cor } : null, unidades } })
            } catch (e) {
                if (!cancelado) setEstado({ fase: "erro", mensagem: e instanceof Error ? e.message : String(e) })
            }
        })()
        return () => { cancelado = true }
    }, [carregandoUsuario, podeVer, id, supabase])

    const resultado = useMemo(() => (estado.fase === "pronto" ? montarSlides(estado.dados, "tela") : null), [estado])
    const apresentacao = resultado?.tipo === "ok" ? resultado : null
    const total = apresentacao?.slides.length ?? 0
    const indice = Math.min(atual, Math.max(total - 1, 0))

    // Modo apresentar: pelo endereço (?apresentar=1), só com a permissão e com slides (ficha final).
    const pedeApresentar = searchParams.get(PARAMETRO_APRESENTAR) === "1"
    const apresentando = pedeApresentar && podeApresentar && apresentacao !== null

    const sair = useCallback(() => {
        if (typeof document !== "undefined" && document.fullscreenElement) document.exitFullscreen().catch(() => undefined)
        router.replace(pathname, { scroll: false })
    }, [router, pathname])

    // O clique em "Apresentar" é o gesto que o navegador exige para a tela cheia.
    const apresentar = () => {
        document.documentElement.requestFullscreen?.().catch(() => undefined)
        router.replace(`${pathname}?${PARAMETRO_APRESENTAR}=1`, { scroll: false })
    }

    const exportar = async () => {
        if (estado.fase !== "pronto") return
        setExportando(true)
        try {
            const nome = await exportarSlidesPdf(estado.dados)
            toast.success(`Arquivo ${nome} gerado`)
        } catch (e) {
            toast.error(e instanceof Error ? e.message : "Erro ao gerar o PDF.")
        } finally {
            setExportando(false)
        }
    }

    const irPara = (i: number) => {
        setAtual(i)
        topo.current?.scrollIntoView({ behavior: "smooth", block: "start" })
    }

    const voltar = <Button variant="outline" asChild><Link href={urlProjeto(id)}><ArrowLeft className="mr-1 h-4 w-4" /> Voltar ao projeto</Link></Button>

    if (carregandoUsuario) return <Skeleton className="h-96 w-full" />
    if (!podeVer) {
        return <Aviso icone={<Lock className="h-8 w-8 text-muted-foreground" />} titulo="Você não tem acesso aos slides do Planejamento." texto="Peça a liberação no seu perfil de acesso." acao={voltar} />
    }
    if (estado.fase === "carregando") return <Skeleton className="aspect-video w-full" />
    if (estado.fase === "nao_encontrado") return <Aviso titulo="Projeto não encontrado" acao={<Button variant="outline" onClick={() => router.push("/planejamento")}>Voltar para Projetos</Button>} />
    if (estado.fase === "erro") return <Aviso icone={<AlertTriangle className="h-8 w-8 text-rose-600" />} titulo="Não foi possível abrir os slides." texto={estado.mensagem} acao={voltar} />

    // AC2a: ficha parcial, nenhum slide. Vale também para quem chegou pelo endereço do modo apresentar.
    if (!apresentacao) {
        return (
            <Aviso
                icone={<AlertTriangle className="h-8 w-8 text-amber-600" />}
                titulo={MENSAGEM_FICHA_PARCIAL}
                acao={
                    <div className="flex flex-wrap justify-center gap-2">
                        {podeEditar && <Button asChild><Link href={`${urlProjeto(id)}/editar`}><Pencil className="mr-1 h-4 w-4" /> Editar projeto</Link></Button>}
                        {voltar}
                    </div>
                }
            />
        )
    }

    const slide = apresentacao.slides[indice]

    return (
        <div className="mx-auto max-w-6xl space-y-4" ref={topo}>
            <div className="flex flex-wrap items-center gap-2">
                <div className="mr-auto min-w-0">
                    <p className="text-sm text-muted-foreground">Slides</p>
                    <h1 className="truncate text-2xl font-semibold tracking-tight">{estado.dados.projeto.nome}</h1>
                </div>
                {voltar}
                {podeApresentar && <Button onClick={apresentar}><Play className="mr-1 h-4 w-4" /> Apresentar</Button>}
                {podePdf && (
                    <Button variant="outline" onClick={exportar} disabled={exportando}>
                        {exportando ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <FileDown className="mr-1 h-4 w-4" />} Exportar PDF
                    </Button>
                )}
            </div>

            {/* Slide atual, 16:9, centralizado */}
            <div className="overflow-hidden rounded-lg border shadow-sm">
                <SlideTela slide={slide} a={apresentacao} numero={indice + 1} total={total} />
            </div>
            <div className="flex items-center justify-center gap-3">
                <Button variant="outline" size="icon" aria-label="Slide anterior" disabled={indice === 0} onClick={() => setAtual(navegar(indice, total, "anterior"))}>
                    <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-16 text-center text-sm tabular-nums text-muted-foreground">{indice + 1} / {total}</span>
                <Button variant="outline" size="icon" aria-label="Próximo slide" disabled={indice === total - 1} onClick={() => setAtual(navegar(indice, total, "proximo"))}>
                    <ChevronRight className="h-4 w-4" />
                </Button>
            </div>

            {/* Miniaturas de todos os slides */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {apresentacao.slides.map((s, i) => (
                    <button
                        key={s.id}
                        type="button"
                        onClick={() => irPara(i)}
                        aria-current={i === indice}
                        aria-label={`Ir para o slide ${i + 1}: ${s.titulo}`}
                        className={cn("group space-y-1 text-left focus-visible:outline-none", i === indice && "font-medium")}
                    >
                        <div className={cn("pointer-events-none overflow-hidden rounded-md border transition group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-ring", i === indice && "ring-2 ring-primary")}>
                            <SlideTela slide={s} a={apresentacao} numero={i + 1} total={total} />
                        </div>
                        <span className="block truncate text-xs text-muted-foreground">{i + 1}. {s.titulo}</span>
                    </button>
                ))}
            </div>

            {apresentando && <ModoApresentar apresentacao={apresentacao} inicial={indice} onSair={sair} onIndice={setAtual} />}
        </div>
    )
}

// ── Modo apresentar (AC6) ───────────────────────────────────────────────────────────────────

const CURSOR_SOME_EM_MS = 2500

function ModoApresentar({ apresentacao, inicial, onSair, onIndice }: {
    apresentacao: Apresentacao; inicial: number; onSair: () => void; onIndice: (i: number) => void
}) {
    const total = apresentacao.slides.length
    const [i, setI] = useState(inicial)
    const [cursor, setCursor] = useState(true)
    const [telaCheia, setTelaCheia] = useState(() => typeof document !== "undefined" && !!document.fullscreenElement)
    const esteveEmTelaCheia = useRef(telaCheia)
    const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)

    const ir = useCallback((novo: number) => { setI(novo); onIndice(novo) }, [onIndice])

    // Teclado: setas e espaço navegam, Esc sai (em tela cheia, o Esc do navegador sai da tela cheia
    // e o aviso de "fullscreenchange" abaixo fecha o modo).
    useEffect(() => {
        const aoTeclar = (e: KeyboardEvent) => {
            const acao = acaoDaTecla(e.key)
            if (!acao) return
            e.preventDefault()
            if (acao === "sair") onSair()
            else ir(navegar(i, total, acao))
        }
        window.addEventListener("keydown", aoTeclar)
        return () => window.removeEventListener("keydown", aoTeclar)
    }, [i, total, ir, onSair])

    useEffect(() => {
        const aoMudar = () => {
            const agora = !!document.fullscreenElement
            setTelaCheia(agora)
            if (agora) esteveEmTelaCheia.current = true
            else if (esteveEmTelaCheia.current) onSair()
        }
        document.addEventListener("fullscreenchange", aoMudar)
        return () => document.removeEventListener("fullscreenchange", aoMudar)
    }, [onSair])

    // Cursor some depois de alguns segundos parado.
    const mexeu = useCallback(() => {
        setCursor(true)
        if (temporizador.current) clearTimeout(temporizador.current)
        temporizador.current = setTimeout(() => setCursor(false), CURSOR_SOME_EM_MS)
    }, [])
    useEffect(() => {
        temporizador.current = setTimeout(() => setCursor(false), CURSOR_SOME_EM_MS)
        return () => { if (temporizador.current) clearTimeout(temporizador.current) }
    }, [])

    // Sem rolar a página por baixo enquanto apresenta.
    useEffect(() => {
        const antes = document.body.style.overflow
        document.body.style.overflow = "hidden"
        return () => { document.body.style.overflow = antes }
    }, [])

    const slide = apresentacao.slides[i]
    const pararClique = (e: React.MouseEvent) => e.stopPropagation()

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-label="Apresentação dos slides"
            className={cn("fixed inset-0 z-[200] flex select-none items-center justify-center bg-black", !cursor && "cursor-none")}
            onMouseMove={mexeu}
            onClick={() => ir(navegar(i, total, "proximo"))}
        >
            <div style={{ width: "min(100vw, calc(100vh * 16 / 9))" }}>
                <SlideTela slide={slide} a={apresentacao} numero={i + 1} total={total} />
            </div>

            <div className={cn("absolute right-3 top-3 flex gap-2 transition-opacity", cursor ? "opacity-100" : "opacity-0")} onClick={pararClique}>
                {!telaCheia && (
                    <Button size="sm" variant="secondary" onClick={() => document.documentElement.requestFullscreen?.().catch(() => toast.error("O navegador não liberou a tela cheia."))}>
                        <Maximize className="mr-1 h-4 w-4" /> Tela cheia
                    </Button>
                )}
                <Button size="sm" variant="secondary" onClick={onSair}><X className="mr-1 h-4 w-4" /> Sair (Esc)</Button>
            </div>

            <span className="absolute bottom-3 right-4 text-sm tabular-nums text-white/70">{i + 1} / {total}</span>
            <div className="absolute inset-x-0 bottom-0 h-1 bg-white/15">
                <div className="h-full transition-all" style={{ width: `${((i + 1) / total) * 100}%`, background: apresentacao.cor }} />
            </div>
        </div>
    )
}
