import { NextResponse } from "next/server"
import type { User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import {
    ACAO_POR_OPERACAO,
    NOME_PERFIL_DEVELOPER,
    avaliarAcessoColaborador,
    type EntradaAcessoColaborador,
} from "./colaboradores-acesso"

type Autorizado = { ok: true; user: User; developer: boolean }
type Negado = { ok: false; resposta: NextResponse }

type DadosOperacao = Omit<EntradaAcessoColaborador, "emailQuemPede" | "temPermissao" | "atribuiPerfilDeveloper"> & {
    roleIdNovo?: string | null
}

async function ehPerfilDeveloper(roleId: string | null | undefined): Promise<boolean> {
    if (!roleId) return false
    const { data } = await createAdminClient().from("sys_roles").select("name").eq("id", roleId).maybeSingle()
    return data?.name === NOME_PERFIL_DEVELOPER
}

export async function autorizarOperacaoColaborador(
    { roleIdNovo, ...dados }: DadosOperacao,
): Promise<Autorizado | Negado> {
    const supabase = await createClient()
    const { data: { user }, error } = await supabase.auth.getUser()
    if (error || !user) {
        return { ok: false, resposta: NextResponse.json({ error: "Não autorizado" }, { status: 401 }) }
    }

    const { data: temPermissao } = await supabase.rpc("has_permission", {
        p_recurso: "config_colaboradores",
        p_acao: ACAO_POR_OPERACAO[dados.operacao],
    })

    const resultado = avaliarAcessoColaborador({
        ...dados,
        emailQuemPede: user.email,
        temPermissao: temPermissao === true,
        atribuiPerfilDeveloper: await ehPerfilDeveloper(roleIdNovo),
    })
    if (!resultado.permitido) {
        return { ok: false, resposta: NextResponse.json({ error: resultado.error }, { status: resultado.status }) }
    }
    return { ok: true, user, developer: resultado.developer }
}
