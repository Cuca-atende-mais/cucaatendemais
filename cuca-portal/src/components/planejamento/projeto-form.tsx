"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useRouter } from "next/navigation"
import {
    AlertTriangle, ArrowLeft, CalendarDays, FolderKanban, Loader2, Lock, LogOut, Plus, Repeat, Save, Trash2, CheckCircle2,
} from "lucide-react"
import toast from "react-hot-toast"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/lib/auth/user-provider"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import {
    AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { StatusBadge } from "@/components/planejamento/status-projeto"
import { PLA_PROJ } from "@/lib/rbac/catalogo-planejamento"
import {
    ANO_PLANEJAMENTO, CATEGORIAS_ORCAMENTO, FREQUENCIAS, SECOES, SITUACOES_2026, TIPOS_PROJETO, ULTIMA_SECAO,
    bloco2026Visivel, camposDaSituacao, errosDeValidacao, formDeLinha, formVazio, formatarReais, mensagemObrigatorios,
    mostrarSalvarProjeto, nomePadraoResponsavel, obrigatoriosFaltando, percentualPreenchido, primeiraSecaoIncompleta, secoesVisiveis,
    sugerirDuracao, totalLinhaOrcamento, totalOrcamento,
    type EstadoFicha, type FormProjeto, type IdSecao, type ModoGravacao, type StatusProjeto, type TipoProjeto,
} from "@/lib/planejamento/projeto"
import {
    carregarProjeto, carregarSetores, carregarSetoresPermitidos, carregarTelefoneDoUsuario, carregarUnidades,
    horaFortaleza, salvarProjeto, type Setor, type Unidade,
} from "@/lib/planejamento/projeto-dados"
import { useGuardaSaida } from "./use-guarda-saida"

// S-PLA-02: formulário da ficha, o mesmo para criar (/planejamento/novo) e editar
// (/planejamento/projeto/[id]/editar). Sem salvamento automático (D3): só "Salvar parcial",
// "Salvar projeto" e o "Salvar" da caixa de saída gravam.

const ICONE_TIPO: Record<TipoProjeto, ReactNode> = {
    evento_pontual: <CalendarDays className="h-6 w-6" />,
    atividade_continua: <Repeat className="h-6 w-6" />,
    projeto: <FolderKanban className="h-6 w-6" />,
}

const MSG_SEM_CADASTRO = "Seu usuário não tem cadastro de colaborador. Peça o cadastro a quem administra os colaboradores"

type Estado =
    | { fase: "carregando" }
    | { fase: "sem_permissao" }
    | { fase: "nao_encontrado" }
    | { fase: "erro"; mensagem: string }
    | { fase: "pronto" }

type CaixaSaida = { aberta: boolean; destino: string; erro: string | null; salvando: boolean }

const urlProjeto = (id: string) => `/planejamento/projeto/${id}`

