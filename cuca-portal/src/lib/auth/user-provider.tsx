"use client"

import { createContext, useContext, useEffect, useMemo, useCallback, useState, useRef } from "react"
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

// Emails autorizados como Developer real — APENAS estes dois
const DEVELOPER_EMAILS = ['valmir@cucateste.com', 'dev.cucaatendemais@gmail.com']

// Módulos exclusivos dos 2 Developers — ninguém mais acessa nem via RBAC
const DEVELOPER_ONLY_MODULES = ['developer']

export function UserProvider({ children }: { children: React.ReactNode }) {
    const [user, setUser] = useState<User | null>(null)
    const [profile, setProfile] = useState<UserProfile | null>(null)
    const [loading, setLoading] = useState(true)

    // Estabiliza a instância do Supabase client — não recriada a cada render
    const supabase = useMemo(() => createClient(), [])

    const fetchProfile = useCallback(async (userId: string): Promise<UserProfile | null> => {
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
    }, [supabase])

    useEffect(() => {
        let isMounted = true

        const initializeUser = async () => {
            try {
                setLoading(true)
                const { data: { user: currentUser } } = await supabase.auth.getUser()

                if (!isMounted) return

                setUser(currentUser)

                if (currentUser) {
                    const userProfile = await fetchProfile(currentUser.id)
                    if (isMounted) setProfile(userProfile)
                } else {
                    setProfile(null)
                }
            } catch (err) {
                console.error("Erro fatal na inicialização do usuário:", err)
            } finally {
                if (isMounted) setLoading(false)
            }
        }

        initializeUser()

        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
            if (!isMounted) return

            try {
                const currentUser = session?.user ?? null
                setUser(currentUser)

                if (currentUser) {
                    const userProfile = await fetchProfile(currentUser.id)
                    if (isMounted) setProfile(userProfile)
                } else {
                    setProfile(null)
                }
            } catch (err) {
                console.error("Erro ao lidar com mudança de auth:", err)
            } finally {
                if (isMounted) setLoading(false)
            }
        })

        return () => {
            isMounted = false
            subscription.unsubscribe()
        }
    }, []) // eslint-disable-line react-hooks/exhaustive-deps
    // Intencionalmente vazio: supabase e fetchProfile são estáveis via useMemo/useCallback.
    // O listener onAuthStateChange deve registrar-se apenas uma vez.

    const hasPermission = useCallback((recurso: string, acao: string): boolean => {
        if (!profile) return false

        if (DEVELOPER_EMAILS.includes(profile.email || '')) return true
        if (DEVELOPER_ONLY_MODULES.includes(recurso)) return false
        if (profile.funcao.nome === 'Super Admin Cuca') return true

        const resourcePerm = profile.funcao.permissoes.find((p: any) => p.module === recurso)
        if (!resourcePerm) return false

        switch (acao) {
            case 'read': return resourcePerm.can_read
            case 'create': return resourcePerm.can_create
            case 'update': return resourcePerm.can_update
            case 'delete': return resourcePerm.can_delete
            default: return false
        }
    }, [profile])

    // S27-03: isDeveloper baseado exclusivamente no email (não no nome do role)
    const isDeveloper = DEVELOPER_EMAILS.includes(profile?.email || '')

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
