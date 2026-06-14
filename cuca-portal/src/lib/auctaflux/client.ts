// Provider AuctaFlux (BSP WhatsApp Oficial Meta) — cliente REST server-side para o módulo Academia Enem.
// Contrato confirmado em 2026-06-14 contra https://api-flux.aucta.tech/api/v1/reseller/v1.
// Auth: header Authorization: Bearer <API Key reseller aflx_rsl_...> — SEMPRE de env, nunca no código.
// IMPORTANTE: use apenas server-side (API routes / webhook). Nunca exponha a API key ao client.

const BASE_URL = (process.env.AUCTAFLUX_BASE_URL || "https://api-flux.aucta.tech/api/v1/reseller/v1").replace(/\/$/, "")

function apiKey(): string {
    const key = process.env.AUCTAFLUX_RESELLER_API_KEY
    if (!key) throw new Error("AUCTAFLUX_RESELLER_API_KEY não configurada no ambiente")
    return key
}

// Workspace = instância WhatsApp na AuctaFlux.
export interface AuctaFluxWorkspace {
    id: string
    name: string | null
    slug: string | null
    mode: string | null
    forward_to_url: string | null
    archived_at: string | null
    created_at: string | null
}

// Status de conexão do número (Meta) por workspace.
export interface AuctaFluxConnection {
    workspace_id: string
    status: string | null               // pending_signup | connected | disconnected | ...
    phone_number: string | null
    display_name: string | null
    phone_number_id: string | null
    waba_id: string | null
    quality_rating: string | null
    messaging_limit_tier: string | null
    pending_reason: string | null
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response
    try {
        res = await fetch(`${BASE_URL}${path}`, {
            ...init,
            headers: {
                Authorization: `Bearer ${apiKey()}`,
                Accept: "application/json",
                ...(init?.body ? { "Content-Type": "application/json" } : {}),
                ...(init?.headers || {}),
            },
            // Dados sempre frescos; nunca cachear respostas da AuctaFlux.
            cache: "no-store",
        })
    } catch (e) {
        // Erro de rede/DNS/timeout (§3.6: falha de integração externa).
        throw new Error(`AuctaFlux indisponível: ${e instanceof Error ? e.message : "erro de rede"}`)
    }

    const raw = await res.text()
    if (!res.ok) {
        // §3.6: propaga status + detalhe da AuctaFlux de forma legível (401 token, 429 rate-limit, etc.).
        let detail = raw
        try { detail = (JSON.parse(raw)?.detail as string) ?? raw } catch { /* texto puro */ }
        throw new AuctaFluxError(res.status, detail || res.statusText)
    }
    return (raw ? JSON.parse(raw) : null) as T
}

export class AuctaFluxError extends Error {
    constructor(public status: number, message: string) {
        super(message)
        this.name = "AuctaFluxError"
    }
}

// GET /workspaces → lista as instâncias existentes na AuctaFlux (criadas no console deles).
export async function listarWorkspaces(): Promise<AuctaFluxWorkspace[]> {
    const data = await request<AuctaFluxWorkspace[]>("/workspaces")
    return Array.isArray(data) ? data : []
}

// GET /workspaces/{id}/connection → status do número (Meta) daquele workspace.
export async function statusConexao(workspaceId: string): Promise<AuctaFluxConnection> {
    return request<AuctaFluxConnection>(`/workspaces/${encodeURIComponent(workspaceId)}/connection`)
}

// PATCH /workspaces/{id} → aponta o forward_to_url (webhook) para nós. Usado ao ASSUMIR (S-AE-02 fatia 2).
export async function setForwardUrl(workspaceId: string, forwardToUrl: string): Promise<AuctaFluxWorkspace> {
    return request<AuctaFluxWorkspace>(`/workspaces/${encodeURIComponent(workspaceId)}`, {
        method: "PATCH",
        body: JSON.stringify({ forward_to_url: forwardToUrl }),
    })
}

// POST /workspaces/{id}/rotate-secret → retorna o forward_secret (chave do HMAC). Irrecuperável: guardar na hora.
export async function rotateSecret(workspaceId: string): Promise<{ forward_secret: string }> {
    return request<{ forward_secret: string }>(`/workspaces/${encodeURIComponent(workspaceId)}/rotate-secret`, {
        method: "POST",
    })
}

// Resposta de envio (texto/template/mídia): { wamid, status, passthrough_id }.
export interface AuctaFluxSendResult {
    wamid: string
    status: string | null
    passthrough_id: string | null
}

// POST /messages → texto livre (só dentro da janela de 24h). Payload `{to, text}` (doc §3.3).
export async function enviarTexto(workspaceId: string, to: string, text: string): Promise<AuctaFluxSendResult> {
    return request(`/workspaces/${encodeURIComponent(workspaceId)}/messages`, {
        method: "POST",
        body: JSON.stringify({ to, text }),
    })
}

// POST /messages/template → template aprovado (fora da janela de 24h). Payload achatado (doc §3.3).
export async function enviarTemplate(
    workspaceId: string,
    to: string,
    template: { template_name: string; language: string; components?: unknown[] },
): Promise<AuctaFluxSendResult> {
    return request(`/workspaces/${encodeURIComponent(workspaceId)}/messages/template`, {
        method: "POST",
        body: JSON.stringify({ to, ...template }),
    })
}
