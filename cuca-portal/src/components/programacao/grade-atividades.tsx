"use client"

// S-PROG-01 (item 1): grade editável por categoria — substitui o wizard de 1 formulário por
// atividade. Edição direta na célula, ＋ nova linha, ⧉ duplicar linha, 🗑 excluir linha.
// Abaixo de 820px (AC8) vira cartão por linha, com rótulo em cada campo.

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Plus, Copy, Trash2, FileText, Dumbbell, GraduationCap, CalendarDays, Sparkles, LayoutGrid } from "lucide-react"
import { cn } from "@/lib/utils"
import { useMediaQuery } from "@/hooks/use-media-query"
import { AtividadeForm, Categoria, DIAS_SEMANA, DIAS_SEMANA_ABREV, SESSOES_DIA_A_DIA, SEXOS } from "@/lib/programacao/tipos"
import { aplicarMascaraDataDigitando, aplicarMascaraHoraDigitando, dataBrParaISO, exibirData, normalizarData, normalizarHora } from "@/lib/programacao/mascaras"
import { RotuloComAjuda } from "@/components/programacao/ajuda-campo"
import { CampoComAjuda } from "@/lib/programacao/ajuda"

// ─── Identidade visual por categoria ────────────────────────────────────────────
// Cada categoria tem cor e ícone fixos — repete em toda a grade (aba, barra lateral da
// linha, cartão mobile) pra a junta técnica identificar a categoria sem ler o rótulo.
// Classes sempre por extenso (nunca `text-${cor}-500`) porque o Tailwind não compila
// nome de classe montado em runtime.
const CATEGORIA_INFO: Record<Categoria, { icone: typeof Dumbbell; abaAtiva: string; barra: string; ponto: string; texto: string }> = {
    ESPORTES: { icone: Dumbbell, abaAtiva: "bg-emerald-500 text-white border-emerald-500", barra: "bg-emerald-500", ponto: "bg-emerald-400", texto: "text-emerald-500" },
    CURSOS: { icone: GraduationCap, abaAtiva: "bg-amber-500 text-white border-amber-500", barra: "bg-amber-500", ponto: "bg-amber-400", texto: "text-amber-500" },
    "DIA A DIA": { icone: CalendarDays, abaAtiva: "bg-cyan-500 text-white border-cyan-500", barra: "bg-cyan-500", ponto: "bg-cyan-400", texto: "text-cyan-500" },
    ESPECIAIS: { icone: Sparkles, abaAtiva: "bg-rose-500 text-white border-rose-500", barra: "bg-rose-500", ponto: "bg-rose-400", texto: "text-rose-500" },
}

// ─── Especificação de colunas por categoria ────────────────────────────────────
// `root: true` lê/grava direto em AtividadeForm; senão lê/grava em AtividadeForm.metadata.

type TipoColuna = "texto" | "numero" | "hora" | "data" | "sexo" | "sessao" | "dias" | "data_dia_a_dia" | "texto_longo"

interface Coluna {
    key: string
    label: string
    root?: boolean
    tipo: TipoColuna
    ajuda?: CampoComAjuda
    obrigatorio?: boolean
    largura?: string
    limite?: number
}

