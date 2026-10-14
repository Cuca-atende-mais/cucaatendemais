"use client"

import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { Clock } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { useUser } from "@/lib/auth/user-provider"
import { Badge } from "@/components/ui/badge"
import { EPM_FEEDBACK } from "@/lib/rbac/catalogo-empregabilidade-gestao"
import { diasSemResposta, textoSelo, ultimaPorVaga } from "@/lib/empregabilidade/feedback-retorno"

// S-EMP-GES-03 (AC9): selo "sem resposta há X dias" nas listas de Vagas e Seleções. Uma leitura só para
// todas as vagas da página (sem N+1), pela RLS de epm_feedback_ver — sem a permissão, nenhum selo.

const LOTE = 200

interface PedidoLista {
    vaga_id: string
    created_at: string
    status_envio: string
    expires_at: string | null
    respondido_em: string | null
    situacao: string | null
}

export function useDiasSemResposta(vagaIds: string[]): Map<string, number> {
    const { hasPermission, loading } = useUser()
    const pode = !loading && hasPermission(EPM_FEEDBACK.ver, "read")
    const chave = useMemo(() => [...vagaIds].sort().join(","), [vagaIds])

    const { data } = useQuery({
        queryKey: ["empregabilidade", "feedback-selo", chave],
        enabled: pode && vagaIds.length > 0,
        staleTime: 60_000,
        queryFn: async () => {
            const supabase = createClient()
            const ids = chave.split(",")
            const pedidos: PedidoLista[] = []
            for (let i = 0; i < ids.length; i += LOTE) {
                const { data: linhas, error } = await supabase
                    .from("feedback_solicitacoes")
                    .select("vaga_id, created_at, status_envio, expires_at, respondido_em, situacao")
                    .in("vaga_id", ids.slice(i, i + LOTE))
                if (error) throw error
                pedidos.push(...((linhas ?? []) as PedidoLista[]))
            }
            return pedidos
        },
    })

    return useMemo(() => {
        const mapa = new Map<string, number>()
        if (!data) return mapa
        const agora = new Date()
        for (const [vagaId, ultima] of ultimaPorVaga(data)) {
            const dias = diasSemResposta(ultima, agora)
            if (dias !== null) mapa.set(vagaId, dias)
        }
        return mapa
    }, [data])
}

export function SeloSemResposta({ dias }: { dias: number | undefined }) {
    if (dias === undefined) return null
    return (
        <Badge variant="outline" className="gap-1 border-amber-300 bg-amber-50 text-amber-900 whitespace-nowrap">
            <Clock className="h-3 w-3" /> {textoSelo(dias)}
        </Badge>
    )
}
