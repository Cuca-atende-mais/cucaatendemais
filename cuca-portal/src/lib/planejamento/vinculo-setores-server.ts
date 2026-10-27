import { NextResponse } from "next/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { CAMPO_SETORES_PLANEJAMENTO, decidirVinculoSetores } from "./vinculo-setores"

// S-PLA-01: as rotas de colaborador chamam isto ANTES de gravar qualquer coisa, para que um 400
// não deixe usuário de Auth ou colaborador criado pela metade.

export type VinculoResolvido =
    | { ok: true; setores: string[] | null } // null = campo ausente, vínculo atual não muda
    | { ok: false; resposta: NextResponse }

export async function resolverVinculoSetores(corpo: Record<string, unknown>): Promise<VinculoResolvido> {
    const campo = corpo[CAMPO_SETORES_PLANEJAMENTO]
    if (campo === undefined) return { ok: true, setores: null }

    const { data, error } = await createAdminClient().from("planejamento_setores").select("id")
    if (error) {
        return { ok: false, resposta: NextResponse.json({ error: "Não foi possível ler os setores do Planejamento." }, { status: 500 }) }
    }
    const validos = (data ?? []).map((s: { id: string }) => s.id)

    const decisao = decidirVinculoSetores(campo, validos)
    if (decisao.tipo === "erro") {
        return { ok: false, resposta: NextResponse.json({ error: decisao.error }, { status: decisao.status }) }
    }
    return { ok: true, setores: decisao.tipo === "substituir" ? decisao.setores : null }
}

// Troca o conjunto inteiro numa transação só (função do banco). Devolve a mensagem de erro, ou null.
export async function gravarVinculoSetores(colaboradorId: string, setores: string[]): Promise<string | null> {
    const { error } = await createAdminClient().rpc("pla_substituir_setores_colaborador", {
        p_colaborador: colaboradorId,
        p_setores: setores,
    })
    return error ? error.message : null
}
