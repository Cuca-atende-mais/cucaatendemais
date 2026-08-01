"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Loader2, UserCheck } from "lucide-react"
import { TransbordoSection } from "@/components/transbordo/transbordo-section"

/* ─── Tipos ──────────────────────────────────────────────── */
type UserProfile = {
    email: string | null
    unidade_cuca: string | null
    isSuperAdmin: boolean
}

/* ─── Componente Principal ───────────────────────────────── */
// S-WM-63: esta página gerenciava instâncias UAZAPI (legado, migração pra WhatsApp
// Oficial Meta já concluída) além do transbordo humano. A gestão de instância foi
// removida por completo — só resta o cadastro de contatos de transbordo, que já era a
// funcionalidade real em uso pela Gestão CUCA (a tela de instâncias UAZAPI não tinha
// mais nenhuma instância real gerenciável por ela).
export default function WhatsAppTransbordoPage() {
    const supabase = createClient()
    const [profile, setProfile] = useState<UserProfile | null>(null)
    const [fetching, setFetching] = useState(true)

    useEffect(() => {
        loadProfile()
    }, [])

    const loadProfile = async () => {
        setFetching(true)
        try {
            const { data: { user } } = await supabase.auth.getUser()
            if (!user) return

            const { data: colab } = await supabase
                .from("colaboradores")
                .select("unidade_cuca, role_id")
                .eq("user_id", user.id)
                .maybeSingle()

            const { data: roleData } = await supabase
                .from("sys_roles")
                .select("name")
                .eq("id", colab?.role_id)
                .maybeSingle()

            const roleName = roleData?.name || ""
            const unidadeColab = colab?.unidade_cuca || null
            // Usuários com unidade 'Geral' ou nula têm visão global (equivalente a Super Admin nesta página)
            const isGlobal = !unidadeColab || unidadeColab === "Geral"
            const isSuperAdmin = isGlobal || ["Super Admin Cuca", "Developer"].includes(roleName)

            setProfile({
                email: user.email || null,
                unidade_cuca: unidadeColab,
                isSuperAdmin,
            })
        } catch (err) {
            console.error("Erro ao carregar perfil:", err)
        } finally {
            setFetching(false)
        }
    }

    if (fetching) {
        return <div className="flex justify-center py-40"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
    }

    return (
        <div className="flex flex-col gap-8 p-2 md:p-6">
            <div>
                <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
                    <UserCheck className="h-6 w-6 text-primary" />
                    Transbordo Humano — {profile?.isSuperAdmin ? "Toda a Rede CUCA" : (profile?.unidade_cuca || "Minha Unidade")}
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Cadastre quem recebe o alerta quando a IA encaminha uma conversa para atendimento humano, por canal.
                </p>
            </div>

            <TransbordoSection
                unidadeCuca={profile?.isSuperAdmin ? null : profile?.unidade_cuca}
            />
        </div>
    )
}
