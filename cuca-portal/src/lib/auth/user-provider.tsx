"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { User } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/client"

type Permission = {
    recurso: string
    acao: string
}

type UserProfile = {
    id: string
    nome_completo: string
    funcao: {
        nome: string
        permissoes: Permission[]
    }
    unidade_cuca: string
}

type UserContextType = {
    user: User | null
    profile: UserProfile | null
    loading: boolean
    hasPermission: (recurso: string, acao: string) => boolean
}

const UserContext = createContext<UserContextType>({
    user: null,
    profile: null,
    loading: true,
    hasPermission: () => false,
})

export function UserProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null)
    const [profile, setProfile] = useState<UserProfile | null>(null)
    const [loading, setLoading] = useState(true)
    const supabase = createClient()

    const fetchProfile = async (userId: string) => {
        const { data, error } = await supabase
            .from("colaboradores")
            .select(`
                id,
                nome_completo,
                unidade_cuca,
                funcoes (
                    nome,
                    funcoes_permissoes (
                        permissoes (
                            recurso,
                            acao
                        )
                    )
                )
            `)
            .eq("user_id", userId)
            .single()

        if (error || !data) {
            console.error("Erro ao carregar perfil:", error)
            return null
        }

        // Transformar estrutura aninhada em algo mais limpo
        const mappedProfile: UserProfile = {
            id: data.id,
            nome_completo: data.nome_completo,
            unidade_cuca: data.unidade_cuca,
            funcao: {
                nome: (data.funcoes as any).nome,
                permissoes: (data.funcoes as any).funcoes_permissoes.map((fp: any) => ({
                    recurso: fp.permissoes.recurso,
                    acao: fp.permissoes.acao
                }))
            }
        }

        return mappedProfile
    }

    const hasPermission = (recurso: string, acao: string) => {
        if (!profile) return false
        if (profile.funcao.nome === 'super_admin') return true
        return profile.funcao.permissoes.some(p => p.recurso === recurso && (p.acao === acao || p.acao === '*'))
    }

    useEffect(() => {
        const initializeUser = async () => {
            setLoading(true)
            const { data: { user } } = await supabase.auth.getUser()
            setUser(user)

            if (user) {
                const userProfile = await fetchProfile(user.id)
                setProfile(userProfile)
            } else {
                setProfile(null)
            }
            setLoading(false)
        }

        initializeUser()

        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
            const currentUser = session?.user ?? null
            setUser(currentUser)

            if (currentUser) {
                const userProfile = await fetchProfile(currentUser.id)
                setProfile(userProfile)
            } else {
                setProfile(null)
            }
            setLoading(false)
        })

        return () => subscription.unsubscribe()
    }, [supabase.auth])

    return (
        <UserContext.Provider value={{ user, profile, loading, hasPermission }}>
            {children}
        </UserContext.Provider>
    )
}

export const useUser = () => {
    const context = useContext(UserContext)
    if (context === undefined) {
        throw new Error("useUser must be used within a UserProvider")
    }
    return context
}
