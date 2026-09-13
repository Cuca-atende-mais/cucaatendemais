"use client"

// S-PROG-01 (item 3): ficha da atividade — painel lateral no desktop, tela cheia no mobile.
// Não é só acessibilidade de texto longo: é o caminho alternativo completo — quem não se sente
// à vontade com a grade preenche tudo por aqui. Grade e ficha gravam exatamente o mesmo dado.

import { useEffect, useRef } from "react"
import {
    Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { AtividadeForm, DIAS_SEMANA, DIAS_SEMANA_ABREV, LIMITE_CARACTERES, SESSOES_DIA_A_DIA, SEXOS } from "@/lib/programacao/tipos"
import { aplicarMascaraDataDigitando, aplicarMascaraHoraDigitando, dataBrParaISO, exibirData, normalizarData, normalizarHora } from "@/lib/programacao/mascaras"
import { RotuloComAjuda } from "@/components/programacao/ajuda-campo"
import { CampoComAjuda } from "@/lib/programacao/ajuda"

const NOMES_DIA_SEMANA = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"]

interface FichaAtividadeProps {
    aberta: boolean
    atividade: AtividadeForm | null
    indice: number
    total: number
    focoCampo?: string
    onChange: (atividade: AtividadeForm) => void
    onFechar: () => void
    onNavegar: (delta: 1 | -1) => void
    // S-PROG-13: sem "editar atividade" na categoria, a ficha só mostra os dados.
    somenteLeitura?: boolean
}

export function FichaAtividade({ aberta, atividade, indice, total, focoCampo, onChange, onFechar, onNavegar, somenteLeitura = false }: FichaAtividadeProps) {
    if (!atividade) return null

    const meta = atividade.metadata || {}
    const set = (chave: string, valor: string | string[] | null) => onChange({ ...atividade, metadata: { ...meta, [chave]: valor } })
    const setRoot = (chave: keyof AtividadeForm, valor: string | null) => onChange({ ...atividade, [chave]: valor })

    const toggleDia = (dia: string) => {
        const atuais: string[] = meta.dias_raw || []
        const next = atuais.includes(dia) ? atuais.filter(d => d !== dia) : [...atuais, dia]
        set("dias_raw", next)
        set("dias_semana", next.map(d => DIAS_SEMANA_ABREV[d]).join(" e "))
    }

    const handleDataDiaADia = (valorMascarado: string) => {
        // Mesmo padrão do campo hora: enquanto a data não fecha, guarda o texto digitado bruto
        // em vez de sobrescrever com null a cada tecla (era o bug reportado pelo @qa — campo
        // sempre resetava pra vazio). Converte pra ISO e deriva dia_semana/data_real só quando a
        // data digitada já é válida e completa.
        const iso = dataBrParaISO(valorMascarado)
        if (!iso) { setRoot("data_atividade", valorMascarado); return }
        setRoot("data_atividade", iso)
        const [ano, mes, dia] = iso.split("-").map(Number)
        const dt = new Date(ano, mes - 1, dia)
        set("dia_semana", NOMES_DIA_SEMANA[dt.getDay()])
        set("data_real", `${String(dia).padStart(2, "0")}/${String(mes).padStart(2, "0")}`)
    }

    return (
        <Sheet open={aberta} onOpenChange={v => !v && onFechar()}>
            <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
                <SheetHeader>
                    <SheetTitle>{atividade.titulo?.trim() || "Nova atividade"}</SheetTitle>
                    <SheetDescription>
                        {atividade.categoria} · linha {indice + 1} de {total}
                    </SheetDescription>
                </SheetHeader>

                <fieldset disabled={somenteLeitura} className="px-4 space-y-4 pb-4 min-w-0">
                    {somenteLeitura && (
                        <p className="text-xs text-muted-foreground">Seu perfil só pode ver as atividades desta categoria.</p>
                    )}
                    <CamposComuns atividade={atividade} set={set} setRoot={setRoot} toggleDia={toggleDia} handleDataDiaADia={handleDataDiaADia} focoCampo={focoCampo} />

                    {/* Meta e Diretoria — item 4: entram como campos da ficha em todas as categorias */}
                    <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border">
                        <div className="space-y-1.5">
                            <Label><RotuloComAjuda texto="Meta" campo="meta" /></Label>
                            <Input value={meta.meta || ""} onChange={e => set("meta", e.target.value)} />
                        </div>
                        <div className="space-y-1.5">
                            <Label><RotuloComAjuda texto="Diretoria" campo="diretoria" /></Label>
                            <Input value={meta.diretoria || ""} onChange={e => set("diretoria", e.target.value)} />
                        </div>
                    </div>
                </fieldset>

                <SheetFooter className="flex-row justify-between border-t border-border">
                    <Button variant="outline" size="sm" onClick={onFechar}>Fechar</Button>
                    <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="gap-1" onClick={() => onNavegar(-1)} disabled={total <= 1}>
                            <ChevronLeft className="h-3.5 w-3.5" /> Anterior
                        </Button>
                        <Button variant="outline" size="sm" className="gap-1" onClick={() => onNavegar(1)} disabled={total <= 1}>
                            Próxima <ChevronRight className="h-3.5 w-3.5" />
                        </Button>
                    </div>
                </SheetFooter>
            </SheetContent>
        </Sheet>
    )
}

function CampoTextoLongo({
    label, campo, valor, onChange, autofocus, dica,
}: {
    label: string
    campo: "ementa" | "informacoes" | "requisitos"
    valor: string
    onChange: (v: string) => void
    autofocus: boolean
    dica?: string
}) {
    const limite = LIMITE_CARACTERES[campo]
    const refLocal = useRef<HTMLTextAreaElement>(null)
    useEffect(() => { if (autofocus) refLocal.current?.focus() }, [autofocus])
    return (
        <div className="space-y-1.5">
            <Label><RotuloComAjuda texto={label} campo={campo} /></Label>
            <Textarea
                ref={refLocal}
                rows={4}
                maxLength={limite}
                value={valor}
                onChange={e => onChange(e.target.value)}
                placeholder="Escreva aqui..."
            />
            <div className={cn("text-[10px] text-right", valor.length > limite * 0.9 ? "text-amber-600 font-semibold" : "text-muted-foreground")}>
                {valor.length} / {limite} caracteres
            </div>
            {dica && <p className="text-[11px] text-muted-foreground leading-relaxed">{dica}</p>}
        </div>
    )
}

function BotoesDias({ selecionados, onToggle }: { selecionados: string[]; onToggle: (d: string) => void }) {
    return (
        <div className="flex gap-1.5 flex-wrap">
            {DIAS_SEMANA.map(d => (
                <button key={d} type="button" onClick={() => onToggle(d)}
                    className={cn(
                        "px-2.5 py-1 rounded-md text-xs font-medium border transition-colors",
                        selecionados.includes(d) ? "bg-primary text-primary-foreground border-primary" : "bg-muted text-muted-foreground border-border hover:bg-muted/70"
                    )}>
                    {DIAS_SEMANA_ABREV[d]}
                </button>
            ))}
        </div>
    )
}

function CampoHora({ label, valor, onChange, autofocus }: { label: string; valor: string; onChange: (v: string) => void; autofocus: boolean }) {
    const refLocal = useRef<HTMLInputElement>(null)
    useEffect(() => { if (autofocus) refLocal.current?.focus() }, [autofocus])
    return (
        <div className="space-y-1.5">
            <Label><RotuloComAjuda texto={label} campo="horario" /></Label>
            <Input
                ref={refLocal}
                inputMode="numeric"
                maxLength={5}
                placeholder="--:--"
                value={valor || ""}
                onChange={e => onChange(aplicarMascaraHoraDigitando(e.target.value))}
                onBlur={e => { const r = normalizarHora(e.target.value); if (r.ok) onChange(r.valor) }}
            />
        </div>
    )
}

function CamposComuns({
    atividade, set, setRoot, toggleDia, handleDataDiaADia, focoCampo,
}: {
    atividade: AtividadeForm
    set: (chave: string, valor: string | string[] | null) => void
    setRoot: (chave: keyof AtividadeForm, valor: string | null) => void
    toggleDia: (d: string) => void
    handleDataDiaADia: (v: string) => void
    focoCampo?: string
}) {
    const meta = atividade.metadata || {}
    const categoria = atividade.categoria

    if (categoria === "ESPORTES") {
        return (
            <div className="space-y-4">
                <Campo label="Modalidade" obrigatorio><Input value={atividade.titulo || ""} onChange={e => setRoot("titulo", e.target.value)} /></Campo>
                <div className="grid grid-cols-2 gap-3">
                    <Campo label="Professor" obrigatorio><Input value={meta.professor || ""} onChange={e => set("professor", e.target.value)} /></Campo>
                    <Campo label="Turma" obrigatorio><Input value={meta.turma || ""} onChange={e => set("turma", e.target.value)} /></Campo>
                    <Campo label="Idade mínima" ajuda="idade_min" obrigatorio><Input inputMode="numeric" value={meta.faixa_de || ""} onChange={e => set("faixa_de", e.target.value.replace(/\D/g, ""))} /></Campo>
                    <Campo label="Idade máxima" ajuda="idade_max"><Input inputMode="numeric" value={meta.faixa_ate || ""} onChange={e => set("faixa_ate", e.target.value.replace(/\D/g, ""))} /></Campo>
                    <Campo label="Sexo" obrigatorio>
                        <Select value={meta.sexo || ""} onValueChange={v => set("sexo", v)}>
                            <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                            <SelectContent>{SEXOS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                        </Select>
                    </Campo>
                    <Campo label="Vagas" ajuda="vagas" obrigatorio><Input inputMode="numeric" value={meta.vagas || ""} onChange={e => set("vagas", e.target.value.replace(/\D/g, ""))} /></Campo>
                </div>
                <Campo label="Dias da semana" ajuda="dias_semana" obrigatorio><BotoesDias selecionados={meta.dias_raw || []} onToggle={toggleDia} /></Campo>
                <div className="grid grid-cols-2 gap-3">
                    <CampoHora label="Início" valor={atividade.hora_inicio || ""} onChange={v => setRoot("hora_inicio", v)} autofocus={focoCampo === "hora_inicio"} />
                    <CampoHora label="Fim" valor={atividade.hora_fim || ""} onChange={v => setRoot("hora_fim", v)} autofocus={focoCampo === "hora_fim"} />
                </div>
            </div>
        )
    }

    if (categoria === "CURSOS") {
        return (
            <div className="space-y-4">
                <Campo label="Curso" obrigatorio><Input value={atividade.titulo || ""} onChange={e => setRoot("titulo", e.target.value)} /></Campo>
                <div className="grid grid-cols-2 gap-3">
                    <Campo label="Educador" obrigatorio><Input value={meta.educador || ""} onChange={e => set("educador", e.target.value)} /></Campo>
                    <Campo label="Vagas" ajuda="vagas" obrigatorio><Input inputMode="numeric" value={meta.vagas || ""} onChange={e => set("vagas", e.target.value.replace(/\D/g, ""))} /></Campo>
                    <Campo label="Carga horária" ajuda="carga_horaria" obrigatorio><Input inputMode="numeric" value={meta.carga_horaria || ""} onChange={e => set("carga_horaria", e.target.value.replace(/\D/g, ""))} /></Campo>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <Campo label="Data de início" obrigatorio>
                        <Input inputMode="numeric" maxLength={10} placeholder="--/--/----"
                            value={exibirData(meta.data_inicio_raw)}
                            onChange={e => { const v = aplicarMascaraDataDigitando(e.target.value); set("data_inicio_raw", dataBrParaISO(v) ?? v) }}
                            onBlur={e => { const r = normalizarData(e.target.value); if (r.ok) { const iso = dataBrParaISO(r.valor); if (iso) set("data_inicio_raw", iso) } }}
                        />
                    </Campo>
                    <Campo label="Data de término" obrigatorio>
                        <Input inputMode="numeric" maxLength={10} placeholder="--/--/----"
                            value={exibirData(meta.data_fim_raw)}
                            onChange={e => { const v = aplicarMascaraDataDigitando(e.target.value); set("data_fim_raw", dataBrParaISO(v) ?? v) }}
                            onBlur={e => { const r = normalizarData(e.target.value); if (r.ok) { const iso = dataBrParaISO(r.valor); if (iso) set("data_fim_raw", iso) } }}
                        />
                    </Campo>
                </div>
                <Campo label="Dias da semana" ajuda="dias_semana" obrigatorio><BotoesDias selecionados={meta.dias_raw || []} onToggle={toggleDia} /></Campo>
                <div className="grid grid-cols-2 gap-3">
                    <CampoHora label="Início" valor={atividade.hora_inicio || ""} onChange={v => setRoot("hora_inicio", v)} autofocus={focoCampo === "hora_inicio"} />
                    <CampoHora label="Fim" valor={atividade.hora_fim || ""} onChange={v => setRoot("hora_fim", v)} autofocus={focoCampo === "hora_fim"} />
                </div>
                <CampoTextoLongo label="Pré-requisitos" campo="requisitos" valor={meta.requisitos || ""} onChange={v => set("requisitos", v)} autofocus={focoCampo === "requisitos"} />
                <CampoTextoLongo label="Ementa" campo="ementa" valor={meta.ementa || ""} onChange={v => set("ementa", v)} autofocus={focoCampo === "ementa"} />
            </div>
        )
    }

    // DIA A DIA / ESPECIAIS
    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
                <Campo label="Sessão">
                    <Select value={meta.sessao || ""} onValueChange={v => set("sessao", v)}>
                        <SelectTrigger><SelectValue placeholder="Selecionar" /></SelectTrigger>
                        <SelectContent>{SESSOES_DIA_A_DIA.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                </Campo>
                <Campo label="Programa" obrigatorio><Input value={atividade.titulo || ""} onChange={e => setRoot("titulo", e.target.value)} /></Campo>
            </div>
            <Campo label="Atividade" obrigatorio><Input value={meta.atividade || ""} onChange={e => set("atividade", e.target.value)} placeholder="Breve descrição" /></Campo>
            <div className="grid grid-cols-2 gap-3">
                <Campo label="Data">
                    <Input inputMode="numeric" maxLength={10} placeholder="--/--/----"
                        value={exibirData(atividade.data_atividade)}
                        onChange={e => handleDataDiaADia(aplicarMascaraDataDigitando(e.target.value))}
                        onBlur={e => { const r = normalizarData(e.target.value); if (r.ok) handleDataDiaADia(r.valor) }}
                    />
                </Campo>
                {meta.dia_semana && (
                    <Campo label="Dia da semana"><p className="text-sm h-9 flex items-center px-3 bg-muted/40 rounded-md border border-border text-muted-foreground">{meta.dia_semana}</p></Campo>
                )}
            </div>
            <div className="grid grid-cols-2 gap-3">
                <CampoHora label="Início" valor={atividade.hora_inicio || ""} onChange={v => setRoot("hora_inicio", v)} autofocus={focoCampo === "hora_inicio"} />
                <CampoHora label="Fim" valor={atividade.hora_fim || ""} onChange={v => setRoot("hora_fim", v)} autofocus={focoCampo === "hora_fim"} />
            </div>
            <Campo label="Local" obrigatorio><Input value={atividade.local || ""} onChange={e => setRoot("local", e.target.value)} placeholder="Nunca use este campo para horário" /></Campo>
            <CampoTextoLongo label="Informações" campo="informacoes" valor={meta.informacoes || ""} onChange={v => set("informacoes", v)} autofocus={focoCampo === "informacoes"} />
        </div>
    )
}

function Campo({ label, ajuda, obrigatorio, children }: { label: string; ajuda?: CampoComAjuda; obrigatorio?: boolean; children: React.ReactNode }) {
    return (
        <div className="space-y-1.5">
            <Label><RotuloComAjuda texto={label} campo={ajuda} obrigatorio={obrigatorio} /></Label>
            {children}
        </div>
    )
}
