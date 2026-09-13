import type { User } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import { isDeveloperEmail } from "@/lib/auth/developers"
import {
    checadorDePermissoes, podeAcessarUnidade, type ChecarPermissao, type LinhaPermissaoPgm,
} from "./permissoes-categoria"

export type AcessoPgm = {
    checar: ChecarPermissao
    /** A campanha desta unidade está ao alcance de quem pede? (regra de `get_my_unit()`) */
    alcancaUnidade: (unidade: string | null | undefined) => boolean
}

// S-PROG-13: permissões da programação mensal e unidade de quem está logado, lidas uma vez por
// requisição. Mesma regra de `has_permission_exata` (colaborador ativo ou sem o campo, perfil do
// colaborador, módulo exato) e de `get_my_unit()`. As rotas que gravam com a chave de serviço
// precisam das duas checagens, porque as políticas do banco não se aplicam a elas.
export async function carregarAcessoPgm(user: User): Promise<AcessoPgm> {
    if (isDeveloperEmail(user.email)) {
        return { checar: checadorDePermissoes(null, true), alcancaUnidade: () => true }
    }

    const admin = createAdminClient()
    const { data: colaborador } = await admin
        .from("colaboradores")
        .select("role_id, ativo, unidade_cuca")
        .eq("user_id", user.id)
        .maybeSingle()

    const unidadeDoColaborador = colaborador?.unidade_cuca as string | null | undefined
    const alcancaUnidade = (unidade: string | null | undefined) => podeAcessarUnidade(unidadeDoColaborador, unidade, false)

    if (!colaborador?.role_id || colaborador.ativo === false) {
        return { checar: checadorDePermissoes(null, false), alcancaUnidade }
    }

    const { data: linhas } = await admin
        .from("sys_permissions")
        .select("module, can_read, can_create, can_update, can_delete")
        .eq("role_id", colaborador.role_id)
        .like("module", "pgm_%")

    return { checar: checadorDePermissoes(linhas as LinhaPermissaoPgm[] | null, false), alcancaUnidade }
}
