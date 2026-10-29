"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import type { SupabaseClient } from "@supabase/supabase-js"
import toast from "react-hot-toast"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { excluirProjeto } from "@/lib/planejamento/projeto-dados"

// S-PLA-03 (AC9): o próprio botão vira "Confirmar exclusão", com o aviso e o "Cancelar" ao lado,
// sem modal. Exclusão lógica: o projeto sai das telas e o dado fica guardado.
export function ExcluirProjeto({ supabase, projetoId }: { supabase: SupabaseClient; projetoId: string }) {
    const router = useRouter()
    const [confirmando, setConfirmando] = useState(false)
    const [excluindo, setExcluindo] = useState(false)

    const excluir = async () => {
        setExcluindo(true)
        try {
            await excluirProjeto(supabase, projetoId)
            toast.success("Projeto excluído")
            router.push("/planejamento")
        } catch (e) {
            toast.error(e instanceof Error ? e.message : String(e))
            setExcluindo(false)
        }
    }

    if (!confirmando) {
        return (
            <Button variant="outline" className="text-rose-700 hover:text-rose-800" onClick={() => setConfirmando(true)}>
                <Trash2 className="mr-1 h-4 w-4" /> Excluir
            </Button>
        )
    }
    return (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5">
            <span className="text-sm text-rose-900">Esta ação remove o projeto da lista</span>
            <Button variant="destructive" size="sm" onClick={excluir} disabled={excluindo}>
                {excluindo ? "Excluindo…" : "Confirmar exclusão"}
            </Button>
            <Button variant="outline" size="sm" onClick={() => setConfirmando(false)} disabled={excluindo}>Cancelar</Button>
        </div>
    )
}