const COLUNAS: Record<Categoria, Coluna[]> = {
    ESPORTES: [
        { key: "titulo", label: "Modalidade", root: true, tipo: "texto", obrigatorio: true, largura: "min-w-36" },
        { key: "professor", label: "Professor", tipo: "texto", obrigatorio: true, largura: "min-w-32" },
        { key: "turma", label: "Turma", tipo: "texto", obrigatorio: true, largura: "min-w-24" },
        { key: "faixa_de", label: "Idade mín", tipo: "numero", ajuda: "idade_min", obrigatorio: true, largura: "w-24" },
        { key: "faixa_ate", label: "Idade máx", tipo: "numero", ajuda: "idade_max", largura: "w-24" },
        { key: "sexo", label: "Sexo", tipo: "sexo", obrigatorio: true, largura: "w-28" },
        { key: "vagas", label: "Vagas", tipo: "numero", ajuda: "vagas", obrigatorio: true, largura: "w-20" },
        { key: "dias_raw", label: "Dias", tipo: "dias", ajuda: "dias_semana", obrigatorio: true, largura: "w-32" },
        { key: "hora_inicio", label: "Início", root: true, tipo: "hora", ajuda: "horario", obrigatorio: true, largura: "w-20" },
        { key: "hora_fim", label: "Fim", root: true, tipo: "hora", ajuda: "horario", obrigatorio: true, largura: "w-20" },
    ],
    CURSOS: [
        { key: "titulo", label: "Curso", root: true, tipo: "texto", obrigatorio: true, largura: "min-w-40" },
        { key: "educador", label: "Educador", tipo: "texto", obrigatorio: true, largura: "min-w-32" },
        { key: "vagas", label: "Vagas", tipo: "numero", ajuda: "vagas", obrigatorio: true, largura: "w-20" },
        { key: "carga_horaria", label: "Carga h", tipo: "numero", ajuda: "carga_horaria", obrigatorio: true, largura: "w-20" },
        { key: "data_inicio_raw", label: "Início", tipo: "data", obrigatorio: true, largura: "w-28" },
        { key: "data_fim_raw", label: "Término", tipo: "data", obrigatorio: true, largura: "w-28" },
        { key: "dias_raw", label: "Dias", tipo: "dias", ajuda: "dias_semana", obrigatorio: true, largura: "w-32" },
        { key: "hora_inicio", label: "Início", root: true, tipo: "hora", ajuda: "horario", obrigatorio: true, largura: "w-20" },
        { key: "hora_fim", label: "Fim", root: true, tipo: "hora", ajuda: "horario", obrigatorio: true, largura: "w-20" },
        { key: "requisitos", label: "Pré-requisitos", tipo: "texto_longo", ajuda: "requisitos", limite: 200, largura: "min-w-40" },
        { key: "ementa", label: "Ementa", tipo: "texto_longo", ajuda: "ementa", obrigatorio: true, limite: 600, largura: "min-w-40" },
    ],
    "DIA A DIA": [
        { key: "sessao", label: "Sessão", tipo: "sessao", obrigatorio: true, largura: "w-32" },
        { key: "titulo", label: "Programa", root: true, tipo: "texto", obrigatorio: true, largura: "min-w-32" },
        { key: "atividade", label: "Atividade", tipo: "texto", obrigatorio: true, largura: "min-w-40" },
        { key: "data_atividade", label: "Data", root: true, tipo: "data_dia_a_dia", obrigatorio: true, largura: "w-28" },
        { key: "hora_inicio", label: "Início", root: true, tipo: "hora", ajuda: "horario", obrigatorio: true, largura: "w-20" },
        { key: "hora_fim", label: "Fim", root: true, tipo: "hora", ajuda: "horario", largura: "w-20" },
        { key: "local", label: "Local", root: true, tipo: "texto", obrigatorio: true, largura: "min-w-32" },
        { key: "informacoes", label: "Informações", tipo: "texto_longo", ajuda: "informacoes", obrigatorio: true, limite: 600, largura: "min-w-40" },
    ],
    ESPECIAIS: [
        { key: "sessao", label: "Sessão", tipo: "sessao", obrigatorio: true, largura: "w-32" },
        { key: "titulo", label: "Programa", root: true, tipo: "texto", obrigatorio: true, largura: "min-w-32" },
        { key: "atividade", label: "Atividade", tipo: "texto", obrigatorio: true, largura: "min-w-40" },
        { key: "data_atividade", label: "Data", root: true, tipo: "data_dia_a_dia", obrigatorio: true, largura: "w-28" },
        { key: "hora_inicio", label: "Início", root: true, tipo: "hora", ajuda: "horario", obrigatorio: true, largura: "w-20" },
        { key: "hora_fim", label: "Fim", root: true, tipo: "hora", ajuda: "horario", largura: "w-20" },
        { key: "local", label: "Local", root: true, tipo: "texto", obrigatorio: true, largura: "min-w-32" },
        { key: "informacoes", label: "Informações", tipo: "texto_longo", ajuda: "informacoes", obrigatorio: true, limite: 600, largura: "min-w-40" },
    ],
}

