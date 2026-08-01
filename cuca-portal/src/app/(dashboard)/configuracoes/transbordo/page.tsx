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
// S-WM-63 (fix pós-QA FAIL): esta página lia/gravava direto em human_handover_contacts,
// tabela removida por esta story — achado bloqueante da @qa Quinn (tela linkada no menu
// real, `config_whatsapp:read`, mesma permissão de /configuracoes/whatsapp). Retargetada
// para transbordo_humano via TransbordoSection, mesmo padrão já usado nas outras 3 telas.
export default function TransbordoPage() {
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
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
                    <UserCheck className="h-7 w-7 text-primary" />
                    Atendimento Humano — {profile?.isSuperAdmin ? "Toda a Rede CUCA" : (profile?.unidade_cuca || "Minha Unidade")}
                </h1>
                <p className="text-muted-foreground">
                    Configure para quais números de WhatsApp os alertas de transbordo serão enviados, por canal.
                </p>
            </div>

            <TransbordoSection
                unidadeCuca={profile?.isSuperAdmin ? null : profile?.unidade_cuca}
            />
        </div>
    )
}