export function ProjetoForm({ projetoId: idInicial }: { projetoId: string | null }) {
    const router = useRouter()
    const supabase = useMemo(() => createClient(), [])
    const { user, profile, loading: carregandoUsuario, hasPermission } = useUser()

    const [estado, setEstado] = useState<Estado>({ fase: "carregando" })
    const [projetoId, setProjetoId] = useState<string | null>(idInicial)
    const [form, setForm] = useState<FormProjeto>(formVazio())
    const [salvo, setSalvo] = useState<string>(JSON.stringify(formVazio()))
    const [status, setStatus] = useState<StatusProjeto | null>(null)
    const [ficha, setFicha] = useState<EstadoFicha | null>(null)
    const [nomeOriginal, setNomeOriginal] = useState("")
    const [setores, setSetores] = useState<Setor[]>([])
    const [unidades, setUnidades] = useState<Unidade[]>([])
    const [duracaoManual, setDuracaoManual] = useState(false)
    const [salvando, setSalvando] = useState<ModoGravacao | null>(null)
    const [salvoAs, setSalvoAs] = useState<string | null>(null)
    const [erro, setErro] = useState<string | null>(null)
    const [alertaSlides, setAlertaSlides] = useState(false)
    const [secaoAtiva, setSecaoAtiva] = useState<IdSecao>(1)
    const [chegouUltima, setChegouUltima] = useState(false)
    const [jaMostrouSalvarProjeto, setJaMostrouSalvarProjeto] = useState(false)
    const [caixa, setCaixa] = useState<CaixaSaida>({ aberta: false, destino: "", erro: null, salvando: false })
    const refsSecao = useRef<Partial<Record<IdSecao, HTMLElement | null>>>({})

    const podeCriar = hasPermission(PLA_PROJ.criar, "read")
    const podeEditar = hasPermission(PLA_PROJ.editar, "read")
    const ehNovo = idInicial === null

    // ── Carga ──────────────────────────────────────────────────────────────────────────────
    useEffect(() => {
        if (carregandoUsuario) return
        if (ehNovo && !podeCriar) { setEstado({ fase: "sem_permissao" }); return }
        if (!ehNovo && !podeEditar) {
            toast.error("Você não tem permissão para editar este projeto")
            router.replace(urlProjeto(idInicial))
            return
        }
        let cancelado = false
        ;(async () => {
            try {
                const todos = await carregarSetores(supabase)
                const [permitidos, unids] = await Promise.all([carregarSetoresPermitidos(supabase, todos), carregarUnidades(supabase)])
                if (cancelado) return
                setSetores(permitidos)
                setUnidades(unids)

                if (ehNovo) {
                    const telefone = user ? await carregarTelefoneDoUsuario(supabase, user.id) : ""
                    if (cancelado) return
                    const inicial = formVazio({
                        responsavel_nome: nomePadraoResponsavel(profile?.nome_completo, user?.email),
                        responsavel_contato: telefone,
                        setor_id: permitidos.length === 1 ? permitidos[0].id : "",
                    })
                    setForm(inicial)
                    setSalvo(JSON.stringify(inicial))
                } else {
                    const carregado = await carregarProjeto(supabase, idInicial)
                    if (cancelado) return
                    if (!carregado) { setEstado({ fase: "nao_encontrado" }); return }
                    const f = formDeLinha(carregado.linha, carregado.filhas)
                    setForm(f)
                    setSalvo(JSON.stringify(f))
                    setStatus(carregado.linha.status)
                    setFicha(carregado.linha.ficha)
                    setNomeOriginal(carregado.linha.nome)
                    setDuracaoManual(f.duracao !== "" && f.duracao !== sugerirDuracao(f.data_inicio, f.data_fim, f.periodo_ano_todo))
                }
                setEstado({ fase: "pronto" })
            } catch (e) {
                if (!cancelado) setEstado({ fase: "erro", mensagem: e instanceof Error ? e.message : String(e) })
            }
        })()
        return () => { cancelado = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [carregandoUsuario, idInicial])

    const sujo = estado.fase === "pronto" && JSON.stringify(form) !== salvo
    const semSetorPossivel = estado.fase === "pronto" && setores.length === 0
    const setorTravado = setores.length === 1
    const visiveis = secoesVisiveis(form.situacao_2026)
    const faltam = obrigatoriosFaltando(form)
    const percentual = percentualPreenchido(form)
    const exibirSalvarProjeto = mostrarSalvarProjeto({
        obrigatoriosOk: faltam.length === 0, chegouUltimaSecao: chegouUltima, jaMostrado: jaMostrouSalvarProjeto || ficha === "final",
    })
    useEffect(() => {
        if (exibirSalvarProjeto && !jaMostrouSalvarProjeto) setJaMostrouSalvarProjeto(true)
    }, [exibirSalvarProjeto, jaMostrouSalvarProjeto])

    // ── Índice: seção visível e chegada na última seção ──────────────────────────────────────
    useEffect(() => {
        if (estado.fase !== "pronto") return
        const obs = new IntersectionObserver(entradas => {
            const visiveisAgora = entradas.filter(e => e.isIntersecting)
            for (const e of visiveisAgora) {
                const id = Number((e.target as HTMLElement).dataset.secao) as IdSecao
                if (id === ULTIMA_SECAO) setChegouUltima(true)
            }
            if (visiveisAgora.length > 0) {
                const topo = visiveisAgora.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
                setSecaoAtiva(Number((topo.target as HTMLElement).dataset.secao) as IdSecao)
            }
        }, { rootMargin: "-10% 0px -55% 0px" })
        for (const el of Object.values(refsSecao.current)) if (el) obs.observe(el)
        return () => obs.disconnect()
    }, [estado.fase, form.situacao_2026])

    const registrarSecao = useCallback((id: IdSecao, el: HTMLElement | null) => { refsSecao.current[id] = el }, [])

    const irParaSecao = (id: IdSecao) => {
        refsSecao.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" })
        setSecaoAtiva(id)
    }

    // ── Edição de campos ────────────────────────────────────────────────────────────────────
    const mudar = <K extends keyof FormProjeto>(campo: K, valor: FormProjeto[K]) => {
        setForm(f => {
            const novo = { ...f, [campo]: valor }
            if (!duracaoManual && (campo === "data_inicio" || campo === "data_fim" || campo === "periodo_ano_todo")) {
                novo.duracao = sugerirDuracao(novo.data_inicio, novo.data_fim, novo.periodo_ano_todo)
            }
            return novo
        })
    }

    // ── Gravação ────────────────────────────────────────────────────────────────────────────
    // Devolve o id gravado ou a mensagem de erro. Nunca descarta o que foi digitado.
    const gravar = useCallback(async (modo: ModoGravacao): Promise<{ id: string; eraNovo: boolean; hora: string; erro?: undefined } | { id?: undefined; erro: string }> => {
        const msgObrig = mensagemObrigatorios(obrigatoriosFaltando(form))
        if (msgObrig) return { erro: msgObrig }
        if (semSetorPossivel) return { erro: MSG_SEM_CADASTRO }
        const erros = errosDeValidacao(form)
        if (erros.length > 0) return { erro: erros.map(e => e.mensagem).join(" ") }
        try {
            const r = await salvarProjeto(supabase, projetoId, modo, form)
            const eraNovo = projetoId === null
            setProjetoId(r.id)
            setSalvo(JSON.stringify(form))
            setStatus(r.status)
            setFicha(r.ficha)
            setNomeOriginal(form.nome)
            const hora = horaFortaleza(r.atualizado_em)
            setSalvoAs(hora)
            if (r.ficha_anterior === "final" && r.ficha === "parcial") setAlertaSlides(true)
            if (r.ficha === "final") setAlertaSlides(false)
            return { id: r.id, eraNovo, hora }
        } catch (e) {
            return { erro: e instanceof Error ? e.message : String(e) }
        }
    }, [form, projetoId, semSetorPossivel, supabase])

    const salvarParcial = async () => {
        setSalvando("parcial"); setErro(null)
        const r = await gravar("parcial")
        setSalvando(null)
        if (r.erro !== undefined) { setErro(r.erro); toast.error(r.erro); return }
        // 1ª gravação: a URL passa a ser a de edição (AC6). Navegação de verdade (não só trocar o endereço),
        // para que recarregar ou voltar pelo navegador abra o projeto gravado, nunca um "Novo projeto" em branco.
        if (r.eraNovo) {
            toast.success(`Salvo às ${r.hora}`)
            router.replace(`${urlProjeto(r.id)}/editar`)
        }
    }

    const salvarFinal = async () => {
        setSalvando("final"); setErro(null)
        const r = await gravar("final")
        if (r.erro !== undefined) { setSalvando(null); setErro(r.erro); toast.error(r.erro); return }
        toast.success("Projeto salvo. Os slides já estão disponíveis")
        // Projeto novo: troca a entrada de /novo, para o voltar do navegador não reabrir o formulário em branco.
        if (r.eraNovo) router.replace(urlProjeto(r.id))
        else router.push(urlProjeto(r.id))
    }

    // ── Saída ───────────────────────────────────────────────────────────────────────────────
    const destinoSair = projetoId ? urlProjeto(projetoId) : "/planejamento"
    const tentarSair = useCallback((destino: string) => {
        if (!sujo) { router.push(destino); return }
        setCaixa({ aberta: true, destino, erro: null, salvando: false })
    }, [sujo, router])
    useGuardaSaida(sujo, tentarSair)

    const salvarESair = async () => {
        setCaixa(c => ({ ...c, salvando: true, erro: null }))
        const r = await gravar("manter")
        if (r.erro !== undefined) { const erroGravacao = r.erro; setCaixa(c => ({ ...c, salvando: false, erro: erroGravacao })); return }
        const destino = caixa.destino
        setCaixa({ aberta: false, destino: "", erro: null, salvando: false })
        router.push(destino)
    }

    const sairSemSalvar = () => {
        const destino = caixa.destino
        setSalvo(JSON.stringify(form)) // desarma a guarda antes de navegar
        setCaixa({ aberta: false, destino: "", erro: null, salvando: false })
        router.push(destino)
    }

    // ── Estados de carga ────────────────────────────────────────────────────────────────────
    if (carregandoUsuario || estado.fase === "carregando") return <Skeleton className="h-96 w-full" />
    if (estado.fase === "sem_permissao") {
        return (
            <Aviso icone={<Lock className="h-8 w-8 text-muted-foreground" />} titulo="Você não tem permissão para criar projetos."
                texto="Peça a liberação no seu perfil de acesso." acao={<Button variant="outline" onClick={() => router.push("/planejamento")}>Voltar para Projetos</Button>} />
        )
    }
    if (estado.fase === "nao_encontrado") {
        return <Aviso titulo="Projeto não encontrado" acao={<Button variant="outline" onClick={() => router.push("/planejamento")}>Voltar para Projetos</Button>} />
    }
    if (estado.fase === "erro") {
        return <Aviso icone={<AlertTriangle className="h-8 w-8 text-rose-600" />} titulo="Não foi possível abrir o formulário." texto={estado.mensagem} />
    }

    const sit = camposDaSituacao(form.situacao_2026)
    const secoesDoIndice = SECOES.filter(s => visiveis.includes(s.id))
    const titulo = ehNovo && projetoId === null ? `Novo projeto — Planejamento ${ANO_PLANEJAMENTO}` : `Editar: ${nomeOriginal || form.nome}`
    const ocupado = salvando !== null

    return (
        <div className="mx-auto max-w-6xl">
            {/* Cabeçalho */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
                <Button variant="ghost" size="sm" onClick={() => tentarSair(destinoSair)}>
                    <ArrowLeft className="mr-1 h-4 w-4" /> Voltar
                </Button>
                <h1 className="flex-1 text-2xl font-semibold tracking-tight">{titulo}</h1>
                {status && <StatusBadge status={status} />}
                <button
                    type="button"
                    onClick={() => { const s = primeiraSecaoIncompleta(form); if (s) irParaSecao(s) }}
                    className="rounded-full border px-3 py-1 text-sm text-muted-foreground hover:bg-accent"
                    title="Ir para a primeira seção com campo vazio"
                >
                    Ficha {percentual}% preenchida
                </button>
            </div>

            {semSetorPossivel && (
                <div className="mb-4 flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {MSG_SEM_CADASTRO}.
                </div>
            )}
            {alertaSlides && (
                <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    Projeto salvo parcialmente. Os slides deste projeto ficam indisponíveis até um novo Salvar projeto
                </div>
            )}

            {/* Índice em tela estreita: barra no topo */}
            <nav className="sticky top-0 z-10 -mx-2 mb-4 flex gap-2 overflow-x-auto border-b bg-background px-2 py-2 lg:hidden">
                {secoesDoIndice.map(s => (
                    <button key={s.id} type="button" onClick={() => irParaSecao(s.id)}
                        className={cn("whitespace-nowrap rounded-full px-3 py-1 text-xs", secaoAtiva === s.id ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                        {s.id}. {s.titulo}
                    </button>
                ))}
            </nav>

            <div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-6">
                {/* Índice fixo à esquerda */}
                <nav className="sticky top-4 hidden self-start lg:block">
                    <ol className="space-y-1 text-sm">
                        {secoesDoIndice.map(s => (
                            <li key={s.id}>
                                <button type="button" onClick={() => irParaSecao(s.id)}
                                    className={cn("w-full rounded-md px-3 py-2 text-left", secaoAtiva === s.id ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-accent")}>
                                    {s.id}. {s.titulo}
                                </button>
                            </li>
                        ))}
                    </ol>
                </nav>

                <div className="min-w-0 space-y-6 pb-4">
                    {/* 1. Identificação */}
                    <Secao id={1} registrar={registrarSecao}>
                        <Campo rotulo="Nome do projeto/atividade" obrigatorio>
                            <Input value={form.nome} onChange={e => mudar("nome", e.target.value)} maxLength={200} />
                        </Campo>
                        <Campo rotulo="Tipo" obrigatorio>
                            <div className="grid gap-3 sm:grid-cols-3">
                                {TIPOS_PROJETO.map(t => (
                                    <button key={t.valor} type="button" onClick={() => mudar("tipo", t.valor)} aria-pressed={form.tipo === t.valor}
                                        className={cn("flex flex-col items-center gap-2 rounded-lg border-2 p-4 text-sm font-medium transition-colors",
                                            form.tipo === t.valor ? "border-primary bg-primary/5 text-primary" : "border-border hover:bg-accent")}>
                                        {ICONE_TIPO[t.valor]} {t.rotulo}
                                    </button>
                                ))}
                            </div>
                        </Campo>
                        <Campo rotulo="Setor" obrigatorio>
                            <Select value={form.setor_id} onValueChange={v => mudar("setor_id", v)} disabled={setorTravado || semSetorPossivel}>
                                <SelectTrigger className="w-full sm:w-80"><SelectValue placeholder="Escolha o setor" /></SelectTrigger>
                                <SelectContent>
                                    {setores.map(s => (
                                        <SelectItem key={s.id} value={s.id}>
                                            <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.cor }} />{s.nome}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </Campo>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Campo rotulo="Responsável pelo projeto">
                                <Input value={form.responsavel_nome} onChange={e => mudar("responsavel_nome", e.target.value)} />
                            </Campo>
                            <Campo rotulo="Contato do responsável">
                                <Input value={form.responsavel_contato} onChange={e => mudar("responsavel_contato", e.target.value)} />
                            </Campo>
                        </div>
                    </Secao>

                    {/* 2. Relação com 2026 */}
                    <Secao id={2} registrar={registrarSecao}>
                        <Campo rotulo="Situação">
                            <div className="flex flex-wrap gap-2">
                                {SITUACOES_2026.map(s => (
                                    <Opcao key={s.valor} ativo={form.situacao_2026 === s.valor} onClick={() => mudar("situacao_2026", s.valor)}>{s.rotulo}</Opcao>
                                ))}
                            </div>
                        </Campo>
                        {sit.mudancas && (
                            <Campo rotulo="O que muda em relação a 2026">
                                <Textarea value={form.mudancas_2026} onChange={e => mudar("mudancas_2026", e.target.value)} rows={3} />
                            </Campo>
                        )}
                        {sit.justificativa && (
                            <Campo rotulo={sit.rotuloJustificativa}>
                                <Textarea value={form.justificativa_2026} onChange={e => mudar("justificativa_2026", e.target.value)} rows={3} />
                            </Campo>
                        )}
                    </Secao>

                    {visiveis.includes(3) && (
                        <Secao id={3} registrar={registrarSecao}>
                            <Campo rotulo="Objetivo geral">
                                <Textarea value={form.objetivo_geral} onChange={e => mudar("objetivo_geral", e.target.value)} rows={3} />
                            </Campo>
                            <Campo rotulo="Objetivos específicos">
                                <div className="space-y-2">
                                    {form.objetivos.map((o, i) => (
                                        <div key={i} className="flex gap-2">
                                            <Input value={o} onChange={e => mudar("objetivos", form.objetivos.map((x, j) => j === i ? e.target.value : x))} />
                                            <Lixeira onClick={() => mudar("objetivos", form.objetivos.filter((_, j) => j !== i))} />
                                        </div>
                                    ))}
                                    <Button type="button" variant="outline" size="sm" onClick={() => mudar("objetivos", [...form.objetivos, ""])}>
                                        <Plus className="mr-1 h-4 w-4" /> Adicionar objetivo
                                    </Button>
                                </div>
                            </Campo>
                            <Campo rotulo="Público-alvo">
                                <Input value={form.publico_alvo} onChange={e => mudar("publico_alvo", e.target.value)} />
                            </Campo>
                            <div className="grid gap-4 sm:grid-cols-2">
                                <Campo rotulo="Faixa etária">
                                    <div className="flex items-center gap-2 text-sm">
                                        de <Input className="w-20" inputMode="numeric" value={form.faixa_etaria_min} onChange={e => mudar("faixa_etaria_min", e.target.value)} />
                                        a <Input className="w-20" inputMode="numeric" value={form.faixa_etaria_max} onChange={e => mudar("faixa_etaria_max", e.target.value)} /> anos
                                    </div>
                                </Campo>
                                <Campo rotulo="Nº estimado de participantes">
                                    <Input className="w-40" inputMode="numeric" value={form.participantes_estimados} onChange={e => mudar("participantes_estimados", e.target.value)} />
                                </Campo>
                            </div>
                        </Secao>
                    )}

                    {visiveis.includes(4) && (
                        <Secao id={4} registrar={registrarSecao}>
                            <Campo rotulo="Período">
                                <label className="mb-2 flex items-center gap-2 text-sm">
                                    <Checkbox checked={form.periodo_ano_todo} onCheckedChange={v => mudar("periodo_ano_todo", v === true)} /> Ano todo
                                </label>
                                {!form.periodo_ano_todo && (
                                    <div className="flex flex-wrap items-center gap-2 text-sm">
                                        de <Input type="date" className="w-44" min={`${ANO_PLANEJAMENTO}-01-01`} max={`${ANO_PLANEJAMENTO}-12-31`}
                                            value={form.data_inicio} onChange={e => mudar("data_inicio", e.target.value)} />
                                        até <Input type="date" className="w-44" min={form.data_inicio || `${ANO_PLANEJAMENTO}-01-01`} max={`${ANO_PLANEJAMENTO}-12-31`}
                                            value={form.data_fim} onChange={e => mudar("data_fim", e.target.value)} />
                                    </div>
                                )}
                            </Campo>
                            <Campo rotulo="Duração total">
                                <Input className="sm:w-60" value={form.duracao} placeholder="ex.: 3 meses"
                                    onChange={e => { setDuracaoManual(true); mudar("duracao", e.target.value) }} />
                            </Campo>
                            <Campo rotulo="Frequência">
                                <div className="flex flex-wrap gap-2">
                                    {FREQUENCIAS.map(f => (
                                        <Opcao key={f.valor} ativo={form.frequencia === f.valor} onClick={() => mudar("frequencia", f.valor)}>{f.rotulo}</Opcao>
                                    ))}
                                </div>
                                {form.frequencia === "outra" && (
                                    <Input className="mt-2" placeholder="Qual frequência?" value={form.frequencia_outra} onChange={e => mudar("frequencia_outra", e.target.value)} />
                                )}
                            </Campo>
                            <Campo rotulo="Dias e horários">
                                <Input value={form.dias_horarios} onChange={e => mudar("dias_horarios", e.target.value)} />
                            </Campo>
                            <Campo rotulo="Local">
                                <div className="grid gap-2 sm:grid-cols-2">
                                    {unidades.map(u => (
                                        <label key={u.id} className="flex items-center gap-2 text-sm">
                                            <Checkbox checked={form.locais_unidades.includes(u.id)}
                                                onCheckedChange={v => mudar("locais_unidades", v === true ? [...form.locais_unidades, u.id] : form.locais_unidades.filter(x => x !== u.id))} />
                                            {u.nome}
                                        </label>
                                    ))}
                                    <label className="flex items-center gap-2 text-sm">
                                        <Checkbox checked={form.local_outro} onCheckedChange={v => mudar("local_outro", v === true)} /> Outro local
                                    </label>
                                </div>
                                {form.local_outro && (
                                    <Input className="mt-2" placeholder="Qual local?" value={form.local_outro_texto} onChange={e => mudar("local_outro_texto", e.target.value)} />
                                )}
                            </Campo>
                            <Campo rotulo="Como será realizado (principais etapas e atividades)">
                                <Textarea value={form.como_sera_realizado} onChange={e => mudar("como_sera_realizado", e.target.value)} rows={4} />
                            </Campo>
                        </Secao>
                    )}

                    {visiveis.includes(5) && (
                        <Secao id={5} registrar={registrarSecao}>
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[640px] text-sm">
                                    <thead>
                                        <tr className="border-b text-left text-muted-foreground">
                                            <th className="py-2 pr-2 font-medium">Item</th>
                                            <th className="py-2 pr-2 font-medium">Categoria</th>
                                            <th className="w-24 py-2 pr-2 font-medium">Quantidade</th>
                                            <th className="w-32 py-2 pr-2 font-medium">Valor unitário (R$)</th>
                                            <th className="w-32 py-2 pr-2 text-right font-medium">Valor total</th>
                                            <th className="w-10" />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {form.orcamento.map((l, i) => {
                                            const muda = (campo: keyof typeof l, valor: string) =>
                                                mudar("orcamento", form.orcamento.map((x, j) => j === i ? { ...x, [campo]: valor } : x))
                                            return (
                                                <tr key={i} className="border-b">
                                                    <td className="py-2 pr-2"><Input value={l.item} onChange={e => muda("item", e.target.value)} /></td>
                                                    <td className="py-2 pr-2">
                                                        <Select value={l.categoria} onValueChange={v => muda("categoria", v)}>
                                                            <SelectTrigger className="w-40"><SelectValue placeholder="Categoria" /></SelectTrigger>
                                                            <SelectContent>
                                                                {CATEGORIAS_ORCAMENTO.map(c => <SelectItem key={c.valor} value={c.valor}>{c.rotulo}</SelectItem>)}
                                                            </SelectContent>
                                                        </Select>
                                                    </td>
                                                    <td className="py-2 pr-2"><Input inputMode="decimal" value={l.quantidade} onChange={e => muda("quantidade", e.target.value)} /></td>
                                                    <td className="py-2 pr-2"><Input inputMode="decimal" placeholder="0,00" value={l.valor_unitario} onChange={e => muda("valor_unitario", e.target.value)} /></td>
                                                    <td className="py-2 pr-2 text-right tabular-nums">{formatarReais(totalLinhaOrcamento(l))}</td>
                                                    <td className="py-2"><Lixeira onClick={() => mudar("orcamento", form.orcamento.filter((_, j) => j !== i))} /></td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            <Button type="button" variant="outline" size="sm"
                                onClick={() => mudar("orcamento", [...form.orcamento, { item: "", categoria: "", quantidade: "", valor_unitario: "" }])}>
                                <Plus className="mr-1 h-4 w-4" /> Adicionar item
                            </Button>
                            <div className="flex items-center justify-end gap-3 rounded-md bg-muted px-4 py-3">
                                <span className="text-sm text-muted-foreground">Total geral</span>
                                <span className="text-xl font-semibold tabular-nums">{formatarReais(totalOrcamento(form.orcamento))}</span>
                            </div>
                        </Secao>
                    )}

                    {visiveis.includes(6) && (
                        <Secao id={6} registrar={registrarSecao}>
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[640px] text-sm">
                                    <thead>
                                        <tr className="border-b text-left text-muted-foreground">
                                            <th className="py-2 pr-2 font-medium">Meta</th>
                                            <th className="py-2 pr-2 font-medium">Indicador (como será medido)</th>
                                            <th className="py-2 pr-2 font-medium">Resultado esperado</th>
                                            <th className="w-10" />
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {form.metas.length === 0 && (
                                            <tr>
                                                <td colSpan={4} className="py-4 text-center text-sm text-muted-foreground">
                                                    Exemplo: <em>Atender jovens de 15 a 29 anos — Nº de inscritos e frequência média — 80 inscritos, 75% de frequência</em>
                                                </td>
                                            </tr>
                                        )}
                                        {form.metas.map((m, i) => {
                                            const muda = (campo: keyof typeof m, valor: string) =>
                                                mudar("metas", form.metas.map((x, j) => j === i ? { ...x, [campo]: valor } : x))
                                            return (
                                                <tr key={i} className="border-b align-top">
                                                    <td className="py-2 pr-2"><Textarea rows={2} value={m.meta} onChange={e => muda("meta", e.target.value)} /></td>
                                                    <td className="py-2 pr-2"><Textarea rows={2} value={m.indicador} onChange={e => muda("indicador", e.target.value)} /></td>
                                                    <td className="py-2 pr-2"><Textarea rows={2} value={m.resultado_esperado} onChange={e => muda("resultado_esperado", e.target.value)} /></td>
                                                    <td className="py-2"><Lixeira onClick={() => mudar("metas", form.metas.filter((_, j) => j !== i))} /></td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            <Button type="button" variant="outline" size="sm"
                                onClick={() => mudar("metas", [...form.metas, { meta: "", indicador: "", resultado_esperado: "" }])}>
                                <Plus className="mr-1 h-4 w-4" /> Adicionar meta
                            </Button>
                        </Secao>
                    )}

                    {/* 7. Resultados de 2026 e observações */}
                    <Secao id={7} registrar={registrarSecao}>
                        {bloco2026Visivel(form.situacao_2026) && (
                            <>
                                <Campo rotulo="Participantes atendidos em 2026">
                                    <Input className="w-40" inputMode="numeric" value={form.resultados_2026_participantes} onChange={e => mudar("resultados_2026_participantes", e.target.value)} />
                                </Campo>
                                <Campo rotulo="Principais resultados">
                                    <Textarea rows={3} value={form.resultados_2026_principais} onChange={e => mudar("resultados_2026_principais", e.target.value)} />
                                </Campo>
                                <Campo rotulo="O que funcionou bem">
                                    <Textarea rows={3} value={form.resultados_2026_funcionou} onChange={e => mudar("resultados_2026_funcionou", e.target.value)} />
                                </Campo>
                                <Campo rotulo="O que precisa melhorar">
                                    <Textarea rows={3} value={form.resultados_2026_melhorar} onChange={e => mudar("resultados_2026_melhorar", e.target.value)} />
                                </Campo>
                            </>
                        )}
                        <Campo rotulo="Observações (riscos, necessidades de comunicação e informações adicionais)">
                            <Textarea rows={4} value={form.observacoes} onChange={e => mudar("observacoes", e.target.value)} />
                        </Campo>
                    </Secao>
                </div>
            </div>

            {/* Barra fixa do rodapé */}
            <div className="sticky bottom-0 z-20 -mx-6 mt-2 flex flex-wrap items-center gap-3 border-t bg-background/95 px-6 py-3 backdrop-blur">
                <div className="flex-1 text-sm">
                    {erro ? (
                        <span className="flex items-center gap-1 text-rose-700"><AlertTriangle className="h-4 w-4" /> {erro}</span>
                    ) : salvoAs && !sujo ? (
                        <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Salvo às {salvoAs}</span>
                    ) : sujo ? (
                        <span className="text-muted-foreground">Alterações não salvas</span>
                    ) : null}
                </div>
                <Button variant="ghost" onClick={() => tentarSair(destinoSair)} disabled={ocupado}>
                    <LogOut className="mr-1 h-4 w-4" /> Sair
                </Button>
                <Button variant="outline" onClick={salvarParcial} disabled={ocupado || semSetorPossivel}>
                    {salvando === "parcial" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />} Salvar parcial
                </Button>
                {exibirSalvarProjeto && (
                    <Button onClick={salvarFinal} disabled={ocupado || semSetorPossivel}>
                        {salvando === "final" ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-1 h-4 w-4" />} Salvar projeto
                    </Button>
                )}
            </div>

            {/* Caixa ao sair com alterações não salvas (única exceção ao "sem modal") */}
            <AlertDialog open={caixa.aberta} onOpenChange={aberta => { if (!aberta && !caixa.salvando) setCaixa(c => ({ ...c, aberta: false })) }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Sair sem salvar?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Você tem alterações não salvas. Se sair sem salvar, todos os dados não salvos serão perdidos
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {caixa.erro && (
                        <p className="flex items-start gap-1 text-sm text-rose-700"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {caixa.erro}</p>
                    )}
                    <AlertDialogFooter>
                        <Button variant="outline" onClick={sairSemSalvar} disabled={caixa.salvando}>Sair sem salvar</Button>
                        <Button onClick={salvarESair} disabled={caixa.salvando}>
                            {caixa.salvando && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Salvar
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    )
}

// ── Peças de layout ─────────────────────────────────────────────────────────────────────────

function Secao({ id, registrar, children }: { id: IdSecao; registrar: (id: IdSecao, el: HTMLElement | null) => void; children: ReactNode }) {
    const titulo = SECOES.find(s => s.id === id)?.titulo
    return (
        <section ref={el => registrar(id, el)} data-secao={id} className="scroll-mt-20">
            <Card>
                <CardContent className="space-y-4 pt-6">
                    <h2 className="text-lg font-semibold">{id}. {titulo}</h2>
                    {children}
                </CardContent>
            </Card>
        </section>
    )
}

function Campo({ rotulo, obrigatorio, children }: { rotulo: string; obrigatorio?: boolean; children: ReactNode }) {
    return (
        <div className="space-y-1.5">
            <Label className="text-sm font-medium">{rotulo}{obrigatorio && <span className="text-rose-600"> *</span>}</Label>
            {children}
        </div>
    )
}

function Opcao({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: ReactNode }) {
    return (
        <button type="button" onClick={onClick} aria-pressed={ativo}
            className={cn("rounded-md border px-4 py-2 text-sm transition-colors", ativo ? "border-primary bg-primary text-primary-foreground" : "hover:bg-accent")}>
            {children}
        </button>
    )
}

function Lixeira({ onClick }: { onClick: () => void }) {
    return (
        <Button type="button" variant="ghost" size="icon" onClick={onClick} aria-label="Remover linha">
            <Trash2 className="h-4 w-4 text-muted-foreground" />
        </Button>
    )
}

export function Aviso({ icone, titulo, texto, acao }: { icone?: ReactNode; titulo: string; texto?: string; acao?: ReactNode }) {
    return (
        <Card>
            <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
                {icone}
                <p className="font-medium">{titulo}</p>
                {texto && <p className="text-sm text-muted-foreground">{texto}</p>}
                {acao}
            </CardContent>
        </Card>
    )
}