const NOMES_DIA_SEMANA = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"]

function novoTempId(): string {
    return Math.random().toString(36).slice(2)
}

function novaAtividade(categoria: Categoria): AtividadeForm {
    return {
        _tempId: novoTempId(),
        categoria,
        titulo: "",
        descricao: null,
        local: null,
        data_atividade: null,
        hora_inicio: null,
        hora_fim: null,
        metadata: {},
    }
}

function getValor(a: AtividadeForm, col: Coluna): string {
    if (col.key === "data_atividade" && col.tipo === "data_dia_a_dia") {
        return exibirData(a.data_atividade)
    }
    if (col.root) return (a as unknown as Record<string, string | null>)[col.key] || ""
    if (col.tipo === "data") return exibirData(a.metadata[col.key])
    return a.metadata[col.key] || ""
}

interface GradeAtividadesProps {
    atividades: AtividadeForm[]
    onChange: (atividades: AtividadeForm[]) => void
    onAbrirFicha: (tempId: string, focoCampo?: string) => void
}

export function GradeAtividades({ atividades, onChange, onAbrirFicha }: GradeAtividadesProps) {
    const [categoria, setCategoria] = useState<Categoria>("ESPORTES")
    const [linhaAtiva, setLinhaAtiva] = useState<string | null>(null)
    const isCompacto = !useMediaQuery("(min-width: 820px)")

    const daCategoria = atividades.filter(a => a.categoria === categoria)
    const colunas = COLUNAS[categoria]

    const atualizarAtividade = (tempId: string, patch: Partial<AtividadeForm> | ((a: AtividadeForm) => AtividadeForm)) => {
        onChange(atividades.map(a => {
            if (a._tempId !== tempId) return a
            return typeof patch === "function" ? patch(a) : { ...a, ...patch }
        }))
    }

    const setCampo = (tempId: string, col: Coluna, valor: string) => {
        atualizarAtividade(tempId, a => {
            if (col.key === "data_atividade" && col.tipo === "data_dia_a_dia") {
                // Enquanto a data não fica completa/válida, `dataBrParaISO` retorna null — guarda o
                // texto mascarado bruto tal como digitado (em vez de sobrescrever com null a cada
                // tecla, que era o bug: campo sempre reset pra vazio). Só converte pra ISO (e
                // deriva dia_semana/data_real) quando a data digitada já fecha corretamente.
                const iso = dataBrParaISO(valor)
                if (!iso) return { ...a, data_atividade: valor }
                const [ano, mes, dia] = iso.split("-").map(Number)
                const dt = new Date(ano, mes - 1, dia)
                const metaPatch = { dia_semana: NOMES_DIA_SEMANA[dt.getDay()], data_real: `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}` }
                return { ...a, data_atividade: iso, metadata: { ...a.metadata, ...metaPatch } }
            }
            if (col.root) return { ...a, [col.key]: valor }
            if (col.tipo === "data") {
                // Mesmo raciocínio: guarda o texto bruto até a data fechar; só então vira ISO.
                const iso = dataBrParaISO(valor)
                return { ...a, metadata: { ...a.metadata, [col.key]: iso ?? valor } }
            }
            return { ...a, metadata: { ...a.metadata, [col.key]: valor } }
        })
    }

    const toggleDia = (tempId: string, dia: string) => {
        atualizarAtividade(tempId, a => {
            const atuais: string[] = a.metadata.dias_raw || []
            const next = atuais.includes(dia) ? atuais.filter(d => d !== dia) : [...atuais, dia]
            return { ...a, metadata: { ...a.metadata, dias_raw: next, dias_semana: next.map(d => DIAS_SEMANA_ABREV[d]).join(" e ") } }
        })
    }

    const adicionarLinha = () => {
        const nova = novaAtividade(categoria)
        onChange([...atividades, nova])
        setLinhaAtiva(nova._tempId)
    }

    const duplicarLinha = (tempId: string) => {
        const original = atividades.find(a => a._tempId === tempId)
        if (!original) return
        const copia: AtividadeForm = { ...original, _tempId: novoTempId(), metadata: { ...original.metadata } }
        const indiceOriginal = atividades.findIndex(a => a._tempId === tempId)
        const proximo = [...atividades]
        proximo.splice(indiceOriginal + 1, 0, copia)
        onChange(proximo)
        setLinhaAtiva(copia._tempId)
    }

    const excluirLinha = (tempId: string) => {
        onChange(atividades.filter(a => a._tempId !== tempId))
        if (linhaAtiva === tempId) setLinhaAtiva(null)
    }

    return (
        <div className="space-y-4">
            <div className="flex gap-2 flex-wrap">
                {(Object.keys(COLUNAS) as Categoria[]).map(cat => {
                    const qtd = atividades.filter(a => a.categoria === cat).length
                    const info = CATEGORIA_INFO[cat]
                    const Icone = info.icone
                    const ativa = categoria === cat
                    return (
                        <button key={cat} type="button" onClick={() => setCategoria(cat)}
                            className={cn(
                                "px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border flex items-center gap-2",
                                ativa
                                    ? cn(info.abaAtiva, "shadow-lg shadow-black/20 scale-[1.02]")
                                    : "bg-card text-muted-foreground border-border hover:border-foreground/20 hover:text-foreground"
                            )}>
                            <Icone className={cn("h-4 w-4", !ativa && info.texto)} />
                            {cat}
                            {qtd > 0 && (
                                <span className={cn(
                                    "min-w-5 h-5 px-1 rounded-full text-[11px] font-bold flex items-center justify-center",
                                    ativa ? "bg-white/25" : "bg-muted"
                                )}>{qtd}</span>
                            )}
                        </button>
                    )
                })}
            </div>

            <div className="flex gap-2 flex-wrap items-center justify-between rounded-xl bg-muted/40 border border-border p-2.5">
                <div className="flex gap-2 flex-wrap items-center">
                    <Button size="default" className="gap-1.5" onClick={adicionarLinha}>
                        <Plus className="h-4 w-4" /> Nova linha
                    </Button>
                    {linhaAtiva && daCategoria.some(a => a._tempId === linhaAtiva) && (
                        <>
                            <Button size="default" variant="outline" className="gap-1.5" onClick={() => duplicarLinha(linhaAtiva)}>
                                <Copy className="h-4 w-4" /> Duplicar linha
                            </Button>
                            <Button size="default" variant="outline" className="gap-1.5 text-red-400 hover:text-red-400 hover:bg-red-500/10 border-red-500/30" onClick={() => excluirLinha(linhaAtiva)}>
                                <Trash2 className="h-4 w-4" /> Excluir linha
                            </Button>
                        </>
                    )}
                </div>
                <span className="text-xs text-muted-foreground pr-1 hidden sm:inline">
                    {daCategoria.length} {daCategoria.length === 1 ? "linha" : "linhas"} em {categoria}
                </span>
            </div>

            {daCategoria.length === 0 && (
                <div className="flex flex-col items-center gap-3 text-center py-16 border-2 border-dashed border-border rounded-2xl bg-muted/10">
                    <LayoutGrid className="h-8 w-8 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">
                        Nenhuma linha em <strong className="text-foreground">{categoria}</strong> ainda.
                    </p>
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={adicionarLinha}>
                        <Plus className="h-3.5 w-3.5" /> Adicionar a primeira linha
                    </Button>
                </div>
            )}

            {daCategoria.length > 0 && isCompacto && (
                <div className="space-y-3">
                    {daCategoria.map((a, idx) => (
                        <CartaoLinha
                            key={a._tempId}
                            atividade={a}
                            indice={idx}
                            colunas={colunas}
                            ativa={linhaAtiva === a._tempId}
                            onSelecionar={() => setLinhaAtiva(a._tempId)}
                            onSetCampo={(col, v) => setCampo(a._tempId, col, v)}
                            onToggleDia={d => toggleDia(a._tempId, d)}
                            onAbrirFicha={focoCampo => onAbrirFicha(a._tempId, focoCampo)}
                        />
                    ))}
                </div>
            )}

            {daCategoria.length > 0 && !isCompacto && (
                <div className="overflow-x-auto border border-border rounded-xl bg-card/40">
                    <table className="w-full text-sm border-collapse">
                        <thead>
                            <tr className="bg-muted/60 sticky top-0 z-10">
                                <th className="w-9 px-2 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wide">#</th>
                                {colunas.map(col => (
                                    <th key={col.key} className={cn("px-2.5 py-3 text-left text-[11px] font-bold text-muted-foreground uppercase tracking-wide whitespace-nowrap", col.largura)}>
                                        <RotuloComAjuda texto={col.label} campo={col.ajuda} />
                                    </th>
                                ))}
                                <th className="w-12 px-2 py-3" />
                            </tr>
                        </thead>
                        <tbody>
                            {daCategoria.map((a, idx) => (
                                <tr
                                    key={a._tempId}
                                    onClick={() => setLinhaAtiva(a._tempId)}
                                    className={cn(
                                        "relative border-t border-border cursor-default transition-colors",
                                        linhaAtiva === a._tempId ? "bg-primary/10" : "hover:bg-muted/30"
                                    )}
                                >
                                    <td className="relative px-2 py-2 text-center text-xs font-semibold text-muted-foreground">
                                        <span className={cn(
                                            "absolute left-0 top-0 bottom-0 w-1 rounded-r",
                                            linhaAtiva === a._tempId ? CATEGORIA_INFO[categoria].barra : "bg-transparent"
                                        )} />
                                        {idx + 1}
                                    </td>
                                    {colunas.map(col => (
                                        <td key={col.key} className="px-1.5 py-2">
                                            <CelulaCampo
                                                atividade={a}
                                                coluna={col}
                                                onChange={v => setCampo(a._tempId, col, v)}
                                                onToggleDia={d => toggleDia(a._tempId, d)}
                                                onAbrirFicha={campo => onAbrirFicha(a._tempId, campo)}
                                            />
                                        </td>
                                    ))}
                                    <td className="px-1.5 py-2">
                                        <Button variant="ghost" size="icon-sm" title="Abrir ficha" onClick={() => onAbrirFicha(a._tempId)}>
                                            <FileText className="h-4 w-4" />
                                        </Button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    )
}

// ─── Renderizador de célula (compartilhado entre tabela e cartão) ─────────────

function CelulaCampo({ atividade, coluna, onChange, onToggleDia, onAbrirFicha }: { atividade: AtividadeForm; coluna: Coluna; onChange: (v: string) => void; onToggleDia: (d: string) => void; onAbrirFicha?: (focoCampo: string) => void }) {
    const valor = getValor(atividade, coluna)

    if (coluna.tipo === "texto_longo") {
        const preenchido = valor.trim().length > 0
        return (
            <button
                type="button"
                onClick={() => onAbrirFicha?.(coluna.key)}
                className={cn(
                    "h-10 w-full px-3 text-sm text-left border rounded-lg flex items-center gap-2 transition-colors",
                    preenchido ? "border-border hover:border-primary/50 bg-background/60" : "border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/15"
                )}
            >
                <span className={cn("flex-1 truncate", preenchido ? "text-foreground" : "text-muted-foreground")}>
                    {preenchido ? valor : "clique para escrever"}
                </span>
                <span className="text-[11px] text-muted-foreground shrink-0 font-medium">
                    {preenchido ? valor.length : "＋"}
                </span>
            </button>
        )
    }

    if (coluna.tipo === "sexo") {
        return (
            <Select value={valor} onValueChange={onChange}>
                <SelectTrigger className="h-10 text-sm w-full"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>{SEXOS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
        )
    }

    if (coluna.tipo === "sessao") {
        return (
            <Select value={valor} onValueChange={onChange}>
                <SelectTrigger className="h-10 text-sm w-full"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>{SESSOES_DIA_A_DIA.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
        )
    }

    if (coluna.tipo === "dias") {
        const selecionados: string[] = atividade.metadata.dias_raw || []
        return (
            <Popover>
                <PopoverTrigger asChild>
                    <button type="button" className="h-10 w-full px-3 text-sm text-left border border-border hover:border-primary/50 rounded-lg truncate bg-background/60 transition-colors">
                        {selecionados.length ? selecionados.map(d => DIAS_SEMANA_ABREV[d]).join(", ") : <span className="text-muted-foreground">Selecionar</span>}
                    </button>
                </PopoverTrigger>
                <PopoverContent className="w-60">
                    <div className="flex gap-1.5 flex-wrap">
                        {DIAS_SEMANA.map(d => (
                            <button key={d} type="button" onClick={() => onToggleDia(d)}
                                className={cn(
                                    "px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors",
                                    selecionados.includes(d) ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border hover:bg-muted/70"
                                )}>
                                {DIAS_SEMANA_ABREV[d]}
                            </button>
                        ))}
                    </div>
                </PopoverContent>
            </Popover>
        )
    }

    if (coluna.tipo === "hora") {
        return (
            <Input
                className="h-10 text-sm text-center tabular-nums font-medium"
                inputMode="numeric"
                maxLength={5}
                placeholder="--:--"
                value={valor}
                onChange={e => onChange(aplicarMascaraHoraDigitando(e.target.value))}
                onBlur={e => {
                    const r = normalizarHora(e.target.value)
                    if (r.ok) onChange(r.valor)
                }}
            />
        )
    }

    if (coluna.tipo === "data" || coluna.tipo === "data_dia_a_dia") {
        return (
            <Input
                className="h-10 text-sm text-center tabular-nums font-medium"
                inputMode="numeric"
                maxLength={10}
                placeholder="--/--/----"
                value={valor}
                onChange={e => onChange(aplicarMascaraDataDigitando(e.target.value))}
                onBlur={e => {
                    const r = normalizarData(e.target.value)
                    if (r.ok) onChange(r.valor)
                }}
            />
        )
    }

    if (coluna.tipo === "numero") {
        return (
            <Input
                className="h-10 text-sm text-center font-medium"
                inputMode="numeric"
                value={valor}
                onChange={e => onChange(e.target.value.replace(/\D/g, ""))}
            />
        )
    }

    return <Input className="h-10 text-sm" value={valor} onChange={e => onChange(e.target.value)} />
}

// ─── Cartão de linha (mobile, abaixo de 820px — AC8) ──────────────────────────

function CartaoLinha({
    atividade, indice, colunas, ativa, onSelecionar, onSetCampo, onToggleDia, onAbrirFicha,
}: {
    atividade: AtividadeForm
    indice: number
    colunas: Coluna[]
    ativa: boolean
    onSelecionar: () => void
    onSetCampo: (col: Coluna, v: string) => void
    onToggleDia: (d: string) => void
    onAbrirFicha: (focoCampo?: string) => void
}) {
    const info = CATEGORIA_INFO[atividade.categoria]
    return (
        <div
            onClick={onSelecionar}
            className={cn(
                "relative rounded-xl border p-4 space-y-3 overflow-hidden transition-colors",
                ativa ? "border-primary bg-primary/5" : "border-border bg-card/60"
            )}
        >
            <span className={cn("absolute left-0 top-0 bottom-0 w-1", info.barra)} />
            <div className="flex items-center justify-between pl-2">
                <span className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Linha {indice + 1}</span>
                <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs gap-1.5" onClick={e => { e.stopPropagation(); onAbrirFicha() }}>
                    <FileText className="h-3.5 w-3.5" /> Abrir ficha
                </Button>
            </div>
            {colunas.map(col => (
                <div key={col.key} className="space-y-1 pl-2">
                    <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                        <RotuloComAjuda texto={col.label} campo={col.ajuda} />
                    </span>
                    <CelulaCampo atividade={atividade} coluna={col} onChange={v => onSetCampo(col, v)} onToggleDia={onToggleDia} onAbrirFicha={onAbrirFicha} />
                </div>
            ))}
        </div>
    )
}
