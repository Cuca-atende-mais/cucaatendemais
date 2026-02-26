"use client"

import { useUser } from "@/lib/auth/user-provider"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import { Loader2 } from "lucide-react"

export default function DeveloperLayout({
    children,
}: {
    children: React.ReactNode
}) {
    const { isDeveloper, loading } = useUser()
    const router = useRouter()

    useEffect(() => {
        if (!loading && !isDeveloper) {
            router.push("/dashboard")
        }
    }, [isDeveloper, loading, router])

    if (loading) {
        return (
            <div className="flex h-[50vh] w-full items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        )
    }

    if (!isDeveloper) {
        return null
    }

    return <>{children}</>
}
