"use client"

import { useState, useEffect, useCallback } from "react"
import { useParams, useRouter } from "next/navigation"
import { ArrowLeft, Loader2, Save } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { toast } from "sonner"
import Link from "next/link"

// ─── Tipos ────────────────────────────────────────────────────────────────────

type VariavelItem = { posicao: number; descricao: string }

type MetaTemplate = {
    id: string
    nome: string
    categoria: string | null
    status: string
    variaveis: VariavelItem[]
    automacoes: string[]
    phone_number_ids: string[]
    observacoes: string | null
    corpo_texto: string | null
    ativo: boolean
}

type PhoneNumber = {
    id: string
    phone_number_id: string
    waba_id: string
    display_name: string
    canal_tipo: string
    agente_tipo: string
    ativo: boolean
}

// ─── Constantes ───────────────────────────────────────────────────────────────

const CATEGORIAS = ["UTILITY", "MARKETING", "AUTHENTICATION"]
const STATUS_OPTIONS = ["pendente", "aprovado", "rejeitado", "pausado"]

// Extrai posições únicas de {{N}} no corpo do texto, ordenadas
function detectarPosicoes(texto: string): number[] {
    const matches = [...texto.matchAll(/\{\{(\d+)\}\}/g)]
    const set = new Set(matches.map(m => parseInt(m[1], 10)))
    return [...set].sort((a, b) => a - b)
}

// Sincroniza a lista de variáveis com os placeholders detectados
function syncVarList(
    posicoes: number[],
    atual: VariavelItem[]
): VariavelItem[] {
    const mapaAtual = new Map(atual.map(v => [v.posicao, v.descricao]))
    return posicoes.map(p => ({ posicao: p, descricao: mapaAtual.get(p) ?? "" }))
}

// ─── Página ───────────────────────────────────────────────────────────────────

