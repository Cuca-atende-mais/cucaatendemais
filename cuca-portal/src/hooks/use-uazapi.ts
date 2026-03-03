/**
 * hooks/use-uazapi.ts
 * ────────────────────
 * Hook que encapsula as chamadas ao Worker Python (UAZAPI Manager).
 * Usado pelas páginas de gestão de instâncias.
 */
"use client"

import { useState, useCallback, useRef } from "react"
import { toast } from "sonner"

const WORKER_URL = process.env.NEXT_PUBLIC_WORKER_URL || ""

export type QRStatus = "idle" | "loading" | "qr_ready" | "connected" | "error"

export interface CriarInstanciaPayload {
    nome: string
    canal_tipo: string
    unidade_cuca?: string | null
    observacoes?: string | null
}

export interface CriarInstanciaResult {
    id: string
    nome: string
    token: string
    qr_code: string | null  // base64
    webhook_url: string
}

export function useUazapi() {
    const [qrStatus, setQrStatus] = useState<QRStatus>("idle")
    const [qrCode, setQrCode] = useState<string | null>(null)
    const [qrNome, setQrNome] = useState<string | null>(null)
    const pollingRef = useRef<NodeJS.Timeout | null>(null)

    /** Para o polling de status */
    const stopPolling = useCallback(() => {
        if (pollingRef.current) {
            clearInterval(pollingRef.current)
            pollingRef.current = null
        }
    }, [])

    /**
     * Inicia o polling de status a cada 3 segundos.
     * Quando detectar "open" (conectado), chama onConnected e para.
     */
    const startPolling = useCallback((nome: string, onConnected: () => void) => {
        stopPolling()  // garante que não há polling duplicado

        let attempts = 0
        const MAX_ATTEMPTS = 40  // 40 * 3s = 2 minutos de espera

        pollingRef.current = setInterval(async () => {
            attempts++
            if (attempts > MAX_ATTEMPTS) {
                stopPolling()
                setQrStatus("error")
                toast.error("Tempo limite de pareamento expirado. Tente novamente.")
                return
            }

            try {
                const res = await fetch(`${WORKER_URL}/api/instancias/${encodeURIComponent(nome)}/status`, {
                    cache: "no-store",
                })
                if (!res.ok) return

                const data = await res.json()
                if (data.is_connected) {
                    stopPolling()
                    setQrStatus("connected")
                    toast.success(`✅ WhatsApp conectado com sucesso! Instância "${nome}" ativa.`)
                    onConnected()
                }
            } catch {
                // Ignora erros temporários durante o polling
            }
        }, 3000)
    }, [stopPolling])

    /**
     * Cria uma nova instância: chama o Worker que executa
     * POST /instance/create → POST /webhook/set → GET /instance/connect
     * e retorna o QR Code em base64.
     */
    const criarInstancia = useCallback(async (
        payload: CriarInstanciaPayload,
        onConnected: () => void
    ): Promise<CriarInstanciaResult | null> => {
        setQrStatus("loading")
        setQrCode(null)
        setQrNome(null)

        try {
            const res = await fetch(`${WORKER_URL}/api/instancias/criar`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
            })

            if (!res.ok) {
                const err = await res.json().catch(() => ({ detail: res.statusText }))
                throw new Error(err.detail || `Erro ${res.status}`)
            }

            const data: CriarInstanciaResult = await res.json()

            if (data.qr_code) {
                setQrCode(data.qr_code)
                setQrNome(data.nome)
                setQrStatus("qr_ready")
                // Inicia polling automático de status
                startPolling(data.nome, onConnected)
            } else {
                // Sem QR Code (já conectado ou erro na UAZAPI)
                setQrStatus("connected")
                onConnected()
            }

            return data
        } catch (err: any) {
            setQrStatus("error")
            toast.error(`Falha ao criar instância: ${err.message}`)
            return null
        }
    }, [startPolling])

    /**
     * Atualiza o QR Code (quando o anterior expirou após 30s).
     */
    const refreshQrCode = useCallback(async (nome: string, onConnected: () => void) => {
        setQrStatus("loading")
        try {
            const res = await fetch(`${WORKER_URL}/api/instancias/${encodeURIComponent(nome)}/qrcode`, {
                cache: "no-store",
            })
            if (!res.ok) throw new Error(`Erro ${res.status}`)
            const data = await res.json()

            if (data.ja_conectado) {
                setQrStatus("connected")
                onConnected()
                return
            }
            if (data.qr_code) {
                setQrCode(data.qr_code)
                setQrStatus("qr_ready")
                startPolling(nome, onConnected)
            }
        } catch (err: any) {
            toast.error(`Erro ao atualizar QR Code: ${err.message}`)
            setQrStatus("error")
        }
    }, [startPolling])

    /**
     * Faz logout seguro de uma instância (antes de trocar chip).
     */
    const logoutInstancia = useCallback(async (nome: string): Promise<boolean> => {
        try {
            const res = await fetch(`${WORKER_URL}/api/instancias/${encodeURIComponent(nome)}/logout`, {
                method: "DELETE",
            })
            if (!res.ok) throw new Error(`Erro ${res.status}`)
            return true
        } catch (err: any) {
            toast.error(`Erro ao desconectar: ${err.message}`)
            return false
        }
    }, [])

    /**
     * Exclui permanentemente uma instância (logout + delete no banco).
     */
    const excluirInstancia = useCallback(async (nome: string): Promise<boolean> => {
        try {
            const res = await fetch(`${WORKER_URL}/api/instancias/${encodeURIComponent(nome)}/excluir`, {
                method: "DELETE",
            })
            if (!res.ok) throw new Error(`Erro ${res.status}`)
            return true
        } catch (err: any) {
            toast.error(`Erro ao excluir: ${err.message}`)
            return false
        }
    }, [])

    const resetQr = useCallback(() => {
        stopPolling()
        setQrStatus("idle")
        setQrCode(null)
        setQrNome(null)
    }, [stopPolling])

    return {
        qrStatus,
        qrCode,
        qrNome,
        criarInstancia,
        refreshQrCode,
        logoutInstancia,
        excluirInstancia,
        resetQr,
    }
}
