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
        permissoes: any[]
    }
    unidade_cuca: string
    email: string
}

type UserContextType = {
    user: User | null
    profile: UserProfile | null
    loading: boolean
    hasPermission: (recurso: string, acao: string) => boolean
    isDeveloper: boolean
}

const UserContext = createContext<UserContextType>({
    user: null,
    profile: null,
    loading: true,
    hasPermission: () => false,
    isDeveloper: false,
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
                email,
                unidade_cuca,
                sys_roles (
                    name,
                    sys_permissions (
                        module,
                        can_read,
                        can_create,
                        can_update,
                        can_delete
                    )
                )
            `)
            .eq("user_id", userId)
            .single()

        if (error || !data) {
            console.error("Erro ao carregar perfil:", error)
            return null
        }

        try {
            // Transformar estrutura aninhada em algo mais limpo
            const mappedProfile: UserProfile = {
                id: data.id,
                nome_completo: data.nome_completo,
                email: data.email,
                unidade_cuca: data.unidade_cuca,
                funcao: {
                    nome: (data.sys_roles as any)?.name || 'Sem Função',
                    permissoes: (data.sys_roles as any)?.sys_permissions || []
                }
            }
            return mappedProfile
        } catch (mappingError) {
            console.error("Erro ao mapear o perfil do colaborador:", mappingError, "Dados crus:", data)
            return null
        }
    }

    // Emails autorizados como Developer real — APENAS estes dois
    const DEVELOPER_EMAILS = ['valmir@cucateste.com', 'dev.cucaatendemais@gmail.com']

    // Módulos exclusivos dos 2 Developers — ninguém mais acessa nem via RBAC
    const DEVELOPER_ONLY_MODULES = ['programacao_rag_global', 'developer']

    const hasPermission = (recurso: string, acao: string) => {
        if (!profile) return false

        // Developers reais (2 emails): acesso total a TUDO, inclusive módulos exclusivos
        if (DEVELOPER_EMAILS.includes(profile.email || '')) return true

        // Módulos exclusive dos devs: bloquear qualquer outro usuário
        if (DEVELOPER_ONLY_MODULES.includes(recurso)) return false

        // Super Admin e Developer role: acesso a todos os módulos via RBAC
        if (profile.funcao.nome === 'Developer' || profile.funcao.nome === 'Super Admin Cuca') return true

        const resourcePerm = profile.funcao.permissoes.find((p: any) => p.module === recurso)
        if (!resourcePerm) return false

        switch (acao) {
            case 'read': return resourcePerm.can_read
            case 'create': return resourcePerm.can_create
            case 'update': return resourcePerm.can_update
            case 'delete': return resourcePerm.can_delete
            default: return false
        }
    }

    const isDeveloper = profile?.funcao?.nome === 'Developer' &&
        DEVELOPER_EMAILS.includes(profile?.email || '')

    useEffect(() => {
        const initializeUser = async () => {
            try {
                setLoading(true)
                const { data: { user } } = await supabase.auth.getUser()
                setUser(user)

                if (user) {
                    const userProfile = await fetchProfile(user.id)
                    setProfile(userProfile)
                } else {
                    setProfile(null)
                }
            } catch (err) {
                console.error("Erro fatal na inicialização do usuário:", err)
            } finally {
                setLoading(false)
            }
        }

        initializeUser()

        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
            try {
                const currentUser = session?.user ?? null
                setUser(currentUser)

                if (currentUser) {
                    const userProfile = await fetchProfile(currentUser.id)
                    setProfile(userProfile)
                } else {
                    setProfile(null)
                }
            } catch (err) {
                console.error("Erro ao lidar com mudança de auth:", err)
            } finally {
                setLoading(false)
            }
        })

        return () => subscription.unsubscribe()
    }, [supabase.auth])

    return (
        <UserContext.Provider value={{ user, profile, loading, hasPermission, isDeveloper }}>
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
