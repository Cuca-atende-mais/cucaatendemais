"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { useUser } from "@/lib/auth/user-provider"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { EPM_RELATORIO, EPM_SITUACAO_VAGAS } from "@/lib/rbac/catalogo-empregabilidade-gestao"

// S-EMP-GES-09 (AC2): Relatórios com dois submenus — "Relatório mensal" (Emprega+, GES-04) e "Situação de
// vagas". Cada aba aparece só para quem tem a permissão dela; quem tem só uma cai direto no relatório dela.
// A página do Relatório mensal não muda: este layout só põe as abas em cima.

const URL_MENSAL = "/empregabilidade/relatorios"
const URL_SITUACAO = "/empregabilidade/relatorios/situacao-vagas"

export default function RelatoriosLayout({ children }: { children: React.ReactNode }) {
    const pathname = usePathname()
    const router = useRouter()
    const { hasPermission, loading } = useUser()
    const podeMensal = hasPermission(EPM_RELATORIO.ver, "read")
    const podeSituacao = hasPermission(EPM_SITUACAO_VAGAS.ver, "read")
    const naSituacao = pathname === URL_SITUACAO || pathname.startsWith(URL_SITUACAO + "/")

    const destino = loading ? null
        : !naSituacao && !podeMensal && podeSituacao ? URL_SITUACAO
        : naSituacao && !podeSituacao && podeMensal ? URL_MENSAL
        : null

    useEffect(() => {
        if (destino) router.replace(destino)
    }, [destino, router])

    if (loading || destino) return <Skeleton className="h-64 w-full" />

    return (
        <div className="space-y-6">
            {podeMensal && podeSituacao && (
                <Tabs value={naSituacao ? URL_SITUACAO : URL_MENSAL} onValueChange={v => router.push(v)}>
                    <TabsList className="h-11 md:h-9">
                        <TabsTrigger value={URL_MENSAL} className="px-4">Relatório mensal</TabsTrigger>
                        <TabsTrigger value={URL_SITUACAO} className="px-4">Situação de vagas</TabsTrigger>
                    </TabsList>
                </Tabs>
            )}
            {children}
        </div>
    )
}
