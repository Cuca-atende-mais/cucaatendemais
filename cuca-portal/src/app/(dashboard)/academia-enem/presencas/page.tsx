"use client"

import { useState, useRef, useMemo } from "react"
import * as XLSX from "xlsx"
import { useUser } from "@/lib/auth/user-provider"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
    Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table"
import {
    GraduationCap, Upload, FileSpreadsheet, ShieldAlert, Clock,
    CheckCircle2, AlertTriangle, ListChecks,
} from "lucide-react"
import toast from "react-hot-toast"

type Campo = "nome" | "telefone" | "presenca" | "data"
const CAMPOS: { key: Campo; label: string; hints: RegExp }[] = [
    { key: "nome", label: "Nome", hints: /nome|aluno|participante/i },
    { key: "telefone", label: "Telefone", hints: /tel|fone|celular|whats|contato/i },
    { key: "presenca", label: "Presença", hints: /presen|frequen|falta|comparec/i },
    { key: "data", label: "Data do encontro", hints: /data|dia|encontro/i },
]

type Resultado = {
    total: number
    importadas: number
    vinculadas: number
    invalidas: { linha: number; motivo: string }[]
}

const NENHUM = "__none__"

export default function PresencasImportPage() {
    const { isDeveloper, hasPermission, loading: authLoading } = useUser()
    const canRead = isDeveloper || hasPermission("ae_presenca", "read")
    const canCreate = isDeveloper || hasPermission("ae_presenca", "create")

    const [fileName, setFileName] = useState<string | null>(null)
    const [headers, setHeaders] = useState<string[]>([])
    const [rows, setRows] = useState<string[][]>([])
    const [map, setMap] = useState<Record<Campo, number>>({ nome: -1, telefone: -1, presenca: -1, data: -1 })
    const [enviando, setEnviando] = useState(false)
    const [resultado, setResultado] = useState<Resultado | null>(null)
    const fileRef = useRef<HTMLInputElement>(null)

    const handleFile = (file: File) => {
        setResultado(null)
        const reader = new FileReader()
        reader.onload = (ev) => {
            try {
                const bstr = ev.target?.result
                const wb = XLSX.read(bstr, { type: "binary" })
                const ws = wb.Sheets[wb.SheetNames[0]]
                // header:1 → array de arrays; datas como texto dd/mm/yyyy (mesmo padrão do import de programação)
                const aoa: unknown[][] = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: "dd/mm/yyyy", blankrows: false })
                if (!aoa.length) { toast.error("Planilha vazia"); return }
                const hdr = (aoa[0] as unknown[]).map(c => String(c ?? "").trim())
                const body = aoa.slice(1).map(r => hdr.map((_, i) => String((r as unknown[])[i] ?? "").trim()))
                setHeaders(hdr)
                setRows(body)
                setFileName(file.name)
                // auto-mapeamento por nome de coluna; fallback posicional 0..3
                const auto: Record<Campo, number> = { nome: -1, telefone: -1, presenca: -1, data: -1 }
                CAMPOS.forEach((c, idx) => {
                    const found = hdr.findIndex(h => c.hints.test(h))
                    auto[c.key] = found >= 0 ? found : (hdr[idx] !== undefined ? idx : -1)
                })
                setMap(auto)
            } catch {
                toast.error("Não foi possível ler a planilha")
            }
        }
        reader.readAsBinaryString(file)
    }

    const preview = useMemo(() => rows.slice(0, 8), [rows])

    const handleImport = async () => {
        if (!canCreate) { toast.error("Sem permissão para importar"); return }
        if (map.telefone < 0 || map.data < 0) { toast.error("Mapeie ao menos Telefone e Data"); return }
        setEnviando(true)
        setResultado(null)
        try {
            const linhas = rows.map(r => ({
                nome: map.nome >= 0 ? r[map.nome] : "",
                telefone: map.telefone >= 0 ? r[map.telefone] : "",
                presenca: map.presenca >= 0 ? r[map.presenca] : "",
                data: map.data >= 0 ? r[map.data] : "",
            }))
            const res = await fetch("/api/academia-enem/presencas/importar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ linhas }),
            })
            const json = await res.json()
            if (!res.ok) throw new Error(json.error || "Falha na importação")
            setResultado(json as Resultado)
            toast.success(`${json.importadas} presença(s) importada(s)`)
        } catch (err) {
            toast.error(err instanceof Error ? err.message : "Erro ao importar")
        } finally {
            setEnviando(false)
        }
    }

    // Enquanto o perfil/permissões carregam, não decide acesso (evita flash de "Acesso Restrito").
    if (authLoading) {
        return (
            <div className="space-y-4 animate-pulse">
                <div className="h-9 w-80 bg-muted rounded" />
                <div className="h-40 bg-muted rounded" />
            </div>
        )
    }

    if (!canRead) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center p-12 gap-4 text-center">
                <ShieldAlert className="h-16 w-16 text-slate-300" />
                <h2 className="text-xl font-bold text-slate-700">Acesso Restrito</h2>
                <p className="text-slate-500 max-w-sm">Você não tem permissão para acessar a importação de presença da Academia Enem.</p>
            </div>
        )
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-primary/10 border border-primary/20">
                    <GraduationCap className="h-6 w-6 text-primary" />
                </div>
                <div>
                    <h1 className="text-3xl font-bold tracking-tight">Importação de Presença</h1>
                    <p className="text-muted-foreground text-sm">
                        Importe a planilha de frequência dos encontros. Colunas esperadas: nome, telefone, presença (sim/não), data.
                    </p>
                </div>
            </div>

            {/* Upload */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base">1. Selecione a planilha</CardTitle>
                    <CardDescription>Formatos aceitos: .xlsx, .xls, .csv</CardDescription>
                </CardHeader>
                <CardContent>
                    <div
                        className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center cursor-pointer hover:border-primary/40 hover:bg-muted/30 transition-colors"
                        onClick={() => fileRef.current?.click()}
                    >
                        <div className="flex flex-col items-center gap-2">
                            {fileName ? <FileSpreadsheet className="h-8 w-8 text-primary" /> : <Upload className="h-8 w-8 text-muted-foreground/50" />}
                            <p className="text-sm text-muted-foreground">{fileName ?? "Clique para selecionar a planilha"}</p>
                            {rows.length > 0 && <Badge variant="secondary" className="text-xs">{rows.length} linha(s)</Badge>}
                        </div>
                    </div>
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".xlsx,.xls,.csv"
                        className="hidden"
                        onChange={e => { const file = e.target.files?.[0]; if (file) handleFile(file); e.target.value = "" }}
                    />
                </CardContent>
            </Card>

            {/* Mapeamento + preview */}
            {headers.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base">2. Confira o mapeamento de colunas</CardTitle>
                        <CardDescription>Ajuste qual coluna da planilha corresponde a cada campo.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
                            {CAMPOS.map(c => (
                                <div key={c.key} className="grid gap-1">
                                    <Label className="text-xs">
                                        {c.label}{(c.key === "telefone" || c.key === "data") && <span className="text-red-500"> *</span>}
                                    </Label>
                                    <Select
                                        value={map[c.key] >= 0 ? String(map[c.key]) : NENHUM}
                                        onValueChange={v => setMap(prev => ({ ...prev, [c.key]: v === NENHUM ? -1 : Number(v) }))}
                                    >
                                        <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value={NENHUM}>— (ignorar)</SelectItem>
                                            {headers.map((h, i) => (
                                                <SelectItem key={i} value={String(i)}>{h || `Coluna ${i + 1}`}</SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </div>
                            ))}
                        </div>

                        {/* Preview */}
                        <div className="rounded-lg border overflow-x-auto">
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        {CAMPOS.map(c => <TableHead key={c.key}>{c.label}</TableHead>)}
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {preview.map((r, ri) => (
                                        <TableRow key={ri}>
                                            {CAMPOS.map(c => (
                                                <TableCell key={c.key} className="text-sm">
                                                    {map[c.key] >= 0 ? (r[map[c.key]] || "—") : "—"}
                                                </TableCell>
                                            ))}
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                        {rows.length > preview.length && (
                            <p className="text-xs text-muted-foreground">Mostrando {preview.length} de {rows.length} linhas.</p>
                        )}

                        <div className="flex justify-end">
                            <Button onClick={handleImport} disabled={enviando || !canCreate}>
                                {enviando
                                    ? <><Clock className="mr-2 h-4 w-4 animate-spin" />Importando...</>
                                    : <><ListChecks className="mr-2 h-4 w-4" />Importar {rows.length} linha(s)</>}
                            </Button>
                        </div>
                        {!canCreate && (
                            <p className="text-xs text-amber-600 text-right">Você pode visualizar, mas não tem permissão para importar (ae_presenca:create).</p>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Resultado */}
            {resultado && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-base flex items-center gap-2">
                            <CheckCircle2 className="h-5 w-5 text-green-600" /> Resultado da importação
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-4 sm:grid-cols-3">
                            <div className="rounded-lg border p-3">
                                <p className="text-2xl font-bold">{resultado.importadas}</p>
                                <p className="text-xs text-muted-foreground">Importadas (de {resultado.total})</p>
                            </div>
                            <div className="rounded-lg border p-3">
                                <p className="text-2xl font-bold text-primary">{resultado.vinculadas}</p>
                                <p className="text-xs text-muted-foreground">Vinculadas a um lead</p>
                            </div>
                            <div className="rounded-lg border p-3">
                                <p className="text-2xl font-bold text-amber-600">{resultado.invalidas.length}</p>
                                <p className="text-xs text-muted-foreground">Linhas ignoradas</p>
                            </div>
                        </div>

                        {resultado.invalidas.length > 0 && (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                                <p className="text-sm font-medium text-amber-800 flex items-center gap-1.5 mb-2">
                                    <AlertTriangle className="h-4 w-4" /> Linhas ignoradas (não abortam o lote)
                                </p>
                                <div className="max-h-48 overflow-y-auto text-xs text-amber-900 space-y-0.5">
                                    {resultado.invalidas.map((iv, i) => (
                                        <div key={i}>Linha {iv.linha}: {iv.motivo}</div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    )
}