export default function EditarTemplatePage() {
    const params = useParams()
    const router = useRouter()
    const id = params.id as string

    const [template, setTemplate] = useState<MetaTemplate | null>(null)
    const [phoneNumbers, setPhoneNumbers] = useState<PhoneNumber[]>([])
    const [outrosNomes, setOutrosNomes] = useState<string[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    // Estado do form
    const [nome, setNome] = useState("")
    const [nomeOriginal, setNomeOriginal] = useState("")
    const [categoria, setCategoria] = useState("")
    const [status, setStatus] = useState("")
    const [corpoTexto, setCorpoTexto] = useState("")
    const [variaveis, setVariaveis] = useState<VariavelItem[]>([])
    const [phoneNumberId, setPhoneNumberId] = useState("")
    const [observacoes, setObservacoes] = useState("")
    const [ativo, setAtivo] = useState(true)

    // Placeholders detectados no corpo_texto
    const posicoes = detectarPosicoes(corpoTexto)

    // Telefone selecionado — deriva automação/agente/WABA automaticamente
    const selectedPhone = phoneNumbers.find(p => p.phone_number_id === phoneNumberId) ?? null

    // Carregar template + números
    const load = useCallback(async () => {
        setLoading(true)
        try {
            const [tplRes, pnRes, allTplRes] = await Promise.all([
                fetch(`/api/admin/meta-templates/${id}`),
                fetch("/api/admin/meta-phone-numbers"),
                fetch("/api/admin/meta-templates"),
            ])
            if (!tplRes.ok) throw new Error("Template não encontrado")
            const tpl: MetaTemplate = await tplRes.json()
            const pns: PhoneNumber[] = pnRes.ok ? await pnRes.json() : []
            const allTpls: MetaTemplate[] = allTplRes.ok ? await allTplRes.json() : []

            setTemplate(tpl)
            setPhoneNumbers(pns.filter(p => p.ativo))
            setOutrosNomes(allTpls.filter(t => t.id !== tpl.id).map(t => t.nome))
            setNome(tpl.nome)
            setNomeOriginal(tpl.nome)
            setCategoria(tpl.categoria ?? "UTILITY")
            setStatus(tpl.status)
            setCorpoTexto(tpl.corpo_texto ?? "")
            setVariaveis(Array.isArray(tpl.variaveis) ? tpl.variaveis : [])
            setPhoneNumberId(tpl.phone_number_ids?.[0] ?? "")
            setObservacoes(tpl.observacoes ?? "")
            setAtivo(tpl.ativo)
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Erro ao carregar")
        } finally {
            setLoading(false)
        }
    }, [id])

    useEffect(() => { load() }, [load])

    // Sincronizar variaveis quando corpo_texto muda
    useEffect(() => {
        setVariaveis(prev => syncVarList(posicoes, prev))
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [corpoTexto])

    function setVarDescricao(posicao: number, descricao: string) {
        setVariaveis(prev =>
            prev.map(v => v.posicao === posicao ? { ...v, descricao } : v)
        )
    }

    async function handleSave() {
        const nomeTrimmed = nome.trim()
        if (!nomeTrimmed) {
            toast.error("Nome do template não pode ficar vazio")
            return
        }
        if (nomeTrimmed !== nomeOriginal && outrosNomes.includes(nomeTrimmed)) {
            toast.error("Já existe outro template com este nome")
            return
        }
        if (!selectedPhone) {
            toast.error("Selecione um número Meta")
            return
        }

        setSaving(true)
        try {
            const res = await fetch(`/api/admin/meta-templates/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    nome: nomeTrimmed,
                    categoria: categoria || null,
                    status,
                    corpo_texto: corpoTexto.trim() || null,
                    variaveis,
                    automacoes: [selectedPhone.canal_tipo],
                    phone_number_ids: [selectedPhone.phone_number_id],
                    waba_ids: [selectedPhone.waba_id],
                    observacoes: observacoes.trim() || null,
                    ativo,
                }),
            })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.error ?? "Erro ao salvar")
            }
            toast.success("Template salvo")
            router.push("/developer/meta-templates")
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err))
        } finally {
            setSaving(false)
        }
    }

    if (loading) {
        return (
            <div className="flex h-64 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
        )
    }

    if (!template) {
        return (
            <div className="py-16 text-center text-sm text-muted-foreground">
                Template não encontrado.{" "}
                <Link href="/developer/meta-templates" className="underline">Voltar</Link>
            </div>
        )
    }

    return (
        <div className="flex flex-col gap-6 max-w-3xl">
            {/* Header */}
            <div className="flex items-center gap-3">
                <Link href="/developer/meta-templates">
                    <Button variant="ghost" size="icon" className="h-8 w-8">
                        <ArrowLeft className="h-4 w-4" />
                    </Button>
                </Link>
                <div>
                    <h1 className="text-xl font-semibold tracking-tight">Editar template</h1>
                    <p className="text-xs text-muted-foreground">
                        O corpo do texto é a fonte de verdade. Worker, edge functions e portal leem daqui — zero texto no código.
                    </p>
                </div>
            </div>

            {/* Card */}
            <div className="rounded-xl border bg-card p-6 flex flex-col gap-5">

                {/* Linha 1: Nome (sempre editável) + Categoria + Status */}
                <div className="grid grid-cols-[1fr_150px_160px] gap-4">
                    <div className="flex flex-col gap-1.5">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                            Nome do template <span className="normal-case text-muted-foreground/60">(exato, como aprovado na Meta)</span>
                        </Label>
                        <Input
                            value={nome}
                            onChange={e => setNome(e.target.value)}
                            className="font-mono text-sm"
                        />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Categoria</Label>
                        <Select value={categoria} onValueChange={setCategoria}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {CATEGORIAS.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Status</Label>
                        <Select value={status} onValueChange={setStatus}>
                            <SelectTrigger>
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>
                </div>

                {/* Corpo do texto */}
                <div className="flex flex-col gap-1.5">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                        Corpo do texto{" "}
                        <span className="normal-case text-muted-foreground/60">— use {"{{1}}"}, {"{{2}}"} para variáveis</span>
                    </Label>
                    <Textarea
                        value={corpoTexto}
                        onChange={e => setCorpoTexto(e.target.value)}
                        rows={6}
                        className="font-mono text-sm resize-y"
                        placeholder={"Olá {{1}}! ..."}
                    />
                    {posicoes.length > 0 && (
                        <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground mt-1">
                            <span>Placeholders detectados:</span>
                            {posicoes.map(p => (
                                <span
                                    key={p}
                                    className="font-mono text-[11px] bg-primary/10 text-primary border border-primary/30 px-1.5 py-0.5 rounded"
                                >
                                    {`{{${p}}}`}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                {/* Variáveis detectadas */}
                {variaveis.length > 0 && (
                    <div className="flex flex-col gap-1.5">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                            Variáveis detectadas{" "}
                            <span className="normal-case text-muted-foreground/60">— descreva cada uma</span>
                        </Label>
                        <div className="flex flex-col gap-2.5">
                            {variaveis.map(v => (
                                <div key={v.posicao} className="flex items-center gap-3">
                                    <span className="font-mono text-[13px] bg-primary/10 text-primary border border-primary/30 px-2.5 py-1 rounded min-w-[46px] text-center flex-shrink-0">
                                        {`{{${v.posicao}}}`}
                                    </span>
                                    <Input
                                        placeholder={`Descrição da variável ${v.posicao}`}
                                        value={v.descricao}
                                        onChange={e => setVarDescricao(v.posicao, e.target.value)}
                                        className="flex-1 text-sm"
                                    />
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Telefone — deriva automação/agente/WABA automaticamente */}
                <div className="flex flex-col gap-1.5">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                        Telefone <span className="normal-case text-muted-foreground/60">— define automação, agente e WABA</span>
                    </Label>
                    <Select value={phoneNumberId} onValueChange={setPhoneNumberId}>
                        <SelectTrigger>
                            <SelectValue placeholder="Selecione o número Meta" />
                        </SelectTrigger>
                        <SelectContent>
                            {phoneNumbers.map(p => (
                                <SelectItem key={p.phone_number_id} value={p.phone_number_id}>
                                    {p.display_name} — {p.phone_number_id}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="grid grid-cols-3 gap-4">
                    <div className="flex flex-col gap-1.5">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Automação</Label>
                        <Input readOnly value={selectedPhone?.canal_tipo ?? ""} className="text-sm text-muted-foreground cursor-not-allowed" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">Agente</Label>
                        <Input readOnly value={selectedPhone?.agente_tipo ?? ""} className="text-sm text-muted-foreground cursor-not-allowed" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                        <Label className="text-xs uppercase tracking-wide text-muted-foreground">WABA</Label>
                        <Input readOnly value={selectedPhone?.waba_id ?? ""} className="font-mono text-xs text-muted-foreground cursor-not-allowed" />
                    </div>
                </div>

                {/* Observações */}
                <div className="flex flex-col gap-1.5">
                    <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                        Observações <span className="normal-case text-muted-foreground/60">— notas livres</span>
                    </Label>
                    <Textarea
                        value={observacoes}
                        onChange={e => setObservacoes(e.target.value)}
                        rows={2}
                        placeholder="Contexto, histórico de aprovação Meta..."
                        className="text-sm"
                    />
                </div>

                {/* Divider + Toggle ativo */}
                <hr className="border-border" />

                <div className="flex items-center justify-between">
                    <Label className="text-sm text-muted-foreground">Template ativo</Label>
                    <Switch checked={ativo} onCheckedChange={setAtivo} />
                </div>

                {/* Ações */}
                <div className="flex justify-end gap-2.5 border-t border-border pt-5">
                    <Link href="/developer/meta-templates">
                        <Button variant="outline">Cancelar</Button>
                    </Link>
                    <Button onClick={handleSave} disabled={saving} className="gap-2">
                        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                        Salvar template
                    </Button>
                </div>
            </div>
        </div>
    )
}
