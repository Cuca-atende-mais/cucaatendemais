"use client"

import { useEffect, useMemo, useState } from "react"
import { MAX_IDS_CONTADORES, type MapaContadores } from "./contadores-selecoes"

// S-EMP-GES-10 (AC11): busca "seleções ativas" e "seleções de que já participou" dos talentos que
// estão na tela. Se a rota falhar, devolve mapa vazio e a tela mostra "—" sem quebrar.

export function useContadoresSelecoes(ids: string[]): MapaContadores {
    const chave = useMemo(() => [...new Set(ids)].sort().join(","), [ids])
    const [mapa, setMapa] = useState<MapaContadores>({})

    useEffect(() => {
        const lista = chave ? chave.split(",") : []
        // Lista vazia: nada a buscar. O mapa antigo pode ficar — a tela só lê os ids que mostra.
        if (lista.length === 0) return
        const controle = new AbortController()
        const lotes: string[][] = []
        for (let i = 0; i < lista.length; i += MAX_IDS_CONTADORES) lotes.push(lista.slice(i, i + MAX_IDS_CONTADORES))

        Promise.all(lotes.map(async lote => {
            const res = await fetch("/api/empregabilidade/talent-bank/contadores", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: lote }),
                signal: controle.signal,
            })
            if (!res.ok) throw new Error(`contadores: ${res.status}`)
            const corpo = await res.json() as { contadores?: MapaContadores }
            return corpo.contadores ?? {}
        }))
            .then(partes => setMapa(Object.assign({}, ...partes)))
            .catch(err => {
                if (controle.signal.aborted) return
                console.error("[useContadoresSelecoes]", err)
                setMapa({})
            })

        return () => controle.abort()
    }, [chave])

    return mapa
}
