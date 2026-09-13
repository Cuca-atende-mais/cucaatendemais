import type { User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { PGM_DIVULGACAO } from "@/lib/rbac/catalogo-programacao-mensal"
import { PGM_DIVULGACAO_VER } from "@/lib/rbac/catalogo-divulgacao-rag-global"
import { opcaoLiberada, type ChecarPermissao } from "@/lib/programacao/permissoes-categoria"
import { carregarAcessoPgm } from "@/lib/programacao/permissoes-categoria-server"

export type AcessoDivulgacao = {
    user: User
    checar: ChecarPermissao
    podeVer: boolean
    podeAprovarRag: boolean
    podeDisparar: boolean
}

// S-PROG-16: ver a Divulgação = opção "Ver Divulgação"; aprovar RAG e disparar = opção própria de cada
// um, e só com "Ver" (S-PROG-12/15). Developer passa em tudo.
export async function carregarAcessoDivulgacao(): Promise<AcessoDivulgacao | null> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const { checar } = await carregarAcessoPgm(user)
    const podeVer = opcaoLiberada(checar, PGM_DIVULGACAO_VER)
    return {
        user,
        checar,
        podeVer,
        podeAprovarRag: podeVer && opcaoLiberada(checar, PGM_DIVULGACAO.aprovarRag),
        podeDisparar: podeVer && opcaoLiberada(checar, PGM_DIVULGACAO.dispararGlobal),
    }
}

export function lerMesAno(mes: unknown, ano: unknown): { mes: number; ano: number } | null {
    const m = Number(mes)
    const a = Number(ano)
    if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(a) || a < 2000 || a > 2100) return null
    return { mes: m, ano: a }
}
