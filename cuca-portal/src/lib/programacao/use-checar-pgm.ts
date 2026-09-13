"use client"

import { useMemo } from "react"
import { useUser } from "@/lib/auth/user-provider"
import { checadorDePermissoes, type ChecarPermissao } from "./permissoes-categoria"

// S-PROG-13: checagem exata das opções da programação mensal nas telas — mesma regra do banco
// (sem o passe livre por nome de perfil que `hasPermission` ainda dá ao "Super Admin Cuca").
export function useChecarPgm(): ChecarPermissao {
    const { profile, isDeveloper } = useUser()
    return useMemo(
        () => checadorDePermissoes(profile?.funcao.permissoes, isDeveloper),
        [profile, isDeveloper],
    )
}
