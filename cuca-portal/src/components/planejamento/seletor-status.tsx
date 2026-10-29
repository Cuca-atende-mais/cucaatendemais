"use client"

import { useEffect, useState } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import toast from "react-hot-toast"
import { useUser } from "@/lib/auth/user-provider"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { StatusBadge } from "@/components/planejamento/status-projeto"
import type { EstadoFicha, StatusProjeto } from "@/lib/planejamento/projeto"
import {
    LIMITE_OBSERVACAO, opcoesDoSeletor, rotuloDestino, temAlgumaPermissaoDeStatus, textoUltimaTroca,
    type DestinoStatus, type EventoStatus,
} from "@/lib/planejamento/status"
import { carregarUltimaTrocaStatus, dataHoraFortaleza, mudarStatus } from "@/lib/planejamento/projeto-dados"

// S-PLA-03 (AC11 a AC13): status no topo da página do projeto. Quem tem alguma permissão de status
// escolhe a opção, escreve o motivo (opcional) na própria página e confirma. O banco confere de novo.

export function SeletorStatus({ supabase, projetoId, status, ficha, onAlterado }: {
    supabase: SupabaseClient
    projetoId: string
    status: StatusProjeto
    ficha: EstadoFicha
    onAlterado: (novo: StatusProjeto) => void
}) {
    const { hasPermission } = useUser()
    const temPermissao = (p: string) => hasPermission(p, "read")
    const podeMudar = temAlgumaPermissaoDeStatus(temPermissao)
    const opcoes = opcoesDoSeletor(status, ficha, temPermissao)

    const [destino, setDestino] = useState<DestinoStatus | "">("")
    const [observacao, setObservacao] = useState("")
    const [salvando, setSalvando] = useState(false)
    const [ultima, setUltima] = useState<EventoStatus | null>(null)
    const [versao, setVersao] = useState(0)

    useEffect(() => {
        let cancelado = false
        carregarUltimaTrocaStatus(supabase, projetoId)
            .then(e => { if (!cancelado) setUltima(e) })
            .catch(() => { if (!cancelado) setUltima(null) })
        return () => { cancelado = true }
    }, [supabase, projetoId, versao])

    const cancelar = () => { setDestino(""); setObservacao("") }

    const confirmar = async () => {
        if (!destino) return
        setSalvando(true)
        try {
            const r = await mudarStatus(supabase, projetoId, destino, observacao)
            toast.success("Status alterado")
            cancelar()
            onAlterado(r.status)
            setVersao(v => v + 1)
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e))
        } finally {
            setSalvando(false)
        }
    }

    const ultimaTroca = textoUltimaTroca(ultima, dataHoraFortaleza)
    const motivo = ultima?.detalhe?.observacao

    return (
        <Card>
            <CardContent className="space-y-3 pt-6">
                <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm font-medium text-muted-foreground">Status</span>
                    <StatusBadge status={status} className="px-3 py-1 text-sm" />
                    {podeMudar && opcoes.length > 0 && (
                        <Select value={destino} onValueChange={v => setDestino(v as DestinoStatus)} disabled={salvando}>
                            <SelectTrigger className="w-full sm:w-72" aria-label="Mudar status para">
                                <SelectValue placeholder="Mudar status para…" />
                            </SelectTrigger>
                            <SelectContent>
                                {opcoes.map(d => <SelectItem key={d} value={d}>{rotuloDestino(d, ficha)}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    )}
                    {podeMudar && opcoes.length === 0 && (
                        <span className="text-sm text-muted-foreground">Nenhuma mudança disponível para o status atual.</span>
                    )}
                </div>

                {destino && (
                    <div className="space-y-2 rounded-md border bg-muted/30 p-3">
                        <Label htmlFor="motivo-status">Motivo da mudança (opcional)</Label>
                        <Textarea
                            id="motivo-status"
                            value={observacao}
                            maxLength={LIMITE_OBSERVACAO}
                            onChange={e => setObservacao(e.target.value)}
                            placeholder="Ex.: aprovado na reunião de planejamento"
                            disabled={salvando}
                        />
                        <div className="flex flex-wrap gap-2">
                            <Button onClick={confirmar} disabled={salvando}>
                                {salvando ? "Salvando…" : `Confirmar: ${rotuloDestino(destino, ficha)}`}
                            </Button>
                            <Button variant="outline" onClick={cancelar} disabled={salvando}>Cancelar</Button>
                        </div>
                    </div>
                )}

                {ultimaTroca && (
                    <p className="text-sm text-muted-foreground">
                        {ultimaTroca}
                        {motivo ? <> · Motivo: <span className="whitespace-pre-wrap">{motivo}</span></> : null}
                    </p>
                )}
            </CardContent>
        </Card>
    )
}
