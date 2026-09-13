import type { User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { PGM_DIVULGACAO } from "@/lib/rbac/catalogo-programacao-mensal"
import { opcaoLiberada, type ChecarPermissao } from "@/lib/programacao/permissoes-categoria"
import { carregarAcessoPgm } from "@/lib/programacao/permissoes-categoria-server"

export type AcessoDivulgacao = {
    user: User
    checar: ChecarPermissao
    podeVer: boolean
    podeAprovarRag: boolean
    podeDisparar: boolean
}

// S-PROG-15: ver a Divulgação = módulo `divulgacao` (leitura) ou uma das duas opções; aprovar RAG e
// disparar = opção própria de cada um (S-PROG-12). Developer passa em tudo.
export async function carregarAcessoDivulgacao(): Promise<AcessoDivulgacao | null> {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const { checar } = await carregarAcessoPgm(user)
    const podeAprovarRag = opcaoLiberada(checar, PGM_DIVULGACAO.aprovarRag)
    const podeDisparar = opcaoLiberada(checar, PGM_DIVULGACAO.dispararGlobal)
    return {
        user,
        checar,
        podeVer: checar("divulgacao", "read") || podeAprovarRag || podeDisparar,
        podeAprovarRag,
        podeDisparar,
    }
}

export function lerMesAno(mes: unknown, ano: unknown): { mes: number; ano: number } | null {
    const m = Number(mes)
    const a = Number(ano)
    if (!Number.isInteger(m) || m < 1 || m > 12 || !Number.isInteger(a) || a < 2000 || a > 2100) return null
    return { mes: m, ano: a }
}
